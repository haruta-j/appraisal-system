import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  },

  paths: {
    root: ROOT,
    data: DATA_DIR,
    db: path.join(DATA_DIR, 'app.db'),
    sources: path.join(DATA_DIR, 'sources'),
    frames: path.join(DATA_DIR, 'frames'),
    previews: path.join(DATA_DIR, 'previews'),
    processed: path.join(DATA_DIR, 'processed'),
    tokens: path.join(DATA_DIR, 'tokens', 'youtube-token.json'),
    faceApiModels: path.join(ROOT, 'models', 'face-api'),
  },

  detection: {
    sampleIntervalSec: parseFloat(process.env.DETECTION_SAMPLE_INTERVAL_SEC || '0.3'),
    mergeGapSec: parseFloat(process.env.DETECTION_MERGE_GAP_SEC || '1.0'),
    minConfidence: parseFloat(process.env.DETECTION_MIN_CONFIDENCE || '0.5'),
  },
};
