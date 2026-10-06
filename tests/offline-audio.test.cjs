'use strict';
// Portable, mocked-runtime tests. These do not execute Windows Python or certify
// TensorFlow, Audiveris, or DLL compatibility on a real Windows machine.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const SOURCE=path.resolve(__dirname,'..');
const original=require('../desktop/offline-audio.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function put(file,bytes) { await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,bytes); }
async function fixture(t,{modifyManifest,extraFiles={},pin,manifestBytes}={}) {
  const home=await fsp.mkdtemp(path.join(os.tmpdir(),'qiyin-offline-test-'));
  t.after(()=>fsp.rm(home,{recursive:true,force:true}));
  const root=path.join(home,'app'),runtime=path.join(home,'.runtime'),bundle=path.join(runtime,'audio-offline-v1');
  const contents={};for(const file of original.REQUIRED_FILES)contents[file]=Buffer.from('fixture '+file);
  contents['python/Lib/site-packages/example/__init__.py']=Buffer.from('VALUE = 1\n');
  Object.assign(contents,extraFiles);
  for(const [relative,bytes] of Object.entries(contents))await put(path.join(bundle,relative),bytes);
  const manifest={schemaVersion:1,bundle:'audio-offline-v1',files:Object.entries(contents).map(([name,bytes])=>({path:name,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))};
  if(modifyManifest)modifyManifest(manifest);
  const bytes=manifestBytes||Buffer.from(JSON.stringify(manifest));await put(path.join(bundle,'manifest.json'),bytes);
  const digest=pin||hash(bytes);
  for(const file of ['launcher/windows-requirements.lock.txt','launcher/windows-overrides.txt','local_service/requirements.txt','local_service/setup_models.py','local_service/server.py','local_service/pipeline.py'])await put(path.join(root,file),await fsp.readFile(path.join(SOURCE,file)));
  await put(path.join(root,'desktop/offline-audio.cjs'),(await fsp.readFile(path.join(SOURCE,'desktop/offline-audio.cjs'),'utf8')).replace(/const PINNED_MANIFEST_SHA256 = '[^']*';/,"const PINNED_MANIFEST_SHA256 = '"+digest+"';"));
  await put(path.join(root,'desktop/setup-manager.cjs'),await fsp.readFile(path.join(SOURCE,'desktop/setup-manager.cjs')));
  const loader=require(path.join(root,'desktop/offline-audio.cjs'));
  const {SetupManager}=require(path.join(root,'desktop/setup-manager.cjs'));
  const offline=new loader.OfflineAudioBundle(runtime);
  const manager=()=>{
    const value=new SetupManager({root,runtime,token:'test-token',notify:()=>{}}),calls={run:[],download:[],start:0,stop:0};
    // Platform check and process execution are mocked deliberately.
    value.assertSupportedPlatform=()=>{};
    value.run=async(exe,args)=>{calls.run.push({exe,args});};
    value.download=async(...args)=>{calls.download.push(args);throw Error('UNEXPECTED NETWORK');};
    value.startBackend=async()=>{calls.start++;};
    value.stopBackend=async()=>{calls.stop++;};
    return {value,calls};
  };
  return {home,root,runtime,bundle,contents,manifest,digest,loader,offline,manager};
}
async function snapshot(directory) {
  const out={};async function walk(dir,relative=''){for(const entry of await fsp.readdir(dir,{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),name);else out[name]=hash(await fsp.readFile(path.join(dir,entry.name)));}}await walk(directory);return out;
}
test('pinned manifest verifies all files by streamed SHA256',async t=>{
  const f=await fixture(t),progress=[];const result=await f.offline.verify({onProgress:p=>progress.push(p)});
  assert.equal(result.files,Object.keys(f.contents).length);assert.equal(result.bytes,Object.values(f.contents).reduce((n,b)=>n+b.length,0));assert.equal(result.manifestSha256,f.digest);assert.equal(progress.at(-1).verifiedFiles,result.files);
});
test('unpackaged trust-anchor placeholder fails closed',async t=>{
  const f=await fixture(t,{pin:'__MANIFEST_SHA256__'});await assert.rejects(f.offline.verify(),/固定的清单校验值/);
});
test('manifest hash checked before parsing untrusted JSON',async t=>{
  const f=await fixture(t,{manifestBytes:Buffer.from('{bad json'),pin:'0'.repeat(64)});await assert.rejects(f.offline.verify(),/清单 SHA256/);
});
test('invalid trusted JSON is rejected',async t=>{
  const f=await fixture(t,{manifestBytes:Buffer.from('{bad json')});await assert.rejects(f.offline.verify(),/有效 JSON/);
});
test('same-size file corruption fails SHA256 before any execution',async t=>{
  const f=await fixture(t),file=path.join(f.bundle,'python/python.exe'),bytes=await fsp.readFile(file);bytes[0]^=1;await fsp.writeFile(file,bytes);await assert.rejects(f.offline.verify(),/文件 SHA256/);
  const {value,calls}=f.manager();await value.prepare();assert.equal(value.state.phase,'error');assert.equal(calls.run.length,0);assert.equal(calls.start,0);assert.equal(calls.download.length,0);
});
test('wrong file size is rejected',async t=>{
  const f=await fixture(t);await fsp.appendFile(path.join(f.bundle,'python/python.exe'),'extra');await assert.rejects(f.offline.verify(),/大小不匹配/);
});
test('missing critical manifest entry is rejected',async t=>{
  const f=await fixture(t,{modifyManifest:m=>m.files=m.files.filter(x=>x.path!=='models/4stems/.probe')});await assert.rejects(f.offline.verify(),/清单缺少必要文件/);
});
test('empty critical model is rejected',async t=>{
  const f=await fixture(t,{extraFiles:{'models/4stems/.probe':Buffer.alloc(0)}});await assert.rejects(f.offline.verify(),/清单缺少必要文件/);
});
test('physically missing file is rejected',async t=>{
  const f=await fixture(t);await fsp.rm(path.join(f.bundle,'models/4stems/model.index'));await assert.rejects(f.offline.verify(),/文件缺失/);
});
for(const unsafe of ['../outside','python/../../outside','/outside','C:/outside','C:outside','\\\\server\\share\\file','python\\other.py','python/a:stream','python/CON','python/nul.txt','python/LPT1.exe','python/COM¹.txt','python/a.','python/a ','python/a~1.py','python//a','python/./a','python/\u0000bad']) {
  test('reject unsafe manifest path '+JSON.stringify(unsafe),async t=>{
    const f=await fixture(t,{modifyManifest:m=>m.files.push({path:unsafe,bytes:1,sha256:'0'.repeat(64)})});await assert.rejects(f.offline.verify(),/不安全|路径别名|越界路径/);
  });
}
test('case-folded duplicate Windows file paths are rejected',async t=>{
  const f=await fixture(t,{modifyManifest:m=>m.files.push({...m.files[0],path:'PYTHON/PYTHON.EXE'})});await assert.rejects(f.offline.verify(),/重复路径/);
});
for(const value of [-1,.5,original.LIMITS.fileBytes+1])test('reject invalid declared file byte count '+value,async t=>{
  const f=await fixture(t,{modifyManifest:m=>m.files[0].bytes=value});await assert.rejects(f.offline.verify(),/无效大小/);
});
test('total payload bytes are bounded',async t=>{
  const f=await fixture(t,{modifyManifest:m=>{for(let i=0;i<5;i++)m.files.push({path:'large'+i,bytes:original.LIMITS.fileBytes,sha256:'0'.repeat(64)});}});await assert.rejects(f.offline.verify(),/总大小超过/);
});
test('manifest file count is bounded',async t=>{
  const f=await fixture(t,{modifyManifest:m=>m.files=Array(original.LIMITS.files+1).fill({path:'a',bytes:0,sha256:'0'.repeat(64)})});await assert.rejects(f.offline.verify(),/文件数量/);
});
for(const name of ['python/Lib/site-packages/injected.pth','python/Lib/site-packages/injected.pyc'])test('reject unlisted startup file '+name,async t=>{
  const f=await fixture(t);await put(path.join(f.bundle,name),'import malicious');await assert.rejects(f.offline.verify(),/未列入清单/);
});
test('reject symbolic-linked executable even with matching target contents',async t=>{
  const f=await fixture(t),file=path.join(f.bundle,'python/python.exe'),outside=path.join(f.home,'outside.exe');await fsp.rename(file,outside);await fsp.symlink(outside,file);await assert.rejects(f.offline.verify(),/符号链接/);
});
test('reject symlinked bundle directory',async t=>{
  const f=await fixture(t),outside=path.join(f.home,'elsewhere');await fsp.rename(f.bundle,outside);await fsp.symlink(outside,f.bundle,'dir');await assert.rejects(f.offline.verify(),/符号链接|重解析/);
});
test('reject symlinked manifest',async t=>{
  const f=await fixture(t),file=path.join(f.bundle,'manifest.json'),outside=path.join(f.home,'manifest.json');await fsp.rename(file,outside);await fsp.symlink(outside,file);await assert.rejects(f.offline.verify(),/符号链接/);
});
test('reject hardlinked payload files',async t=>{
  const f=await fixture(t);await fsp.link(path.join(f.bundle,'python/python.exe'),path.join(f.home,'linked.exe'));await assert.rejects(f.offline.verify(),/硬链接/);
});
test('detect a file changed after its hash completed',async t=>{
  const f=await fixture(t);let changed=false;
  await assert.rejects(f.offline.verify({onProgress:p=>{if(p.verifiedFiles===1&&!changed){changed=true;const file=path.join(f.bundle,'python/python.exe'),bytes=fs.readFileSync(file);bytes[0]^=1;fs.writeFileSync(file,bytes);}}}),/校验期间文件发生变化/);assert.equal(changed,true);
});
test('cancellation interrupts a streaming hash and preserves all payload bytes',async t=>{
  const f=await fixture(t,{extraFiles:{'python/big.dll':Buffer.alloc(8*1024*1024,42)}}),before=await snapshot(f.bundle);let cancelled=false,processed=0;const stop=Object.assign(Error('cancel now'),{code:'TEST_CANCEL'});
  await assert.rejects(f.offline.verify({checkCancel:()=>{if(cancelled)throw stop;},onProgress:p=>{processed=p.verifiedBytes;if(processed>1024*1024)cancelled=true;}}),error=>error===stop);
  assert(processed<2*1024*1024);assert.deepEqual(await snapshot(f.bundle),before);await f.offline.verify();
});
test('generic verifier supports a separately pinned OMR bundle',async t=>{
  const f=await fixture(t),directory=path.join(f.runtime,'score-offline-v1'),payload=Buffer.from('fake audiveris');await put(path.join(directory,'Audiveris/Audiveris.exe'),payload);
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,bundle:'score-offline-v1',files:[{path:'Audiveris/Audiveris.exe',bytes:payload.length,sha256:hash(payload)}]}));await put(path.join(directory,'manifest.json'),bytes);
  const result=await original.verifyBundleFiles(directory,hash(bytes),'score-offline-v1',{requiredFiles:['Audiveris/Audiveris.exe']});assert.equal(result.files,1);assert.equal(original.inspectBundleManifest(directory,hash(bytes),'score-offline-v1').totalBytes,payload.length);
});
test('offline selection uses bundled Python/models and isolated environment',async t=>{
  const f=await fixture(t),{value}=f.manager();assert.equal(value.preparationMode,'offline');assert.equal(value.hasOfflineBundle,true);assert.equal(value.python,path.join(f.bundle,'python/python.exe'));assert.equal(value.modelDir,path.join(f.bundle,'models'));assert.equal(value.marker,path.join(f.runtime,'audio-offline-v1-ready.json'));
  const env=value.env;assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(env.PYTHONDONTWRITEBYTECODE,'1');assert.equal(env.UV_OFFLINE,'1');assert.equal(env.PIP_NO_INDEX,'1');assert.equal(env.ORT_DISABLE_TELEMETRY,'1');assert.equal(env.STUDIO_API_TOKEN,'test-token');assert.equal(env.STUDIO_MODEL_DIR,value.modelDir);assert.equal(env.PYTHONHOME,undefined);assert.equal(env.PYTHONPATH,undefined);
});
test('fully offline prepare writes marker only after import and backend health; preserves old data',async t=>{
  const f=await fixture(t);await put(path.join(f.runtime,'venv/Scripts/python.exe'),'OLD VENV');await put(path.join(f.runtime,'ready-desktop-v1.json'),'OLD MARKER');await put(path.join(f.home,'projects/song.json'),'MY SONG');await put(path.join(f.home,'settings.json'),'MY SETTINGS');const payloadBefore=await snapshot(f.bundle);
  const {value,calls}=f.manager();value.startBackend=async()=>{calls.start++;assert.equal(fs.existsSync(value.marker),false);assert.equal(calls.run.length,1);};
  assert.equal(value.isInstalled(),false);await value.prepare();assert.equal(value.state.phase,'ready');assert.equal(value.isInstalled(),true);assert.equal(calls.download.length,0);assert.equal(calls.run.length,1);assert.equal(calls.run[0].exe,value.python);assert.deepEqual(calls.run[0].args.slice(0,2),['-s','-c']);assert.equal(calls.start,1);
  assert.equal(await fsp.readFile(path.join(f.runtime,'venv/Scripts/python.exe'),'utf8'),'OLD VENV');assert.equal(await fsp.readFile(path.join(f.runtime,'ready-desktop-v1.json'),'utf8'),'OLD MARKER');assert.equal(await fsp.readFile(path.join(f.home,'projects/song.json'),'utf8'),'MY SONG');assert.equal(await fsp.readFile(path.join(f.home,'settings.json'),'utf8'),'MY SETTINGS');assert.deepEqual(await snapshot(f.bundle),payloadBefore);
});
test('missing offline manifest never falls back to online setup',async t=>{
  const f=await fixture(t);await fsp.rm(path.join(f.bundle,'manifest.json'));const {value,calls}=f.manager();await value.prepare();await value.prepare();assert.equal(value.preparationMode,'offline');assert.equal(value.state.phase,'error');assert.equal(calls.download.length,0);assert.equal(calls.run.length,0);assert.equal(calls.start,0);
});
test('ready marker with missing whole offline bundle still fails offline',async t=>{
  const f=await fixture(t);await put(path.join(f.runtime,'audio-offline-v1-ready.json'),'{}');await fsp.rm(f.bundle,{recursive:true});const {value,calls}=f.manager();await value.prepare();await value.prepare();assert.equal(value.preparationMode,'offline');assert.equal(calls.download.length,0);assert.equal(calls.run.length,0);assert.equal(value.isInstalled(),false);
});
test('download method is explicitly disabled in offline mode',async t=>{
  const f=await fixture(t),{SetupManager}=require(path.join(f.root,'desktop/setup-manager.cjs'));const value=new SetupManager({root:f.root,runtime:f.runtime,token:'t',notify:()=>{}});await assert.rejects(value.download('https://github.com/not-contacted',path.join(f.home,'out')),/离线准备不允许/);
});
test('no bundle retains original online selection and readiness marker',async t=>{
  const f=await fixture(t);await fsp.rm(f.bundle,{recursive:true});const {value}=f.manager();assert.equal(value.preparationMode,'online');assert.equal(value.hasOfflineBundle,false);assert.equal(value.python,path.join(f.runtime,'venv/Scripts/python.exe'));assert.equal(value.marker,path.join(f.runtime,'ready-desktop-v1.json'));
  await put(value.python,'old python');await put(value.marker,JSON.stringify({fingerprint:value.fingerprint}));assert.equal(value.isInstalled(),true);assert.equal(value.env.UV_OFFLINE,undefined);
});
test('relocation invalidates marker and repeats verification/import without creating venv',async t=>{
  const f=await fixture(t),{value:first}=f.manager();await first.prepare();assert.equal(first.isInstalled(),true);const previous=first.fingerprint,newRuntime=path.join(f.home,'moved-runtime');await fsp.rename(f.runtime,newRuntime);
  const {SetupManager}=require(path.join(f.root,'desktop/setup-manager.cjs')),moved=new SetupManager({root:f.root,runtime:newRuntime,token:'t',notify:()=>{}});moved.assertSupportedPlatform=()=>{};let imports=0;moved.run=async(exe,args)=>{assert.equal(exe,path.join(newRuntime,'audio-offline-v1/python/python.exe'));assert.equal(args[1],'-c');imports++;};moved.startBackend=async()=>{};moved.stopBackend=async()=>{};moved.download=async()=>{throw Error('network used');};assert.notEqual(moved.fingerprint,previous);assert.equal(moved.isInstalled(),false);await moved.prepare();assert.equal(moved.isInstalled(),true);assert.equal(imports,1);assert.equal(fs.existsSync(path.join(newRuntime,'venv')),false);
});
test('requirements or model setup source changes invalidate offline marker',async t=>{
  const f=await fixture(t),{value}=f.manager();await value.prepare();assert.equal(value.isInstalled(),true);await fsp.appendFile(path.join(f.root,'local_service/setup_models.py'),'\n# changed');assert.equal(value.isInstalled(),false);
});
test('self-test DLL failure keeps payload retryable and provides offline installer guidance',async t=>{
  const f=await fixture(t),{value,calls}=f.manager(),before=await snapshot(f.bundle);value.run=async()=>{throw Error('DLL load failed: MSVCP140.dll');};await value.prepare();assert.equal(value.state.phase,'error');assert.match(value.state.message,/Microsoft 官方 Visual C\+\+ x64 离线运行库/);assert.match(value.state.message,/MSVCP140.dll/);assert.equal(calls.start,0);assert.equal(calls.download.length,0);assert.equal(fs.existsSync(value.marker),false);assert.deepEqual(await snapshot(f.bundle),before);
});
test('backend health failure cannot create a ready marker',async t=>{
  const f=await fixture(t),{value}=f.manager();value.startBackend=async()=>{throw Error('backend not ready');};await value.prepare();assert.equal(value.state.phase,'error');assert.equal(value.isInstalled(),false);assert.equal(fs.existsSync(value.marker),false);
});
test('manager cancel during verification is prompt and permits safe retry',async t=>{
  const f=await fixture(t,{extraFiles:{'python/big.dll':Buffer.alloc(8*1024*1024,7)}}),{value,calls}=f.manager(),before=await snapshot(f.bundle);let cancelled=false;
  value.notify=state=>{if(state.progress>0&&state.progress<.75&&!cancelled){cancelled=true;void value.cancel();}};
  await value.prepare();assert.equal(cancelled,true);assert.equal(value.state.phase,'idle');assert.equal(calls.run.length,0);assert.equal(calls.download.length,0);assert.equal(fs.existsSync(value.marker),false);assert.deepEqual(await snapshot(f.bundle),before);
  value.notify=()=>{};await value.prepare();assert.equal(value.state.phase,'ready');assert.equal(calls.run.length,1);
});
test('ready marker does not bypass later file integrity verification',async t=>{
  const f=await fixture(t),{value,calls}=f.manager();await value.prepare();const file=path.join(f.bundle,'python/python.exe'),bytes=await fsp.readFile(file);bytes[0]^=1;await fsp.writeFile(file,bytes);await value.prepare();assert.equal(value.state.phase,'error');assert.equal(calls.run.length,1);assert.equal(calls.download.length,0);
});
test('Numba/librosa caches stay outside the immutable offline payload',async t=>{
  const f=await fixture(t),{value}=f.manager();await value.prepare();assert.equal(value.state.phase,'ready');
  assert.equal(value.env.NUMBA_CACHE_DIR,path.join(f.runtime,'audio-offline-cache-v1/numba'));assert.equal(value.env.LIBROSA_CACHE_DIR,path.join(f.runtime,'audio-offline-cache-v1/librosa'));assert(fs.statSync(value.env.NUMBA_CACHE_DIR).isDirectory());
  await put(path.join(value.env.NUMBA_CACHE_DIR,'cached.nbc'),'jit cache');await f.offline.verify();
});
test('symlinked mutable cache directory fails closed without writing outside runtime',async t=>{
  const f=await fixture(t),{value,calls}=f.manager(),outside=path.join(f.home,'outside-cache');await fsp.mkdir(outside);await fsp.symlink(outside,path.join(f.runtime,'audio-offline-cache-v1'),'dir');await value.prepare();assert.equal(value.state.phase,'error');assert.equal(calls.run.length,0);assert.deepEqual(await fsp.readdir(outside),[]);
});
test('existing online installation still starts without modifying its environment',async t=>{
  const f=await fixture(t);await fsp.rm(f.bundle,{recursive:true});const {value,calls}=f.manager();await put(value.python,'OLD PYTHON');await put(value.marker,JSON.stringify({fingerprint:value.fingerprint}));const before=await snapshot(f.runtime);await value.prepare();assert.equal(value.state.phase,'ready');assert.equal(calls.run.length,0);assert.equal(calls.download.length,0);assert.equal(calls.start,1);assert.deepEqual(await snapshot(f.runtime),before);
});
test('initial and streamed status expose the selected preparation mode',async t=>{
  const f=await fixture(t),{value}=f.manager(),statuses=[];assert.equal(value.state.preparationMode,'offline');value.notify=s=>statuses.push(s);await value.prepare();assert(statuses.length>0);assert(statuses.every(s=>s.preparationMode==='offline'));
  await fsp.rm(f.bundle,{recursive:true});await fsp.rm(value.marker,{force:true});const {value:online}=f.manager();assert.equal(online.state.preparationMode,'online');online.update({message:'check'});assert.equal(online.state.preparationMode,'online');
});
test('offline ffmpeg is required in the pinned manifest',async t=>{
  const f=await fixture(t,{modifyManifest:m=>m.files=m.files.filter(x=>x.path!=='bin/ffmpeg.exe')});await assert.rejects(f.offline.verify(),/清单缺少必要文件 bin\/ffmpeg.exe/);
});
test('offline ffmpeg environment uses the pinned executable and removes inherited case variants',async t=>{
  const names=['IMAGEIO_FFMPEG_EXE','Imageio_Ffmpeg_Exe','STUDIO_FFMPEG_EXE','studio_ffmpeg_exe'],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
  for(const name of names)process.env[name]='/untrusted/ffmpeg';
  const f=await fixture(t),{value}=f.manager(),env=value.env,expected=path.join(f.bundle,'bin/ffmpeg.exe');assert.equal(env.IMAGEIO_FFMPEG_EXE,expected);assert.equal(env.STUDIO_FFMPEG_EXE,expected);assert.equal(env.Imageio_Ffmpeg_Exe,undefined);assert.equal(env.studio_ffmpeg_exe,undefined);
});
