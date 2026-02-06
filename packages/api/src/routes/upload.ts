import { Router } from 'express';
import multer from 'multer';
import { bucket } from '../config/firebase.js';
import { requireTenantParam } from '../middleware/auth.js';
import { randomUUID } from 'crypto';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const uploadRouter = Router({ mergeParams: true });
uploadRouter.use(requireTenantParam);

uploadRouter.post('/', upload.single('file'), async (req, res) => {
  if (!bucket) {
    res.status(503).json({ error: 'Storage not configured. Set FIREBASE_STORAGE_BUCKET in .env' });
    return;
  }
  const tenantId = res.locals.tenantId as string;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const ext = file.originalname.split('.').pop() || 'bin';
  const path = `tenants/${tenantId}/uploads/${randomUUID()}.${ext}`;
  const fileRef = bucket.file(path);
  await fileRef.save(file.buffer, {
    metadata: { contentType: file.mimetype },
  });
  const [url] = await fileRef.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ url, path });
});
