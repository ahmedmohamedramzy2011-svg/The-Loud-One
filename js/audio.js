// ============================================================
//  THE LOUD ONE — procedural audio: music, sfx, 3D sound, voices
//  Everything is synthesized with the Web Audio API. Voice lines
//  use the browser's speech synthesizer with subtitles as backup.
// ============================================================
(function () {
  const S = LO.settings;
  const A = {};
  LO.audio = A;

  let ctx = null, master, musicBus, sfxBus, voiceBus, worldBus, comp;
  A.still = false; // true while the wind has died: the whole world goes silent
  let noiseBuf = null, brownBuf = null;

  A.ready = false;

  A.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    master = ctx.createGain();
    musicBus = ctx.createGain(); sfxBus = ctx.createGain(); voiceBus = ctx.createGain();
    worldBus = ctx.createGain();
    musicBus.connect(master); sfxBus.connect(master); voiceBus.connect(master); worldBus.connect(sfxBus);
    master.connect(comp); comp.connect(ctx.destination);
    applyVolumes();

    // shared noise buffers
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = w;
      last = (last + 0.02 * w) / 1.02;
      b[i] = last * 3.5;
    }
    A.ctx = ctx;
    A.ready = true;
    loadSamples();
    startScheduler();
  };

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(S.master, t, 0.05);
    const k = A.still ? 0 : 1, tc = 0.8;
    if (A.still) {
      // the moment the wind dies, everything else cuts out instantly
      [musicBus, voiceBus, worldBus].forEach(b => { if (b) { b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(0, t); } });
    } else {
      musicBus.gain.setTargetAtTime(S.music * 0.55, t, tc);
      if (worldBus) worldBus.gain.setTargetAtTime(1, t, tc);
    }
    sfxBus.gain.setTargetAtTime(S.sfx, t, 0.05);
    if (!A.still) voiceBus.gain.setTargetAtTime(S.voice * k, t, tc);
  }
  LO.events.addEventListener('settings', applyVolumes);

  A.now = () => (ctx ? ctx.currentTime : 0);

  // ---------- recorded sounds: death screen music, Tenant ringing ----------
  const samples = {};
  const voiceSamples = {};   // the player's recorded lines, keyed by subtitle text
  const voicePending = {};   // in-flight fetch/decode promises keyed by subtitle text
  function decodeB64(b64, cb) {
    try {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(buf.buffer, cb, () => {});
    } catch (e) { /* missing sound is not fatal */ }
  }
  function loadVoiceClip(text, val) {
    if (!val || !ctx) return;
    if (typeof val === 'string' && (val.startsWith('/') || val.startsWith('assets/') || val.startsWith('http'))) {
      if (typeof fetch !== 'function') return;
      const p = fetch(val)
        .then(r => (r && r.ok) ? r.arrayBuffer() : null)
        .then(ab => new Promise(resolve => {
          if (!ab || !ctx) { resolve(null); return; }
          try {
            ctx.decodeAudioData(ab, buf => {
              if (buf) voiceSamples[text] = buf;
              resolve(buf || null);
            }, () => resolve(null));
          } catch (e) { resolve(null); }
        }))
        .catch(() => null)
        .then(buf => {
          delete voicePending[text];
          return buf;
        });
      voicePending[text] = p;
      return;
    }
    decodeB64(val, b => { voiceSamples[text] = b; });
  }
  const BREATH_MAX_SEC = 12.0;
  A.BREATH_MAX_SEC = BREATH_MAX_SEC;
  function trimAudioBuffer(buf, maxSec) {
    if (!buf || !ctx) return buf;
    const maxFrames = Math.min(buf.length, Math.floor(buf.sampleRate * maxSec));
    if (maxFrames <= 0) return buf;
    const out = ctx.createBuffer(buf.numberOfChannels, maxFrames, buf.sampleRate);
    const fadeFrames = Math.min(Math.floor(buf.sampleRate * 0.03), Math.floor(maxFrames * 0.05));
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      dst.set(src.subarray(0, maxFrames));
      for (let i = 0; i < fadeFrames; i++) {
        const k = i / fadeFrames;
        dst[i] *= k;
        dst[maxFrames - 1 - i] *= k;
      }
    }
    return out;
  }
  function loadBreathingClip() {
    if (typeof fetch !== 'function' || !ctx) return;
    const url = '/assets/aistudio/freesound_community-breathing-6091_970a27c3.mp3';
    fetch(url)
      .then(r => (r && r.ok) ? r.arrayBuffer() : null)
      .then(ab => {
        if (!ab || !ctx) return;
        ctx.decodeAudioData(ab, buf => {
          samples.panting = trimAudioBuffer(buf, BREATH_MAX_SEC);
          if (breathAmt > 0.02) A.setBreathing(breathAmt);
        }, () => {});
      })
      .catch(() => {});
  }
  function loadSamples() {
    const V = LO.VOICE_DATA;
    if (V) Object.keys(V).forEach(text => loadVoiceClip(text, V[text]));
    loadBreathingClip();
    const D = LO.SOUND_DATA;
    if (!D) return;
    Object.keys(D).forEach(key => {
      if (key === 'panting') return;
      try {
        const bin = atob(D[key]);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        ctx.decodeAudioData(buf.buffer, b => { samples[key] = b; }, () => {});
      } catch (e) { /* missing sound is not fatal */ }
    });
  }
  A.getBreathingDuration = () => (samples.panting ? samples.panting.duration : 0);
  let deathSrc = null, deathStart = 0;
  A.DEATH_TV_ON = 2.31;     // the click + CRT whine of the TV switching on
  A.DEATH_TAPE = 3.3;       // whine has faded: the tape starts
  A.playDeathMusic = function (onEnd) {
    A.stopDeathMusic();
    if (!ctx || !samples.death) return false;
    const s = ctx.createBufferSource();
    s.buffer = samples.death;
    // plays once; when it finishes you're sent back to the title screen
    s.onended = () => { if (deathSrc === s) { deathSrc = null; onEnd && onEnd(); } };
    const g = ctx.createGain(); g.gain.value = 1.4;
    s.connect(g); g.connect(musicBus);
    deathStart = ctx.currentTime + 0.05;
    s.start(deathStart);
    deathSrc = s;
    return true;
  };
  // seconds into the death track (unwrapped), or null if it isn't playing
  A.deathMusicTime = function () {
    if (!deathSrc) return null;
    return Math.max(0, ctx.currentTime - deathStart);
  };
  A.stopDeathMusic = function () {
    if (deathSrc) { try { deathSrc.stop(); } catch (e) {} deathSrc = null; }
  };
  let ringSrc = null;
  A.playRinging = function () {
    A.stopRinging();
    if (!ctx || !samples.ringing) return;
    const s = ctx.createBufferSource(); s.buffer = samples.ringing;
    const g = ctx.createGain(); g.gain.value = 1.0;
    s.connect(g); g.connect(sfxBus); s.start();
    ringSrc = s;
    s.onended = () => { if (ringSrc === s) ringSrc = null; };
  };
  A.sampleNames = () => Object.keys(samples);
  // the death sound. fast = the short version (noise + TV-off), otherwise the long recording.
  let deathT0 = null;
  A.deathElapsed = function () { return (ctx && deathT0 !== null) ? Math.max(0, ctx.currentTime - deathT0) : null; };
  A.playDeathNoise = function (fast) {
    deathT0 = null;
    if (!ctx) return;
    if (!fast) {
      if (!samples.deathlong) return;
      const s = ctx.createBufferSource(); s.buffer = samples.deathlong;
      const g = ctx.createGain(); g.gain.value = 1.35 * Math.min(1, S.master * 1.25) * Math.max(0.4, S.sfx);
      s.connect(g); g.connect(ctx.destination);
      deathT0 = ctx.currentTime + 0.02; s.start(deathT0);
      return;
    }
    if (!samples.deathnoise) return;
    const s = ctx.createBufferSource(); s.buffer = samples.deathnoise;
    // straight to the speakers (skipping the game's compressor) so nothing squashes it
    // pushed hard into a soft saturator: louder than anything else in the game, without harsh clipping
    const drive = ctx.createGain(); drive.gain.value = 2.2;
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    sat.curve = curve; sat.oversample = '4x';
    const out = ctx.createGain(); out.gain.value = 1.0 * Math.min(1, S.master * 1.25) * Math.max(0.4, S.sfx);
    s.connect(drive); drive.connect(sat); sat.connect(out); out.connect(ctx.destination);
    const t0 = ctx.currentTime;
    s.start(t0);
    deathT0 = t0;
    // ...and the TV switching off picks up exactly where the noise ends (1.40s), so its
    // pop lands as the screen collapses (2.25s after death)
    if (samples.tvoff) {
      const tv = ctx.createBufferSource(); tv.buffer = samples.tvoff;
      const tg = ctx.createGain(); tg.gain.value = 1.4 * Math.min(1, S.master * 1.25) * Math.max(0.4, S.sfx);
      tv.connect(tg); tg.connect(ctx.destination);
      tv.start(t0 + 1.40);
      tvoffScheduled = t0;
    }
  };
  A.stopRinging = function () { if (ringSrc) { try { ringSrc.stop(); } catch (e) {} ringSrc = null; } };

  // the wind has stopped: silence music, voices and every sound the world makes
  // the player is dead: cut every sound that belongs to the living world at once
  // (flashlight, heartbeat, wind, entities, Siren Head). Death sounds and music are unaffected.
  A.worldMuted = false;
  A.silenceWorld = function (on) {
    if (!ctx) return;
    A.worldMuted = on;
    const t = ctx.currentTime;
    if (on) {
      heartAmt = 0;
      breathAmt = 0;
      [breath && breath.g, buzz && buzz.g, wind && wind.g, wind && wind.wg, forestWind && forestWind.g1, forestWind && forestWind.g2,
       tenant && tenant.g, tenant && tenant.og, silent && silent.og, silent && silent.sg,
       moth && moth.g, expo && expo.g1, expo && expo.g2, proxAmb && proxAmb.out, envHum && envHum.g, birdBus, worldBus]
        .forEach(g => { if (g && g.gain) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); } });
      if (breath && breath.src) { try { breath.src.stop(); } catch (e) {} breath = null; }
    } else if (worldBus && !A.still) {
      worldBus.gain.cancelScheduledValues(t); worldBus.gain.setTargetAtTime(1, t, 0.3);
      if (birdBus) birdBus.gain.setTargetAtTime(birdState.enabled && !birdState.indoor ? 1 : 0, t, 0.4);
    }
  };

  A.setStillness = function (on) {
    if (A.still === on) return;
    A.still = on;
    if (on) { A.stopVoices(); A.setBreathing(0); }
    applyVolumes();
  };

  // ---------- helpers ----------
  function noiseSrc(brown, loop) {
    const s = ctx.createBufferSource();
    s.buffer = brown ? brownBuf : noiseBuf;
    s.loop = loop !== false;
    s.loopStart = Math.random();
    return s;
  }
  function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end !== undefined) {
      g.gain.setValueAtTime(Math.max(0.0001, sustain), end);
      g.gain.exponentialRampToValueAtTime(0.0001, end + r);
    }
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  A.mtof = mtof;

  let distCurve = null;
  function distortion(amount) {
    const ws = ctx.createWaveShaper();
    if (!distCurve) {
      const n = 1024; distCurve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; distCurve[i] = Math.tanh(x * amount); }
    }
    ws.curve = distCurve; ws.oversample = '2x';
    return ws;
  }

  // ---------- 3D audio ----------
  let subCamPos = { x: 0, y: 1.6, z: 0 }, subCamRight = { x: 1, z: 0 };
  A.setListener = function (pos, fwd, up) {
    subCamPos = { x: pos.x, y: pos.y, z: pos.z };
    const rx = fwd.y * up.z - fwd.z * up.y;
    const rz = fwd.x * up.y - fwd.y * up.x;
    const rl = Math.hypot(rx, rz) || 1;
    subCamRight = { x: rx / rl, z: rz / rl };
    if (!ctx) return;
    const L = ctx.listener, t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  };
  function panner(pos, ref, roll) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref || 8;
    p.rolloffFactor = roll || 1;
    p.maxDistance = 10000;
    setPannerPos(p, pos);
    return p;
  }
  function setPannerPos(p, pos) {
    if (p.positionX) {
      const t = ctx.currentTime;
      p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03);
    } else p.setPosition(pos.x, pos.y, pos.z);
  }
  A.setPannerPos = (p, pos) => ctx && setPannerPos(p, pos);

  // ---------- player SFX ----------
  A.footstep = function (kind, indoor, forest) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const vol = kind === 'run' ? 0.5 : kind === 'crouch' ? 0.09 : 0.23;
    // crisp dry pine-needle & twig crunch overlay when walking on forest ground
    if (forest && !indoor) {
      const nC = noiseSrc(false, false);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = (kind === 'run' ? 3200 : 2500) + Math.random() * 900; bp.Q.value = 1.25;
      const gC = ctx.createGain();
      env(gC, t, 0.003, vol * (kind === 'run' ? 0.95 : kind === 'crouch' ? 0.55 : 0.78), 0.095, 0.0001);
      nC.connect(bp); bp.connect(gC); gC.connect(sfxBus);
      nC.start(t); nC.stop(t + 0.14);
      const hits = kind === 'crouch' ? 1 : 2;
      for (let i = 0; i < hits; i++) {
        const dt = i === 0 ? 0.008 : 0.032 + Math.random() * 0.025;
        const tw = noiseSrc(false, false);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3400;
        const gt = ctx.createGain();
        env(gt, t + dt, 0.001, vol * (i === 0 ? 0.72 : 0.48), 0.028, 0.0001);
        tw.connect(hp); hp.connect(gt); gt.connect(sfxBus);
        tw.start(t + dt); tw.stop(t + dt + 0.05);
      }
    }
    const stepBufs = [samples.step1, samples.step2, samples.step3, samples.step4, samples.step5].filter(Boolean);
    if (stepBufs.length) {
      const s = ctx.createBufferSource();
      s.buffer = stepBufs[(Math.random() * stepBufs.length) | 0];
      s.playbackRate.value = (kind === 'run' ? 1.06 : kind === 'crouch' ? 0.80 : 0.94) + Math.random() * 0.11;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.value = kind === 'crouch' ? (indoor ? 950 : 1250) : kind === 'run' ? (indoor ? 3200 : 4800) : (indoor ? 1900 : 2800);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.96, t);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t);
      return;
    }
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = (indoor ? 900 : 600) + Math.random() * 300; f.Q.value = 0.9;
    const g = ctx.createGain();
    env(g, t, 0.004, vol, 0.09, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + 0.2);
    // low thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const g2 = ctx.createGain(); env(g2, t, 0.003, vol * 0.8, 0.1, 0.0001);
    o.connect(g2); g2.connect(sfxBus); o.start(t); o.stop(t + 0.15);
  };

  A.footstepAt = function (pos, kind, indoor, forest) {
    if (!ctx || !pos) return;
    const t = ctx.currentTime;
    const p = panner(pos, 6, 1.15);
    p.connect(worldBus);
    const vol = (kind === 'run' ? 0.42 : kind === 'crouch' ? 0.07 : 0.19);
    const stepBufs = [samples.step1, samples.step2, samples.step3, samples.step4, samples.step5].filter(Boolean);
    if (stepBufs.length) {
      const s = ctx.createBufferSource();
      s.buffer = stepBufs[(Math.random() * stepBufs.length) | 0];
      s.playbackRate.value = (kind === 'run' ? 1.06 : kind === 'crouch' ? 0.80 : 0.94) + Math.random() * 0.11;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.value = kind === 'crouch' ? (indoor ? 900 : 1150) : kind === 'run' ? (indoor ? 2800 : 4200) : (indoor ? 1700 : 2500);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.9, t);
      s.connect(f); f.connect(g); g.connect(p);
      s.start(t);
      return;
    }
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = (forest ? 1400 : indoor ? 900 : 600) + Math.random() * 300; f.Q.value = 0.9;
    const g = ctx.createGain();
    env(g, t, 0.004, vol, 0.09, 0.0001);
    n.connect(f); f.connect(g); g.connect(p);
    n.start(t); n.stop(t + 0.2);
  };

  A.land = function (hard) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain(); env(g, t, 0.003, hard ? 0.9 : 0.5, 0.2, 0.0001);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.3);
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g2 = ctx.createGain(); env(g2, t, 0.002, 0.5, 0.15, 0.0001);
    n.connect(f); f.connect(g2); g2.connect(sfxBus); n.start(t); n.stop(t + 0.25);
  };

  A.jumpGrunt = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
    const g = ctx.createGain(); env(g, t, 0.01, 0.25, 0.12, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.2);
  };

  // player exhaustion panting (loops only the 0..12s clip from the breathing asset)
  let breath = null, breathAmt = 0, breathStopTimer = null;
  A.setBreathing = function (amt) {
    const clean = (A.worldMuted || A.still) ? 0 : Math.max(0, Math.min(1, amt || 0));
    breathAmt = clean;
    if (!ctx || !samples.panting) return;
    const t = ctx.currentTime;
    if (clean > 0.02) {
      if (breathStopTimer) { clearTimeout(breathStopTimer); breathStopTimer = null; }
      if (!breath) {
        const src = ctx.createBufferSource();
        src.buffer = samples.panting;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = Math.min(BREATH_MAX_SEC, samples.panting.duration);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 3200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        src.connect(f); f.connect(g); g.connect(sfxBus);
        src.start(t, 0);
        breath = { src, f, g };
      }
      breath.f.frequency.setTargetAtTime(2400 + clean * 2400, t, 0.15);
      breath.g.gain.setTargetAtTime(0.10 + clean * 0.36, t, 0.14);
    } else if (breath) {
      breath.g.gain.setTargetAtTime(0, t, 0.16);
      if (!breathStopTimer) {
        breathStopTimer = setTimeout(() => {
          breathStopTimer = null;
          if (breathAmt <= 0.02 && breath) {
            try { breath.src.stop(); } catch (e) {}
            breath = null;
          }
        }, 650);
      }
    }
  };

  // flashlight hum (the "slight buzzing")
  let buzz = null;
  A.setFlashlightBuzz = function (on, flicker) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!buzz) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 240.7;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 4;
      const g = ctx.createGain(); g.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(); o2.start();
      buzz = { g };
    }
    buzz.g.gain.setTargetAtTime(on ? (0.05 + (flicker || 0) * 0.1) : 0, ctx.currentTime, 0.03);
  };

  A.click = function (hi) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(hi ? 2400 : 1600, t);
    const g = ctx.createGain(); env(g, t, 0.001, 0.15, 0.03, 0.0001);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.05);
  };

  A.shutter = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.07].forEach((dt, i) => {
      const n = noiseSrc(false, false);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      const g = ctx.createGain(); env(g, t + dt, 0.001, i ? 0.35 : 0.5, 0.04, 0.0001);
      n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t + dt); n.stop(t + dt + 0.08);
    });
    // flash recharge whine
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1800, t + 0.15); o.frequency.exponentialRampToValueAtTime(7000, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(0.02, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 1.3);
  };

  A.pickup = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    [72, 79].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
      const g = ctx.createGain(); env(g, t + i * 0.08, 0.005, 0.18, 0.25, 0.0001);
      o.connect(g); g.connect(sfxBus); o.start(t + i * 0.08); o.stop(t + 0.5);
    });
  };

  A.evidenceSting = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    [50, 57, 62, 65].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
      const g = ctx.createGain(); env(g, t + i * 0.03, 0.02, 0.07, 1.6, 0.0001);
      o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 2);
    });
  };

  A.hideDoor = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, t); o.frequency.linearRampToValueAtTime(260, t + 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 6;
    const g = ctx.createGain(); env(g, t, 0.02, 0.06, 0.3, 0.0001);
    o.connect(f); f.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.4);
    const n = noiseSrc(false, false);
    const g2 = ctx.createGain(); env(g2, t + 0.28, 0.002, 0.2, 0.08, 0.0001);
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 900;
    n.connect(f2); f2.connect(g2); g2.connect(sfxBus); n.start(t); n.stop(t + 0.5);
  };

  // heartbeat — intensity 0..1
  let heartNext = 0, heartAmt = 0;
  A.setHeartbeat = function (amt) { heartAmt = A.worldMuted ? 0 : amt; };
  function heartTick() {
    if (!ctx || heartAmt < 0.05 || A.still) return;
    const t = ctx.currentTime;
    if (t < heartNext) return;
    const bpm = 60 + heartAmt * 90;
    heartNext = t + 60 / bpm;
    [0, 0.16].forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
      const g = ctx.createGain(); env(g, t + dt, 0.005, heartAmt * (i ? 0.35 : 0.5), 0.14, 0.0001);
      o.connect(g); g.connect(sfxBus); o.start(t + dt); o.stop(t + dt + 0.2);
    });
  }

  // ambient wind bed
  let wind = null;
  A.setWind = function (vol, gustAmt, tc) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!wind) {
      const n = noiseSrc(true, true);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 250;
      lfo.connect(lg); lg.connect(f.frequency);
      n.connect(f); f.connect(g); g.connect(sfxBus); n.start(); lfo.start();
      // a thin whistle that rises with gusts
      const n2 = noiseSrc(false, true);
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 9;
      const wg = ctx.createGain(); wg.gain.value = 0;
      n2.connect(wf); wf.connect(wg); wg.connect(sfxBus); n2.start();
      wind = { g, wg, wf };
    }
    // vol: overall level, gust: 0..1 strength of the current gust, tc: fade time
    const t = ctx.currentTime, gust = gustAmt === undefined ? 0.5 : gustAmt;
    wind.g.gain.setTargetAtTime(vol * (0.6 + gust * 0.8), t, tc || 1.0);
    wind.wg.gain.setTargetAtTime(vol * gust * gust * 0.5, t, tc || 1.0);
    wind.wf.frequency.setTargetAtTime(700 + gust * 700, t, 0.6);
  };

  // dynamic pine-needle canopy rustle & creaking boughs driven by game wind setting & forest proximity
  let forestWind = null;
  A.setForestWindRustle = function (windVol, gustAmt, forestProx, tc) {
    if (!ctx) return;
    if (A.worldMuted || A.still) {
      if (forestWind) {
        const t = ctx.currentTime;
        forestWind.g1.gain.setTargetAtTime(0, t, 0.15);
        forestWind.g2.gain.setTargetAtTime(0, t, 0.15);
      }
      return;
    }
    const w = Math.max(0, Math.min(1, windVol || 0));
    const p = Math.max(0, Math.min(1, forestProx || 0));
    const gust = gustAmt === undefined ? 0.5 : Math.max(0, Math.min(1, gustAmt));
    if (!forestWind) {
      if (w <= 0.005 || p <= 0.01) return;
      // pine needle canopy rustle
      const n1 = noiseSrc(false, true);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1650; f1.Q.value = 1.1;
      const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.22;
      const lg1 = ctx.createGain(); lg1.gain.value = 520;
      lfo1.connect(lg1); lg1.connect(f1.frequency);
      const g1 = ctx.createGain(); g1.gain.value = 0;
      n1.connect(f1); f1.connect(g1); g1.connect(worldBus);
      n1.start(); lfo1.start();
      // heavy tree-branch sway rustle
      const n2 = noiseSrc(true, true);
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 340; f2.Q.value = 1.7;
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.14;
      const lg2 = ctx.createGain(); lg2.gain.value = 110;
      lfo2.connect(lg2); lg2.connect(f2.frequency);
      const g2 = ctx.createGain(); g2.gain.value = 0;
      n2.connect(f2); f2.connect(g2); g2.connect(worldBus);
      n2.start(); lfo2.start();
      forestWind = { g1, g2, f1, f2 };
    }
    const t = ctx.currentTime, smoothT = tc || 0.75;
    const envLevel = w * (0.25 + gust * 0.85) * (0.08 + p * 0.92);
    forestWind.g1.gain.setTargetAtTime(envLevel * 0.055, t, smoothT);
    forestWind.g2.gain.setTargetAtTime(envLevel * 0.095, t, smoothT);
    forestWind.f1.frequency.setTargetAtTime(1350 + gust * 1150, t, 0.5);
    forestWind.f2.frequency.setTargetAtTime(280 + gust * 180, t, 0.5);
  };

  // procedural rustling forest foliage + eerie wind chimes driven by entity proximity (0..1)
  let proxAmb = null, proxLevel = 0, nextChimeAt = 0;
  const CHIME_NOTES = [523.25, 587.33, 622.25, 783.99, 932.33, 1046.5];
  A.setProximityAmbient = function (nearFactor) {
    if (!ctx) return;
    if (A.worldMuted) { proxLevel = 0; return; }
    proxLevel = Math.max(0, Math.min(1, nearFactor || 0));
    if (!proxAmb) {
      const out = ctx.createGain(); out.gain.value = 1;
      out.connect(worldBus);
      // dual swept bandpass foliage rustle
      const n1 = noiseSrc(false, true);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 2100; f1.Q.value = 1.4;
      const lfo1 = ctx.createOscillator(); lfo1.frequency.value = 0.24;
      const lg1 = ctx.createGain(); lg1.gain.value = 650;
      lfo1.connect(lg1); lg1.connect(f1.frequency);
      const rg = ctx.createGain(); rg.gain.value = 0;
      n1.connect(f1); f1.connect(rg); rg.connect(out);
      n1.start(); lfo1.start();
      proxAmb = { out, rg, f1 };
      nextChimeAt = ctx.currentTime + 2.5;
    }
    const t = ctx.currentTime;
    const rustleGain = (!A.still && !A.worldMuted) ? (0.008 + proxLevel * proxLevel * 0.068) : 0;
    proxAmb.rg.gain.setTargetAtTime(rustleGain, t, 0.35);
    proxAmb.f1.frequency.setTargetAtTime(1750 + proxLevel * 1200, t, 0.45);
  };
  function chimeTick() {
    if (!ctx || !proxAmb || A.still || A.worldMuted || proxLevel <= 0.04) return;
    const t = ctx.currentTime;
    if (t < nextChimeAt) return;
    const interval = Math.max(0.28, 3.8 - proxLevel * 3.35) * (0.65 + Math.random() * 0.7);
    nextChimeAt = t + interval;
    const hits = proxLevel > 0.55 ? (Math.random() < 0.5 ? 2 : 3) : 1;
    for (let h = 0; h < hits; h++) {
      const ht = t + h * (0.08 + Math.random() * 0.14);
      const f0 = CHIME_NOTES[(Math.random() * CHIME_NOTES.length) | 0] * (0.985 + Math.random() * 0.03);
      const dur = 1.3 + Math.random() * 1.1;
      const vol = (0.012 + proxLevel * 0.045) * (h === 0 ? 1 : 0.7);
      const dest = ctx.createStereoPanner ? (() => { const sp = ctx.createStereoPanner(); sp.pan.value = (Math.random() - 0.5) * 1.4; sp.connect(proxAmb.out); return sp; })() : proxAmb.out;
      [[1, 1.0], [2.756, 0.38], [5.404, 0.14]].forEach(([mul, amp]) => {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0 * mul, ht);
        o.frequency.linearRampToValueAtTime(f0 * mul * (1 + (Math.random() - 0.5) * 0.006), ht + dur);
        const g = ctx.createGain();
        env(g, ht, 0.006, vol * amp, dur, 0.0001);
        o.connect(g); g.connect(dest);
        o.start(ht); o.stop(ht + dur + 0.05);
      });
    }
  }

  // subtle randomized exterior forest birdsong — contrasts with the dead-quiet streets
  let birdBus = null;
  const birdState = { enabled: false, indoor: false, perimK: 0, nextAt: 0, calmUntil: 0, hushed: false };
  A.updateBirdsong = function (dt, pos, indoor, halfSize, enabled, disturbed) {
    if (!ctx) return;
    if (!birdBus) {
      birdBus = ctx.createGain();
      birdBus.gain.value = 0;
      birdBus.connect(worldBus);
    }
    const wasOff = !birdState.enabled || birdState.indoor;
    birdState.enabled = !!enabled;
    birdState.indoor = !!indoor;
    if (pos) {
      const lim = halfSize || 110;
      const edgeDist = Math.max(Math.abs(pos.x), Math.abs(pos.z)) / lim;
      birdState.perimK = Math.max(0, Math.min(1, (edgeDist - 0.35) / 0.65));
    } else {
      birdState.perimK = 0;
    }
    const t = ctx.currentTime;
    if (!birdState.enabled || A.still || A.worldMuted) {
      birdBus.gain.setTargetAtTime(0, t, 0.35);
      return;
    }
    if (disturbed) {
      birdState.calmUntil = Math.max(birdState.calmUntil, t + 6.5 + Math.random() * 2.5);
      birdState.hushed = true;
      birdBus.gain.setTargetAtTime(0, t, 0.22);
      return;
    }
    if (t < birdState.calmUntil) {
      birdBus.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    if (birdState.hushed) {
      birdState.hushed = false;
      birdState.nextAt = Math.max(birdState.nextAt, t + 2.0 + Math.random() * 4.5);
    }
    if (birdState.indoor) {
      birdBus.gain.setTargetAtTime(0.12, t, 0.6);
      return;
    }
    birdBus.gain.setTargetAtTime(1, t, 1.0);
    if (wasOff || birdState.nextAt <= 0) {
      birdState.nextAt = t + 4.5 + Math.random() * 5.0;
    }
  };

  function birdTick() {
    if (!ctx || !birdBus || !birdState.enabled || birdState.indoor || A.still || A.worldMuted) return;
    const t = ctx.currentTime;
    if (t < birdState.calmUntil || t < birdState.nextAt) return;
    birdState.nextAt = t + 11.0 + Math.random() * 13.5;

    const species = (Math.random() * 3) | 0;
    const count = species === 0 ? 2 : species === 1 ? 3 : 2 + ((Math.random() * 3) | 0);
    const baseFreq = species === 0 ? (1580 + Math.random() * 280)
      : species === 1 ? (2120 + Math.random() * 380)
      : (1820 + Math.random() * 340);
    const pan = (Math.random() < 0.5 ? -1 : 1) * (0.42 + Math.random() * 0.53);
    const dest = ctx.createStereoPanner
      ? (() => { const sp = ctx.createStereoPanner(); sp.pan.value = pan; sp.connect(birdBus); return sp; })()
      : birdBus;

    const scale = (0.72 + birdState.perimK * 0.38) * (0.75 + Math.random() * 0.4);
    let nt = t + 0.05;
    for (let i = 0; i < count; i++) {
      const dur = species === 0 ? (0.14 + Math.random() * 0.09)
        : species === 1 ? (0.075 + Math.random() * 0.05)
        : (0.11 + Math.random() * 0.08);
      const f0 = baseFreq * (i === 0 ? 1 : (0.9 + Math.random() * 0.24));
      const f1 = f0 * (species === 0 ? (i % 2 ? 0.84 : 1.12) : species === 1 ? 1.18 : 0.92);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = (f0 + f1) * 0.5; bp.Q.value = 3.2;

      const g = ctx.createGain();
      const peak = (0.011 + Math.random() * 0.007) * scale;
      env(g, nt, 0.014, peak, dur * 0.5, peak * 0.3, dur * 0.45, nt + 0.014 + dur * 0.55);

      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(f0, nt);
      o1.frequency.exponentialRampToValueAtTime(f1, nt + dur);

      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(f0 * 2.005, nt);
      o2.frequency.exponentialRampToValueAtTime(f1 * 2.005, nt + dur);
      const og2 = ctx.createGain(); og2.gain.value = 0.14;

      o1.connect(bp); o2.connect(og2); og2.connect(bp);
      bp.connect(g); g.connect(dest);

      // faint distant treeline echo
      const eg = ctx.createGain(); eg.gain.value = 0.24;
      const dl = ctx.createDelay ? ctx.createDelay(0.5) : null;
      if (dl) {
        dl.delayTime.value = 0.19 + Math.random() * 0.11;
        g.connect(dl); dl.connect(eg); eg.connect(dest);
      }

      o1.start(nt); o1.stop(nt + dur + 0.18);
      o2.start(nt); o2.stop(nt + dur + 0.18);
      nt += dur + (species === 1 ? 0.06 + Math.random() * 0.05 : 0.16 + Math.random() * 0.22);
    }
  }

  // startled wing-flaps & alarm chirps when a forest flock scatters overhead
  A.birdScatter = function (pos) {
    if (!ctx || A.still || A.worldMuted || !pos) return;
    const t = ctx.currentTime;
    const p = panner(pos, 18, 0.55);
    p.connect(worldBus);
    for (let i = 0; i < 5; i++) {
      const ft = t + i * (0.042 + Math.random() * 0.028);
      const n = noiseSrc(false, false);
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1550 + i * 160; hp.Q.value = 1.2;
      const g = ctx.createGain();
      env(g, ft, 0.004, 0.14 - i * 0.015, 0.065, 0.0001);
      n.connect(hp); hp.connect(g); g.connect(p);
      n.start(ft); n.stop(ft + 0.1);
    }
    for (let c = 0; c < 3; c++) {
      const ct = t + 0.02 + c * (0.08 + Math.random() * 0.06);
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = 2100 + Math.random() * 700;
      o.frequency.setValueAtTime(f0, ct);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.32, ct + 0.045);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.92, ct + 0.09);
      const g = ctx.createGain();
      env(g, ct, 0.005, 0.06, 0.09, 0.0001);
      o.connect(g); g.connect(p);
      o.start(ct); o.stop(ct + 0.12);
    }
  };

  // subtle low mechanical hum when standing/moving near large noisy machinery (HVAC, transformers, water tanks)
  let envHum = null;
  A.setEnvHum = function (amt) {
    if (!ctx) return;
    const v = (A.worldMuted || A.still) ? 0 : Math.max(0, Math.min(1, amt || 0));
    if (!envHum) {
      if (v <= 0.01) return;
      const g = ctx.createGain(); g.gain.value = 0; g.connect(worldBus);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 120.4;
      const og1 = ctx.createGain(); og1.gain.value = 0.45;
      const og2 = ctx.createGain(); og2.gain.value = 0.25;
      const fan = noiseSrc(true, true);
      const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 190; ff.Q.value = 0.9;
      const fg = ctx.createGain(); fg.gain.value = 0.45;
      o1.connect(og1); og1.connect(lp);
      o2.connect(og2); og2.connect(lp);
      fan.connect(ff); ff.connect(fg); fg.connect(lp);
      lp.connect(g);
      o1.start(); o2.start(); fan.start();
      envHum = { g };
    }
    envHum.g.gain.setTargetAtTime(v * v * 0.028, ctx.currentTime, 0.18);
  };


  // ---------- THE MOTHS ----------
  let moth = null;
  // papery flutter that rises while your light rests on one
  A.setMothFlutter = function (amount) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!moth) {
      const n = noiseSrc(false, true);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
      const amp = ctx.createGain(); amp.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(amp.gain);
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(f); f.connect(amp); amp.connect(g); g.connect(sfxBus);
      n.start(); lfo.start();
      moth = { g, lfo };
    }
    const t = ctx.currentTime, a = Math.max(0, Math.min(1, amount));
    moth.g.gain.setTargetAtTime(a * a * 0.35, t, 0.08);
    moth.lfo.frequency.setTargetAtTime(18 + a * 30, t, 0.1);
  };
  A.mothShriek = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 10, 0.8); p.connect(sfxBus);
    [1, 1.07, 1.49].forEach((mul, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(1300 * mul, t);
      o.frequency.linearRampToValueAtTime(2600 * mul, t + 0.25);
      o.frequency.exponentialRampToValueAtTime(500 * mul, t + 1.4);
      const g = ctx.createGain(); env(g, t, 0.01, 0.28, 1.4, 0.0001);
      o.connect(g); g.connect(p); o.start(t); o.stop(t + 1.5);
    });
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4000; f.Q.value = 2;
    const g2 = ctx.createGain(); env(g2, t, 0.005, 0.6, 1.0, 0.0001);
    n.connect(f); f.connect(g2); g2.connect(p); n.start(t); n.stop(t + 1.2);
  };

  let tvoffScheduled = -99;
  // an old TV switching off. The recorded switch-off is scheduled with the death noise;
  // this synthesized one is only a fallback if that recording isn't available.
  A.tvOff = function () {
    if (!ctx) return;
    if (samples.tvoff && ctx.currentTime - tvoffScheduled < 6) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(9000, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    const g = ctx.createGain(); env(g, t, 0.003, 0.08, 0.45, 0.0001);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.5);
    const th = ctx.createOscillator(); th.type = 'sine';
    th.frequency.setValueAtTime(90, t); th.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const g2 = ctx.createGain(); env(g2, t, 0.002, 0.6, 0.25, 0.0001);
    th.connect(g2); g2.connect(sfxBus); th.start(t); th.stop(t + 0.3);
  };

  // ---------- police radio: key-up chirp and squelch tail around each transmission ----------
  A.radioIn = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1250, t);
    const g = ctx.createGain(); env(g, t, 0.003, 0.06, 0.09, 0.0001);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.12);
    A.staticBurst(null, 0.18, 0.08);
  };
  A.radioOut = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    const g = ctx.createGain(); env(g, t, 0.002, 0.14, 0.22, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.3);
  };

  // ---------- THE SNEAKY ONE: slow, wet breathing right behind you ----------
  A.sneakyBreath = function (pos) {
    if (!ctx) return { move() {}, stop() {} };
    const p = panner(pos, 1.5, 1.2);
    const n = noiseSrc(false, true);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 2.5;
    const amp = ctx.createGain(); amp.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1.4;
    const lg = ctx.createGain(); lg.gain.value = 0.9;
    lfo.connect(lg); lg.connect(amp.gain);
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1.1, ctx.currentTime, 0.15);
    n.connect(f); f.connect(amp); amp.connect(g); g.connect(p); p.connect(worldBus);
    n.start(); lfo.start();
    return {
      move(pp) { setPannerPos(p, pp); },
      stop() { const t = ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.05); try { n.stop(t + 0.4); lfo.stop(t + 0.4); } catch (e) {} },
    };
  };

  // ---------- THE FAST ONE: fence smash, hound howl, rapid paws, locker slam, adrenaline ----------
  A.fenceSmash = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 70, 0.22); p.connect(worldBus);
    // distant-carry path so the breach is unmistakable from anywhere in town while preserving stereo direction
    const carry = ctx.createGain(); carry.gain.value = 0.58;
    const carryLP = ctx.createBiquadFilter(); carryLP.type = 'lowpass'; carryLP.frequency.value = 1750;
    carry.connect(carryLP); carryLP.connect(worldBus);

    // deep physical post-break thump
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(140, t); sub.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    const sg = ctx.createGain(); env(sg, t, 0.003, 1.25, 0.55, 0.0001);
    sub.connect(sg); sg.connect(p); sg.connect(carry); sub.start(t); sub.stop(t + 0.65);

    if (samples.fenceSmash) {
      const s = ctx.createBufferSource();
      s.buffer = samples.fenceSmash;
      s.playbackRate.value = 0.96 + Math.random() * 0.08;
      const g = ctx.createGain(); g.gain.value = 1.25;
      s.connect(g); g.connect(p); g.connect(carry);
      s.start(t);
      return;
    }

    const knock = ctx.createOscillator(); knock.type = 'triangle';
    knock.frequency.setValueAtTime(240, t); knock.frequency.exponentialRampToValueAtTime(52, t + 0.34);
    const kg = ctx.createGain(); env(kg, t, 0.002, 1.05, 0.34, 0.0001);
    knock.connect(kg); kg.connect(p); kg.connect(carry); knock.start(t); knock.stop(t + 0.42);

    // 2. cascading wood-plank snaps & splintering crackle
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.062;
      const n = noiseSrc(false, false);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 850 + i * 420; f.Q.value = 1.25;
      const gn = ctx.createGain(); env(gn, tt, 0.002, 1.15 - i * 0.14, 0.26, 0.0001);
      n.connect(f); f.connect(gn); gn.connect(p); gn.connect(carry); n.start(tt); n.stop(tt + 0.34);
    }

    // 3. top security-wire snap + splinter scatter tail
    const wire = ctx.createOscillator(); wire.type = 'sine';
    wire.frequency.setValueAtTime(760, t + 0.03); wire.frequency.exponentialRampToValueAtTime(460, t + 0.42);
    const wg = ctx.createGain(); env(wg, t + 0.03, 0.003, 0.28, 0.38, 0.0001);
    wire.connect(wg); wg.connect(p); wire.start(t + 0.03); wire.stop(t + 0.46);

    const tail = noiseSrc(true, false);
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 540;
    const tg = ctx.createGain(); env(tg, t + 0.08, 0.04, 0.65, 0.85, 0.0001);
    tail.connect(tf); tf.connect(tg); tg.connect(p); tg.connect(carry); tail.start(t + 0.08); tail.stop(t + 0.98);
  };
  A.fastHowl = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 55, 0.28); p.connect(worldBus);
    const dist = distortion(4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 780; f.Q.value = 1.5;
    dist.connect(f); f.connect(p);
    [1, 1.07].forEach((mul, i) => {
      const o = ctx.createOscillator(); o.type = i ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(220 * mul, t);
      o.frequency.linearRampToValueAtTime(580 * mul, t + 0.22);
      o.frequency.exponentialRampToValueAtTime(170 * mul, t + 1.15);
      const g = ctx.createGain(); env(g, t, 0.03, 0.58, 1.1, 0.0001);
      o.connect(g); g.connect(dist); o.start(t); o.stop(t + 1.25);
    });
  };
  A.fastStep = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 10, 0.9); p.connect(worldBus);
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 250; f.Q.value = 1.1;
    const g = ctx.createGain(); env(g, t, 0.002, 0.55, 0.06, 0.0001);
    n.connect(f); f.connect(g); g.connect(p); n.start(t); n.stop(t + 0.09);
  };
  A.fastSlam = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 8, 0.8); p.connect(worldBus);
    // metallic locker slam + sub impact
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    const g = ctx.createGain(); env(g, t, 0.002, 1.3, 0.5, 0.0001);
    o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.55);
    const cl = ctx.createOscillator(); cl.type = 'square';
    cl.frequency.setValueAtTime(340, t); cl.frequency.exponentialRampToValueAtTime(95, t + 0.25);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 2;
    const cg = ctx.createGain(); env(cg, t, 0.002, 0.7, 0.28, 0.0001);
    cl.connect(f); f.connect(cg); cg.connect(p); cl.start(t); cl.stop(t + 0.35);
    const n = noiseSrc(false, false);
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 1800;
    const ng = ctx.createGain(); env(ng, t, 0.002, 0.85, 0.22, 0.0001);
    n.connect(nf); nf.connect(ng); ng.connect(p); n.start(t); n.stop(t + 0.3);
  };
  A.adrenaline = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.14].forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(85, t + dt); o.frequency.exponentialRampToValueAtTime(36, t + dt + 0.16);
      const g = ctx.createGain(); env(g, t + dt, 0.004, i ? 0.65 : 0.8, 0.18, 0.0001);
      o.connect(g); g.connect(sfxBus); o.start(t + dt); o.stop(t + dt + 0.22);
    });
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.5); f.Q.value = 1.5;
    const g = ctx.createGain(); env(g, t, 0.04, 0.35, 0.55, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.7);
  };

  // ---------- SIREN HEAD: smashing through a non-evidence building ----------
  A.buildingSmash = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 26, 0.45); p.connect(worldBus);
    // massive structural sub boom
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(115, t); sub.frequency.exponentialRampToValueAtTime(24, t + 0.85);
    const sg = ctx.createGain(); env(sg, t, 0.004, 1.5, 0.9, 0.0001);
    sub.connect(sg); sg.connect(p); sub.start(t); sub.stop(t + 0.95);
    // splintering timber & collapsing masonry bursts
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.075;
      const n = noiseSrc(false, false);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380 + i * 260; f.Q.value = 0.85;
      const g = ctx.createGain(); env(g, tt, 0.003, 1.15 - i * 0.14, 0.34, 0.0001);
      n.connect(f); f.connect(g); g.connect(p); n.start(tt); n.stop(tt + 0.42);
    }
    // settling rubble rumble tail
    const tail = noiseSrc(true, false);
    const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 420;
    const tg = ctx.createGain(); env(tg, t + 0.1, 0.08, 0.85, 1.5, 0.0001);
    tail.connect(lf); lf.connect(tg); tg.connect(p); tail.start(t + 0.1); tail.stop(t + 1.65);
  };

  // ---------- THE EXPOSURE ----------
  let expo = null;
  // a lens-whine and detuned hum that grows as it gets closer in the viewfinder
  A.setExposure = function (amount) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!expo) {
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 3200;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55;
      const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = 57.3;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const g1 = ctx.createGain(); g1.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = 0;
      o1.connect(g1); g1.connect(sfxBus);
      o2.connect(f); o3.connect(f); f.connect(g2); g2.connect(sfxBus);
      o1.start(); o2.start(); o3.start();
      expo = { g1, g2, o1 };
    }
    const t = ctx.currentTime, a = Math.max(0, Math.min(1, amount));
    expo.g1.gain.setTargetAtTime(a * a * 0.025, t, 0.15);
    expo.g2.gain.setTargetAtTime(a * 0.22, t, 0.2);
    expo.o1.frequency.setTargetAtTime(3200 + a * 1800, t, 0.3);
  };
  A.exposureLunge = function () {
    if (!ctx) return;
    A.staticBurst(null, 1.0, 0.9);
    A.shutter();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.8);
    const g = ctx.createGain(); env(g, t, 0.003, 0.5, 0.8, 0.0001);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.9);
  };

  // ---------- echolocation ping (Siren Head) ----------
  A.echoPing = function (voice) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const dest = voice ? voice.out : worldBus;
    [0, 0.45, 0.9].forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(2600 - i * 300, t + dt);
      o.frequency.exponentialRampToValueAtTime(420, t + dt + 0.35);
      const g = ctx.createGain(); env(g, t + dt, 0.005, 0.5, 0.4, 0.0001);
      o.connect(g); g.connect(dest); o.start(t + dt); o.stop(t + dt + 0.5);
    });
    // a long reverberant tail that seems to wash over you
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 12;
    const g2 = ctx.createGain(); env(g2, t + 1.2, 0.3, 0.25, 2.2, 0.0001);
    n.connect(f); f.connect(g2); g2.connect(worldBus); n.start(t + 1.2); n.stop(t + 4);
  };

  // thrown rock hitting the ground
  A.rockClack = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 6, 1); p.connect(sfxBus);
    [0, 0.12, 0.2].forEach((dt, i) => {
      const n = noiseSrc(false, false);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 - i * 300; f.Q.value = 4;
      const g = ctx.createGain(); env(g, t + dt, 0.001, 0.9 / (i + 1), 0.08, 0.0001);
      n.connect(f); f.connect(g); g.connect(p); n.start(t + dt); n.stop(t + dt + 0.12);
    });
  };

  // ---------- THE TENANT (hiding spot lurker) ----------
  let tenant = null;
  A.setTenant = function (amount) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!tenant) {
      // whispering: band-passed noise with jittery amplitude
      const n = noiseSrc(false, true);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 3;
      const amp = ctx.createGain(); amp.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 7;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(amp.gain);
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(f); f.connect(amp); amp.connect(g); g.connect(sfxBus);
      // low breathing drone
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 44;
      const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 160;
      const og = ctx.createGain(); og.gain.value = 0;
      o.connect(of); of.connect(og); og.connect(sfxBus);
      n.start(); lfo.start(); o.start();
      tenant = { g, og, f, lfo };
    }
    const t = ctx.currentTime;
    const a = Math.max(0, amount);
    if (!isFinite(a)) return;
    tenant.g.gain.setTargetAtTime(a * a * 0.5, t, 0.2);
    tenant.og.gain.setTargetAtTime(a * a * 0.35, t, 0.3);
    tenant.lfo.frequency.setTargetAtTime(5 + a * 9 + Math.random() * 3, t, 0.1);
    tenant.f.frequency.setTargetAtTime(1600 + Math.random() * 1600, t, 0.08);
  };
  A.tenantScream = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    A.boom(0.8);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const d = distortion(5);
    const g = ctx.createGain(); env(g, t, 0.005, 0.7, 0.9, 0.0001);
    o.connect(d); d.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 1);
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 1;
    const g2 = ctx.createGain(); env(g2, t, 0.005, 0.6, 0.6, 0.0001);
    n.connect(f); f.connect(g2); g2.connect(sfxBus); n.start(t); n.stop(t + 0.7);
  };
  A.knock = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.18, 0.32].forEach(dt => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(180, t + dt); o.frequency.exponentialRampToValueAtTime(70, t + dt + 0.08);
      const g = ctx.createGain(); env(g, t + dt, 0.002, 0.5, 0.1, 0.0001);
      o.connect(g); g.connect(sfxBus); o.start(t + dt); o.stop(t + dt + 0.15);
    });
  };

  // ---------- THE SILENT ONE ----------
  let silent = null;
  A.setSilentOne = function (amount) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!silent) {
      // tinnitus ring + a sub-bass pressure you feel more than hear
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 7400;
      const og = ctx.createGain(); og.gain.value = 0;
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 31;
      const sg = ctx.createGain(); sg.gain.value = 0;
      o.connect(og); og.connect(sfxBus); sub.connect(sg); sg.connect(sfxBus);
      o.start(); sub.start();
      silent = { og, sg, o };
    }
    const t = ctx.currentTime, a = Math.max(0, Math.min(1, amount));
    silent.og.gain.setTargetAtTime(a * a * 0.05, t, 0.4);
    silent.sg.gain.setTargetAtTime(a * 0.5, t, 0.4);
    silent.o.frequency.setTargetAtTime(7400 + a * 1200, t, 0.5);
  };
  A.silentHit = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = ctx.createGain(); env(g, t, 0.002, 0.45, 0.25, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.3);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const g2 = ctx.createGain(); env(g2, t, 0.003, 0.8, 0.3, 0.0001);
    o.connect(g2); g2.connect(sfxBus); o.start(t); o.stop(t + 0.35);
  };
  A.hurt = function (heavy) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const hurts = (heavy ? [samples.hurt4, samples.hurt1, samples.hurt2, samples.hurt3] : [samples.hurt1, samples.hurt2, samples.hurt3, samples.hurt4]).filter(Boolean);
    if (hurts.length) {
      const s = ctx.createBufferSource();
      s.buffer = hurts[(Math.random() * hurts.length) | 0];
      s.playbackRate.value = 0.95 + Math.random() * 0.10;
      const g = ctx.createGain(); g.gain.value = 0.72;
      s.connect(g); g.connect(sfxBus);
      s.start(t);
      return;
    }
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(500, t + 0.3); f.Q.value = 4;
    const g = ctx.createGain(); env(g, t, 0.01, 0.35, 0.3, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 0.4);
  };

  // ---------- SIREN HEAD sounds ----------
  // A persistent positional voice for the monster
  A.createMonsterVoice = function () {
    if (!ctx) return null;
    const p = panner({ x: 0, y: 14, z: 0 }, 14, 0.9);
    const out = ctx.createGain(); out.gain.value = 1;
    out.connect(p); p.connect(worldBus);
    return { panner: p, out };
  };

  // siren wail: kind = 'call' | 'blare' | 'short' | 'die'
  A.siren = function (voice, kind, loud) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const dest = voice ? voice.out : sfxBus;
    const dur = kind === 'blare' ? 3.2 : kind === 'short' ? 1.2 : kind === 'die' ? 6 : 4.5;
    const vol = (loud || 1) * (kind === 'blare' ? 0.55 : 0.42);
    const g = ctx.createGain();
    const dist = distortion(3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    g.connect(dist); dist.connect(f); f.connect(hp);
    const outG = ctx.createGain();
    hp.connect(outG); outG.connect(dest);
    env(outG, t, kind === 'blare' ? 0.05 : 0.6, vol, dur * 0.8, vol * 0.7, 0.6, t + dur - 0.6);
    // two horns slightly detuned — the classic "two sirens" sound
    [1, 1.04].forEach((mul, i) => {
      const o = ctx.createOscillator(); o.type = i ? 'square' : 'sawtooth';
      const fq = o.frequency;
      const base = 260 * mul;
      fq.setValueAtTime(base, t);
      if (kind === 'blare') {
        for (let k = 0; k < 6; k++) {
          fq.linearRampToValueAtTime(base * 2.6, t + k * 0.55 + 0.25);
          fq.linearRampToValueAtTime(base * 1.6, t + k * 0.55 + 0.55);
        }
      } else if (kind === 'die') {
        fq.linearRampToValueAtTime(base * 2.4, t + 1.5);
        fq.exponentialRampToValueAtTime(base * 0.35, t + dur);
      } else {
        fq.linearRampToValueAtTime(base * 2.4, t + dur * 0.45);
        fq.linearRampToValueAtTime(base * 1.2, t + dur);
      }
      const og = ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.1);
    });
    // a little feedback-y radio squeal on top
    const sq = ctx.createOscillator(); sq.type = 'sine';
    sq.frequency.setValueAtTime(2600, t); sq.frequency.linearRampToValueAtTime(3100, t + dur);
    const sg = ctx.createGain(); env(sg, t, 0.3, 0.03 * (loud || 1), dur, 0.0001);
    sq.connect(sg); sg.connect(dest); sq.start(t); sq.stop(t + dur);
  };

  // radio static burst (siren head "tuning" between voices)
  A.staticBurst = function (voice, dur, vol) {
    if (!ctx) return;
    const t = ctx.currentTime; dur = dur || 1.2;
    const n = noiseSrc(false, true);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // crackly envelope
    for (let k = 0; k < dur * 14; k++) {
      g.gain.setValueAtTime((vol || 0.25) * (0.3 + Math.random() * 0.7), t + k / 14);
    }
    g.gain.setValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(voice ? voice.out : sfxBus);
    n.start(t); n.stop(t + dur + 0.05);
  };

  // garbled "radio voice" made of filtered noise — layered under TTS
  A.radioGarble = function (voice, dur, vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95;
    const n = noiseSrc(false, true);
    const ng = ctx.createGain(); ng.gain.value = 0.3;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 2; f2.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let tt = t;
    while (tt < t + dur) {
      const syl = 0.08 + Math.random() * 0.16;
      f1.frequency.setValueAtTime(300 + Math.random() * 900, tt);
      o.frequency.setValueAtTime(70 + Math.random() * 50, tt);
      g.gain.linearRampToValueAtTime((vol || 0.4) * (Math.random() < 0.15 ? 0.02 : 1), tt + 0.02);
      g.gain.linearRampToValueAtTime(0.02, tt + syl);
      tt += syl + 0.02;
    }
    g.gain.linearRampToValueAtTime(0.0001, tt + 0.05);
    o.connect(f1); n.connect(ng); ng.connect(f1); f1.connect(f2); f2.connect(g);
    g.connect(voice ? voice.out : voiceBus);
    o.start(t); n.start(t); o.stop(tt + 0.1); n.stop(tt + 0.1);
  };

  // massive footstep, positional
  A.giantStep = function (pos, vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 20, 0.7);
    p.connect(worldBus);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.6);
    const g = ctx.createGain(); env(g, t, 0.005, 1.2 * (vol || 1), 0.7, 0.0001);
    o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.8);
    const n = noiseSrc(true, false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g2 = ctx.createGain(); env(g2, t, 0.01, 1.0 * (vol || 1), 0.5, 0.0001);
    n.connect(f); f.connect(g2); g2.connect(p); n.start(t); n.stop(t + 0.7);
  };

  // creak/groan of the creature's body
  A.creak = function (voice) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(60 + Math.random() * 30, t);
    o.frequency.linearRampToValueAtTime(40 + Math.random() * 40, t + 1.4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 9;
    const g = ctx.createGain(); env(g, t, 0.2, 0.25, 1.2, 0.0001);
    o.connect(f); f.connect(g); g.connect(voice ? voice.out : sfxBus); o.start(t); o.stop(t + 1.6);
  };

  // death scream — huge, unspatialized
  A.deathScream = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    A.siren(null, 'blare', 2.2);
    A.staticBurst(null, 2.5, 0.8);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(90, t + 2.5);
    const d = distortion(6);
    const g = ctx.createGain(); env(g, t, 0.01, 0.6, 2.4, 0.0001);
    o.connect(d); d.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 2.6);
  };

  // ---------- vehicles (cutscenes) ----------
  A.engine = function () {
    if (!ctx) return null;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 76.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    const road = noiseSrc(true, true);
    const rg = ctx.createGain(); rg.gain.value = 0.25;
    o.connect(f); o2.connect(g2); g2.connect(f); road.connect(rg); rg.connect(f); f.connect(g); g.connect(sfxBus);
    o.start(); o2.start(); road.start();
    return {
      set(vol, rpm) {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(vol, t, 0.3);
        o.frequency.setTargetAtTime(30 + rpm * 30, t, 0.3);
        o2.frequency.setTargetAtTime(60 + rpm * 61, t, 0.3);
      },
      stop() { const t = ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.3); o.stop(t + 2); o2.stop(t + 2); road.stop(t + 2); },
    };
  };

  A.policeSirens = function (pos) {
    if (!ctx) return null;
    const p = panner(pos, 25, 0.6);
    const g = ctx.createGain(); g.gain.value = 0;
    p.connect(g); g.connect(sfxBus);
    const oscs = [];
    [0, 0.37].forEach((ph, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 900;
      const lfo = ctx.createOscillator(); lfo.type = i ? 'square' : 'sine'; lfo.frequency.value = i ? 1.6 : 0.35;
      const lg = ctx.createGain(); lg.gain.value = i ? 180 : 420;
      lfo.connect(lg); lg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = 0.18;
      o.connect(og); og.connect(p); o.start(); lfo.start();
      oscs.push(o, lfo);
    });
    return {
      panner: p,
      set(vol) { g.gain.setTargetAtTime(vol, ctx.currentTime, 0.5); },
      move(pp) { setPannerPos(p, pp); },
      stop() { const t = ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.5); oscs.forEach(o => o.stop(t + 3)); },
    };
  };

  A.helicopter = function (pos) {
    if (!ctx) return null;
    const p = panner(pos, 25, 0.7);
    const n = noiseSrc(true, true);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(chop.gain);
    n.connect(f); f.connect(chop); chop.connect(g); g.connect(p); p.connect(sfxBus);
    n.start(); lfo.start();
    return {
      set(vol) { g.gain.setTargetAtTime(vol, ctx.currentTime, 0.5); },
      move(pp) { setPannerPos(p, pp); },
      stop() { const t = ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.5); n.stop(t + 3); lfo.stop(t + 3); },
    };
  };

  A.boom = function (vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = noiseSrc(true, false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(60, t + 2);
    const g = ctx.createGain(); env(g, t, 0.01, vol || 1, 2.5, 0.0001);
    n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 3);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(20, t + 1.5);
    const g2 = ctx.createGain(); env(g2, t, 0.01, (vol || 1) * 0.9, 1.6, 0.0001);
    o.connect(g2); g2.connect(sfxBus); o.start(t); o.stop(t + 2);
  };

  A.chains = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let k = 0; k < 14; k++) {
      const tt = t + k * 0.07 + Math.random() * 0.04;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1800 + Math.random() * 2400;
      const g = ctx.createGain(); env(g, tt, 0.001, 0.07, 0.08, 0.0001);
      o.connect(g); g.connect(sfxBus); o.start(tt); o.stop(tt + 0.1);
    }
  };

  // ============================================================
  //  MUSIC — a tiny step sequencer with several tracks
  // ============================================================
  let current = null; // {name, gain, step, nextTime, nodes:[]}
  const STEP_AHEAD = 0.12;
  A.intensity = 0; // 0..1, gameplay danger level (drives explore layer)

  function inst(name) {
    // instruments return nothing; they schedule into dest
    return name;
  }
  function piano(dest, m, t, dur, vel) {
    const f = mtof(m);
    const g = ctx.createGain(); env(g, t, 0.005, vel, dur, 0.0001);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    [[f, 'triangle', 1], [f * 2.003, 'sine', 0.35], [f * 0.5, 'sine', 0.3]].forEach(([fr, ty, a]) => {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    });
    lp.connect(g); g.connect(dest);
  }
  function pad(dest, notes, t, dur, vol, bright) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright || 700;
    notes.forEach(m => {
      [-6, 6].forEach(det => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
      });
    });
    lp.connect(g); g.connect(dest);
  }
  function drum(dest, t, f0, f1, vol, dur) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, 0.003, vol, dur, 0.0001);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function hat(dest, t, vol) {
    const n = noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); env(g, t, 0.001, vol, 0.04, 0.0001);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.06);
  }
  function bass(dest, m, t, dur, vol) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(150, t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, vol, dur, 0.0001);
    o.connect(lp); lp.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function stringSlide(dest, m0, m1, t, dur, vol) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    [-8, 8].forEach(det => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(mtof(m0), t); o.frequency.exponentialRampToValueAtTime(mtof(m1), t + dur);
      o.detune.value = det;
      const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
      const vg = ctx.createGain(); vg.gain.value = 9;
      vib.connect(vg); vg.connect(o.detune);
      o.connect(lp); o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    });
    lp.connect(g); g.connect(dest);
  }
  function droneStart(dest, notes, vol, cutoff) {
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(vol, ctx.currentTime, 2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff || 300;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = (cutoff || 300) * 0.5;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    const nodes = [lfo];
    notes.forEach(m => {
      [-4, 4].forEach(det => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(); nodes.push(o);
      });
    });
    lp.connect(g); g.connect(dest);
    return { g, nodes, lp };
  }

  const TRACKS = {
    title: {
      stepDur: 60 / 66 / 2, // eighth notes at 66 bpm
      start(tr) {
        tr.drone = droneStart(tr.gain, [33, 40], 0.08, 260);
      },
      step(tr, s, t) {
        const chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]; // Am F Dm E
        const bar = Math.floor(s / 8) % 4, k = s % 8;
        const ch = chords[bar];
        const arp = [0, 1, 2, 1, 0, 2, 1, 2];
        if (k === 0) pad(tr.gain, ch.map(m => m - 12), t, tr.def.stepDur * 8, 0.05, 600);
        if (k === 0) piano(tr.gain, ch[0] - 24, t, 3.5, 0.18);
        piano(tr.gain, ch[arp[k]] + (k > 4 ? 12 : 0), t, 1.8, 0.09 + (k === 0 ? 0.04 : 0));
        if (s % 64 === 40) A.siren(null, 'call', 0.25);
      },
    },
    explore: {
      stepDur: 60 / 50 / 2,
      start(tr) {
        tr.drone = droneStart(tr.gain, [26, 33], 0.07, 200);
        tr.drone2 = droneStart(tr.gain, [38, 39], 0, 500);
      },
      step(tr, s, t) {
        const I = A.intensity;
        if (tr.drone2) tr.drone2.g.gain.setTargetAtTime(I * 0.05, t, 1);
        const scale = [50, 51, 53, 55, 57, 58, 62]; // D phrygian-ish
        if (Math.random() < 0.18) piano(tr.gain, scale[(Math.random() * scale.length) | 0] - (Math.random() < 0.5 ? 12 : 0), t, 3, 0.07);
        if (s % 16 === 0 && Math.random() < 0.5) pad(tr.gain, [38, 41, 44], t, tr.def.stepDur * 16, 0.035, 400);
        if (I > 0.3 && s % 2 === 0) drum(tr.gain, t, 60, 35, 0.25 * I, 0.3);
        if (I > 0.55 && s % 4 === 2) stringSlide(tr.gain, 74, 75, t, tr.def.stepDur * 4, 0.025 * I);
      },
    },
    chase: {
      stepDur: 60 / 150 / 4,
      start(tr) {
        tr.drone = droneStart(tr.gain, [26, 27], 0.06, 600);
      },
      step(tr, s, t) {
        const k = s % 16, bar = Math.floor(s / 16) % 4;
        const root = [38, 38, 39, 36][bar];
        bass(tr.gain, root - 12 + ((k % 4 === 3) ? 1 : 0), t, 0.11, 0.22);
        if (k % 4 === 0) drum(tr.gain, t, 120, 40, 0.6, 0.25);
        if (k === 6 || k === 14) drum(tr.gain, t, 200, 90, 0.35, 0.18);
        if (k % 2 === 1) hat(tr.gain, t, 0.05);
        if (k === 0) stringSlide(tr.gain, root + 36, root + 37, t, tr.def.stepDur * 16, 0.05);
        if (k === 0 && bar === 3) stringSlide(tr.gain, 86, 74, t, tr.def.stepDur * 16, 0.05);
      },
    },
    ending: {
      stepDur: 60 / 72 / 2,
      start(tr) { tr.drone = droneStart(tr.gain, [36, 43], 0.04, 400); },
      step(tr, s, t) {
        const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]; // C G Am F
        const bar = Math.floor(s / 8) % 4, k = s % 8;
        const ch = chords[bar];
        if (k === 0) pad(tr.gain, ch.map(m => m - 12), t, tr.def.stepDur * 8, 0.05, 1200);
        if (k === 0) piano(tr.gain, ch[0] - 24, t, 3.5, 0.2);
        const arp = [0, 1, 2, 1, 2, 1, 0, 1];
        piano(tr.gain, ch[arp[k]] + 12, t, 1.8, 0.08);
      },
    },
    tension: { // used in the opening drive
      stepDur: 60 / 60 / 2,
      start(tr) { tr.drone = droneStart(tr.gain, [28, 35], 0.07, 240); },
      step(tr, s, t) {
        if (s % 8 === 0) piano(tr.gain, [40, 41, 40, 43][(s / 8 | 0) % 4], t, 4, 0.14);
        if (s % 8 === 4 && Math.random() < 0.6) piano(tr.gain, 64 + [0, 1, 3][(Math.random() * 3) | 0], t, 3, 0.05);
        if (s % 32 === 0) pad(tr.gain, [40, 43, 46], t, tr.def.stepDur * 32, 0.04, 380);
      },
    },
  };

  A.playMusic = function (name, fade) {
    if (!ctx) return;
    if (current && current.name === name) return;
    const t = ctx.currentTime;
    fade = fade === undefined ? 1.5 : fade;
    if (current) {
      const old = current;
      old.gain.gain.setTargetAtTime(0, t, fade / 3);
      old.dead = true;
      setTimeout(() => {
        [old.drone, old.drone2].forEach(d => d && d.nodes.forEach(n => { try { n.stop(); } catch (e) {} }));
        old.gain.disconnect();
      }, fade * 1000 + 1500);
    }
    current = null;
    if (!name || !TRACKS[name]) return;
    const def = TRACKS[name];
    const gain = ctx.createGain(); gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, t, Math.max(0.05, fade / 3));
    gain.connect(musicBus);
    current = { name, def, gain, step: 0, nextTime: t + 0.1 };
    def.start(current);
  };

  function startScheduler() {
    setInterval(() => {
      if (!ctx) return;
      heartTick();
      chimeTick();
      birdTick();
      if (!current) return;
      const tr = current;
      while (tr.nextTime < ctx.currentTime + STEP_AHEAD) {
        try { tr.def.step(tr, tr.step, tr.nextTime); } catch (e) { console.warn(e); }
        tr.step++;
        tr.nextTime += tr.def.stepDur;
      }
    }, 30);
  }

  // ============================================================
  //  VOICES — speech synthesis + subtitles
  // ============================================================
  const synth = window.speechSynthesis || null;
  let voices = [];
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter(v => /^en/i.test(v.lang));
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

  function pickVoice(role) {
    if (!voices.length) return null;
    const find = re => voices.find(v => re.test(v.name));
    if (role === 'player') return find(/Daniel|Guy|Male|David|Alex|Fred|Google UK English Male/i) || voices[0];
    if (role === 'radio') {
      // prefer deep, natural-sounding male voices when falling back to speech synthesis
      const score = v => {
        const n = v.name;
        let s = 0;
        if (/natural|neural|online|enhanced|premium|siri/i.test(n)) s += 10;
        if (/Daniel|Guy|Andrew|Brian|Christopher|Eric|Ryan|Steffan|David|Alex|Male/i.test(n)) s += 8;
        if (/Zira|Hazel|Samantha|Ava|Allison|Jenny|Michelle|Sara|Emma|Joanna/i.test(n)) s -= 4;
        if (/en[-_]US/i.test(v.lang)) s += 2;
        if (/Albert|Bad News|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|eSpeak/i.test(n)) s -= 20;
        return s;
      };
      return voices.slice().sort((a, b) => score(b) - score(a))[0] || voices[0];
    }
    if (role === 'siren') return find(/Fred|Bad News|Whisper|Zarvox|Daniel|Male/i) || voices[0];
    return voices[0];
  }

  const subsEl = () => document.getElementById('subtitles');
  const SUB_ROLES = {
    player: { name: 'You',      cls: 'player' },
    radio:  { name: 'Dispatch', cls: 'radio' },
    siren:  { name: '???',      cls: 'siren' },
  };
  let lastSubMode = '';
  A.setSubMode = function (modeStr) {
    const el = subsEl();
    if (!el) return;
    const dyn = !LO.ver || LO.ver().dynamicSubs;
    const next = dyn ? (modeStr || '') : '';
    if (next === lastSubMode) return;
    lastSubMode = next;
    el.className = next;
  };
  const cueLast = {};
  A.subCue = function (role, text, opts) {
    if (!S.subtitles) return;
    if (LO.ver && !LO.ver().dynamicSubs) return;
    if (role !== 'siren' && role !== 'player' && role !== 'radio') return;
    opts = opts || {};
    const now = performance.now();
    const cd = opts.cooldownMs === undefined ? 1400 : opts.cooldownMs;
    if (cueLast[role] && now - cueLast[role] < cd) return;
    cueLast[role] = now;
    const meta = SUB_ROLES[role] || { name: role, cls: role };
    const who = opts.who !== undefined ? opts.who : meta.name;
    showSub(who, text, meta.cls, opts.ms || 2400, opts);
  };
  function showSub(who, text, cls, ms, opts) {
    if (!S.subtitles) return;
    opts = opts || {};
    const dyn = !LO.ver || LO.ver().dynamicSubs;
    const el = subsEl();
    if (!el) return;
    const line = document.createElement('div');
    const wrap = document.createElement('div');
    wrap.className = 'sub-wrap';
    line.className = 'line ' + (cls || '') + (dyn && opts.urgent ? ' urgent' : '');
    let dirTag = '';
    if (dyn && opts.pos) {
      const dx = opts.pos.x - subCamPos.x;
      const dz = opts.pos.z - subCamPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) {
        const pan = Math.max(-1, Math.min(1, (dx * subCamRight.x + dz * subCamRight.z) / d));
        const px = Math.round(pan * 95);
        wrap.style.setProperty('--sub-pan', px + 'px');
        if (pan < -0.34) dirTag = '◄ ';
        else if (pan > 0.34) dirTag = ' ►';
      }
    }
    if (who) {
      const w = document.createElement('span');
      w.className = 'who ' + (cls || '');
      w.textContent = (dirTag === '◄ ' ? '◄ ' : '') + who + (dirTag === ' ►' ? ' ►' : '') + ':';
      line.appendChild(w);
    }
    line.appendChild(document.createTextNode(text));
    wrap.appendChild(line);
    el.appendChild(wrap);
    const maxLines = dyn ? 3 : 2;
    while (el.children.length > maxLines) el.removeChild(el.firstChild);
    setTimeout(() => {
      if (!wrap.parentNode) return;
      if (dyn) {
        wrap.classList.add('out');
        setTimeout(() => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 220);
      } else {
        wrap.parentNode.removeChild(wrap);
      }
    }, Math.max(500, ms || 2400));
  }
  A.clearSubs = function () { const el = subsEl(); if (el) el.innerHTML = ''; };

  let speaking = false;
  let voiceGen = 0;
  const queue = [];
  // say(role, text, opts) — role: player | radio | siren
  // returns a promise that resolves when the line is done
  A.say = function (role, text, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const item = { role, text, opts, resolve };
      if (role === 'siren') return speakNow(item, true);
      queue.push(item);
      pump();
    });
  };
  function pump() {
    if (speaking || !queue.length) return;
    speakNow(queue.shift(), false);
  }
  function speakNow(item, overlay) {
    const { role, text, opts, resolve } = item;
    const gen = voiceGen;
    const dyn = !LO.ver || LO.ver().dynamicSubs;
    const meta = SUB_ROLES[role] || { name: '???', cls: role || '' };
    const legacyNames = { player: 'You', radio: 'Dispatch', siren: '???' };
    const est = Math.max(1600, text.length * 75) / (opts.rate || 1);
    const who = opts.who !== undefined ? opts.who : (dyn ? meta.name : legacyNames[role]);
    const cls = dyn ? meta.cls : (role === 'siren' ? 'siren' : role === 'radio' ? 'radio' : '');
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      if (!overlay) { speaking = false; setTimeout(pump, 250); }
      resolve();
    };
    const cancel = () => {
      if (done) return; done = true;
      resolve();
    };
    if (!overlay) speaking = true;

    const playItem = () => {
      if (gen !== voiceGen) { cancel(); return; }
      if (role === 'radio') { A.radioIn(); }
      if (A.still) { setTimeout(finish, 50); return; } // the world is silent
      // recorded voice lines (player & dispatch), when there is a take for this line
      const rec = (role === 'player' || role === 'radio') && voiceSamples[text];
      if (rec && S.tts && S.voice > 0 && ctx) {
        showSub(who, text, cls, rec.duration * 1000 + 900, opts);
        const src = ctx.createBufferSource(); src.buffer = rec;
        if (role === 'radio') {
          const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
          const warm = ctx.createBiquadFilter(); warm.type = 'peaking'; warm.frequency.value = 150; warm.Q.value = 0.9; warm.gain.value = 3.5;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4600;
          const g = ctx.createGain(); g.gain.value = 1.25;
          src.connect(hp); hp.connect(warm); warm.connect(lp); lp.connect(g); g.connect(voiceBus);
        } else {
          src.connect(voiceBus);
        }
        let finished = false;
        const doneRec = (quiet) => {
          if (finished) return; finished = true;
          if (currentRec === src) currentRec = null;
          if (role === 'radio' && !quiet) A.radioOut();
          finish();
        };
        src.onended = () => doneRec(!!src._stopped);
        src.start();
        currentRec = src;
        setTimeout(() => doneRec(false), rec.duration * 1000 + 1500);  // safety net
        return;
      }
      const canSpeak = synth && S.tts && S.voice > 0 && (!overlay || !synth.speaking);
      showSub(who, text, cls, est + 1200, opts);
      if (canSpeak) {
        try {
          const u = new SpeechSynthesisUtterance(text);
          const v = pickVoice(role); if (v) u.voice = v;
          if (role === 'player') { u.pitch = 0.9; u.rate = 0.98; }
          if (role === 'radio') { u.pitch = 0.78; u.rate = 0.96; }
          if (role === 'siren') { u.pitch = 0.05; u.rate = 0.55; }
          if (opts.rate) u.rate *= opts.rate;
          u.volume = Math.max(0, Math.min(1, S.voice * S.master * (opts.volume === undefined ? 1 : opts.volume)));
          if (role === 'radio') {
            const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
            let i = 0;
            const next = () => {
              if (i >= parts.length) { A.radioOut(); finish(); return; }
              const pu = new SpeechSynthesisUtterance(parts[i++]);
              pu.voice = u.voice; pu.pitch = u.pitch * (0.97 + Math.random() * 0.06); pu.rate = u.rate * (0.95 + Math.random() * 0.08); pu.volume = u.volume;
              pu.onend = () => setTimeout(next, 140 + Math.random() * 160); pu.onerror = () => { A.radioOut(); finish(); };
              synth.speak(pu);
            };
            next();
          } else {
            u.onend = finish; u.onerror = finish;
            synth.speak(u);
          }
          // safety net in case onend never fires
          setTimeout(finish, est * 2.2 + 2500);
        } catch (e) { setTimeout(finish, est); }
      } else {
        setTimeout(finish, est);
      }
    };

    if (A.still) { setTimeout(finish, 50); return; } // the world is silent
    if ((role === 'player' || role === 'radio') && !voiceSamples[text] && voicePending[text] && S.tts && S.voice > 0 && ctx) {
      Promise.race([
        voicePending[text],
        new Promise(r => setTimeout(r, 1500))
      ]).then(playItem);
      return;
    }
    playItem();
  }
  let currentRec = null;
  A.recordedLines = () => Object.keys(voiceSamples).length;
  A.isPlayingRecording = () => !!currentRec;
  A.stopVoices = function () {
    voiceGen++;
    queue.length = 0;
    if (currentRec) { try { currentRec._stopped = true; currentRec.stop(); } catch (e) {} currentRec = null; }
    if (synth) try { synth.cancel(); } catch (e) {}
    speaking = false;
    A.clearSubs();
  };
  A.isSpeaking = () => speaking;

  // ---------- Environmental hazard SFX (v2.7.6) ----------
  function hazardBus(pos, ref) {
    if (pos && ctx.createPanner) {
      const p = panner(pos, ref || 7, 1.15);
      p.connect(worldBus);
      return p;
    }
    return worldBus || sfxBus;
  }

  A.hazardZap = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 8);
    // 60Hz transformer hum + high-voltage crackle bursts
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.setValueAtTime(120, t);
    const hg = ctx.createGain(); env(hg, t, 0.005, 0.24, 0.34, 0.0001);
    hum.connect(hg); hg.connect(dest); hum.start(t); hum.stop(t + 0.38);
    for (let i = 0; i < 4; i++) {
      const st = t + i * 0.045;
      const n = noiseSrc(false, false);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400 + i * 650; bp.Q.value = 2.0;
      const g = ctx.createGain(); env(g, st, 0.002, 0.32, 0.06, 0.0001);
      n.connect(bp); bp.connect(g); g.connect(dest); n.start(st); n.stop(st + 0.09);
    }
  };

  A.hazardTrapSnap = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 7);
    const slam = noiseSrc(false, false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1450; bp.Q.value = 1.6;
    const sg = ctx.createGain(); env(sg, t, 0.002, 0.42, 0.11, 0.0001);
    slam.connect(bp); bp.connect(sg); sg.connect(dest); slam.start(t); slam.stop(t + 0.14);
    [540, 1180].forEach((freq, idx) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.42, t + 0.24);
      const g = ctx.createGain(); env(g, t, 0.002, idx ? 0.18 : 0.28, 0.22, 0.0001);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.28);
    });
  };

  A.hazardSteamBurn = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 7);
    const n = noiseSrc(false, false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t); bp.frequency.linearRampToValueAtTime(3600, t + 0.25); bp.Q.value = 0.9;
    const g = ctx.createGain(); env(g, t, 0.015, 0.36, 0.42, 0.0001);
    n.connect(bp); bp.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.48);
  };

  A.hazardGlass = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 6);
    for (let i = 0; i < 4; i++) {
      const st = t + i * 0.028;
      const n = noiseSrc(false, false);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200 + i * 700;
      const g = ctx.createGain(); env(g, st, 0.002, 0.16, 0.055, 0.0001);
      n.connect(hp); hp.connect(g); g.connect(dest); n.start(st); n.stop(st + 0.08);
    }
  };

  A.hazardCreak = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 6);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(84, t); o.frequency.linearRampToValueAtTime(52, t + 0.36);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 3.2;
    const g = ctx.createGain(); env(g, t, 0.025, 0.22, 0.34, 0.0001);
    o.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.4);
  };

  A.hazardTinClatter = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime, dest = hazardBus(pos, 9);
    const freqs = [310, 485, 690, 940];
    for (let i = 0; i < 3; i++) {
      const st = t + i * 0.11;
      const f = freqs[(Math.random() * freqs.length) | 0];
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(f, st); o.frequency.exponentialRampToValueAtTime(f * 0.65, st + 0.28);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.4; bp.Q.value = 2.5;
      const g = ctx.createGain(); env(g, st, 0.003, 0.22 / (i + 1), 0.28, 0.0001);
      o.connect(bp); bp.connect(g); g.connect(dest); o.start(st); o.stop(st + 0.32);
    }
  };
})();
