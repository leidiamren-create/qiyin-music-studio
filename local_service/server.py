"""Loopback-only application server. Audio stays in a private temporary directory."""
from __future__ import annotations
import argparse, atexit, json, math, mimetypes, os, re, secrets, shutil, signal, socket, subprocess, sys, tempfile, threading, time, uuid, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
os.environ['ORT_DISABLE_TELEMETRY']='1'
from pipeline import ROOT, STEMS, dependency_status
APP_ROOT=ROOT.parent
UPLOAD_BYTES=100*1024*1024
ALLOWED_SUFFIXES={'.wav','.mp3','.flac','.ogg','.m4a','.aac','.aif','.aiff','.wma'}
STATIC_DIRS={'vendor','advanced','licenses','范例工程'}
LOCK=threading.RLock()
JOBS={}
TEMP=None
PORT=8765
SHUTTING_DOWN=False
API_TOKEN=os.environ.get('STUDIO_API_TOKEN','')


def stop_process(process):
    if process is None: return
    import psutil
    try:
        parent=psutil.Process(process.pid); children=parent.children(recursive=True)
        for child in reversed(children):
            try: child.terminate()
            except psutil.NoSuchProcess: pass
        try: parent.terminate()
        except psutil.NoSuchProcess: pass
        _,alive=psutil.wait_procs(children+[parent],timeout=3)
        for child in alive:
            try: child.kill()
            except psutil.NoSuchProcess: pass
    except psutil.NoSuchProcess: pass


def cleanup():
    global SHUTTING_DOWN
    SHUTTING_DOWN=True
    with LOCK: processes=[j.get('process') for j in JOBS.values()]
    for process in processes: stop_process(process)
    with LOCK: threads=[j.get('thread') for j in JOBS.values()]
    for thread in threads:
        if thread and thread is not threading.current_thread(): thread.join(timeout=5)
    if TEMP: shutil.rmtree(TEMP,ignore_errors=True)


def public_job(job):
    result={k:job[k] for k in ('id','status','stage','progress','error')}
    if job['status']=='running':
        try:
            update=json.loads((job['path']/'progress.json').read_text(encoding='utf8')); result.update(update)
        except (OSError,ValueError): pass
    return result


def run_job(job):
    work=job['path']; log=None
    try:
        with LOCK:
            if job.get('cancelRequested') or job['status']=='cancelled': return
            job.update(status='running',stage='loading',progress=.01)
        cmd=[sys.executable,str(ROOT/'pipeline.py'),'--input',str(work/'input.audio'),'--work',str(work),'--mode',job['mode'],'--offset',str(job['offset']),'--stem',job['stem'],'--source-name',job['sourceName']]
        if job['full']: cmd.append('--full')
        log=(work/'worker.log').open('wb')
        with LOCK:
            if job.get('cancelRequested') or job['status']=='cancelled': return
            process=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,cwd=str(APP_ROOT))
            job['process']=process
        try: process.wait(timeout=3600)
        except subprocess.TimeoutExpired:
            stop_process(process)
            raise RuntimeError('处理超过 60 分钟，已停止。请改用较短片段。')
        with LOCK:
            if job.get('cancelRequested') or job['status']=='cancelled' or SHUTTING_DOWN: return
            if process.returncode==0 and (work/'result.json').is_file():
                result=json.loads((work/'result.json').read_text(encoding='utf8'))
                result.update(id=job['id'],originalAudioUrl=f"/api/jobs/{job['id']}/audio/original")
                for stem in result['stems']: stem['audioUrl']=f"/api/jobs/{job['id']}/audio/{stem['id']}"
                job.update(status='done',stage='complete',progress=1,result=result)
            else:
                try: error=json.loads((work/'error.json').read_text(encoding='utf8'))['error']
                except (OSError,ValueError,KeyError): error='本地模型未完成。可能内存不足，请关闭其他程序后重试。'
                job.update(status='error',stage='error',error=error[:2000])
    except Exception as error:
        with LOCK:
            if job['status']!='cancelled': job.update(status='error',stage='error',error=str(error)[:2000])
    finally:
        if log: log.close()
        with LOCK: job['process']=None
        (work/'input.audio').unlink(missing_ok=True)
        if job.get('cancelRequested') or job['status'] in ('error','cancelled'):
            for audio in work.glob('*.wav'): audio.unlink(missing_ok=True)


