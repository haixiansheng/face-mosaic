/* 人脸马赛克工具（图片版）—— 纯浏览器端
 * 流程: 选择图片 → 人脸检测(多尺度) → 打码 → 下载
 *
 * 检测方案:
 *  - 模型二选一: SSD MobileNetV1(精准, 默认) / TinyFaceDetector(极速)
 *  - 多尺度: 全图检测 + 大图分块检测(2x2 重叠) → NMS 去重
 *  - 解决小脸漏检: 不再把整图硬压到 640px
 */
'use strict';

/* ---------- 0. 站点根路径 + face-api.js 懒加载 ----------
 * face-api.min.js 有 ~322KB，页面一打开就加载会让首屏从 ~11KB 涨到 ~333KB。
 * 改成用户第一次提供图片时才拉取，首屏保持轻量。
 * 路径从 app.js 自身的 URL 推导，这样 /en/ 子目录页面也能正确解析。
 */
const SITE_ROOT = (() => {
  let src = document.currentScript && document.currentScript.src;
  if (!src) {                                   // 回退：从 DOM 里找 app.js 的 script 标签
    const el = document.querySelector('script[src*="app.js"]');
    if (el) src = el.src;
  }
  return src ? src.replace(/app\.js(\?.*)?$/, '') : './';
})();

let __faceApiPromise = null;
function ensureFaceApi() {
  if (window.faceapi) return Promise.resolve();
  if (__faceApiPromise) return __faceApiPromise;

  // 候选路径：优先用推导出的站点根，失败则依次回退（防止路径推导异常导致工具不可用）
  const candidates = [
    SITE_ROOT + 'face-api.min.js',
    'face-api.min.js',            // 相对当前页面
    '../face-api.min.js',
  ];

  const tryLoad = (i) => new Promise((resolve, reject) => {
    if (i >= candidates.length) {
      __faceApiPromise = null;
      reject(new Error('face-api.js load failed (tried ' + candidates.length + ' paths)'));
      return;
    }
    const sc = document.createElement('script');
    sc.src = candidates[i];
    sc.async = true;
    sc.onload = () => (window.faceapi ? resolve() : tryLoad(i + 1).then(resolve, reject));
    sc.onerror = () => { sc.remove(); tryLoad(i + 1).then(resolve, reject); };
    document.head.appendChild(sc);
  });

  __faceApiPromise = tryLoad(0);
  return __faceApiPromise;
}

const $ = id => document.getElementById(id);

/* ---------- i18n ---------- */
const I18N = {
  zh: {
    loadingModel: '加载人脸检测模型…',
    modelFail: '人脸检测模型加载失败，请刷新重试。',
    pickImage: '请选择图片文件',
    modelNotReady: '模型还在加载，请稍候…',
    detecting: '检测中…',
    facesFound: n => `检测到 ${n} 张人脸`,
    noFace: '未检测到人脸（试试降低"检测灵敏度"，或换"精准模式"）',
    done: '✅ 处理完成',
    download: '⬇ 下载图片',
    modelLoadingWait: '模型加载中…',
  },
  en: {
    loadingModel: 'Loading face detection model…',
    modelFail: 'Failed to load the face detection model. Please refresh and try again.',
    pickImage: 'Please select an image file',
    modelNotReady: 'Model is still loading, please wait…',
    detecting: 'Detecting…',
    facesFound: n => `Detected ${n} face(s)`,
    noFace: 'No faces detected (try lowering "Detection sensitivity" or using Accurate mode)',
    done: '✅ Done',
    download: '⬇ Download image',
    modelLoadingWait: 'Loading model…',
  },
};
const LANG = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
const T = I18N[LANG];

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  uploadPanel: $('uploadPanel'), workPanel: $('workPanel'),
  resultCanvas: $('resultCanvas'), srcCanvas: $('srcCanvas'),
  pixelSize: $('pixelSize'), pixelVal: $('pixelVal'),
  confThresh: $('confThresh'), confVal: $('confVal'),
  expand: $('expand'), expandVal: $('expandVal'),
  effectType: $('effectType'), modelMode: $('modelMode'),
  faceInfo: $('faceInfo'), downloadBtn: $('downloadBtn'),
  resetBtn: $('resetBtn'),
};

