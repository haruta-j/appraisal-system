import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as jobsDb from '../db/detectionJobs';
import * as candidatesDb from '../db/candidates';
import { runDetectionJob } from '../services/detection';

export const detectionRouter = Router();

detectionRouter.post('/:videoId/detect', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const existing = jobsDb.getLatestDetectionJobForVideo(video.id);
  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    res.status(409).json({ error: 'Detection already in progress', job: existing });
    return;
  }

  const job = jobsDb.createDetectionJob(video.id);
  res.status(202).json(job);

  // Run in the background; failures are recorded on the job row.
  runDetectionJob(job.id, video.id).catch((err) => {
    console.error(`Detection job ${job.id} failed:`, err);
  });
});

detectionRouter.get('/:videoId/detect/:jobId', (req, res) => {
  const job = jobsDb.getDetectionJob(req.params.jobId);
  if (!job || job.videoId !== req.params.videoId) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

detectionRouter.get('/:videoId/candidates', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json(candidatesDb.listCandidatesForVideo(video.id));
});
