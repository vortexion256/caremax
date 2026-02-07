import { db } from '../config/firebase.js';

const RAG_CHUNKS = 'rag_chunks';

const STOP_WORDS = new Set(
  'a an the is are was were be been being have has had do does did will would could should may might must can what which who when where why how i me my we our you your it its they them their'.split(
    ' '
  )
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Score chunk by how many query terms appear in it (simple keyword relevance). */
function scoreChunk(chunkText: string, queryTerms: string[]): number {
  const lower = chunkText.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (lower.includes(term)) score += 1;
  }
  return score;
}

export async function getRagContext(tenantId: string, query: string, limit = 8): Promise<string> {
  const snap = await db
    .collection(RAG_CHUNKS)
    .where('tenantId', '==', tenantId)
    .limit(100)
    .get();

  if (snap.empty) {
    if (process.env.NODE_ENV !== 'test') {
      console.log('RAG: no chunks found for tenant', tenantId, '- add RAG documents in Admin → RAG documents and ensure "Use RAG" is on in Agent settings.');
    }
    return '';
  }

  const queryTerms = tokenize(query);
  const chunksWithText = snap.docs
    .map((d) => ({ id: d.id, text: d.data().text as string }))
    .filter((c) => c.text?.trim());

  if (chunksWithText.length === 0) {
    if (process.env.NODE_ENV !== 'test') console.log('RAG: tenant', tenantId, 'has chunks but none have text.');
    return '';
  }

  let chosen: string[];
  if (queryTerms.length > 0) {
    const scored = chunksWithText
      .map((c) => ({ text: c.text, score: scoreChunk(c.text, queryTerms) }))
      .filter((c) => c.score >= 0);
    scored.sort((a, b) => b.score - a.score);
    chosen = scored.slice(0, limit).map((c) => c.text);
    if (chosen.length < limit) {
      const used = new Set(scored.slice(0, limit).map((c) => c.text));
      for (const c of chunksWithText) {
        if (chosen.length >= limit) break;
        if (!used.has(c.text)) chosen.push(c.text);
      }
    }
  } else {
    chosen = chunksWithText.slice(0, limit).map((c) => c.text);
  }

  const result = chosen.join('\n\n');
  if (process.env.NODE_ENV !== 'test') {
    console.log('RAG: tenant', tenantId, 'query length', query.length, 'chunks used', chosen.length, 'of', chunksWithText.length);
  }
  return result;
}

export async function indexDocument(
  tenantId: string,
  documentId: string,
  chunks: string[]
): Promise<void> {
  const batch = db.batch();
  for (let i = 0; i < chunks.length; i++) {
    const ref = db.collection(RAG_CHUNKS).doc();
    batch.set(ref, {
      tenantId,
      documentId,
      index: i,
      text: chunks[i],
    });
  }
  await batch.commit();
}

/** Delete all chunks for a document (so it can be re-indexed with new content). */
export async function deleteChunksForDocument(tenantId: string, documentId: string): Promise<void> {
  const snap = await db
    .collection(RAG_CHUNKS)
    .where('tenantId', '==', tenantId)
    .where('documentId', '==', documentId)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.docs.length > 0) await batch.commit();
}
