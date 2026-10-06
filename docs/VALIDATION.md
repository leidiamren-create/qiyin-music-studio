# 当前公开快照验证

日期：2026-10-06。环境：Linux x64、Node.js 24.19.0、Python 3.12.14；可选 DOM 检查使用临时目录的 jsdom 26.1.0，未把依赖复制进发行包。

## 已执行

- `npm test`：74 项通过，0 失败、0 跳过。包括现有音频离线包完整性 / 安装流程 60 项、OMR 适配器 10 项、公开包与回环服务烟雾测试 4 项
- `npm run check`：33 个 JavaScript 文件语法检查、JSON 解析、主页本地 script / style 资源存在性；中文适配模板先替换词典占位后解析，两个已生成高级 HTML 的内嵌脚本也解析通过
- `JSDOM_PATH=... npm run test:localization`：66 项高级编辑器 DOM / 中文显示 / 原生数据 / 导出测试和播放器检查通过；真实 PCM/WAV 合成属于软件输出检查，硬件音频和 Canvas 由替身提供
- 中文适配重新构建后字节稳定
- 5 个 Python 文件通过 AST 语法解析；没有启动 Python 模型运行时
- 八个已嵌入采样的 PCM 哈希和长度已记录；范例工程校验、MIDI 导出 / 回读、乐谱 JSON 往返通过
- 静态服务的主页、PDF 模块、私有文件拒绝、API 不存在、Host 校验和拒绝 POST 检查通过
- 公开路径清单检查：没有个人截图、工程录音、凭据、私有下载链接、模型或额外运行库；源包不含本机 EXE/DLL
- PDF.js 四个 LiberationSans TTF 与上游固定版本字节一致，附准确 1.07.4 对应字体源码与原许可；未重新编译字体

jsdom 输出“Not implemented: navigation (except hash changes)”警告，是其不执行下载后的真实页面导航所致。测试检查导出 Blob 内容；这些警告不表示真实浏览器导航已验收。

## 未执行 / 不作保证

- Windows GUI 启动、真机声卡试听、MIDI 硬件、系统文件保存/取消、中文控件排版与缩放
- 真实 Windows Python / TensorFlow / ONNX / FFmpeg / Audiveris 执行或兼容性
- 模型首次在线下载与安装、实际音频分离 / 转写、实际图片识谱准确率、性能与完整网络抓包
- Windows SmartScreen、不同杀毒软件、驱动和系统 DLL 的兼容性
- PDF.js 真浏览器视觉回归；旧开发环境的真实 PDF / OMR 记录不作为本次验收结果
- 各第三方项目的全面安全审计或法律意见

音频和 OMR 加载器的测试使用受控文件与人工可执行替身。它们验证校验/错误/取消/流程控制，不能冒充真实模型推理或 Windows 运行。公开 Windows 基础包只是保留原 Electron shell 并装入本次源码，尚待真实 Windows 验收。
