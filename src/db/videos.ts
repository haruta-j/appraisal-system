import { randomUUID } from 'crypto';
import { db } from './connection';
import { VideoRecord, VideoStatus } from '../types';

interface VideoRow {
  id: string;
  original_filename: string;
  source_path: string;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  status: VideoStatus;
  processed_path: string | null;
  youtube_video_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    sourcePath: row.source_path,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    fps: row.fps,
    status: row.status,
    processedPath: row.processed_path,
    youtubeVideoId: row.youtube_video_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createVideo(input: {
  originalFilename: string;
  sourcePath: string;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
}): VideoRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO videos (id, original_filename, source_path, duration_sec, width, height, fps, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`
  ).run(
    id,
    input.originalFilename,
    input.sourcePath,
    input.durationSec ?? null,
    input.width ?? null,
    input.height ?? null,
    input.fps ?? null,
    now,
    now
  );
  return getVideo(id)!;
}

export function getVideo(id: string): VideoRecord | null {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listVideos(): VideoRecord[] {
  const rows = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as VideoRow[];
  return rows.map(rowToRecord);
}

export function updateVideoStatus(id: string, status: VideoStatus): void {
  db.prepare('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    id
  );
}

export function updateVideoMetadata(
  id: string,
  fields: Partial<Pick<VideoRecord, 'durationSec' | 'width' | 'height' | 'fps'>>
): void {
  const current = getVideo(id);
  if (!current) return;
  db.prepare(
    `UPDATE videos SET duration_sec = ?, width = ?, height = ?, fps = ?, updated_at = ? WHERE id = ?`
  ).run(
    fields.durationSec ?? current.durationSec,
    fields.width ?? current.width,
    fields.height ?? current.height,
    fields.fps ?? current.fps,
    new Date().toISOString(),
    id
  );
}

export function setVideoProcessedPath(id: string, processedPath: string): void {
  db.prepare('UPDATE videos SET processed_path = ?, updated_at = ? WHERE id = ?').run(
    processedPath,
    new Date().toISOString(),
    id
  );
}

export function setVideoYoutubeId(id: string, youtubeVideoId: string): void {
  db.prepare('UPDATE videos SET youtube_video_id = ?, updated_at = ? WHERE id = ?').run(
    youtubeVideoId,
    new Date().toISOString(),
    id
  );
}
