import { randomUUID } from 'crypto';
import { db } from './connection';
import {
  EditDecisionRecord,
  EditLogRunRecord,
  EditLogRunStatus,
  TimelineSegmentMapping,
} from '../types';

interface RunRow {
  id: string;
  video_id: string;
  decisions_snapshot_json: string;
  timeline_mapping_json: string;
  output_path: string | null;
  status: EditLogRunStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToRecord(row: RunRow): EditLogRunRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    decisionsSnapshot: JSON.parse(row.decisions_snapshot_json) as EditDecisionRecord[],
    timelineMapping: JSON.parse(row.timeline_mapping_json) as TimelineSegmentMapping[],
    outputPath: row.output_path,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createEditLogRun(
  videoId: string,
  decisionsSnapshot: EditDecisionRecord[]
): EditLogRunRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO edit_log_runs (id, video_id, decisions_snapshot_json, timeline_mapping_json, status, created_at)
     VALUES (?, ?, ?, '[]', 'running', ?)`
  ).run(id, videoId, JSON.stringify(decisionsSnapshot), now);
  return getEditLogRun(id)!;
}

export function getEditLogRun(id: string): EditLogRunRecord | null {
  const row = db.prepare('SELECT * FROM edit_log_runs WHERE id = ?').get(id) as RunRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getLatestEditLogRunForVideo(videoId: string): EditLogRunRecord | null {
  const row = db
    .prepare('SELECT * FROM edit_log_runs WHERE video_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(videoId) as RunRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function completeEditLogRun(
  id: string,
  timelineMapping: TimelineSegmentMapping[],
  outputPath: string
): void {
  db.prepare(
    `UPDATE edit_log_runs SET status = 'completed', timeline_mapping_json = ?, output_path = ?, completed_at = ? WHERE id = ?`
  ).run(JSON.stringify(timelineMapping), outputPath, new Date().toISOString(), id);
}

export function failEditLogRun(id: string, error: string): void {
  db.prepare(
    `UPDATE edit_log_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
  ).run(error, new Date().toISOString(), id);
}