const state = {
  ready: { ssd: false, tiny: false },
  loading: {},
  img: null,
  resultUrl: null,
  fileName: 'image',
  busy: false,
};

/* ---------- 1. 模型加载（按需懒加载） ---------- */
async function ensureModel(mode) {
  const key = mode === 'fast' ? 'tiny' : 'ssd';
  if (state.ready[key]) return true;
  if (state.loading[key]) { await state.loading[key]; return state.ready[key]; }
  els.faceInfo.textContent = T.loadingModel;
  state.loading[key] = (async () => {
    try {
      await ensureFaceApi();                       // 先按需加载 face-api.js（~322KB）
      const modelsUri = SITE_ROOT + 'models';
      if (key === 'ssd') {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(modelsUri);
      } else {
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelsUri);
      }
      state.ready[key] = true;
      window.__modelReady = true;
      console.log('[model] loaded:', key);
    } catch (e) {
      console.error('[model] fail', key, e);
      window.__modelError = String(e && e.message || e);
      alert(T.modelFail + '\n' + e.message);
      throw e;
    }
  })();
  await state.loading[key];
  return state.ready[key];
}

/* ---------- 2. 选择图片 ---------- */
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', e => {
  e.preventDefault(); els.dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0]; if (f) handleFile(f);
});
els.fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); });

/* 剪贴板粘贴 */
document.addEventListener('paste', e => {
  const items = (e.clipboardData || {}).items || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { handleFile(f); e.preventDefault(); return; }
    }
  }
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) { alert(T.pickImage); return; }
  state.fileName = (file.name || 'image').replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    els.uploadPanel.classList.add('hidden');
    els.workPanel.classList.remove('hidden');
    els.srcCanvas.width = img.naturalWidth;
    els.srcCanvas.height = img.naturalHeight;
    els.srcCanvas.getContext('2d').drawImage(img, 0, 0);
    els.resultCanvas.width = img.naturalWidth;
    els.resultCanvas.height = img.naturalHeight;
    process();
  };
  img.onerror = () => alert('图片加载失败 / Failed to load image');
  img.src = url;
}

/* ---------- 3. 参数 ---------- */
let debounceTimer = null;
function scheduleProcess() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(process, 180);
}
els.pixelSize.addEventListener('input', () => { els.pixelVal.textContent = els.pixelSize.value; scheduleProcess(); });
els.confThresh.addEventListener('input', () => { els.confVal.textContent = els.confThresh.value; scheduleProcess(); });
els.expand.addEventListener('input', () => { els.expandVal.textContent = els.expand.value; scheduleProcess(); });
els.effectType.addEventListener('change', process);
if (els.modelMode) els.modelMode.addEventListener('change', process);
els.resetBtn.addEventListener('click', resetAll);

/* ---------- 4. 打码绘制 ---------- */
function drawMosaic(ctx, x, y, w, h, blockSize, effect) {
  const canvas = ctx.canvas;
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.floor(Math.min(w, canvas.width - x));
  h = Math.floor(Math.min(h, canvas.height - y));
  if (w <= 1 || h <= 1) return;

  if (effect === 'black') {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    return;
  }
  const tmp = document.createElement('canvas');
  if (effect === 'blur') {
    const down = 14;
    tmp.width = Math.max(1, Math.floor(w / down));
    tmp.height = Math.max(1, Math.floor(h / down));
    tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
    return;
  }
  const cols = Math.max(1, Math.floor(w / blockSize));
  const rows = Math.max(1, Math.floor(h / blockSize));
  tmp.width = cols; tmp.height = rows;
  tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/* ---------- 5. 多尺度人脸检测 ---------- */
const DET_MAX = 1024;   // 单次检测输入最长边上限（越大越准越慢）

/** 对源图的一个区域做一次检测，返回原图坐标的框 */
async function detectRegion(srcCanvas, region, mode, threshold) {
  const { x, y, w, h } = region;
  const s = Math.min(1, DET_MAX / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, sw, sh);

  let dets = [];
  try {
    await ensureFaceApi();                          // 防御性：正常情况下 ensureModel 已加载
    if (mode === 'fast') {
      dets = await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({
        inputSize: 416, scoreThreshold: threshold,
      }));
    } else {
      dets = await faceapi.detectAllFaces(c, new faceapi.SsdMobilenetv1Options({
        minConfidence: threshold,
      }));
    }
  } catch (e) { console.warn('[detect]', e); }

  const sx = w / sw, sy = h / sh;
  return dets.map(d => ({
    x: x + d.box.x * sx,
    y: y + d.box.y * sy,
    w: d.box.width * sx,
    h: d.box.height * sy,
    score: d.score || 0.9,
  }));
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-6);
}

