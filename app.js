/* 人脸马赛克工具 —— 纯浏览器端
 * 流程: 选择视频 → 逐帧人脸检测 → 打码绘制到 canvas → MediaRecorder 录制 → 下载
 */
'use strict';

const $ = id => document.getElementById(id);

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  uploadPanel: $('uploadPanel'), workPanel: $('workPanel'), resultPanel: $('resultPanel'),
  preview: $('preview'), workCanvas: $('workCanvas'),
  pixelSize: $('pixelSize'), pixelVal: $('pixelVal'),
  confThresh: $('confThresh'), confVal: $('confVal'),
  expand: $('expand'), expandVal: $('expandVal'),
  effectType: $('effectType'),
  startBtn: $('startBtn'), cancelBtn: $('cancelBtn'), resetBtn: $('resetBtn'),
  progressWrap: $('progressWrap'), progressFill: $('progressFill'), progressText: $('progressText'),
  resultVideo: $('resultVideo'), downloadBtn: $('downloadBtn'), againBtn: $('againBtn'),
};

let state = {
  file: null, url: null,
  modelReady: false,
  running: false,
  cancelled: false,
  rafId: null,
  recorder: null,
  chunks: [],
  resultBlobUrl: null,
};

/* ---------- 1. 加载模型 ---------- */
async function loadModel() {
  try {
    els.progressText && (els.progressText.textContent = '加载人脸检测模型…');
    await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
    state.modelReady = true;
    window.__modelReady = true;
    console.log('[model] tinyFaceDetector loaded');
  } catch (e) {
    console.error('[model] load failed', e);
    window.__modelError = String(e && e.message || e);
    alert('人脸检测模型加载失败，请刷新重试。\n' + e.message);
  }
}

/* ---------- 2. 选择文件 ---------- */
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', e => {
  e.preventDefault(); els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', e => {
  e.preventDefault(); els.dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
els.fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) handleFile(f);
});

function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    alert('请选择视频文件');
    return;
  }
  state.file = file;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  els.preview.src = state.url;

  els.uploadPanel.classList.add('hidden');
  els.workPanel.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');
  els.progressWrap.classList.add('hidden');

  els.preview.onloadedmetadata = () => {
    console.log(`[video] ${els.preview.videoWidth}x${els.preview.videoHeight}, ${els.preview.duration.toFixed(1)}s`);
  };
}

/* ---------- 3. 参数滑块 ---------- */
els.pixelSize.addEventListener('input', () => els.pixelVal.textContent = els.pixelSize.value);
els.confThresh.addEventListener('input', () => els.confVal.textContent = els.confThresh.value);
els.expand.addEventListener('input', () => els.expandVal.textContent = els.expand.value);

