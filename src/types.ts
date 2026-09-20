export type VideoStatus =
  | 'uploaded'
  | 'detecting'
  | 'ready_for_review'
  | 'processing'
  | 'ready_to_upload'
  | 'uploading_to_youtube'
  | 'uploaded_to_youtube'
  | 'failed';

export interface VideoRecord {
  id: string;
  originalFilename: string;
  sourcePath: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  status: VideoStatus;
  processedPath: string | null;
  youtubeVideoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DetectionJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DetectionJobRecord {
  id: string;
  videoId: string;
  status: DetectionJobStatus;
  progress: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type DetectionType = 'face' | 'person' | 'face+person';

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'face' | 'person';
  confidence: number;
}

export interface DetectionSample {
  time: number;
  boxes: DetectionBox[];
}

export interface CandidateRecord {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  maxConfidence: number;
  detectionType: DetectionType;
  samples: DetectionSample[];
  createdAt: string;
}

export type EditSource = 'detected' | 'manual';
export type EditAction = 'cut' | 'blur' | 'keep';
export type BlurMode = 'tracked' | 'fixed';

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditDecisionRecord {
  id: string;
  videoId: string;
  candidateId: string | null;
  source: EditSource;
  startTime: number;
  endTime: number;
  action: EditAction;
  blurMode: BlurMode | null;
  blurRegion: BlurRegion | null;
  /** Per-time bounding boxes used to build the "tracked" blur filter. Populated from the
   *  linked candidate's detections, or from an on-demand detection pass for manual intervals. */
  trackedSamples: DetectionSample[] | null;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineSegmentMapping {
  originalStart: number;
  originalEnd: number;
  editedStart: number;
  editedEnd: number;
}

export type EditLogRunStatus = 'running' | 'completed' | 'failed';

export interface EditLogRunRecord {
  id: string;
  videoId: string;
  decisionsSnapshot: EditDecisionRecord[];
  timelineMapping: TimelineSegmentMapping[];
  outputPath: string | null;
  status: EditLogRunStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
