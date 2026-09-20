import path from 'path';
import fs from 'fs';
import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as candidatesDb from '../db/candidates';
import { computeTrackedSamples } from '../services/tracking';
import { generateBlurPreview } from '../services/preview';
import { config } from '../config';
import { BlurMode, BlurRegion } from '../types';

export const previewRouter = Router();

previewRouter.post('/:videoId/preview-blur', async (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const startTime = Number(body.startTime);
  const endTime = Number(body.endTime);
  const blurMode = body.blurMode as BlurMode;
  const candidateId = (body.candidateId as string | undefined) ?? null;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    res.status(400).json({ error: 'startTime/endTime invalid' });
    return;
  }
  if (blurMode !== 'fixed' && blurMode !== 'tracked') {
    res.status(400).json({ error: 'blurMode must be "fixed" or "tracked"' });
    return;
  }

  let blurRegion: BlurRegion | null = null;
  let trackedSamples = null as Awaited<ReturnType<typeof computeTrackedSamples>> | null;

  if (blurMode === 'fixed') {
    blurRegion = body.blurRegion as BlurRegion;
    if (!blurRegion || typeof blurRegion.x !== 'number') {
      res.status(400).json({ error: 'blurRegion required for fixed mode' });
      return;
    }
  } else {
    const candidate = candidateId ? candidatesDb.getCandidate(candidateId) : null;
    try {
      trackedSamples = await computeTrackedSamples(video.sourcePath, startTime, endTime, candidate);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to analyze interval' });
      return;
    }
    if (!trackedSamples.some((s) => s.boxes.length > 0)) {
      res.status(422).json({ error: 'No detections in this interval; use fixed mode instead' });
      return;
    }
  }

  try {
    const outputPath = await generateBlurPreview(video, {
      startTime,
      endTime,
      blurMode,
      blurRegion,
      trackedSamples,
    });
    res.json({ previewUrl: `/api/previews/${path.basename(outputPath)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

export const previewFilesRouter = Router();

previewFilesRouter.get('/:filename', (req, res) => {
  const filePath = path.join(config.paths.previews, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});
