'use strict';
// The release builder replaces this token with the SHA256 of the exact manifest
// bytes. Never obtain the trust anchor from the bundle, environment, or renderer.
const PINNED_MANIFEST_SHA256 = '388f6628a83b066235e302460118ea3224bac9e1c0f4a1d0b0e281a0bd9cbd66';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const BUNDLE_NAME = 'audio-offline-v1';
const LIMITS = Object.freeze({manifestBytes:32*1024*1024, files:100000, directories:100000,
  fileBytes:4*1024**3, totalBytes:16*1024**3, pathLength:1024, depth:48});
const REQUIRED_FILES = Object.freeze(['python/python.exe', 'bin/ffmpeg.exe', 'models/4stems/.probe',
  'models/4stems/checkpoint', 'models/4stems/model.index', 'models/4stems/model.data-00000-of-00001']);
function fail(message) { throw Object.assign(new Error('离线组件校验失败：'+message+' 请重新解压完整的七音离线更新包；不会转为联网下载。'), {code:'OFFLINE_AUDIO_INVALID'}); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function comparable(file) { const value=path.resolve(file); return process.platform==='win32'?value.toLowerCase():value; }
function samePath(a,b) { return comparable(a)===comparable(b); }
function isPresent(file) { try { fs.lstatSync(file); return true; } catch(error) { return error.code!=='ENOENT'; } }
function validateRelativePath(value) {
  if(typeof value!=='string'||!value||value.length>LIMITS.pathLength||value.includes('\\')||path.posix.isAbsolute(value)||path.win32.isAbsolute(value)||/[\x00-\x1f\x7f<>:"|?*~]/.test(value)) fail('清单含有不安全的文件路径。');
  const parts=value.split('/');
  if(parts.length>LIMITS.depth||parts.some(part=>!part||part==='.'||part==='..'||/[ .]$/.test(part)||/^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail('清单含有 Windows 路径别名或越界路径。');
  return value;
}
function inspectStat(stat, directory) {
  if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||(!directory&&stat.nlink>1)) fail('不允许符号链接、重解析路径、硬链接或特殊文件。');
}
function ancestors(file) {
  const result=[]; let current=path.resolve(file);
  for(;;) { result.unshift(current); const parent=path.dirname(current); if(parent===current)break; current=parent; }
  return result;
}
function checkPathSync(file,directory) {
  const chain=ancestors(file);
  for(let i=0;i<chain.length;i++) {
    inspectStat(fs.lstatSync(chain[i]),i<chain.length-1||directory);
    if(!samePath(fs.realpathSync(chain[i]),chain[i])) fail('不允许重定向到其他位置的路径。');
  }
  return fs.lstatSync(file);
}
async function checkPath(file,directory,checkCancel) {
  const chain=ancestors(file);
  for(let i=0;i<chain.length;i++) {
    checkCancel(); inspectStat(await fsp.lstat(chain[i]),i<chain.length-1||directory);
    if(!samePath(await fsp.realpath(chain[i]),chain[i])) fail('不允许重定向到其他位置的路径。');
  }
  return fsp.lstat(file);
}
function parseTrustedManifest(bytes,pinnedManifestSha256,bundleName,requiredFiles) {
  if(!/^[a-f0-9]{64}$/.test(pinnedManifestSha256)) fail('此客户端缺少发布者固定的清单校验值。');
  if(bytes.length>LIMITS.manifestBytes||sha256(bytes)!==pinnedManifestSha256) fail('清单 SHA256 与客户端固定值不一致。');
  let manifest; try { manifest=JSON.parse(bytes.toString('utf8')); } catch { fail('清单不是有效 JSON。'); }
  if(!manifest||manifest.schemaVersion!==1||manifest.bundle!==bundleName||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>LIMITS.files) fail('清单格式或文件数量无效。');
  let totalBytes=0; const files=new Map(),aliases=new Set();
  for(const entry of manifest.files) {
    if(!entry||typeof entry!=='object') fail('清单文件记录无效。');
    validateRelativePath(entry.path);
    const alias=entry.path.toLowerCase();
    if(alias==='manifest.json'||aliases.has(alias)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>LIMITS.fileBytes||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)) fail('清单含有重复路径、无效大小或校验值。');
    aliases.add(alias); files.set(entry.path,{path:entry.path,bytes:entry.bytes,sha256:entry.sha256}); totalBytes+=entry.bytes;
    if(totalBytes>LIMITS.totalBytes) fail('文件总大小超过安全上限。');
  }
  for(const name of requiredFiles) if(!files.has(name)||files.get(name).bytes===0) fail('清单缺少必要文件 '+name+'。');
  return {manifest,files,totalBytes,manifestSha256:pinnedManifestSha256};
}
function unchanged(before,after) { return before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs; }
function readBoundedSync(file,expected) {
  const before=fs.lstatSync(file);inspectStat(before,false);
  if(before.size!==expected)fail('读取时文件大小发生变化。');
  const handle=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    if(!unchanged(before,fs.fstatSync(handle)))fail('读取时文件发生变化。');
    const bytes=Buffer.alloc(expected);let offset=0;
    while(offset<expected) { const count=fs.readSync(handle,bytes,offset,expected-offset,null);if(!count)fail('文件意外结束。');offset+=count; }
    if(!unchanged(before,fs.fstatSync(handle))||!unchanged(before,fs.lstatSync(file)))fail('读取时文件发生变化。');
    return bytes;
  } finally { fs.closeSync(handle); }
}
async function readBounded(file,expected,checkCancel,onChunk) {
  checkCancel(); const before=await fsp.lstat(file); inspectStat(before,false);
  if(before.size!==expected) fail('文件大小不匹配：'+path.basename(file)+'。');
  const handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    if(!unchanged(before,await handle.stat())) fail('读取时文件发生变化。');
    const buffer=Buffer.allocUnsafe(256*1024); let total=0;
    while(total<expected) {
      checkCancel(); const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected-total),null); checkCancel();
      if(!bytesRead) fail('文件意外结束。');
      total+=bytesRead; onChunk(buffer.subarray(0,bytesRead));
    }
    checkCancel();
    if(!unchanged(before,await handle.stat())||!unchanged(before,await fsp.lstat(file))) fail('校验期间文件发生变化。');
    return before;
  } finally { await handle.close(); }
}
class BundleVerifier {
  constructor(directory,manifestDigest,bundleName,requiredFiles=[]) { this.directory=path.resolve(directory); this.manifestFile=path.join(this.directory,'manifest.json');this.pinnedManifestSha256=manifestDigest;this.bundleName=bundleName;this.requiredFiles=requiredFiles; }
  inspectSync() {
    try {
      const stat=checkPathSync(this.manifestFile,false);
      if(stat.size>LIMITS.manifestBytes) fail('清单大小超过安全上限。');
      return parseTrustedManifest(readBoundedSync(this.manifestFile,stat.size),this.pinnedManifestSha256,this.bundleName,this.requiredFiles);
    } catch(error) { if(error.code==='OFFLINE_AUDIO_INVALID')throw error; fail('无法读取完整清单（'+(error.code||'读取错误')+'）。'); }
  }
  async inventory(trusted,checkCancel) {
    await checkPath(this.directory,true,checkCancel);
    const pending=[{directory:this.directory,relative:''}],found=new Map(); let directories=0,totalBytes=0;
    while(pending.length) {
      checkCancel(); const item=pending.pop();
      await checkPath(item.directory,true,checkCancel);
      const children=await fsp.opendir(item.directory);
      for await(const child of children) {
        checkCancel(); const relative=item.relative?item.relative+'/'+child.name:child.name; validateRelativePath(relative);
        const file=path.join(item.directory,child.name),stat=await fsp.lstat(file);
        if(stat.isSymbolicLink())fail('不允许符号链接或重解析路径。');
        if(!samePath(await fsp.realpath(file),file))fail('不允许重定向到其他位置的路径。');
        if(stat.isDirectory()) {
          inspectStat(stat,true); if(++directories>LIMITS.directories)fail('文件夹数量超过安全上限。');
          pending.push({directory:file,relative});
        } else {
          inspectStat(stat,false);
          if(relative==='manifest.json')continue;
          const entry=trusted.files.get(relative);
          if(!entry||entry.bytes!==stat.size)fail('文件未列入清单或大小不匹配：'+relative+'。');
          found.set(relative,stat); totalBytes+=stat.size;
          if(found.size>LIMITS.files||totalBytes>LIMITS.totalBytes)fail('文件数量或大小超过安全上限。');
        }
      }
    }
    if(found.size!==trusted.files.size)fail('文件缺失；需要完整解压离线包。');
    return found;
  }
  async verify({checkCancel=()=>{},onProgress=()=>{}}={}) {
    let cancellationError;const cancellationCheck=checkCancel;checkCancel=()=>{try{cancellationCheck();}catch(error){cancellationError=error;throw error;}};
    try {
      checkCancel(); const stat=await checkPath(this.manifestFile,false,checkCancel);
      if(stat.size>LIMITS.manifestBytes)fail('清单大小超过安全上限。');
      const chunks=[]; await readBounded(this.manifestFile,stat.size,checkCancel,chunk=>chunks.push(Buffer.from(chunk)));
      const trusted=parseTrustedManifest(Buffer.concat(chunks),this.pinnedManifestSha256,this.bundleName,this.requiredFiles);
      await this.inventory(trusted,checkCancel);
      let verifiedBytes=0,verifiedFiles=0; const verifiedStats=new Map();
      for(const entry of trusted.files.values()) {
        checkCancel(); const file=path.join(this.directory,...entry.path.split('/')),digest=crypto.createHash('sha256');
        // Recheck ancestors immediately before opening, including junctions.
        await checkPath(file,false,checkCancel);
        const stat=await readBounded(file,entry.bytes,checkCancel,chunk=>{digest.update(chunk);verifiedBytes+=chunk.length;onProgress({verifiedBytes,totalBytes:trusted.totalBytes,verifiedFiles,totalFiles:trusted.files.size});});
        if(digest.digest('hex')!==entry.sha256)fail('文件 SHA256 不匹配：'+entry.path+'。');
        verifiedStats.set(entry.path,stat); verifiedFiles++;
      }
      // Reject files injected/changed while the multi-file scan was in flight.
      const finalInventory=await this.inventory(trusted,checkCancel);
      for(const [relative,stat] of verifiedStats) if(!unchanged(stat,finalInventory.get(relative)))fail('校验期间文件发生变化。');
      checkCancel();
      onProgress({verifiedBytes,totalBytes:trusted.totalBytes,verifiedFiles,totalFiles:trusted.files.size});
      return {manifestSha256:trusted.manifestSha256,files:verifiedFiles,bytes:verifiedBytes};
    } catch(error) { if(error===cancellationError||error.code==='OFFLINE_AUDIO_INVALID'||error.code==='SETUP_CANCELLED')throw error; fail('无法验证完整文件（'+(error.code||error.message)+'）。'); }
  }
}
class OfflineAudioBundle extends BundleVerifier {
  constructor(runtime) { super(path.join(path.resolve(runtime),BUNDLE_NAME),PINNED_MANIFEST_SHA256,BUNDLE_NAME,REQUIRED_FILES);this.runtime=path.resolve(runtime); }
  get marker() { return path.join(this.runtime,'audio-offline-v1-ready.json'); }
  get present() { return isPresent(this.directory)||isPresent(this.marker); }
  get python() { return path.join(this.directory,'python','python.exe'); }
  get modelDir() { return path.join(this.directory,'models'); }
  get ffmpeg() { return path.join(this.directory,'bin','ffmpeg.exe'); }
  get cacheDir() { return path.join(this.runtime,'audio-offline-cache-v1'); }
  async prepareCache(checkCancel=()=>{}) {
    await checkPath(this.runtime,true,checkCancel);
    for(const directory of [this.cacheDir,path.join(this.cacheDir,'numba'),path.join(this.cacheDir,'librosa')]) {
      checkCancel();try { await fsp.mkdir(directory); } catch(error) { if(error.code!=='EEXIST')throw error; }
      await checkPath(directory,true,checkCancel);
    }
  }
  isReady(fingerprint) {
    try {
      this.inspectSync(); const stat=checkPathSync(this.marker,false);
      if(stat.size>16384)return false;
      const marker=JSON.parse(readBoundedSync(this.marker,stat.size).toString('utf8'));
      if(marker.version!==1||marker.manifestSha256!==PINNED_MANIFEST_SHA256||marker.fingerprint!==fingerprint)return false;
      for(const relative of REQUIRED_FILES) if(checkPathSync(path.join(this.directory,...relative.split('/')),false).size===0)return false;
      return true;
    } catch { return false; }
  }
}
// These digest arguments MUST originate in trusted application code, never IPC,
// a user-selected manifest, an archive, or an environment variable.
function inspectBundleManifest(directory,manifestDigest,bundleName,requiredFiles=[]) {
  return new BundleVerifier(directory,manifestDigest,bundleName,requiredFiles).inspectSync();
}
function verifyBundleFiles(directory,manifestDigest,bundleName,{onProgress,checkCancel,requiredFiles=[]}={}) {
  return new BundleVerifier(directory,manifestDigest,bundleName,requiredFiles).verify({onProgress,checkCancel});
}
module.exports={OfflineAudioBundle,PINNED_MANIFEST_SHA256,BUNDLE_NAME,LIMITS,REQUIRED_FILES,validateRelativePath,inspectBundleManifest,verifyBundleFiles};
