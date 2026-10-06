/* Numbered Music Studio audio engine. Original application code. See LICENSE.txt.
 * Offline/file:// friendly: no network requests, Web Audio dependency, or build step.
 * Optional bundled PCM sample bank: StudioSamples { instrument: [{midi,rate,data,loopStart,loopEnd}] }.
 * Optional Unlicense/public-domain jsfxr engine: global sfxr, supplied by vendor/jsfxr.js.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudioAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var TWO_PI = Math.PI * 2;
  var MAX_DURATION = 90;
  var instrumentInfo = [
    ['piano', '钢琴', '清亮的击弦音色，适合旋律与和弦'],
    ['guitar', '木吉他', '温暖的拨弦音色，适合分解和弦'],
    ['bass', '贝斯', '低沉的拨弦音色，适合低音伴奏'],
    ['flute', '长笛', '轻柔的吹管音色，适合舒缓旋律'],
    ['strings', '弦乐', '缓慢起音的弦乐层，适合长音'],
    ['brass', '铜管', '明亮有力的铜管音色，适合号角旋律'],
    ['organ', '风琴', '持续发声的风琴音色，适合和声'],
    ['percussion', '鼓组', '1 底鼓、2 踩镲、3 军鼓、4 嗵鼓、5 开镲、6 镲、7 拍手']
  ];
  var profiles = {
    piano: {attack: 0.003, release: 0.28, gain: 0.48},
    guitar: {attack: 0.002, release: 0.16, gain: 0.65},
    bass: {attack: 0.004, release: 0.14, gain: 0.68},
    flute: {attack: 0.045, release: 0.14, gain: 0.44},
    strings: {attack: 0.11, release: 0.36, gain: 0.42},
    brass: {attack: 0.035, release: 0.15, gain: 0.29},
    organ: {attack: 0.007, release: 0.09, gain: 0.25},
    percussion: {attack: 0.001, release: 0.18, gain: 0.54}
  };
  var sampleCache = new Map(), loopCache = new Map();
  var SINE_SIZE = 4096;
  var sineTable = new Float32Array(SINE_SIZE + 1);
  for (var t = 0; t <= SINE_SIZE; t++) sineTable[t] = Math.sin(TWO_PI * t / SINE_SIZE);
  function finite(value, fallback) { value = Number(value); return Number.isFinite(value) ? value : fallback; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function sine(phase) {
    phase -= Math.floor(phase);
    var index = phase * SINE_SIZE;
    var i = index | 0;
    return sineTable[i] + (sineTable[i + 1] - sineTable[i]) * (index - i);
  }
  function midiHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function seeded(seed) {
    var state = (finite(seed, 1) >>> 0) || 1;
    return function () { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
  }
  function validRate(rate) {
    rate = finite(rate, 44100);
    if (rate < 8000 || rate > 96000 || !Number.isInteger(rate)) throw new RangeError('采样率需要为 8000–96000 之间的整数。');
    return rate;
  }
  function envelope(time, gate, attack, release) {
    var attackGain = Math.min(1, time / Math.max(0.0001, attack));
    attackGain = attackGain * (2 - attackGain);
    if (time <= gate) return attackGain;
    var r = (time - gate) / release;
    return r >= 1 ? 0 : attackGain * Math.pow(1 - r, 2);
  }
  function getCore() {
    if (root.StudioCore && root.StudioCore.parse) return root.StudioCore;
    if (typeof require === 'function') {
      try { return require('./core.js'); } catch (ignore) { /* Expose a useful error below. */ }
    }
    throw new Error('简谱解析器没有载入，请保持 core.js 与页面在同一文件夹。');
  }
  function sampleBank() { return root.StudioSamples || root.StudioSampleBank || {}; }
  function sampleEntries(id) {
    var bank = sampleBank();
    var entries = bank[id] || (bank.instruments && bank.instruments[id]);
    return Array.isArray(entries) ? entries : (entries && Array.isArray(entries.samples) ? entries.samples : []);
  }
  function base64Bytes(value) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
    var binary = root.atob(value), bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function decodeSample(entry) {
    if (sampleCache.has(entry)) return sampleCache.get(entry);
    var data = entry.data || entry.pcm || entry.base64;
    var decoded;
    if (typeof data === 'string') {
      var bytes = base64Bytes(data), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      decoded = new Float32Array(Math.floor(bytes.length / 2));
      for (var i = 0; i < decoded.length; i++) decoded[i] = view.getInt16(i * 2, true) / 32768;
    } else if (data instanceof Float32Array) decoded = data;
    else if (Array.isArray(data) || ArrayBuffer.isView(data)) decoded = Float32Array.from(data);
    else return null;
    // Remove leading codec padding while retaining a 3 ms pre-attack margin.
    var peak = 0;
    for (var k = 0; k < decoded.length; k++) peak = Math.max(peak, Math.abs(decoded[k]));
    var onset = 0, limit = Math.min(decoded.length, Math.floor(finite(entry.rate || entry.sampleRate, 22050) * 0.12));
    while (onset < limit && Math.abs(decoded[onset]) < peak * 0.003) onset++;
    var trim = Math.max(0, onset - Math.floor(finite(entry.rate || entry.sampleRate, 22050) * 0.003));
    if (trim > 0 && !entry.loopStart) decoded = decoded.subarray(trim);
    sampleCache.set(entry, decoded);
    return decoded;
  }
  function addSample(output, start, midi, gate, id, gain, rate) {
    var entries = sampleEntries(id);
    if (!entries.length) return false;
    var entry = entries.reduce(function (best, e) { return Math.abs(finite(e.midi, 60) - midi) < Math.abs(finite(best.midi, 60) - midi) ? e : best; }, entries[0]);
    var data = decodeSample(entry);
    if (!data || data.length < 2) return false;
    var speed = finite(entry.rate || entry.sampleRate, 22050) / rate * Math.pow(2, (midi - finite(entry.midi, 60)) / 12);
    var profile = profiles[id] || profiles.piano;
    var release = profile.release, count = Math.ceil((gate + release) * rate);
    var startFrame = Math.round(start * rate), phase = 0;
    var loopStart = Math.max(0, Math.floor(finite(entry.loopStart, 0)));
    var loopEnd = Math.min(data.length - 1, Math.floor(finite(entry.loopEnd, 0)));
    var crossfade = 0;
    if (!loopEnd && (id === 'flute' || id === 'strings')) {
      var loop = loopCache.get(entry);
      if (!loop) {
        var sourceRate = finite(entry.rate || entry.sampleRate, 22050);
        var ls = Math.floor(sourceRate * 0.9), le = Math.min(data.length - 2, Math.floor(sourceRate * 2.8));
        var cf = Math.floor(sourceRate * 0.065);
        // Correlate the loop overlap around its nominal end to avoid opposite-phase seams.
        var search = Math.ceil(sourceRate / midiHz(finite(entry.midi, 60)));
        var bestScore = -Infinity, bestEnd = le;
        for (var shift = -search; shift <= search; shift++) {
          var dot = 0, aa = 0, bb = 0;
          for (var k = 0; k < cf; k += 5) {
            var a = data[ls + k] || 0, b = data[le + shift - cf + k] || 0;
            dot += a * b; aa += a * a; bb += b * b;
          }
          var score = dot / Math.sqrt(Math.max(1e-12, aa * bb));
          if (score > bestScore) { bestScore = score; bestEnd = le + shift; }
        }
        loop = {start: ls, end: bestEnd, crossfade: cf};
        loopCache.set(entry, loop);
      }
      loopStart = loop.start; loopEnd = loop.end; crossfade = loop.crossfade;
    }
    var hasLoop = loopEnd > loopStart + Math.max(16, crossfade * 2);
    var sampleGain = finite(entry.gain, 1) * gain;
    for (var n = 0; n < count && startFrame + n < output.length; n++) {
      if (phase >= data.length - 1) break;
      var index = phase | 0, frac = phase - index;
      var value = data[index] + (data[index + 1] - data[index]) * frac;
      if (hasLoop && crossfade && phase >= loopEnd - crossfade) {
        var blend = (phase - (loopEnd - crossfade)) / crossfade;
        var second = loopStart + phase - (loopEnd - crossfade), si = second | 0;
        var nextValue = data[si] + (data[si + 1] - data[si]) * (second - si);
        value = value * (1 - blend) + nextValue * blend;
      }
      // Preserve the recorded attack. This short envelope only removes a boundary click.
      value *= envelope(n / rate, gate, 0.0015, release);
      output[startFrame + n] += value * sampleGain;
      phase += speed;
      if (hasLoop && phase >= loopEnd) phase = loopStart + crossfade + ((phase - loopEnd) % (loopEnd - loopStart - crossfade));
    }
    return true;
  }
  function addPluck(output, startFrame, frequency, gate, id, gain, rate, random) {
    var bass = id === 'bass';
    var size = Math.max(4, Math.round(rate / frequency));
    var ring = new Float32Array(size);
    var previous = 0;
    for (var j = 0; j < size; j++) { previous = 0.5 * previous + 0.5 * random(); ring[j] = previous; }
    // A pick away from the bridge suppresses every few harmonics.
    var delay = Math.max(1, Math.round(size * (bass ? 0.24 : 0.16)));
    var copy = ring.slice();
    for (var j2 = 0; j2 < size; j2++) ring[j2] -= copy[(j2 + delay) % size] * 0.65;
    var profile = profiles[id], count = Math.ceil((gate + profile.release) * rate), pointer = 0;
    var damp = bass ? 0.9985 : 0.9965, smooth = bass ? 0.56 : 0.5, low = 0;
    for (var n = 0; n < count && startFrame + n < output.length; n++) {
      var next = (pointer + 1) % size;
      var v = ring[pointer];
      ring[pointer] = damp * (smooth * v + (1 - smooth) * ring[next]);
      pointer = next;
      low += (v - low) * (bass ? 0.28 : 0.6);
      var time = n / rate;
      var body = bass ? sine(frequency * time) * Math.exp(-time * 1.1) * 0.32 : sine(frequency * time) * Math.exp(-time * 2.8) * 0.08;
      output[startFrame + n] += (low * 3.4 + body) * envelope(time, gate, profile.attack, profile.release) * gain;
    }
  }
  function addPercussion(output, startFrame, midi, gate, gain, rate, random) {
    var degree = ((Math.round(midi) % 12) + 12) % 12;
    var kind = degree === 0 || degree === 1 ? 'kick' : degree === 2 || degree === 3 ? 'hat' : degree === 4 ? 'snare' : degree === 5 || degree === 6 ? 'tom' : degree === 7 || degree === 8 ? 'openhat' : degree === 9 || degree === 10 ? 'cymbal' : 'clap';
    var length = kind === 'kick' ? 0.5 : kind === 'snare' ? 0.32 : kind === 'hat' ? 0.12 : kind === 'tom' ? 0.36 : kind === 'clap' ? 0.24 : 0.7;
    var count = Math.ceil(length * rate), low = 0, phase = 0;
    for (var n = 0; n < count && startFrame + n < output.length; n++) {
      var time = n / rate, noise = random(), value = 0;
      low += (noise - low) * 0.13;
      if (kind === 'kick') {
        phase += (48 + 100 * Math.exp(-time * 50)) / rate;
        value = sine(phase) * Math.exp(-time * 10) + noise * Math.exp(-time * 140) * 0.22;
      } else if (kind === 'tom') {
        phase += (110 + 50 * Math.exp(-time * 30)) / rate;
        value = sine(phase) * Math.exp(-time * 12) + low * Math.exp(-time * 30) * 0.28;
      } else if (kind === 'snare') {
        value = (noise - low) * Math.exp(-time * 18) * 0.85 + sine(180 * time) * Math.exp(-time * 30) * 0.46;
      } else if (kind === 'clap') {
        var flutter = time < 0.03 ? 0.45 + 0.55 * Math.pow(sine(time * 70), 2) : Math.exp(-(time - 0.03) * 24);
        value = (noise - low) * flutter * 0.62;
      } else {
        var metal = (sine(3450 * time) * sine(2371 * time) + sine(4217 * time) * 0.3);
        value = ((noise - low) * 0.66 + metal * 0.25) * Math.exp(-time * (kind === 'hat' ? 52 : kind === 'openhat' ? 9 : 6));
      }
      output[startFrame + n] += value * Math.min(1, time * 1500) * Math.min(1, (length - time) * 300) * gain;
    }
  }
  function addSynth(output, start, midi, gate, id, gain, rate, seed) {
    var profile = profiles[id] || profiles.piano;
    var frequency = midiHz(midi), random = seeded(seed);
    var startFrame = Math.round(start * rate);
    if (id === 'guitar' || id === 'bass') return addPluck(output, startFrame, frequency, gate, id, gain * profile.gain, rate, random);
    if (id === 'percussion') return addPercussion(output, startFrame, midi, gate, gain * profile.gain, rate, random);
    var count = Math.ceil((gate + profile.release) * rate);
    var amplitudes = id === 'piano' ? [1, 0.58, 0.33, 0.18, 0.12, 0.075, 0.043, 0.025] : id === 'flute' ? [1, 0.17, 0.07, 0.025] : id === 'organ' ? [1, 0.6, 0.46, 0.22, 0.19, 0.12, 0.08] : id === 'strings' ? [1, 0.48, 0.29, 0.17, 0.12, 0.09, 0.065, 0.045] : [1, 0.6, 0.38, 0.28, 0.19, 0.12, 0.07];
    var phases = amplitudes.map(function () { return 0; }), lowNoise = 0, phase = 0;
    var attack = Math.min(profile.attack, Math.max(0.002, gate * 0.3));
    for (var n = 0; n < count && startFrame + n < output.length; n++) {
      var time = n / rate;
      var vibrato = id === 'flute' || id === 'strings' || id === 'brass' ? sine(time * 5.1) * Math.min(1, time / 0.25) * (id === 'strings' ? 0.0035 : 0.002) : 0;
      phase += frequency * (1 + vibrato) / rate;
      var value = 0;
      for (var h = 0; h < amplitudes.length; h++) {
        var harmonic = h + 1;
        if (frequency * harmonic > rate * 0.46) break;
        var amplitude = amplitudes[h];
        if (id === 'piano') {
          // Slight string inharmonicity and faster loss of upper harmonics.
          phases[h] += frequency * harmonic * Math.sqrt(1 + 0.00012 * harmonic * harmonic) / rate;
          amplitude *= Math.exp(-time * (0.7 + h * 0.47) * Math.pow(frequency / 261.63, 0.3));
          value += sine(phases[h]) * amplitude;
          if (h < 3) value += sine(phases[h] * 1.0014) * amplitude * 0.21;
        } else if (id === 'strings') {
          value += (sine(phase * harmonic) * 0.65 + sine(phase * harmonic * 1.004 + 0.15) * 0.35) * amplitude;
        } else {
          if (id === 'brass' && h > 0) amplitude *= 0.5 + 0.5 * Math.min(1, time / 0.07);
          value += sine(phase * harmonic) * amplitude;
        }
      }
      lowNoise += (random() - lowNoise) * 0.18;
      if (id === 'piano') value += lowNoise * Math.exp(-time * 110) * 0.18;
      if (id === 'flute') value += lowNoise * 0.065;
      if (id === 'strings') value += lowNoise * 0.045;
      value *= envelope(time, gate, attack, profile.release) * profile.gain * gain;
      output[startFrame + n] += value;
    }
  }
  function finish(samples, volume, rate, reverb) {
    // Small deterministic room reflections. No feedback and no sustained tail instability.
    if (reverb) {
      var taps = [[0.037, 0.042], [0.061, 0.03], [0.097, 0.025], [0.149, 0.018]];
      for (var t = 0; t < taps.length; t++) {
        var delay = Math.round(taps[t][0] * rate), amount = taps[t][1];
        for (var i = samples.length - 1; i >= delay; i--) samples[i] += samples[i - delay] * amount;
      }
    }
    var peak = 0, x = 0, y = 0;
    var dc = Math.exp(-TWO_PI * 12 / rate);
    for (var n = 0; n < samples.length; n++) {
      var v = Number.isFinite(samples[n]) ? samples[n] : 0;
      var filtered = v - x + dc * y;
      x = v; y = filtered; samples[n] = filtered;
      peak = Math.max(peak, Math.abs(filtered));
    }
    // Attenuate only overloaded mixes, then apply master volume so volume always means volume.
    var gain = (peak > 0.97 ? 0.97 / peak : 1) * clamp(volume, 0, 1);
    var fade = Math.min(samples.length, Math.round(0.008 * rate));
    for (var j = 0; j < samples.length; j++) {
      var out = samples[j] * gain;
      // Guard against unexpected floating point outliers, without hard clipping transients.
      if (Math.abs(out) > 0.98) out = Math.sign(out) * (0.98 + 0.019 * Math.tanh((Math.abs(out) - 0.98) / 0.019));
      if (j < fade) out *= j / fade;
      if (j >= samples.length - fade) out *= (samples.length - 1 - j) / fade;
      samples[j] = (j === 0 || j === samples.length - 1) ? 0 : out;
    }
    return samples;
  }
  async function renderMusic(project, sampleRate) {
    project = project || {};
    var rate = validRate(sampleRate);
    var bpm = clamp(finite(project.bpm, 100), 30, 300), secondsPerBeat = 60 / bpm;
    var key = ((Math.round(finite(project.key, 0)) % 12) + 12) % 12;
    var tracks = Array.isArray(project.tracks) ? project.tracks.slice(0, 4) : [];
    var core = getCore(), parsedTracks = [], timeline = [], total = 0;
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i] || {};
      var parsed = core.parse(String(track.notation || ''), key);
      if (parsed.errors && parsed.errors.length) throw new Error('第 ' + (i + 1) + ' 轨简谱有误：' + (parsed.errors[0].message || parsed.errors[0]));
      parsedTracks.push(parsed);
      total = Math.max(total, finite(parsed.totalBeats, 0) * secondsPerBeat);
      var list = parsed.events || [];
      for (var e = 0; e < list.length; e++) {
        var event = list[e];
        var eventStart = finite(event.beat, 0) * secondsPerBeat;
        var eventDuration = Math.max(0, finite(event.duration, 1) * secondsPerBeat);
        total = Math.max(total, eventStart + eventDuration);
        timeline.push({track: i, index: event.index == null ? e : event.index, start: eventStart, duration: eventDuration});
      }
    }
    if (total > MAX_DURATION + 1e-8) throw new RangeError('这段音乐超过 90 秒，请缩短简谱或提高速度后重试。');
    // Gate length belongs to notation; an extra release tail keeps the last note natural.
    var duration = Math.min(MAX_DURATION, Math.max(0.15, total + (total ? 0.55 : 0)));
    var samples = new Float32Array(Math.ceil(duration * rate));
    var voiceCache = new Map(), cachedFrames = 0;
    // Let the browser paint its busy indicator before CPU work begins.
    if (typeof root.setTimeout === 'function') await new Promise(function (resolve) { root.setTimeout(resolve, 0); });
    for (var tr = 0; tr < tracks.length; tr++) {
      var current = tracks[tr] || {};
      if (current.mute) continue;
      var volume = clamp(finite(current.volume, 0.8), 0, 1);
      if (!volume) continue;
      var instrument = profiles[current.instrument] ? current.instrument : 'piano';
      var notes = parsedTracks[tr].events || [];
      for (var ev = 0; ev < notes.length; ev++) {
        if (ev && ev % 24 === 0 && typeof root.setTimeout === 'function') await new Promise(function (resolve) { root.setTimeout(resolve, 0); });
        var note = notes[ev], pitches = Array.isArray(note.pitches) ? note.pitches.slice(0, 12) : [];
        var start = finite(note.beat, 0) * secondsPerBeat;
        var noteSeconds = Math.max(0.005, finite(note.duration, 1) * secondsPerBeat);
        var gate = Math.max(0.008, noteSeconds * (instrument === 'strings' || instrument === 'organ' ? 0.99 : 0.94));
        var gain = volume / Math.sqrt(Math.max(1, pitches.length));
        for (var p = 0; p < pitches.length; p++) {
          var midi = clamp(Math.round(finite(pitches[p], 60)), 12, 120);
          if (instrument === 'percussion') midi -= key; // Drum degree is independent of song transposition.
          var toneModule = root.StudioTone;
          if (!toneModule && typeof require === 'function' && current.tone) toneModule = require('./track-tone.js');
          if (current.tone && current.tone.enabled) {
            if (!toneModule) throw new Error('音轨音色模块未载入。');
            var tone = toneModule.clean(current.tone), plan = toneModule.requirements(tone,noteSeconds);
            var toneSignature = 'tone:' + instrument + ':' + midi + ':' + noteSeconds.toFixed(8) + ':' + JSON.stringify(tone);
            var shaped = voiceCache.get(toneSignature);
            if (!shaped) {
              var rawVoice = new Float32Array(Math.ceil((plan.sourceGate + Math.max(.72,profiles[instrument].release)) * rate));
              if (!addSample(rawVoice,0,midi,plan.sourceGate,instrument,({piano:1.05,guitar:1.7,flute:1,strings:1.05}[instrument] || .65),rate)) addSynth(rawVoice,0,midi,plan.sourceGate,instrument,1,rate,137+instrument.length*1013+midi*17);
              shaped = toneModule.process(rawVoice,rate,tone,noteSeconds);
              if (cachedFrames + shaped.length <= 6000000) { voiceCache.set(toneSignature,shaped); cachedFrames += shaped.length; }
            }
            var toneOffset = Math.round(start*rate), toneAvailable = Math.min(shaped.length,samples.length-toneOffset);
            for (var tv=0;tv<toneAvailable;tv++) samples[toneOffset+tv] += shaped[tv]*gain;
          } else if (!addSample(samples, start, midi, gate, instrument, gain * ({piano: 1.05, guitar: 1.7, flute: 1, strings: 1.05}[instrument] || 0.65), rate)) {
            // Identical notes share deterministic synthesis work. Bound the PCM cache to 24 MB.
            var signature = instrument + ':' + midi + ':' + gate.toFixed(6);
            var voice = voiceCache.get(signature);
            if (!voice) {
              var voiceDuration = instrument === 'percussion' ? 0.72 : gate + profiles[instrument].release;
              voice = new Float32Array(Math.ceil(voiceDuration * rate));
              addSynth(voice, 0, midi, gate, instrument, 1, rate, 137 + instrument.length * 1013 + midi * 17);
              if (cachedFrames + voice.length <= 6000000) { voiceCache.set(signature, voice); cachedFrames += voice.length; }
            }
            var offset = Math.round(start * rate), available = Math.min(voice.length, samples.length - offset);
            for (var vi = 0; vi < available; vi++) samples[offset + vi] += voice[vi] * gain;
          }
        }
      }
      // Yield between tracks to keep an awaited render well behaved in both Node and browsers.
      await Promise.resolve();
    }
    finish(samples, finite(project.volume, 0.8), rate, true);
    timeline.sort(function (a, b) { return a.start - b.start || a.track - b.track || a.index - b.index; });
    return {samples: samples, duration: samples.length / rate, events: timeline, sampleRate: rate, musicalDuration: total};
  }
  // Exact absolute-time note playback for editable transcriptions. This does not
  // route through notation, quantize times, shorten gates, or fabricate drum notes.
  // An explicitly selected excerpt may crop notes; omitted bounds never truncate.
  async function renderEvents(events, sampleRate, options) {
    options = options || {};
    var rate = validRate(sampleRate), signal = options.signal;
    function aborted() { if (signal && signal.aborted) { var e = new Error('已取消音频渲染。'); e.name = 'AbortError'; throw e; } }
    function num(v, min, max, name) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RangeError(name + ' 超出范围。'); return v; }
    if (!Array.isArray(events) || events.length > 20000) throw new RangeError('音符列表无效或超过 20000 个音符。');
    var list = events.map(function(e) {
      if (!e || typeof e !== 'object') throw new TypeError('音符数据无效。');
      var pitch = num(e.pitch, 0, 127, '音高'); if (!Number.isInteger(pitch)) throw new RangeError('MIDI 音高必须为整数。');
      if (!profiles[e.instrument] || e.instrument === 'percussion') throw new RangeError('转写音符需要有效的有音高乐器。');
      var start = num(e.start, 0, 86400, '音符起点'), duration = num(e.duration, 0.000001, 86400, '音符时长');
      if (start + duration > 86400) throw new RangeError('音符终点超出范围。');
      var velocity = e.velocity == null ? 100 : num(e.velocity, 1, 127, '力度');
      if (!Number.isInteger(velocity)) throw new RangeError('力度必须为整数。');
      return {start:start,duration:duration,pitch:pitch,instrument:e.instrument,gain:e.gain == null ? velocity / 127 : num(e.gain,0,1,'音符音量'),stemId:e.stemId,eventId:e.eventId};
    });
    var cues = options.sfxEvents == null ? [] : options.sfxEvents;
    if (!Array.isArray(cues) || cues.length > 32) throw new RangeError('音效列表最多 32 个。');
    var transcription = root.TranscriptionCore;
    if (!transcription && typeof require === 'function') { try { transcription = require('./transcription-core.js'); } catch (ignore) {} }
    cues = cues.map(function(c) {
      if (!c || !transcription) throw new Error('音效数据验证模块未载入。');
      return {onset:num(c.onset,0,86400,'音效起点'),params:transcription.validateSfxParams(c.params),id:c.id};
    });
    var last = list.reduce(function(v,e) {return Math.max(v,e.start+e.duration);},0);
    cues.forEach(function(c) {last = Math.max(last,c.onset+c.params.duration);});
    var start = options.start == null ? 0 : num(options.start,0,86400,'试听起点');
    var end = options.end == null ? last : num(options.end,start,86400,'试听终点');
    if (end <= start) throw new RangeError('请选择有长度的试听片段。');
    if (end - start > MAX_DURATION + 1e-8) throw new RangeError('试听与 WAV 每次最多 90 秒，请明确选择一个片段；完整音符仍可导出 MIDI。');
    var duration = end - start, tail = options.tail === false ? 0 : 0.55;
    var output = new Float32Array(Math.ceil((duration + tail) * rate));
    var selected = list.filter(function(e) {return e.gain > 0 && e.start < end && e.start + e.duration > start;});
    if (selected.length > 5000) throw new RangeError('这个片段有超过 5000 个音符，请选择更短片段。');
    var budget = 0;
    for (var event of selected) {
      // Bound sustained-note history as well as output memory when seeking.
      var needed = Math.min(event.duration, end-event.start) + profiles[event.instrument].release;
      if (needed > MAX_DURATION + 0.55) throw new RangeError('某个跨片段长音需要超过 90 秒的声音历史，请从该音符起点试听或编辑长音。');
      budget += needed;
    }
    if (budget > 1800) throw new RangeError('此片段的重叠音符过多，请缩短片段后渲染。');
    aborted();
    await new Promise(function(resolve) { root.setTimeout(resolve,0); });
    var timeline = [];
    for (var i = 0; i < selected.length; i++) {
      aborted();
      var event = selected[i], profile = profiles[event.instrument];
      var gate = Math.min(event.duration,end-event.start);
      var voice = new Float32Array(Math.ceil((gate + profile.release) * rate));
      if (!addSample(voice,0,event.pitch,gate,event.instrument,({piano:1.05,guitar:1.7,flute:1,strings:1.05}[event.instrument] || 0.65),rate)) {
        addSynth(voice,0,event.pitch,gate,event.instrument,1,rate,137+event.instrument.length*1013+event.pitch*17);
      }
      var from = Math.max(0,Math.round((start-event.start)*rate));
      var to = Math.max(0,Math.round((event.start-start)*rate));
      var available = Math.min(voice.length-from,output.length-to);
      for (var j = 0; j < available; j++) output[to+j] += voice[from+j] * event.gain;
      timeline.push({start:event.start-start,duration:event.duration,pitch:event.pitch,stemId:event.stemId,eventId:event.eventId,originalStart:event.start});
      if (i % 8 === 7) await new Promise(function(resolve) { root.setTimeout(resolve,0); });
    }
    for (var cue of cues) {
      aborted();
      if (cue.onset >= end || cue.onset + cue.params.duration <= start) continue;
      var sound = renderSfx(cue.params,rate).samples;
      var from = Math.max(0,Math.round((start-cue.onset)*rate));
      var to = Math.max(0,Math.round((cue.onset-start)*rate));
      var available = Math.min(sound.length-from,output.length-to,Math.ceil((end-cue.onset+tail)*rate)-from);
      for (var j = 0; j < available; j++) output[to+j] += sound[from+j];
    }
    aborted();
    finish(output,options.volume == null ? 0.8 : num(options.volume,0,1,'总音量'),rate,true);
    return {samples:output,sampleRate:rate,duration:output.length/rate,musicalDuration:duration,events:timeline,start:start,end:end};
  }
  function encodeWav(samples, sampleRate) {
    var rate = validRate(sampleRate);
    if (!samples || typeof samples.length !== 'number') throw new TypeError('需要有效的音频采样数据。');
    var byteLength = samples.length * 2;
    var bytes = new Uint8Array(44 + byteLength), view = new DataView(bytes.buffer);
    function text(offset, s) { for (var i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }
    text(0, 'RIFF'); view.setUint32(4, 36 + byteLength, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, byteLength, true);
    for (var n = 0; n < samples.length; n++) {
      var value = clamp(finite(samples[n], 0), -1, 1);
      view.setInt16(44 + n * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return bytes;
  }
  // SFX adapter is defined below; its contract is independent of browser audio playback.
  var sfxPresets = {
    coin: {name: '拾取金币', seed: 21, frequency: 820, endFrequency: 1460, duration: 0.28, attack: 0.002, decay: 0.75, noise: 0, filter: 12000, wave: 'square', volume: 0.65},
    jump: {name: '轻快跳跃', seed: 22, frequency: 180, endFrequency: 760, duration: 0.3, attack: 0.005, decay: 0.4, noise: 0, filter: 8000, wave: 'square', volume: 0.65},
    laser: {name: '激光发射', seed: 23, frequency: 1700, endFrequency: 100, duration: 0.34, attack: 0.002, decay: 0.8, noise: 0.06, filter: 14000, wave: 'sawtooth', volume: 0.65},
    explosion: {name: '低沉爆炸', seed: 24, frequency: 120, endFrequency: 28, duration: 0.9, attack: 0.006, decay: 0.65, noise: 0.92, filter: 1900, wave: 'sine', volume: 0.75},
    hit: {name: '击中冲击', seed: 25, frequency: 220, endFrequency: 60, duration: 0.19, attack: 0.001, decay: 0.9, noise: 0.65, filter: 4500, wave: 'triangle', volume: 0.7},
    whoosh: {name: '挥动掠过', seed: 26, frequency: 420, endFrequency: 95, duration: 0.55, attack: 0.17, decay: 0.55, noise: 0.95, filter: 7200, wave: 'sine', volume: 0.7}
  };
  function getInstruments() {
    return instrumentInfo.map(function (info) { var sampled = sampleEntries(info[0]).length > 0; return {id: info[0], name: (sampled && info[0] === 'strings' ? '小提琴' : info[1]) + (sampled ? ' · 采样' : ' · 合成'), description: info[2] + (sampled ? '；精简双音高真实采样，其余音高由移调获得' + (info[0] === 'flute' || info[0] === 'strings' ? '；长音使用柔和交叉淡化循环' : '') : ''), engine: sampled ? 'sample' : 'synthesis'}; });
  }
  var api = {renderMusic: renderMusic, renderEvents: renderEvents, renderSfx: renderSfx, encodeWav: encodeWav, encode: encodeWav, sfxPresets: sfxPresets, getInstruments: getInstruments, midiHz: midiHz, maxDuration: MAX_DURATION};
  Object.defineProperty(api, 'instruments', {enumerable: true, get: getInstruments});
  return api;

  function renderSfx(params, sampleRate) {
    params = params || sfxPresets.coin;
    var rate = validRate(sampleRate), engine = root.jsfxr;
    if ((!engine || !engine.SoundEffect) && typeof require === 'function') {
      try { engine = require('./vendor/jsfxr.js'); } catch (ignore) { /* Error below names the missing file. */ }
    }
    if (!engine || !engine.SoundEffect || !engine.Params) throw new Error('音效组件未载入，请检查 vendor/jsfxr.js 是否仍在文件夹内。');
    var duration = clamp(finite(params.duration, 0.35), 0.05, 4);
    var frequency = clamp(finite(params.frequency, 660), 20, 8000);
    var endFrequency = clamp(finite(params.endFrequency, frequency), 20, 8000);
    var attack = clamp(finite(params.attack, 0.005), 0.001, 1);
    var decay = clamp(finite(params.decay, 0.25), 0.01, 3);
    var noiseMix = clamp(finite(params.noise, 0), 0, 1);
    var cutoff = clamp(finite(params.filter, 10000), 100, Math.min(20000, rate * 0.45));
    var wave = ['square', 'sine', 'sawtooth', 'triangle'].indexOf(params.wave) >= 0 ? params.wave : 'square';
    var count = Math.ceil(duration * rate), samples = new Float32Array(count);
    var nativeRate = 44100;
    var random = seeded(finite(params.seed, 1));
    var phaseOffset = Math.floor((random() + 1) * 20);
    function source(type) {
      var p = new engine.Params();
      p.wave_type = type;
      p.p_env_attack = Math.sqrt(1 / 100000);
      p.p_env_sustain = Math.sqrt((duration + 0.02) * nativeRate / 100000);
      p.p_env_decay = Math.sqrt(1 / 100000);
      // jsfxr's eight-times oversampled oscillator: Hz = 3528 * (base^2 + .001).
      p.p_base_freq = Math.sqrt(Math.max(0, frequency / 3528 - 0.001));
      var perFrameMultiplier = Math.exp(-Math.log(endFrequency / frequency) / (duration * nativeRate));
      p.p_freq_ramp = Math.cbrt((1 - perFrameMultiplier) / 0.01);
      p.p_freq_dramp = 0;
      p.p_arp_mod = 0;
      p.p_arp_speed = 1;
      // The upstream asymmetric-triangle oscillator becomes a saw at duty=0.
      p.p_duty = wave === 'sawtooth' ? 1 : 0;
      p.p_lpf_freq = 1;
      p.p_hpf_freq = 0;
      p.sound_vol = 0.25;
      p.sample_rate = nativeRate;
      p.sample_size = 16;
      var previousRandom = Math.random;
      Math.random = function () { return (random() + 1) * 0.5; };
      try { return new engine.SoundEffect(p).getRawBuffer().normalized; }
      finally { Math.random = previousRandom; }
    }
    var waveTypes = engine.waveforms || {SQUARE: 0, SAWTOOTH: 1, SINE: 2, NOISE: 3};
    var tone = source(wave === 'square' ? waveTypes.SQUARE : wave === 'sine' ? waveTypes.SINE : waveTypes.SAWTOOTH);
    var noise = noiseMix > 0 ? source(waveTypes.NOISE) : null;
    var toneGain = Math.sqrt(1 - noiseMix) * (wave === 'square' ? 2 : 1);
    var noiseGain = Math.sqrt(noiseMix);
    // Two one-pole filters are deliberately outside jsfxr so the cutoff is in audible Hz.
    var alpha = 1 - Math.exp(-TWO_PI * cutoff / rate), low1 = 0, low2 = 0;
    function read(source, position) {
      var index = Math.floor(position), frac = position - index;
      if (index < 0 || index + 1 >= source.length) return 0;
      return source[index] + (source[index + 1] - source[index]) * frac;
    }
    for (var n = 0; n < count; n++) {
      var time = n / rate, position = time * nativeRate + phaseOffset;
      var value = read(tone, position) * toneGain + (noise ? read(noise, position) * noiseGain : 0);
      low1 += alpha * (value - low1);
      low2 += alpha * (low1 - low2);
      var attackGain = Math.min(1, time / attack);
      var decayGain = Math.exp(-Math.max(0, time - attack) / decay);
      var endFade = Math.min(1, (duration - time) / Math.min(0.02, duration * 0.2));
      samples[n] = low2 * attackGain * decayGain * Math.max(0, endFade);
    }
    finish(samples, finite(params.volume, 0.65), rate, false);
    return {samples: samples, duration: samples.length / rate, sampleRate: rate, engine: 'jsfxr'};
  }
});
