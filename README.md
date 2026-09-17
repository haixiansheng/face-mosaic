# 🔒 人脸马赛克工具 · Face Mosaic

上传图片 → 自动检测人脸 → 打码 → 下载。**全流程在你的浏览器里完成，图片不上传任何服务器。**

> 语言：**中文** | [English](en/)

[![Deploy: GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-222?logo=github)](https://pages.github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% local](https://img.shields.io/badge/privacy-100%25%20local-success)](#隐私)

## ✨ 特性

- 🎯 **自动人脸检测** — 基于 face-api.js TinyFaceDetector，逐图检测
- ⚡ **毫秒级完成** — 单帧处理，拖动滑块实时预览
- 🎨 **三种打码效果** — 像素马赛克 / 高斯模糊 / 黑块遮挡
- 🎛 **实时可调** — 马赛克强度、检测灵敏度、打码范围，改完立即重绘
- 📋 **支持粘贴** — 截图后直接 Ctrl+V 粘贴处理
- 🖼 **原分辨率输出** — 不压缩画质，无水印
- 🔐 **纯本地处理** — 图片不离开设备，无后端、无上传、无隐私风险
- 🆓 **零成本部署** — 纯静态，GitHub Pages 免费托管

## 🚀 快速开始

### 在线使用
- 中文版：https://haixiansheng.github.io/face-mosaic/
- English：https://haixiansheng.github.io/face-mosaic/en/

### 本地运行

```bash
# 需要本地 HTTP 服务（浏览器的模型加载不支持 file:// 协议）
git clone https://github.com/haixiansheng/face-mosaic.git
cd face-mosaic
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

### 使用步骤
1. 点击/拖拽上传图片，或截图后 Ctrl+V 粘贴
2. 自动检测人脸并打码，立即显示结果
3. 拖动滑块微调（强度/灵敏度/范围/效果），实时预览
4. 点「下载图片」保存（保持原分辨率）

## 🏗 技术实现

| 模块 | 方案 |
|---|---|
| 人脸检测 | [face-api.js](https://github.com/vladmandic/face-api) TinyFaceDetector（193KB 模型） |
| 图像绘制 | Canvas 2D `drawImage` |
| 打码算法 | Canvas 降采样重绘（马赛克）/ 多级缩放（模糊）/ `fillRect`（黑块） |
| 图片导出 | `canvas.toBlob()` → JPEG 95% 质量 |
| 运行环境 | 纯前端，无构建步骤，无依赖安装 |

### 处理流程

```
用户选择图片
   ↓
绘制到 Canvas（原分辨率）
   ↓
降采样到 640px 检测人脸（提速 ~20 倍）
   ↓
人脸框映射回原图坐标 → 逐个打码
   ↓
canvas.toBlob() → 下载链接
```

### 性能设计
- **检测降采样**：最长边 640px 检测，像素量降到 ~1/20，检测耗时通常在几十毫秒
- **异步检测 + 即时重绘**：滑块改动立即重新检测与打码，无需等待
- **原分辨率输出**：打码在原始尺寸 Canvas 上执行，不损失细节

## 📁 目录结构

```
face-mosaic/
├── index.html        # 中文页面
├── en/               # 英文页面
│   ├── index.html
│   ├── about.html
│   └── privacy.html
├── about.html        # 关于（中文）
├── privacy.html      # 隐私政策（中文）
├── style.css         # 样式
├── app.js            # 核心逻辑（检测/打码/导出）
├── face-api.min.js   # face-api.js 库（本地化，不依赖 CDN）
├── models/
│   ├── tiny_face_detector_model-weights_manifest.json
│   └── tiny_face_detector_model.bin
├── ads.txt           # AdSense 授权文件
└── LICENSE
```

## ⚠️ 已知限制

| 限制 | 说明 |
|---|---|
| 侧脸/遮挡 | TinyFaceDetector 对侧脸、强遮挡、极小脸的召回有限，可调低灵敏度 |
| 单张处理 | 当前一次处理一张，批量功能待开发 |
| 输出格式 | 固定 JPEG（95% 质量），暂不支持 PNG 透明通道 |
| 浏览器要求 | 需支持 Canvas + Blob（现代浏览器均支持） |

## 🔧 二次开发

### 加新打码效果
在 `app.js` 的 `drawMosaic()` 里加分支即可（例如像素化 + 描边、动态色块）。

### 换更准的检测模型
`models/` 换成 `ssd_mobilenetv1` 或 `yolov8n-face`，改动 `loadModel()` 与 `detectAllFaces()` 调用。

### 想做批量处理
把 `process()` 改成循环遍历文件列表，逐张检测并打包下载（JSZip）。

## 🔐 隐私

- 图片**从不上传**到任何服务器，全部在浏览器内存中处理
- 无后端、无数据库、无埋点、无第三方追踪
- 可断网使用（首次加载后）
- 源码全部公开，可自行审计（按 F12 → Network 面板验证）

## 📄 License

MIT — 可自由使用、修改、商用，保留版权声明即可。

---

**技术栈**: face-api.js · Canvas API · Blob API · 纯前端
