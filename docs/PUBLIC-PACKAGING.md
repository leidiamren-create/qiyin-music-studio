# 公开包范围与第三方材料

此快照只包含应用源码、静态网页资源、测试、署名以及必要的第三方对应源码。浏览器包与 Windows 基础包都不包含个人工程、用户截图、身份信息、授权令牌、私有下载链接、模型或额外本机识别运行库。

## Liberation 1.07.4 字体

PDF.js 的四个 LiberationSans TTF 按原样保留，仍适用 `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` 的 GPLv2 与字体例外，不改标为 MIT 或 OFL。已逐一与 Mozilla `pdf.js/v6.3.289` 中的字体字节比较，匹配。

`source-materials/liberation-fonts-1.07.4.tar.gz` 包含对应 1.07.4 SFD 源码、Makefile、FontForge 构建脚本及原始许可、作者说明。此源代码和字体一起提供；下载基础 Windows 客户端的用户也可在 `resources/app/source-materials/` 取得它。SHA256：

`ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406`

来源、上游说明、逐个字体哈希和构建方法见 `source-materials/README.txt` 与 `source-materials/source-provenance.json`。没有重新构建这些字体，不能宣称完成逐字节可复现构建。

## PDF 资源

保留 PDF.js、CMap、Foxit 字体、OpenJPEG、qcms、JBIG2 的原许可。没有改动 PDF.js 核心代码。未使用的 QuickJS PDF 脚本执行辅助资源未随公开包发布；应用没有运行 PDF 脚本的入口。

## 尚未公开分发的组件

额外音频识别运行库、模型、Audiveris、Java、OCR 语言数据、Visual C++ 安装器等不在公开基础包内。不能因为其中若干项目采用开源许可就推断整个历史离线聚合包适合公开再分发。该聚合包尚需独立处理部分安装器、条件性第三方组件和字体的再分发证据，当前不提供下载。

## 原创代码授权

本次没有获得为原创部分选择 MIT 的明确决定，因此把占位式 MIT 声明改为许可证待定，package.json 设为 UNLICENSED，并保留所有第三方既有许可。这里是公开源码快照，不作整仓已获通用开源许可的宣传。
