import { Router } from 'express';
import { db, auth, bucket } from '../config/firebase.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';

export const platformRouter = Router();

// All platform routes require authentication and platform admin role
platformRouter.use(requireAuth, requirePlatformAdmin);

platformRouter.get('/tenants', async (_req, res) => {
  try {
    const snap = await db
      .collection('tenants')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const tenants = snap.docs.map((d) => {
      const data = d.data();
      return {
        tenantId: d.id,
        name: data.name ?? '',
        allowedDomains: data.allowedDomains ?? [],
        createdAt: data.createdAt?.toMillis?.() ?? null,
        createdBy: data.createdBy ?? null,
      };
    });

    res.json({ tenants });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

platformRouter.get('/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const doc = await db.collection('tenants').doc(tenantId).get();
    
    if (!doc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const data = doc.data();
    let createdByEmail: string | null = null;
    
    // Try to get the creator's email if createdBy UID exists
    if (data?.createdBy) {
      try {
        const user = await auth.getUser(data.createdBy);
        createdByEmail = user.email ?? null;
      } catch {
        // User might not exist anymore, ignore
      }
    }

    // Get agent config if it exists
    let agentConfig = null;
    try {
      const agentDoc = await db.collection('agent_config').doc(tenantId).get();
      if (agentDoc.exists) {
        const agentData = agentDoc.data();
        agentConfig = {
          agentName: agentData?.agentName ?? null,
          model: agentData?.model ?? null,
          ragEnabled: agentData?.ragEnabled ?? false,
          createdAt: agentData?.createdAt?.toMillis?.() ?? null,
        };
      }
    } catch {
      // Ignore if agent config doesn't exist
    }

    res.json({
      tenantId: doc.id,
      name: data?.name ?? '',
      allowedDomains: data?.allowedDomains ?? [],
      createdAt: data?.createdAt?.toMillis?.() ?? null,
      createdBy: data?.createdBy ?? null,
      createdByEmail,
      agentConfig,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tenant details' });
  }
});

platformRouter.delete('/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Verify tenant exists
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenantData = tenantDoc.data();
    const createdBy = tenantData?.createdBy;

    // Helper function to commit batches (Firestore limit is 500 operations per batch)
    const commitBatch = async (batch: ReturnType<typeof db.batch>) => {
      await batch.commit();
    };

    // Delete all conversations and their messages
    const conversationsSnap = await db.collection('conversations').where('tenantId', '==', tenantId).get();
    const conversationIds: string[] = [];
    
    // Batch conversations deletions
    let batch = db.batch();
    let batchCount = 0;
    for (const convDoc of conversationsSnap.docs) {
      conversationIds.push(convDoc.id);
      batch.delete(convDoc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete all messages for these conversations
    if (conversationIds.length > 0) {
      // Firestore has a limit of 10 items per 'in' query, so we batch queries
      for (let i = 0; i < conversationIds.length; i += 10) {
        const batchIds = conversationIds.slice(i, i + 10);
        const messagesSnap = await db.collection('messages')
          .where('conversationId', 'in', batchIds)
          .get();
        for (const msgDoc of messagesSnap.docs) {
          batch.delete(msgDoc.ref);
          batchCount++;
          if (batchCount >= 500) {
            await commitBatch(batch);
            batch = db.batch();
            batchCount = 0;
          }
        }
      }
    }

    // Delete all RAG documents
    const ragDocsSnap = await db.collection('rag_documents').where('tenantId', '==', tenantId).get();
    for (const doc of ragDocsSnap.docs) {
      batch.delete(doc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete all RAG chunks for this tenant
    const ragChunksSnap = await db.collection('rag_chunks').where('tenantId', '==', tenantId).get();
    for (const chunkDoc of ragChunksSnap.docs) {
      batch.delete(chunkDoc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete agent config
    const agentConfigRef = db.collection('agent_config').doc(tenantId);
    const agentConfigDoc = await agentConfigRef.get();
    if (agentConfigDoc.exists) {
      batch.delete(agentConfigRef);
      batchCount++;
    }

    // Delete tenant document
    batch.delete(tenantDoc.ref);
    batchCount++;

    // Commit final batch
    if (batchCount > 0) {
      await commitBatch(batch);
    }

    // Delete storage files
    if (bucket) {
      try {
        const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/` });
        await Promise.all(files.map((file) => file.delete()));
      } catch (storageError) {
        // Log but don't fail - storage deletion is best effort
        console.error('Error deleting storage files:', storageError);
      }
    }

    // Remove tenantId from user's custom claims (if createdBy exists)
    // IMPORTANT: Preserve isPlatformAdmin claim if user is a platform admin
    if (createdBy) {
      try {
        const user = await auth.getUser(createdBy);
        const currentClaims = user.customClaims || {};
        const updatedClaims = { ...currentClaims };
        delete updatedClaims.tenantId;
        delete updatedClaims.isAdmin;
        // Preserve isPlatformAdmin if it exists
        if (currentClaims.isPlatformAdmin) {
          updatedClaims.isPlatformAdmin = true;
        }
        await auth.setCustomUserClaims(createdBy, updatedClaims);
      } catch (authError) {
        // Log but don't fail - user might not exist anymore
        console.error('Error updating user claims:', authError);
      }
    }

    res.json({ success: true, message: 'Tenant and all associated data deleted successfully' });
  } catch (e) {
    console.error('Error deleting tenant:', e);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

