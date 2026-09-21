import { randomUUID } from 'crypto';
import { db } from './connection';
import { EditAction, EditDecisionRecord, EditSource } from '../types';

interface DecisionRow {
  id: string;
  video_id: string;
  candidate_id: string | null;
  source: EditSource;
  start_time: number;
  end_time: number;
  action: EditAction;
  label: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: DecisionRow): EditDecisionRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    candidateId: row.candidate_id,
    source: row.source,
    startTime: row.start_time,
    endTime: row.end_time,
    action: row.action,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertDecisionInput {
  id?: string;
  videoId: string;
  candidateId?: string | null;
  source: EditSource;
  startTime: number;
  endTime: number;
  action: EditAction;
  label?: string | null;
}

function updateExisting(id: string, input: UpsertDecisionInput, now: string): void {
  db.prepare(
    `UPDATE edit_decisions
     SET start_time = ?, end_time = ?, action = ?, label = ?, updated_at = ?
     WHERE id = ?`
  ).run(input.startTime, input.endTime, input.action, input.label ?? null, now, id);
}

export function upsertEditDecision(input: UpsertDecisionInput): EditDecisionRecord {
  const now = new Date().toISOString();

  if (input.id && getEditDecision(input.id)) {
    updateExisting(input.id, input, now);
    return getEditDecision(input.id)!;
  }

  // If this decision is for a candidate that already has a decision, replace it (one decision per candidate).
  if (input.candidateId) {
    const existingForCandidate = db
      .prepare('SELECT id FROM edit_decisions WHERE candidate_id = ?')
      .get(input.candidateId) as { id: string } | undefined;
    if (existingForCandidate) {
      updateExisting(existingForCandidate.id, input, now);
      return getEditDecision(existingForCandidate.id)!;
    }
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO edit_decisions
       (id, video_id, candidate_id, source, start_time, end_time, action, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.videoId,
    input.candidateId ?? null,
    input.source,
    input.startTime,
    input.endTime,
    input.action,
    input.label ?? null,
    now,
    now
  );
  return getEditDecision(id)!;
}

export function getEditDecision(id: string): EditDecisionRecord | null {
  const row = db.prepare('SELECT * FROM edit_decisions WHERE id = ?').get(id) as DecisionRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listEditDecisionsForVideo(videoId: string): EditDecisionRecord[] {
  const rows = db
    .prepare('SELECT * FROM edit_decisions WHERE video_id = ? ORDER BY start_time ASC')
    .all(videoId) as DecisionRow[];
  return rows.map(rowToRecord);
}

export function deleteEditDecision(id: string): void {
  db.prepare('DELETE FROM edit_decisions WHERE id = ?').run(id);
}
