import { Router } from 'express';
import * as youtube from '../services/youtube';

export const authRouter = Router();

authRouter.get('/google', (_req, res) => {
  res.redirect(youtube.getAuthUrl());
});

authRouter.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }
  try {
    await youtube.handleOAuthCallback(code);
    res.redirect('/?auth=success');
  } catch (err) {
    console.error(err);
    res.status(500).send('OAuth exchange failed');
  }
});

authRouter.get('/status', (_req, res) => {
  res.json({ authenticated: youtube.isAuthenticated() });
});

authRouter.post('/logout', (_req, res) => {
  youtube.clearAuth();
  res.json({ ok: true });
});