function nms(boxes, th = 0.35) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of sorted) {
    if (keep.every(k => iou(b, k) < th)) keep.push(b);
  }
  return keep;
}

/** 全图 + 分块 多尺度检测 */
async function detectFaces(srcCanvas, mode, threshold) {
  const W = srcCanvas.width, H = srcCanvas.height;
  let all = await detectRegion(srcCanvas, { x: 0, y: 0, w: W, h: H }, mode, threshold);

  // 大图才做分块（增加小脸召回）
  if (Math.max(W, H) > 1200) {
    const tiles = Math.max(W, H) > 2400 ? 3 : 2;
    const tw = Math.round(W / tiles * 1.25);
    const th = Math.round(H / tiles * 1.25);
    const jobs = [];
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const x = Math.max(0, Math.min(W - tw, Math.round(tx * W / tiles)));
        const y = Math.max(0, Math.min(H - th, Math.round(ty * H / tiles)));
        jobs.push(detectRegion(srcCanvas, { x, y, w: Math.min(tw, W - x), h: Math.min(th, H - y) }, mode, threshold));
      }
    }
    const res = await Promise.all(jobs);
    for (const r of res) all = all.concat(r);
  }
  return nms(all, 0.35);
}

/* ---------- 6. 主处理 ---------- */
async function process() {
  if (!state.img || state.busy) return;
  const mode = els.modelMode ? els.modelMode.value : 'accurate';
  if (!state.ready[mode === 'fast' ? 'tiny' : 'ssd']) {
    els.faceInfo.textContent = T.modelLoadingWait;
    try { await ensureModel(mode); } catch (e) { return; }
  }
  state.busy = true;
  els.faceInfo.textContent = T.detecting;

  const canvas = els.resultCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);

  const threshold = parseFloat(els.confThresh.value);
  const t0 = performance.now();
  let boxes = [];
  try {
    boxes = await detectFaces(canvas, mode, threshold);
  } catch (e) { console.warn(e); }
  const ms = Math.round(performance.now() - t0);

  const blockSize = parseInt(els.pixelSize.value, 10);
  const expandPct = parseInt(els.expand.value, 10) / 100;
  const effect = els.effectType.value;

  for (const b of boxes) {
    const ex = b.w * expandPct, ey = b.h * expandPct;
    drawMosaic(ctx, b.x - ex, b.y - ey, b.w + ex * 2, b.h + ey * 2, blockSize, effect);
  }

  els.faceInfo.textContent = boxes.length
    ? `${T.facesFound(boxes.length)} · ${ms}ms`
    : T.noFace;

  canvas.toBlob(blob => {
    if (blob) {
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = URL.createObjectURL(blob);
      els.downloadBtn.href = state.resultUrl;
      els.downloadBtn.download = `${state.fileName}_mosaic.jpg`;
    }
    state.busy = false;
  }, 'image/jpeg', 0.95);

  window.__lastBoxes = boxes;
}

/* ---------- 7. 重置 ---------- */
function resetAll() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.img = null; state.resultUrl = null;
  els.fileInput.value = '';
  els.workPanel.classList.add('hidden');
  els.uploadPanel.classList.remove('hidden');
}

/* ---------- init ---------- */
ensureModel('accurate');
