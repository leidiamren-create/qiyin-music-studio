# 第三方组件下载与配置指南

适用：七音音乐工作室 **1.4.0-public.1 公开基础版**。链接与源码核对日期：2026-10-06。

本页按当前源码说明下载和配置方法。**没有完成真实 Windows 上的首次下载、模型推理、Audiveris 调用或浏览器端到端验收**；以下版本是代码固定版本或适配器参考版本，不代表已通过整套兼容性测试。详细验证范围见 [VALIDATION.md](VALIDATION.md)。

## 先看你需要哪一项

| 想做的事 | 需要另装什么 | 推荐入口 |
| --- | --- | --- |
| 数字作曲、音效、BeepBox 高级作曲；导入 MIDI / MusicXML / MXL | 不需要本页的额外识别组件 | 直接打开七音 |
| MP3 / WAV 自动分轨、生成候选音符 | 独立 Python、音频依赖、模型 | Windows 客户端顶部“准备音频识别” |
| 图片 / PDF 印刷五线谱转成候选乐谱 | 独立 Audiveris | 先安装官方 Audiveris，再点“配置五线谱识别” |
| 日志明确报告微软 C++ 运行库缺失 | Microsoft Visual C++ x64 运行库 | 按下文微软官方入口自行安装 |

本公开基础包及文档更新包**不包含** Python、音频模型、Audiveris、Java、OCR 语言数据或微软 VC++ 安装器。首次准备音频需要联网。基础版已有的图片 / PDF 预览功能，也不等于自动识谱引擎已经安装。

Windows 客户端的当前目标为 Windows 10/11 x64；不提供本页流程对 Windows 32 位、ARM64 原生、macOS 或 Linux 桌面客户端的兼容承诺。源码 / 浏览器包不带桌面配置接口；直接打开 index.html 或运行 npm run serve，不会安装或启动音频后端。开发者另见 [本机服务说明](../local_service/README.txt)。

## 一、音频分轨与转写：由客户端准备

### 操作步骤

1. 完整解压 Windows 基础客户端，启动 `七音音乐工作室.exe`。不要在压缩包中运行，也不要只复制一个 EXE。
2. 确认客户端文件夹可写、所在磁盘至少还有 6 GB 可用空间。建议 8 GB 或更多内存，并为后续音频处理预留工作空间。首次下载提示约 1–2 GB，是估算值，实际大小取决于依赖和缓存。
3. 点顶部“准备音频识别”，再点“下载并准备识别组件”。阅读下载来源、空间和本机处理说明，在系统对话框中自行确认“下载并准备”。菜单“七音 → 音频识别准备 / 日志”也能打开面板。
4. 等待四步完成：下载运行时管理器、准备 Python、安装依赖、下载四轨模型。可展开“查看准备日志 / 错误详情”；也可“取消准备”，已下载文件会保留供重试使用。
5. 只有出现“本机识别已就绪。可以断网使用，音频只在本机处理。”后，再到“音频识别”选音频。首次建议试 25 秒片段，再决定是否处理更长内容。

组件放在**客户端 EXE 旁的 `.runtime` 文件夹**，不是写入七音源码仓库。客户端准备流程不修改系统 PATH，不需要你另装系统 Python、Node.js、CUDA 或 GPU 驱动；这一识别管线使用 CPU。Audiveris 是另一套独立流程，准备音频不会安装它。

### 固定版本及官方下载地址

下面的链接用于查看来源、下载文件和定位故障。通常应让七音完成安装，**单独下载这些文件或随便放入 `.runtime` 不会形成完整可用环境**；公开版没有“导入一个组件 ZIP”的界面。

