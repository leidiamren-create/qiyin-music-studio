#!/usr/bin/env python3
"""Rebuild the self-contained display localization. No upstream code replacements."""
import hashlib,json,pathlib,re,sys
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent
START='<!-- QIYIN_ZH_CN_BEGIN -->'
END='<!-- QIYIN_ZH_CN_END -->'
manifest=json.loads((HERE/'manifest.json').read_text())
if len(sys.argv)==3 and sys.argv[1]=='--verify-upstream':
 assert hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest()==manifest['upstream_offline_sha256'], 'Unexpected upstream version/hash'
base=(ROOT/'index.html').read_text()
core=base[base.index('var beepbox='):base.index('let qiyinHashWarning')]
assert hashlib.sha256(core.encode()).hexdigest()==manifest['native_core_sha256'], 'Native offline core changed: audit before repinning'
dictionary={} 
for line in (HERE/'zh-CN.tsv').read_text().splitlines():
 if not line or line.startswith('#'):continue
 en,zh=line.split('\t',1)
 if en in dictionary:raise ValueError('Duplicate translation: '+en)
 dictionary[en]=zh
runtime=(HERE/'runtime.js').read_text().replace('/* QIYIN_DICTIONARY */',json.dumps(dictionary,ensure_ascii=False))
for file in [ROOT/'index.html',ROOT/'player/index.html']:
 html=file.read_text()
 html=re.sub(re.escape(START)+r'[\s\S]*?'+re.escape(END)+r'\n?','',html)
 if file.name=='index.html' and file.parent==ROOT:
  start=html.index('<div id="text-content">')
  end=html.index('<script type="text/javascript">',start)
  html=html[:start]+(HERE/'help-zh-CN.html').read_text().rstrip()+'\n\t'+html[end:]
 bundle=START+'\n<style>.beepboxEditor{font-family:system-ui,"Microsoft YaHei",sans-serif}.beepboxEditor .prompt{max-width:calc(100vw - 32px);max-height:85vh;overflow:auto}.beepboxEditor .tip{line-height:1.5}</style>\n<script>\n'+runtime+'\n</script>\n'+END
 assert '</body>' in html
 html=html.replace('</body>',bundle+'\n</body>').replace('<html lang="en">','<html lang="zh-CN">')
 file.write_text(html)
print(f'Built {len(dictionary)} exact display translations into editor and player.')
