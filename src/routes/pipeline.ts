import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as runsDb from '../db/editLogRuns';
import { runPipeline } from '../services/pipeline';

export const pipelineRouter = Router();

pipelineRouter.post('/:videoId/run-pipeline', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (video.status === 'processing') {
    res.status(409).json({ error: 'Pipeline already running for this video' });
    return;
  }

  runPipeline(video.id).catch((err) => {
    console.error(`Pipeline run failed for video ${video.id}:`, err);
  });

  res.status(202).json({ status: 'started' });
});

pipelineRouter.get('/:videoId/pipeline-runs/latest', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json(runsDb.getLatestEditLogRunForVideo(video.id));
});