| 组件 | 当前代码版本与用途 | 官方来源 / 下载 |
| --- | --- | --- |
| Astral uv | 0.12.23，Windows x64 运行时与包管理器 | [固定版本发布页](https://github.com/astral-sh/uv/releases/tag/0.12.23)；[Windows x64 ZIP](https://github.com/astral-sh/uv/releases/download/0.12.23/uv-x86_64-pc-windows-msvc.zip) |
| Python | 3.11.16，由 uv 准备独立运行时 | [Python 3.11.16 版本说明](https://www.python.org/downloads/release/python-31116/)；[Astral 分发说明](https://docs.astral.sh/uv/concepts/python-versions/#managed-python-distributions)；[python-build-standalone 发布页](https://github.com/astral-sh/python-build-standalone/releases) |
| Deezer Spleeter | Python 包 2.4.2，估计人声 / 贝斯 / 鼓 / 其他四类声部 | [PyPI 2.4.2 下载文件](https://pypi.org/project/spleeter/2.4.2/#files) |
| Spleeter 四轨模型 | 取自模型发布 v1.4.0，不是 Python 包的版本号 | [官方模型发布页](https://github.com/deezer/spleeter/releases/tag/v1.4.0)；[4stems.tar.gz](https://github.com/deezer/spleeter/releases/download/v1.4.0/4stems.tar.gz)；[checksum.json](https://github.com/deezer/spleeter/releases/download/v1.4.0/checksum.json) |
| Spotify Basic Pitch | 0.4.0，有音高声部的候选音符；使用包内 ICASSP 2022 ONNX 模型 | [PyPI 0.4.0 下载文件](https://pypi.org/project/basic-pitch/0.4.0/#files)；[官方源码与说明](https://github.com/spotify/basic-pitch/tree/v0.4.0) |
| TensorFlow | 2.12.1，分轨依赖；Windows 锁文件同时包含 tensorflow-intel 2.12.1 | [PyPI 2.12.1 下载文件](https://pypi.org/project/tensorflow/2.12.1/#files) |
| ONNX Runtime | 1.30.0，Basic Pitch 的 CPU 推理 | [PyPI 1.30.0 下载文件](https://pypi.org/project/onnxruntime/1.30.0/#files) |
| imageio-ffmpeg | 0.6.0，Windows x64 wheel 包含音频解码所需 FFmpeg | [PyPI 0.6.0 下载文件](https://pypi.org/project/imageio-ffmpeg/0.6.0/#files) |
| tensorflow-io-gcs-filesystem | 0.31.0，当前 Windows wheel 兼容覆盖 | [PyPI 0.31.0 下载文件](https://pypi.org/project/tensorflow-io-gcs-filesystem/0.31.0/#files) |

Python 3.11.16 的 python.org 页面只提供源码，没有该版官方 Windows 安装器。七音调用固定 uv 获取 Astral 的 `python-build-standalone` 预构建发行版；不要把另装 Python 3.12/3.13 当作替代。这套旧模型依赖限定 Python 3.11，后端也会检查它。此固定版本说明不是“始终使用最新安全版本”的保证，后续升级应由维护者更新依赖并验证。

完整依赖及每个包的允许 SHA-256 见 [windows-requirements.lock.txt](../launcher/windows-requirements.lock.txt)，Windows 覆盖见 [windows-overrides.txt](../launcher/windows-overrides.txt)。当前安装命令只接受二进制 wheel，使用 `https://pypi.org/simple` 与 `--require-hashes`；不要以网上的一条 `pip install --upgrade` 替换整套固定依赖。Spleeter 声明的 GCS 依赖在此被覆盖到 0.31.0；这条本地音频流程不使用 GCS，覆盖本身不代表 Windows 实机验证通过。

音频解码会查找专用/本地或系统 FFmpeg，再尝试 imageio-ffmpeg 包内程序；一般不需另外下载 FFmpeg 安装器。不要从“DLL 修复站”或不明整合包复制可执行文件。

### 下载完整性与目录

- uv ZIP 下载时与代码内 SHA-256 比较：`75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90`。与核对日官方发布资产摘要一致。当前 ZIP 为 18,043,715 字节。
- 四轨模型归档为 146,308,147 字节，约 140 MiB（十进制约 146 MB）。代码固定期望 SHA-256：`3adb4a50ad4eb18c7c4d65fcf4cf2367a07d48408a5eb7d03cd20067429dfaa8`。安装脚本先读取官方 checksum.json，要求其值与固定值一致，再校验下载归档。这里的模型哈希来自本项目固定代码；本次文档核对未重新下载模型计算摘要。
- Python 的具体构建资产由固定 uv 自身的下载元数据选择；七音没有另写一个 Python 归档 URL 或逐资产哈希清单。
- 典型目录：`.runtime/uv.exe`、`.runtime/python/`、`.runtime/venv/`、`.runtime/cache/`、`.runtime/models/4stems/`。成功标记为 `.runtime/ready-desktop-v1.json`。
- 上述哈希检查针对相应下载步骤。在线准备路径会复用已有 uv、环境标记与模型文件，并不是每次启动都重新校验全部文件。不要手工制作“已就绪”标记，也不要把第三方不明 `.runtime` 当作可信安装。

### 输入、输出与限制

主界面优先选择 MP3 / WAV，单文件上限 100 MiB；预览默认 25 秒，整段最多 10 分钟。已有分轨应来自同一首音频且起点一致。四轨分离只是模型估计，不是原工程的独立乐器轨复原；“其他”可能仍混有多种乐器，可能串音、失真或漏音。

Basic Pitch 为有音高声部生成候选音符；鼓保留音频，不强行转成旋律数字。调性、BPM、音符时间和力度都需人工核对，模型分数不是准确率。支持继续编辑、导出 MIDI 和分轨 WAV；**识别工程 JSON 不包含原始或分轨音频**，需要另存 WAV，重新打开后可按界面入口重连。正常退出会清理临时任务文件，不要把临时目录当作备份。

## 二、印刷五线谱：独立安装 Audiveris

### 选哪个官方安装包

当前适配器引用 **Audiveris 5.11.0**；Windows 集成需要读取 `-version` 的控制台输出，因此本指南选择该版 **windowsConsole-x86_64** 安装器。版本验证只确认可获得版本信息，不等于完整兼容性或识谱质量验证。

- [Audiveris 5.11.0 官方发布页](https://github.com/Audiveris/audiveris/releases/tag/5.11.0)
- [直接下载 Audiveris-5.11.0-windowsConsole-x86_64.msi](https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi)
- 文件大小：85,062,430 字节，约 81.1 MiB
- 官方发布资产 SHA-256：`5f1b4e96a12c53c7da426814b76e599363c4181e291855996e0a6878dda95f71`
- [官方安装说明](https://audiveris.github.io/audiveris/_pages/tutorials/install/binaries/)；[官方命令行说明](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/)

这些是 Audiveris 官方资产的直链，不是七音重新分发的安装器。要核对本地文件，可在 PowerShell 对已下载文件运行 `Get-FileHash -Algorithm SHA256 -LiteralPath '实际文件路径'`，与上方摘要逐字比较。哈希一致只说明文件与记录一致，不替代系统安全检查；出现安全拦截、证书或来源警告时，请停下来核对来源，不要直接绕过或关闭保护。

### 安装、语言数据、连接七音

1. 从上面官方入口下载安装器，自行阅读并确认 Audiveris 许可和安装权限，记下安装目录。
2. 先单独启动 Audiveris，确认它能正常打开。官方这一代安装器带自己的 Java 运行时，通常不需要另外安装 Java；七音没有附带或替你安装 Java。
3. 如需标题、歌词等文字 OCR，在 Audiveris 中按官方文档通过 `Tools → Languages` 下载所需语言，再设置相应识别语言。英语为 `eng`；中文需求需选择兼容数据及相应语言设置。安装器没有预装 OCR 语言，单独准备语言数据需要网络。参见 [OCR 语言说明](https://audiveris.github.io/audiveris/_pages/guides/main/languages/)。缺语言时文字识别可能缺失，不表示音符必定识别失败。
4. 回到七音“乐谱导入”，点“配置五线谱识别”。在确认框中选“选择官方 Audiveris.exe”，选择**安装后的** `Audiveris.exe`。常见默认位置为 `C:\Program Files\Audiveris\Audiveris.exe`，实际以你的安装目录为准。不能选择下载的 MSI、快捷方式、BAT / CMD 或其他程序。
5. 七音将运行 `-version`，检查最长 30 秒；成功后应显示“已连接独立安装的 Audiveris；识别结果仍需对照原谱校正。”配置保存在客户端旁 `.runtime/score-omr/score-omr.json`。安装器更新或移动引擎后，重新选择并验证路径。
6. 点“一键导入乐谱”，打开清晰印刷五线谱图片或 PDF，校正旋转和裁切，再点“识别当前页五线谱”。PDF 先“显示这一页”；**当前界面每次只把当前页转成 PNG 送入识别**，不会一次识别整本 PDF。

Audiveris 语言数据的默认 Windows 位置为 `%APPDATA%\AudiverisLtd\audiveris\config\tessdata`；已有 `TESSDATA_PREFIX` 可能改变其位置，以 Audiveris“帮助 / About”显示为准。参见 [官方目录说明](https://audiveris.github.io/audiveris/_pages/reference/folders/essential/)。七音外部引擎模式不替你下载语言数据，也不强制切换成中文 OCR；请先在 Audiveris 中配置。

适配器会限制 Java 的普通 HTTP(S) 请求，但这不是操作系统级的网络沙箱。因此请先完成 Audiveris 自身的安装与语言准备，不能把这项限制理解为对所有外部程序行为的全面审计。

### 识别结果怎么用

- 支持适合 OMR 的清晰**印刷五线谱**；不支持手写谱或数字简谱图片。照片的倾斜、阴影、模糊、裁断谱表都可能影响结果。
- 界面可预览 PNG / JPEG / WebP / PDF，实际送入引擎的是当前校正页 PNG。原谱文件最多 25 MiB；适配器图片限制为 3200 万像素、单边 12000 像素。单次识别最多 5 分钟，可取消。
- 引擎导出 MusicXML / MXL，七音导入为待校正草稿；需要逐小节检查音高、节奏、休止、连音与声部。自动识别不还原原曲音效、歌词发音或全部演奏法。
- 当前界面要求一次取得一份乐谱；如果 Audiveris 输出多份，请先在独立 Audiveris 中整理成一份可导入的 MusicXML。多页作品也可先在 Audiveris 中识别、校正、导出，再回七音导入。
- “保存乐谱工程”生成 `.七音乐谱.json`，包含当前校正信息及原谱；它与数字作曲 JSON、音频识别 JSON、BeepBox JSON 不通用。

## 三、仅在缺少 DLL 时检查 Microsoft VC++ x64 运行库

若日志包含 `MSVCP140`、`VCRUNTIME140` 等缺库信息，或 `DLL load failed` 明确指向微软 C++ 运行库，再检查这一项。**不是所有 DLL 错误都能靠安装 VC++ 解决**，请保留完整错误上下文。

- [微软当前受支持的 Visual C++ Redistributable 下载说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
- [微软官方 x64 下载链接](https://aka.ms/vc14/vc_redist.x64.exe)

该官方永久链接会随微软维护版本变化，不能当作固定版本或固定哈希。本项目不托管安装器，也不会自动接受许可或替你完成系统安装。自行核对发布者、适用系统和许可，按微软安装程序操作，再重启七音重试。不要从非官方 DLL 网站单独下载文件，也不要因下载/安装失败关闭安全检查。

## 四、下载或配置失败时

| 看到的情况 | 建议处理 |
| --- | --- |
| “此版本仅支持 Windows 10/11 x64。” | 核对系统与客户端架构。不要把 32 位、ARM64 原生或其他系统运行环境强行混装。 |
| “客户端所在磁盘可用空间不足 6 GB”或目录不可写 | 先备份工程，关闭七音；确认解压目录可写、磁盘空间充足。移动客户端可能使 Python 环境需重新准备，不能保证直接搬移继续离线运行。 |
| “下载连接超时”“本步骤超时”或“官方下载服务返回 …” | 展开准备日志，看失败在 uv、Python、PyPI 包还是模型步骤。检查系统时间、官方站点可达性以及你所在网络的代理/防火墙规则，必要时请网络管理员协助，稍后重试。能打开发布网页不代表能下载其资产。 |
| “运行时下载 SHA256 校验失败”或 `Official model SHA256 mismatch` | 停止使用该文件，保留错误；通过原官方来源重新准备。不要删掉代码中的哈希检查。 |
| `Official checksum differs from pinned release; manual review required` | 官方校验清单与本版固定值不一致，需要维护者核对并发布修正；不要自行改成新值继续安装。 |
| wheel 不存在、依赖冲突或哈希不符 | 保留完整包名、版本和错误；当前流程只接收匹配平台的二进制 wheel，不能用任意新版本、源码包或第三方镜像替代。 |
| “本机识别服务启动失败 / 启动超时”或“本机组件不完整” | 先看导入、DLL、缺模型或权限错误。准备面板出错后按钮显示“重试校验 / 启动”；重试不会自动修复所有系统依赖。 |
| “未得到有效的 Audiveris 版本信息” | 确认选择的是官方 windowsConsole 安装后的 Audiveris.exe，并先在独立 Audiveris 中检查能否启动。 |
| “引擎已移动或改变，请重新选择并验证 Audiveris。” | 再点“配置五线谱识别”，选择当前安装路径。不要手改配置中的文件大小/时间以跳过检查。 |
| 引擎没有导出乐谱、输出多份、超过 5 分钟 | 用清晰完整的单页先试；减少页面复杂度但不要裁断谱表；必要时先在独立 Audiveris 校正并导出 MusicXML。不要把失败当成一份正确的空乐谱。 |
| 浏览器入口提示需要 Windows 客户端或旧提示提到“离线组件” | 这里的桌面接口需要 Windows 客户端；本公开下载仍不包含额外离线识别引擎，按本指南单独准备即可。 |

下载涉及官方 GitHub 及其资产分发域名、Astral 运行时分发、PyPI / `files.pythonhosted.org` 等。实际失败原因以日志为准，不预设用户所在地区或网络方式，不提供未经核验的镜像。客户端 uv 引导下载仅允许指定官方 GitHub 域名；若官方调整跳转导致“下载地址不在官方允许范围内”，需要维护者核验更新，不应关闭来源限制。

准备面板的日志只保留最近 100 行，重开准备可能刷新；报错时先复制具体步骤、错误和版本信息。分享日志前遮住个人目录、文件名等不必要信息，**不要上传私有音频来证明下载失败**。遇到未查明故障时，仍可继续使用基础作曲和直接导入数字乐谱。

## 五、升级、备份与许可

更新前先分别导出数字作曲、音频识别、乐谱工作区和高级作曲工程，以及重要 WAV / MIDI；检查文件确实保存并可导入。基础 ZIP 建议解压到新目录，不要不加确认覆盖旧客户端。若使用专门的应用层更新包，严格按其说明核对适用基础版并备份；它不替代完整客户端，也不会补齐模型。

保留原有 `.runtime` 和 Audiveris 安装路径，不要把代码目录、模型目录和系统安装器混合覆盖。运行时路径、锁文件或模型脚本变化可能触发重新准备；一个“版本号”或“已就绪”标记不能证明所有组件完整、兼容或安全。此前完整离线组件更新不属于本公开基础下载，不能由本页链接推定已打包提供。

第三方项目各自授权：Spleeter 为 MIT，Basic Pitch / TensorFlow 为 Apache-2.0，ONNX Runtime 为 MIT，uv 为 MIT OR Apache-2.0，Audiveris 为 AGPL-3.0-or-later；Python、Java、OCR 数据和其余依赖应分别查看发行物自带条款。imageio-ffmpeg 的 Python 封装为 BSD-2-Clause，所含 FFmpeg 可执行文件有自身许可，不能据封装许可将其整体称作 BSD。微软运行库适用微软许可。重新分发这些组件时需另行检查完整许可、署名与相应源码义务，本指南不构成可任意再打包的授权。

本项目已有第三方说明见 [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt)。原创代码通用授权仍以 [LICENSE.txt](../LICENSE.txt) 为准，本指南不改变它。软件与模型许可不授予输入录音或乐谱版权；请使用你有权处理和发布的素材。识别结果、速度和资源占用均取决于机器与输入，不保证准确率、实时性能或原曲无损还原。

### 本页来源核对范围

核对日已读取上述官方发布页及资产元数据，确认 uv 0.12.23、Audiveris 5.11.0 windowsConsole 安装器、Spleeter 四轨模型和校验文件的名称、地址与大小；uv / Audiveris 哈希来自官方资产摘要。也核对了 Python / Astral 文档、列出的主要 PyPI 版本页、Audiveris 安装与语言说明、微软下载说明。没有为本页重新下载大型运行时或模型，没有执行 Windows 安装或推理。源码依据为 [桌面准备器](../desktop/setup-manager.cjs)、[OMR 适配器](../desktop/score-omr.cjs)、[模型下载器](../local_service/setup_models.py)、锁文件及当前界面代码。
