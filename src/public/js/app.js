(() => {
  'use strict';

  const state = {
    video: null,
    candidates: [],
    decisions: [],
    manualDrafts: [], // unsaved manual ranges: {id, startTime, endTime}
    selectedItem: null, // {key, type, startTime, endTime, candidate?, decision?, draft?}
    loopTimer: null,
    fixedRegion: null, // {x,y,width,height} in native video pixel coords
    dragState: null,
  };

  const el = (id) => document.getElementById(id);
  const mainPlayer = () => el('mainPlayer');

  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = await res.json();
        msg = body.error || msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------- Auth ----------

  async function refreshAuthStatus() {
    const status = el('authStatus');
    try {
      const data = await api('/auth/status');
      if (data.authenticated) {
        status.innerHTML = 'Google連携: 済み <button id="logoutBtn">連携解除</button>';
        el('logoutBtn').addEventListener('click', async () => {
          await api('/auth/logout', { method: 'POST' });
          refreshAuthStatus();
        });
      } else {
        status.innerHTML = '<a href="/auth/google">Googleでログインしてください</a>';
      }
    } catch {
      status.textContent = '認証状態の確認に失敗しました';
    }
  }

  // ---------- Upload ----------

  function setupUpload() {
    el('uploadBtn').addEventListener('click', () => {
      const input = el('videoFileInput');
      if (!input.files || !input.files[0]) return;
      uploadFile(input.files[0]);
    });
  }

  function uploadFile(file) {
    const wrap = el('uploadProgressWrap');
    const bar = el('uploadProgressBar');
    const text = el('uploadProgressText');
    wrap.hidden = false;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        bar.value = pct;
        text.textContent = `${pct}%`;
      }
    };
    xhr.onload = async () => {
      wrap.hidden = true;
      if (xhr.status >= 200 && xhr.status < 300) {
        await loadVideoList();
        const video = JSON.parse(xhr.responseText);
        el('videoSelect').value = video.id;
        selectVideo(video.id);
      } else {
        alert('アップロードに失敗しました');
      }
    };
    xhr.onerror = () => {
      wrap.hidden = true;
      alert('アップロードに失敗しました');
    };
    const form = new FormData();
    form.append('video', file);
    xhr.send(form);
  }

  async function loadVideoList() {
    const videos = await api('/api/videos');
    const select = el('videoSelect');
    select.innerHTML = '<option value="">-- 選択してください --</option>';
    for (const v of videos) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.originalFilename} (${v.status})`;
      select.appendChild(opt);
    }
  }

  // ---------- Video detail / editor ----------

  async function selectVideo(id) {
    if (!id) {
      el('editorSection').hidden = true;
      el('uploadYoutubeSection').hidden = true;
      return;
    }
    const detail = await api(`/api/videos/${id}`);
    state.video = detail.video;
    state.candidates = detail.candidates;
    state.decisions = detail.decisions;
    state.manualDrafts = [];
    state.selectedItem = null;

    el('editorSection').hidden = false;
    mainPlayer().src = `/api/videos/${id}/stream`;

    renderTimeline();
    renderCandidateList();
    el('decisionPanel').hidden = true;

    if (detail.latestDetectionJob && (detail.latestDetectionJob.status === 'pending' || detail.latestDetectionJob.status === 'running')) {
      pollDetectionJob(detail.latestDetectionJob.id);
    }

    if (detail.video.processedPath) {
      showYoutubeSection();
    } else {
      el('uploadYoutubeSection').hidden = true;
    }
  }

  function setupVideoSelect() {
    el('videoSelect').addEventListener('change', (e) => selectVideo(e.target.value));
  }

  // ---------- Detection ----------

  function setupDetection() {
    el('detectBtn').addEventListener('click', async () => {
      if (!state.video) return;
      try {
        const job = await api(`/api/videos/${state.video.id}/detect`, { method: 'POST' });
        pollDetectionJob(job.id);
      } catch (err) {
        alert('解析開始に失敗しました: ' + err.message);
      }
    });
  }

  function pollDetectionJob(jobId) {
    const wrap = el('detectionProgressWrap');
    const bar = el('detectionProgressBar');
    const text = el('detectionProgressText');
    wrap.hidden = false;

    const tick = async () => {
      const job = await api(`/api/videos/${state.video.id}/detect/${jobId}`);
      bar.value = job.progress;
      text.textContent = `${job.status} ${Math.round(job.progress)}%`;

      if (job.status === 'completed') {
        wrap.hidden = true;
        const detail = await api(`/api/videos/${state.video.id}`);
        state.candidates = detail.candidates;
        state.decisions = detail.decisions;
        renderTimeline();
        renderCandidateList();
        return;
      }
      if (job.status === 'failed') {
        wrap.hidden = true;
        alert('解析に失敗しました: ' + (job.error || ''));
        return;
      }
      setTimeout(tick, 1200);
    };
    tick();
  }

  // ---------- Timeline ----------

  function buildTimelineItems() {
    const items = [];
    for (const c of state.candidates) {
      const decision = state.decisions.find((d) => d.candidateId === c.id) || null;
      items.push({
        key: `cand-${c.id}`,
        type: 'candidate',
        candidate: c,
        decision,
        startTime: c.startTime,
        endTime: c.endTime,
      });
    }
    for (const d of state.decisions) {
      if (d.source === 'manual' && !d.candidateId) {
        items.push({
          key: `dec-${d.id}`,
          type: 'manualDecision',
          decision: d,
          startTime: d.startTime,
          endTime: d.endTime,
        });
      }
    }
    for (const m of state.manualDrafts) {
      items.push({
        key: `draft-${m.id}`,
        type: 'manualDraft',
        draft: m,
        startTime: m.startTime,
        endTime: m.endTime,
      });
    }
    items.sort((a, b) => a.startTime - b.startTime);
    return items;
  }

  function actionOf(item) {
    if (item.decision) return item.decision.action;
    return 'undecided';
  }

  function renderTimeline() {
    const container = el('timeline');
    const duration = state.video && state.video.durationSec ? state.video.durationSec : 0;
    container.querySelectorAll('.timeline-marker').forEach((n) => n.remove());
    if (!duration) return;

    const width = container.clientWidth;
    const items = buildTimelineItems();

    for (const item of items) {
      const marker = document.createElement('div');
      marker.className = `timeline-marker ${actionOf(item)}`;
      if (state.selectedItem && state.selectedItem.key === item.key) marker.classList.add('selected');
      const left = (item.startTime / duration) * width;
      const w = Math.max(3, ((item.endTime - item.startTime) / duration) * width);
      marker.style.left = `${left}px`;
      marker.style.width = `${w}px`;
      marker.title = `${fmtTime(item.startTime)} - ${fmtTime(item.endTime)}`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        selectItem(item);
      });
      container.appendChild(marker);
    }
  }

  function setupTimelineDrag() {
    const container = el('timeline');
    let previewEl = null;

    container.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('timeline-marker')) return;
      const rect = container.getBoundingClientRect();
      state.dragState = { startX: e.clientX - rect.left, container: rect };
      previewEl = document.createElement('div');
      previewEl.className = 'timeline-drag-preview';
      container.appendChild(previewEl);
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.dragState || !previewEl) return;
      const rect = state.dragState.container;
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      const left = Math.min(state.dragState.startX, x);
      const w = Math.abs(x - state.dragState.startX);
      previewEl.style.left = `${left}px`;
      previewEl.style.width = `${w}px`;
    });

    window.addEventListener('mouseup', (e) => {
      if (!state.dragState) return;
      const rect = state.dragState.container;
      const duration = state.video && state.video.durationSec ? state.video.durationSec : 0;
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      const startPx = Math.min(state.dragState.startX, x);
      const endPx = Math.max(state.dragState.startX, x);
      state.dragState = null;
      if (previewEl) {
        previewEl.remove();
        previewEl = null;
      }
      if (!duration || rect.width === 0) return;

      const startTime = (startPx / rect.width) * duration;
      const endTime = (endPx / rect.width) * duration;
      if (endTime - startTime < 0.2) return; // treat as a plain click, not a range add

      const draft = { id: `local-${Date.now()}`, startTime, endTime: Math.min(endTime, duration) };
      state.manualDrafts.push(draft);
      renderTimeline();
      renderCandidateList();
      selectItem({ key: `draft-${draft.id}`, type: 'manualDraft', draft, startTime: draft.startTime, endTime: draft.endTime });
    });
  }

  // ---------- Candidate list ----------

  function renderCandidateList() {
    const list = el('candidateList');
    list.innerHTML = '';
    const items = buildTimelineItems();
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'まだ候補がありません。AI解析を実行するか、タイムラインをドラッグして手動で追加してください。';
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      if (state.selectedItem && state.selectedItem.key === item.key) li.classList.add('selected');
      const label = document.createElement('span');
      const sourceLabel = item.type === 'candidate' ? '検出' : '手動';
      label.textContent = `[${sourceLabel}] ${fmtTime(item.startTime)} - ${fmtTime(item.endTime)}`;
      const badge = document.createElement('span');
      const action = actionOf(item);
      badge.className = `badge ${action}`;
      badge.textContent = { undecided: '未確認', keep: 'そのまま', blur: 'ぼかし', cut: 'カット' }[action];
      li.appendChild(label);
      li.appendChild(badge);
      li.addEventListener('click', () => selectItem(item));
      list.appendChild(li);
    }
  }

  // ---------- Decision panel ----------

  function selectItem(item) {
    state.selectedItem = item;
    renderTimeline();
    renderCandidateList();
    openDecisionPanel(item);
  }

  function openDecisionPanel(item) {
    stopLoop();
    const panel = el('decisionPanel');
    panel.hidden = false;
    el('decisionTimeLabel').textContent = `区間: ${fmtTime(item.startTime)} 〜 ${fmtTime(item.endTime)}`;
    el('previewPlayer').hidden = true;
    el('previewStatus').textContent = '';
    state.fixedRegion = item.decision && item.decision.blurRegion ? { ...item.decision.blurRegion } : null;

    const action = item.decision ? item.decision.action : 'keep';
    document.querySelectorAll('input[name=action]').forEach((r) => { r.checked = r.value === action; });
    const blurMode = item.decision && item.decision.blurMode ? item.decision.blurMode : 'tracked';
    document.querySelectorAll('input[name=blurMode]').forEach((r) => { r.checked = r.value === blurMode; });

    el('deleteDecisionBtn').hidden = !item.decision;

    updateActionUI();

    mainPlayer().pause();
    mainPlayer().currentTime = item.startTime;
  }

  function updateActionUI() {
    const action = document.querySelector('input[name=action]:checked').value;
    el('blurOptions').hidden = action !== 'blur';
    el('previewBlurBtn').hidden = action !== 'blur';
    if (action === 'blur') updateBlurModeUI();
  }

  function updateBlurModeUI() {
    const mode = document.querySelector('input[name=blurMode]:checked').value;
    el('fixedRegionEditor').hidden = mode !== 'fixed';
    if (mode === 'fixed') setupRegionCanvas();
  }

  function setupActionRadios() {
    document.querySelectorAll('input[name=action]').forEach((r) => r.addEventListener('change', updateActionUI));
    document.querySelectorAll('input[name=blurMode]').forEach((r) => r.addEventListener('change', updateBlurModeUI));
  }

  // ---------- Loop playback ----------

  function setupLoopControls() {
    el('loopPlayBtn').addEventListener('click', () => {
      if (!state.selectedItem) return;
      const { startTime, endTime } = state.selectedItem;
      const player = mainPlayer();
      player.currentTime = startTime;
      player.play();
      stopLoop();
      state.loopTimer = setInterval(() => {
        if (player.currentTime >= endTime || player.currentTime < startTime) {
          player.currentTime = startTime;
        }
      }, 200);
      el('loopPlayBtn').hidden = true;
      el('stopLoopBtn').hidden = false;
    });
    el('stopLoopBtn').addEventListener('click', stopLoop);
  }

  function stopLoop() {
    if (state.loopTimer) {
      clearInterval(state.loopTimer);
      state.loopTimer = null;
    }
    mainPlayer().pause();
    el('loopPlayBtn').hidden = false;
    el('stopLoopBtn').hidden = true;
  }

  // ---------- Fixed-region canvas ----------

  function setupRegionCanvas() {
    if (!state.video || !state.selectedItem) return;
    const canvas = el('regionCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = state.video.width;
    canvas.height = state.video.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    const player = mainPlayer();
    const midTime = (state.selectedItem.startTime + state.selectedItem.endTime) / 2;

    const draw = () => {
      ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
      if (state.fixedRegion) drawRegionBox(ctx, state.fixedRegion);
    };

    const onSeeked = () => {
      draw();
      player.removeEventListener('seeked', onSeeked);
    };
    player.addEventListener('seeked', onSeeked);
    player.pause();
    player.currentTime = midTime;

    canvas.onmousedown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const startX = (e.clientX - rect.left) * scaleX;
      const startY = (e.clientY - rect.top) * scaleY;

      const onMove = (moveEvt) => {
        const x = (moveEvt.clientX - rect.left) * scaleX;
        const y = (moveEvt.clientY - rect.top) * scaleY;
        state.fixedRegion = {
          x: Math.max(0, Math.min(startX, x)),
          y: Math.max(0, Math.min(startY, y)),
          width: Math.abs(x - startX),
          height: Math.abs(y - startY),
        };
        draw();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    draw();
  }

  function drawRegionBox(ctx, region) {
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.strokeRect(region.x, region.y, region.width, region.height);
    ctx.fillStyle = 'rgba(220,38,38,0.15)';
    ctx.fillRect(region.x, region.y, region.width, region.height);
  }

  // ---------- Preview / Save / Delete ----------

  function currentCandidateId() {
    const item = state.selectedItem;
    if (!item) return null;
    if (item.type === 'candidate') return item.candidate.id;
    if (item.type === 'manualDecision') return item.decision.candidateId || null;
    return null;
  }

  function buildDecisionBody() {
    const item = state.selectedItem;
    const action = document.querySelector('input[name=action]:checked').value;
    const body = {
      id: item.decision ? item.decision.id : undefined,
      candidateId: currentCandidateId(),
      source: item.type === 'candidate' ? 'detected' : 'manual',
      startTime: item.startTime,
      endTime: item.endTime,
      action,
    };
    if (action === 'blur') {
      const blurMode = document.querySelector('input[name=blurMode]:checked').value;
      body.blurMode = blurMode;
      if (blurMode === 'fixed') {
        if (!state.fixedRegion || state.fixedRegion.width < 4 || state.fixedRegion.height < 4) {
          throw new Error('固定ぼかしの範囲を静止画上でドラッグして指定してください');
        }
        body.blurRegion = state.fixedRegion;
      }
    }
    return body;
  }

  function setupPreview() {
    el('previewBlurBtn').addEventListener('click', async () => {
      let body;
      try {
        body = buildDecisionBody();
      } catch (err) {
        alert(err.message);
        return;
      }
      el('previewStatus').textContent = 'プレビュー生成中...';
      try {
        const result = await api(`/api/videos/${state.video.id}/preview-blur`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const player = el('previewPlayer');
        player.src = result.previewUrl;
        player.hidden = false;
        player.play();
        el('previewStatus').textContent = 'ぼかし適用後のプレビューです(処理前の確認用)。';
      } catch (err) {
        el('previewStatus').textContent = '';
        alert('プレビュー生成に失敗しました: ' + err.message);
      }
    });
  }

  function setupSaveDelete() {
    el('saveDecisionBtn').addEventListener('click', async () => {
      let body;
      try {
        body = buildDecisionBody();
      } catch (err) {
        alert(err.message);
        return;
      }
      try {
        const saved = await api(`/api/videos/${state.video.id}/decisions`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const item = state.selectedItem;
        state.decisions = state.decisions.filter((d) => d.id !== saved.id);
        state.decisions.push(saved);
        if (item.type === 'manualDraft') {
          state.manualDrafts = state.manualDrafts.filter((m) => m.id !== item.draft.id);
          state.selectedItem = { key: `dec-${saved.id}`, type: 'manualDecision', decision: saved, startTime: saved.startTime, endTime: saved.endTime };
        } else if (item.type === 'candidate') {
          state.selectedItem = { ...item, decision: saved };
        } else {
          state.selectedItem = { ...item, decision: saved };
        }
        renderTimeline();
        renderCandidateList();
        openDecisionPanel(state.selectedItem);
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
      }
    });

    el('deleteDecisionBtn').addEventListener('click', async () => {
      const item = state.selectedItem;
      if (!item || !item.decision) return;
      await api(`/api/videos/${state.video.id}/decisions/${item.decision.id}`, { method: 'DELETE' });
      state.decisions = state.decisions.filter((d) => d.id !== item.decision.id);
      el('decisionPanel').hidden = true;
      state.selectedItem = null;
      renderTimeline();
      renderCandidateList();
    });
  }

  // ---------- Pipeline ----------

  function setupPipeline() {
    el('runPipelineBtn').addEventListener('click', async () => {
      if (!state.video) return;
      const wrap = el('pipelineProgressWrap');
      wrap.hidden = false;
      el('pipelineStatusText').textContent = '処理を開始しています...';
      try {
        await api(`/api/videos/${state.video.id}/run-pipeline`, { method: 'POST' });
      } catch (err) {
        wrap.hidden = true;
        alert('処理の開始に失敗しました: ' + err.message);
        return;
      }
      pollPipeline();
    });
  }

  function pollPipeline() {
    const wrap = el('pipelineProgressWrap');
    const tick = async () => {
      const run = await api(`/api/videos/${state.video.id}/pipeline-runs/latest`);
      if (!run || run.status === 'running') {
        el('pipelineStatusText').textContent = '処理中...(動画の長さによっては数分かかります)';
        setTimeout(tick, 2000);
        return;
      }
      wrap.hidden = true;
      if (run.status === 'completed') {
        const detail = await api(`/api/videos/${state.video.id}`);
        state.video = detail.video;
        showYoutubeSection();
      } else {
        alert('処理に失敗しました: ' + (run.error || ''));
      }
    };
    tick();
  }

  function showYoutubeSection() {
    el('uploadYoutubeSection').hidden = false;
    el('finalPreviewPlayer').src = `/api/videos/${state.video.id}/processed`;
    el('ytTitle').value = state.video.originalFilename.replace(/\.[^.]+$/, '');
  }

  // ---------- YouTube upload ----------

  function setupYoutubeUpload() {
    el('uploadYoutubeBtn').addEventListener('click', async () => {
      const title = el('ytTitle').value.trim();
      if (!title) {
        alert('タイトルを入力してください');
        return;
      }
      const body = {
        title,
        description: el('ytDescription').value,
        tags: el('ytTags').value.split(',').map((t) => t.trim()).filter(Boolean),
        privacyStatus: el('ytPrivacy').value,
      };
      try {
        await api(`/api/videos/${state.video.id}/upload-youtube`, { method: 'POST', body: JSON.stringify(body) });
        pollYoutubeUpload();
      } catch (err) {
        alert('アップロード開始に失敗しました: ' + err.message);
      }
    });
  }

  function pollYoutubeUpload() {
    const statusEl = el('ytUploadStatus');
    const tick = async () => {
      const data = await api(`/api/videos/${state.video.id}/upload-status`);
      if (data.status === 'uploading_to_youtube') {
        statusEl.textContent = 'アップロード中...';
        setTimeout(tick, 2000);
        return;
      }
      if (data.status === 'uploaded_to_youtube') {
        statusEl.innerHTML = `アップロード完了: <a href="https://www.youtube.com/watch?v=${data.youtubeVideoId}" target="_blank">動画を見る</a>`;
        return;
      }
      statusEl.textContent = 'アップロードに失敗しました';
    };
    tick();
  }

  // ---------- Init ----------

  function init() {
    refreshAuthStatus();
    setupUpload();
    setupVideoSelect();
    setupDetection();
    setupTimelineDrag();
    setupActionRadios();
    setupLoopControls();
    setupPreview();
    setupSaveDelete();
    setupPipeline();
    setupYoutubeUpload();
    loadVideoList();

    if (new URLSearchParams(location.search).get('auth') === 'success') {
      history.replaceState(null, '', location.pathname);
    }
    window.addEventListener('resize', renderTimeline);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
