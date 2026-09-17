/* 人脸马赛克工具（图片版）—— 纯浏览器端
 * 流程: 选择图片 → 人脸检测 → 打码 → 下载
 * 图片单帧处理，毫秒级完成。
 */
'use strict';

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
    noFace: '未检测到人脸（可降低"检测灵敏度"后重试）',
    done: '✅ 处理完成',
    download: '⬇ 下载图片',
  },
  en: {
    loadingModel: 'Loading face detection model…',
    modelFail: 'Failed to load the face detection model. Please refresh and try again.',
    pickImage: 'Please select an image file',
    modelNotReady: 'Model is still loading, please wait…',
    detecting: 'Detecting…',
    facesFound: n => `Detected ${n} face(s)`,
    noFace: 'No faces detected (try lowering "Detection sensitivity")',
    done: '✅ Done',
    download: '⬇ Download image',
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
  effectType: $('effectType'),
  faceInfo: $('faceInfo'), downloadBtn: $('downloadBtn'),
  resetBtn: $('resetBtn'), sliderRow: $('sliderRow'),
};

const state = {
  modelReady: false,
  img: null,          // 原始 Image 对象
  faceBoxes: [],      // 归一化人脸框
  resultUrl: null,
  fileName: 'image',
};

/* ---------- 1. 加载模型 ---------- */
async function loadModel() {
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
    state.modelReady = true;
    window.__modelReady = true;
    console.log('[model] loaded');
  } catch (e) {
    console.error('[model] fail', e);
    window.__modelError = String(e && e.message || e);
    alert(T.modelFail + '\n' + e.message);
  }
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

/* 剪贴板粘贴支持 */
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
els.pixelSize.addEventListener('input', () => { els.pixelVal.textContent = els.pixelSize.value; process(); });
els.confThresh.addEventListener('input', () => { els.confVal.textContent = els.confThresh.value; process(); });
els.expand.addEventListener('input', () => { els.expandVal.textContent = els.expand.value; process(); });
els.effectType.addEventListener('change', process);
els.resetBtn.addEventListener('click', resetAll);

/* ---------- 4. 打码绘制 ---------- */
function drawMosaic(ctx, x, y, w, h, blockSize, effect) {
  const canvas = ctx.canvas;
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.floor(Math.min(w, canvas.width - x)); h = Math.floor(Math.min(h, canvas.height - y));
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
  // 像素马赛克
  const cols = Math.max(1, Math.floor(w / blockSize));
  const rows = Math.max(1, Math.floor(h / blockSize));
  tmp.width = cols; tmp.height = rows;
  tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, cols, rows, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/* ---------- 5. 主处理（图片，瞬间完成） ---------- */
let processing = false;
async function process() {
  if (!state.modelReady) { els.faceInfo.textContent = T.modelNotReady; return; }
  if (!state.img || processing) return;
  processing = true;
  els.faceInfo.textContent = T.detecting;

  const canvas = els.resultCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // 1) 画原图
  ctx.drawImage(state.img, 0, 0, canvas.width, canvas.height);

  // 2) 检测（降采样到最长边 640，提速）
  const MAXW = 640;
  const scale = Math.min(1, MAXW / Math.max(canvas.width, canvas.height));
  const dw = Math.round(canvas.width * scale), dh = Math.round(canvas.height * scale);
  const det = document.createElement('canvas');
  det.width = dw; det.height = dh;
  det.getContext('2d').drawImage(canvas, 0, 0, dw, dh);

  let dets = [];
  try {
    dets = await faceapi.detectAllFaces(det,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: parseFloat(els.confThresh.value),
      }));
  } catch (e) { console.warn(e); }

  // 3) 打码
  const blockSize = parseInt(els.pixelSize.value, 10);
  const expandPct = parseInt(els.expand.value, 10) / 100;
  const effect = els.effectType.value;
  const inv = canvas.width / dw;   // 检测图 → 原图比例

  for (const d of dets) {
    const b = d.box;
    let x = b.x * inv, y = b.y * inv, w = b.width * inv, h = b.height * inv;
    const ex = w * expandPct, ey = h * expandPct;
    x -= ex; y -= ey; w += ex * 2; h += ey * 2;
    drawMosaic(ctx, x, y, w, h, blockSize, effect);
  }

  state.faceBoxes = dets;
  els.faceInfo.textContent = dets.length ? T.facesFound(dets.length) : T.noFace;

  // 4) 导出
  canvas.toBlob(blob => {
    if (!blob) return;
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(blob);
    els.downloadBtn.href = state.resultUrl;
    els.downloadBtn.download = `${state.fileName}_mosaic.jpg`;
    els.downloadBtn.textContent = T.download;
    processing = false;
  }, 'image/jpeg', 0.95);
}

/* ---------- 6. 重置 ---------- */
function resetAll() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.img = null; state.resultUrl = null; state.faceBoxes = [];
  els.fileInput.value = '';
  els.workPanel.classList.add('hidden');
  els.uploadPanel.classList.remove('hidden');
}

/* ---------- init ---------- */
loadModel();
