import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

export interface VideoProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export function probeVideo(filePath: string): Promise<VideoProbeInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream found'));

      let fps = 30;
      if (stream.r_frame_rate) {
        const [num, den] = stream.r_frame_rate.split('/').map(Number);
        if (den) fps = num / den;
      }

      resolve({
        durationSec: parseFloat(String(data.format.duration ?? stream.duration ?? '0')),
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        fps,
      });
    });
  });
}

export function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.streams.some((s) => s.codec_type === 'audio'));
    });
  });
}

export interface ExtractedFrame {
  time: number;
  framePath: string;
}

/**
 * Extracts frames at a fixed interval (seconds) using ffmpeg's fps filter in a single pass.
 * Frame N (1-indexed) corresponds to approximately time (N-1) * intervalSec.
 */
export function extractFrames(
  filePath: string,
  outDir: string,
  intervalSec: number,
  onProgress?: (percent: number) => void
): Promise<ExtractedFrame[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const pattern = path.join(outDir, 'frame-%06d.jpg');

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([`-vf fps=1/${intervalSec}`, '-qscale:v 3'])
      .output(pattern)
      .on('progress', (progress) => {
        if (onProgress && Number.isFinite(progress.percent)) {
          onProgress(Math.min(99, Math.max(0, progress.percent as number)));
        }
      })
      .on('end', () => {
        const files = fs
          .readdirSync(outDir)
          .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
          .sort();
        const frames: ExtractedFrame[] = files.map((f, idx) => ({
          time: idx * intervalSec,
          framePath: path.join(outDir, f),
        }));
        resolve(frames);
      })
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Extracts frames at a fixed interval within [startTime, endTime] of the source video.
 * Used for on-demand detection over a manually specified interval.
 */
export function extractFrameRange(
  filePath: string,
  outDir: string,
  startTime: number,
  endTime: number,
  intervalSec: number
): Promise<ExtractedFrame[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const pattern = path.join(outDir, 'frame-%06d.jpg');
  const duration = Math.max(0.001, endTime - startTime);

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .inputOptions([`-ss ${startTime}`])
      .outputOptions([`-t ${duration}`, `-vf fps=1/${intervalSec}`, '-qscale:v 3'])
      .output(pattern)
      .on('end', () => {
        const files = fs
          .readdirSync(outDir)
          .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
          .sort();
        const frames: ExtractedFrame[] = files.map((f, idx) => ({
          time: startTime + idx * intervalSec,
          framePath: path.join(outDir, f),
        }));
        resolve(frames);
      })
      .on('error', (err) => reject(err))
      .run();
  });
}

export function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
