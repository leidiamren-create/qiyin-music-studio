'use strict';
const {app,BrowserWindow,Menu,ipcMain,dialog,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {createStudioServer}=require('./static-server.cjs');const {SetupManager}=require('./setup-manager.cjs');const {ScoreOmrManager}=require('./score-omr.cjs');
app.setName('七音音乐工作室');app.commandLine.appendSwitch('lang','zh-CN');
app.commandLine.appendSwitch('disable-features','HardwareMediaKeyHandling');
let win,origin,server,setup,scoreOmr,closing=false,confirming=false;
const root=path.resolve(__dirname,'..'),portable=app.isPackaged?path.dirname(process.execPath):path.resolve(root,'..');
const runtime=path.join(portable,'.runtime');
// Keep Chromium's ordinary preferences separate from the portable inference components.
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(async()=>{
  scoreOmr=new ScoreOmrManager({configDir:path.join(runtime,'score-omr'),runtime});
  const cookieToken=crypto.randomBytes(32).toString('hex'),backendToken=crypto.randomBytes(32).toString('hex');
  setup=new SetupManager({root,runtime,token:backendToken,notify:s=>{if(win&&!win.isDestroyed())win.webContents.send('studio:status',s);}});
  const host=createStudioServer({root,session:cookieToken,backendToken,getBackend:()=>setup.backendPort});server=host.server;origin=await host.listen();
  const ses=session.defaultSession;
  await ses.cookies.set({url:origin,name:'studio_session',value:cookieToken,httpOnly:true,sameSite:'strict',path:'/'});
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
  ses.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{const url=new URL(details.url);allowed=url.origin===origin||['blob:','data:'].includes(url.protocol);}catch{}callback({cancel:!allowed});});
  ses.on('will-download',(_event,item)=>{const base=path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');item.setSaveDialogOptions({title:'保存七音导出文件',defaultPath:path.join(app.getPath('downloads'),base)});});
  win=new BrowserWindow({width:1440,height:960,minWidth:960,minHeight:680,title:'七音音乐工作室',backgroundColor:'#f6f8fc',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
  win.once('ready-to-show',()=>win.show());
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const trusted=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
  win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('will-prevent-unload',event=>{const choice=dialog.showMessageBoxSync(win,{type:'question',title:'关闭七音？',message:'工程可能还有未保存的修改，或音频任务正在运行。',detail:'选择“继续关闭”会停止本机识别服务。建议先保存工程。',buttons:['返回并保存','继续关闭'],defaultId:0,cancelId:0});if(choice===1)event.preventDefault();});
  function assertSender(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trusted(event.senderFrame.url))throw Error('拒绝非主界面请求。');}
  ipcMain.handle('studio:score-omr-status',async event=>{assertSender(event);return scoreOmr.getStatus();});
  ipcMain.handle('studio:score-omr-configure',async event=>{assertSender(event);if(confirming)throw Error('请先完成当前对话框。');confirming=true;try{
   const consent=await dialog.showMessageBox(win,{type:'question',title:'配置独立五线谱识别引擎',message:'配置你已安装的官方 Audiveris 程序？',detail:'官方来源：https://github.com/Audiveris/audiveris/releases\n本公开基础版不附带 Audiveris。请先自行从官方安装，再在这里选择。Audiveris 采用 AGPL-3.0，独立运行，不改标为 MIT。请选择官方 Audiveris.exe。七音只在本机传入当前页图像并读取导出的乐谱。识别有错误，需要人工校正；不支持手写谱或简谱图片。将保存所选程序路径用于今后识别。不要选择不明来源程序。',buttons:['取消','选择官方 Audiveris.exe'],defaultId:0,cancelId:0});if(consent.response!==1)return {cancelled:true};
   const picked=await dialog.showOpenDialog(win,{title:'选择已安装的官方 Audiveris.exe',properties:['openFile'],filters:[{name:'Audiveris 可执行程序',extensions:['exe']}]});if(picked.canceled||picked.filePaths.length!==1)return {cancelled:true};return scoreOmr.configure(picked.filePaths[0]);
  }finally{confirming=false;}});
  ipcMain.handle('studio:score-omr-recognize',async(event,input)=>{assertSender(event);return scoreOmr.recognize(input);});
  ipcMain.handle('studio:score-omr-cancel',async event=>{assertSender(event);await scoreOmr.cancel();return {cancelled:true};});
  ipcMain.handle('studio:status',event=>{assertSender(event);return setup.state;});
  ipcMain.handle('studio:prepare',async event=>{assertSender(event);if(setup.active||confirming||setup.state.phase==='ready')return;confirming=true;try{
   const ready=setup.isInstalled(),offline=setup.hasOfflineBundle;
   if(!ready){const result=await dialog.showMessageBox(win,{type:'question',title:'准备本机音频识别',message:offline?'启用更新包内置的音频识别组件？':'现在下载并安装七音专用识别组件？',detail:offline?'先校验客户端旁 .runtime 中的全部运行时与模型，再启动本机服务；这一步不联网、不重新下载。建议 8 GB 内存并保留至少 2 GB 临时工作空间。不会修改系统 PATH，音频只在本机处理。若系统缺少微软 Visual C++ 运行库，会明确报错；请从微软官方网站获取适用运行库，并自行确认许可及 Windows 权限。本公开基础版不附带安装程序。第三方许可与来源说明随更新提供。':'将从 Astral / Python 包仓库 / Deezer 官方来源下载约 1–2 GB，需要约 6 GB 可用空间。写入客户端旁的 .runtime 文件夹；不需要管理员，不修改系统 PATH。音频留在本机，不上传。依赖和模型均采用开源许可，许可说明已随客户端提供。网络受限时可能失败，可取消并稍后重试。',buttons:['取消',offline?'校验并启用':'下载并准备'],defaultId:0,cancelId:0});if(result.response!==1)return;}
   void setup.prepare();return {started:true};
  }finally{confirming=false;}});
  ipcMain.handle('studio:cancel',async event=>{assertSender(event);await setup.cancel();});
  const openSetup=()=>{if(new URL(win.webContents.getURL()).pathname.startsWith('/advanced/')){void dialog.showMessageBox(win,{title:'准备音频识别',message:'请先保存高级歌曲，再通过“七音 → 返回七音主界面”打开准备面板。',buttons:['知道了']});}else win.webContents.send('studio:open-setup');};
  const returnHome=async()=>{if(new URL(win.webContents.getURL()).pathname.startsWith('/advanced/')){const answer=await dialog.showMessageBox(win,{type:'question',title:'返回七音主界面',message:'高级歌曲请先通过“文件 → 导出歌曲”保存 JSON。',detail:'返回主界面会离开高级编辑器。',buttons:['取消','已保存，返回'],defaultId:0,cancelId:0});if(answer.response!==1)return;}await win.loadURL(origin+'/');};
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'七音',submenu:[{label:'返回七音主界面',click:returnHome},{label:'音频识别准备 / 日志',click:openSetup},{type:'separator'},{label:'退出',role:'quit'}]},
   {label:'编辑',submenu:[{label:'撤销',role:'undo'},{label:'重做',role:'redo'},{type:'separator'},{label:'剪切',role:'cut'},{label:'复制',role:'copy'},{label:'粘贴',role:'paste'},{label:'全选',role:'selectAll'}]},
   {label:'视图',submenu:[{label:'放大',role:'zoomIn'},{label:'缩小',role:'zoomOut'},{label:'恢复默认大小',role:'resetZoom'},{label:'切换全屏',role:'togglefullscreen'}]},
   {label:'帮助',submenu:[{label:'关于七音',click:()=>dialog.showMessageBox(win,{title:'七音音乐工作室',message:'七音音乐工作室 v1.4.0-public.1 · Windows x64 公开基础版',detail:'数字作曲、音效、高级作曲与本机音频识别。\n高级编辑器基于开源 BeepBox 系列，许可证见随附说明。\nElectron '+process.versions.electron+'。本客户端未购买代码签名证书。\n请仅打开可信工程，勿绕过系统安全警告。',buttons:['知道了']})}]}]));
  await win.loadURL(origin+'/');
  if(setup.isInstalled())void setup.prepare();
 }).catch(error=>{dialog.showErrorBox('七音未能启动',error.message+'\n请完整解压客户端后重试，不要在压缩包内打开。');app.quit();});
 async function finishQuit(){if(closing)return;closing=true;try{if(scoreOmr)await scoreOmr.cancel();if(setup){await setup.cancel();await setup.stopBackend();}if(server)server.close();}finally{app.quit();}}
 // Only stop services after the window actually closes. Cancelling beforeunload keeps everything alive.
 app.on('window-all-closed',()=>{void finishQuit();});
 app.on('before-quit',event=>{if(closing)return;event.preventDefault();if(win&&!win.isDestroyed())win.close();else void finishQuit();});
}
