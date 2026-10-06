/* 七音 digital score import. Original code. See LICENSE.txt. No network, eval, or file extraction.
 * Quarter-note beats are exact source timing, never implicit quantization.
 * MusicXML semantics: https://www.w3.org/2021/06/musicxml40/
 * ZIP is read in memory with bounded streaming inflation and CRC verification.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScoreImportCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var FORMAT = 'numbered-music-score', VERSION = 1;
  var MAX_FILE_BYTES = 16 * 1024 * 1024, MAX_EXPANDED_BYTES = 48 * 1024 * 1024;
  var MAX_EVENTS = 100000, MAX_PARTS = 256, MAX_BEATS = 10000000, EPS = 1e-8;
  var INSTRUMENTS = ['piano','guitar','bass','flute','strings','brass','organ','percussion'];
  function fail(message, code) { var e = new Error(message); e.code = code || 'INVALID_SCORE'; throw e; }
  function num(v, min, max, label) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(label + ' 超出范围'); return v; }
  function int(v, min, max, label) { num(v,min,max,label); if (!Number.isInteger(v)) fail(label+' 必须为整数'); return v; }
  function txt(v, max, label) { if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail(label+' 文字无效或过长'); return v; }
  function obj(v,label) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(label+' 必须为对象'); for (var k of ['__proto__','prototype','constructor']) if(Object.prototype.hasOwnProperty.call(v,k)) fail(label+' 包含不安全字段'); return v; }
  function arr(v,max,label) { if(!Array.isArray(v)||v.length>max) fail(label+' 数量超出范围'); return v; }
  function bool(v,label) {if(typeof v!=='boolean')fail(label+' 必须为布尔值');return v;}
  function warn(score, text) { if (!score.warnings.includes(text)) score.warnings.push(text); }
  function bytes(input) { var a = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null; if (!a || a.byteLength > MAX_FILE_BYTES) fail('文件无效或超过 16 MB 上限','FILE_SIZE'); return a; }
  function decode(a, strict) { try { return new TextDecoder('utf-8',{fatal:!!strict}).decode(a); } catch(e) { fail('文件不是有效的 UTF-8 文字','TEXT_ENCODING'); } }
  function decodeXml(a) { if(a[0]===255&&a[1]===254)return new TextDecoder('utf-16le',{fatal:true}).decode(a);if(a[0]===254&&a[1]===255)return new TextDecoder('utf-16be',{fatal:true}).decode(a);if(a[0]===0&&a[1]===60)return new TextDecoder('utf-16be',{fatal:true}).decode(a);if(a[0]===60&&a[1]===0)return new TextDecoder('utf-16le',{fatal:true}).decode(a);return decode(a,true); }
  function b64(a) { if(typeof Buffer!=='undefined')return Buffer.from(a).toString('base64');var out='';for(var i=0;i<a.length;i+=32768)out+=String.fromCharCode.apply(null,a.subarray(i,i+32768));return btoa(out); }
  function instrument(program,channel) { if(channel===9)return 'percussion';if(program<8)return 'piano';if(program>=16&&program<24)return 'organ';if(program>=24&&program<32)return 'guitar';if(program>=32&&program<40)return 'bass';if(program>=40&&program<56)return 'strings';if(program>=56&&program<72)return 'brass';if(program>=72&&program<80)return 'flute';return 'organ'; }
  function base(type,name) { return {format:FORMAT,version:VERSION,title:name||'导入的乐谱',source:{format:type,name:name||''},parts:[],events:[],tempos:[],timeSignatures:[],keySignatures:[],totalBeats:0,warnings:[],originalData:{format:type,encoding:'text',data:''}}; }
  function tonic(fifths,mode) { var offset={major:0,ionian:0,dorian:2,phrygian:4,lydian:5,mixolydian:7,minor:9,aeolian:9,locrian:11}[mode]||0;return ((7*fifths+offset)%12+12)%12; }
  function sortEvents(a,b) { return a.beat-b.beat || (a.midiPitch==null?-1:a.midiPitch)-(b.midiPitch==null?-1:b.midiPitch) || a.id.localeCompare(b.id); }
  function finish(s) {
    s.parts.forEach(function(p){p.events.sort(sortEvents);});s.events=s.parts.flatMap(function(p){return p.events;}).sort(sortEvents);
    if(s.events.length>MAX_EVENTS)fail('音符/休止符超过 '+MAX_EVENTS+' 个，未截断导入','EVENT_LIMIT');
    s.totalBeats=Math.max(s.totalBeats,...s.parts.map(function(p){return p.events.reduce(function(m,e){return Math.max(m,e.beat+e.duration);},0);}));
    function map(values, fallback, label, global) { values.sort(function(a,b){return a.beat-b.beat;});if(!values.some(function(v){return v.beat===0;}))values.unshift(fallback); if(global){var out=[];values.forEach(function(v){var old=out[out.length-1];if(old&&Math.abs(old.beat-v.beat)<EPS){if(old.bpm!==v.bpm)warn(s,'同一拍有冲突的'+label+'；按文件中的最后一个值播放，原始文件完整保留。');out[out.length-1]=v;}else out.push(v);});return out;} return values; }
    s.tempos=map(s.tempos,{beat:0,bpm:120},'速度',true);s.timeSignatures=map(s.timeSignatures,{beat:0,numerator:4,denominator:4},'拍号');s.keySignatures=map(s.keySignatures,{beat:0,fifths:0,mode:'major',tonic:0},'调号');
    return validateScore(s);
  }
  function parseMidi(input,options) {
    var a=bytes(input),pos=0,s=base('midi',options&&options.name),raw=[],sequence=0,ends=[],trackNames=[],trackCount,ppq;
    s.originalData={format:'midi',encoding:'base64',data:b64(a)};
    function need(n,end){if(pos+n>(end==null?a.length:end))fail('MIDI 数据被截断','TRUNCATED_MIDI');}
    function u8(end){need(1,end);return a[pos++];}function u16(){return u8()*256+u8();}function u32(){return u8()*16777216+u8()*65536+u8()*256+u8();}
    function ascii(n){need(n);var t=String.fromCharCode.apply(null,a.subarray(pos,pos+n));pos+=n;return t;}
    function vlq(end){var n=0;for(var i=0;i<4;i++){var v=u8(end);n=n*128+(v&127);if(!(v&128))return n;}fail('MIDI 可变长度数超过四字节','INVALID_MIDI');}
    if(ascii(4)!=='MThd')fail('不是标准 MIDI 文件','INVALID_MIDI');var hlen=u32();if(hlen<6||hlen>a.length-pos)fail('MIDI 文件头长度无效');var format=u16();trackCount=u16();var division=u16();
    if(format===2)fail('MIDI 格式 2 含多个独立时间线；请导出格式 0 或 1 后导入','UNSUPPORTED_MIDI_FORMAT');if(format!==0&&format!==1)fail('不支持的 MIDI 格式','UNSUPPORTED_MIDI_FORMAT');if(!trackCount||trackCount>MAX_PARTS||format===0&&trackCount!==1)fail('MIDI 音轨数量无效或超过 256 轨');if(division&32768)fail('暂不支持 SMPTE 时间制 MIDI；请导出 PPQ 格式 MIDI','UNSUPPORTED_MIDI_TIMING');ppq=division;if(!ppq)fail('MIDI PPQ 不能为零');pos+=hlen-6;s.source.ppq=ppq;s.source.midiFormat=format;
    for(var ti=0;ti<trackCount;ti++) {
      if(ascii(4)!=='MTrk')fail('MIDI 缺少 MTrk 音轨');var length=u32();need(length);var end=pos+length,tick=0,running=0,ended=false;
      while(pos<end){if(raw.length>MAX_EVENTS*20)fail('MIDI 事件过多','EVENT_LIMIT');tick+=vlq(end);if(tick/ppq>MAX_BEATS)fail('MIDI 时间线过长');var status=u8(end);if(status<128){if(!running)fail('MIDI running status 没有前置状态');pos--;status=running;}else if(status<240)running=status;else running=0;
        if(status===255){var type=u8(end),size=vlq(end);need(size,end);var data=a.subarray(pos,pos+size);pos+=size;
          if(type===47){if(size!==0)fail('MIDI 结束事件长度无效');ended=true;if(pos<end)fail('MIDI 结束事件后仍有数据，拒绝静默忽略','INVALID_MIDI');break;}
          if(type===81){if(size!==3)fail('MIDI 速度事件长度无效');var us=data[0]*65536+data[1]*256+data[2];if(!us)fail('MIDI 速度值不能为零');s.tempos.push({beat:tick/ppq,bpm:60000000/us});}
          else if(type===88){if(size!==4||!data[0]||data[1]>15)fail('MIDI 拍号无效');s.timeSignatures.push({sourceTrack:ti,beat:tick/ppq,numerator:data[0],denominator:Math.pow(2,data[1]),clocksPerClick:data[2],notated32nds:data[3]});}
          else if(type===89){if(size!==2)fail('MIDI 调号无效');var fifths=data[0]>127?data[0]-256:data[0],mode=data[1]===1?'minor':'major';if(fifths < -7||fifths>7||data[1]>1)fail('MIDI 调号无效');s.keySignatures.push({sourceTrack:ti,beat:tick/ppq,fifths:fifths,mode:mode,tonic:tonic(fifths,mode)});}
          else if(type===3){trackNames[ti]=decode(data).replace(/[\u0000-\u001f]/g,' ').slice(0,240);if(ti===0&&trackNames[ti])s.title=trackNames[ti];}
          else if([1,2,4,5,6,7,32,33,84,127].includes(type))warn(s,'MIDI 文字、歌词、标记、SMPTE 偏移及厂商元数据仅保留在原始文件，不转换为可编辑谱面。');
          else warn(s,'MIDI 含未转换的元事件（0x'+type.toString(16)+'）；原始文件完整保留。');
        } else if(status===240||status===247){var count=vlq(end);need(count,end);pos+=count;warn(s,'MIDI SysEx 音源设置仅保留在原始文件；试听使用七音内置音色。');}
        else if(status>=128&&status<=239){var command=status>>4,channel=status&15,d1=u8(end),d2=(command===12||command===13)?null:u8(end);if(d1>=128||d2!==null&&d2>=128)fail('MIDI 通道事件数据无效');raw.push({tick:tick,track:ti,channel:channel,type:command,a:d1,b:d2,seq:sequence++});}
        else fail('MIDI 包含不支持或损坏的系统事件 0x'+status.toString(16),'INVALID_MIDI');
      }
      if(!ended)warn(s,'部分 MIDI 音轨缺少结束标记，已按真实轨道长度读取。');ends[ti]=tick;s.totalBeats=Math.max(s.totalBeats,tick/ppq);
    }
    if(pos!==a.length)fail('MIDI 声明的音轨后仍有数据，拒绝静默截断','INVALID_MIDI');
    raw.sort(function(x,y){return x.tick-y.tick||x.track-y.track||x.seq-y.seq;});var parts=new Map(),active=new Map(),programs=new Array(16).fill(0),ids=0;
    function part(ev){var id='midi-'+ev.track+'-'+ev.channel;if(!parts.has(id)){if(parts.size>=MAX_PARTS)fail('MIDI 声部超过 256 个');var pr=programs[ev.channel];var p={id:id,name:trackNames[ev.track]||'音轨 '+(ev.track+1),sourceTrack:ev.track,channel:ev.channel,program:pr,instrument:instrument(pr,ev.channel),volume:.8,mute:false,solo:false,events:[],programChanges:[],controllers:[]};parts.set(id,p);s.parts.push(p);}return parts.get(id);}
    function close(n,tick){n.duration=Math.max(0,(tick-n._tick)/ppq);delete n._tick;if(n.duration===0){n.grace=true;warn(s,'MIDI 含零时长音符，已保留但试听不发声。');}}
    raw.forEach(function(ev){var p=part(ev),key=ev.channel+':'+ev.a,queue=active.get(key)||[];
      if(ev.type===9&&ev.b>0){var n={id:'midi-note-'+(++ids),partId:p.id,kind:'note',beat:ev.tick/ppq,duration:0,midiPitch:ev.a,velocity:ev.b,voice:String(ev.channel+1),staff:1,measure:null,channel:ev.channel,program:programs[ev.channel],instrument:instrument(programs[ev.channel],ev.channel),_tick:ev.tick};p.events.push(n);if(queue.length)warn(s,'MIDI 含同通道同音高重叠，关音按原轨优先、先入先出配对；请检查重叠尾音。');queue.push(n);active.set(key,queue);if(ids>MAX_EVENTS)fail('MIDI 音符超过 '+MAX_EVENTS+' 个','EVENT_LIMIT');}
      else if(ev.type===8||ev.type===9){if(!queue.length)warn(s,'MIDI 含没有对应起音的关音事件，已保留原始文件。');else{var index=queue.findIndex(function(n){return n.partId===p.id;});if(index<0)index=0;close(queue.splice(index,1)[0],ev.tick);}}
      else if(ev.type===12){programs[ev.channel]=ev.a;p.programChanges.push({beat:ev.tick/ppq,program:ev.a});if(!p.events.length){p.program=ev.a;p.instrument=instrument(ev.a,ev.channel);}}
      else if(ev.type===11){p.controllers.push({beat:ev.tick/ppq,controller:ev.a,value:ev.b});warn(s,'MIDI 控制器（含延音踏板、音量、声像）已保存；当前试听不模拟这些自动化，只播放原始起止音符。');}
      else warn(s,'MIDI 弯音、触后及压力变化仅保留在原始文件，试听使用固定音高与逐音力度。');
    });
    active.forEach(function(queue){queue.forEach(function(n){var p=parts.get(n.partId);close(n,Math.max(n._tick,ends[p.sourceTrack]));warn(s,'MIDI 含缺失关音的音符，已明确延续到其轨道末尾；请检查尾音。');});});
    s.parts.forEach(function(p){p.programChanges=raw.filter(function(e){return e.channel===p.channel&&e.type===12;}).map(function(e){return {beat:e.tick/ppq,program:e.a,sourceTrack:e.track};});p.controllers=raw.filter(function(e){return e.channel===p.channel&&e.type===11;}).map(function(e){return {beat:e.tick/ppq,controller:e.a,value:e.b,sourceTrack:e.track};});});
    for(var field of ['timeSignatures','keySignatures'])s[field]=s[field].flatMap(function(m){var owners=s.parts.filter(function(p){return p.sourceTrack===m.sourceTrack;});return owners.length?owners.map(function(p){return Object.assign({},m,{partId:p.id});}):[m];});
    s.source.tracks=ends.map(function(end,i){return {index:i,name:trackNames[i]||'音轨 '+(i+1),endBeat:end/ppq};});
    if(!s.parts.length)fail('MIDI 文件没有通道声部','EMPTY_SCORE');
    warn(s,'通用 MIDI 音色编号已保留；试听使用最接近的七音内置乐器，不模拟原设备的专有音源。');
    warn(s,'MIDI 不含完整的谱面拼写：临时升降号、连音线、休止符与小节排版由音高和时序推导，不能恢复原出版乐谱。');
    return finish(s);
  }
  // Deliberately small non-validating XML reader. DTD/entity expansion is impossible.
  function readXml(input) {
    if(typeof input!=='string'||new TextEncoder().encode(input).length>MAX_FILE_BYTES)fail('MusicXML 超过 16 MB 或不是文字','FILE_SIZE');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))fail('XML 含无效控制字符','INVALID_XML');
    if(/<!ENTITY/i.test(input)||/<!DOCTYPE[^>]*\[/i.test(input))fail('为安全起见，拒绝 XML 实体和内部 DTD','EXTERNAL_ENTITY');
    var hadDtd=false;
    input=input.replace(/<!DOCTYPE[^>]*>/gi,function(d){
      if(!/^<!DOCTYPE\s+score-(?:partwise|timewise)\s+PUBLIC\s+['"]-\/\/Recordare\/\/DTD MusicXML [\d.]+ (?:Partwise|Timewise)\/\/EN['"]\s+['"]https?:\/\/(?:www\.)?(?:musicxml\.org|recordare\.com)\/dtds\/(?:partwise|timewise)\.dtd['"]\s*>$/i.test(d))fail('拒绝外部 XML DTD；请使用无外部实体的标准 MusicXML','EXTERNAL_ENTITY');
      hadDtd=true;return '';
    });
    function entities(t){return t.replace(/&([^;\s<&]+);/g,function(full,v){if(v==='amp')return '&';if(v==='lt')return '<';if(v==='gt')return '>';if(v==='quot')return '"';if(v==='apos')return "'";if(/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(v)){var n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);if(n===9||n===10||n===13||n>=32&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)&&n!==0xfffe&&n!==0xffff)return String.fromCodePoint(n);}fail('XML 含未知或不安全的实体 '+full,'EXTERNAL_ENTITY');});}
    var rootNode={name:'#document',children:[],text:''},stack=[rootNode],pos=0,count=0,nameRe=/^[A-Za-z_][A-Za-z0-9_.:-]*/;
    while(pos<input.length){if(input[pos]!=='<'){var next=input.indexOf('<',pos);if(next<0)next=input.length;var raw=input.slice(pos,next);if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(raw))fail('XML 中有未知实体或未转义 &','EXTERNAL_ENTITY');stack[stack.length-1].text+=entities(raw);pos=next;continue;}
      if(input.startsWith('<!--',pos)){var ce=input.indexOf('-->',pos+4);if(ce<0||input.slice(pos+4,ce).includes('--'))fail('XML 注释无效','INVALID_XML');pos=ce+3;continue;}
      if(input.startsWith('<?',pos)){var pe=input.indexOf('?>',pos+2);if(pe<0)fail('XML 处理指令未结束');pos=pe+2;continue;}
      if(input.startsWith('<![CDATA[',pos)){var de=input.indexOf(']]>',pos+9);if(de<0)fail('XML CDATA 未结束');stack[stack.length-1].text+=input.slice(pos+9,de);pos=de+3;continue;}
      if(input.startsWith('<!',pos))fail('不支持的 XML 声明','INVALID_XML');
      if(input.startsWith('</',pos)){var close=/^<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>/.exec(input.slice(pos));if(!close||stack.length<2||stack[stack.length-1].qualifiedName!==close[1])fail('XML 标签未正确配对','INVALID_XML');stack.pop();pos+=close[0].length;continue;}
      pos++;var match=nameRe.exec(input.slice(pos));if(!match)fail('XML 元素名称无效');var qname=match[0];pos+=qname.length;var n={name:qname.split(':').pop(),qualifiedName:qname,attrs:Object.create(null),children:[],text:''};
      while(true){var ws=/^\s*/.exec(input.slice(pos))[0];pos+=ws.length;if(input.startsWith('/>',pos)){pos+=2;break;}if(input[pos]==='>'){pos++;stack.push(n);if(stack.length>128)fail('XML 嵌套过深','XML_LIMIT');break;}if(!ws.length)fail('XML 属性缺少空格');var am=/^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])/.exec(input.slice(pos));if(!am)fail('XML 属性无效');pos+=am[0].length;var ae=input.indexOf(am[2],pos);if(ae<0)fail('XML 属性未结束');var av=input.slice(pos,ae);if(av.includes('<')||/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(av))fail('XML 属性值或实体无效');if(Object.prototype.hasOwnProperty.call(n.attrs,am[1]))fail('XML 属性重复');n.attrs[am[1]]=entities(av);pos=ae+1;}
      var parent=stack[stack.length-1]===n?stack[stack.length-2]:stack[stack.length-1];parent.children.push(n);if(++count>400000)fail('XML 节点过多','XML_LIMIT');
    }
    if(stack.length!==1||rootNode.children.length!==1||rootNode.text.trim())fail('XML 文档结构不完整','INVALID_XML');return {root:rootNode.children[0],hadDtd:hadDtd};
  }
  function children(n,name){return n?n.children.filter(function(c){return c.name===name;}):[];}
  function child(n,name){return children(n,name)[0]||null;}
  function content(n){return n?n.text+n.children.map(content).join(''):'';}
  function value(n,name,fallback){var c=child(n,name);return c?content(c).trim():fallback;}
  function xmlNumber(n,name,fallback,min,max){var raw=value(n,name,null);if(raw===null)return fallback;var v=Number(raw);if(!raw||!Number.isFinite(v)||v<min||v>max)fail('MusicXML '+name+' 数值无效');return v;}
  function parseMusicXml(input,options) {
    var parsed=readXml(input),doc=parsed.root,s=base('musicxml',options&&options.name);s.originalData={format:'musicxml',encoding:'text',data:input};
    if(!['score-partwise','score-timewise'].includes(doc.name))fail('仅支持 score-partwise / score-timewise MusicXML，不支持 opus 集合','UNSUPPORTED_XML');
    if(parsed.hadDtd)warn(s,'标准 MusicXML DTD 已安全忽略；未读取任何外部实体或网络资源。');
    s.title=(value(child(doc,'work'),'work-title','')||value(doc,'movement-title','')||s.title).slice(0,1000);
    var partList=child(doc,'part-list');if(!partList)fail('MusicXML 缺少 part-list');var definitions=children(partList,'score-part');if(!definitions.length||definitions.length>MAX_PARTS)fail('MusicXML 声部为空或超过 256 个');
    var partwise=doc.name==='score-partwise',bodies=children(doc,'part'),timewiseMeasures=children(doc,'measure'),seenIds=new Set(),counter=0,globalSpans=[],mapsToAdjust=[],allMeasureEvents=[];
    if(partwise){var declared=new Set(definitions.map(function(d){return d.attrs.id;}));bodies.forEach(function(b){if(!declared.has(b.attrs.id))fail('MusicXML 存在未在 part-list 中声明的声部');});}
    definitions.forEach(function(def,pi){var id=def.attrs.id;if(!id||seenIds.has(id))fail('MusicXML 声部 ID 缺失或重复');seenIds.add(id);
      var midiDefs=children(def,'midi-instrument'),firstMidi=midiDefs[0],program=xmlNumber(firstMidi,'midi-program',1,1,128)-1,channel=xmlNumber(firstMidi,'midi-channel',1,1,16)-1,percussion=children(def,'score-instrument').some(function(i){var mid=midiDefs.find(function(m){return m.attrs.id===i.attrs.id;});return child(mid,'midi-unpitched');});
      int(program,0,127,'MusicXML MIDI program');int(channel,0,15,'MusicXML MIDI channel');
      var p={id:id,name:(value(def,'part-name','')||'声部 '+(pi+1)).slice(0,240),instrument:instrument(program,percussion?9:channel),program:program,channel:percussion?9:channel,volume:xmlNumber(firstMidi,'volume',80,0,100)/100,mute:false,solo:false,events:[],measures:[],programChanges:[],controllers:[]};s.parts.push(p);
      var measures;if(partwise){var matches=bodies.filter(function(b){return b.attrs.id===id;});if(matches.length!==1)fail('MusicXML 声部 '+id+' 缺失或重复');measures=children(matches[0],'measure');}else{measures=timewiseMeasures.map(function(m){var matches=children(m,'part').filter(function(p){return p.attrs.id===id;});if(matches.length!==1)fail('timewise 小节缺少声部 '+id+' 或声部重复');return {name:'measure',attrs:m.attrs,children:matches[0].children,text:''};});}
      var divisions=1,meter=4,transpose={all:0},velocity=96;p.velocityChanges=[];
      function mapAt(list,item,mi,cursor){item.partId=id;item.beat=cursor;list.push(item);mapsToAdjust.push({item:item,measure:mi});}
      measures.forEach(function(measure,mi){if(mi>=100000)fail('MusicXML 小节过多');var cursor=0,actual=0,previous=null,local=[];var info={number:measure.attrs.number||String(mi+1),index:mi,beat:0,duration:0,implicit:measure.attrs.implicit==='yes'};p.measures.push(info);
        measure.children.forEach(function(n){
          if(n.name==='attributes'){
            divisions=xmlNumber(n,'divisions',divisions,0.000001,1000000000);
            children(n,'time').forEach(function(t){if(child(t,'senza-misura')){warn(s,'自由拍号已保留原始信息；以写入的时值顺序播放。');meter=0;return;}var numerators=children(t,'beats'),denominators=children(t,'beat-type');if(!numerators.length||numerators.length!==denominators.length)fail('MusicXML 拍号不完整');var duration=0,pairs=[];numerators.forEach(function(b,i){var pieces=content(b).trim().split('+');if(pieces.some(function(v){return !/^\d+$/.test(v)||Number(v)<1;}))fail('MusicXML 拍号分子无效');var count=pieces.reduce(function(x,v){return x+Number(v);},0),den=Number(content(denominators[i]).trim());int(count,1,1024,'拍号分子');int(den,1,32768,'拍号分母');duration+=count*4/den;pairs.push({numerator:count,denominator:den});});meter=duration;var titem={numerator:pairs[0].numerator,denominator:pairs[0].denominator};if(pairs.length>1){titem.groups=pairs;warn(s,'复合拍号已保留各组；简化显示可能只显示第一组，时序完整保留。');}if(t.attrs.number)titem.staff=Number(t.attrs.number);mapAt(s.timeSignatures,titem,mi,cursor);});
            children(n,'key').forEach(function(k){if(child(k,'fifths')){var fifths=xmlNumber(k,'fifths',0,-7,7);int(fifths,-7,7,'调号');var mode=value(k,'mode','major'),item={fifths:fifths,mode:mode,tonic:tonic(fifths,mode)};if(k.attrs.number)item.staff=Number(k.attrs.number);if(!['major','minor','none'].includes(mode))warn(s,'教会调式等非大小调的原调式名称已保留；简谱调号显示采用对应调号。');mapAt(s.keySignatures,item,mi,cursor);}else warn(s,'非传统调号（逐音升降）仅保留在原始文件；音符实际音高与拼写仍完整保留。');});
            children(n,'transpose').forEach(function(t){var tr=xmlNumber(t,'chromatic',0,-127,127)+12*xmlNumber(t,'octave-change',0,-10,10);transpose[t.attrs.number||'all']=tr;if(child(t,'double'))warn(s,'MusicXML 八度加倍指示仅保留原始信息；试听只播放写出的音符。');});
            if(child(n,'measure-style'))warn(s,'小节重复、省略小节等记谱样式未展开，按文件写出的音符播放。');
          } else if(n.name==='backup'||n.name==='forward'){
            var delta=xmlNumber(n,'duration',null,0.000001,1000000000);if(delta===null)fail('MusicXML '+n.name+' 缺少 duration');cursor+=(n.name==='backup'?-1:1)*delta/divisions;if(cursor<-EPS)fail('MusicXML backup 跨出小节起点');cursor=Math.max(0,cursor);actual=Math.max(actual,cursor);previous=null;
          } else if(n.name==='note'){
            var grace=!!child(n,'grace'),isChord=!!child(n,'chord'),rest=child(n,'rest'),unpitched=child(n,'unpitched'),pitch=child(n,'pitch'),voice=value(n,'voice','1'),staff=xmlNumber(n,'staff',1,1,1024),duration=xmlNumber(n,'duration',null,0,1000000000);
            int(staff,1,1024,'谱表');if([rest,unpitched,pitch].filter(Boolean).length!==1)fail('MusicXML 音符必须且只能包含 pitch、rest、unpitched 之一');if(isChord&&rest)fail('MusicXML 和弦不能包含休止符');if(duration===null){if(grace)duration=0;else if(rest&&rest.attrs.measure==='yes'&&meter>0)duration=meter*divisions;else fail('非倚音缺少 duration，无法精确恢复节奏');}duration/=divisions;if(!grace&&duration<=0)fail('非倚音时长必须大于零');
            var beat=cursor;if(isChord){if(!previous||previous.voice!==voice||previous.staff!==staff)fail('MusicXML 和弦没有同声部的前置音符');beat=previous.beat;}
            var e={id:'xml-note-'+(++counter),partId:id,kind:rest?'rest':unpitched?'unpitched':'note',beat:beat,duration:duration,midiPitch:null,velocity:velocity,voice:voice,staff:staff,measure:info.number,measureIndex:mi,grace:grace};if(counter>MAX_EVENTS)fail('MusicXML 音符/休止符超过 '+MAX_EVENTS+' 个','EVENT_LIMIT');
            if(pitch){var step=value(pitch,'step',''),alter=xmlNumber(pitch,'alter',0,-12,12),octave=xmlNumber(pitch,'octave',null,-1,10),semi={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];if(semi==null||octave===null||!Number.isInteger(octave))fail('MusicXML 音高无效');e.pitch={step:step,alter:alter,octave:octave};e.writtenMidiPitch=(octave+1)*12+semi+alter;e.midiPitch=e.writtenMidiPitch+(transpose[staff]==null?transpose.all:transpose[staff]);num(e.midiPitch,0,127,'音高');if(!Number.isInteger(e.midiPitch))warn(s,'MusicXML 含微分音；音高数值完整保留，当前试听与 MIDI 导出需先明确编辑为半音，绝不自动四舍五入。');}
            else if(unpitched){var iid=child(n,'instrument'),md=midiDefs.find(function(m){return iid&&m.attrs.id===iid.attrs.id;})||firstMidi,up=xmlNumber(md,'midi-unpitched',null,1,128);e.midiPitch=up==null?null:up-1;e.unpitched={displayStep:value(unpitched,'display-step',''),displayOctave:xmlNumber(unpitched,'display-octave',null,-1,10)};e.instrument='percussion';if(up===null)warn(s,'无音高打击乐缺少 MIDI 鼓键映射：节奏已保留，该音符不发声。');}
            else if(!rest)fail('MusicXML 音符缺少 pitch、rest 或 unpitched');
            if(n.attrs.dynamics!=null){e.velocity=Math.max(1,Math.min(127,Math.round(num(Number(n.attrs.dynamics),0,1000,'音符力度')*.9)));e.sourceDynamics=Number(n.attrs.dynamics);}
            var accidental=value(n,'accidental',null);if(accidental!==null)e.accidental=accidental;var notations=child(n,'notations'),ties=children(n,'tie').concat(children(notations,'tied'));if(ties.length)e.tie={start:ties.some(function(t){return t.attrs.type==='start'||t.attrs.type==='continue';}),stop:ties.some(function(t){return t.attrs.type==='stop'||t.attrs.type==='continue';})};
            e.notation={type:value(n,'type',''),dots:children(n,'dot').length};var tm=child(n,'time-modification');if(tm)e.notation.tuplet={actual:xmlNumber(tm,'actual-notes',null,1,1024),normal:xmlNumber(tm,'normal-notes',null,1,1024)};
            if(isChord){e.chordId=previous.chordId||previous.id;previous.chordId=e.chordId;}else if(!grace)cursor+=duration;
            if(child(n,'cue')){e.cue=true;warn(s,'提示音符（cue）已保留并参与试听；请按需要静音或删除。');}
            if(grace)warn(s,'倚音已保留为零拍标记，试听不自动猜测抢拍时长。');
            if(child(n,'lyric')){e.lyrics=children(n,'lyric').map(function(l){return value(l,'text','');});warn(s,'歌词文字已保留，连字符与歌词排版未重建。');}
            if(notations&&notations.children.some(function(v){return !['tied','tuplet'].includes(v.name);}))warn(s,'装饰音、滑音、连奏、力度/奏法记号未合成为演奏效果；原谱完整保留。');
            if(child(n,'play')||n.attrs.attack!=null||n.attrs.release!=null)warn(s,'MusicXML 演奏专用偏移/音源指示未执行；使用明确记谱起点与时长。');
            actual=Math.max(actual,beat+duration,cursor);p.events.push(e);local.push(e);previous=e;
          } else if(n.name==='direction'||n.name==='sound'){
            var offset=n.name==='direction'?xmlNumber(n,'offset',0,-1000000000,1000000000)/divisions:0,at=cursor+offset;if(at<-EPS)fail('MusicXML 方向标记超出小节起点');at=Math.max(0,at);var sound=n.name==='sound'?n:child(n,'sound'),tempo=null;
            if(sound&&sound.attrs.tempo!=null)tempo=num(Number(sound.attrs.tempo),0.001,60000000,'速度');
            if(sound&&sound.attrs.dynamics!=null)mapAt(p.velocityChanges,{velocity:Math.max(1,Math.min(127,Math.round(num(Number(sound.attrs.dynamics),0,1000,'力度')*.9)))},mi,at);
            var dtypes=children(n,'direction-type'),dtype=child(n,'direction-type'),met=dtypes.flatMap(function(d){return children(d,'metronome');})[0];if(tempo===null&&met){var units={maxima:32,long:16,breve:8,whole:4,half:2,quarter:1,eighth:.5,'16th':.25,'32nd':.125,'64th':.0625,'128th':.03125},unit=units[value(met,'beat-unit','')],per=value(met,'per-minute','');if(unit&&/^\d+(\.\d+)?$/.test(per)){var dots=children(met,'beat-unit-dot').length;tempo=Number(per)*unit*(2-Math.pow(.5,dots));}else warn(s,'文字速度/复杂速度关系未自动解释；请检查速度设置。');}
            if(tempo!==null)mapAt(s.tempos,{bpm:tempo},mi,at);
            if(sound&&Object.keys(sound.attrs).some(function(k){return !['tempo','dynamics','id','time-only','divisions'].includes(k);}))warn(s,'反复跳转、踏板和其他 MusicXML sound 指示未执行；按写谱顺序试听。');
            if(sound&&sound.children.length)warn(s,'MusicXML sound 中的音源/乐器自动化仅保留在原始文件；试听使用已选乐器。');
            if(dtypes.some(function(dt){return dt.children.some(function(d){return !['metronome','words','rehearsal'].includes(d.name);});}))warn(s,'渐快/渐慢、渐强/渐弱、踏板及其他方向记号未自动插值；原谱完整保留。');
          } else if(n.name==='barline') {if(child(n,'repeat')||child(n,'ending'))warn(s,'反复记号与房子已保留在原始文件，但尚未展开；试听按写出的顺序一次播放。');}
          else if(['harmony','figured-bass'].includes(n.name))warn(s,'和弦名称/数字低音标记仅保留原始信息，不自动生成额外伴奏。');
          else if(!['print','grouping','link','bookmark'].includes(n.name))warn(s,'MusicXML 元素 '+n.name+' 未转换；原始文件完整保留。');
        });
        var span=info.implicit?actual:Math.max(meter,actual);if(!span)span=meter||0;if(actual>meter+EPS&&meter>0&&!info.implicit)warn(s,'部分小节的实际时值超出拍号，已保留完整时序，未截断。');info.duration=span;globalSpans[mi]=Math.max(globalSpans[mi]||0,span);allMeasureEvents.push({events:local,measure:mi,info:info});
      });
    });
    var starts=[],end=0;globalSpans.forEach(function(span,i){starts[i]=end;end+=span;if(end>MAX_BEATS)fail('MusicXML 时间线过长');});allMeasureEvents.forEach(function(group){group.info.beat=starts[group.measure];group.info.duration=globalSpans[group.measure];group.events.forEach(function(e){e.beat+=starts[group.measure];});});mapsToAdjust.forEach(function(m){m.item.beat+=starts[m.measure];});s.totalBeats=end;
    s.parts.forEach(function(p){p.velocityChanges.sort(function(a,b){return a.beat-b.beat;});var dynamicsIndex=0,currentVelocity=96;p.events.slice().sort(sortEvents).forEach(function(e){while(dynamicsIndex<p.velocityChanges.length&&p.velocityChanges[dynamicsIndex].beat<=e.beat+EPS)currentVelocity=p.velocityChanges[dynamicsIndex++].velocity;if(e.sourceDynamics==null)e.velocity=currentVelocity;});var pending=new Map();p.events.slice().sort(sortEvents).forEach(function(e){if(!e.tie)return;var key=e.voice+':'+e.staff+':'+e.midiPitch,prev=pending.get(key);if(e.tie.stop&&(!prev||Math.abs(prev.beat+prev.duration-e.beat)>EPS))warn(s,'部分延音线没有相邻的配对音符；已保留标记，试听不会跨空拍错误连接。');if(e.tie.start)pending.set(key,e);else if(e.tie.stop)pending.delete(key);});if(pending.size)warn(s,'部分延音线缺少终点，已保留已写出的时值。');});
    warn(s,'导入保留音符、声部和关键时序；页边距、字体、谱表布局等出版排版保留在原始文件中。');return finish(s);
  }
  function safeCopy(v,depth) { if(depth>48)fail('工程嵌套过深');if(v===null||typeof v==='boolean')return v;if(typeof v==='number'){if(!Number.isFinite(v))fail('工程含非有限数');return v;}if(typeof v==='string')return txt(v,MAX_FILE_BYTES*1.4,'工程字段');if(Array.isArray(v)){if(v.length>MAX_EVENTS*20)fail('工程数组过长');return v.map(function(x){return safeCopy(x,depth+1);});}obj(v,'工程字段');var out={};Object.keys(v).forEach(function(k){out[k]=safeCopy(v[k],depth+1);});return out; }
  function validateScore(input) {
    obj(input,'乐谱');if(input.format!==FORMAT||input.version!==VERSION)fail('不支持的乐谱工程版本','UNSUPPORTED_VERSION');var s={format:FORMAT,version:VERSION,title:txt(input.title,1000,'标题'),source:safeCopy(obj(input.source,'来源'),0),parts:[],events:[],tempos:[],timeSignatures:[],keySignatures:[],totalBeats:num(input.totalBeats,0,MAX_BEATS,'总拍数'),warnings:arr(input.warnings||[],1000,'警告').map(function(w){return txt(w,2000,'警告');}),originalData:null},ids=new Set(),partIds=new Set(),count=0;
    txt(s.source.format,40,'来源格式');txt(s.source.name,1000,'来源名称');
    arr(input.parts,MAX_PARTS,'声部').forEach(function(source){obj(source,'声部');var p=safeCopy(source,0);p.id=txt(p.id,240,'声部 ID');if(!p.id||partIds.has(p.id))fail('声部 ID 缺失或重复');partIds.add(p.id);p.name=txt(p.name,240,'声部名称');if(!INSTRUMENTS.includes(p.instrument))fail('不支持的音色');p.program=int(p.program==null?0:p.program,0,127,'乐器编号');if(p.channel!=null)p.channel=int(p.channel,0,15,'通道');p.volume=num(p.volume,0,1,'音量');p.mute=bool(p.mute,'静音');p.solo=bool(p.solo,'独奏');if(p.instrumentOverride!=null)p.instrumentOverride=bool(p.instrumentOverride,'手动音色覆盖');if(p.volumeOverride!=null)p.volumeOverride=bool(p.volumeOverride,'手动音量覆盖');
      p.events=arr(source.events,MAX_EVENTS,'音符').map(function(sourceEvent){obj(sourceEvent,'音符');var e=safeCopy(sourceEvent,0);e.id=txt(e.id,240,'音符 ID');if(!e.id||ids.has(e.id))fail('音符 ID 缺失或重复');ids.add(e.id);if(e.partId!==p.id)fail('音符与所在声部 ID 不匹配');if(!['note','rest','unpitched'].includes(e.kind))fail('音符类型无效');e.beat=num(e.beat,0,MAX_BEATS,'音符起点');e.duration=num(e.duration,0,MAX_BEATS,'音符时长');if(e.beat+e.duration>MAX_BEATS)fail('音符超出最大乐谱时长');s.totalBeats=Math.max(s.totalBeats,e.beat+e.duration);if(e.midiPitch!=null)e.midiPitch=num(e.midiPitch,0,127,'音高');if(e.kind==='note'&&e.midiPitch==null)fail('有音高音符缺少音高');if(e.kind==='rest'&&e.midiPitch!=null)fail('休止符不能含音高');e.velocity=int(e.velocity,1,127,'力度');e.voice=txt(e.voice==null?'1':e.voice,80,'声部序号');e.staff=int(e.staff==null?1:e.staff,1,1024,'谱表');if(e.program!=null)int(e.program,0,127,'音符乐器编号');if(e.instrument!=null&&!INSTRUMENTS.includes(e.instrument))fail('音符音色无效');if(e.tie){obj(e.tie,'延音线');e.tie={start:bool(e.tie.start,'延音起点'),stop:bool(e.tie.stop,'延音终点')};}if(e.pitch){obj(e.pitch,'音高拼写');if(!/^[A-G]$/.test(e.pitch.step))fail('音名无效');num(e.pitch.alter,-12,12,'升降音');int(e.pitch.octave,-1,10,'八度');}if(e.chordId!=null)txt(e.chordId,240,'和弦 ID');if(++count>MAX_EVENTS)fail('音符总数超过上限','EVENT_LIMIT');return e;}).sort(sortEvents);
      arr(p.programChanges||[],MAX_EVENTS,'音色变化').forEach(function(e){num(e.beat,0,s.totalBeats,'音色变化起点');int(e.program,0,127,'音色编号');});arr(p.controllers||[],MAX_EVENTS*10,'控制器').forEach(function(e){num(e.beat,0,s.totalBeats,'控制器起点');int(e.controller,0,127,'控制器');int(e.value,0,127,'控制器值');});s.parts.push(p);
    });
    if(!s.parts.length)fail('乐谱没有声部');
    function timeline(values,label,check){var out=arr(values,MAX_EVENTS,label).map(function(v){obj(v,label);var n=safeCopy(v,0);num(n.beat,0,s.totalBeats,label+' 起点');if(n.partId!=null&&!partIds.has(n.partId))fail(label+' 声部 ID 无效');check(n);return n;}).sort(function(a,b){return a.beat-b.beat;});if(!out.length||out[0].beat!==0)fail(label+' 必须包含第零拍的初值');return out;}
    s.tempos=timeline(input.tempos,'速度',function(n){num(n.bpm,0.001,60000000,'BPM');});s.timeSignatures=timeline(input.timeSignatures,'拍号',function(n){int(n.numerator,1,1024,'拍号分子');int(n.denominator,1,32768,'拍号分母');if(n.groups)arr(n.groups,64,'复合拍号').forEach(function(g){int(g.numerator,1,1024,'拍号分子');int(g.denominator,1,32768,'拍号分母');});});s.keySignatures=timeline(input.keySignatures,'调号',function(n){int(n.fifths,-7,7,'调号');txt(n.mode,80,'调式');int(n.tonic,0,11,'主音');});
    var original=obj(input.originalData,'原始文件');if(!['text','base64'].includes(original.encoding))fail('原始文件编码无效');txt(original.format,40,'原始文件类型');var limit=original.encoding==='base64'?Math.ceil(MAX_FILE_BYTES/3)*4:MAX_FILE_BYTES;txt(original.data,limit,'原始文件');if(original.encoding==='base64'&&(original.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(original.data)||original.data.includes('=')&&!/^[^=]*={1,2}$/.test(original.data)))fail('原始文件 Base64 无效');s.originalData={format:original.format,encoding:original.encoding,data:original.data};s.events=s.parts.flatMap(function(p){return p.events;}).sort(sortEvents);return s;
  }
  function parseProject(raw) { if(typeof raw!=='string'||raw.length>MAX_EXPANDED_BYTES)fail('乐谱工程过大','FILE_SIZE');var data;try{data=JSON.parse(raw);}catch(e){fail('乐谱工程 JSON 无效');}return validateScore(data); }
  function serializeProject(s) { var clean=validateScore(s);delete clean.events;return JSON.stringify(clean,null,2); }
  function tempoMap(s) { var map=[],seconds=0,previous=0,bpm=120;s.tempos.forEach(function(t){seconds+=(t.beat-previous)*60/bpm;map.push({beat:t.beat,seconds:seconds,bpm:t.bpm});previous=t.beat;bpm=t.bpm;});return map; }
  function beatTime(map,beat){var lo=0,hi=map.length-1;while(lo<hi){var m=Math.ceil((lo+hi)/2);if(map[m].beat<=beat)lo=m;else hi=m-1;}var t=map[lo];return t.seconds+(beat-t.beat)*60/t.bpm;}
  function beatToSeconds(input,beat){var s=validateScore(input);num(beat,0,s.totalBeats,'拍数');return beatTime(tempoMap(s),beat);}
  function secondsToBeat(input,seconds){var s=validateScore(input),map=tempoMap(s);num(seconds,0,beatTime(map,s.totalBeats),'秒数');var lo=0,hi=map.length-1;while(lo<hi){var m=Math.ceil((lo+hi)/2);if(map[m].seconds<=seconds)lo=m;else hi=m-1;}var t=map[lo];return t.beat+(seconds-t.seconds)*t.bpm/60;}
  function activeParts(s,includeMuted) {var solo=s.parts.some(function(p){return p.solo;});return s.parts.filter(function(p){return includeMuted||!p.mute&&p.volume>0&&(!solo||p.solo);});}
  function soundingNotes(p) {
    var out=[],ties=new Map();p.events.forEach(function(e){if(e.kind==='rest'||e.midiPitch==null||e.duration<=0)return;var key=e.voice+':'+e.staff+':'+e.midiPitch,previous=ties.get(key);
      if(e.tie&&e.tie.stop&&previous&&Math.abs(previous.beat+previous.duration-e.beat)<EPS){previous.duration+=e.duration;previous.eventIds.push(e.id);if(!e.tie.start)ties.delete(key);}
      else {var note=Object.assign({},e,{eventIds:[e.id]});out.push(note);if(e.tie&&e.tie.start)ties.set(key,note);else ties.delete(key);}
    });return out;
  }
  function chosenInstrument(p,e){return !p.instrumentOverride&&p.instrument===instrument(p.program,p.channel)&&e.instrument?e.instrument:p.instrument;}
  function buildPlaybackEvents(input,options) {
    var s=validateScore(input),map=tempoMap(s),out=[];options=options||{};var scale=options.tempoScale==null?1:num(options.tempoScale,.01,100,'试听速度倍率');
    activeParts(s,options.includeMuted).forEach(function(p){soundingNotes(p).forEach(function(e){var start=beatTime(map,e.beat)/scale,end=beatTime(map,e.beat+e.duration)/scale;out.push({start:start,duration:end-start,pitch:e.midiPitch,onset:start,end:end,midiPitch:e.midiPitch,velocity:e.velocity,gain:p.volume*(e.velocity/127),instrument:chosenInstrument(p,e),stemId:p.id,partId:p.id,eventId:e.id,eventIds:e.eventIds,beat:e.beat,beatDuration:e.duration});});});return out.sort(function(a,b){return a.start-b.start||a.pitch-b.pitch;});
  }
  function midiExportWarnings(input) {var s=validateScore(input),warnings=['MIDI 导出保存音符、速度/拍号/调号和乐器编号；不包含音色效果器、谱面布局、歌词或图片。','MIDI 时值按文件 PPQ 分辨率舍入，未量化到音乐网格。'];if(s.events.some(function(e){return e.kind==='unpitched'&&e.midiPitch==null;}))warnings.push('缺少鼓键映射的打击乐事件不能生成 MIDI 音符；原节奏保留在乐谱工程，请先指定音高后再导出有声版本。');if(s.events.some(function(e){return e.duration===0;}))warnings.push('零时长倚音不产生 MIDI 发声事件；原始记谱仍保留在乐谱工程。');if(s.keySignatures.some(function(k){return k.partId!=null;}))warnings.push('各声部调号分别保存在 MIDI 音轨中；移调乐器的源谱书写调号未自动重拼为实音调号。');if(s.keySignatures.some(function(k){return !['major','minor','none'].includes(k.mode);}))warnings.push('MIDI 仅支持大调/小调标志，其他调式按其调号以大调标志保存。');if(s.timeSignatures.some(function(t){return t.groups;}))warnings.push('MIDI 无法表示分组复合拍号；请将拍号显式改为可表示的单一拍号后导出。');return warnings;}
  function toMidi(input,options) {
    var s=validateScore(input);options=options||{};var ppq=options.ppq==null?(s.source.ppq||9600):int(options.ppq,24,32767,'MIDI PPQ'),selected=activeParts(s,options.includeMuted),channels=[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15],channelCursor=0,drumsUsed=false,tracks=[],lastTick=Math.round(s.totalBeats*ppq),programMap={piano:0,guitar:24,bass:33,flute:73,strings:48,brass:56,organ:19,percussion:0};
    function utf8(t){return Array.from(new TextEncoder().encode(t));}function u32(n){return [Math.floor(n/16777216)&255,Math.floor(n/65536)&255,Math.floor(n/256)&255,n&255];}function vlq(n){if(!Number.isSafeInteger(n)||n<0||n>268435455)fail('MIDI 时间差超出范围');var out=[n%128];while(n=Math.floor(n/128))out.unshift(n%128+128);return out;}function push(target,values){for(var v of values)target.push(v);}function meta(type,values){return [255,type].concat(vlq(values.length),values);}function track(events){events.sort(function(a,b){return a.tick-b.tick||a.order-b.order;});var out=[],prev=0;function delta(t){var diff=t-prev;while(diff>268435455){push(out,vlq(268435455));push(out,[255,127,0]);prev+=268435455;diff=t-prev;}push(out,vlq(diff));prev=t;}events.forEach(function(e){delta(e.tick);push(out,e.bytes);});delta(Math.max(lastTick,prev));push(out,[255,47,0]);return out;}
    if(!selected.length)fail('没有可导出的声部，请取消静音/独奏限制','NO_ACTIVE_PARTS');
    var conductor=[{tick:0,order:-10,bytes:meta(3,utf8(s.title))}];s.tempos.forEach(function(t){var us=Math.round(60000000/t.bpm);if(us<1||us>16777215)fail('速度超出标准 MIDI 可表示范围','MIDI_TEMPO');conductor.push({tick:Math.round(t.beat*ppq),order:0,bytes:[255,81,3,(us>>16)&255,(us>>8)&255,us&255]});});
    function signatureBytes(t){if(t.groups)fail('分组复合拍号无法无损写入 MIDI；请先明确改写拍号','MIDI_TIME_SIGNATURE');var denominator=Math.log2(t.denominator);if(!Number.isInteger(denominator)||t.numerator>255)fail('拍号无法写入标准 MIDI','MIDI_TIME_SIGNATURE');return [255,88,4,t.numerator,denominator,t.clocksPerClick||24,t.notated32nds||8];}
    var signatures=new Map();s.timeSignatures.filter(function(t){return t.partId==null;}).forEach(function(t){if(t.groups)fail('分组复合拍号无法无损写入 MIDI；请先明确改写拍号','MIDI_TIME_SIGNATURE');var den=Math.log2(t.denominator);if(!Number.isInteger(den)||t.numerator>255)fail('拍号无法写入标准 MIDI','MIDI_TIME_SIGNATURE');var tick=Math.round(t.beat*ppq),existing=signatures.get(tick),signature=t.numerator+'/'+t.denominator;if(existing&&existing!==signature)fail('各声部有不同拍号，单一 MIDI 全局拍号无法完整表示','MIDI_POLYMETER');if(!existing)conductor.push({tick:tick,order:1,bytes:[255,88,4,t.numerator,den,t.clocksPerClick||24,t.notated32nds||8]});signatures.set(tick,signature);});
    var keys=new Map();s.keySignatures.filter(function(k){return k.partId==null;}).forEach(function(k){var tick=Math.round(k.beat*ppq),value=k.fifths+':'+k.mode,existing=keys.get(tick);if(existing&&existing!==value)fail('各声部有不同调号，单一 MIDI 调号轨无法完整表示','MIDI_POLYTONAL');if(!existing)conductor.push({tick:tick,order:2,bytes:[255,89,2,k.fifths&255,k.mode==='minor'?1:0]});keys.set(tick,value);});tracks.push(track(conductor));
    selected.forEach(function(p){var notes=soundingNotes(p);var percussion=p.instrument==='percussion',pool=[],events=[{tick:0,order:-10,bytes:meta(3,utf8(p.name))}],preserve=!p.instrumentOverride&&p.instrument===instrument(p.program,p.channel),changes=p.programChanges||[];
      s.timeSignatures.filter(function(t){return t.partId===p.id;}).forEach(function(t){events.push({tick:Math.round(t.beat*ppq),order:-9,bytes:signatureBytes(t)});});s.keySignatures.filter(function(k){return k.partId===p.id;}).forEach(function(k){events.push({tick:Math.round(k.beat*ppq),order:-9,bytes:[255,89,2,k.fifths&255,k.mode==='minor'?1:0]});});
      function addChannel(){var channel;if(percussion){if(drumsUsed)fail('多个鼓声部需要同一个 MIDI 鼓通道，请先明确合并鼓声部','MIDI_CHANNELS');channel=9;drumsUsed=true;}else{if(channelCursor>=channels.length)fail('声部/同音重叠需要超过 15 个旋律通道，请减少声部或重叠','MIDI_CHANNELS');channel=channels[channelCursor++];}var voice={channel:channel,busy:new Map()};pool.push(voice);var program=preserve?p.program:programMap[p.instrument];events.push({tick:0,order:-8,bytes:[192+channel,program]},{tick:0,order:-7,bytes:[176+channel,7,Math.round(p.volume*127)]});if(!preserve)events.push({tick:0,order:-9,bytes:[176+channel,0,0]},{tick:0,order:-9,bytes:[176+channel,32,0]});if(preserve)changes.forEach(function(c){events.push({tick:Math.round(c.beat*ppq),order:-5,bytes:[192+channel,c.program]});});(p.controllers||[]).forEach(function(c){if(!preserve&&(c.controller===0||c.controller===32)||p.volumeOverride&&c.controller===7)return;events.push({tick:Math.round(c.beat*ppq),order:-4,bytes:[176+channel,c.controller,c.value]});});return voice;}
      if(!notes.length)addChannel();notes.forEach(function(n){if(!Number.isInteger(n.midiPitch))fail('MIDI 导出不能无损表示微分音；请明确编辑音高后再导出','MIDI_MICROTONAL');var start=Math.round(n.beat*ppq),end=Math.round((n.beat+n.duration)*ppq);if(end<=start)fail('音符短于 MIDI 时钟分辨率，请提高 PPQ','MIDI_RESOLUTION');var voice=pool.find(function(v){return !v.busy.has(n.midiPitch)||v.busy.get(n.midiPitch)<=start;})||addChannel();voice.busy.set(n.midiPitch,end);if(preserve&&n.program!=null)events.push({tick:start,order:-3,bytes:[192+voice.channel,n.program]});events.push({tick:start,order:1,bytes:[144+voice.channel,n.midiPitch,n.velocity]},{tick:end,order:0,bytes:[128+voice.channel,n.midiPitch,0]});});tracks.push(track(events));
    });
    var data=[77,84,104,100,0,0,0,6,0,1,(tracks.length>>8)&255,tracks.length&255,(ppq>>8)&255,ppq&255];tracks.forEach(function(t){push(data,[77,84,114,107]);push(data,u32(t.length));push(data,t);});var output=new Uint8Array(data);if(output.length>MAX_FILE_BYTES)fail('导出的 MIDI 超过 16 MB 上限');output.warnings=midiExportWarnings(s);return output;
  }
  var crcTable=null;
  function crc32(a) {if(!crcTable){crcTable=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}}var crc=0xffffffff;for(var b of a)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zipPath(path){if(typeof path!=='string'||!path||path.length>1024||/[\\\u0000-\u001f:]/.test(path)||path[0]==='/'||path.split('/').some(function(p){return p==='..'||p==='.';}))fail('MXL 包含不安全的归档路径','UNSAFE_ZIP_PATH');return path;}
  async function inflateRaw(a,expected) {
    if(typeof module==='object'&&module.exports&&typeof require==='function'){try{return new Uint8Array(require('node:zlib').inflateRawSync(a,{maxOutputLength:Math.max(1,expected)}));}catch(e){fail('MXL 压缩流损坏或解压后超过声明大小','INVALID_ZIP');}}
    if(typeof root.DecompressionStream!=='function')fail('当前浏览器不支持安全的 MXL 解压；请先在制谱软件导出未压缩 MusicXML','MXL_UNSUPPORTED');
    var stream;try{stream=new Blob([a]).stream().pipeThrough(new root.DecompressionStream('deflate-raw'));}catch(e){fail('当前浏览器不支持 deflate-raw；请导出未压缩 MusicXML','MXL_UNSUPPORTED');}
    var reader=stream.getReader(),chunks=[],size=0;try{while(true){var r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>expected||size>MAX_FILE_BYTES){await reader.cancel();fail('MXL 解压超出声明大小','ZIP_BOMB');}chunks.push(r.value);}}catch(e){if(e.code)throw e;fail('MXL 压缩流损坏','INVALID_ZIP');}var out=new Uint8Array(size),offset=0;chunks.forEach(function(c){out.set(c,offset);offset+=c.length;});return out;
  }
  async function parseMxl(input,options) {
    var a=bytes(input),view=new DataView(a.buffer,a.byteOffset,a.byteLength),end=-1;
    function has(p,n){if(p<0||p+n>a.length)fail('MXL ZIP 数据被截断','INVALID_ZIP');}function u16(p){has(p,2);return view.getUint16(p,true);}function u32(p){has(p,4);return view.getUint32(p,true);}
    for(var i=a.length-22;i>=Math.max(0,a.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===a.length){end=i;break;}
    if(end<0)fail('MXL 缺少完整 ZIP 中央目录','INVALID_ZIP');if(u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==u16(end+10))fail('不支持分卷 MXL','UNSUPPORTED_ZIP');var count=u16(end+10),cdSize=u32(end+12),cdStart=u32(end+16);if(!count||count>512||count===65535||cdStart===0xffffffff||cdSize===0xffffffff)fail('MXL 条目过多或使用不支持的 ZIP64','ZIP_LIMIT');if(cdStart+cdSize!==end)fail('MXL 中央目录边界不正确','INVALID_ZIP');
    var entries=new Map(),pos=cdStart,total=0,regions=[];
    for(var entryIndex=0;entryIndex<count;entryIndex++){has(pos,46);if(u32(pos)!==0x02014b50)fail('MXL 中央目录条目损坏');var flags=u16(pos+8),method=u16(pos+10),crc=u32(pos+16),compressed=u32(pos+20),size=u32(pos+24),nameLen=u16(pos+28),extraLen=u16(pos+30),commentLen=u16(pos+32),disk=u16(pos+34),external=u32(pos+38),local=u32(pos+42);has(pos+46,nameLen+extraLen+commentLen);
      if(flags&1||flags&64)fail('不支持加密 MXL','ENCRYPTED_ZIP');if(![0,8].includes(method))fail('MXL 使用不支持的压缩方法','UNSUPPORTED_ZIP');if(disk||size===0xffffffff||compressed===0xffffffff||local===0xffffffff)fail('不支持 ZIP64 或分卷 MXL','UNSUPPORTED_ZIP');if((external>>>16&0xf000)===0xa000)fail('MXL 含符号链接','UNSAFE_ZIP_PATH');var name=zipPath(decode(a.subarray(pos+46,pos+46+nameLen),true));if(entries.has(name))fail('MXL 条目路径重复','INVALID_ZIP');
      total+=size;if(size>MAX_FILE_BYTES||total>MAX_EXPANDED_BYTES||size>1048576&&size/Math.max(1,compressed)>200)fail('MXL 解压大小或压缩比超过安全上限','ZIP_BOMB');has(local,30);if(local>=cdStart||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail('MXL 本地条目与中央目录不一致','INVALID_ZIP');var localNameLength=u16(local+26),localExtra=u16(local+28);has(local+30,localNameLength+localExtra);var localName=decode(a.subarray(local+30,local+30+localNameLength),true);if(localName!==name)fail('MXL 本地路径与中央目录不一致','INVALID_ZIP');var dataStart=local+30+localNameLength+localExtra;if(dataStart+compressed>cdStart)fail('MXL 压缩数据超出安全边界','INVALID_ZIP');if(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==size))fail('MXL 大小或校验信息不一致','INVALID_ZIP');if(method===0&&size!==compressed)fail('MXL 未压缩条目大小不一致','INVALID_ZIP');regions.push([local,dataStart+compressed]);entries.set(name,{name:name,method:method,crc:crc,size:size,compressed:compressed,start:dataStart});pos+=46+nameLen+extraLen+commentLen;
    }
    if(pos!==cdStart+cdSize)fail('MXL 中央目录长度不匹配','INVALID_ZIP');regions.sort(function(a,b){return a[0]-b[0];});for(var r=1;r<regions.length;r++)if(regions[r][0]<regions[r-1][1])fail('MXL 条目数据重叠','INVALID_ZIP');
    async function extract(name){var e=entries.get(name);if(!e||name.endsWith('/'))fail('MXL 缺少文件 '+name,'INVALID_ZIP');var compressed=a.subarray(e.start,e.start+e.compressed),result=e.method===0?compressed:await inflateRaw(compressed,e.size);if(result.length!==e.size||crc32(result)!==e.crc)fail('MXL 条目大小或 CRC 校验失败','INVALID_ZIP');return result;}
    var container=readXml(decodeXml(await extract('META-INF/container.xml'))).root;if(container.name!=='container')fail('MXL 容器 XML 无效');var roots=children(child(container,'rootfiles'),'rootfile');if(!roots.length)fail('MXL 未指定主乐谱文件');var rootName=zipPath(roots[0].attrs['full-path']);var s=parseMusicXml(decodeXml(await extract(rootName)),options);s.source.format='mxl';s.source.rootfile=rootName;s.originalData={format:'mxl',encoding:'base64',data:b64(a)};if(entries.size>3)warn(s,'MXL 中的附加图片、音频和其他版本未导入播放器，原始压缩包完整保留。');return validateScore(s);
  }
  async function parseFile(file) {
    if(!file||typeof file!=='object')fail('请选择 MIDI 或 MusicXML 文件');var name=typeof file.name==='string'?file.name:'导入的乐谱';if(file.size!=null&&file.size>MAX_FILE_BYTES)fail('文件超过 16 MB 上限','FILE_SIZE');
    if(typeof file.arrayBuffer==='function'||file.arrayBuffer instanceof ArrayBuffer||file.bytes){var ab=typeof file.arrayBuffer==='function'?await file.arrayBuffer():file.arrayBuffer||file.bytes,a=bytes(ab);if(a.length>=4&&a[0]===77&&a[1]===84&&a[2]===104&&a[3]===100)return parseMidi(a,{name:name});if(a.length>=4&&a[0]===80&&a[1]===75&&a[2]===3&&a[3]===4)return parseMxl(a,{name:name});if(/\.(mid|midi|mxl)$/i.test(name))fail('文件扩展名与实际 MIDI/MXL 格式不匹配','INVALID_FILE');var content=decodeXml(a);if(/\.json$/i.test(name))return parseProject(content);return parseMusicXml(content,{name:name});}
    if(typeof file.text==='function'||typeof file.text==='string'){var text=typeof file.text==='function'?await file.text():file.text;if(/\.json$/i.test(name))return parseProject(text);return parseMusicXml(text,{name:name});}fail('文件对象缺少 arrayBuffer 或 text 读取方法');
  }
  return {FORMAT:FORMAT,VERSION:VERSION,MAX_FILE_BYTES:MAX_FILE_BYTES,MAX_EVENTS:MAX_EVENTS,MAX_PARTS:MAX_PARTS,MAX_BEATS:MAX_BEATS,INSTRUMENTS:INSTRUMENTS.slice(),parseMidi:parseMidi,parseMusicXml:parseMusicXml,parseMxl:parseMxl,parseFile:parseFile,validateScore:validateScore,parseProject:parseProject,serializeProject:serializeProject,buildPlaybackEvents:buildPlaybackEvents,beatToSeconds:beatToSeconds,secondsToBeat:secondsToBeat,toMidi:toMidi,midiExportWarnings:midiExportWarnings};
});
