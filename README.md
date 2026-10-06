# 七音音乐工作室

中文本地音乐工具，包含数字作曲、音效实验室、BeepBox 高级作曲，以及 MIDI / MusicXML 乐谱工作区。

当前公开版本：**1.4.0-public.1（公开基础版）**。这是可审阅源码及基础作曲资源；自动分轨、音符识别和图片识谱所需的额外引擎、模型与运行库不包含在此仓库或基础 ZIP 中。原创代码的通用许可证尚待权利人确定，不能把“公开源码”理解成整仓 MIT 授权。

## 选择下载与启动方式

[发布页与校验文件](https://github.com/leidiamren-create/qiyin-music-studio/releases/tag/v1.4.0-public.1) · [直接下载 Windows x64 基础客户端](https://github.com/leidiamren-create/qiyin-music-studio/releases/download/v1.4.0-public.1/qiyin-music-studio-v1.4.0-public.1-windows-x64-base.zip) · [下载源码 / 浏览器包](https://github.com/leidiamren-create/qiyin-music-studio/releases/download/v1.4.0-public.1/qiyin-music-studio-v1.4.0-public.1-source-browser.zip)

本次为预发布版本；Windows 客户端约 166 MB，源码 / 浏览器包约 8.2 MB。

- **源码 / 浏览器包**：完整解压后，用桌面 Edge / Chrome 打开 `index.html`，可使用数字作曲、音效与高级作曲。无需安装依赖或构建。浏览器本地文件策略可能限制 PDF 模块；需要 PDF 预览时可用下述本机服务。
- **Windows x64 公开基础版 ZIP**：全部解压，双击 `七音音乐工作室.exe`。必须保留整个文件夹；该包包含 Electron 外壳，用户无需另装 Node.js。未进行 Windows 真机验收，未购买代码签名证书。不要绕过系统安全警告。
- **增量更新包不是完整客户端**：历史 v1.4 完整离线组件更新以已安装的 v1.3 Windows 基础客户端为前提，不能单独运行。它不是本次公开基础包，当前不在公开仓库提供；不能用源码 ZIP 代替它。

本机浏览器服务（仅需已安装的 Node.js；不需要 npm install）：

```sh
npm run serve
```

在浏览器打开终端显示的 `http://127.0.0.1:8765`。服务只监听本机，只提供静态应用资源，不启动音频识别后端。结束时按 Ctrl+C。作曲资源都在包内，运行不需 CDN。

## 已有功能

- 数字简谱、最多四轨短配乐；采样 / 合成音色、逐轨音色雕刻、WAV / MIDI / JSON 导出
- 可重复生成的游戏音效及独立 WAV 导出
- 内置完整 BeepBox 4.2.2 编辑器与播放器，610 条简体中文显示适配，原生工程格式和音源保持独立
- MIDI、MusicXML / MXL 导入，声部与音符校正；PDF / 图片页面预览和裁切
- 桌面适配器可调用用户自行准备的本机音频模型和独立 Audiveris；**这些不是基础版内置即用功能**

数字简谱、识别工程、乐谱工作区与 BeepBox JSON 是不同格式。请使用各自入口；MIDI 交接不保证保留全部音色、效果和表达。自动识别只是候选结果，需要人工校对，不承诺还原原曲所有乐器或保证准确率。

## 可选识别组件

音频识别：Windows 客户端的“准备音频识别”可按用户确认下载官方 Python / PyPI 依赖与模型。首次需要网络，可能约 1–2 GB 下载，建议 8 GB 内存和 6 GB 可用磁盘；实际量以依赖和缓存为准。网络或平台依赖可能失败，此路径未在真实 Windows 上验证。组件默认放在客户端旁 `.runtime/`。

图片 / 印刷五线谱识别：需自行安装可信的官方 [Audiveris](https://github.com/Audiveris/audiveris/releases)，并在桌面客户端配置其 `Audiveris.exe`。相关许可、Java 和语言数据由该独立软件决定。没有附带 Audiveris、Java、OCR 数据或微软 Visual C++ 安装器。手写谱、数字简谱图片和复杂拍照条件不保证支持。

## 开发、构建与更新

- 静态网页已构建；不需要前端打包器
- `npm test`：可移植 Node 测试，不安装或运行真实识别模型
- `npm run check`：JavaScript / JSON 语法和本地资源检查
- `python advanced/localization/build.py`：重新生成中文显示适配；会校验已有 BeepBox 核心哈希
- `npm run test:localization`：需要另行安装 jsdom；参见 `advanced/localization/README.md`
- `python tools/package_source.py`：生成源码 / 浏览器 ZIP，不包括依赖、缓存、运行库或个人工程

Windows 手工封装方法、更新区别与验证清单见 [docs/BUILD.md](docs/BUILD.md)。测试执行范围与没有完成的项目见 [docs/VALIDATION.md](docs/VALIDATION.md)。第三方资产清单见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

更新之前，先导出所有工程 JSON 和重要 WAV / MIDI。基础 ZIP 应解压到新目录，再测试导入备份；不要未经确认覆盖旧客户端或 `.runtime`。基础版本号不能证明另外的模型、引擎或系统 DLL 已安装。

## 隐私与许可

静态作曲不上传音乐。可选识别通过本机回环服务处理所选音频；首次下载会访问官方软件 / 模型站点。外部帮助链接在用户点击后可能联网。临时目录和浏览器存储不等于可靠备份；崩溃可能留下临时文件。请只打开可信来源的工程与乐谱。

原创部分见 [LICENSE.txt](LICENSE.txt)，第三方保留各自条款。录音采样为 CC BY 3.0，发布使用采样的作品时请保留 [素材署名.txt](素材署名.txt) 中的署名和许可链接。软件与模型许可不授予任何输入录音或乐曲的版权。
