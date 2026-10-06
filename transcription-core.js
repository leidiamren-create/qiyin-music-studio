/* Editable transcription data and exact-time MIDI. Original application code. See LICENSE.txt.
 * All note/cue times are seconds on the ORIGINAL recording timeline. Model scores
 * are model activations, never accuracy estimates. JSON contains no audio files,
 * URLs, credentials, executable code, or embedded model output. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TranscriptionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var FORMAT = 'numbered-music-transcription', VERSION = 1;
  var STEM_IDS = ['vocals', 'drums', 'bass', 'other'];
  var INSTRUMENTS = ['piano', 'guitar', 'bass', 'flute', 'strings', 'brass', 'organ'];
  var LABELS = {vocals: '人声', drums: '鼓', bass: '贝斯', other: '其他伴奏'};
  var MAX_SECONDS = 86400, MAX_EVENTS = 20000, MAX_JSON_BYTES = 12000000, EPS = 1e-9;
  function error(message, code) { var e = new Error(message); e.code = code || 'INVALID_PROJECT'; throw e; }
  function object(v, label) { if (!v || typeof v !== 'object' || Array.isArray(v)) error(label + ' 必须是对象'); for (var k of ['__proto__', 'prototype', 'constructor']) if (Object.prototype.hasOwnProperty.call(v, k)) error(label + ' 含不安全字段'); return v; }
  function number(v, min, max, label) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) error(label + ' 须在 ' + min + '–' + max + ' 之间'); return v; }
  function integer(v, min, max, label) { number(v, min, max, label); if (!Number.isInteger(v)) error(label + ' 必须是整数'); return v; }
  function text(v, max, label) { if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) error(label + ' 不是有效文字'); return v; }
  function flag(v, label) { if (typeof v !== 'boolean') error(label + ' 必须是开关值'); return v; }
  function score(v) { return v == null ? null : number(v, 0, 1, '模型分数'); }
  function key(v) { object(v, '调性'); return {tonic: integer(v.tonic, 0, 11, '主音'), mode: v.mode === 'major' || v.mode === 'minor' ? v.mode : error('调式须为 major 或 minor')}; }
  function bpmEstimate(v) { if (v == null) return null; object(v, '速度估计'); return {value: number(v.value, 20, 400, '估计 BPM'), modelScore: score(v.modelScore), method: text(v.method || 'model', 160, '估计方法')}; }
  function keyEstimate(v) { if (v == null) return null; var k = key(v); k.modelScore = score(v.modelScore); k.method = text(v.method || 'model', 160, '估计方法'); return k; }
  function snapshot(e, duration) { object(e, '原始音符'); var n = {onset: number(e.onset, 0, duration, '原始起点'), end: number(e.end, 0, duration, '原始终点'), midiPitch: integer(e.midiPitch, 0, 127, '原始 MIDI 音高'), velocity: integer(e.velocity, 1, 127, '原始力度')}; if (n.end <= n.onset) error('音符终点必须晚于起点'); return n; }
  function sfxParams(s) { object(s, '音效参数'); var out = {}; for (var r of [['seed',1,999999],['frequency',40,4000],['endFrequency',20,8000],['duration',.05,4],['attack',.001,1],['decay',.01,3],['noise',0,1],['filter',100,20000],['volume',0,1]]) out[r[0]] = number(s[r[0]], r[1], r[2], '音效 ' + r[0]); if (!['sine','square','sawtooth','triangle'].includes(s.wave)) error('音效波形不受支持'); out.wave = s.wave; out.preset = text(s.preset || 'custom', 40, '音效名称'); return out; }
  function validateProject(input) {
    var p = object(input, '工程');
    if (p.format !== FORMAT || p.version !== VERSION) error('不支持的转写工程格式或版本', 'UNSUPPORTED_VERSION');
    var duration = number(p.duration, .001, MAX_SECONDS, '时间线终点');
    var src = object(p.source, '音频来源'), source = {name: text(src.name, 240, '源文件名'), duration: number(src.duration, duration, MAX_SECONDS, '源音频时长'), offset: number(src.offset == null ? 0 : src.offset, 0, duration, '片段起点'), sampleRate: src.sampleRate == null ? null : integer(src.sampleRate, 8000, 384000, '采样率')};
    source.clipDuration = number(src.clipDuration == null ? duration - source.offset : src.clipDuration, .001, duration, '分析片段时长');
    if (Math.abs(source.offset + source.clipDuration - duration) > .000001) error('片段起点与时长不匹配时间线终点');
    var a = object(p.analysis || {}, '分析结果'), o = object(p.overrides || {}, '手动设置');
    if (!Array.isArray(p.stems) || p.stems.length !== 4) error('工程必须包含 vocals、drums、bass、other 四个声部');
    var seenStems = new Set(), seenEvents = new Set(), count = 0;
    var stems = p.stems.map(function (s) {
      object(s, '声部'); if (!STEM_IDS.includes(s.id) || seenStems.has(s.id)) error('声部名称无效或重复'); seenStems.add(s.id);
      var instrument = s.instrument; if (s.id === 'drums') { if (instrument !== 'percussion') error('鼓声部必须使用 percussion'); } else if (!INSTRUMENTS.includes(instrument)) error('不支持的乐器音色');
      if (!Array.isArray(s.events) || s.events.length > MAX_EVENTS || (count += s.events.length) > MAX_EVENTS) error('工程最多 ' + MAX_EVENTS + ' 个音符');
      if (s.id === 'drums' && s.events.length) error('鼓声部仅保留音频，不能伪造为有音高的音符');
      var events = s.events.map(function (e) {
        object(e, '音符'); var n = snapshot(e, duration); n.id = text(e.id, 100, '音符 ID'); if (!n.id || seenEvents.has(n.id)) error('音符 ID 不能为空或重复'); seenEvents.add(n.id);
        if (e.sourceStem !== s.id) error('音符来源声部与所在声部不匹配'); n.sourceStem = s.id; n.modelScore = score(e.modelScore); n.original = snapshot(e.original || e, source.duration); return n;
      }).sort(function (x,y) { return x.onset-y.onset || x.end-y.end || x.midiPitch-y.midiPitch || x.id.localeCompare(y.id); });
      return {id:s.id,name:text(s.name,80,'声部名称'),instrument:instrument,volume:number(s.volume,0,1,'声部音量'),mute:flag(s.mute,'静音'),solo:flag(s.solo,'独奏'),events:events};
    });
    stems.sort(function (x,y) {return STEM_IDS.indexOf(x.id)-STEM_IDS.indexOf(y.id);});
    var cues = p.sfxEvents == null ? [] : p.sfxEvents, cueIds = new Set(); if (!Array.isArray(cues) || cues.length > 32) error('音效最多 32 个');
    cues = cues.map(function(c) {object(c,'音效'); var id=text(c.id,100,'音效 ID'); if (!id || cueIds.has(id)) error('音效 ID 不能为空或重复'); cueIds.add(id); var params=sfxParams(c.params); var onset=number(c.onset,0,duration,'音效起点'); if (onset+params.duration > duration+EPS) error('音效超出时间线终点，请移早音效起点'); return {id:id,onset:onset,params:params};}).sort(function(x,y){return x.onset-y.onset;});
    return {format:FORMAT,version:VERSION,title:text(p.title,100,'工程标题'),duration:duration,source:source,analysis:{bpm:bpmEstimate(a.bpm),key:keyEstimate(a.key)},overrides:{bpm:o.bpm == null ? null : number(o.bpm,20,400,'手动 BPM'),key:o.key == null ? null : key(o.key)},stems:stems,sfxEvents:cues};
  }
  function createProject(options) {
    options = options || {}; var duration = options.duration == null ? 30 : options.duration;
    var offset = options.offset == null ? 0 : options.offset;
    return validateProject({format:FORMAT,version:VERSION,title:options.title || '音频转写工程',duration:duration,source:{name:options.name || '未命名音频',duration:options.sourceDuration == null ? duration : options.sourceDuration,offset:offset,clipDuration:duration-offset,sampleRate:options.sampleRate == null ? null : options.sampleRate},analysis:{bpm:null,key:null},overrides:{bpm:null,key:null},stems:STEM_IDS.map(function(id){return {id:id,name:LABELS[id],instrument:id==='drums'?'percussion':id==='bass'?'bass':id==='vocals'?'flute':'piano',volume:.8,mute:false,solo:false,events:[]};}),sfxEvents:[]});
  }
  function effectiveBpm(p) { return p.overrides && p.overrides.bpm != null ? p.overrides.bpm : p.analysis && p.analysis.bpm ? p.analysis.bpm.value : 120; }
  function effectiveKey(p) { return p.overrides && p.overrides.key ? key(p.overrides.key) : p.analysis && p.analysis.key ? key(p.analysis.key) : {tonic:0,mode:'major'}; }
  function notationKey(k) { if (typeof k === 'number') return integer(k,0,11,'调性'); k=key(k || {tonic:0,mode:'major'}); return (k.tonic+(k.mode==='minor'?3:0))%12; }
  function pitchInfo(midi,k,maxOctaves) {
    integer(midi,0,127,'MIDI 音高'); var tonic=notationKey(k), base=60+tonic, scale=[0,2,4,5,7,9,11], best=null;
    for (var octave=-(maxOctaves == null ? 6 : maxOctaves);octave<=(maxOctaves == null ? 6 : maxOctaves);octave++) for(var degree=0;degree<7;degree++) {var accidental=midi-(base+octave*12+scale[degree]); if(Math.abs(accidental)>1) continue; var rank=Math.abs(accidental)*100+(accidental<0?1:0); if(!best||rank<best.rank) best={digit:degree+1,accidental:accidental,octave:octave,rank:rank};}
    if(!best) error('音符 '+midi+' 超出简谱正负两个八度范围，请移调或使用 MIDI。','COMPOSER_PITCH'); var mark=best.accidental===1?'#':best.accidental===-1?'b':'';
    return {digit:best.digit,accidental:best.accidental,octave:best.octave,midiPitch:midi,text:mark+best.digit+(best.octave>=0?"'".repeat(best.octave):','.repeat(-best.octave)),notationKey:tonic};
  }
  function pitchToDigit(midi,k) {return pitchInfo(midi,k).text;}
  function estimateKey(stems) {
    var hist=new Array(12).fill(0), count=0;
    for(var s of stems) for(var e of s.events) {hist[e.midiPitch%12]+=(e.end-e.onset)*(e.velocity/127);count++;}
    if(count<3) return null;
    var profiles={major:[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],minor:[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17]}, best=null;
    var mean=hist.reduce(function(a,b){return a+b;},0)/12;
    for(var mode of ['major','minor']) for(var tonic=0;tonic<12;tonic++){var profile=profiles[mode],pm=profile.reduce(function(a,b){return a+b;},0)/12,dot=0,aa=0,bb=0;for(var i=0;i<12;i++){var x=hist[(i+tonic)%12]-mean,y=profile[i]-pm;dot+=x*y;aa+=x*x;bb+=y*y;}var value=dot/Math.sqrt(Math.max(1e-20,aa*bb));if(!best||value>best.rank)best={tonic:tonic,mode:mode,rank:value};}
    return {tonic:best.tonic,mode:best.mode,modelScore:null,method:'音高分布启发式估计；请听辨确认'};
  }
  function estimateBpm(stems) {
    var times=[];for(var s of stems)for(var e of s.events)times.push(e.onset);times.sort(function(a,b){return a-b;});times=times.filter(function(t,i){return !i||t-times[i-1]>.04;});
    if(times.length<4)return null;var gaps=[];for(var i=1;i<times.length;i++){var gap=times[i]-times[i-1];if(gap>=.1&&gap<=2)gaps.push(gap);}if(gaps.length<3)return null;gaps.sort(function(a,b){return a-b;});var bpm=60/gaps[Math.floor(gaps.length/2)];while(bpm>180)bpm/=2;while(bpm<60)bpm*=2;return {value:Math.round(bpm*10)/10,modelScore:null,method:'音符起点间隔启发式估计；可能有半速/倍速歧义'};
  }
  function fromBackendResult(result,options) {
    object(result,'模型结果');options=options||{};var offset=number(result.offset == null ? 0 : result.offset,0,MAX_SECONDS,'片段起点'),clip=number(result.duration,.001,MAX_SECONDS-offset,'片段时长'),p=createProject({duration:offset+clip,sourceDuration:result.sourceDuration == null ? offset+clip : result.sourceDuration,offset:offset,name:options.name || result.sourceName || '导入的音频',title:(options.title || options.name || '音频转写工程').slice(0,100),sampleRate:result.sampleRate == null ? null : result.sampleRate});
    if(!Array.isArray(result.stems)||!result.stems.length||result.stems.length>4)error('模型结果缺少声部');var seen=new Set();
    for(var s of result.stems){object(s,'模型声部');if(!STEM_IDS.includes(s.id)||seen.has(s.id))error('模型声部无效或重复');seen.add(s.id);var target=p.stems.find(function(t){return t.id===s.id;});if(!Array.isArray(s.noteEvents)||s.noteEvents.length>MAX_EVENTS)error('模型音符数组无效');target.events=s.noteEvents.map(function(e,i){object(e,'模型音符');var amp=number(e.amplitude == null ? .8 : e.amplitude,0,1,'音符振幅'),n={id:s.id+'-'+i,onset:e.start,end:e.end,midiPitch:e.midi,velocity:Math.max(1,Math.round(amp*127)),modelScore:e.modelScore == null ? null : e.modelScore,sourceStem:s.id};n.original={onset:n.onset,end:n.end,midiPitch:n.midiPitch,velocity:n.velocity};return n;});}
    p=validateProject(p);var estimates=result.estimates || {};p.analysis={bpm:estimates.bpm == null ? estimateBpm(p.stems) : bpmEstimate(estimates.bpm),key:estimates.key == null ? estimateKey(p.stems) : keyEstimate(estimates.key)};return validateProject(p);
  }
  function parseProject(raw) { if(typeof raw!=='string'||raw.length>MAX_JSON_BYTES)error('转写工程 JSON 过大或不是文字'); var p;try{p=JSON.parse(raw);}catch(e){error('无法读取转写工程 JSON');}return validateProject(p); }
  function serializeProject(p) { return JSON.stringify(validateProject(p),null,2); }
  function quantizeProject(input,gridBeats,options) {
    var p=validateProject(input);options=options||{};gridBeats=gridBeats==null?.25:gridBeats;number(gridBeats,1/64,4,'量化网格');var step=60/effectiveBpm(p)*gridBeats,origin=options.origin==null?p.source.offset:number(options.origin,0,p.duration,'量化起点');
    for(var s of p.stems) for(var e of s.events){var onset=Math.max(0,origin+Math.round((e.onset-origin)/step)*step),end=origin+Math.round((e.end-origin)/step)*step;if(end<=onset)end=onset+step;if(end>p.duration+EPS)error('量化会让音符超出分析片段，未修改工程。请缩小网格或先调整尾音。','QUANTIZE_BOUNDARY');e.onset=onset;e.end=Math.min(end,p.duration);}
    return validateProject(p);
  }
  function activeStems(p,includeMuted) {var solo=p.stems.some(function(s){return s.solo;});return p.stems.filter(function(s){return s.id!=='drums'&&(includeMuted||(!s.mute&&s.volume>0&&(!solo||s.solo)));});}
  function buildPlaybackEvents(input,options) {var p=validateProject(input),out=[];for(var s of activeStems(p,options&&options.includeMuted))for(var e of s.events)out.push({start:e.onset,duration:e.end-e.onset,pitch:e.midiPitch,velocity:e.velocity,gain:s.volume*(e.velocity/127),instrument:s.instrument,stemId:s.id,eventId:e.id});return out.sort(function(a,b){return a.start-b.start||a.pitch-b.pitch;});}
  function core(){if(root.StudioCore)return root.StudioCore;if(typeof require==='function')return require('./core.js');error('简谱模块未载入');}
  function toComposerProject(input,options) {
    var p=validateProject(input);options=options||{};var bpm=effectiveBpm(p);if(bpm<40||bpm>240)error('简谱作曲器只支持 40–240 BPM，请手动设定速度或导出 MIDI。','COMPOSER_BPM');
    var start=options.start==null?0:number(options.start,0,p.duration,'简谱片段起点'),end=options.end==null?p.duration:number(options.end,start,p.duration,'简谱片段终点');if(end<=start)error('请选定非空简谱片段');var length=(end-start)*bpm/60;if(length>180+EPS)error('这个片段超过简谱作曲器 180 拍上限，请选择更短片段；完整音符仍可导出 MIDI。','COMPOSER_EXCERPT');
    if(end-start>90+EPS)error('这个片段超过简谱作曲器 90 秒试听上限，请选择更短片段；完整音符仍可导出 MIDI。','COMPOSER_EXCERPT');
    var k=notationKey(effectiveKey(p)),lanes=[],sawNotes=false;
    for(var s of activeStems(p,options.includeMuted)){var groups=[];for(var e of s.events){if(e.end<=start+EPS||e.onset>=end-EPS)continue;if(e.onset<start-EPS||e.end>end+EPS)error('片段边界穿过音符，请把边界移到音符外，避免截断。','COMPOSER_BOUNDARY');var info=pitchInfo(e.midiPitch,k,2);if(Math.abs(info.octave)>2)error('音符 '+e.midiPitch+' 超出简谱正负两个八度范围，请移调或使用 MIDI。','COMPOSER_PITCH');var beat=(e.onset-start)*bpm/60,dur=(e.end-e.onset)*bpm/60;if(dur<.125-EPS||dur>16+EPS)error('音符时值超出简谱 0.125–16 拍范围，请明确量化/编辑或使用 MIDI。','COMPOSER_DURATION');var last=groups[groups.length-1];if(last&&Math.abs(last.beat-beat)<EPS&&Math.abs(last.duration-dur)<EPS&&last.pitches.length<8)last.pitches.push(info.text);else groups.push({beat:beat,duration:dur,pitches:[info.text]});sawNotes=true;}
      var local=[];for(var group of groups){var lane=local.find(function(l){return l.end<=group.beat+EPS;});if(!lane){lane={stem:s,notes:[],end:0};local.push(lane);lanes.push(lane);}lane.notes.push(group);lane.end=group.beat+group.duration;}
    }
    if(!sawNotes)error('所选片段没有可发送的有音高音符。');if(lanes.length>4)error('重叠音符需要 '+lanes.length+' 条独立简谱声部，超过四轨上限。请选择较少声部/较短片段，或导出完整多声部 MIDI。','COMPOSER_POLYPHONY');
    function decimal(n){return String(Number(n.toFixed(12)));}
    function durationToken(token,d){if(d<.125-EPS||d>16+EPS)error('音符之间有不足 0.125 拍的间隔；请明确量化后重试或导出 MIDI。','COMPOSER_GAP');return token+':'+decimal(d);}
    function rests(gap,arr){if(gap<=EPS)return;var count=Math.ceil(gap/16-EPS),part=gap/count;for(var i=0;i<count;i++)arr.push(durationToken('0',part));}
    var out=core().defaultProject();out.title=p.title;out.key=k;out.bpm=bpm;out.volume=1;out.loop=false;out.tracks=lanes.map(function(l,i){var tokens=[],cursor=0;for(var n of l.notes){rests(n.beat-cursor,tokens);tokens.push(durationToken(n.pitches.length===1?n.pitches[0]:'['+n.pitches.join(' ')+']',n.duration));cursor=n.beat+n.duration;}rests(length-cursor,tokens);if(tokens.length>1000)error('转换后某轨超过 1000 个音符/休止符，请缩短片段。','COMPOSER_EVENTS');var notation=tokens.join(' ');if(notation.length>12000)error('转换后乐谱超过 12000 字符，请缩短片段。','COMPOSER_EVENTS');core().parse(notation,k);return {name:(l.stem.name+' '+(i+1)).slice(0,40),instrument:l.stem.instrument,volume:l.stem.volume,mute:options.includeMuted?l.stem.mute:false,notation:notation};});
    out.conversionWarnings=['简谱作曲器按音轨设置力度，不保留逐音力度或模型分数；原始转写工程仍保留这些信息。','转换只发送有音高音符，不包含分离音频、鼓录音或音效。'];return out;
  }
  function toMidi(input,options) {
    var p=validateProject(input);options=options||{};var ppq=options.ppq==null?9600:integer(options.ppq,24,32767,'MIDI PPQ'),tempo=Math.round(60000000/effectiveBpm(p));
    var data=[],channels=[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15],channelCursor=0,tracks=[];
    function ascii(s){return Array.from(s,function(c){return c.charCodeAt(0);});}function utf8(s){if(typeof TextEncoder!=='undefined')return Array.from(new TextEncoder().encode(s));return Array.from(unescape(encodeURIComponent(s)),function(c){return c.charCodeAt(0);});}
    function u32(n){return [Math.floor(n/16777216)&255,Math.floor(n/65536)&255,Math.floor(n/256)&255,n&255];}function vlq(n){if(!Number.isSafeInteger(n)||n<0||n>268435455)error('MIDI 时间差超出范围');var out=[n%128];while(n=Math.floor(n/128))out.unshift(n%128+128);return out;}
    function append(target,items){for(var v of items)target.push(v);}function nameMeta(name){var b=utf8(name);return [255,3].concat(vlq(b.length),b);}function tick(seconds){return Math.round(seconds*1000000*ppq/tempo);}
    function trackBytes(events,lastTick){events.sort(function(a,b){return a.tick-b.tick||a.order-b.order;});var out=[],previous=0;for(var e of events){var delta=e.tick-previous;while(delta>268435455){append(out,vlq(268435455));append(out,[255,127,0]);previous+=268435455;delta=e.tick-previous;}append(out,vlq(delta));append(out,e.bytes);previous=e.tick;}var tail=Math.max(0,lastTick-previous);while(tail>268435455){append(out,vlq(268435455));append(out,[255,127,0]);tail-=268435455;}append(out,vlq(tail));append(out,[255,47,0]);return out;}
    tracks.push(trackBytes([{tick:0,order:0,bytes:nameMeta(p.title)},{tick:0,order:1,bytes:[255,81,3,(tempo>>16)&255,(tempo>>8)&255,tempo&255]}],tick(p.duration)));
    var programs={piano:0,guitar:24,bass:33,flute:73,strings:48,brass:56,organ:19};
    for(var s of activeStems(p,options.includeMuted)){if(!s.events.length)continue;var pool=[],ev=[{tick:0,order:-3,bytes:nameMeta(s.name+' ['+s.id+']')}];
      for(var n of s.events){var start=tick(n.onset),end=tick(n.end);if(end<=start)error('某个音符短于当前 MIDI 时钟分辨率；提高 PPQ 或编辑音长。','MIDI_RESOLUTION');var voice=pool.find(function(v){return !v.busy.has(n.midiPitch)||v.busy.get(n.midiPitch)<=start;});if(!voice){if(channelCursor>=channels.length)error('同音高重叠需要超过 15 个 MIDI 旋律通道；请减少重叠，原始工程未改变。','MIDI_CHANNELS');voice={channel:channels[channelCursor++],busy:new Map()};pool.push(voice);ev.push({tick:0,order:-2,bytes:[192+voice.channel,programs[s.instrument]]},{tick:0,order:-1,bytes:[176+voice.channel,7,Math.round(s.volume*127)]});}voice.busy.set(n.midiPitch,end);ev.push({tick:start,order:1,bytes:[144+voice.channel,n.midiPitch,n.velocity]},{tick:end,order:0,bytes:[128+voice.channel,n.midiPitch,0]});}
      tracks.push(trackBytes(ev,tick(p.duration)));
    }
    append(data,ascii('MThd'));append(data,[0,0,0,6,0,1,(tracks.length>>8)&255,tracks.length&255,(ppq>>8)&255,ppq&255]);for(var t of tracks){append(data,ascii('MTrk'));append(data,u32(t.length));append(data,t);}return new Uint8Array(data);
  }
  return {FORMAT:FORMAT,VERSION:VERSION,STEM_IDS:STEM_IDS.slice(),INSTRUMENTS:INSTRUMENTS.slice(),MAX_EVENTS:MAX_EVENTS,MAX_SECONDS:MAX_SECONDS,MAX_JSON_BYTES:MAX_JSON_BYTES,createProject:createProject,validateProject:validateProject,parseProject:parseProject,serializeProject:serializeProject,fromBackendResult:fromBackendResult,effectiveBpm:effectiveBpm,effectiveKey:effectiveKey,notationKey:notationKey,pitchInfo:pitchInfo,pitchToDigit:pitchToDigit,quantizeProject:quantizeProject,buildPlaybackEvents:buildPlaybackEvents,toComposerProject:toComposerProject,toMidi:toMidi,validateSfxParams:sfxParams};
});