class Server(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=8
    allow_reuse_address=True


class Handler(BaseHTTPRequestHandler):
    server_version='SevenToneLocal/1.2'
    protocol_version='HTTP/1.1'
    def setup(self):
        super().setup(); self.connection.settimeout(30)
    def log_message(self,fmt,*args):
        # Do not log filenames, file paths or query strings.
        pass
    def guarded(self,mutating=False):
        allowed={f'127.0.0.1:{PORT}',f'localhost:{PORT}'}
        if self.headers.get('Host') not in allowed: self.json_response(403,{'error':'Invalid local Host'}); return False
        origin=self.headers.get('Origin')
        valid_origins={'http://'+host for host in allowed}
        if self.headers.get('Sec-Fetch-Site')=='cross-site' or (origin and origin not in valid_origins): self.json_response(403,{'error':'Cross-origin access denied'}); return False
        if urlsplit(self.path).path.startswith('/api/') and API_TOKEN and not secrets.compare_digest(self.headers.get('X-Studio-Token',''),API_TOKEN): self.json_response(403,{'error':'Local API token required'}); return False
        if mutating and origin not in valid_origins: self.json_response(403,{'error':'Open the local application to upload audio'}); return False
        return True
    def send_headers(self,status,mime,length,extra=None):
        self.send_response(status); self.send_header('Content-Type',mime); self.send_header('Content-Length',str(length))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('X-Frame-Options','DENY')
        self.send_header('Cross-Origin-Resource-Policy','same-origin'); self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-store')
        eval_policy=" 'unsafe-eval'" if urlsplit(self.path).path.startswith('/advanced/') else ''
        self.send_header('Content-Security-Policy',f"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'{eval_policy}; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'")
        self.send_header('Connection','close'); self.close_connection=True
        for key,value in (extra or {}).items(): self.send_header(key,value)
        self.end_headers()
    def json_response(self,status,data):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf8'); self.send_headers(status,'application/json; charset=utf-8',len(body))
        if self.command!='HEAD': self.wfile.write(body)
    def serve_file(self,path,audio=False):
        size=path.stat().st_size; start=0; end=size-1; status=200; extra={}
        if audio:
            extra['Accept-Ranges']='bytes'; range_header=self.headers.get('Range')
            if range_header:
                match=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
                if not match or not any(match.groups()): return self.json_response(416,{'error':'Invalid range'})
                if match[1]: start=int(match[1]); end=min(end,int(match[2])) if match[2] else end
                else: start=max(0,size-int(match[2]))
                if start>=size or end<start: return self.json_response(416,{'error':'Invalid range'})
                status=206; extra['Content-Range']=f'bytes {start}-{end}/{size}'
        mime='audio/wav' if audio else (mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        self.send_headers(status,mime,end-start+1,extra)
        if self.command=='HEAD': return
        with path.open('rb') as stream:
            stream.seek(start); remaining=end-start+1
            while remaining:
                chunk=stream.read(min(65536,remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining-=len(chunk)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        if not self.guarded(): return
        path=urlsplit(self.path).path
        if path=='/api/health':
            missing=dependency_status()
            with LOCK: busy=any(j['status'] in ('uploading','queued','running') for j in JOBS.values())
            return self.json_response(200,{'ok':True,'ready':not missing,'missing':missing,'busy':busy,'limits':{'uploadBytes':UPLOAD_BYTES,'previewSeconds':25,'fullSeconds':600,'retainedJobs':8},'engine':{'separator':'Spleeter 2.4.2 / 4stems','transcriber':'Basic Pitch 0.4.0 / ONNX','localOnly':True}})
        match=re.fullmatch(r'/api/jobs/([a-f0-9]{32})(?:/(result|audio/(original|vocals|bass|drums|other)))?',path)
        if match:
            with LOCK: job=JOBS.get(match[1])
            if not job: return self.json_response(404,{'error':'任务不存在或已清理。'})
            if not match[2]: return self.json_response(200,public_job(job))
            if job['status']!='done': return self.json_response(409,{'error':'任务尚未完成。'})
            if match[2]=='result': return self.json_response(200,job['result'])
            file=job['path']/(match[3]+'.wav')
            if not file.is_file(): return self.json_response(404,{'error':'此任务没有该音轨。'})
            return self.serve_file(file,True)
        if path.startswith('/api/'): return self.json_response(404,{'error':'Unknown endpoint'})
        relative=unquote(path).lstrip('/') or 'index.html'
        parts=Path(relative).parts
        if any(p.startswith('.') or p=='..' for p in parts) or (len(parts)>1 and parts[0] not in STATIC_DIRS): return self.json_response(404,{'error':'Not found'})
        file=(APP_ROOT/relative).resolve()
        if not file.is_relative_to(APP_ROOT) or file.suffix.lower() not in {'.html','.js','.mjs','.wasm','.bcmap','.pfb','.ttf','.css','.json','.txt','.mid','.wav','.svg','.png','.ico'} or not file.is_file(): return self.json_response(404,{'error':'Not found'})
        return self.serve_file(file)
    def do_POST(self):
        if not self.guarded(True): return
        parsed=urlsplit(self.path); path=parsed.path
        if self.headers.get('Transfer-Encoding'): return self.json_response(400,{'error':'Chunked uploads are not supported'})
        if path=='/api/shutdown':
            if not API_TOKEN: return self.json_response(403,{'error':'Desktop API token required'})
            self.json_response(200,{'ok':True})
            threading.Thread(target=self.server.shutdown,daemon=True).start()
            return
        match=re.fullmatch(r'/api/jobs/([a-f0-9]{32})/cancel',path)
        if match:
            with LOCK:
                job=JOBS.get(match[1])
                if not job: return self.json_response(404,{'error':'任务不存在。'})
                if job['status'] in ('uploading','queued','running'):
                    job.update(cancelRequested=True,stage='cancelling',error=None); process=job.get('process')
                else: process=None
            stop_process(process)
            with LOCK:
                if job.get('cancelRequested'): job.update(status='cancelled',stage='cancelled')
            return self.json_response(200,public_job(job))
        if path!='/api/jobs': return self.json_response(404,{'error':'Unknown endpoint'})
        missing=dependency_status()
        if missing: return self.json_response(503,{'error':'缺少依赖：'+', '.join(missing)})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>UPLOAD_BYTES: return self.json_response(413,{'error':'音频文件必须为 1 字节至 100 MB。'})
            query=parse_qs(parsed.query,strict_parsing=False)
            mode=query.get('mode',['preview'])[0]; stem=query.get('stem',['other'])[0]; full=query.get('full',['0'])[0]=='1'; offset=float(query.get('offset',['0'])[0])
            if mode not in ('preview','full','stem') or stem not in STEMS or not math.isfinite(offset) or offset<0: raise ValueError()
            name=unquote(self.headers.get('X-Filename','audio.wav'))
            name=re.sub(r'[\x00-\x1f\x7f]','',name.replace('\\','/').split('/')[-1])[:180] or 'audio.wav'
            if Path(name).suffix.lower() not in ALLOWED_SUFFIXES: return self.json_response(415,{'error':'支持 WAV / MP3 / FLAC / OGG / M4A / AAC / AIFF / WMA。'})
        except (ValueError,TypeError): return self.json_response(400,{'error':'无效请求参数。'})
        with LOCK:
            if any(j['status'] in ('uploading','queued','running') for j in JOBS.values()): return self.json_response(409,{'error':'已有任务正在运行，请等待或取消。'})
            while len(JOBS)>=8:
                old=next(iter(JOBS)); shutil.rmtree(JOBS.pop(old)['path'],ignore_errors=True)
            id=uuid.uuid4().hex; work=Path(TEMP)/id; work.mkdir(mode=0o700)
            job={'id':id,'status':'uploading','stage':'uploading','progress':0,'error':None,'path':work,'mode':mode,'stem':stem,'full':full,'offset':offset,'sourceName':name,'process':None}; JOBS[id]=job
        try:
            with (work/'input.audio').open('wb') as stream:
                remaining=size
                while remaining:
                    chunk=self.rfile.read(min(65536,remaining))
                    if not chunk: raise ValueError('上传中断，请重试。')
                    stream.write(chunk); remaining-=len(chunk)
            with LOCK:
                if job['status']!='cancelled': job.update(status='queued',stage='queued')
            thread=threading.Thread(target=run_job,args=(job,),daemon=True); job['thread']=thread; thread.start()
            return self.json_response(202,public_job(job))
        except (ValueError,OSError,socket.timeout) as error:
            with LOCK: job.update(status='error',stage='error',error=str(error))
            shutil.rmtree(work,ignore_errors=True)
            return self.json_response(400,{'error':str(error)})
    def do_OPTIONS(self): self.json_response(403,{'error':'Cross-origin access denied'})


def main():
    global TEMP,PORT
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8765); parser.add_argument('--open-browser',action='store_true'); args=parser.parse_args()
    if not 1024<=args.port<=65535: parser.error('Port must be between 1024 and 65535')
    PORT=args.port
    TEMP=tempfile.mkdtemp(prefix='seven-tone-audio-')
    try: server=Server(('127.0.0.1',PORT),Handler)
    except OSError:
        cleanup(); raise
    atexit.register(cleanup)
    def shutdown_signal(signum,frame):
        threading.Thread(target=server.shutdown,daemon=True).start()
    for sig in (signal.SIGINT,signal.SIGTERM): signal.signal(sig,shutdown_signal)
    url=f'http://127.0.0.1:{PORT}/'
    print(f'本地音频工作室：{url}\n音频仅在本机临时处理。关闭此窗口结束服务并清理音频。',flush=True)
    if args.open_browser: threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close(); cleanup()
if __name__=='__main__': main()
