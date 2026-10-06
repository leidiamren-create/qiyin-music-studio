#!/usr/bin/env python3
"""Make a source/browser snapshot from an explicit public-file allowlist."""
import hashlib,json,pathlib,zipfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
DIRECTORIES={'advanced','desktop','docs','launcher','licenses','local_service','source-materials','tests','tools','vendor','范例工程'}
ROOT_NAMES={'.gitignore','LICENSE.txt','README.md','THIRD_PARTY_NOTICES.txt','package.json','app.js','audio.js','core.js','samples.js','score-import-core.js','score-ui.js','score-workspace-core.js','style.css','track-tone.js','transcription-core.js','transcription-ui.js','index.html','使用说明.txt','客户端使用说明.txt','乐谱导入使用说明.txt','素材署名.txt','音频识别使用说明.txt'}
SKIP_PARTS={'.git','__pycache__','node_modules','.runtime','.venv','dist','user-data','user-projects'}
def allowed(p):
 r=p.relative_to(ROOT)
 return not any(x in SKIP_PARTS for x in r.parts) and (r.parts[0] in DIRECTORIES or str(r) in ROOT_NAMES) and p.suffix.lower() not in {'.pyc','.pyo','.exe','.dll','.msi','.onnx','.h5','.log'}
def public_files():
 return sorted(p for p in ROOT.rglob('*') if p.is_file() and not p.is_symlink() and allowed(p))
if __name__=='__main__':
 version=json.loads((ROOT/'package.json').read_text())['version'];out=ROOT/'dist';out.mkdir(exist_ok=True)
 target=out/f'qiyin-music-studio-v{version}-source-browser.zip';prefix=f'qiyin-music-studio-v{version}'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for file in public_files():
   info=zipfile.ZipInfo(prefix+'/'+file.relative_to(ROOT).as_posix(),(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
   z.writestr(info,file.read_bytes())
 with zipfile.ZipFile(target) as z:assert z.testzip() is None
 digest=hashlib.sha256(target.read_bytes()).hexdigest();(target.with_suffix('.zip.sha256')).write_text(digest+'  '+target.name+'\n');print(target.name,target.stat().st_size,digest)
