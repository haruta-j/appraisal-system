import fs from 'fs';
import Database from 'better-sqlite3';
import { config } from '../config';

fs.mkdirSync(config.paths.data, { recursive: true });

export const db = new Database(config.paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  source_path TEXT NOT NULL,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  processed_path TEXT,
  youtube_video_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS detection_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_detection_jobs_video ON detection_jobs(video_id);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  max_confidence REAL NOT NULL,
  detection_type TEXT NOT NULL,
  samples_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_video ON candidates(video_id);

CREATE TABLE IF NOT EXISTS edit_decisions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  action TEXT NOT NULL,
  blur_mode TEXT,
  blur_region_json TEXT,
  tracked_samples_json TEXT,
  label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edit_decisions_video ON edit_decisions(video_id);

CREATE TABLE IF NOT EXISTS edit_log_runs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  decisions_snapshot_json TEXT NOT NULL,
  timeline_mapping_json TEXT NOT NULL DEFAULT '[]',
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_edit_log_runs_video ON edit_log_runs(video_id);
`);
