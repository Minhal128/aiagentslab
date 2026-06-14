'use strict';
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authenticateHybrid } from '../middleware/hybrid-auth';

const router = Router();

// Ensure audio directory exists
const AUDIO_DIR = path.join(process.cwd(), 'public', 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// Configure multer for audio uploads
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AUDIO_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uuid = randomUUID();
    cb(null, `${uuid}${ext}`);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/wave', 'audio/x-wav'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only MP3 and WAV files are allowed'));
  }
};

const upload = multer({
  storage: audioStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// POST /api/audio/upload - Upload audio file
router.post('/upload', authenticateHybrid as any, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const url = `/audio/${req.file.filename}`;
    console.log(`[AudioUpload] User ${(req as any).userId} uploaded: ${req.file.originalname} -> ${url}`);

    res.json({
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  } catch (error) {
    console.error('[AudioUpload] Error:', error);
    res.status(500).json({ error: 'Failed to upload audio file' });
  }
});

// DELETE /api/audio/:filename - Delete audio file
router.delete('/:filename', authenticateHybrid as any, (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(AUDIO_DIR, filename);

    // Security: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[AudioUpload] Deleted: ${filename}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[AudioUpload] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete audio file' });
  }
});

export default router;
