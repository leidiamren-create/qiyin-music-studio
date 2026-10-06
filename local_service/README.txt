七音 1.4.0-public.1 本地识别引擎（开发与技术说明）
========================================

桌面程序由上层客户端启动此服务。服务本身只监听 127.0.0.1，网页与 API 同源。
没有账号、订阅或云端音频上传。首次安装需联网下载官方运行库与模型；处理音频不需要联网。

开发启动
1. 使用 Python 3.11（历史开发环境为 Linux x64 / Python 3.11.16，本次未重测）。Python 3.12 不兼容此旧模型栈。
2. 安装 requirements.txt。
3. python local_service/setup_models.py
4. python local_service/server.py --open-browser

Windows 依赖安装需要上层启动器提供 tensorflow-io-gcs-filesystem 0.31.0 覆盖：
Spleeter 所声明的 0.32.0 没有 Windows CPython3.11 wheel，此工作流不使用云存储。
此覆盖只经过 Windows wheel 解析验证，不能算 Windows 实机运行通过。
FFmpeg 从已安装系统或 imageio-ffmpeg 0.6.0 的官方 PyPI 包取得，无需额外第三方安装器。

引擎
- Deezer Spleeter 2.4.2：官方 4stems 模型，人声 / 贝斯 / 鼓 / 其他。
- Spotify Basic Pitch 0.4.0：对每条有音高音轨提取重叠音符；ONNX CPU 推理。
- 鼓轨保留真实音频，不把鼓打击错误映射为旋律数字。
- 简谱、调性和节拍量化由编辑器处理；此服务输出原音频绝对秒数，不擅自量化。
- 模型激活强度不是正确率。人声与其他轨可能串音，可能产生多余八度音、漏音和时值偏差。

运行保护
100 MiB 文件上限；预览默认25秒；整首最多10分钟。
分离使用带上下文的6秒块；转写使用25秒块，跨块延音通过同音高边界衔接。
检查可用内存与磁盘；一次只处理一个任务；CPU线程上限2。
上传限已知音频格式，FFmpeg 禁用网络与播放列表等非音频解复用器。
音频仅在系统临时目录；成功结果最多保留8个任务，新任务会清理最老结果。
输入文件在任务结束后删除。取消/失败清理 WAV。正常关闭或经认证关闭接口会清理全部临时音频。
系统强制杀进程、崩溃或断电可能留下系统临时文件，不保证安全擦除。

隐私控制
ONNX Runtime 1.30 默认含遥测；本程序在任何原生库导入之前明确设置 ORT_DISABLE_TELEMETRY=1，
并在创建模型会话前调用 disable_telemetry_events()。
官方文档说明前者在非 Windows 平台禁止 uploader、事件和设备标识，API仅关闭非必要事件；
Windows 使用系统 ETW，未开启外部 trace session 时不记录；程序不启动采集会话。
实测修复后无遥测警告，100毫秒连接快照未观察到远程连接；环境不允许 ptrace，未做完整抓包。
这项限制应保留在验证记录中，不能宣称做了完整网络抓包。

桌面集成
STUDIO_MODEL_DIR 指定外部可写模型目录（其中存放4stems子目录）。
STUDIO_API_TOKEN 非空时所有 /api 请求须携带 X-Studio-Token。
POST /api/shutdown 仅令牌模式可用，用于 Windows 优雅关闭；不要向网页暴露令牌。
所有 POST 还必须有正确 Host / Origin，跨域预检拒绝。
API.md 载有完整协议。客户端代理应验证前端来源，重写后端 Host / Origin。

当前验证范围
公开快照只附带可移植加载/适配器测试，见上层 docs/VALIDATION.md。
此前真实模型/HTTP测试脚本和测试音频不在本快照中，不应运行并不存在的测试命令。
本次没有重跑真实模型，不把历史 Linux 结果当成 Windows 实机验证。

授权
代码与模型来源见 licenses/ 和上层 THIRD_PARTY_NOTICES.txt。
Spleeter 源码与预训练模型 MIT；Basic Pitch Apache-2.0；ONNX Runtime MIT。
音频的使用与导出权利由音频来源决定；软件许可证不会授予用户上传歌曲的版权。
