# 🔒 人脸马赛克工具 · Face Mosaic

上传视频 → 自动检测人脸 → 打码 → 下载。**全流程在你的浏览器里完成，视频不上传任何服务器。**

[![Deploy: GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-222?logo=github)](https://pages.github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% local](https://img.shields.io/badge/privacy-100%25%20local-success)](#隐私)

## ✨ 特性

- 🎯 **自动人脸检测** — 基于 face-api.js TinyFaceDetector，逐帧检测
- 🎨 **三种打码效果** — 像素马赛克 / 高斯模糊 / 黑块遮挡
- 🎛 **可调参数** — 马赛克强度、检测灵敏度、打码范围扩展
- 🎬 **视频导出** — MediaRecorder 录制，保留原音频，一键下载
- 🔐 **纯本地处理** — 视频不离开设备，无后端、无上传、无隐私风险
- 🆓 **零成本部署** — 纯静态，GitHub Pages 免费托管

## 🚀 快速开始

### 在线使用
访问部署后的站点即可（见仓库 About 里的 Pages 链接）。

### 本地运行

```bash
# 需要本地 HTTP 服务（浏览器的模型加载不支持 file:// 协议）
git clone <this-repo>
cd face-mosaic
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

### 使用步骤
1. 点击/拖拽上传视频（MP4 / MOV / WebM 等）
2. 调整马赛克强度、灵敏度、打码范围
3. 选择效果类型（马赛克/模糊/黑块）
4. 点「开始处理」，等待进度条走完
5. 点「下载视频」保存结果

## 🏗 技术实现

| 模块 | 方案 |
|---|---|
| 人脸检测 | [face-api.js](https://github.com/vladmandic/face-api) TinyFaceDetector (193KB 模型) |
| 视频解码 | `<video>` 元素 + Canvas `drawImage` 逐帧 |
| 打码算法 | Canvas 降采样重绘（马赛克）/ 多级缩放（模糊）/ `fillRect`（黑块） |
| 视频编码 | `MediaRecorder` + `canvas.captureStream(30)` |
| 音频保留 | `video.captureStream()` 音轨合并进 canvas 流 |
| 运行环境 | 纯前端，无构建步骤，无依赖安装 |

### 处理流程

```
用户选择视频
   ↓
<video> 播放（静音）
   ↓  每帧 rAF 循环
Canvas.drawImage(当前帧)
   ↓
人脸检测（异步，320px 降采样，~120ms 刷新一次）
   ↓  缓存人脸框（归一化）→ 同步打码，避免闪烁
drawMosaic() 应用到人脸区域
   ↓
canvas.captureStream() → MediaRecorder 录制
   ↓
视频结束 → Blob → 下载链接
```

### 性能设计
- **检测降采样**：320px 宽检测，像素量降到 1/25，实时性大幅提升
- **检测节流**：每 ~120ms 检测一次（而非每帧），避免过载
- **打码同步**：用缓存的人脸框同步绘制，不等待异步检测结果 → 无闪烁
- **1 帧延迟**：人脸快速移动时最多延迟 1 帧，肉眼无感

## 📁 目录结构

```
face-mosaic/
├── index.html      # 页面结构
├── style.css       # 样式
├── app.js          # 核心逻辑（检测/打码/录制）
├── face-api.min.js # face-api.js 库（本地化，不依赖 CDN）
├── models/
│   ├── tiny_face_detector_model-weights_manifest.json
│   └── tiny_face_detector_model.bin
└── LICENSE
```

## ⚠️ 已知限制

| 限制 | 说明 |
|---|---|
| 实时处理速度 | 处理耗时 ≈ 视频时长（实时录制），非离线转码 |
| 输出格式 | 默认 WebM（VP8/VP9）；浏览器支持时可能输出 MP4 |
| 侧脸/遮挡 | TinyFaceDetector 对侧脸、强遮挡、极小脸的召回有限 |
| 大分辨率视频 | 4K 视频处理较慢，建议先压缩到 1080p |
| 浏览器要求 | 需支持 MediaRecorder + captureStream（Chrome/Edge/Firefox/Safari 新版） |

## 🔧 二次开发

### 换用更准的检测模型
`models/` 换成 `ssd_mobilenetv1` 或 `yolov8n-face`（改动 `app.js` 的 `loadFromUri` 与 `detectAllFaces` 调用）。

### 加新打码效果
在 `drawMosaic()` 里加分支即可（例如表情符号贴图、动态色块）。

### 提速方向
用 **WebCodecs API**（`VideoDecoder`/`VideoEncoder`）替换 MediaRecorder，可做到 5-10 倍速离线转码（需 Chromium 94+）。

## 🔐 隐私

- 视频**从不上传**到任何服务器，全部在浏览器内存中处理
- 无后端、无数据库、无埋点、无第三方追踪
- 可断网使用（首次加载后）
- 源码全部公开，可自行审计

## 📄 License

MIT — 可自由使用、修改、商用，保留版权声明即可。

---

**技术栈**: face-api.js · Canvas API · MediaRecorder API · 纯前端
