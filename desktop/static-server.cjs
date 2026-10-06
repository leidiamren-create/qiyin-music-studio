'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
function createStudioServer({root,session,backendToken,getBackend}){
 let origin='';
 const server=http.createServer((req,res)=>{
  const fail=(code,error)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
  if(req.headers.host!==new URL(origin).host)return fail(403,'拒绝非本机请求。');
  if(req.headers.origin&&req.headers.origin!==origin)return fail(403,'拒绝跨站请求。');
  const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());
  if(!cookies.includes('studio_session='+session))return fail(403,'客户端会话已过期，请重新打开七音。');
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,origin).pathname);}catch{return fail(400,'地址无效。');}
  if(/[\x00-\x1f\x7f\\]/.test(pathname))return fail(400,'地址包含无效字符。');
  if(pathname.startsWith('/api/')){
   if(!/^\/api\/(health|jobs(?:\/[A-Za-z0-9_-]+(?:\/(?:result|cancel|audio\/(?:original|vocals|bass|drums|other)))?)?)$/.test(pathname))return fail(404,'接口不存在。');
   if(!['GET','POST'].includes(req.method))return fail(405,'请求方式不支持。');
   const port=getBackend();if(!port)return fail(503,'本机识别组件尚未准备。请使用窗口顶部的“准备音频识别”。');
   const headers={'Host':'127.0.0.1:'+port,'X-Studio-Token':backendToken,'Origin':'http://127.0.0.1:'+port};
   for(const key of ['content-type','content-length','x-filename','range'])if(req.headers[key])headers[key]=req.headers[key];
   if(req.method==='POST'&&!headers['content-length'])headers['content-length']='0';
   const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode,{'Content-Type':r.headers['content-type']||'application/octet-stream','Cache-Control':'no-store',...Object.fromEntries(['content-length','content-range','accept-ranges'].filter(k=>r.headers[k]).map(k=>[k,r.headers[k]]))});r.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)fail(503,'本机识别服务连接中断。请在顶部准备面板重试。');else res.destroy();});
   upstream.setTimeout(180000,()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return;
  }
  if(!['GET','HEAD'].includes(req.method))return fail(405,'请求方式不支持。');
  if(pathname==='/')pathname='/index.html';
  const relative=pathname.slice(1),top=relative.split('/')[0];
  const rootFiles=new Set(['index.html','app.js','audio.js','core.js','samples.js','style.css','transcription-core.js','transcription-ui.js','track-tone.js','score-import-core.js','score-workspace-core.js','score-ui.js','乐谱导入使用说明.txt','音频识别使用说明.txt','使用说明.txt','客户端使用说明.txt','THIRD_PARTY_NOTICES.txt']);
  if(!(rootFiles.has(relative)||['vendor','advanced','范例工程'].includes(top)||['desktop/desktop-ui.js','desktop/desktop-ui.css'].includes(relative)))return fail(404,'文件不存在。');
  const target=path.resolve(root,relative);if(!target.startsWith(path.resolve(root)+path.sep))return fail(403,'路径无效。');
  fs.stat(target,(err,stat)=>{if(err||!stat.isFile())return fail(404,'文件不存在。');
   res.setHeader('Content-Type',MIME[path.extname(target)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Security-Policy',"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" + (top==='advanced'?" 'unsafe-eval'":"") + "; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'");
   if(relative==='index.html'){fs.readFile(target,'utf8',(e,text)=>{if(e)return res.end('读取界面失败');res.end(text.replace('</head>','<link rel="stylesheet" href="/desktop/desktop-ui.css"></head>').replace('</body>','<script src="/desktop/desktop-ui.js"></script></body>'));});}
   else if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
  });
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolve(origin);});})};
}
module.exports={createStudioServer};
