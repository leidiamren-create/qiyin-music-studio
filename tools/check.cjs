'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.name.startsWith('.')||['node_modules','dist','source-materials'].includes(item.name))continue;const f=path.join(dir,item.name);if(item.isDirectory())walk(f);else if(/\.(?:js|cjs|mjs)$/.test(item.name)){if(f===path.join(root,'advanced/localization/runtime.js')){new (require('node:vm').Script)(fs.readFileSync(f,'utf8').replace('/* QIYIN_DICTIONARY */','{}'));count++;continue;}const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);count++;}else if(item.name.endsWith('.json'))JSON.parse(fs.readFileSync(f,'utf8'));}}
walk(root);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)){if(/^(?:https?:|data:|#)/.test(m[1]))continue;if(!fs.existsSync(path.resolve(root,m[1].split('?')[0])))throw Error('Missing root asset: '+m[1]);}
for(const name of ['advanced/index.html','advanced/player/index.html'])for(const m of fs.readFileSync(path.join(root,name),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new (require('node:vm').Script)(m[1]);
console.log(`${count} JavaScript files syntax-checked; JSON and root script/style resource references checked.`);
