"""Download only official Deezer weights, verify pinned SHA256, extract safe members."""
from pathlib import Path
import hashlib, json, os, shutil, tarfile, tempfile, urllib.request
ROOT=Path(__file__).resolve().parent
MODEL_URL='https://github.com/deezer/spleeter/releases/download/v1.4.0/4stems.tar.gz'
PINNED_SHA256='3adb4a50ad4eb18c7c4d65fcf4cf2367a07d48408a5eb7d03cd20067429dfaa8'
CHECKSUM_URL='https://github.com/deezer/spleeter/releases/download/v1.4.0/checksum.json'

def main():
    target=Path(os.environ.get('STUDIO_MODEL_DIR',str(ROOT/'models'))).resolve()/'4stems'
    if all((target/name).is_file() and (target/name).stat().st_size>0 for name in ('.probe','checkpoint','model.index','model.data-00000-of-00001')):
        print('已检测到完整 Spleeter 四轨模型。',flush=True); return
    target.parent.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(CHECKSUM_URL,timeout=60) as response:
        expected=json.load(response)['4stems']
        if expected!=PINNED_SHA256: raise RuntimeError('Official checksum differs from pinned release; manual review required')
    with tempfile.TemporaryDirectory(prefix='model-download-',dir=target.parent) as temp:
        temp=Path(temp); archive=temp/'4stems.tar.gz'; digest=hashlib.sha256()
        print('正在下载官方四轨模型（约146 MB）…',flush=True)
        with urllib.request.urlopen(MODEL_URL,timeout=120) as response, archive.open('wb') as out:
            size=0; next_progress=10*1024*1024
            while chunk:=response.read(1024*1024):
                size+=len(chunk)
                if size>300*1024*1024: raise RuntimeError('Model archive exceeds safe limit')
                digest.update(chunk); out.write(chunk)
                if size>=next_progress:
                    print(f'模型已下载 {size/1024/1024:.0f} / 140 MiB',flush=True)
                    next_progress+=10*1024*1024
        if digest.hexdigest()!=expected: raise RuntimeError('Official model SHA256 mismatch')
        extracted=temp/'extracted'; extracted.mkdir()
        with tarfile.open(archive,'r:gz') as tar:
            members=tar.getmembers()
            if sum(x.size for x in members)>600*1024*1024: raise RuntimeError('Model extraction too large')
            for member in members:
                p=Path(member.name)
                if member.issym() or member.islnk() or not (member.isfile() or member.isdir()) or p.is_absolute() or '..' in p.parts:
                    raise RuntimeError('Unsafe model archive member')
                tar.extract(member,extracted)
        if not (extracted/'model.index').is_file(): raise RuntimeError('Missing model index')
        (extracted/'.probe').write_text('OK',encoding='utf8')
        (extracted/'provenance.json').write_text(json.dumps({'url':MODEL_URL,'sha256':expected,'downloadBytes':size},indent=2),encoding='utf8')
        if target.exists(): shutil.rmtree(target)
        extracted.rename(target)
        print(f'模型已安装，SHA256 校验通过；下载 {size:,} 字节。',flush=True)
if __name__=='__main__': main()
