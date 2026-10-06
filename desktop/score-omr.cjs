'use strict';
// Separate Audiveris CLI adapter. The offline update aggregates an unmodified
// AGPL-3.0 engine and its own notices/source. Never accept executable paths from renderer IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {OfflineOmrBundle}=require('./offline-omr.cjs');

const LIMITS = Object.freeze({inputBytes:25*1024*1024, imagePixels:32000000,
  imageSide:12000, selectedPages:8, maxPageNumber:10000, timeoutSeconds:300,
  outputBytes:16*1024*1024, workBytes:128*1024*1024, outputFiles:8});
const CAPABILITIES = Object.freeze({printedStaff:true, handwritten:false,
  numberedNotation:false, formats:['png','jpg','jpeg','pdf'], automaticAccuracyGuaranteed:false});
const SOURCES = Object.freeze({release:'https://github.com/Audiveris/audiveris/releases/tag/5.11.0',
  license:'https://github.com/Audiveris/audiveris/blob/5.11.0/LICENSE',
  cli:'https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/'});

function scoreError(code,message){const error=new Error(message);error.code=code;return error;}
function newJob(){const job={work:null,child:null,cancelled:false};job.done=new Promise(resolve=>{job.resolveDone=resolve;});return job;}
function bytesOf(value){
  if(value instanceof ArrayBuffer)return Buffer.from(value);
  if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  throw scoreError('INVALID_INPUT','请选择 PNG、JPEG 图片或 PDF 文件。');
}
function jpegSize(bytes){
  let at=2;
  while(at+3<bytes.length){
    if(bytes[at++]!==0xff)throw scoreError('INVALID_IMAGE','JPEG 文件结构无效。');
    while(bytes[at]===0xff)at++;
    const marker=bytes[at++];
    if(marker===0xda||marker===0xd9)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(at+2>bytes.length)break;
    const length=bytes.readUInt16BE(at);
    if(length<2||at+length>bytes.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      if(length<8)break;
      return {width:bytes.readUInt16BE(at+5),height:bytes.readUInt16BE(at+3)};
    }
    at+=length;
  }
  throw scoreError('INVALID_IMAGE','无法读取 JPEG 图片尺寸。');
}
function validateInput(payload){
  if(!payload||typeof payload!=='object')throw scoreError('INVALID_INPUT','缺少乐谱文件。');
  const bytes=bytesOf(payload.bytes);
  if(!bytes.length||bytes.length>LIMITS.inputBytes)throw scoreError('INPUT_LIMIT','乐谱文件必须为 1 字节至 25 MiB。');
  const name=String(payload.name||'score').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||'score';
  let extension,size;
  if(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
    extension='.png';size={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }else if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8){extension='.jpg';size=jpegSize(bytes);}
  else if(bytes.subarray(0,5).toString('ascii')==='%PDF-')extension='.pdf';
  else throw scoreError('INVALID_INPUT','只支持真正的 PNG、JPEG 或 PDF 文件；不支持 SVG、手写谱或简谱照片。');
  if(size&&(!size.width||!size.height||size.width>LIMITS.imageSide||size.height>LIMITS.imageSide||size.width*size.height>LIMITS.imagePixels))
    throw scoreError('IMAGE_LIMIT','图片超过 3200 万像素或单边 12000 像素，请先缩小或裁剪。');
  const pages=payload.pages===undefined?[1]:payload.pages;
  if(!Array.isArray(pages)||!pages.length||pages.length>LIMITS.selectedPages||pages.some(p=>!Number.isSafeInteger(p)||p<1||p>LIMITS.maxPageNumber)||new Set(pages).size!==pages.length)
    throw scoreError('PAGE_LIMIT','一次请选择 1–8 个不重复的 PDF 页码（从 1 开始）。');
  if(extension!=='.pdf'&&(pages.length!==1||pages[0]!==1))throw scoreError('PAGE_LIMIT','图片只有第 1 页。');
  return {bytes,name,extension,pages:[...pages].sort((a,b)=>a-b),size};
}
async function statEngine(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||/[\x00-\x1f]/.test(file))throw scoreError('INVALID_ENGINE','请选择官方安装的 Audiveris 程序。');
  const base=path.basename(file).toLowerCase();
  if(process.platform==='win32'?base!=='audiveris.exe':!['audiveris','audiveris.exe'].includes(base))
    throw scoreError('INVALID_ENGINE','请选择 Audiveris.exe；不运行 .bat、.cmd、安装包或任意命令。');
  const resolved=await fs.realpath(file), stat=await fs.stat(resolved);
  if(!stat.isFile())throw scoreError('INVALID_ENGINE','Audiveris 程序路径无效。');
  return {path:resolved,size:stat.size,mtimeMs:stat.mtimeMs};
}
async function killTree(child){
  if(!child?.pid)return;
  if(process.platform==='win32'){
    await new Promise(resolve=>{
      const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});
      let settled=false;
      const finish=failed=>{if(settled)return;settled=true;clearTimeout(timer);if(failed){try{child.kill('SIGKILL');}catch{}}resolve();};
      const timer=setTimeout(()=>{try{killer.kill();}catch{}finish(true);},5000);
      killer.once('error',()=>finish(true));killer.once('close',code=>finish(code!==0));
    });
  }else{try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}}
}
async function listWork(root,depth=0){
  if(depth>12)throw scoreError('OUTPUT_LIMIT','识别输出文件层级过多，已停止。');
  let bytes=0,files=[];
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    const file=path.join(root,entry.name);
    if(entry.isSymbolicLink())throw scoreError('INVALID_OUTPUT','识别输出包含不安全的符号链接。');
    if(entry.isDirectory()){const child=await listWork(file,depth+1);bytes+=child.bytes;files.push(...child.files);}
    else if(entry.isFile()){
      // Engines legitimately replace/delete intermediate files between readdir
      // and stat. A disappeared file is not a resource-limit violation.
      try{bytes+=(await fs.stat(file)).size;files.push(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(bytes>LIMITS.workBytes||files.length>256)throw scoreError('OUTPUT_LIMIT','识别临时输出过大，已停止。');
  }
  return {bytes,files};
}

class ScoreOmrManager{
  constructor({configDir,runtime=null,tempRoot=os.tmpdir(),timeoutMs=LIMITS.timeoutSeconds*1000}={}){
    if(!configDir)throw Error('configDir is required');
    this.configFile=path.join(configDir,'score-omr.json');this.tempRoot=tempRoot;
    this.bundled=runtime?new OfflineOmrBundle(runtime):null;
    this.timeoutMs=Math.min(LIMITS.timeoutSeconds*1000,Math.max(10,timeoutMs));this.active=null;
  }
  async _config(){try{return JSON.parse(await fs.readFile(this.configFile,'utf8'));}catch{return null;}}
  _isBundledPath(file){if(!this.bundled?.directory||typeof file!=='string')return false;const rel=path.relative(path.resolve(this.bundled.directory),path.resolve(file));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
  async _resolveEngine({verify=false,job=null}={}){
    const config=await this._config();
    if(config?.engine?.path&&config.version&&!this._isBundledPath(config.engine.path)){try{const current=await statEngine(config.engine.path);if(current.size===config.engine.size&&current.mtimeMs===config.engine.mtimeMs)return {...current,version:config.version,bundled:false};}catch{}}
    if(this.bundled?.present){
      this.bundled.inspect();
      if(verify)await this.bundled.verify(()=>{if(job?.cancelled)throw scoreError('SETUP_CANCELLED','已取消识别。');});
      return {...await statEngine(this.bundled.engine),version:'5.11.0',bundled:true,tessdata:this.bundled.tessdata};
    }
    return null;
  }
  async getStatus(){
    const config=await this._config();let engine=null,error=null;
    try{engine=await this._resolveEngine();}catch(e){error=e.message;}
    const available=!!engine;
    return {configured:!!config||!!engine,available,busy:!!this.active,engine:'Audiveris',version:engine?.version||null,
      license:'AGPL-3.0',external:true,bundled:!!engine?.bundled,limits:LIMITS,capabilities:CAPABILITIES,sources:SOURCES,
      message:error||(available?(engine.bundled?'已找到内置的独立 Audiveris；识别前会校验本机文件，无需下载。':'已连接独立安装的 Audiveris；识别结果仍需对照原谱校正。'):config?'引擎已移动或改变，请重新选择并验证 Audiveris。':'公开基础版不含识谱引擎；请选择你独立安装的官方 Audiveris。历史离线更新不在本公开下载中提供。')};
  }
  async _run(engine,args,job,{timeoutMs=this.timeoutMs,monitor,timeoutMessage='本次识别超过 5 分钟，已停止。请裁剪后按单页重试。',tessdata=null}={}){
    if(job.cancelled)throw scoreError('CANCELLED','已取消识别。');
    // No shell, arbitrary flags, URLs, source names or renderer-provided paths.
    const env={...process.env};
    for(const key of Object.keys(env))if(/^(JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH)$/i.test(key)||(tessdata&&/^TESSDATA_PREFIX$/i.test(key)))delete env[key];
    // Blocks Java's ordinary HTTP(S) download/update requests. This is a defense
    // in depth, NOT an OS network sandbox for a separately installed executable.
    env.JAVA_TOOL_OPTIONS='-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=9 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=9 -Djava.net.useSystemProxies=false -XX:ActiveProcessorCount=4';
    env._JAVA_OPTIONS='-Xmx2048m';
    if(tessdata)env.TESSDATA_PREFIX=tessdata;
    const cache=path.join(job.work,'native-cache');await fs.mkdir(cache,{recursive:true,mode:0o700});
    const cacheOption=JSON.stringify(cache.split(path.sep).join('/'));
    env.JAVA_TOOL_OPTIONS+=' -Dorg.bytedeco.javacpp.cachedir='+cacheOption+' -Djna.tmpdir='+cacheOption+' -Djava.io.tmpdir='+cacheOption;
    const child=spawn(engine,args,{shell:false,windowsHide:true,detached:process.platform!=='win32',cwd:job.work,env,stdio:['ignore','pipe','pipe']});
    job.child=child;
    let output='',outputSize=0,failure=null,checking=false;
    const fail=error=>{if(!failure){failure=error;void killTree(child);}};
    const collect=data=>{outputSize+=data.length;if(outputSize>256*1024)fail(scoreError('OUTPUT_LIMIT','识别引擎日志过大，已停止。'));else output+=data.toString('utf8');};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    const timeout=setTimeout(()=>fail(scoreError('TIMEOUT',timeoutMessage)),timeoutMs);
    const watcher=monitor?setInterval(async()=>{if(checking)return;checking=true;try{await monitor();}catch(error){fail(error);}finally{checking=false;}},500):null;
    try{
      const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
      if(job.cancelled)throw scoreError('CANCELLED','已取消识别。');
      if(failure)throw failure;
      if(outcome.code!==0){const diagnostic=output.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(-1600);const error=scoreError('ENGINE_FAILED','Audiveris 未完成识别（退出码 '+outcome.code+'）。请确认谱面清晰、完整。'+(diagnostic?'\n引擎诊断：'+diagnostic:''));error.engineExitCode=outcome.code;error.engineSignal=outcome.signal;throw error;}
      return output;
    }finally{clearTimeout(timeout);if(watcher)clearInterval(watcher);job.child=null;}
  }
  async configure(enginePath){
    if(this.active)throw scoreError('BUSY','请先等待或取消当前识别任务。');
    const job=newJob();this.active=job;
    try{
      const engine=await statEngine(enginePath);
      if(this._isBundledPath(enginePath)||this._isBundledPath(engine.path)){await this.bundled.verify(()=>{if(job.cancelled)throw scoreError('SETUP_CANCELLED','已取消配置。');});}
      await fs.mkdir(this.tempRoot,{recursive:true});job.work=await fs.mkdtemp(path.join(this.tempRoot,'qiyin-omr-check-'));
      const output=await this._run(engine.path,['-version'],job,{timeoutMs:30000,timeoutMessage:'引擎版本检查超过 30 秒，已停止。请先确认 Audiveris 能够正常启动。'});
      const version=/Audiveris[\s\S]{0,600}?(?:Version\s*:\s*|\bv)(\d+\.\d+(?:\.\d+)?)/i.exec(output)?.[1];
      if(!version)throw scoreError('INVALID_ENGINE','未得到有效的 Audiveris 版本信息。请使用官方带控制台版本。');
      if(job.cancelled)throw scoreError('CANCELLED','已取消配置。');
      await fs.mkdir(path.dirname(this.configFile),{recursive:true});
      await fs.writeFile(this.configFile,JSON.stringify({version,engine},null,2),{mode:0o600});
    }finally{try{if(job.work)await fs.rm(job.work,{recursive:true,force:true});}finally{this.active=null;job.resolveDone();}}
    return this.getStatus();
  }
  async recognize(payload){
    if(this.active)throw scoreError('BUSY','已有乐谱识别任务正在运行。');
    const input=validateInput(payload),job=newJob();this.active=job;
    try{
      const status=await this.getStatus();if(!status.available)throw scoreError('NOT_CONFIGURED',status.message);
      const engine=await this._resolveEngine({verify:true,job});
      if(!engine)throw scoreError('NOT_CONFIGURED',status.message);
      await fs.mkdir(this.tempRoot,{recursive:true});job.work=await fs.mkdtemp(path.join(this.tempRoot,'qiyin-omr-'));
      const source=path.join(job.work,'score'+input.extension),output=path.join(job.work,'output');
      await fs.mkdir(output);await fs.writeFile(source,input.bytes,{mode:0o600});
      const engineLog=await this._run(engine.path,['-batch','-transcribe','-export',...(engine.bundled?['-constant','org.audiveris.omr.text.Language.defaultSpecification=eng+chi_sim']:[]),'-output',output,'-sheets',...input.pages.map(String),'--',source],job,{monitor:()=>listWork(job.work),tessdata:engine.tessdata});
      const candidates=(await listWork(output)).files.filter(file=>/\.(mxl|musicxml|xml)$/i.test(file)).sort();
      if(!candidates.length)throw scoreError('NO_RESULT','引擎没有导出可读取的乐谱。请换用清晰、完整的印刷五线谱，或先在 Audiveris 中校正。');
      if(candidates.length>LIMITS.outputFiles)throw scoreError('OUTPUT_LIMIT','导出乐章过多，请分段识别。');
      const files=[];let total=0;
      for(const file of candidates){
        const stat=await fs.stat(file);total+=stat.size;
        if(!stat.size||total>LIMITS.outputBytes)throw scoreError('OUTPUT_LIMIT','导出的 MusicXML 文件过大或为空。');
        const bytes=await fs.readFile(file);
        if(/\.mxl$/i.test(file)?(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50):!/<score-(?:partwise|timewise)\b/.test(bytes.toString('utf8',0,8192)))
          throw scoreError('INVALID_OUTPUT','引擎输出不是有效的 MusicXML；没有生成替代音符。');
        files.push({name:path.basename(file),bytes:new Uint8Array(bytes)});
      }
      return {files,sourceName:input.name,pages:input.pages,engine:{name:'Audiveris',version:status.version,license:'AGPL-3.0',external:true,bundled:!!engine.bundled},
        warnings:['光学识谱可能漏音、错音或误判节奏；请对照原谱逐小节试听校正。',
          input.extension==='.pdf'?`只处理所选 PDF 页码：${input.pages.join('、')}。未自动识别整本 PDF。`:'仅支持清晰的印刷五线谱；不支持手写谱或简谱图片。',
          ...(/Could not initialize TessBaseAPI|No OCR is available|Tesseract data could not be found/i.test(engineLog)?['文字 OCR 未成功，歌词、标题及文字标记可能缺失；请在 Audiveris 中准备兼容的 OCR 语言数据。']:[])]};
    }finally{try{if(job.work)await fs.rm(job.work,{recursive:true,force:true});}finally{this.active=null;job.resolveDone();}}
  }
  async cancel(){const job=this.active;if(!job)return {cancelled:false};job.cancelled=true;await killTree(job.child);await job.done;return {cancelled:true};}
}
module.exports={ScoreOmrManager,LIMITS,CAPABILITIES,SOURCES,validateInput,jpegSize};