/* ---------- 4. 打码绘制 ---------- */
function drawMosaic(ctx, x, y, w, h, blockSize, effect) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.floor(w); h = Math.floor(h);
  if (w <= 1 || h <= 1) return;
  const canvas = ctx.canvas;
  if (x + w > canvas.width) w = canvas.width - x;
  if (y + h > canvas.height) h = canvas.height - y;
  if (w <= 1 || h <= 1) return;

  if (effect === 'black') {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (effect === 'blur') {
    // 用区域均值近似 + 多次缩放实现模糊
    const tmp = document.createElement('canvas');
    const down = 12;
    tmp.width = Math.max(1, Math.floor(w / down));
    tmp.height = Math.max(1, Math.floor(h / down));
    const tctx = tmp.getContext('2d');
    tctx.drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
    return;
  }
  // 像素马赛克
  const cols = Math.max(1, Math.floor(w / blockSize));
  const rows = Math.max(1, Math.floor(h / blockSize));
  const tmp = document.createElement('canvas');
  tmp.width = cols; tmp.height = rows;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(canvas, x, y, w, h, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/* ---------- 5. 处理主循环 ---------- */
async function startProcess() {
  if (!state.modelReady) { alert('模型还在加载，请稍候…'); return; }
  if (state.running) return;

  const video = els.preview;
  const canvas = els.workCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  state.running = true;
  state.cancelled = false;
  state.chunks = [];
  els.startBtn.disabled = true;
  els.cancelBtn.disabled = false;
  els.progressWrap.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');

  // 等待视频元数据
  if (!video.videoWidth) {
    await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // 检测用的降采样尺寸（提速）
  const DETECT_W = 320;
  const detectCanvas = document.createElement('canvas');
  const detScale = DETECT_W / canvas.width;
  detectCanvas.width = DETECT_W;
  detectCanvas.height = Math.round(canvas.height * detScale);
  const detCtx = detectCanvas.getContext('2d', { willReadFrequently: true });

  // 音频: 从视频捕获（若有）
  let audioTracks = [];
  try {
    const vStream = video.captureStream ? video.captureStream() : null;
    if (vStream) audioTracks = vStream.getAudioTracks();
  } catch (e) { console.warn('[audio] capture failed', e); }

  // canvas 流 + 音频
  const canvasStream = canvas.captureStream(30);
  audioTracks.forEach(t => canvasStream.addTrack(t));

  // 选择支持的录制格式
  const mimeCandidates = [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    'video/mp4',
  ];
  const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
  console.log('[recorder] mime =', mime || '(default)');

  const recorder = new MediaRecorder(canvasStream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {});
  state.recorder = recorder;
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) state.chunks.push(e.data); };
  recorder.onstop = () => finishProcess(mime);

  const pixelSize = parseInt(els.pixelSize.value, 10);
  const confThresh = parseFloat(els.confThresh.value);
  const expandPct = parseInt(els.expand.value, 10) / 100;
  const effect = els.effectType.value;

  video.currentTime = 0;
  video.muted = true;   // 静音播放（音频仍会被录制）
  await video.play().catch(e => console.warn('[play]', e));

  recorder.start(1000);

  const total = video.duration || 1;
  const detectOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: confThresh });
  let faceBoxes = [];      // 缓存的归一化人脸框 [{x,y,w,h}] (相对画面比例)
  let detecting = false;   // 检测节流
  let lastDetectAt = 0;

  function applyMosaic() {
    for (const b of faceBoxes) {
      let x = b.x * canvas.width, y = b.y * canvas.height;
      let w = b.w * canvas.width, h = b.h * canvas.height;
      const ex = w * expandPct, ey = h * expandPct;
      x -= ex; y -= ey; w += ex * 2; h += ey * 2;
      drawMosaic(ctx, x, y, w, h, pixelSize, effect);
    }
  }

  function loop() {
    if (state.cancelled) { stopAll(); return; }
    if (video.ended || (video.paused && video.currentTime >= total - 0.05)) { stopAll(); return; }

    // 1) 绘制干净帧
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 2) 用缓存框同步打码（无延迟闪烁）
    applyMosaic();

    // 3) 异步刷新检测（每 ~120ms 一次, 避免过载）
    const now = performance.now();
    if (!detecting && now - lastDetectAt > 120) {
      detecting = true;
      lastDetectAt = now;
      detCtx.drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);
      faceapi.detectAllFaces(detectCanvas, detectOpts).then(dets => {
        faceBoxes = dets.map(d => ({
          x: d.box.x / detectCanvas.width,
          y: d.box.y / detectCanvas.height,
          w: d.box.width / detectCanvas.width,
          h: d.box.height / detectCanvas.height,
        }));
      }).catch(() => {}).finally(() => { detecting = false; });
    }

    // 进度
    const p = Math.min(100, (video.currentTime / total) * 100);
    els.progressFill.style.width = p.toFixed(1) + '%';
    els.progressText.textContent = `处理中… ${p.toFixed(0)}%（${video.currentTime.toFixed(1)}s / ${total.toFixed(1)}s，当前 ${faceBoxes.length} 张脸）`;
  }

  function stopAll() {
    if (!state.running) return;
    video.pause();
    try { recorder.state !== 'inactive' && recorder.stop(); } catch (e) {}
  }

  state.stopAll = stopAll;

  // 用 rAF 驱动（与视频帧率同步）
  const tick = () => {
    if (!state.running) return;
    loop();
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);

  // 兜底: 视频结束事件
  video.onended = () => stopAll();
}

function finishProcess(mime) {
  state.running = false;
  els.startBtn.disabled = false;
  els.cancelBtn.disabled = true;
  els.progressFill.style.width = '100%';
  els.progressText.textContent = '处理完成 ✅';

  if (!state.chunks.length) {
    alert('未生成视频数据（可能录制失败），请重试或换浏览器。');
    return;
  }
  const type = mime || 'video/webm';
  const blob = new Blob(state.chunks, { type });
  if (state.resultBlobUrl) URL.revokeObjectURL(state.resultBlobUrl);
  state.resultBlobUrl = URL.createObjectURL(blob);
  els.resultVideo.src = state.resultBlobUrl;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  els.downloadBtn.href = state.resultBlobUrl;
  els.downloadBtn.download = `mosaic_output.${ext}`;
  els.resultPanel.classList.remove('hidden');
  els.resultPanel.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 6. 按钮 ---------- */
els.startBtn.addEventListener('click', startProcess);
els.cancelBtn.addEventListener('click', () => {
  state.cancelled = true;
  if (state.stopAll) state.stopAll();
});
els.resetBtn.addEventListener('click', resetAll);
els.againBtn.addEventListener('click', resetAll);

function resetAll() {
  if (state.running && state.stopAll) state.stopAll();
  state.cancelled = true;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.url) URL.revokeObjectURL(state.url);
  if (state.resultBlobUrl) URL.revokeObjectURL(state.resultBlobUrl);
  state = { ...state, file: null, url: null, running: false, chunks: [], resultBlobUrl: null, rafId: null, stopAll: null };
  els.preview.src = '';
  els.fileInput.value = '';
  els.workPanel.classList.add('hidden');
  els.resultPanel.classList.add('hidden');
  els.uploadPanel.classList.remove('hidden');
}

/* ---------- init ---------- */
loadModel();
