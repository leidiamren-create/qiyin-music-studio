# BeepBox 4.2.2 简体中文适配

范围：高级编辑器与独立歌曲播放器。包含 610 条精确词条及中文操作说明，覆盖文件/编辑/偏好菜单、音色分类与预设、乐器参数、效果/包络、导入/导出、轨道/小节/恢复/录制设置、51 类动态弹窗与帮助。

## 构建

运行 `python advanced/localization/build.py`。词条维护在 `zh-CN.tsv`，中文静态帮助维护在 `help-zh-CN.html`。构建将 `runtime.js` 与词典内联进两个 HTML，不增加任何网络依赖。再次构建字节结果不变。

可附加 `--verify-upstream /path/to/beepbox_offline.html` 核对原版 4.2.2 文件 SHA-256。`manifest.json` 另固定本包已有离线安全补丁后的原生核心 JS 哈希；若核心变化，构建拒绝继续，必须先审查新版本。构建面向本项目已集成的高级编辑器，不应直接用于其他版本的官网 HTML。

翻译仅应用于可见文本节点、title/aria-label/placeholder 与选项组标签。动态节点及提示更新通过 MutationObserver 处理；不会改写原生合成器、编辑器核心、枚举、option value、事件处理函数、快捷键代码、JSON 字段、乐器预设 ID、URL 数据或 MIDI 文本。没有显式 value 的选项在改字前固定其原值。用户输入、代码、脚本、样式和可编辑区域不做文本转换。

## 测试

需要 Node.js 与 jsdom。使用已安装的 jsdom（或设置 JSDOM_PATH 指向其目录）：

- `node advanced/localization/tests.cjs`
- `node advanced/localization/player-tests.cjs`

已执行 66 项主编辑器检查与播放器检查：全部菜单、预设和 51 类弹窗/帮助覆盖，动态翻译、ARIA 关闭标签、轨道增删、小节/片段操作、原生音色/效果选择、复杂多乐器/效果/包络/弯音工程 JSON/URL 往返、原生 JSON 文件导入、JSON/MIDI/HTML 导出及真实离线合成 WAV 写出。测试中的 Canvas/几何/音频硬件接口为 DOM 替身，不代替真实屏幕或声卡测试。jsdom 不执行导出后的浏览器文件导航，实际生成的 Blob 内容已检查。

## 保留和限制

- 标准音名 C/D/E 等、FM/PWM/MIDI/WAV/JSON/HTML 缩写、Wicki-Hayden 布局名、Imitone/Dubler 品牌、作者姓名、网址与许可证原文保留。
- JSON/MIDI/URL 内部名称保留官方英文，方便与原版兼容；用户文件名保持原样。
- 原版软件库内部调试/异常信息和开发者控制台内容未全面翻译；用户导入预检、主要操作提示与可见参数帮助已中文化。
- 本轮没有执行真实浏览器视觉验收或 Windows 桌面运行验收，不声称完成排版/缩放/声卡/MIDI 硬件验证。中文较短控件标签与弹窗滚动保护已实现，但仍需实际屏幕复核。
- 原作者 John Nesky、BeepBox 署名及 MIT 许可保留。此中文适配不改变歌曲著作权。
