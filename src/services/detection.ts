import fs from 'fs';
import path from 'path';
import * as faceapi from '@vladmandic/face-api';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as tf from '@tensorflow/tfjs-node';
import { config } from '../config';
import { extractFrames, cleanupDir } from './ffmpeg';
import { DetectionBox, DetectionSample, DetectionType } from '../types';
import * as jobsDb from '../db/detectionJobs';
import * as candidatesDb from '../db/candidates';
import * as videosDb from '../db/videos';
import { getVideo } from '../db/videos';

let faceModelLoaded = false;
let cocoModel: cocoSsd.ObjectDetection | null = null;

export async function ensureModelsLoaded(): Promise<void> {
  if (!faceModelLoaded) {
    if (!fs.existsSync(config.paths.faceApiModels)) {
      throw new Error(
        `Face detection models not found at ${config.paths.faceApiModels}. Run "npm run download-models" first.`
      );
    }
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(config.paths.faceApiModels);
    faceModelLoaded = true;
  }
  if (!cocoModel) {
    // Person-detection model weights are fetched from TensorFlow Hub on first run and
    // cached in memory for the process lifetime. Only generic pretrained weights are
    // downloaded here -- video content never leaves the machine.
    cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  }
}

export async function detectInFrame(
  framePath: string,
  minConfidence: number
): Promise<DetectionBox[]> {
  const buffer = fs.readFileSync(framePath);
  const decoded = tf.node.decodeImage(buffer, 3) as tf.Tensor3D;
  const boxes: DetectionBox[] = [];

  try {
    const expanded = tf.expandDims(decoded, 0);
    try {
      const faceOptions = new faceapi.SsdMobilenetv1Options({ minConfidence });
      // face-api.js bundles its own copy of tfjs-core; its Tensor type is structurally
      // identical to but nominally distinct from @tensorflow/tfjs-node's, hence the cast.
      const faceResults = await faceapi.detectAllFaces(expanded as unknown as never, faceOptions);
      for (const f of faceResults) {
        boxes.push({
          x: f.box.x,
          y: f.box.y,
          width: f.box.width,
          height: f.box.height,
          type: 'face',
          confidence: f.score,
        });
      }
    } finally {
      tf.dispose(expanded);
    }

    const personResults = await cocoModel!.detect(decoded, 20, minConfidence);
    for (const p of personResults) {
      if (p.class !== 'person') continue;
      const [x, y, width, height] = p.bbox;
      boxes.push({ x, y, width, height, type: 'person', confidence: p.score });
    }
  } finally {
    tf.dispose(decoded);
  }

  return boxes;
}

interface Cluster {
  startTime: number;
  endTime: number;
  maxConfidence: number;
  hasFace: boolean;
  hasPerson: boolean;
  samples: DetectionSample[];
}

function clusterSamples(
  samples: DetectionSample[],
  mergeGapSec: number,
  intervalSec: number
): Cluster[] {
  const withDetections = samples.filter((s) => s.boxes.length > 0);
  const clusters: Cluster[] = [];

  for (const sample of withDetections) {
    const last = clusters[clusters.length - 1];
    if (last && sample.time - last.samples[last.samples.length - 1].time <= mergeGapSec) {
      last.samples.push(sample);
      last.endTime = sample.time + intervalSec / 2;
      last.maxConfidence = Math.max(last.maxConfidence, ...sample.boxes.map((b) => b.confidence));
      last.hasFace = last.hasFace || sample.boxes.some((b) => b.type === 'face');
      last.hasPerson = last.hasPerson || sample.boxes.some((b) => b.type === 'person');
    } else {
      clusters.push({
        startTime: Math.max(0, sample.time - intervalSec / 2),
        endTime: sample.time + intervalSec / 2,
        maxConfidence: Math.max(...sample.boxes.map((b) => b.confidence)),
        hasFace: sample.boxes.some((b) => b.type === 'face'),
        hasPerson: sample.boxes.some((b) => b.type === 'person'),
        samples: [sample],
      });
    }
  }

  return clusters;
}

function detectionTypeOf(cluster: Cluster): DetectionType {
  if (cluster.hasFace && cluster.hasPerson) return 'face+person';
  if (cluster.hasFace) return 'face';
  return 'person';
}

export async function runDetectionJob(jobId: string, videoId: string): Promise<void> {
  const video = getVideo(videoId);
  if (!video) throw new Error('Video not found');

  const frameDir = path.join(config.paths.frames, videoId);

  try {
    await ensureModelsLoaded();
    videosDb.updateVideoStatus(videoId, 'detecting');
    jobsDb.updateDetectionJobProgress(jobId, 1);

    const interval = config.detection.sampleIntervalSec;
    const frames = await extractFrames(video.sourcePath, frameDir, interval, (pct) => {
      // Frame extraction is roughly the first half of the job.
      jobsDb.updateDetectionJobProgress(jobId, Math.round(pct * 0.4));
    });

    const samples: DetectionSample[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const boxes = await detectInFrame(frame.framePath, config.detection.minConfidence);
      samples.push({ time: frame.time, boxes });

      const inferenceProgress = frames.length > 0 ? (i + 1) / frames.length : 1;
      jobsDb.updateDetectionJobProgress(jobId, Math.round(40 + inferenceProgress * 55));
    }

    const clusters = clusterSamples(samples, config.detection.mergeGapSec, interval);
    candidatesDb.replaceCandidatesForVideo(
      videoId,
      clusters.map((c) => ({
        startTime: c.startTime,
        endTime: Math.min(c.endTime, video.durationSec ?? c.endTime),
        maxConfidence: c.maxConfidence,
        detectionType: detectionTypeOf(c),
        samples: c.samples,
      }))
    );

    jobsDb.completeDetectionJob(jobId);
    videosDb.updateVideoStatus(videoId, 'ready_for_review');
  } catch (err) {
    jobsDb.failDetectionJob(jobId, err instanceof Error ? err.message : String(err));
    videosDb.updateVideoStatus(videoId, 'failed');
    throw err;
  } finally {
    cleanupDir(frameDir);
  }
}
