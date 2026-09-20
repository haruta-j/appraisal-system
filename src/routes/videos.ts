import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { probeVideo } from '../services/ffmpeg';
import * as videosDb from '../db/videos';
import * as candidatesDb from '../db/candidates';
import * as decisionsDb from '../db/editDecisions';
import * as jobsDb from '../db/detectionJobs';
import * as runsDb from '../db/editLogRuns';

fs.mkdirSync(config.paths.sources, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.paths.sources),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
]);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Unsupported file type'));
      return;
    }
    cb(null, true);
  },
});

export const videosRouter = Router();

videosRouter.post('/', upload.single('video'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No video file uploaded' });
    return;
  }
  try {
    const info = await probeVideo(req.file.path);
    const video = videosDb.createVideo({
      originalFilename: req.file.originalname,
      sourcePath: req.file.path,
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      fps: info.fps,
    });
    res.status(201).json(video);
  } catch (err) {
    fs.unlinkSync(req.file.path);
    console.error(err);
    res.status(500).json({ error: 'Failed to process uploaded video' });
  }
});

videosRouter.get('/', (_req, res) => {
  res.json(videosDb.listVideos());
});

videosRouter.get('/:id', (req, res) => {
  const video = videosDb.getVideo(req.params.id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json({
    video,
    latestDetectionJob: jobsDb.getLatestDetectionJobForVideo(video.id),
    candidates: candidatesDb.listCandidatesForVideo(video.id),
    decisions: decisionsDb.listEditDecisionsForVideo(video.id),
    latestEditLogRun: runsDb.getLatestEditLogRunForVideo(video.id),
  });
});

videosRouter.get('/:id/stream', (req, res) => {
  const video = videosDb.getVideo(req.params.id);
  if (!video) {
    res.status(404).end();
    return;
  }
  const filePath = video.processedPath && fs.existsSync(video.processedPath)
    ? video.processedPath
    : video.sourcePath;
  streamFile(filePath, req, res);
});

videosRouter.get('/:id/processed', (req, res) => {
  const video = videosDb.getVideo(req.params.id);
  if (!video || !video.processedPath || !fs.existsSync(video.processedPath)) {
    res.status(404).end();
    return;
  }
  streamFile(video.processedPath, req, res);
});

function streamFile(filePath: string, req: import('express').Request, res: import('express').Response) {
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': 'video/mp4',
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}
