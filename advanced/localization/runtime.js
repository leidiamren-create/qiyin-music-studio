/* Qiyin zh-CN display adapter for pinned BeepBox 4.2.2. See LICENSE.txt; upstream BeepBox remains MIT.
 * Only visible DOM strings and display attributes are translated. Model names,
 * option values, URL encoding, saved JSON, keyboard codes, and user inputs stay intact.
 */
(function () {
'use strict';
const dictionary = /* QIYIN_DICTIONARY */;
function translate(source) {
 const text = String(source), normalized = text.replace(/\s+/g, ' ').trim();
 if (Object.prototype.hasOwnProperty.call(dictionary, normalized)) return text.replace(text.trim(),dictionary[normalized]);
 const m=normalized.match(/^([✓+↑↓⎘▶⚠✎⇱]?\s*)(.*?)(\s*\([^)]*\))?([:：]?)$/);
 if(m && dictionary[m[2]]) return m[1]+dictionary[m[2]]+(m[3]||'')+(m[4]?'：':'');
 let match=normalized.match(/^(flare|twang|swell|tremolo|decay)\s*(\d+)$/);
 if(match)return ({flare:'闪现',twang:'弹拨',swell:'渐强',tremolo:'震音',decay:'衰减'})[match[1]]+' '+match[2];
 match=normalized.match(/^(Voice|Modulator) (\d+) (Frequency|Volume|Amplitude)$/);
 if(match)return (match[1]==='Voice'?'声部':'调制器')+' '+match[2]+' '+({Frequency:'频率',Volume:'音量',Amplitude:'幅度'})[match[3]];
 match=normalized.match(/^(-?[\d.]+) (semitone\(s\)|cent\(s\)|beat\(s\))$/);
 if(match)return match[1]+' '+({'semitone(s)':'半音','cent(s)':'音分','beat(s)':'拍'})[match[2]];
 match=normalized.match(/^Sustain \(([AB])\):?$/);if(match)return '延音（'+(match[1]==='A'?'原声':'明亮')+'）：';
 return text;
}
const skip='script,style,textarea,input,[contenteditable="true"],code,pre';
function walk(root) {
 if(!root || (root.nodeType===1 && root.matches('script,style,textarea,[contenteditable="true"],code,pre')))return;
 if(root.nodeType===3){if(root.parentElement&&root.parentElement.closest(skip))return;const out=translate(root.data);if(out!==root.data){const p=root.parentElement;if(p&&p.tagName==='OPTION'&&!p.hasAttribute('value'))p.setAttribute('value',p.value);root.data=out;}return;}
 if(root.nodeType!==1)return;
 for(const name of ['title','aria-label','placeholder',...(root.tagName==='OPTGROUP'?['label']:[])]){if(root.hasAttribute(name)){const before=root.getAttribute(name),after=translate(before);if(after!==before)root.setAttribute(name,after);}}
 if(root.matches('button.cancelButton')&&!root.hasAttribute('aria-label')){root.setAttribute('aria-label','关闭');root.setAttribute('title','关闭');}
 for(const child of [...root.childNodes])walk(child);
}
const roots=[document.getElementById('beepboxEditorContainer'),document.getElementById('text-content'),document.getElementById('player')].filter(Boolean);
if(!roots.length)roots.push(document.body);
const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='childList')for(const node of record.addedNodes)walk(node);else walk(record.target);}});
for(const root of roots){walk(root);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','label']});}
// Browser-native alert/prompt dialogs do not produce text nodes.
for(const method of ['alert','confirm','prompt']){const original=window[method];if(typeof original==='function')window[method]=function(message,...args){return original.call(window,translate(message),...args);};}
window.QiyinChinese=Object.freeze({translate,refresh:()=>roots.forEach(walk),language:'zh-CN',entries:Object.keys(dictionary).length});
document.documentElement.lang='zh-CN';
})();
