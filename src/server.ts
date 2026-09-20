import path from 'path';
import express from 'express';
import { config } from './config';
import './db/connection';
import { authRouter } from './routes/auth';
import { videosRouter } from './routes/videos';
import { detectionRouter } from './routes/detection';
import { decisionsRouter } from './routes/decisions';
import { previewRouter, previewFilesRouter } from './routes/preview';
import { pipelineRouter } from './routes/pipeline';
import { youtubeUploadRouter } from './routes/youtubeUpload';

// Background jobs (detection, ffmpeg pipeline runs) are fire-and-forget; an error inside
// one must not take the whole server down. Failures are recorded on the job/run row itself.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', authRouter);
app.use('/api/videos', videosRouter);
app.use('/api/videos', detectionRouter);
app.use('/api/videos', decisionsRouter);
app.use('/api/videos', previewRouter);
app.use('/api/videos', pipelineRouter);
app.use('/api/videos', youtubeUploadRouter);
app.use('/api/previews', previewFilesRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
