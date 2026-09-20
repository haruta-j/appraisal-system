import { randomUUID } from 'crypto';
import { db } from './connection';
import { DetectionJobRecord, DetectionJobStatus } from '../types';

interface JobRow {
  id: string;
  video_id: string;
  status: DetectionJobStatus;
  progress: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToRecord(row: JobRow): DetectionJobRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    status: row.status,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createDetectionJob(videoId: string): DetectionJobRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO detection_jobs (id, video_id, status, progress, created_at) VALUES (?, ?, 'pending', 0, ?)`
  ).run(id, videoId, now);
  return getDetectionJob(id)!;
}

export function getDetectionJob(id: string): DetectionJobRecord | null {
  const row = db.prepare('SELECT * FROM detection_jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getLatestDetectionJobForVideo(videoId: string): DetectionJobRecord | null {
  const row = db
    .prepare('SELECT * FROM detection_jobs WHERE video_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(videoId) as JobRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateDetectionJobProgress(id: string, progress: number): void {
  const safeProgress = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  db.prepare('UPDATE detection_jobs SET status = ?, progress = ? WHERE id = ?').run(
    'running',
    safeProgress,
    id
  );
}

export function completeDetectionJob(id: string): void {
  db.prepare(
    `UPDATE detection_jobs SET status = 'completed', progress = 100, completed_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
}

export function failDetectionJob(id: string, error: string): void {
  db.prepare(
    `UPDATE detection_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
  ).run(error, new Date().toISOString(), id);
}
