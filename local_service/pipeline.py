"""Local, real Spleeter separation and Basic Pitch transcription. No cloud inference."""
from __future__ import annotations
import argparse, importlib.util, json, math, os, re, shutil, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MODEL_ROOT=Path(os.environ.get('STUDIO_MODEL_DIR',str(ROOT/'models'))).resolve()
SAMPLE_RATE=44100
STEMS=('vocals','bass','drums','other')
LABELS={'vocals':'人声（模型估计）','bass':'贝斯（模型估计）','drums':'鼓与打击乐（保留音频）','other':'其他乐器（混合）'}
PREVIEW_SECONDS=25.0
FULL_SECONDS=600.0
CHUNK_SECONDS=6.0
# Official ONNX Runtime process-lifetime opt-out must precede any native import.
os.environ['ORT_DISABLE_TELEMETRY']='1'
os.environ.update(MODEL_PATH=str(MODEL_ROOT),TF_CPP_MIN_LOG_LEVEL='2',TF_NUM_INTRAOP_THREADS='2',TF_NUM_INTEROP_THREADS='1',OMP_NUM_THREADS='2',CUDA_VISIBLE_DEVICES='-1')


def atomic_json(path,data):
    path=Path(path); temp=path.with_suffix('.tmp'); temp.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False),encoding='utf8'); temp.replace(path)


def progress(work,stage,value):
    atomic_json(Path(work)/'progress.json',{'stage':stage,'progress':value})


def find_executable(name):
    if name=='ffmpeg' and os.environ.get('STUDIO_FFMPEG_EXE'):
        bundled=Path(os.environ['STUDIO_FFMPEG_EXE'])
        return str(bundled) if bundled.is_absolute() and bundled.is_file() else None
    local=ROOT/'bin'/(name+'.exe' if os.name=='nt' else name)
    if local.is_file(): return str(local)
    found=shutil.which(name)
    if found: return found
    if name=='ffmpeg':
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except (ImportError,RuntimeError): return None
    return None


def dependency_status():
    missing=[]
    if not (sys.version_info[:2]==(3,11)): missing.append('Python 3.11')
    for module in ('spleeter','tensorflow','basic_pitch','onnxruntime','soundfile','psutil'):
        if importlib.util.find_spec(module) is None: missing.append(module)
    for tool in ('ffmpeg',):
        if not find_executable(tool): missing.append(tool)
    for file in ('checkpoint','model.index','model.data-00000-of-00001','.probe'):
        if not (MODEL_ROOT/'4stems'/file).is_file() or (MODEL_ROOT/'4stems'/file).stat().st_size==0: missing.append('Spleeter weights'); break
    return missing


def checked_command(command,timeout=120):
    result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if result.returncode:
        raise RuntimeError('音频文件无法解码，可能损坏或格式不支持。'+result.stderr.decode('utf8','replace')[-500:])
    return result.stdout


FORMAT_WHITELIST='wav,mp3,flac,ogg,mov,mp4,m4a,3gp,3g2,mj2,aac,aiff,asf'

