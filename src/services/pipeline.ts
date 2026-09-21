import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config';
import { hasAudioStream } from './ffmpeg';
import { EditDecisionRecord, TimelineSegmentMapping, VideoRecord } from '../types';
import * as videosDb from '../db/videos';
import * as decisionsDb from '../db/editDecisions';
import * as runsDb from '../db/editLogRuns';

interface KeepSegment {
  originalStart: number;
  originalEnd: number;
}

function mergeCutIntervals(
  decisions: EditDecisionRecord[],
  duration: number
): Array<{ start: number; end: number }> {
  const cuts = decisions
    .filter((d) => d.action === 'cut')
    .map((d) => ({ start: Math.max(0, d.startTime), end: Math.min(duration, d.endTime) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ ...cut });
    }
  }
  return merged;
}

function computeKeepSegments(cuts: Array<{ start: number; end: number }>, duration: number): KeepSegment[] {
  const segments: KeepSegment[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) {
      segments.push({ originalStart: cursor, originalEnd: cut.start });
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration) {
    segments.push({ originalStart: cursor, originalEnd: duration });
  }
  return segments;
}

function computeTimelineMapping(segments: KeepSegment[]): TimelineSegmentMapping[] {
  const mapping: TimelineSegmentMapping[] = [];
  let editedCursor = 0;
  for (const seg of segments) {
    const segDuration = seg.originalEnd - seg.originalStart;
    mapping.push({
      originalStart: seg.originalStart,
      originalEnd: seg.originalEnd,
      editedStart: editedCursor,
      editedEnd: editedCursor + segDuration,
    });
    editedCursor += segDuration;
  }
  return mapping;
}

export async function runPipeline(videoId: string): Promise<string> {
  const video = videosDb.getVideo(videoId);
  if (!video) throw new Error('Video not found');
  if (!video.durationSec) {
    throw new Error('Video metadata incomplete; cannot run pipeline');
  }

  const decisions = decisionsDb.listEditDecisionsForVideo(videoId);
  const run = runsDb.createEditLogRun(videoId, decisions);
  videosDb.updateVideoStatus(videoId, 'processing');

  try {
    const cuts = mergeCutIntervals(decisions, video.durationSec);
    const keepSegments = computeKeepSegments(cuts, video.durationSec);
    const timelineMapping = computeTimelineMapping(keepSegments);

    const outputPath = await applyCuts(video, keepSegments);

    runsDb.completeEditLogRun(run.id, timelineMapping, outputPath);
    videosDb.setVideoProcessedPath(videoId, outputPath);
    videosDb.updateVideoStatus(videoId, 'ready_to_upload');
    return outputPath;
  } catch (err) {
    runsDb.failEditLogRun(run.id, err instanceof Error ? err.message : String(err));
    videosDb.updateVideoStatus(videoId, 'failed');
    throw err;
  }
}

/** Trims out the cut intervals and concatenates the remaining segments. No blur is applied
 *  here -- privacy blurring (if needed) is done afterwards in YouTube Studio. */
async function applyCuts(video: VideoRecord, keepSegments: KeepSegment[]): Promise<string> {
  if (keepSegments.length === 0) {
    throw new Error('All content is cut; nothing left to produce');
  }

  const audioPresent = await hasAudioStream(video.sourcePath);
  const filters: string[] = [];
  const videoSegLabels: string[] = [];
  const audioSegLabels: string[] = [];

  keepSegments.forEach((seg, idx) => {
    const vLabel = `vseg${idx}`;
    filters.push(
      `[0:v]trim=${seg.originalStart.toFixed(3)}:${seg.originalEnd.toFixed(3)},setpts=PTS-STARTPTS[${vLabel}]`
    );
    videoSegLabels.push(vLabel);

    if (audioPresent) {
      const aLabel = `aseg${idx}`;
      filters.push(
        `[0:a]atrim=${seg.originalStart.toFixed(3)}:${seg.originalEnd.toFixed(3)},asetpts=PTS-STARTPTS[${aLabel}]`
      );
      audioSegLabels.push(aLabel);
    }
  });

  let concatInputs = '';
  keepSegments.forEach((_seg, idx) => {
    concatInputs += `[${videoSegLabels[idx]}]`;
    if (audioPresent) concatInputs += `[${audioSegLabels[idx]}]`;
  });
  const concatOutV = 'vout';
  const concatOutA = 'aout';
  filters.push(
    `${concatInputs}concat=n=${keepSegments.length}:v=1:a=${audioPresent ? 1 : 0}[${concatOutV}]${audioPresent ? `[${concatOutA}]` : ''}`
  );

  fs.mkdirSync(config.paths.processed, { recursive: true });
  const outputPath = path.join(config.paths.processed, `${randomUUID()}.mp4`);

  // A single kept segment spanning the whole video means no cuts at all; re-muxing with a
  // stream copy avoids a needless re-encode.
  if (keepSegments.length === 1 && keepSegments[0].originalStart === 0) {
    return new Promise((resolve, reject) => {
      ffmpeg(video.sourcePath)
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err))
        .run();
    });
  }

  const outputOptions = [
    '-map',
    `[${concatOutV}]`,
    ...(audioPresent ? ['-map', `[${concatOutA}]`] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    ...(audioPresent ? ['-c:a', 'aac'] : []),
    '-movflags',
    '+faststart',
  ];

  return new Promise((resolve, reject) => {
    ffmpeg(video.sourcePath)
      .complexFilter(filters)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}
