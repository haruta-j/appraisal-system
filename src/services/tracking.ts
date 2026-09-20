import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { extractFrameRange, cleanupDir } from './ffmpeg';
import { ensureModelsLoaded, detectInFrame } from './detection';
import { DetectionSample, CandidateRecord } from '../types';

/**
 * Returns the per-time bounding boxes to drive a "tracked" blur filter.
 * - If the decision is linked to a detected candidate, reuse its existing samples (clipped to range).
 * - Otherwise (a manual interval), run a scoped detection pass over just that interval.
 */
export async function computeTrackedSamples(
  sourcePath: string,
  startTime: number,
  endTime: number,
  candidate: CandidateRecord | null
): Promise<DetectionSample[]> {
  if (candidate) {
    return candidate.samples.filter((s) => s.time >= startTime - 0.001 && s.time <= endTime + 0.001);
  }

  await ensureModelsLoaded();
  const tmpDir = path.join(config.paths.frames, `manual-${randomUUID()}`);
  try {
    const frames = await extractFrameRange(
      sourcePath,
      tmpDir,
      startTime,
      endTime,
      config.detection.sampleIntervalSec
    );
    const samples: DetectionSample[] = [];
    for (const frame of frames) {
      const boxes = await detectInFrame(frame.framePath, config.detection.minConfidence);
      samples.push({ time: frame.time, boxes });
    }
    return samples;
  } finally {
    cleanupDir(tmpDir);
  }
}
