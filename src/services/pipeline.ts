import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config';
import { hasAudioStream } from './ffmpeg';
import { buildBlurFilterComplex, BlurFilterInput } from './blurFilter';
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
  if (!video.durationSec || !video.width || !video.height) {
    throw new Error('Video metadata incomplete; cannot run pipeline');
  }

  const decisions = decisionsDb.listEditDecisionsForVideo(videoId);
  const run = runsDb.createEditLogRun(videoId, decisions);
  videosDb.updateVideoStatus(videoId, 'processing');

  try {
    const outputPath = await applyEdits(video, decisions, video.durationSec);

    const cuts = mergeCutIntervals(decisions, video.durationSec);
    const keepSegments = computeKeepSegments(cuts, video.durationSec);
    const timelineMapping = computeTimelineMapping(keepSegments);

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

async function applyEdits(
  video: VideoRecord,
  decisions: EditDecisionRecord[],
  duration: number
): Promise<string> {
  const blurDecisions: BlurFilterInput[] = decisions
    .filter((d) => d.action === 'blur' && d.blurMode)
    .map((d) => ({
      startTime: d.startTime,
      endTime: d.endTime,
      blurMode: d.blurMode!,
      blurRegion: d.blurRegion,
      trackedSamples: d.trackedSamples,
    }));

  const audioPresent = await hasAudioStream(video.sourcePath);
  const cuts = mergeCutIntervals(decisions, duration);
  const keepSegments = computeKeepSegments(cuts, duration);

  if (keepSegments.length === 0) {
    throw new Error('All content is cut; nothing left to produce');
  }

  const filters: string[] = [];
  let videoLabel = '0:v';
  if (blurDecisions.length > 0) {
    const built = buildBlurFilterComplex('0:v', blurDecisions, video.width!, video.height!);
    filters.push(...built.filters);
    videoLabel = built.outputLabel;
  }

  // A filtergraph pad (as opposed to a raw input stream reference like "0:v") can only be
  // consumed once; explicitly fan it out before feeding it into multiple trim filters.
  let perSegmentVideoLabels: string[];
  if (keepSegments.length === 1) {
    perSegmentVideoLabels = [videoLabel];
  } else {
    perSegmentVideoLabels = keepSegments.map((_, idx) => `vsplit${idx}`);
    filters.push(
      `[${videoLabel}]split=${keepSegments.length}${perSegmentVideoLabels.map((l) => `[${l}]`).join('')}`
    );
  }

  const videoSegLabels: string[] = [];
  const audioSegLabels: string[] = [];

  keepSegments.forEach((seg, idx) => {
    const vLabel = `vseg${idx}`;
    filters.push(
      `[${perSegmentVideoLabels[idx]}]trim=${seg.originalStart.toFixed(3)}:${seg.originalEnd.toFixed(3)},setpts=PTS-STARTPTS[${vLabel}]`
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
