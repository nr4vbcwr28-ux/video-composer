(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const video = $('#sourceVideo');
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = $('#stage');

  const state = {
    file: null, url: '', duration: 0, step: 0, trimStart: 0, trimEnd: 0,
    mode: 'off', ratio: 'original', zoom: 1, offsetX: 0, offsetY: 0,
    text: '', textSize: 48, textColor: '#ffffff', textX: .5, textY: .82,
    quality: 'social', preset: 'reels', audio: 'keep', corrections: [], stabilizationScale: 1,
    exporting: false, cancelExport: false, outputUrl: ''
  };

  const ratioValues = {
    original: null, '1:1': 1, '4:5': 4 / 5, '5:4': 5 / 4, '3:2': 3 / 2,
    '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '65:24': 65 / 24,
    '4:3': 4 / 3, '3:4': 3 / 4
  };
  const presetRatios = { reels: '9:16', feed: '4:5', square: '1:1', youtube: '16:9', shorts: '9:16' };

  const formatTime = (seconds, precise = false) => {
    const value = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(value / 60);
    const secs = precise ? (value % 60).toFixed(2).padStart(5, '0') : Math.floor(value % 60).toString().padStart(2, '0');
    return `${String(mins).padStart(2, '0')}:${secs}`;
  };
  const parseTime = value => {
    const parts = String(value).trim().split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : Number(value);
  };
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const seek = time => new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < .015) return resolve();
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not read this frame.')); };
    const cleanup = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = Math.max(0, Math.min(time, state.duration));
  });
  let toastTimer;
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function currentRatio() {
    return ratioValues[state.ratio] || (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9);
  }

  function buildRatios() {
    const grid = $('#ratioGrid');
    Object.keys(ratioValues).forEach((ratio, index) => {
      const button = document.createElement('button');
      button.textContent = ratio === 'original' ? 'Original' : ratio;
      button.dataset.ratio = ratio;
      if (index === 0) button.classList.add('selected');
      button.addEventListener('click', () => {
        state.ratio = ratio; state.offsetX = 0; state.offsetY = 0;
        $$('.ratio-grid button').forEach(b => b.classList.toggle('selected', b === button));
        resizePreview(); updateOutput(); drawPreview();
      });
      grid.append(button);
    });
  }

  function setStep(step) {
    if (!state.file && step > 0) return;
    state.step = step;
    $$('.step').forEach((el, i) => el.classList.toggle('active', i === step));
    $$('.panel-page').forEach((el, i) => el.classList.toggle('active', i === step));
    $('#backButton').disabled = step === 0;
    $('#nextButton').disabled = !state.file || step === 5;
    $('#nextButton').innerHTML = step === 4 ? 'Review export <span>→</span>' : 'Continue <span>→</span>';
    if (step === 5) updateOutput();
    requestAnimationFrame(() => { resizePreview(); drawPreview(); });
  }

  async function importFile(file) {
    if (!file || !file.type.startsWith('video/') && !/\.(mp4|mov)$/i.test(file.name)) return toast('Please choose an MP4 or MOV video.');
    video.pause();
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file); video.src = state.url; video.load();
    try {
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('This browser cannot decode the selected video.')), { once: true });
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('The video duration could not be read.');
      if (video.duration > 60.05) throw new Error('V1 accepts videos up to 60 seconds. Trim the source clip first.');
    } catch (error) {
      state.file = null; video.removeAttribute('src'); video.load(); toast(error.message); return;
    }
    state.file = file; state.duration = video.duration; state.trimStart = 0; state.trimEnd = video.duration;
    state.corrections = []; state.stabilizationScale = 1; state.offsetX = 0; state.offsetY = 0; state.zoom = 1;
    $('#zoomRange').value = 1; $('#zoomOutput').value = '100%';
    $('#fileName').textContent = file.name;
    $('#fileMeta').textContent = `${video.videoWidth}×${video.videoHeight} · ${formatTime(video.duration)} · ${(file.size / 1048576).toFixed(1)} MB`;
    $('#fileCard').classList.remove('hidden'); stage.classList.add('has-video'); $('#transport').classList.remove('hidden');
    $$('.step').forEach(el => el.disabled = false);
    configureTrim(); setStep(1); await seek(0); drawPreview();
    toast('Video loaded locally. Nothing was uploaded.');
  }

  function configureTrim() {
    for (const id of ['trimStart', 'trimEnd', 'scrubber']) {
      const input = $('#' + id); input.max = state.duration; input.step = .04;
    }
    $('#trimStart').value = 0; $('#trimEnd').value = state.duration; $('#scrubber').value = 0;
    updateTrimUI();
  }
  function updateTrimUI() {
    const start = state.trimStart, end = state.trimEnd, duration = state.duration || 1;
    $('#trimFill').style.left = `${start / duration * 100}%`;
    $('#trimFill').style.right = `${100 - end / duration * 100}%`;
    $('#startTime').value = formatTime(start, true); $('#endTime').value = formatTime(end, true);
    $('#selectedDuration').textContent = `${(end - start).toFixed(1)} sec`;
    $('#scrubber').min = start; $('#scrubber').max = end;
    updateTimeDisplay();
  }
  function changeTrim(which, raw) {
    let value = Math.max(0, Math.min(state.duration, Number(raw) || 0));
    if (which === 'start') state.trimStart = Math.min(value, state.trimEnd - .2);
    else state.trimEnd = Math.max(value, state.trimStart + .2);
    state.corrections = []; state.stabilizationScale = 1; video.currentTime = which === 'start' ? state.trimStart : state.trimEnd;
    updateTrimUI(); drawPreview();
  }

  function resizePreview() {
    if (!state.file) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function viewportFor(targetCanvas, ratio = currentRatio()) {
    const cw = targetCanvas.width, ch = targetCanvas.height, outer = cw / ch;
    if (outer > ratio) { const h = ch; const w = h * ratio; return { x: (cw - w) / 2, y: 0, w, h }; }
    const w = cw, h = w / ratio; return { x: 0, y: (ch - h) / 2, w, h };
  }
  function correctionAt(time) {
    if (state.mode === 'off' || !state.corrections.length) return { x: 0, y: 0, angle: 0, scale: 1 };
    let right = state.corrections.findIndex(item => item.t >= time);
    if (right <= 0) return state.corrections[Math.max(0, right)] || { x: 0, y: 0 };
    if (right < 0) return state.corrections[state.corrections.length - 1];
    const a = state.corrections[right - 1], b = state.corrections[right];
    const mix = (time - a.t) / Math.max(.001, b.t - a.t);
    return {
      x: a.x + (b.x - a.x) * mix,
      y: a.y + (b.y - a.y) * mix,
      angle: (a.angle || 0) + ((b.angle || 0) - (a.angle || 0)) * mix,
      scale: (a.scale || 1) + ((b.scale || 1) - (a.scale || 1)) * mix
    };
  }
  function drawFrame(target, targetRatio = currentRatio()) {
    if (!state.file || video.readyState < 2) return;
    const c = target.getContext('2d', { alpha: false });
    const view = target === canvas ? viewportFor(target, targetRatio) : { x: 0, y: 0, w: target.width, h: target.height };
    c.fillStyle = '#171715'; c.fillRect(0, 0, target.width, target.height);
    c.save(); c.beginPath(); c.rect(view.x, view.y, view.w, view.h); c.clip();
    const sourceRatio = video.videoWidth / video.videoHeight;
    let baseW, baseH;
    if (sourceRatio > targetRatio) { baseH = view.h; baseW = baseH * sourceRatio; }
    else { baseW = view.w; baseH = baseW / sourceRatio; }
    const stabilizationScale = state.mode === 'off' ? 1 : state.stabilizationScale;
    const drawW = baseW * state.zoom * stabilizationScale, drawH = baseH * state.zoom * stabilizationScale;
    const maxX = Math.max(0, (drawW - view.w) / 2), maxY = Math.max(0, (drawH - view.h) / 2);
    const motion = correctionAt(video.currentTime);
    const cropX = state.offsetX * maxX;
    const cropY = state.offsetY * maxY;
    const stabilizeX = motion.x * drawW;
    const stabilizeY = motion.y * drawH;
    const centerX = view.x + view.w / 2 + cropX + stabilizeX;
    const centerY = view.y + view.h / 2 + cropY + stabilizeY;
    c.save();
    c.translate(centerX, centerY);
    c.rotate(motion.angle || 0);
    c.scale(motion.scale || 1, motion.scale || 1);
    c.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
    c.restore();
    if (state.text.trim()) {
      const scale = view.w / 1080;
      const fontSize = Math.max(12, state.textSize * scale);
      c.font = `700 ${fontSize}px Inter, -apple-system, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = Math.max(2, fontSize * .08);
      c.strokeStyle = state.textColor === '#ffffff' ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.32)';
      const tx = view.x + state.textX * view.w, ty = view.y + state.textY * view.h;
      c.strokeText(state.text, tx, ty, view.w * .9); c.fillStyle = state.textColor; c.fillText(state.text, tx, ty, view.w * .9);
    }
    c.restore();
    if (target === canvas) { c.strokeStyle = 'rgba(255,255,255,.17)'; c.lineWidth = 1; c.strokeRect(view.x + .5, view.y + .5, view.w - 1, view.h - 1); }
  }
  function drawPreview() { drawFrame(canvas); }
  function animatePreview() {
    if (!video.paused && !state.exporting) {
      if (video.currentTime >= state.trimEnd) { video.currentTime = state.trimStart; }
      drawPreview(); updateTimeDisplay(); requestAnimationFrame(animatePreview);
    }
  }
  function updateTimeDisplay() { $('#timeDisplay').textContent = `${formatTime(video.currentTime)} / ${formatTime(state.trimEnd)}`; $('#scrubber').value = Math.min(state.trimEnd, Math.max(state.trimStart, video.currentTime || 0)); }

  let openCvPromise;
  function loadOpenCV() {
    if (window.cv && window.cv.Mat) return Promise.resolve(window.cv);
    if (openCvPromise) return openCvPromise;
    openCvPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './opencv.js'; script.async = true;
      script.onerror = () => reject(new Error('OpenCV could not load.'));
      script.onload = () => {
        if (!window.cv) return reject(new Error('OpenCV did not initialize.'));
        if (window.cv.Mat) return resolve(window.cv);
        if (typeof window.cv.then === 'function') return window.cv.then(resolve);
        window.cv.onRuntimeInitialized = () => resolve(window.cv);
      };
      document.head.append(script);
    });
    return openCvPromise;
  }

  function identitySimilarity() { return { a: 1, b: 0, tx: 0, ty: 0 }; }
  function composeSimilarity(next, previous) {
    return {
      a: next.a * previous.a - next.b * previous.b,
      b: next.b * previous.a + next.a * previous.b,
      tx: next.a * previous.tx - next.b * previous.ty + next.tx,
      ty: next.b * previous.tx + next.a * previous.ty + next.ty
    };
  }
  function similarityFromPair(one, two) {
    const px = two.px - one.px, py = two.py - one.py;
    const qx = two.qx - one.qx, qy = two.qy - one.qy;
    const denominator = px * px + py * py;
    if (denominator < 64) return null;
    const a = (px * qx + py * qy) / denominator;
    const b = (px * qy - py * qx) / denominator;
    return { a, b, tx: one.qx - a * one.px + b * one.py, ty: one.qy - b * one.px - a * one.py };
  }
  function refineSimilarity(matches) {
    if (matches.length < 2) return null;
    const count = matches.length;
    const center = matches.reduce((sum, item) => ({ px: sum.px + item.px, py: sum.py + item.py, qx: sum.qx + item.qx, qy: sum.qy + item.qy }), { px: 0, py: 0, qx: 0, qy: 0 });
    Object.keys(center).forEach(key => { center[key] /= count; });
    let numeratorA = 0, numeratorB = 0, denominator = 0;
    for (const item of matches) {
      const px = item.px - center.px, py = item.py - center.py;
      const qx = item.qx - center.qx, qy = item.qy - center.qy;
      numeratorA += px * qx + py * qy;
      numeratorB += px * qy - py * qx;
      denominator += px * px + py * py;
    }
    if (denominator < 1) return null;
    const a = numeratorA / denominator, b = numeratorB / denominator;
    return { a, b, tx: center.qx - a * center.px + b * center.py, ty: center.qy - b * center.px - a * center.py };
  }
  function estimateSimilarityRansac(matches) {
    if (matches.length < 8) return null;
    let best = [], seed = matches.length * 2654435761;
    for (let attempt = 0; attempt < Math.min(140, matches.length * 6); attempt++) {
      seed = (seed * 1664525 + 1013904223) >>> 0; const first = seed % matches.length;
      seed = (seed * 1664525 + 1013904223) >>> 0; const second = seed % matches.length;
      if (first === second) continue;
      const model = similarityFromPair(matches[first], matches[second]);
      if (!model) continue;
      const inliers = matches.filter(item => {
        const x = model.a * item.px - model.b * item.py + model.tx;
        const y = model.b * item.px + model.a * item.py + model.ty;
        return Math.hypot(x - item.qx, y - item.qy) <= 2.4;
      });
      if (inliers.length > best.length) best = inliers;
    }
    if (best.length < Math.max(7, matches.length * .35)) return null;
    const model = refineSimilarity(best);
    if (!model) return null;
    const scale = Math.hypot(model.a, model.b), angle = Math.atan2(model.b, model.a);
    if (scale < .92 || scale > 1.08 || Math.abs(angle) > .12) return null;
    return { ...model, inliers: best.length };
  }
  function poseComponents(transform, width, height, time) {
    const cx = width / 2, cy = height / 2;
    const movedX = transform.a * cx - transform.b * cy + transform.tx;
    const movedY = transform.b * cx + transform.a * cy + transform.ty;
    return {
      t: time,
      x: (movedX - cx) / width,
      y: (movedY - cy) / height,
      angle: Math.atan2(transform.b, transform.a),
      logScale: Math.log(Math.max(.001, Math.hypot(transform.a, transform.b)))
    };
  }
  function smoothPath(path, index, radius) {
    let x = 0, y = 0, angle = 0, logScale = 0, weightTotal = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(path.length - 1, index + radius); i++) {
      const distance = Math.abs(i - index), weight = radius + 1 - distance;
      x += path[i].x * weight; y += path[i].y * weight; angle += path[i].angle * weight; logScale += path[i].logScale * weight; weightTotal += weight;
    }
    return { x: x / weightTotal, y: y / weightTotal, angle: angle / weightTotal, logScale: logScale / weightTotal };
  }
  function opticalFlowMatches(cv, previous, current) {
    const points = new cv.Mat(), next = new cv.Mat(), back = new cv.Mat();
    const status = new cv.Mat(), errors = new cv.Mat(), backStatus = new cv.Mat(), backErrors = new cv.Mat(), mask = new cv.Mat();
    try {
      cv.goodFeaturesToTrack(previous, points, 180, .01, 8, mask, 7, false, .04);
      if (points.rows < 8) return [];
      const windowSize = new cv.Size(21, 21);
      const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 30, .01);
      cv.calcOpticalFlowPyrLK(previous, current, points, next, status, errors, windowSize, 3, criteria);
      cv.calcOpticalFlowPyrLK(current, previous, next, back, backStatus, backErrors, windowSize, 3, criteria);
      const matches = [];
      for (let i = 0; i < points.rows; i++) {
        if (!status.data[i] || !backStatus.data[i] || errors.data32F[i] > 35) continue;
        const px = points.data32F[i * 2], py = points.data32F[i * 2 + 1];
        const qx = next.data32F[i * 2], qy = next.data32F[i * 2 + 1];
        const bx = back.data32F[i * 2], by = back.data32F[i * 2 + 1];
        if (Math.hypot(px - bx, py - by) <= 1.6) matches.push({ px, py, qx, qy });
      }
      return matches;
    } finally { points.delete(); next.delete(); back.delete(); status.delete(); errors.delete(); backStatus.delete(); backErrors.delete(); mask.delete(); }
  }

  async function analyzeMotion() {
    if (!state.file || state.mode === 'off') return;
    const button = $('#analyzeButton'), progress = $('#analysisProgress');
    button.disabled = true; button.textContent = 'Loading optical-flow engine…'; progress.classList.remove('hidden'); video.pause();
    let previousGray = null;
    try {
      const cv = await loadOpenCV();
      const proxy = document.createElement('canvas'); proxy.width = 320; proxy.height = Math.max(180, Math.round(320 * video.videoHeight / video.videoWidth));
      const pctx = proxy.getContext('2d', { willReadFrequently: true });
      const length = state.trimEnd - state.trimStart;
      const count = Math.max(16, Math.min(360, Math.ceil(length * 6) + 1));
      const path = [], identity = identitySimilarity(); let pose = identity, trackedSamples = 0, inlierTotal = 0;
      for (let i = 0; i < count; i++) {
        const t = state.trimStart + length * i / Math.max(1, count - 1);
        await seek(t); pctx.drawImage(video, 0, 0, proxy.width, proxy.height);
        const rgba = cv.matFromImageData(pctx.getImageData(0, 0, proxy.width, proxy.height));
        const gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY); rgba.delete();
        if (previousGray) {
          const matches = opticalFlowMatches(cv, previousGray, gray);
          const motion = estimateSimilarityRansac(matches);
          if (motion) {
            const centerMotion = poseComponents(motion, proxy.width, proxy.height, t);
            if (Math.hypot(centerMotion.x, centerMotion.y) < .14) { pose = composeSimilarity(motion, pose); trackedSamples++; inlierTotal += motion.inliers; }
          }
          previousGray.delete();
        }
        previousGray = gray;
        path.push(poseComponents(pose, proxy.width, proxy.height, t));
        button.textContent = `Optical-flow analysis… ${Math.round((i + 1) / count * 100)}%`;
        await wait(0);
      }
      const limit = state.mode === 'lock' ? .14 : .09;
      state.corrections = path.map((point, i) => {
        const target = state.mode === 'lock' ? { x: 0, y: 0, angle: 0, logScale: 0 } : smoothPath(path, i, 10);
        const x = Math.max(-limit, Math.min(limit, target.x - point.x));
        const y = Math.max(-limit, Math.min(limit, target.y - point.y));
        const angle = Math.max(-.16, Math.min(.16, target.angle - point.angle));
        const scale = Math.max(.88, Math.min(1.14, Math.exp(target.logScale - point.logScale)));
        return { t: point.t, x, y, angle, scale };
      });
      const guard = state.corrections.reduce((max, item) => Math.max(max, Math.abs(item.x) * 2.2, Math.abs(item.y) * 2.2, Math.abs(item.angle) * .8, Math.abs(1 - item.scale)), 0);
      state.stabilizationScale = Math.max(1.05, Math.min(1.35, 1 + guard));
      const averageInliers = trackedSamples ? Math.round(inlierTotal / trackedSamples) : 0;
      $('#stabilizeText').textContent = `Similarity tracking: ${trackedSamples} frames · ${averageInliers} RANSAC inliers/frame · ${Math.round((state.stabilizationScale - 1) * 100)}% crop guard.`;
      await seek(state.trimStart); drawPreview(); toast('Optical-flow stabilization complete.');
    } catch (error) {
      console.error(error); toast('Optical-flow analysis failed in this browser.'); state.corrections = []; state.stabilizationScale = 1;
    } finally {
      if (previousGray) previousGray.delete();
      button.disabled = false; button.textContent = 'Analyze again'; progress.classList.add('hidden');
    }
  }

  function outputSpec() {
    let ratioName = state.preset === 'current' ? state.ratio : presetRatios[state.preset];
    let ratio = ratioValues[ratioName] || currentRatio();
    if (state.quality === '4k') {
      return ratio >= 1 ? { w: 3840, h: even(3840 / ratio), ratio } : { w: even(3840 * ratio), h: 3840, ratio };
    }
    const fixed = { reels:[1080,1920], feed:[1080,1350], square:[1080,1080], youtube:[1920,1080], shorts:[1080,1920] }[state.preset];
    if (fixed) return { w: fixed[0], h: fixed[1], ratio: fixed[0] / fixed[1] };
    return ratio >= 1 ? { w: 1920, h: even(1920 / ratio), ratio } : { w: even(1920 * ratio), h: 1920, ratio };
  }
  function updateOutput() {
    const spec = outputSpec(); $('#outputSize').textContent = `${spec.w} × ${spec.h} · 25 fps`;
    $('#exportEstimate').textContent = `${(state.trimEnd - state.trimStart).toFixed(1)} sec · browser-native export`;
  }

  let audioContext, audioSource, audioDestination, recorder;
  function supportedMime() {
    const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return candidates.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }
  async function exportVideo() {
    if (state.exporting) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast('This browser cannot export video with the local pipeline. Try current Safari or Chrome.');
    const spec = outputSpec(), out = document.createElement('canvas'); out.width = spec.w; out.height = spec.h;
    let stream;
    try { stream = out.captureStream(25); } catch (_) { return toast('Could not start the browser video encoder.'); }
    let audioAdded = false;
    if (state.audio === 'keep') {
      try {
        audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        audioSource ||= audioContext.createMediaElementSource(video);
        audioDestination ||= audioContext.createMediaStreamDestination();
        if (!audioSource.__vcConnected) { audioSource.connect(audioDestination); audioSource.__vcConnected = true; }
        await audioContext.resume();
        audioDestination.stream.getAudioTracks().forEach(track => { stream.addTrack(track); audioAdded = true; });
      } catch (_) { toast('Audio could not be routed; exporting video only.'); }
    }
    const mime = supportedMime();
    try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: state.quality === '4k' ? 24000000 : 9000000 }) : new MediaRecorder(stream); }
    catch (_) { return toast('The browser encoder could not start at this resolution.'); }
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    state.exporting = true; state.cancelExport = false; $('#exportButton').classList.add('hidden'); $('#downloadLink').classList.add('hidden'); $('#exportProgress').classList.remove('hidden');
    $('#compatibilityNote').textContent = audioAdded || state.audio === 'mute' ? 'Keep this tab open until export completes.' : 'No compatible audio track was found.';
    try {
      video.pause(); await seek(state.trimStart); drawFrame(out, spec.ratio);
      recorder.start(500); await video.play();
      await new Promise(resolve => {
        const tick = () => {
          drawFrame(out, spec.ratio);
          const progress = Math.max(0, Math.min(1, (video.currentTime - state.trimStart) / Math.max(.01, state.trimEnd - state.trimStart)));
          $('#exportPercent').textContent = `${Math.round(progress * 100)}%`; $('#exportProgress progress').value = progress * 100;
          $('#exportStatus').textContent = state.cancelExport ? 'Cancelling…' : 'Rendering locally…';
          if (state.cancelExport || video.currentTime >= state.trimEnd || video.ended) return resolve();
          requestAnimationFrame(tick);
        }; tick();
      });
      video.pause();
      if (recorder.state !== 'inactive') {
        const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
        recorder.stop(); await stopped;
      }
      if (!state.cancelExport && chunks.length) {
        if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
        const type = recorder.mimeType || mime || 'video/webm';
        const blob = new Blob(chunks, { type }); state.outputUrl = URL.createObjectURL(blob);
        const ext = type.includes('mp4') ? 'mp4' : 'webm'; const link = $('#downloadLink');
        link.href = state.outputUrl; link.download = `video-composer-${Date.now()}.${ext}`; link.classList.remove('hidden');
        link.textContent = `Download ${(blob.size / 1048576).toFixed(1)} MB ${ext.toUpperCase()}`;
        toast('Export complete. Your file is ready.');
      }
    } catch (error) { console.error(error); toast('Export stopped. Try 1080p or a different browser.'); }
    finally {
      state.exporting = false; $('#exportButton').classList.remove('hidden'); $('#exportProgress').classList.add('hidden');
      await seek(state.trimStart).catch(() => {}); drawPreview();
    }
  }

  function bindEvents() {
    $('#fileInput').addEventListener('change', e => importFile(e.target.files[0]));
    $('#replaceButton').addEventListener('click', () => $('#fileInput').click());
    ['dragenter','dragover'].forEach(type => stage.addEventListener(type, e => { e.preventDefault(); stage.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(type => stage.addEventListener(type, e => { e.preventDefault(); stage.classList.remove('dragover'); }));
    stage.addEventListener('drop', e => importFile(e.dataTransfer.files[0]));
    $$('.step').forEach((button, i) => button.addEventListener('click', () => setStep(i)));
    $('#backButton').addEventListener('click', () => setStep(Math.max(0, state.step - 1)));
    $('#nextButton').addEventListener('click', async () => {
      if (state.step === 2 && state.mode !== 'off' && !state.corrections.length) await analyzeMotion();
      setStep(Math.min(5, state.step + 1));
    });
    $('#trimStart').addEventListener('input', e => changeTrim('start', e.target.value));
    $('#trimEnd').addEventListener('input', e => changeTrim('end', e.target.value));
    $('#startTime').addEventListener('change', e => changeTrim('start', parseTime(e.target.value)));
    $('#endTime').addEventListener('change', e => changeTrim('end', parseTime(e.target.value)));
    $('#scrubber').addEventListener('input', e => { video.currentTime = Number(e.target.value); drawPreview(); updateTimeDisplay(); });
    $('#playButton').addEventListener('click', async () => {
      if (video.paused) { if (video.currentTime < state.trimStart || video.currentTime >= state.trimEnd) await seek(state.trimStart); await video.play(); $('#playButton').textContent = 'Ⅱ'; animatePreview(); }
      else { video.pause(); $('#playButton').textContent = '▶'; }
    });
    video.addEventListener('pause', () => { if (!state.exporting) $('#playButton').textContent = '▶'; });
    video.addEventListener('seeked', () => { if (!state.exporting) { drawPreview(); updateTimeDisplay(); } });
    $$('#stabilizeModes button').forEach(button => button.addEventListener('click', () => {
      state.mode = button.dataset.value; state.corrections = []; state.stabilizationScale = 1;
      $$('#stabilizeModes button').forEach(b => b.classList.toggle('selected', b === button));
      const copy = { off:['No stabilization','Original camera movement is preserved.'], stabilize:['Smooth handheld motion','Gently reduces shake while keeping intentional movement.'], lock:['Camera lock','Holds the frame as steadily as possible.'] }[state.mode];
      $('#stabilizeTitle').textContent = copy[0]; $('#stabilizeText').textContent = copy[1]; $('#analyzeButton').classList.toggle('hidden', state.mode === 'off'); drawPreview();
    }));
    $('#analyzeButton').addEventListener('click', analyzeMotion);
    $('#zoomRange').addEventListener('input', e => { state.zoom = Number(e.target.value); $('#zoomOutput').value = `${Math.round(state.zoom * 100)}%`; drawPreview(); });
    $('#resetCrop').addEventListener('click', () => { state.zoom = 1; state.offsetX = state.offsetY = 0; $('#zoomRange').value = 1; $('#zoomOutput').value = '100%'; drawPreview(); });
    $('#textInput').addEventListener('input', e => { state.text = e.target.value; drawPreview(); });
    $('#textSize').addEventListener('input', e => { state.textSize = Number(e.target.value); $('#textSizeOutput').value = e.target.value; drawPreview(); });
    $$('[data-color]').forEach(button => button.addEventListener('click', () => { state.textColor = button.dataset.color; $$('[data-color]').forEach(b => b.classList.toggle('selected', b === button)); drawPreview(); }));
    $('#textPosition').addEventListener('change', e => { state.textY = { top:.16, center:.5, bottom:.82 }[e.target.value]; state.textX = .5; drawPreview(); });
    $$('#qualityModes button').forEach(button => button.addEventListener('click', () => { state.quality = button.dataset.quality; $$('#qualityModes button').forEach(b => b.classList.toggle('selected', b === button)); updateOutput(); }));
    $('#presetSelect').addEventListener('change', e => { state.preset = e.target.value; updateOutput(); });
    $$('#audioModes button').forEach(button => button.addEventListener('click', () => { state.audio = button.dataset.audio; $$('#audioModes button').forEach(b => b.classList.toggle('selected', b === button)); }));
    $('#exportButton').addEventListener('click', exportVideo); $('#cancelExport').addEventListener('click', () => { state.cancelExport = true; });
    let drag = null;
    canvas.addEventListener('pointerdown', e => { if (!state.file) return; canvas.setPointerCapture(e.pointerId); drag = { x:e.clientX, y:e.clientY, ox:state.offsetX, oy:state.offsetY, tx:state.textX, ty:state.textY }; });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return; const rect = canvas.getBoundingClientRect(), dx = (e.clientX - drag.x) / rect.width, dy = (e.clientY - drag.y) / rect.height;
      if (state.step === 4 && state.text.trim()) { state.textX = Math.max(.05, Math.min(.95, drag.tx + dx)); state.textY = Math.max(.05, Math.min(.95, drag.ty + dy)); }
      else { state.offsetX = Math.max(-1, Math.min(1, drag.ox + dx * 2)); state.offsetY = Math.max(-1, Math.min(1, drag.oy + dy * 2)); }
      drawPreview();
    });
    ['pointerup','pointercancel'].forEach(type => canvas.addEventListener(type, () => { drag = null; }));
    window.addEventListener('resize', () => { resizePreview(); drawPreview(); });
    window.addEventListener('beforeunload', () => { if (state.url) URL.revokeObjectURL(state.url); if (state.outputUrl) URL.revokeObjectURL(state.outputUrl); });
  }

  buildRatios(); bindEvents(); setStep(0);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
})();
