import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import { config } from '../config';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function createOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

function loadStoredTokens(): Credentials | null {
  if (!fs.existsSync(config.paths.tokens)) return null;
  try {
    return JSON.parse(fs.readFileSync(config.paths.tokens, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens: Credentials): void {
  fs.mkdirSync(path.dirname(config.paths.tokens), { recursive: true });
  fs.writeFileSync(config.paths.tokens, JSON.stringify(tokens, null, 2));
}

export function isAuthenticated(): boolean {
  return loadStoredTokens() !== null;
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(code: string): Promise<void> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  saveTokens(tokens);
}

export function clearAuth(): void {
  if (fs.existsSync(config.paths.tokens)) {
    fs.unlinkSync(config.paths.tokens);
  }
}

async function getAuthorizedClient() {
  const tokens = loadStoredTokens();
  if (!tokens) {
    throw new Error('Not authenticated with Google. Visit /auth/google first.');
  }
  const client = createOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    saveTokens({ ...tokens, ...newTokens });
  });
  return client;
}

export interface UploadVideoInput {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'public' | 'unlisted' | 'private';
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}

export interface UploadVideoResult {
  videoId: string;
  url: string;
}

export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoResult> {
  const auth = await getAuthorizedClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const totalBytes = fs.statSync(input.filePath).size;

  const res = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: input.title,
          description: input.description,
          tags: input.tags,
        },
        status: {
          privacyStatus: input.privacyStatus,
        },
      },
      media: {
        body: fs.createReadStream(input.filePath),
      },
    },
    {
      onUploadProgress: (evt) => {
        if (input.onProgress) input.onProgress(evt.bytesRead, totalBytes);
      },
    }
  );

  const videoId = res.data.id;
  if (!videoId) {
    throw new Error('YouTube API did not return a video id');
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
