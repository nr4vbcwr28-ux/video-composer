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
    if (state.mode === 'off' || !state.corrections.length) return { x: 0, y: 0 };
    let right = state.corrections.findIndex(item => item.t >= time);
    if (right <= 0) return state.corrections[Math.max(0, right)] || { x: 0, y: 0 };
    if (right < 0) return state.corrections[state.corrections.length - 1];
    const a = state.corrections[right - 1], b = state.corrections[right];
    const mix = (time - a.t) / Math.max(.001, b.t - a.t);
    return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
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
    const dx = view.x + (view.w - drawW) / 2 + cropX + stabilizeX;
    const dy = view.y + (view.h - drawH) / 2 + cropY + stabilizeY;
    c.drawImage(video, dx, dy, drawW, drawH);
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

  function edgeMap(data, width, height) {
    const gray = new Uint8Array(width * height);
    const edges = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = Math.round(data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722);
    for (let y = 1; y < height; y++) for (let x = 1; x < width; x++) {
      const i = y * width + x;
      edges[i] = Math.min(255, Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]));
    }
    return edges;
  }

  function estimateTranslation(previous, current, width, height, radius = 7) {
    let bestScore = Infinity, bestX = 0, bestY = 0, zeroScore = Infinity;
    const margin = radius + 3;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      let difference = 0, samples = 0;
      for (let y = margin; y < height - margin; y += 2) {
        const previousRow = y * width;
        const currentRow = (y + dy) * width;
        for (let x = margin; x < width - margin; x += 2) {
          difference += Math.abs(previous[previousRow + x] - current[currentRow + x + dx]); samples++;
        }
      }
      const score = difference / Math.max(1, samples);
      if (dx === 0 && dy === 0) zeroScore = score;
      if (score < bestScore) { bestScore = score; bestX = dx; bestY = dy; }
    }
    const improvement = zeroScore > 0 ? (zeroScore - bestScore) / zeroScore : 0;
    if (improvement < .012 && Math.hypot(bestX, bestY) > 1.5) return { x: 0, y: 0, confidence: 0 };
    return { x: bestX, y: bestY, confidence: Math.max(0, improvement) };
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function smoothPath(path, index, radius) {
    let x = 0, y = 0, weightTotal = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(path.length - 1, index + radius); i++) {
      const distance = Math.abs(i - index);
      const weight = radius + 1 - distance;
      x += path[i].x * weight; y += path[i].y * weight; weightTotal += weight;
    }
    return { x: x / weightTotal, y: y / weightTotal };
  }

  async function analyzeMotion() {
    if (!state.file || state.mode === 'off') return;
    const button = $('#analyzeButton'), progress = $('#analysisProgress');
    button.disabled = true; button.textContent = 'Analyzing motion…'; progress.classList.remove('hidden'); video.pause();
    const proxy = document.createElement('canvas'); proxy.width = 128; proxy.height = Math.max(72, Math.round(128 * video.videoHeight / video.videoWidth));
    const pctx = proxy.getContext('2d', { willReadFrequently: true });
    const length = state.trimEnd - state.trimStart;
    const count = Math.max(10, Math.min(180, Math.ceil(length * 3) + 1));
    const frames = [], shifts = [];
    try {
      for (let i = 0; i < count; i++) {
        const t = state.trimStart + (length * i / Math.max(1, count - 1));
        await seek(t); pctx.drawImage(video, 0, 0, proxy.width, proxy.height);
        const edges = edgeMap(pctx.getImageData(0, 0, proxy.width, proxy.height).data, proxy.width, proxy.height);
        frames.push({ t, edges });
        if (frames.length > 1) shifts.push(estimateTranslation(frames[frames.length - 2].edges, edges, proxy.width, proxy.height));
        button.textContent = `Analyzing motion… ${Math.round((i + 1) / count * 100)}%`;
        await wait(0);
      }
      const filtered = shifts.map((shift, i) => {
        const local = shifts.slice(Math.max(0, i - 1), Math.min(shifts.length, i + 2));
        return { x: median(local.map(item => item.x)), y: median(local.map(item => item.y)), confidence: shift.confidence };
      });
      const path = [{ t: frames[0].t, x: 0, y: 0 }];
      filtered.forEach((shift, i) => path.push({ t: frames[i + 1].t, x: path[i].x + shift.x / proxy.width, y: path[i].y + shift.y / proxy.height }));
      const anchorCount = Math.min(4, path.length);
      const anchor = { x: median(path.slice(0, anchorCount).map(item => item.x)), y: median(path.slice(0, anchorCount).map(item => item.y)) };
      const limit = state.mode === 'lock' ? .1 : .075;
      state.corrections = path.map((point, i) => {
        const target = state.mode === 'lock' ? anchor : smoothPath(path, i, 5);
        return { t: point.t, x: Math.max(-limit, Math.min(limit, target.x - point.x)), y: Math.max(-limit, Math.min(limit, target.y - point.y)) };
      });
      const maxCorrection = state.corrections.reduce((max, item) => Math.max(max, Math.abs(item.x), Math.abs(item.y)), 0);
      state.stabilizationScale = Math.max(1.04, Math.min(1.28, 1 + maxCorrection * 2.25));
      const reliable = filtered.filter(item => item.confidence >= .012).length;
      $('#stabilizeText').textContent = `Tracked ${reliable} motion samples · ${Math.round((state.stabilizationScale - 1) * 100)}% crop guard.`;
      await seek(state.trimStart); drawPreview(); toast('Motion analysis complete.');
    } catch (error) { toast('Motion analysis could not finish in this browser.'); state.mode = 'off'; state.corrections = []; }
    finally { button.disabled = false; button.textContent = 'Analyze again'; progress.classList.add('hidden'); }
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
