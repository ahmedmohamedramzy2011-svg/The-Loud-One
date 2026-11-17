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
  function decodeB64(b64, cb) {
    try {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(buf.buffer, cb, () => {});
    } catch (e) { /* missing sound is not fatal */ }
  }
  function loadSamples() {
    const V = LO.VOICE_DATA;
    if (V) Object.keys(V).forEach(text => decodeB64(V[text], b => { voiceSamples[text] = b; }));
    const D = LO.SOUND_DATA;
    if (!D) return;
    Object.keys(D).forEach(key => {
      try {
        const bin = atob(D[key]);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        ctx.decodeAudioData(buf.buffer, b => { samples[key] = b; }, () => {});
      } catch (e) { /* missing sound is not fatal */ }
    });
  }
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
  // (panting, flashlight, heartbeat, wind, entities, Siren Head). Death sounds and music are unaffected.
  A.worldMuted = false;
  A.silenceWorld = function (on) {
    if (!ctx) return;
    A.worldMuted = on;
    const t = ctx.currentTime;
    if (on) {
      heartAmt = 0;
      [breath && breath.g, buzz && buzz.g, wind && wind.g, wind && wind.wg, tenant && tenant.g, tenant && tenant.og,
       silent && silent.og, silent && silent.sg, moth && moth.g, expo && expo.g1, expo && expo.g2, worldBus]
        .forEach(g => { if (g && g.gain) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); } });
    } else if (worldBus && !A.still) {
      worldBus.gain.cancelScheduledValues(t); worldBus.gain.setTargetAtTime(1, t, 0.3);
    }
  };

  A.setStillness = function (on) {
    if (A.still === on) return;
    A.still = on;
    if (on) { A.stopVoices(); }
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
  A.setListener = function (pos, fwd, up) {
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
  A.footstep = function (kind, indoor) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const vol = kind === 'run' ? 0.5 : kind === 'crouch' ? 0.08 : 0.22;
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

  // breathing — called with intensity 0..1 each frame
  let breath = null;
  A.setBreathing = function (amount) {
    if (A.worldMuted) return;
    if (!ctx) return;
    if (!breath) {
      const n = noiseSrc(false, true);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 1.6;
      const lg = ctx.createGain(); lg.gain.value = 0;
      const amp = ctx.createGain(); amp.gain.value = 0;
      lfo.connect(lg); lg.connect(amp.gain);
      n.connect(f); f.connect(amp); amp.connect(g); g.connect(sfxBus);
      n.start(); lfo.start();
      breath = { g, lg, amp, lfo };
    }
    const t = ctx.currentTime;
    breath.g.gain.setTargetAtTime(amount * 0.35, t, 0.3);
    breath.lg.gain.setTargetAtTime(0.5, t, 0.3);
    breath.amp.gain.setTargetAtTime(0.5, t, 0.3);
    breath.lfo.frequency.setTargetAtTime(0.7 + amount * 1.2, t, 0.5);
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
    const p = panner(pos, 26, 0.55); p.connect(worldBus);
    // heavy metallic fence crunch + splintering crackle
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.45);
    const g = ctx.createGain(); env(g, t, 0.002, 1.2, 0.5, 0.0001);
    o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.55);
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.045;
      const n = noiseSrc(false, false);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 950 + i * 500; f.Q.value = 1.4;
      const gn = ctx.createGain(); env(gn, tt, 0.002, 0.85 - i * 0.15, 0.18, 0.0001);
      n.connect(f); f.connect(gn); gn.connect(p); n.start(tt); n.stop(tt + 0.25);
    }
  };
  A.fastHowl = function (pos) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = panner(pos, 24, 0.55); p.connect(worldBus);
    const dist = distortion(4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 780; f.Q.value = 1.5;
    dist.connect(f); f.connect(p);
    [1, 1.07].forEach((mul, i) => {
      const o = ctx.createOscillator(); o.type = i ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(220 * mul, t);
      o.frequency.linearRampToValueAtTime(580 * mul, t + 0.22);
      o.frequency.exponentialRampToValueAtTime(170 * mul, t + 1.15);
      const g = ctx.createGain(); env(g, t, 0.03, 0.45, 1.1, 0.0001);
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
  A.hurt = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
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
      // the most natural-sounding voice available: neural/online/enhanced voices first
      const score = v => {
        const n = v.name;
        let s = 0;
        if (/natural|neural|online|enhanced|premium|siri/i.test(n)) s += 10;
        if (/Ava|Allison|Samantha|Aria|Jenny|Michelle|Sara|Emma|Joanna|Google US English/i.test(n)) s += 5;
        if (/en[-_]US/i.test(v.lang)) s += 2;
        if (/Zira|Hazel|Fred|Albert|Bad News|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|eSpeak/i.test(n)) s -= 20;
        return s;
      };
      return voices.slice().sort((a, b) => score(b) - score(a))[0] || voices[0];
    }
    if (role === 'siren') return find(/Fred|Bad News|Whisper|Zarvox|Daniel|Male/i) || voices[0];
    return voices[0];
  }

  const subsEl = () => document.getElementById('subtitles');
  function showSub(who, text, cls, ms) {
    if (!S.subtitles) return;
    const el = subsEl();
    const line = document.createElement('div');
    const wrap = document.createElement('div');
    line.className = 'line ' + (cls || '');
    if (who) {
      const w = document.createElement('span');
      w.className = 'who ' + (cls || ''); w.textContent = who + ':';
      line.appendChild(w);
    }
    line.appendChild(document.createTextNode(text));
    wrap.appendChild(line);
    el.appendChild(wrap);
    while (el.children.length > 2) el.removeChild(el.firstChild);
    setTimeout(() => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, ms);
  }
  A.clearSubs = function () { const el = subsEl(); if (el) el.innerHTML = ''; };

  let speaking = false;
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
    const names = { player: 'You', radio: 'Dispatch', siren: '???' };
    const est = Math.max(1600, text.length * 75) / (opts.rate || 1);
    const who = opts.who !== undefined ? opts.who : names[role];
    const cls = role === 'siren' ? 'siren' : role === 'radio' ? 'radio' : '';
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      if (!overlay) { speaking = false; setTimeout(pump, 250); }
      resolve();
    };
    if (!overlay) speaking = true;

    if (role === 'radio') { A.radioIn(); }
    if (A.still) { setTimeout(finish, 50); return; } // the world is silent
    // the player's own recorded voice, when there is a take for this line
    const rec = role === 'player' && voiceSamples[text];
    if (rec && S.tts && S.voice > 0 && ctx) {
      showSub(who, text, cls, rec.duration * 1000 + 900);
      const src = ctx.createBufferSource(); src.buffer = rec;
      src.connect(voiceBus);
      src.onended = () => { if (currentRec === src) currentRec = null; finish(); };
      src.start();
      currentRec = src;
      setTimeout(finish, rec.duration * 1000 + 1500);  // safety net
      return;
    }
    const canSpeak = synth && S.tts && S.voice > 0 && (!overlay || !synth.speaking);
    showSub(who, text, cls, est + 1200);
    if (canSpeak) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice(role); if (v) u.voice = v;
        if (role === 'player') { u.pitch = 0.9; u.rate = 0.98; }
        if (role === 'radio') { u.pitch = 1.0; u.rate = 0.97; }
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
  }
  let currentRec = null;
  A.recordedLines = () => Object.keys(voiceSamples).length;
  A.isPlayingRecording = () => !!currentRec;
  A.stopVoices = function () {
    queue.length = 0;
    if (currentRec) { try { currentRec.stop(); } catch (e) {} currentRec = null; }
    if (synth) try { synth.cancel(); } catch (e) {}
    speaking = false;
    A.clearSubs();
  };
  A.isSpeaking = () => speaking;
})();
