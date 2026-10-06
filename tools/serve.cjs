'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream'};
const ROOT_FILES = new Set(['index.html','app.js','audio.js','core.js','samples.js','style.css','transcription-core.js','transcription-ui.js','track-tone.js','score-import-core.js','score-workspace-core.js','score-ui.js','使用说明.txt','客户端使用说明.txt','音频识别使用说明.txt','乐谱导入使用说明.txt','THIRD_PARTY_NOTICES.txt']);
function createServer() {
 return http.createServer((req,res) => {
  const fail=(code,text)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8'});res.end(text);};
  const allowedHosts=new Set(['127.0.0.1:'+req.socket.localPort,'localhost:'+req.socket.localPort]);
  if(!allowedHosts.has(req.headers.host))return fail(403,'仅支持本机访问');
  if(!['GET','HEAD'].includes(req.method))return fail(405,'只支持静态资源读取');
  let rel;try { rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html'; } catch {return fail(400,'无效路径');}
  if(/[\\\x00-\x1f\x7f]/.test(rel)||rel.split('/').some(s=>s.startsWith('.')))return fail(403,'无效路径');
  if(!(ROOT_FILES.has(rel)||['vendor','advanced','范例工程'].includes(rel.split('/')[0])))return fail(404,'资源不存在；静态服务不提供识别 API');
  const file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep))return fail(403,'无效路径');
  fs.realpath(file,(err,real)=>{
   if(err||!real.startsWith(ROOT+path.sep))return fail(404,'资源不存在');
   fs.stat(real,(err,stat)=>{
    if(err||!stat.isFile())return fail(404,'资源不存在');
    res.writeHead(200,{'Content-Type':MIME[path.extname(real)]||'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    if(req.method==='HEAD')return res.end();
    const stream=fs.createReadStream(real);stream.on('error',()=>res.destroy());stream.pipe(res);
   });
  });
 });
}
if(require.main===module) {
 const port=Number(process.env.PORT||8765);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT 必须为 1–65535');
 const server=createServer();server.listen(port,'127.0.0.1',()=>console.log(`七音本机浏览器入口：http://127.0.0.1:${port}\n按 Ctrl+C 结束。此服务不提供音频识别。`));server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={createServer};
