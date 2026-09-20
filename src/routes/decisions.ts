import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as decisionsDb from '../db/editDecisions';
import * as candidatesDb from '../db/candidates';
import { computeTrackedSamples } from '../services/tracking';
import { BlurMode, BlurRegion, EditAction, EditSource } from '../types';

export const decisionsRouter = Router();

const VALID_ACTIONS: EditAction[] = ['cut', 'blur', 'keep'];
const VALID_SOURCES: EditSource[] = ['detected', 'manual'];
const VALID_BLUR_MODES: BlurMode[] = ['tracked', 'fixed'];

function isValidBlurRegion(region: unknown): region is BlurRegion {
  if (typeof region !== 'object' || region === null) return false;
  const r = region as Record<string, unknown>;
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    r.width > 0 &&
    r.height > 0
  );
}

decisionsRouter.get('/:videoId/decisions', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json(decisionsDb.listEditDecisionsForVideo(video.id));
});

decisionsRouter.post('/:videoId/decisions', async (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const source = body.source as EditSource;
  const action = body.action as EditAction;
  const startTime = Number(body.startTime);
  const endTime = Number(body.endTime);
  const candidateId = (body.candidateId as string | undefined) ?? null;

  if (!VALID_SOURCES.includes(source)) {
    res.status(400).json({ error: `source must be one of ${VALID_SOURCES.join(', ')}` });
    return;
  }
  if (!VALID_ACTIONS.includes(action)) {
    res.status(400).json({ error: `action must be one of ${VALID_ACTIONS.join(', ')}` });
    return;
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime) {
    res.status(400).json({ error: 'startTime/endTime must be numbers with endTime > startTime >= 0' });
    return;
  }
  if (video.durationSec != null && endTime > video.durationSec + 0.5) {
    res.status(400).json({ error: 'endTime exceeds video duration' });
    return;
  }
  if (candidateId && !candidatesDb.getCandidate(candidateId)) {
    res.status(404).json({ error: 'candidateId does not reference an existing candidate' });
    return;
  }

  let blurMode: BlurMode | null = null;
  let blurRegion: BlurRegion | null = null;
  let trackedSamples = null as Awaited<ReturnType<typeof computeTrackedSamples>> | null;

  if (action === 'blur') {
    blurMode = body.blurMode as BlurMode;
    if (!VALID_BLUR_MODES.includes(blurMode)) {
      res.status(400).json({ error: `blurMode must be one of ${VALID_BLUR_MODES.join(', ')} when action is "blur"` });
      return;
    }
    if (blurMode === 'fixed') {
      if (!isValidBlurRegion(body.blurRegion)) {
        res.status(400).json({ error: 'blurRegion {x,y,width,height} is required when blurMode is "fixed"' });
        return;
      }
      blurRegion = body.blurRegion as BlurRegion;
    } else {
      // 'tracked': derive per-time boxes from the linked candidate, or run a scoped
      // detection pass over the manually specified interval.
      const candidate = candidateId ? candidatesDb.getCandidate(candidateId) : null;
      try {
        trackedSamples = await computeTrackedSamples(video.sourcePath, startTime, endTime, candidate);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to analyze the interval for tracked blur' });
        return;
      }
      const hasAnyDetection = trackedSamples.some((s) => s.boxes.length > 0);
      if (!hasAnyDetection) {
        res.status(422).json({
          error:
            'No face/person detected in this interval, so "tracked" blur has no region to follow. Use "fixed" instead, or adjust the interval.',
        });
        return;
      }
    }
  }

  const decision = decisionsDb.upsertEditDecision({
    id: body.id as string | undefined,
    videoId: video.id,
    candidateId,
    source,
    startTime,
    endTime,
    action,
    blurMode,
    blurRegion,
    trackedSamples,
    label: (body.label as string | undefined) ?? null,
  });

  res.status(200).json(decision);
});

decisionsRouter.delete('/:videoId/decisions/:decisionId', (req, res) => {
  const decision = decisionsDb.getEditDecision(req.params.decisionId);
  if (!decision || decision.videoId !== req.params.videoId) {
    res.status(404).json({ error: 'Decision not found' });
    return;
  }
  decisionsDb.deleteEditDecision(decision.id);
  res.status(204).end();
});
