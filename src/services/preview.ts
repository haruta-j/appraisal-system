import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config';
import { VideoRecord, BlurMode, BlurRegion, DetectionSample } from '../types';
import { buildBlurFilterComplex, BlurFilterInput } from './blurFilter';

export interface PreviewRequest {
  startTime: number;
  endTime: number;
  blurMode: BlurMode;
  blurRegion: BlurRegion | null;
  trackedSamples: DetectionSample[] | null;
}

const PAD_SEC = 1;

export function generateBlurPreview(video: VideoRecord, req: PreviewRequest): Promise<string> {
  if (!video.width || !video.height) {
    return Promise.reject(new Error('Video dimensions unknown; cannot build preview'));
  }
  const duration = video.durationSec ?? req.endTime + PAD_SEC;
  const previewStart = Math.max(0, req.startTime - PAD_SEC);
  const previewEnd = Math.min(duration, req.endTime + PAD_SEC);
  const clipDuration = Math.max(0.5, previewEnd - previewStart);

  const shifted: BlurFilterInput = {
    startTime: req.startTime - previewStart,
    endTime: req.endTime - previewStart,
    blurMode: req.blurMode,
    blurRegion: req.blurRegion,
    trackedSamples: req.trackedSamples
      ? req.trackedSamples.map((s) => ({ ...s, time: s.time - previewStart }))
      : null,
  };

  const { filters, outputLabel } = buildBlurFilterComplex('0:v', [shifted], video.width, video.height);

  fs.mkdirSync(config.paths.previews, { recursive: true });
  const outputPath = path.join(config.paths.previews, `${randomUUID()}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg(video.sourcePath)
      .inputOptions([`-ss ${previewStart.toFixed(3)}`])
      .complexFilter(filters)
      .outputOptions([
        `-t ${clipDuration.toFixed(3)}`,
        '-map',
        `[${outputLabel}]`,
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}
