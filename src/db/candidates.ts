import { randomUUID } from 'crypto';
import { db } from './connection';
import { CandidateRecord, DetectionSample, DetectionType } from '../types';

interface CandidateRow {
  id: string;
  video_id: string;
  start_time: number;
  end_time: number;
  max_confidence: number;
  detection_type: DetectionType;
  samples_json: string;
  created_at: string;
}

function rowToRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    startTime: row.start_time,
    endTime: row.end_time,
    maxConfidence: row.max_confidence,
    detectionType: row.detection_type,
    samples: JSON.parse(row.samples_json) as DetectionSample[],
    createdAt: row.created_at,
  };
}

export function replaceCandidatesForVideo(
  videoId: string,
  candidates: Array<{
    startTime: number;
    endTime: number;
    maxConfidence: number;
    detectionType: DetectionType;
    samples: DetectionSample[];
  }>
): CandidateRecord[] {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO candidates (id, video_id, start_time, end_time, max_confidence, detection_type, samples_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM candidates WHERE video_id = ?').run(videoId);
    for (const c of candidates) {
      insert.run(
        randomUUID(),
        videoId,
        c.startTime,
        c.endTime,
        c.maxConfidence,
        c.detectionType,
        JSON.stringify(c.samples),
        now
      );
    }
  });
  tx();
  return listCandidatesForVideo(videoId);
}

export function listCandidatesForVideo(videoId: string): CandidateRecord[] {
  const rows = db
    .prepare('SELECT * FROM candidates WHERE video_id = ? ORDER BY start_time ASC')
    .all(videoId) as CandidateRow[];
  return rows.map(rowToRecord);
}

export function getCandidate(id: string): CandidateRecord | null {
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as CandidateRow | undefined;
  return row ? rowToRecord(row) : null;
}
