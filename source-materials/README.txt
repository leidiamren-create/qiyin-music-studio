Liberation Sans 1.07.4 corresponding source

The four unmodified LiberationSans font files bundled by PDF.js6.3.289 are covered by GPLv2 with the Liberation font exception. The license does not change to the surrounding application license.

This directory supplies their upstream SFD source, Makefile, FontForge scripts, copyright notices and licensing text. Keep it alongside a redistributed binary release, with a clear link to this source directory. The fonts remain replaceable by user-modified versions. Read UPSTREAM-License.txt and UPSTREAM-COPYING.

Original source archive: https://releases.pagure.org/liberation-fonts/liberation-fonts-1.07.4.tar.gz
Official source project: https://github.com/liberationfonts/liberation-1.7-fonts
SHA256: ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406

All four local TTFs were compared byte-for-byte with the pinned Mozilla PDF.jsv6.3.289 files; their internal font version is1.07.4. Source files and build version were inspected, but a bit-for-bit FontForge rebuild was not performed. See source-provenance.json for exact hashes/URLs.

Build: install FontForge, extract the source tarball, run make in liberation-fonts-1.07.4. Original README and scripts are included. This is developer-only; normal app use does not build fonts or access the network. If changing font family/version, PDF.js glyph widths/scaling mappings may also need regeneration; do not swap in2.x while retaining1.x mappings.
