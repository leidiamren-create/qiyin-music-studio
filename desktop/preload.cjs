'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('QiyinDesktop',Object.freeze({
 scoreOmrStatus:()=>ipcRenderer.invoke('studio:score-omr-status'),
 scoreOmrConfigure:()=>ipcRenderer.invoke('studio:score-omr-configure'),
 scoreOmrRecognize:input=>ipcRenderer.invoke('studio:score-omr-recognize',input),
 scoreOmrCancel:()=>ipcRenderer.invoke('studio:score-omr-cancel'),
 status:()=>ipcRenderer.invoke('studio:status'),
 prepare:()=>ipcRenderer.invoke('studio:prepare'),
 cancel:()=>ipcRenderer.invoke('studio:cancel'),
 onStatus:callback=>{if(typeof callback!=='function')return;const listener=(_event,status)=>callback(status);ipcRenderer.on('studio:status',listener);return ()=>ipcRenderer.removeListener('studio:status',listener);},
 onOpen:callback=>{if(typeof callback==='function')ipcRenderer.on('studio:open-setup',()=>callback());}
}));
