# 构建、运行与更新

## 环境

本次便携检查使用 Linux、Node.js 24.19.0、Python 3.12.14。浏览器作曲不需要 Node/Python。模型栈另要求 Python 3.11；这里使用 Python 3.12 只作语法检查和打包，绝不表示模型支持 Python 3.12。

源码无需 npm install 即可执行 `npm run serve`、`npm test` 和 `npm run check`。无默认安装脚本，不会自动获取 Electron、Python、模型或远程服务。

中文适配源码在 `advanced/localization/`，执行 `python advanced/localization/build.py`。重复构建应保持两个 HTML 字节一致。核心哈希不符时应审阅上游变更，不能直接改 pin 使其通过。

可选完整 DOM 测试需要 jsdom（不随包附带），可在隔离测试目录安装，设置 `JSDOM_PATH` 指向其模块目录，再执行 `npm run test:localization`。Canvas、几何与硬件音频接口使用替身；通过不等于真机图形/声卡验收。

## 源码 / 浏览器下载包

运行 `python tools/package_source.py`，输出 `dist/qiyin-music-studio-v1.4.0-public.1-source-browser.zip`。打包只使用脚本中明确列出的应用和文档目录，排除缓存、运行库、模型、依赖、用户工程与可执行文件。ZIP 同时是源代码快照和可直接打开基础作曲的浏览器包。

PDF 模块在部分浏览器 file:// 下会被拦截，用 `npm run serve` 的回环地址打开。静态服务不实现识别 API，不应对外开放端口。

## Windows x64 完整基础客户端

本公开基础版可以使用已核验的官方 Electron Windows x64 运行时手工封装：

1. 从 Electron 官方 Releases 获取明确版本的 Windows x64 ZIP，核对该版本官方 SHA256。
2. 保留解压目录全部 Electron 文件、LICENSE、LICENSES.chromium.html 等原始许可，不单独提取 EXE。
3. 将本源码目录放入 `resources/app/`，不复制 .git、node_modules、dist、用户工程、.runtime 或模型；`package.json` 的 main 是 `desktop/main.cjs`。
4. 可把 electron.exe 改名为 `七音音乐工作室.exe`；保留原始校验记录与当前应用版本说明。
5. 在干净 Windows x64 上完成下节验收再扩大分发。新包应作为完整基础客户端解压到新文件夹。

本次本地准备的公开基础 ZIP 沿用已有 Electron 44.5.1 shell。该运行时已有官方校验记录，原始第三方许可保留；本次没有在 Windows 上启动它。不要把本说明当成完整可复现的 Electron 编译脚本，也不要宣称 Windows 验收已完成。

## 基础包、源码包与增量包

- 完整 Windows 基础包：Electron + 应用资源，可直接启动普通作曲；不含额外识别模型与运行库。
- 源码 / 浏览器包：无 Electron，可直接打开基础网页，也可用于开发；不是 Windows 安装器。
- 历史离线组件增量更新：叠加在指定旧客户端，另含庞大运行库 / 模型。不是独立客户端，本次不公开提供；需要单独解决每项再分发义务。

已安装可选组件的使用者应先备份工程和运行时配置。不要把旧 .runtime 任意覆盖到新包；不同 pin 和哈希可能使校验失败。请依据具体更新说明迁移。

## Windows 验收清单（未执行）

- 干净 Windows 上完整解压、启动/退出、重复启动、缩放与中文布局
- 真机播放与 WAV/MIDI 导出、系统保存/取消窗口、切页未保存提示
- PDF 含/不含嵌入字体的渲染与乐谱导入
- 在线可选组件首次准备/取消/失败重试/断网复用
- 独立 Audiveris 安装、配置、实际印刷谱识别、取消、子进程清理
- 缺失 Visual C++ DLL 时的真实诊断

音频模型与 OMR 的可移植单元测试使用人工替身；不可替代此清单。