def probe(path):
    exe=find_executable('ffmpeg')
    if not exe: raise RuntimeError('缺少 ffmpeg，请重新运行安装启动器。')
    result=subprocess.run([exe,'-nostdin','-hide_banner','-protocol_whitelist','file,pipe','-format_whitelist',FORMAT_WHITELIST,'-i',str(path),'-map','0:a:0','-t','0','-f','null','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    text=result.stderr.decode('utf8','replace')
    match=re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)',text)
    if result.returncode or not match or 'Audio:' not in text: raise RuntimeError('无法读取音频：格式不支持、文件损坏，或无法确定时长。')
    duration=int(match[1])*3600+int(match[2])*60+float(match[3])
    if not math.isfinite(duration) or duration<=0: raise RuntimeError('没有找到有效音频或时长。')
    return duration


def memory_guard(full=False):
    import psutil
    available=psutil.virtual_memory().available
    # Six-second model chunks bound working memory, but still require model RAM.
    need=1500*1024**2 if full else 1100*1024**2
    if available<need: raise RuntimeError(f'可用内存不足（{available/1024**3:.1f} GB）。请关闭其他程序后重试；建议 8 GB 以上内存。')
    return available


def decode(source,target,offset,duration):
    exe=find_executable('ffmpeg')
    if not exe: raise RuntimeError('缺少 ffmpeg，请重新运行安装启动器。')
    checked_command([exe,'-nostdin','-v','error','-y','-protocol_whitelist','file,pipe','-format_whitelist',FORMAT_WHITELIST,'-ss',str(offset),'-i',str(source),'-t',str(duration),'-vn','-map','0:a:0','-ac','2','-ar',str(SAMPLE_RATE),'-c:a','pcm_s16le',str(target)],timeout=180)


def separate_stage(work):
    import numpy as np, soundfile as sf
    from spleeter.separator import Separator
    work=Path(work)
    separator=Separator('spleeter:4stems',multiprocess=False)
    # Independent chunks use contextual margins; only the central six seconds are kept.
    # No model is replaced by filtering or another fake "separator".
    with sf.SoundFile(work/'original.wav') as source:
        total=len(source); chunk=int(CHUNK_SECONDS*SAMPLE_RATE); margin=SAMPLE_RATE//2
        outputs={name:sf.SoundFile(work/(name+'.wav'),'w',samplerate=SAMPLE_RATE,channels=2,subtype='PCM_16') for name in STEMS}
        try:
            for start in range(0,total,chunk):
                read_start=max(0,start-margin); end=min(total,start+chunk); read_end=min(total,end+margin)
                source.seek(read_start); data=source.read(read_end-read_start,dtype='float32',always_2d=True)
                result=separator.separate(data)
                trim=start-read_start; length=end-start
                for name in STEMS: outputs[name].write(np.clip(result[name][trim:trim+length],-1,1))
                progress(work,'separating',.10+.50*end/total)
        finally:
            for output in outputs.values(): output.close()


def transcribe_stage(work):
    import numpy as np, soundfile as sf
    import onnxruntime as ort
    ort.disable_telemetry_events()
    import basic_pitch
    from basic_pitch.inference import Model, predict
    work=Path(work); spec=json.loads((work/'spec.json').read_text(encoding='utf8'))
    model_path=Path(basic_pitch.__file__).parent/'saved_models'/'icassp_2022'/'nmp.onnx'
    model=Model(model_path)
    # Limit ONNX CPU thread count explicitly, including on many-core desktops.
    options=ort.SessionOptions(); options.intra_op_num_threads=2; options.inter_op_num_threads=1
    model.model=ort.InferenceSession(str(model_path),sess_options=options,providers=['CPUExecutionProvider'])
    results=[]; names=spec['stems']; offset=spec['offset']; duration=spec['duration']
    for index,name in enumerate(names):
        notes=[]
        if name!='drums':
            with sf.SoundFile(work/(name+'.wav')) as source:
                total=len(source); chunk=25*SAMPLE_RATE; margin=SAMPLE_RATE//2
                for start in range(0,total,chunk):
                    a=max(0,start-margin); end=min(total,start+chunk); b=min(total,end+margin)
                    source.seek(a); data=source.read(b-a,dtype='float32',always_2d=True)
                    if np.max(np.abs(data))<1e-5: continue
                    temp=work/'transcribe-window.wav'; sf.write(temp,data,SAMPLE_RATE,subtype='PCM_16')
                    _,_,events=predict(str(temp),model,onset_threshold=.5,frame_threshold=.3,minimum_note_length=127.7)
                    for event in events:
                        local_start=float(event[0])+a/SAMPLE_RATE; local_end=min(duration,float(event[1])+a/SAMPLE_RATE)
                        # Retain only the central window, including held-note continuations.
                        if local_end<=start/SAMPLE_RATE or local_start>=end/SAMPLE_RATE: continue
                        local_start=max(start/SAMPLE_RATE,local_start); local_end=min(end/SAMPLE_RATE,local_end)
                        if local_end<=local_start: continue
                        score=float(event[3]); midi=int(event[2])
                        if math.isfinite(score) and 0<=midi<=127:
                            notes.append({'start':round(offset+local_start,6),'end':round(offset+local_end,6),'midi':midi,'amplitude':round(max(0,min(1,score)),6),'modelScore':round(score,6),'confidenceLabel':'needs_review'})
                    temp.unlink(missing_ok=True)
                    progress(work,'transcribing',.60+.35*(index+end/total)/len(names))
        notes.sort(key=lambda n:(n['start'],n['midi'],n['end']))
        merged=[]; tails={}
        for note in notes:
            previous=tails.get(note['midi']); boundary=(note['start']-offset)/25
            if previous and abs(boundary-round(boundary))<1e-6 and abs(previous['end']-note['start'])<1e-5:
                previous['end']=note['end']; previous['modelScore']=min(previous['modelScore'],note['modelScore'])
            else: merged.append(note); tails[note['midi']]=note
        notes=merged
        results.append({'id':name,'label':LABELS[name],'noteEvents':notes,'uncertainty':['鼓轨保留原始节奏音频，不自动映射简谱。'] if name=='drums' else ['音高、起止与和弦均为模型估计，需试听核对。','modelScore 是模型音符激活强度，不是正确率。']})
    atomic_json(work/'notes.json',results)


def run(source,work,mode='preview',offset=0.0,stem='other',full=False,source_name=None):
    start=time.monotonic(); source=Path(source).resolve(); work=Path(work).resolve(); work.mkdir(parents=True,exist_ok=True)
    (work/'error.json').unlink(missing_ok=True)
    if mode not in ('preview','full','stem') or stem not in STEMS: raise ValueError('无效分析模式或音轨类型。')
    if not math.isfinite(offset) or offset<0: raise ValueError('开始时间必须是非负秒数。')
    missing=dependency_status()
    if missing: raise RuntimeError('缺少本地依赖：'+', '.join(missing))
    source_duration=probe(source)
    if offset>=source_duration: raise ValueError('开始时间已超出音频长度。')
    full=mode=='full' or (mode=='stem' and full)
    if full and source_duration-offset>FULL_SECONDS: raise ValueError('整首识别最多 10 分钟。请选择片段，或先分段导出。')
    available=memory_guard(full)
    duration=min(source_duration-offset,FULL_SECONDS if full else PREVIEW_SECONDS)
    required=int(duration*SAMPLE_RATE*2*2*6+100*1024**2)
    if shutil.disk_usage(work).free<required: raise RuntimeError('临时磁盘空间不足，请腾出空间后重试。')
    progress(work,'decoding',.03); decode(source,work/'original.wav',offset,duration)
    import soundfile as sf
    info=sf.info(work/'original.wav'); duration=info.frames/info.samplerate
    names=[stem] if mode=='stem' else list(STEMS)
    spec={'offset':offset,'duration':duration,'stems':names}; atomic_json(work/'spec.json',spec)
    if mode=='stem': shutil.copyfile(work/'original.wav',work/(stem+'.wav'))
    else:
        subprocess.run([sys.executable,str(ROOT/'pipeline.py'),'--stage','separate','--work',str(work)],check=True)
    subprocess.run([sys.executable,str(ROOT/'pipeline.py'),'--stage','transcribe','--work',str(work)],check=True)
    results=json.loads((work/'notes.json').read_text(encoding='utf8'))
    warnings=['分离仅输出人声、贝斯、鼓、其他四类，不能保证分清每一种乐器。','结果含漏音、重叠、串音和边界误差；需要人工试听、校正。']
    if not full and duration<source_duration-offset: warnings.append('本次只处理前 25 秒片段；整首需另外选择。')
    if duration>CHUNK_SECONDS and mode!='stem': warnings.append('为限制内存使用采用带上下文的 6 秒分块；块边界可能有瑕疵。')
    result={'version':1,'mode':mode,'sourceName':source_name or source.name,'sourceDuration':source_duration,'offset':offset,'duration':duration,'stems':results,'warnings':warnings,'estimates':None,'engine':{'separator':'Spleeter 2.4.2 / official 4stems' if mode!='stem' else None,'transcriber':'Basic Pitch 0.4.0 / ONNX','chunkSeconds':CHUNK_SECONDS,'localOnly':True},'metrics':{'elapsedSeconds':round(time.monotonic()-start,3),'availableMemoryAtStartBytes':available}}
    atomic_json(work/'result.json',result); progress(work,'complete',1.0)
    return result


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--input'); parser.add_argument('--work',required=True); parser.add_argument('--mode',default='preview'); parser.add_argument('--offset',type=float,default=0); parser.add_argument('--stem',default='other'); parser.add_argument('--full',action='store_true'); parser.add_argument('--source-name'); parser.add_argument('--stage',choices=['separate','transcribe'])
    args=parser.parse_args()
    try:
        if args.stage=='separate': separate_stage(args.work)
        elif args.stage=='transcribe': transcribe_stage(args.work)
        else:
            if not args.input: parser.error('--input is required')
            result=run(args.input,args.work,args.mode,args.offset,args.stem,args.full,args.source_name)
            print(json.dumps({'ok':True,'duration':result['duration'],'notes':{s['id']:len(s['noteEvents']) for s in result['stems']},'metrics':result['metrics']},ensure_ascii=False))
    except Exception as error:
        if not isinstance(error,subprocess.CalledProcessError) or not (Path(args.work)/'error.json').is_file():
            atomic_json(Path(args.work)/'error.json',{'error':str(error)})
        print(str(error),file=sys.stderr); sys.exit(1)
if __name__=='__main__': main()
