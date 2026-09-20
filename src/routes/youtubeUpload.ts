import fs from 'fs';
import { Router } from 'express';
import * as videosDb from '../db/videos';
import * as youtube from '../services/youtube';

export const youtubeUploadRouter = Router();

youtubeUploadRouter.post('/:videoId/upload-youtube', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (!youtube.isAuthenticated()) {
    res.status(401).json({ error: 'Not authenticated with Google. Visit /auth/google first.' });
    return;
  }

  const filePath = video.processedPath && fs.existsSync(video.processedPath)
    ? video.processedPath
    : video.sourcePath;

  const body = req.body as Record<string, unknown>;
  const title = String(body.title ?? video.originalFilename);
  const description = String(body.description ?? '');
  const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
  const privacyStatus = (body.privacyStatus as string) || 'private';
  if (!['public', 'unlisted', 'private'].includes(privacyStatus)) {
    res.status(400).json({ error: 'privacyStatus must be public, unlisted, or private' });
    return;
  }

  videosDb.updateVideoStatus(video.id, 'uploading_to_youtube');
  res.status(202).json({ status: 'started' });

  youtube
    .uploadVideo({
      filePath,
      title,
      description,
      tags,
      privacyStatus: privacyStatus as 'public' | 'unlisted' | 'private',
    })
    .then((result) => {
      videosDb.setVideoYoutubeId(video.id, result.videoId);
      videosDb.updateVideoStatus(video.id, 'uploaded_to_youtube');
    })
    .catch((err) => {
      console.error(`YouTube upload failed for video ${video.id}:`, err);
      videosDb.updateVideoStatus(video.id, 'failed');
    });
});

youtubeUploadRouter.get('/:videoId/upload-status', (req, res) => {
  const video = videosDb.getVideo(req.params.videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json({ status: video.status, youtubeVideoId: video.youtubeVideoId });
});
