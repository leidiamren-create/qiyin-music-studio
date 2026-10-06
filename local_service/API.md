# 本机音频识别 API v1

Only http://127.0.0.1:8765 (or localhost on the same port), served by server.py. Bind is never 0.0.0.0. No CORS; POST requires matching Origin and Host, rejecting cross-site requests. Browser must load the app through this server, not file://. Port may be explicitly changed via --port.

- GET /api/health → {ok,ready,missing:[],busy,limits:{uploadBytes:104857600,previewSeconds:25,fullSeconds:600,retainedJobs:8},engine}
- POST /api/jobs?mode=preview|full|stem&offset=0&stem=vocals|bass|drums|other&full=0|1 with raw File bytes, Content-Length and X-Filename: encodeURIComponent(filename). Default preview processes up to 25 seconds from offset. Full processes remainder up to 600 seconds and rejects longer inputs. mode=stem bypasses separator; full=1 permits up to 600 seconds. One running/uploading job; HTTP409 if busy.
- GET /api/jobs/{id} → {id,status:queued|running|done|error|cancelled,stage,progress:0..1,error:null|string}. Poll at about 1 second. stage may be loading,decoding,separating,transcribing,complete,error,cancelled.
- POST /api/jobs/{id}/cancel terminates worker and child processes; completed jobs are unchanged.
- GET /api/jobs/{id}/result → below. HTTP409 until done, HTTP404 after retained job is evicted or server restarted.
- GET /api/jobs/{id}/audio/original|vocals|bass|drums|other → analyzed clip WAV, with byte-range support.

Result fields:

    {
      version: 1, id, mode, sourceName,
      sourceDuration: <original seconds>, offset: <clip start>, duration: <clip seconds>,
      originalAudioUrl: '/api/jobs/{id}/audio/original',
      stems: [{
        id: 'vocals'|'bass'|'drums'|'other', label, audioUrl,
        noteEvents: [{start,end,midi,amplitude,modelScore,confidenceLabel:'needs_review'}],
        uncertainty: [<Chinese explanations>]
      }],
      estimates: null,
      warnings: [],
      engine: {separator,transcriber,chunkSeconds:6,localOnly:true},
      metrics: {elapsedSeconds,availableMemoryAtStartBytes}
    }

start/end are absolute seconds in ORIGINAL audio, including offset. Every audio URL holds only the analyzed clip, so original absolute playback position = audio.currentTime + offset. Note amplitude and modelScore are Basic Pitch activation, NOT calibrated correctness probability. MIDI volume can approximate amplitude*127. No note events are fabricated for silence or model failures. Drums always has an empty notes array and its actual separated/selected audio. “Other” may contain multiple instruments. estimates is null; BPM/key are user choices, not confident inferred facts.

Temporary audio belongs to the current server process, at most 8 jobs retained; starting a ninth drops the oldest completed job. Normal server exit cleans temporary audio. A crash/forced OS termination may leave OS-temporary files; do not claim secure erasure. Inputs are removed once processing ends. Exported project JSON should store editable notes and source metadata, not pretend audio URLs are portable or embed original copyrighted audio without an explicit user choice.

CLI proof:

    python local_service/pipeline.py --input INPUT.wav --work OUTPUTDIR --mode preview
    python local_service/pipeline.py --input STEM.wav --work OUTPUTDIR --mode stem --stem bass

Setup: Python3.11, pinned requirements, python local_service/setup_models.py. Official model SHA256 verification. Runtime local processing performs no required internet requests; model/package download is a separate setup step. ORT_DISABLE_TELEMETRY=1 is applied before native import; API suppression also occurs before sessions. Limits: 100MiB input, finite positive duration, known audio container demuxers only, 25-second preview or max10-minute full, 6-second separation chunks with context, memory/disk check, bounded CPU threads. Separation/transcription are approximate; never describe them as recovering original source tracks exactly.

Desktop integration: set STUDIO_API_TOKEN to a random secret and send X-Studio-Token on every /api request, including health and audio. The desktop loopback proxy validates its own frontend origin, then rewrites Host/Origin to the Python server port. Token-bearing POST /api/shutdown gracefully stops the server and workers, cleaning temporary audio. This endpoint is disabled in tokenless CLI mode. Set STUDIO_MODEL_DIR to a writable model root outside packaged ASAR. Set ORT_DISABLE_TELEMETRY=1 before launching Python as defense in depth (the service also applies it before importing native model libraries).
