import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as decisionsDb from '../db/editDecisions';
import * as candidatesDb from '../db/candidates';
import { EditAction, EditSource } from '../types';

export const decisionsRouter = Router();

const VALID_ACTIONS: EditAction[] = ['cut', 'keep'];
const VALID_SOURCES: EditSource[] = ['detected', 'manual'];

decisionsRouter.get('/:videoId/decisions', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json(decisionsDb.listEditDecisionsForVideo(video.id));
});

decisionsRouter.post('/:videoId/decisions', (req, res) => {
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

  const decision = decisionsDb.upsertEditDecision({
    id: body.id as string | undefined,
    videoId: video.id,
    candidateId,
    source,
    startTime,
    endTime,
    action,
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
