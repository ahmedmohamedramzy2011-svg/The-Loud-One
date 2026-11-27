// ============================================================
//  THE LOUD ONE — game flow, menus, HUD and main loop
// ============================================================
(function () {
  const S = LO.settings;
  const A = LO.audio;
  const Net = LO.Net;
  const $ = id => document.getElementById(id);
  const EVIDENCE_NEEDED = 5;

  let sneaky = null, fastone = null, hazards = null;
  let renderer, scene, camera, world, siren, player, moths, deathRoom, deathShown = false, deathTimer = null, titleSpot = null;
  let state = 'gate';          // gate | title | opening | play | paused | dying | dead | spectate | ending | credits
  let cutscene = null, cutCtx = null;
  let menuReturn = 'title';    // which screen an options panel goes back to
  let worldDirty = false;
  let pendingCapture = null;
  let shakeAmt = 0;
  let clock = new THREE.Clock();
  let gameTime = 0;
  let evidenceCount = 0;
  let endingQueued = false;
  let parkedCar = null;
  let skipHeld = 0;

  // Co-op runtime state
  const CALLSIGN_KEY = 'lo_callsign';
  const remotePlayers = new Map(); // id -> LO.RemotePlayer
  const remoteRocks = [];
  const _coopPlayers = [];
  const _rpList = [];
  const _specTarget = new THREE.Vector3();
  let lastWorldSnap = null;
  let coopHudAccum = 0;
  let lastCoopHudHtml = null;
  let lastSpecLabelText = '';
  let netSyncAccum = 0;
  let coopMenuOpen = false;
  let spectateId = null;
  let spectateFirstPerson = false;
  let savedLocalVersion = null;
  let coopTeamWiped = false;
  let chatOpen = false;
  let chatFadeTimer = null;
  let voiceUiAccum = 0;
  const _voiceRemotePos = new THREE.Vector3();
  let currentRunSeed = null;
  let currentEvSeed = null;

  // 60-second AFK auto-kick & Match ID watermark state
  const AFK_WARN_SEC = 50;
  const AFK_KICK_SEC = 60;
  let afkLastActivityAt = Date.now();
  let afkBannerShown = false;
  let afkLastCountdown = -1;
  let afkKicking = false;
  let afkMouseX = null;
  let afkMouseY = null;
  const _afkLastPos = new THREE.Vector3();
  let _afkLastYaw = 0;
  let _afkLastPitch = 0;
  let _afkTrackInit = false;
  let _matchIdCopyTimer = null;

  // Match replay logging & Ghost playback state
  const REPLAY_KEY = 'theLoudOne.replay.v1';
  const REPLAY_SAMPLE_SEC = 0.12;
  const REPLAY_SAVE_SEC = 2.0;
  const REPLAY_MAX_FRAMES = 4500;
  let replayFrames = [];
  let replaySampleAccum = 0;
  let replaySaveAccum = 0;
  let replayCause = '';
  const _replayViewDir = new THREE.Vector3();
  const _replayLookPt = new THREE.Vector3();
  const _replayCamTarget = new THREE.Vector3();
  let replayData = null;
  let replayPlaying = false;
  let replayTime = 0;
  let replaySpeed = 1;
  let replayFirstPerson = false;
  let replayGhost = null;
  let replayPathLine = null;
  let replaySightLine = null;
  let replayDeathBeacon = null;
  let replayEnemyVis = null;

  function setAfkBanner(showBanner, secsLeft) {
    const el = $('afk-warning');
    if (!el) return;
    if (!showBanner) {
      if (afkBannerShown) {
        afkBannerShown = false;
        afkLastCountdown = -1;
        el.classList.remove('show');
        el.textContent = '';
      }
      return;
    }
    const sec = Math.max(1, Math.ceil(secsLeft || 1));
    if (!afkBannerShown || sec !== afkLastCountdown) {
      afkBannerShown = true;
      afkLastCountdown = sec;
      el.textContent = `AFK WARNING: Moving soon or you will be disconnected to save bandwidth (${sec}s)`;
      el.classList.add('show');
    }
  }

  function isAfkPausedState() {
    return state === 'dying' || state === 'dead' || state === 'opening' ||
      state === 'ending' || state === 'credits' || state === 'loading' || state === 'replay';
  }

  function resetAfkActivity() {
    afkLastActivityAt = Date.now();
    if (afkBannerShown) setAfkBanner(false);
  }

  function triggerAfkDisconnect() {
    if (afkKicking) return;
    afkKicking = true;
    resetAfkActivity();
    const kickReason = 'Disconnected due to inactivity (1 min AFK).';
    if (Net && Net.isHost && Net.isHost() && Net.closeRoom) {
      Net.closeRoom(kickReason, kickReason);
    } else {
      if (Net && Net.leave) Net.leave();
      handleCoopForceExit(kickReason);
    }
  }

  function checkAfkTimeout() {
    if (!Net || !Net.isCoop || !Net.isCoop()) {
      resetAfkActivity();
      _afkTrackInit = false;
      afkKicking = false;
      return false;
    }
    if (afkKicking) return true;
    // Pause AFK timer in Death Screen, Replay, and non-interactive cutscenes/loading
    if (isAfkPausedState()) {
      afkLastActivityAt = Date.now();
      setAfkBanner(false);
      return false;
    }
    const idleSec = Math.max(0, (Date.now() - afkLastActivityAt) / 1000);
    if (idleSec >= AFK_KICK_SEC) {
      triggerAfkDisconnect();
      return true;
    }
    if (idleSec >= AFK_WARN_SEC) {
      setAfkBanner(true, AFK_KICK_SEC - idleSec);
    } else {
      setAfkBanner(false);
    }
    return false;
  }

  function onAfkUserInput() {
    if (checkAfkTimeout()) return;
    resetAfkActivity();
  }

  function resetReplayRecording() {
    replayFrames = [];
    replaySampleAccum = 0;
    replaySaveAccum = 0;
    replayCause = '';
  }

  function recordReplayFrame(force) {
    if (!player || !camera) return;
    camera.getWorldDirection(_replayViewDir);
    if (!isFinite(player.pos.x) || !isFinite(player.pos.y) || !isFinite(player.pos.z)) return;
    if (!isFinite(_replayViewDir.x) || !isFinite(_replayViewDir.y) || !isFinite(_replayViewDir.z)) return;
    const t = +gameTime.toFixed(3);
    const frame = {
      t,
      x: +player.pos.x.toFixed(3),
      y: +player.pos.y.toFixed(3),
      z: +player.pos.z.toFixed(3),
      vx: +_replayViewDir.x.toFixed(4),
      vy: +_replayViewDir.y.toFixed(4),
      vz: +_replayViewDir.z.toFixed(4),
      c: +(player.crouch || 0).toFixed(2),
      f: player.flashOn ? 1 : 0,
    };
    const last = replayFrames.length ? replayFrames[replayFrames.length - 1] : null;
    if (last && Math.abs(last.t - t) < 0.02) {
      if (force) replayFrames[replayFrames.length - 1] = frame;
      return;
    }
    if (!force && last) {
      const moved = Math.hypot(frame.x - last.x, frame.y - last.y, frame.z - last.z);
      const turned = Math.abs(frame.vx - last.vx) + Math.abs(frame.vy - last.vy) + Math.abs(frame.vz - last.vz);
      if (moved < 0.01 && turned < 0.005 && frame.c === last.c && frame.f === last.f && (t - last.t) < 0.6) {
        return;
      }
    }
    if (replayFrames.length >= REPLAY_MAX_FRAMES) replayFrames.shift();
    replayFrames.push(frame);
  }

  function saveReplayToStorage(causeOverride) {
    if (causeOverride) replayCause = causeOverride;
    if (!replayFrames || replayFrames.length < 2) return;
    const duration = replayFrames[replayFrames.length - 1].t || gameTime;
    const payload = {
      version: 1,
      seed: currentRunSeed,
      evSeed: currentEvSeed,
      gameVersion: S.gameVersion || '2.8.3',
      cause: replayCause || dieCause || 'siren',
      callsign: (Net && Net.localName) || loadSavedCallsign() || 'Investigator',
      duration: +Number(duration || 0).toFixed(2),
      savedAt: Date.now(),
      frames: replayFrames,
    };
    try {
      localStorage.setItem(REPLAY_KEY, JSON.stringify(payload));
    } catch (e) {
      try {
        payload.frames = replayFrames.slice(-1800);
        localStorage.setItem(REPLAY_KEY, JSON.stringify(payload));
      } catch (e2) { /* storage unavailable or full */ }
    }
  }

  function loadReplayFromStorage() {
    try {
      const raw = localStorage.getItem(REPLAY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.frames)) return null;
      const frames = [];
      let prevT = -1;
      for (let i = 0; i < parsed.frames.length && frames.length < REPLAY_MAX_FRAMES; i++) {
        const f = parsed.frames[i];
        if (!f || typeof f !== 'object') continue;
        const t = Number(f.t), x = Number(f.x), y = Number(f.y), z = Number(f.z);
        let vx = Number(f.vx), vy = Number(f.vy), vz = Number(f.vz);
        if (!isFinite(t) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz)) continue;
        const vLen = Math.hypot(vx, vy, vz);
        if (vLen > 1e-5) { vx /= vLen; vy /= vLen; vz /= vLen; }
        else { vx = 0; vy = 0; vz = -1; }
        const clampedT = Math.max(prevT, Math.max(0, t));
        prevT = clampedT;
        frames.push({
          t: clampedT,
          x, y, z,
          vx, vy, vz,
          c: isFinite(Number(f.c)) ? Math.max(0, Math.min(1, Number(f.c))) : 0,
          f: f.f ? 1 : 0,
        });
      }
      if (frames.length < 2) return null;
      const dur = Math.max(0.1, frames[frames.length - 1].t - frames[0].t);
      return {
        seed: typeof parsed.seed === 'number' && isFinite(parsed.seed) ? parsed.seed : null,
        evSeed: typeof parsed.evSeed === 'number' && isFinite(parsed.evSeed) ? parsed.evSeed : null,
        cause: sanitizeCallsign(parsed.cause || 'siren') || 'siren',
        callsign: sanitizeCallsign(parsed.callsign || 'Investigator') || 'Investigator',
        duration: dur,
        startOffset: frames[0].t,
        frames,
      };
    } catch (e) {
      return null;
    }
  }

  function syncDeathReplayButton() {
    const btn = $('death-replay-btn');
    if (!btn) return;
    const saved = loadReplayFromStorage();
    btn.style.display = (saved && saved.frames && saved.frames.length >= 2) ? '' : 'none';
  }

  function formatReplayTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function syncReplayControlsUI() {
    const playBtn = $('replay-play-btn');
    const spdBtn = $('replay-speed-btn');
    const camBtn = $('replay-cam-btn');
    const timeEl = $('replay-time');
    const scrub = $('replay-scrub');
    const dur = replayData ? replayData.duration : 0;
    if (playBtn) playBtn.textContent = replayPlaying ? '[SPACE] PAUSE' : '[SPACE] PLAY';
    if (spdBtn) spdBtn.textContent = `[F] ${replaySpeed}X`;
    if (camBtn) camBtn.textContent = replayFirstPerson ? '[V] 1ST PERSON' : '[V] 3RD PERSON';
    if (timeEl) timeEl.textContent = `${formatReplayTime(replayTime)} / ${formatReplayTime(dur)}`;
    if (scrub) {
      scrub.max = String(Math.max(0.1, dur));
      scrub.value = String(Math.max(0, Math.min(dur, replayTime)));
    }
  }

  function sampleReplayAt(relSec) {
    if (!replayData || !replayData.frames || replayData.frames.length < 2) return null;
    const frames = replayData.frames;
    const absT = (replayData.startOffset || 0) + Math.max(0, Math.min(replayData.duration, relSec));
    let lo = 0, hi = frames.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= absT) lo = mid;
      else hi = mid;
    }
    const f0 = frames[lo];
    const f1 = frames[hi];
    const span = Math.max(1e-5, f1.t - f0.t);
    const alpha = f1.t > f0.t ? Math.max(0, Math.min(1, (absT - f0.t) / span)) : 0;
    const x = f0.x + (f1.x - f0.x) * alpha;
    const y = f0.y + (f1.y - f0.y) * alpha;
    const z = f0.z + (f1.z - f0.z) * alpha;
    let vx = f0.vx + (f1.vx - f0.vx) * alpha;
    let vy = f0.vy + (f1.vy - f0.vy) * alpha;
    let vz = f0.vz + (f1.vz - f0.vz) * alpha;
    const vLen = Math.hypot(vx, vy, vz);
    if (vLen > 1e-5) { vx /= vLen; vy /= vLen; vz /= vLen; }
    else { vx = 0; vy = 0; vz = -1; }
    const crouch = f0.c + (f1.c - f0.c) * alpha;
    const flashOn = (alpha < 0.5 ? f0.f : f1.f) > 0.5;
    const dist = Math.hypot(f1.x - f0.x, f1.z - f0.z);
    const speed = f1.t > f0.t ? dist / span : 0;
    return {
      x, y, z, vx, vy, vz,
      yaw: Math.atan2(-vx, -vz),
      pitch: Math.asin(Math.max(-1, Math.min(1, vy))),
      crouch,
      flashOn,
      moving: speed > 0.25,
    };
  }

  function applyReplayFrame(snap, dt, snapCam) {
    if (!snap || !replayGhost || !camera) return;
    replayGhost.pos.set(snap.x, snap.y, snap.z);
    replayGhost.targetPos.set(snap.x, snap.y, snap.z);
    replayGhost.yaw = snap.yaw;
    replayGhost.pitch = snap.pitch;
    replayGhost.crouch = snap.crouch;
    replayGhost.flashOn = snap.flashOn;
    replayGhost.moving = replayPlaying && snap.moving;
    replayGhost.firstPersonHidden = !!replayFirstPerson;
    replayGhost.update(Math.min(0.05, dt || 0.016), camera.position);
    replayGhost.root.position.set(snap.x, snap.y, snap.z);
    replayGhost.root.rotation.y = snap.yaw;

    const eyeY = snap.y + 1.62 - snap.crouch * 0.42;
    if (replaySightLine && replaySightLine.geometry) {
      const posAttr = replaySightLine.geometry.getAttribute('position');
      if (posAttr) {
        posAttr.setXYZ(0, snap.x, eyeY, snap.z);
        posAttr.setXYZ(1, snap.x + snap.vx * 4.5, eyeY + snap.vy * 4.5, snap.z + snap.vz * 4.5);
        posAttr.needsUpdate = true;
      }
    }
    if (replayFirstPerson) {
      camera.position.set(snap.x, eyeY, snap.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(snap.pitch, snap.yaw, 0);
    } else {
      const hLen = Math.hypot(snap.vx, snap.vz);
      const hx = hLen > 0.01 ? snap.vx / hLen : -Math.sin(snap.yaw);
      const hz = hLen > 0.01 ? snap.vz / hLen : -Math.cos(snap.yaw);
      _replayCamTarget.set(snap.x - hx * 3.8, eyeY + 1.25 - snap.vy * 0.65, snap.z - hz * 3.8);
      if (snapCam) camera.position.copy(_replayCamTarget);
      else camera.position.lerp(_replayCamTarget, Math.min(1, (dt || 0.016) * 14));
      _replayLookPt.set(snap.x + snap.vx * 1.4, eyeY + snap.vy * 0.5, snap.z + snap.vz * 1.4);
      camera.lookAt(_replayLookPt);
    }
  }

  function cleanupGhostReplay() {
    document.body.classList.remove('replaying');
    const rb = $('replay-bar');
    if (rb) rb.classList.remove('show');
    if (replayGhost) {
      try { replayGhost.dispose(); } catch (e) {}
      replayGhost = null;
    }
    if (replayPathLine) {
      if (replayPathLine.parent) replayPathLine.parent.remove(replayPathLine);
      if (replayPathLine.geometry) replayPathLine.geometry.dispose();
      if (replayPathLine.material) replayPathLine.material.dispose();
      replayPathLine = null;
    }
    if (replaySightLine) {
      if (replaySightLine.parent) replaySightLine.parent.remove(replaySightLine);
      if (replaySightLine.geometry) replaySightLine.geometry.dispose();
      if (replaySightLine.material) replaySightLine.material.dispose();
      replaySightLine = null;
    }
    if (replayDeathBeacon) {
      if (replayDeathBeacon.parent) replayDeathBeacon.parent.remove(replayDeathBeacon);
      if (replayDeathBeacon.geometry) replayDeathBeacon.geometry.dispose();
      if (replayDeathBeacon.material) replayDeathBeacon.material.dispose();
      replayDeathBeacon = null;
    }
    if (replayEnemyVis) {
      if (siren && siren.root) siren.root.visible = replayEnemyVis.siren;
      if (fastone && fastone.root) fastone.root.visible = replayEnemyVis.fastone;
      if (sneaky && sneaky.root) sneaky.root.visible = replayEnemyVis.sneaky;
      if (moths && moths.root) moths.root.visible = replayEnemyVis.moths;
      replayEnemyVis = null;
    }
    replayPlaying = false;
  }

  function startGhostReplay() {
    const loaded = loadReplayFromStorage();
    if (!loaded || !loaded.frames || loaded.frames.length < 2) {
      showHint('No saved match replay available yet.', 3000);
      return;
    }
    cleanupGhostReplay();
    replayData = loaded;
    LO.TVFX.clear();
    A.stopDeathMusic();
    A.stopRinging();
    clearTimeout(deathTimer);
    A.stopVoices();
    A.silenceWorld(true);
    clearGlitch();
    clearFlashStrobe();
    clearFallFx();
    hideAllScreens();
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (e) {}
    }

    if (!world || !scene || (replayData.seed !== null && replayData.seed !== currentRunSeed)) {
      buildWorld(
        replayData.seed !== null ? replayData.seed : undefined,
        replayData.evSeed !== null ? replayData.evSeed : undefined
      );
      currentRunSeed = replayData.seed;
      currentEvSeed = replayData.evSeed;
    }

    replayEnemyVis = {
      siren: !!(siren && siren.root && siren.root.visible),
      fastone: !!(fastone && fastone.root && fastone.root.visible),
      sneaky: !!(sneaky && sneaky.root && sneaky.root.visible),
      moths: !!(moths && moths.root && moths.root.visible),
    };
    if (siren && siren.root) siren.root.visible = false;
    if (fastone && fastone.root) fastone.root.visible = false;
    if (sneaky && sneaky.root) sneaky.root.visible = false;
    if (moths && moths.root) moths.root.visible = false;
    remotePlayers.forEach(rp => { if (rp && rp.root) rp.root.visible = false; });

    replayGhost = new LO.RemotePlayer(scene, world, {
      id: 'replay-ghost',
      slot: 0,
      name: `${replayData.callsign} · GHOST`,
      color: '#7ce8ff',
      jacketHex: 0x52c8f2,
    });
    if (Array.isArray(replayGhost._mats)) {
      const cyanTint = new THREE.Color(0x7ce8ff);
      replayGhost._mats.forEach(m => {
        if (!m) return;
        if (replayGhost.tagSprite && m === replayGhost.tagSprite.material) {
          m.opacity = 0.88;
          return;
        }
        m.transparent = true;
        m.opacity = 0.44;
        m.depthWrite = false;
        if (m.color) m.color.lerp(cyanTint, 0.55);
        if (m.emissive) {
          m.emissive.setHex(0x2899cc);
          m.emissiveIntensity = 0.65;
        }
      });
    }

    const pathPts = replayData.frames.map(f => new THREE.Vector3(f.x, f.y + 0.14, f.z));
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPts);
    const pathMat = new THREE.LineBasicMaterial({ color: 0x6ce2ff, transparent: true, opacity: 0.45 });
    replayPathLine = new THREE.Line(pathGeo, pathMat);
    scene.add(replayPathLine);

    const sightGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -4.5),
    ]);
    const sightMat = new THREE.LineBasicMaterial({ color: 0xbef5ff, transparent: true, opacity: 0.85 });
    replaySightLine = new THREE.Line(sightGeo, sightMat);
    scene.add(replaySightLine);

    const lastF = replayData.frames[replayData.frames.length - 1];
    const beaconGeo = new THREE.CylinderGeometry(0.06, 0.24, 1.85, 12);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a52, transparent: true, opacity: 0.42 });
    replayDeathBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    replayDeathBeacon.position.set(lastF.x, lastF.y + 0.92, lastF.z);
    scene.add(replayDeathBeacon);

    replayTime = 0;
    replayPlaying = true;
    replaySpeed = 1;
    replayFirstPerson = false;
    state = 'replay';
    document.body.classList.add('replaying');
    document.body.classList.remove('spectating');
    show('hud');
    const rb = $('replay-bar');
    if (rb) rb.classList.add('show');
    const metaEl = $('replay-meta');
    if (metaEl) metaEl.textContent = `${replayData.cause.toUpperCase()} · ${replayData.callsign}`;
    $('fade').style.transition = 'none';
    $('fade').style.opacity = 0;
    applyDisplay();
    if (camera) { camera.fov = S.fov; camera.updateProjectionMatrix(); }

    const snap0 = sampleReplayAt(0);
    if (snap0) applyReplayFrame(snap0, 0.016, true);
    syncReplayControlsUI();
    updateMatchIdWatermark();
  }

  function updateGhostReplay(dt) {
    if (!replayData || !replayGhost) return;
    if (replayPlaying) {
      replayTime += dt * replaySpeed;
      if (replayTime >= replayData.duration) {
        replayTime = replayData.duration;
        replayPlaying = false;
      }
    }
    const snap = sampleReplayAt(replayTime);
    if (snap) applyReplayFrame(snap, dt, !replayPlaying);
    if (world && world.update) {
      _worldUpdateOpts.pos = replayGhost.pos;
      _worldUpdateOpts.disturbed = false;
      _worldUpdateOpts.still = true;
      _worldUpdateOpts.enabled = false;
      _worldUpdateOpts.threats = null;
      _worldUpdateOpts.onScatter = null;
      world.update(dt, replayTime, _worldUpdateOpts);
    }
    syncReplayControlsUI();
  }

  function exitGhostReplay() {
    if (state !== 'replay') return;
    cleanupGhostReplay();
    state = 'dead';
    hideAllScreens();
    show('death');
    $('damage').style.opacity = 0;
    $('fade').style.transition = 'none';
    $('fade').style.opacity = 0;
    syncDeathReplayButton();
    if (V().deathRoom && deathRoom) {
      $('death').classList.remove('legacy');
      deathRoom.show(dieCause);
      deathShown = true;
      A.playMusic(null, 0.3);
      if (!Net || !Net.isCoop()) {
        const kickToTitle = () => {
          if (state !== 'dead') return;
          ui.fadeOut(0.25);
          setTimeout(goTitle, 300);
        };
        clearTimeout(deathTimer);
        if (!A.playDeathMusic(kickToTitle)) deathTimer = setTimeout(kickToTitle, 58000);
      } else {
        A.playDeathMusic(() => {});
      }
    } else {
      $('death').classList.add('legacy');
      const D = DEATHS[dieCause] || DEATHS.siren;
      $('death-title').textContent = D.title;
      $('death-tip').textContent = D.tips[(Math.random() * D.tips.length) | 0] || '';
      A.playMusic('title', 1.5);
    }
    updateMatchIdWatermark();
  }

  function copyMatchIdToClipboard(sourceBtn) {
    const code = (Net && Net.roomCode) ? Net.roomCode : '';
    if (!code) return;
    const finish = () => {
      if (sourceBtn) {
        const prev = sourceBtn.textContent;
        sourceBtn.textContent = `COPIED: ${code}`;
        clearTimeout(_matchIdCopyTimer);
        _matchIdCopyTimer = setTimeout(() => { updateMatchIdWatermark(); }, 1600);
        if (!prev) updateMatchIdWatermark();
      }
      showHint(`Copied Match ID: ${code}`, 2200);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(finish).catch(() => finish());
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {}
      finish();
    }
  }

  function updateMatchIdWatermark() {
    const isCoop = !!(Net && Net.isCoop && Net.isCoop() && Net.roomCode);
    const inMatch = isCoop && (
      state === 'opening' || state === 'play' || state === 'paused' ||
      state === 'spectate' || state === 'dying' || state === 'dead' ||
      state === 'replay' || state === 'ending' || state === 'credits'
    );
    document.body.classList.toggle('in-coop-match', inMatch);
    const pauseEl = $('pause');
    const copyable = inMatch && !!(
      coopMenuOpen ||
      state === 'paused' ||
      (pauseEl && pauseEl.classList.contains('active')) ||
      (LO.admin && LO.admin.open)
    );
    document.body.classList.toggle('match-id-copyable', copyable);
    const wm = $('coop-match-id');
    if (wm) wm.textContent = isCoop ? `ID: ${Net.roomCode}` : 'ID: -----';
    const pm = $('pause-match-id');
    if (pm) pm.textContent = isCoop ? `MATCH ID: ${Net.roomCode}  [COPY]` : '';
  }

  function handleCoopForceExit(reason) {
    const msg = reason || 'Disconnected from match.';
    resetAfkActivity();
    afkKicking = false;
    clearChatLogs();
    updateVoiceUI();
    if (LO.admin && LO.admin.open && LO.admin.closePanel) LO.admin.closePanel(true);
    if (state !== 'title' && state !== 'gate') {
      goTitle();
    } else {
      hideAllScreens();
      show('title');
      document.body.classList.remove('in-coop', 'in-coop-match', 'match-id-copyable', 'spectating');
      updateMatchIdWatermark();
    }
    showHint(msg, 6500);
    const js = $('coop-join-status');
    if (js) {
      js.textContent = msg;
      js.classList.add('err');
      js.style.color = '';
    }
  }

  function updateAfkTracker(dt) {
    if (!Net || !Net.isCoop || !Net.isCoop()) {
      resetAfkActivity();
      _afkTrackInit = false;
      afkKicking = false;
      return;
    }
    if (afkKicking) return;
    if (isAfkPausedState()) {
      afkLastActivityAt = Date.now();
      setAfkBanner(false);
      return;
    }
    if (state === 'play' && player && !coopMenuOpen) {
      if (!_afkTrackInit) {
        _afkLastPos.copy(player.pos);
        _afkLastYaw = player.yaw || 0;
        _afkLastPitch = player.pitch || 0;
        _afkTrackInit = true;
      } else {
        const movedDist = _afkLastPos.distanceTo(player.pos);
        const lookDelta = Math.abs((player.yaw || 0) - _afkLastYaw) + Math.abs((player.pitch || 0) - _afkLastPitch);
        const ks = player.keys || {};
        const keyHeld = !!(ks.KeyW || ks.KeyA || ks.KeyS || ks.KeyD || ks.ArrowUp || ks.ArrowDown || ks.ArrowLeft || ks.ArrowRight || ks.Space || ks.ShiftLeft || ks.ShiftRight || ks.KeyE || ks.KeyF || ks.KeyG || ks.KeyQ);
        const touchActive = !!(LO.touchStick && (Math.abs(LO.touchStick.x) > 0.05 || Math.abs(LO.touchStick.y) > 0.05)) || !!LO.touchHold;
        _afkLastPos.copy(player.pos);
        _afkLastYaw = player.yaw || 0;
        _afkLastPitch = player.pitch || 0;
        if (movedDist > 0.0025 || lookDelta > 0.0015 || keyHeld || touchActive) {
          resetAfkActivity();
        }
      }
    } else {
      _afkTrackInit = false;
    }

    checkAfkTimeout();
  }

  function sanitizeCallsign(raw) {
    return String(raw || '').replace(/[^\w \-\.]/g, '').trim().slice(0, 16);
  }
  function loadSavedCallsign() {
    try { return sanitizeCallsign(localStorage.getItem(CALLSIGN_KEY) || ''); } catch (e) { return ''; }
  }
  function saveCallsign(raw) {
    const clean = sanitizeCallsign(raw);
    try {
      if (clean) localStorage.setItem(CALLSIGN_KEY, clean);
      else localStorage.removeItem(CALLSIGN_KEY);
    } catch (e) { /* storage unavailable */ }
    return clean;
  }
  function syncCallsignInputs(val, exceptEl) {
    const clean = sanitizeCallsign(val);
    const jEl = $('coop-name-join');
    const lEl = $('coop-name-lobby');
    if (jEl && jEl !== exceptEl) jEl.value = clean;
    if (lEl && lEl !== exceptEl) lEl.value = clean;
  }
  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function appendChatMessage(msg) {
    if (!msg || !msg.text) return;
    const html = `<span class="chat-name" style="color:${escHtml(msg.color || '#4a78a8')}">${escHtml(msg.name || 'Investigator')}${msg.dead ? '<span class="chat-dead-tag">[DEAD]</span>' : ''}:</span> <span class="chat-text">${escHtml(msg.text)}</span>`;
    ['lobby-chat-log', 'hud-chat-log'].forEach(logId => {
      const log = $(logId);
      if (!log) return;
      const line = document.createElement('div');
      line.className = 'chat-line' + (msg.dead ? ' dead' : '');
      line.innerHTML = html;
      log.appendChild(line);
      while (log.children.length > 40) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    });
    const hudChat = $('coop-chat');
    if (hudChat) {
      hudChat.classList.add('has-new');
      clearTimeout(chatFadeTimer);
      chatFadeTimer = setTimeout(() => {
        const el = $('coop-chat');
        if (el && !chatOpen) el.classList.remove('has-new');
      }, 7500);
    }
  }
  function clearChatLogs() {
    chatOpen = false;
    clearTimeout(chatFadeTimer);
    ['lobby-chat-log', 'hud-chat-log'].forEach(logId => {
      const log = $(logId);
      if (log) log.innerHTML = '';
    });
    const hudChat = $('coop-chat');
    if (hudChat) hudChat.classList.remove('open', 'has-new');
    const cBtn = $('hud-chat-btn');
    if (cBtn) cBtn.classList.remove('active');
    const hi = $('hud-chat-input');
    if (hi) { hi.value = ''; hi.blur(); }
    const li = $('lobby-chat-input');
    if (li) li.value = '';
  }
  function openChat() {
    if (chatOpen || !Net || !Net.isCoop() || coopMenuOpen || (LO.admin && LO.admin.open)) return;
    if (state !== 'play' && state !== 'spectate') return;
    chatOpen = true;
    if (player && player.keys) {
      Object.keys(player.keys).forEach(k => { player.keys[k] = false; });
    }
    if (player) player.enabled = false;
    const box = $('coop-chat');
    if (box) box.classList.add('open', 'has-new');
    const cBtn = $('hud-chat-btn');
    if (cBtn) cBtn.classList.add('active');
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (e) {}
    }
    const inp = $('hud-chat-input');
    if (inp) setTimeout(() => { if (chatOpen) inp.focus(); }, 0);
  }
  function closeChat(refocusPlay) {
    if (!chatOpen) return;
    chatOpen = false;
    const box = $('coop-chat');
    if (box) box.classList.remove('open');
    const cBtn = $('hud-chat-btn');
    if (cBtn) cBtn.classList.remove('active');
    const inp = $('hud-chat-input');
    if (inp && document.activeElement === inp) inp.blur();
    if (refocusPlay && state === 'play' && !coopMenuOpen && !(LO.admin && LO.admin.open)) {
      if (player) player.enabled = true;
      lockPointer();
    }
  }
  function updateVoiceUI() {
    const inCoop = !!(Net && Net.isCoop());
    document.body.classList.toggle('in-coop', inCoop);
    const lBtn = $('lobby-mic-btn');
    const lStat = $('lobby-mic-status');
    const hBtn = $('hud-mic-btn');
    const hChatBtn = $('hud-chat-btn');
    if (hChatBtn) hChatBtn.textContent = LO.isTouch ? 'CHAT' : '[T] CHAT';
    if (!inCoop || !Net) return;

    const on = !!Net.voiceEnabled;
    const muted = !!Net.micMuted;
    const talking = !!(on && !muted && Net.localSpeaking);

    if (lBtn) {
      lBtn.textContent = !on ? 'ENABLE MIC' : muted ? 'MIC MUTED' : 'MIC LIVE';
      lBtn.classList.toggle('live', on && !muted);
      lBtn.classList.toggle('muted', on && muted);
      lBtn.classList.toggle('talking', talking);
    }
    if (lStat) {
      if (Net.voiceError) {
        lStat.textContent = Net.voiceError;
        lStat.className = 'coop-mic-status err';
      } else if (!on) {
        lStat.textContent = 'Voice off — press to test mic & talk in lobby';
        lStat.className = 'coop-mic-status';
      } else if (muted) {
        lStat.textContent = 'Microphone muted — teammates cannot hear you';
        lStat.className = 'coop-mic-status';
      } else if (talking) {
        lStat.textContent = 'Transmitting voice to squad...';
        lStat.className = 'coop-mic-status talking';
      } else {
        lStat.textContent = S.disableVoiceAttenuation
          ? 'Microphone live — constant voice volume active (no 3D attenuation)'
          : 'Microphone live — 3D proximity voice active';
        lStat.className = 'coop-mic-status';
      }
    }
    if (hBtn) {
      const pfx = LO.isTouch ? '' : '[X] ';
      hBtn.textContent = !on ? (pfx + 'MIC OFF') : muted ? (pfx + 'MIC MUTED') : (pfx + 'MIC LIVE');
      hBtn.classList.toggle('live', on && !muted);
      hBtn.classList.toggle('muted', on && muted);
      hBtn.classList.toggle('talking', talking);
    }

    const rosterEl = $('coop-roster');
    if (rosterEl && Net.getVoiceState) {
      rosterEl.querySelectorAll('.coop-slot[data-pid]').forEach(slot => {
        const pid = slot.getAttribute('data-pid');
        const pill = slot.querySelector('.coop-mic-pill');
        if (!pill || !pid) return;
        const m = rosterMicMeta(Net.getVoiceState(pid));
        if (pill.dataset.vstate !== m.state) {
          pill.dataset.vstate = m.state;
          pill.className = 'coop-mic-pill ' + m.cls;
          pill.title = m.title;
          pill.innerHTML = m.html;
        }
      });
    }
    updatePingUI();
  }
  function pingQuality(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return 'wait';
    if (ms < 80) return 'good';
    if (ms <= 160) return 'mid';
    return 'poor';
  }
  function updatePingUI() {
    const info = (Net && Net.getPingInfo) ? Net.getPingInfo() : { isHost: false, pingMs: null, maxClientPing: null, quality: 'none' };
    const inCoop = !!(Net && Net.isCoop && Net.isCoop());
    let text = '-- ms';
    let cls = 'wait';
    let title = 'Connection latency to host';
    if (!inCoop) {
      text = '-- ms';
      cls = 'wait';
    } else if (info.isHost) {
      if (typeof info.maxClientPing === 'number') {
        text = `HOST · ${info.maxClientPing} ms`;
        cls = pingQuality(info.maxClientPing);
        title = `Hosting room (highest squad ping: ${info.maxClientPing} ms)`;
      } else {
        text = 'HOST';
        cls = 'host';
        title = 'You are hosting this room';
      }
    } else if (typeof info.pingMs === 'number') {
      text = `${info.pingMs} ms`;
      cls = pingQuality(info.pingMs);
      title = `Round-trip latency to host: ${info.pingMs} ms`;
    } else {
      text = '... ms';
      cls = 'wait';
      title = 'Measuring latency to host...';
    }

    const lPill = $('coop-lobby-ping');
    const lVal = $('coop-lobby-ping-val');
    if (lPill) { lPill.className = 'coop-ping-pill ' + cls; lPill.title = title; }
    if (lVal) lVal.textContent = text;

    const hBadge = $('hud-ping-badge');
    const hVal = $('hud-ping-val');
    if (hBadge) { hBadge.className = 'hud-ping-badge ' + cls; hBadge.title = title; }
    if (hVal) hVal.textContent = text;

    const rosterEl = $('coop-roster');
    if (rosterEl && Net && Array.isArray(Net.players)) {
      rosterEl.querySelectorAll('.coop-slot[data-pid]').forEach(slot => {
        const pid = slot.getAttribute('data-pid');
        const tag = slot.querySelector('.coop-ping-tag');
        if (!tag || !pid) return;
        const p = Net.getPlayer ? Net.getPlayer(pid) : null;
        if (!p || p.id === 'host') {
          tag.style.display = 'none';
          return;
        }
        if (typeof p.ping === 'number' && isFinite(p.ping)) {
          const q = pingQuality(p.ping);
          tag.style.display = '';
          tag.className = 'coop-ping-tag ' + q;
          tag.textContent = `${p.ping} ms`;
          tag.title = `Latency to host: ${p.ping} ms`;
        } else {
          tag.style.display = '';
          tag.className = 'coop-ping-tag';
          tag.textContent = '-- ms';
          tag.title = 'Measuring latency...';
        }
      });
    }
  }
  const MIC_ON_SVG = '<svg class="coop-mic-ico" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg>';
  const MIC_OFF_SVG = '<svg class="coop-mic-ico" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/><line x1="3" y1="3" x2="21" y2="21" stroke="#0b0b0e" stroke-width="4.2" stroke-linecap="round"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function rosterMicMeta(vs) {
    if (!vs || !vs.hasMic) {
      return {
        state: 'off',
        cls: 'off',
        title: 'Proximity voice disabled',
        html: MIC_OFF_SVG + '<span>VOICE OFF</span>',
      };
    }
    if (vs.muted) {
      return {
        state: 'muted',
        cls: 'muted',
        title: 'Microphone muted',
        html: MIC_OFF_SVG + '<span>MUTED</span>',
      };
    }
    if (vs.speaking) {
      return {
        state: 'talking',
        cls: 'talking',
        title: 'Speaking',
        html: MIC_ON_SVG + '<span>TALKING</span>',
      };
    }
    return {
      state: 'live',
      cls: 'live',
      title: 'Proximity voice enabled',
      html: MIC_ON_SVG + '<span>MIC ON</span>',
    };
  }
  function syncHideSpotOccupation(id, hidden, hideSpotIdx, rp) {
    const spots = world && world.hideSpots;
    if (!spots) return;
    const prevIdx = rp ? rp._occupiedHideIdx : -1;
    if (prevIdx !== undefined && prevIdx >= 0 && spots[prevIdx] && spots[prevIdx]._occupiedBy === id) {
      if (!hidden || prevIdx !== hideSpotIdx) spots[prevIdx]._occupiedBy = null;
    }
    const nextIdx = (hidden && hideSpotIdx !== undefined && hideSpotIdx >= 0 && spots[hideSpotIdx]) ? hideSpotIdx : -1;
    if (nextIdx >= 0) spots[nextIdx]._occupiedBy = id;
    if (rp) rp._occupiedHideIdx = nextIdx;
  }
  function clearAllHideOccupancy() {
    if (world && world.hideSpots) {
      for (let i = 0; i < world.hideSpots.length; i++) world.hideSpots[i]._occupiedBy = null;
    }
    remotePlayers.forEach(rp => { rp._occupiedHideIdx = -1; });
  }

  window.addEventListener('keydown', (e) => {
    if (state !== 'spectate' || coopMenuOpen || chatOpen) return;
    if (e.code === 'KeyV') {
      spectateFirstPerson = !spectateFirstPerson;
      updateSpectateLabel();
    } else if (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight') {
      const step = (e.code === 'KeyA' || e.code === 'ArrowLeft') ? -1 : 1;
      cycleSpectate(step);
    }
  });
  const SYNC_INTERVAL = 0.04; // 25 Hz
  const V = () => LO.ver ? LO.ver() : { hint: true, darkLight: true, tenant: true, sirenFast: true, health: true, silent: true, wind: true, windStillness: true, rocks: true, echo: true, moths: true, exposure: true, deathRoom: true, tenantBlind: true, fastDeathAllowed: true, sneaky: true, fastone: true, sirenSmash: true, fastoneV2: true, staminaBuff: true, flashSway: true, dynamicSubs: true, proximityAmbient: true, richInteriors: true, cleanSubs: true, extBirdsong: true, envShake: true, forestBirds: true, birdFade: true, forestRing: true, echoClosePause: true, townMap: true, hazards: true, perfOpt276: true, reverb: true };
  // ---- hint system: unlocks after 3 minutes without finding evidence ----
  const HINT_DELAY = 180;
  let lastEvidenceTime = 0, hintUntil = 0, hintTarget = null;
  function hintReady() { return V().hint && state === 'play' && !endingQueued && gameTime - lastEvidenceTime >= HINT_DELAY; }
  function useHint() {
    if (!V().hint) return;
    if (!hintReady()) {
      if (state === 'play') showHint('Keep looking. A hint unlocks after 3 minutes without finding evidence.');
      return;
    }
    // closest piece of evidence that hasn't been photographed yet
    let best = null, bd = Infinity;
    world.evidence.forEach(e => {
      if (e.found) return;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d < bd) { bd = d; best = e; }
    });
    if (!best) return;
    hintTarget = best;
    hintUntil = Infinity;              // stays up until that piece is photographed
    lastEvidenceTime = gameTime;           // next hint needs another 3 minutes
    A.pickup();
  }
  LO.useHint = useHint;
  function updateHintUI() {
    const btn = $('hint-btn');
    const tb = $('t-hint');
    if (!V().hint) {
      btn.style.display = 'none';
      if (tb) tb.style.display = 'none';
      $('hint-arrow').style.display = 'none';
      return;
    }
    btn.style.display = '';
    if (tb) tb.style.display = '';
    const ready = hintReady();
    btn.classList.toggle('ready', ready);
    if (ready) btn.textContent = LO.isTouch ? 'HINT' : 'HINT [H]';
    else {
      const left = Math.max(0, Math.ceil(HINT_DELAY - (gameTime - lastEvidenceTime)));
      btn.textContent = `HINT ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }
    if (tb) { tb.textContent = btn.textContent; tb.classList.toggle('on', ready); }
    const box = $('hint-arrow');
    if (hintTarget && hintTarget.found) hintTarget = null;
    if (hintTarget) {
      // wandered off? point at whatever is closest now instead
      let best = hintTarget, bd = Math.hypot(hintTarget.pos.x - player.pos.x, hintTarget.pos.z - player.pos.z);
      const cur = bd;
      world.evidence.forEach(e => {
        if (e.found) return;
        const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
        if (d < bd) { bd = d; best = e; }
      });
      if (best !== hintTarget && cur - bd > 20) hintTarget = best;
    }
    if (hintTarget) {
      box.style.display = 'block';
      const dx = hintTarget.pos.x - player.pos.x, dz = hintTarget.pos.z - player.pos.z;
      // angle relative to where the player is facing (camera looks down -z at yaw 0)
      let a = Math.atan2(-dx, -dz) - player.yaw;
      $('hint-needle').style.transform = `rotate(${-a}rad)`;
      $('hint-label').textContent = `${hintTarget.name} — ${Math.round(Math.hypot(dx, dz))} m`;
    } else box.style.display = 'none';
  }
  const seenHints = {};

  // ============================================================
  //  RENDERER / SCENE
  // ============================================================
  let _isSoftwareGl = false;
  function createRenderer() {
    if (renderer) {
      renderer.dispose();
      renderer.domElement.remove();
    }
    renderer = new THREE.WebGLRenderer({
      antialias: !!S.antialias,
      powerPreference: 'high-performance',
      precision: S.quality === 'low' ? 'mediump' : 'highp',
    });
    try {
      const gl = renderer.getContext();
      const dbg = gl && gl.getExtension && gl.getExtension('WEBGL_debug_renderer_info');
      const rName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      _isSoftwareGl = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i.test(rName);
    } catch (e) { _isSoftwareGl = false; }
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = S.shadows !== 'off';
    renderer.shadowMap.type = S.shadows === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    $('game-root').appendChild(renderer.domElement);
    renderer.domElement.addEventListener('click', () => {
      if (chatOpen) { closeChat(state === 'play'); return; }
      if (state === 'play' && !document.pointerLockElement && !coopMenuOpen) lockPointer();
    });
    renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      applyDisplay();
      if ((state === 'title' || state === 'gate') && renderer && scene && camera) {
        try { renderer.render(scene, camera); } catch (err) {}
      }
    });
    applyDisplay();
  }

  function applyDisplay() {
    if (!renderer) return;
    const rawDpr = window.devicePixelRatio || 1;
    const capPr = (S.quality === 'low' || _isSoftwareGl) ? Math.min(rawDpr, 1.0) : Math.min(rawDpr, 2);
    const pr = Math.min(2.0, capPr * S.renderScale);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    document.body.classList.toggle('pixelated', S.renderScale < 0.75);
    document.body.classList.toggle('low-perf', S.quality === 'low' || S.lighting === 'simple');
    renderer.toneMappingExposure = 1.15 * S.brightness;
    if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
    if (scene && scene.fog && state !== 'ending') {
      scene.fog.density = (LO.admin && LO.admin.noFog)
        ? 0.0001
        : (LO.admin && LO.admin.fullbright)
          ? 0.0035
          : ({ near: 0.034, medium: 0.022, far: 0.014 }[S.viewDistance] || 0.022);
    }
    $('grain').style.display = S.filmGrain ? 'block' : 'none';
    $('vignette').style.display = S.vignette ? 'block' : 'none';
    $('fps').style.display = S.showFps ? 'block' : 'none';
  }

  function applyAdminLighting() {
    if (!world || !world.hemi || !world.moonLight || !world.baseLight) return;
    if (LO.admin && LO.admin.fullbright) {
      world.hemi.intensity = 2.2;
      world.moonLight.intensity = 1.65;
    } else {
      const lightBoost = V().darkLight ? 1 : 1.45;
      world.hemi.intensity = world.baseLight.hemi * lightBoost;
      world.moonLight.intensity = world.baseLight.moon * lightBoost;
    }
    applyDisplay();
  }

  let _remoteRockGeo = null, _remoteRockMat = null;
  function spawnRemoteRock(msg) {
    if (!scene || !world || !msg) return;
    if (!_remoteRockGeo) _remoteRockGeo = new THREE.IcosahedronGeometry(0.11, 0);
    if (!_remoteRockMat) _remoteRockMat = new THREE.MeshStandardMaterial({ color: 0x6a645a, roughness: 0.9 });
    const mesh = new THREE.Mesh(_remoteRockGeo, _remoteRockMat);
    mesh.position.set(msg.x || 0, msg.y || 1.5, msg.z || 0);
    scene.add(mesh);
    remoteRocks.push({
      mesh,
      vx: msg.vx || 0,
      vy: msg.vy || 0,
      vz: msg.vz || 0,
      life: 6,
    });
  }
  function hitRockCol(list, py, nx, nz) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.disabled && py < c.maxY && py > (c.minY || 0) && nx > c.minX && nx < c.maxX && nz > c.minZ && nz < c.maxZ) return true;
    }
    return false;
  }
  function updateRemoteRocks(dt) {
    if (!remoteRocks.length || !world) return;
    const W = world;
    for (let i = remoteRocks.length - 1; i >= 0; i--) {
      const r = remoteRocks[i], p = r.mesh.position;
      r.life -= dt;
      r.vy -= 13 * dt;
      const nx = p.x + r.vx * dt, nz = p.z + r.vz * dt;
      const cols = W.queryColliders ? W.queryColliders(nx, nz, 0.5) : W.colliders;
      const hit = hitRockCol(cols, p.y, nx, nz) || (W.evColliders && W.evColliders.length && hitRockCol(W.evColliders, p.y, nx, nz));
      if (hit) { r.vx *= -0.15; r.vz *= -0.15; } else { p.x = nx; p.z = nz; }
      p.y += r.vy * dt;
      r.mesh.rotation.x += 6 * dt;
      r.mesh.rotation.y += 5 * dt;
      const floorY = (W.floorHeightAt ? W.floorHeightAt(p.x, p.z, p.y) : 0) + 0.12;
      if (p.y <= floorY || r.life <= 0) {
        if (p.y <= floorY) {
          p.y = floorY;
          A.rockClack(p);
        }
        if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
        remoteRocks.splice(i, 1);
      }
    }
  }

  function disposeRemotePlayers() {
    clearAllHideOccupancy();
    remotePlayers.forEach(rp => {
      if (rp && rp.dispose) rp.dispose();
    });
    remotePlayers.clear();
    for (let i = 0; i < remoteRocks.length; i++) {
      const r = remoteRocks[i];
      if (r.mesh && r.mesh.parent) r.mesh.parent.remove(r.mesh);
    }
    remoteRocks.length = 0;
  }

  function syncRemotePlayersRoster() {
    if (!Net || !Net.isCoop() || !scene || !world) return;
    const validIds = new Set();
    Net.players.forEach(p => {
      // A player who left stays in the roster for HUD/status purposes, but must
      // never get their mesh recreated by a later sync. Hidden admins never spawn a mesh.
      if (p.id === Net.localId || p.left || p.hiddenAdmin) return;
      validIds.add(p.id);
      let rp = remotePlayers.get(p.id);
      if (!rp) {
        rp = new LO.RemotePlayer(scene, world, p);
        rp._occupiedHideIdx = -1;
        if (world.spawn) {
          rp.pos.copy(world.spawn);
          rp.targetPos.copy(world.spawn);
        }
        remotePlayers.set(p.id, rp);
      } else {
        rp.setName(p.name);
      }
      if (p.alive === false) rp.alive = false;
      else rp.alive = true;
    });
    remotePlayers.forEach((rp, id) => {
      if (!validIds.has(id)) {
        syncHideSpotOccupation(id, false, -1, rp);
        if (rp && rp.dispose) rp.dispose();
        remotePlayers.delete(id);
      }
    });
  }

  function buildWorld(seed, evSeed) {
    if (LO.Map && LO.Map.resetCache) LO.Map.resetCache();
    disposeRemotePlayers();
    if (siren) siren.dispose();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.fog = new THREE.FogExp2(0x010102, 0.022);
    if (!camera) camera = new THREE.PerspectiveCamera(S.fov, window.innerWidth / window.innerHeight, 0.1, 1100);
    camera.children.slice().forEach(c => camera.remove(c));
    world = LO.World.build(scene, seed !== undefined ? { seed, evSeed } : undefined);
    siren = new LO.SirenHead(scene, world);
    if (moths) moths.dispose();
    if (sneaky) scene && sneaky.root.parent && sneaky.root.parent.remove(sneaky.root);
    if (fastone) fastone.dispose();
    if (hazards && hazards.dispose) hazards.dispose();
    LO.ambush = { active: null, gapUntil: 0, now: 0 };
    moths = new LO.Moths(scene, world);
    sneaky = new LO.Sneaky(scene, world);
    sneaky.onAttack = lightOff => {
      if (lightOff) showHint('Your equipment is flickering...', 3000);
    };
    sneaky.onResult = seen => {
      if (Net && Net.isClient()) Net.sendToHost({ type: 'sneaky_result', seen: !!seen });
      else if (Net && Net.isHost()) sneaky.finishHostAmbush();
    };
    fastone = new LO.FastOne(scene, world);
    fastone.onBreach = pos => {
      if ((state !== 'play' && state !== 'spectate') || !V().fastoneV2) return;
      if (Net && Net.isClient()) {
        Net.sendToHost({ type: 'fastone_breach', x: pos.x, z: pos.z });
      } else {
        siren.investigateFence && siren.investigateFence(pos);
      }
    };
    fastone.onKillPlayer = target => {
      if (!target || target.id === 'host') dieBy('fastone');
      else if (Net && Net.isHost()) Net.sendTo(target.id, { type: 'player_kill', cause: 'fastone' });
    };
    hazards = LO.Hazards ? new LO.Hazards(scene, world, seed) : null;
    if (hazards) {
      hazards.onNoise = (pos, radius, kind) => {
        if (Net && Net.isClient()) {
          Net.sendToHost({ type: 'noise_evt', x: pos.x, y: pos.y || 0, z: pos.z, radius, kind });
        } else if (Net && Net.isHost()) {
          Net.broadcast({ type: 'remote_sfx', kind, x: pos.x, y: pos.y || 0, z: pos.z, fromId: 'host' });
        }
      };
      hazards.onStateChange = (idx, st) => {
        if (Net && Net.isClient()) Net.sendToHost({ type: 'haz_state', idx, st });
        else if (Net && Net.isHost()) Net.broadcast({ type: 'haz_state', idx, st });
      };
    }
    titleSpot = new THREE.SpotLight(0xfff1d6, 0, 90, 0.42, 0.5, 1.2);
    scene.add(titleSpot, titleSpot.target);
    moths.onShriek = (pos, culprit) => {
      if (state !== 'play' && state !== 'spectate') return;
      // a moth's shriek carries a long way and it makes him angry
      siren.anger = Math.min(100, siren.anger + 35);
      siren.hearNoise(pos, 90);
      if (player && player.alive) player.shake = Math.max(player.shake, 0.5);
      if (Net && Net.isHost()) {
        const targetId = culprit ? (culprit.id || 'host') : null;
        Net.broadcast({ type: 'moth_shriek', x: pos.x, y: pos.y || 2, z: pos.z, targetId, dmg: V().mothDamage || 20 });
      }
    };
    player = new LO.Player(camera, world, scene);
    player.id = (Net && Net.isCoop()) ? Net.localId : 'host';
    player.onTenantBlinded = () => {
      triggerFlashStrobe(0.95, 0.04, 0.28);
      A.click(true); A.staticBurst(null, 0.6, 0.45); A.setTenant(0);
    };
    player.hint = showHint;
    player.onPhoto = onPhoto;
    player.onDiscreteNoise = (pos, radius, kind) => {
      if (Net && Net.isClient()) {
        Net.sendToHost({ type: 'noise_evt', x: pos.x, y: pos.y || 0, z: pos.z, radius, kind });
      } else if (Net && Net.isHost()) {
        siren.hearNoise(pos, radius);
        if (kind === 'shutter') Net.broadcast({ type: 'remote_photo', id: 'host' });
      }
    };
    player.onPickup = (idx) => {
      if (Net && Net.isClient()) Net.sendToHost({ type: 'pickup_taken', idx });
      else if (Net && Net.isHost()) Net.broadcast({ type: 'pickup_sync', idx });
    };
    player.onMapTaken = () => {
      if (Net && Net.isClient()) Net.sendToHost({ type: 'map_found' });
      else if (Net && Net.isHost()) Net.broadcast({ type: 'map_sync', finderName: Net.localName });
    };
    player.onRockThrow = (pos, vel) => {
      const pkt = { type: 'rock_throw', x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, fromId: Net ? Net.localId : 'host' };
      if (Net && Net.isClient()) Net.sendToHost(pkt);
      else if (Net && Net.isHost()) Net.broadcast(pkt);
    };
    player.onDamage = (amount, cause) => {
      if (player.health > 0 && cause !== 'tenant') A.hurt();
      const d = $('damage');
      d.style.transition = 'none'; d.style.opacity = 0.9;
      setTimeout(() => { d.style.transition = 'opacity 0.8s'; d.style.opacity = 0; }, 60);
      if (cause === 'silent' || cause === 'tenant') A.silentHit();
    };
    player.onDeath = cause => dieBy(cause);
    player.onExposure = kind => {
      const f = $('exposure-face');
      if (kind === 'lunge') {
        A.exposureLunge();
        f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      } else {
        A.staticBurst(null, 0.8, 0.4);
      }
    };
    player.onRockLand = pos => {
      if (state !== 'play') return;
      if (!Net || !Net.isClient()) siren.hearNoise(pos, 45);
      else Net.sendToHost({ type: 'noise_evt', x: pos.x, y: pos.y || 0, z: pos.z, radius: 45, kind: 'rock' });
      if (hazards && hazards.onRockImpact) hazards.onRockImpact(pos, msg => showHint(msg, 3200));
    };
    siren.onEcho = d => {
      if ((state !== 'play' && state !== 'spectate') || A.still) return;
      const r = $('echo-ring');
      r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
    };
    siren.onAudioEvent = evt => {
      if (Net && Net.isHost()) Net.broadcast({ type: 'siren_sfx', evt });
    };
    player.onKicked = () => {
      A.tenantScream();
      A.playRinging();      // your ears ring after it throws you out
      const f = $('tenant-face');
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    };
    siren.onCatch = caughtPlayer => {
      if (Net && Net.isHost()) {
        if (!caughtPlayer || caughtPlayer.id === 'host') {
          onCaught();
        } else {
          const rpMeta = Net.getPlayer(caughtPlayer.id);
          if (rpMeta) rpMeta.alive = false;
          Net.sendTo(caughtPlayer.id, { type: 'player_caught' });
          Net.broadcast({ type: 'player_dead', id: caughtPlayer.id, cause: 'siren' }, caughtPlayer.id);
          checkMatchOver();
        }
        return;
      }
      onCaught();
    };
    siren.onStep = p => {
      if (state !== 'play' && state !== 'spectate') return;
      const refPos = state === 'spectate' ? camera.position : player.pos;
      const d = Math.hypot(p.x - refPos.x, p.z - refPos.z);
      if (d < 80 && state === 'play') player.shake = Math.max(player.shake, Math.pow(1 - d / 80, 1.4) * 0.95);
    };
    siren.onSmash = (b, pos) => {
      if (state !== 'play' && state !== 'spectate') return;
      const fastActive = LO.ambush && LO.ambush.active === 'fastone';
      if (!fastActive && b && b.hideSpots && b.hideSpots.length && (player.hidden || player.hideAnim)) {
        const curSpot = player.hidden || (player.hideAnim && player.hideAnim.spot);
        if (curSpot && b.hideSpots.includes(curSpot)) player.ejectFromHide();
      }
      if (Net && Net.isHost() && b) {
        Net.broadcast({ type: 'world_evt', kind: 'smash_building', bId: b.id, x: pos.x, z: pos.z, dx: Math.sin(siren.yaw), dz: Math.cos(siren.yaw) });
        if (!fastActive && b.hideSpots && b.hideSpots.length) {
          Net.players.forEach(np => {
            if (np.id !== 'host' && np.hidden && np.hideSpotIdx >= 0) {
              const sp = world.hideSpots[np.hideSpotIdx];
              if (sp && b.hideSpots.includes(sp)) Net.sendTo(np.id, { type: 'eject_hide' });
            }
          });
        }
      }
      const d = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
      if (d < 120) player.shake = Math.max(player.shake, Math.max(0.4, 1.25 * (1 - d / 120)));
      if (d < 100) player.triggerDizzy(Math.max(0.45, 1.15 * (1 - d / 100)));
    };
    siren.onStateChange = s => {
      if (state !== 'play') return;
      if (s === 'hunt') {
        A.say('player', ['Oh no. Oh no no no.', 'He\'s coming. Quiet. Be quiet.', 'Don\'t move. Don\'t breathe.'][(Math.random() * 3) | 0]);
      }
    };
    if (Net && Net.isCoop()) syncRemotePlayersRoster();
    parkedCar = null;
    worldDirty = false;
    applyDisplay();
    let _prevMothRootVis = false, _prevMoth0Vis = false, _prevSneakyVis = false;
    if (moths) {
      _prevMothRootVis = moths.root.visible;
      moths.root.visible = true;
      if (moths.moths && moths.moths[0]) {
        _prevMoth0Vis = moths.moths[0].g.visible;
        moths.moths[0].g.visible = true;
      }
    }
    if (sneaky && sneaky.root) {
      _prevSneakyVis = sneaky.root.visible;
      sneaky.root.visible = true;
    }
    if (hazards && hazards.setCompileWarmup) hazards.setCompileWarmup(true);
    if (fastone) {
      fastone.getWalkGrid && fastone.getWalkGrid();
      fastone.root.visible = true;
      if (fastone.clones) fastone.clones.forEach(c => { if (c.g) c.g.visible = true; });
      if (fastone.splinterPool && fastone.splinterPool[0]) fastone.splinterPool[0].visible = true;
      if (fastone.dustPool && fastone.dustPool[0]) fastone.dustPool[0].visible = true;
      if (world && world.hideSpots && world.hideSpots[0] && world.hideSpots[0]._hlGroup) {
        world.hideSpots[0]._hlGroup.visible = true;
      }
    }
    if (renderer) renderer.compile(scene, camera);
    if (fastone) {
      fastone.root.visible = false;
      if (fastone.clones) fastone.clones.forEach(c => { if (c.g) c.g.visible = false; });
      if (fastone.splinterPool && fastone.splinterPool[0]) fastone.splinterPool[0].visible = false;
      if (fastone.dustPool && fastone.dustPool[0]) fastone.dustPool[0].visible = false;
      if (world && world.hideSpots && world.hideSpots[0] && world.hideSpots[0]._hlGroup) {
        world.hideSpots[0]._hlGroup.visible = false;
      }
    }
    if (hazards && hazards.setCompileWarmup) hazards.setCompileWarmup(false);
    if (sneaky && sneaky.root) sneaky.root.visible = _prevSneakyVis;
    if (moths) {
      moths.root.visible = _prevMothRootVis;
      if (moths.moths && moths.moths[0]) moths.moths[0].g.visible = _prevMoth0Vis;
    }
    if (LO.Map && LO.Map.prebuild && world && (!LO.ver || V().townMap)) {
      LO.Map.prebuild({
        world,
        forestRing: !!V().forestRing,
        hazards: (hazards && V().hazards && !(LO.admin && LO.admin.noHazards)) ? hazards.list : null,
      });
    }
  }

  // ============================================================
  //  UI helpers
  // ============================================================
  function show(id, on) { $(id).classList.toggle('active', on !== false); }
  function hideAllScreens() { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); }

  const fade = $('fade');
  const ui = {
    fadeIn(sec) { fade.style.transition = `opacity ${sec || 1.2}s ease`; fade.style.opacity = 0; },
    fadeOut(sec) { fade.style.transition = `opacity ${sec || 1.2}s ease`; fade.style.opacity = 1; },
    caption(title, sub) {
      const el = $('cut-caption');
      if (!title) { el.style.opacity = 0; return; }
      el.innerHTML = '';
      el.appendChild(document.createTextNode(title));
      if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
      el.style.opacity = 1;
    },
  };

  let hintTimer = null;
  function showHint(msg, ms) {
    const el = $('hint');
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.style.opacity = 0; }, ms || 4500);
  }
  function hintOnce(key, msg, ms) { if (seenHints[key]) return; seenHints[key] = true; showHint(msg, ms || 6000); }

  // ---------- options panels ----------
  function renderOptions(listId, defs) {
    const list = $(listId);
    list.innerHTML = '';
    defs.forEach(def => {
      if (def.section) {
        const s = document.createElement('div'); s.className = 'opt-section'; s.textContent = def.section;
        list.appendChild(s); return;
      }
      const row = document.createElement('div'); row.className = 'opt-row';
      const lab = document.createElement('div');
      const l1 = document.createElement('div'); l1.className = 'opt-label'; l1.textContent = def.label; lab.appendChild(l1);
      if (def.desc) { const d = document.createElement('div'); d.className = 'opt-desc'; d.textContent = def.desc; lab.appendChild(d); }
      row.appendChild(lab);
      const ctrl = document.createElement('div'); ctrl.className = 'opt-ctrl';
      if (def.type === 'choice') {
        const prev = document.createElement('button'); prev.className = 'arrow'; prev.textContent = '<';
        const val = document.createElement('span'); val.className = 'val';
        const next = document.createElement('button'); next.className = 'arrow'; next.textContent = '>';
        const idx = () => { const i = def.values.indexOf(S[def.key]); return i < 0 ? def.values.length - 1 : i; };
        const refresh = () => { val.textContent = def.labels[idx()]; };
        const step = d => {
          let i = idx() + d;
          let values = def.values;
          if (def.key === 'quality') values = values.filter(v => v !== 'custom');
          i = (idx() + d + values.length) % values.length;
          if (def.key === 'quality' && S.quality === 'custom') i = d > 0 ? 0 : values.length - 1;
          changeSetting(def.key, values[i]);
          renderOptions(listId, defs);
        };
        prev.onclick = () => step(-1); next.onclick = () => step(1);
        refresh();
        ctrl.append(prev, val, next);
      } else {
        const r = document.createElement('input'); r.type = 'range';
        r.min = def.min; r.max = def.max; r.step = def.step; r.value = S[def.key];
        const val = document.createElement('span'); val.className = 'val'; val.textContent = def.fmt(S[def.key]);
        r.oninput = () => { const v = parseFloat(r.value); val.textContent = def.fmt(v); changeSetting(def.key, v); };
        ctrl.append(r, val);
      }
      row.appendChild(ctrl);
      list.appendChild(row);
    });
    if (listId === 'graphics-list' && worldDirty && state !== 'title') {
      const n = document.createElement('div'); n.className = 'opt-desc'; n.style.marginTop = '12px';
      n.textContent = 'Some changes (textures, lighting, shadows) apply the next time you start a game.';
      list.appendChild(n);
    }
  }

  let settingsTab = 'all';
  function setSettingsTab(tab) {
    settingsTab = tab || 'all';
    document.querySelectorAll('#settings-tabs button[data-stab]').forEach(b => {
      b.classList.toggle('active', b.dataset.stab === settingsTab);
    });
    document.querySelectorAll('#settings .settings-group').forEach(g => {
      const cat = g.dataset.scat;
      g.classList.toggle('hidden', settingsTab !== 'all' && cat !== settingsTab);
    });
  }
  function renderUnifiedSettings() {
    renderOptions('graphics-list', LO.Settings.GRAPHICS_OPTIONS);
    const aOpts = LO.Settings.AUDIO_OPTIONS || [];
    const ctrlIdx = aOpts.findIndex(o => o.section === 'GAMEPLAY' || o.section === 'CONTROLS');
    const audioOnly = ctrlIdx >= 0 ? aOpts.slice(0, ctrlIdx) : aOpts;
    const ctrlOnly = ctrlIdx >= 0 ? aOpts.slice(ctrlIdx) : [];
    renderOptions('audio-list', audioOnly);
    renderOptions('controls-list', ctrlOnly);
    setSettingsTab(settingsTab);
  }

  const REBUILD_KEYS = ['textures', 'lighting', 'shadows', 'quality'];
  function changeSetting(key, value) {
    const before = { antialias: S.antialias, shadows: S.shadows, textures: S.textures, lighting: S.lighting };
    LO.Settings.set(key, value);
    const needRebuild = before.shadows !== S.shadows || before.textures !== S.textures || before.lighting !== S.lighting;
    if (before.antialias !== S.antialias || before.shadows !== S.shadows) createRenderer();
    if (needRebuild || REBUILD_KEYS.includes(key) && needRebuild) {
      if (state === 'title') { buildWorld(); setupTitleScene(); }
      else worldDirty = true;
    }
    applyDisplay();
  }

  function syncVersionUI() {
    const latest = (LO.VERSIONS && LO.VERSIONS[0] && LO.VERSIONS[0].id) || '2.6';
    const cur = S.gameVersion || latest;
    const btn = $('version-btn');
    if (btn) btn.textContent = 'v' + cur;
    document.querySelectorAll('#updates .upd').forEach(u => {
      const match = u.dataset.ver === cur;
      u.classList.toggle('active-ver', match);
      const h3 = u.querySelector('h3');
      if (!h3) return;
      let sp = h3.querySelector('span');
      if (match) {
        if (!sp) { sp = document.createElement('span'); h3.appendChild(sp); }
        sp.textContent = cur === latest ? 'current' : 'playing';
      } else if (sp) {
        sp.remove();
      }
    });
  }

  function renderVersions() {
    const list = $('version-list');
    if (!list || !LO.VERSIONS) return;
    list.innerHTML = '';
    const latest = (LO.VERSIONS[0] && LO.VERSIONS[0].id) || '2.6';
    const cur = S.gameVersion || latest;
    LO.VERSIONS.forEach((v, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ver-item' + (v.id === cur ? ' selected' : '');
      const top = document.createElement('div'); top.className = 'ver-top';
      const num = document.createElement('span'); num.className = 'ver-num'; num.textContent = v.label;
      const badge = document.createElement('span'); badge.className = 'ver-badge';
      badge.textContent = v.id === cur ? 'ACTIVE' : idx === 0 ? 'LATEST' : 'SELECT';
      top.append(num, badge);
      const era = document.createElement('div'); era.className = 'ver-era'; era.textContent = v.era;
      b.append(top, era);
      b.onclick = () => {
        A.click(true);
        LO.Settings.set('autoLatest', v.id === latest ? latest : 'pinned');
        LO.Settings.set('gameVersion', v.id);
        syncVersionUI();
        syncCoopVersionBadge();
        renderVersions();
        if (Net && Net.isHost && Net.isHost() && Net.setHostVersion) Net.setHostVersion(v.id);
        if (state === 'title') { buildWorld(); setupTitleScene(); }
        else worldDirty = true;
        closePanel();
      };
      list.appendChild(b);
    });
  }

  function syncCoopVersionBadge() {
    const el = $('coop-ver-badge');
    if (!el) return;
    const ver = (Net && Net.isCoop() && Net.hostVersion) ? Net.hostVersion : (S.gameVersion || '2.8.3');
    el.textContent = 'v' + ver;
    const isClient = !!(Net && Net.isClient && Net.isClient());
    el.disabled = isClient;
    el.title = isClient ? 'Build version controlled by host' : 'Click to change build version';
  }

  function openPanel(id, from) {
    menuReturn = from;
    hideAllScreens();
    if (id === 'settings' || id === 'graphics' || id === 'audio') {
      if (id === 'graphics') settingsTab = 'graphics';
      else if (id === 'audio') settingsTab = 'audio';
      id = 'settings';
      renderUnifiedSettings();
    }
    if (id === 'versions') renderVersions();
    if (id === 'updates') syncVersionUI();
    if (id === 'coop-join' || id === 'coop-lobby') {
      const saved = loadSavedCallsign();
      const jEl = $('coop-name-join');
      const lEl = $('coop-name-lobby');
      if (saved && ((jEl && !jEl.value.trim()) || (lEl && !lEl.value.trim()))) {
        syncCallsignInputs(saved);
      }
      if (id === 'coop-join') {
        const js = $('coop-join-status');
        if (js && !(Net && Net.isCoop())) { js.textContent = ''; js.classList.remove('err'); js.style.color = ''; }
      }
      syncCoopVersionBadge();
    }
    show(id);
    updateMatchIdWatermark();
  }
  function closePanel() {
    hideAllScreens();
    if (menuReturn === 'pause' || coopMenuOpen || state === 'paused') { show('pause'); show('hud'); }
    else if (menuReturn === 'lobby') { show('coop-lobby'); }
    else if (state === 'play' || state === 'spectate') { show('hud'); }
    else show('title');
    updateMatchIdWatermark();
  }

  function restoreLocalVersion() {
    if (savedLocalVersion !== null) {
      S.gameVersion = savedLocalVersion;
      savedLocalVersion = null;
      syncVersionUI();
      syncCoopVersionBadge();
      worldDirty = true;
    }
  }

  function applyHostVersion(ver) {
    if (!ver) return;
    if (savedLocalVersion === null) savedLocalVersion = S.gameVersion;
    if (S.gameVersion !== ver) {
      S.gameVersion = ver;
      syncVersionUI();
      worldDirty = true;
    }
    syncCoopVersionBadge();
  }

  // ============================================================
  //  TITLE SCREEN
  // ============================================================
  let titleT = 0;
  function setupTitleScene() {
    if (!world || !siren) return;
    siren.scripted = true;
    siren.pos.set(world.STREETS[3], 0, world.STREETS[3] + 8);
    siren.yaw = Math.PI * 1.15;
    siren.glowOverride = 0.45;
    siren.forceLean = 0.2;
    siren.neckDip = 0; siren.armRaise = 0;
    siren.root.rotation.x = 0;
    if (fastone && fastone.root) {
      fastone.root.visible = false;
      if (fastone.head) fastone.head.rotation.y = 0;
      if (fastone.jaw) fastone.jaw.rotation.x = 0;
    }
    if (sneaky && sneaky.root) sneaky.root.visible = false;
    if (world.hemi) world.hemi.intensity = 0.3;
    if (world.moonLight) world.moonLight.intensity = 0.35;
    titleT = 0;
  }
  // ---- title screen: slow atmospheric shots fading through black ----
  const SHOT_LEN = 6.5;
  const _tv = new THREE.Vector3();
  function titleMoth(i, x, z, faceX, faceZ, t) {
    const m = moths && moths.moths && moths.moths[i];
    if (!m) return;
    m.g.visible = true;
    m.g.position.set(x, 0.12, z);
    m.g.rotation.y = Math.atan2(faceX - x, faceZ - z) + Math.sin(t * 0.7 + i) * 0.08;
    const q = 0.15 + Math.max(0, Math.sin(t * 2.3 + i * 2)) * 0.25;
    m.wings.forEach(w => { w.mesh.rotation.y = w.side * (0.5 + q + Math.sin(t * 30 + w.side) * q * 0.25); });
    m.head.rotation.z = Math.sin(t * 9 + i) * 0.04;
  }
  // an alley spot with nothing between the camera and the moth
  let mothSpotCache = null;
  function titleMothSpot() {
    if (mothSpotCache && mothSpotCache.world === world) return mothSpotCache;
    const blocked = (x, z) => world.colliders.some(c => c.maxY > 0.5 && x > c.minX - 0.4 && x < c.maxX + 0.4 && z > c.minZ - 0.4 && z < c.maxZ + 0.4);
    let found = { x: LO.World.BLOCK_C[3], z: LO.World.BLOCK_C[2] };
    outer: for (const bx of LO.World.BLOCK_C) for (const bz of LO.World.BLOCK_C) for (let o = -12; o <= 12; o += 2) {
      const x = bx + o, z = bz;
      let clear = true;
      for (let t = 0; t <= 9; t += 0.5) if (blocked(x - t, z)) { clear = false; break; }
      if (clear) { found = { x, z }; break outer; }
    }
    mothSpotCache = Object.assign(found, { world });
    return mothSpotCache;
  }
  function updateTitle(dt) {
    if (!world || !siren || !camera) return;
    titleT += dt;
    const shot = Math.floor(titleT / SHOT_LEN) % 7, k = (titleT % SHOT_LEN) / SHOT_LEN, lt = titleT % SHOT_LEN;
    // fade to black at the start and end of every shot
    const f = lt < 1.2 ? 1 - lt / 1.2 : lt > SHOT_LEN - 1.2 ? (lt - (SHOT_LEN - 1.2)) / 1.2 : 0;
    const tf = $('title-fade');
    if (tf) tf.style.opacity = f;
    try {
      if (world.updateWind) world.updateWind(dt, 0.8, camera.position, titleT);
      if (moths && moths.moths) moths.moths.forEach(m => { m.g.visible = false; });
      if (fastone && fastone.root) {
        fastone.root.visible = false;
        if (fastone.head) fastone.head.rotation.y = 0;
        if (fastone.jaw) fastone.jaw.rotation.x = 0;
      }
      if (sneaky && sneaky.root) sneaky.root.visible = false;
      if (titleSpot) titleSpot.intensity = 0;
      siren.root.visible = true;
      siren.scripted = true;
      const S0 = world.STREETS;
      const ver = V();
      if (shot === 0) {                                        // looking up at Siren Head in the street
        siren.pos.set(S0[3], 0, 20); siren.yaw = Math.PI * 1.1; siren.speedNow = 0; siren.glowOverride = 0.35;
        camera.position.set(S0[3] - 3, 1.3 + k * 0.8, -6 + k * 5);
        camera.lookAt(S0[3] + 7, 9 + k * 3, 20);
        if (titleSpot) { titleSpot.position.set(S0[3] - 3, 1, -4); titleSpot.target.position.set(S0[3], 10, 20); titleSpot.intensity = 9; }
      } else if (shot === 1) {                                 // Hollow Creek highway sign (front face) & dark pine treeline
        siren.root.visible = false;
        camera.position.set(-4.8 - k * 2.2, 2.25, -140.5 + k * 1.0);
        camera.lookAt(-8.0, 3.2, -150.0);
        if (titleSpot) {
          titleSpot.position.copy(camera.position);
          titleSpot.target.position.set(-8.0, 3.3, -150.0);
          titleSpot.intensity = 6.0;
        }
      } else if (shot === 2) {                                 // close on the horns
        siren.pos.set(S0[3], 0, 20); siren.yaw = Math.PI * 1.1; siren.speedNow = 0; siren.glowOverride = 0.55 + Math.sin(titleT * 2) * 0.1;
        siren.update(0, null, titleT);
        siren.root.updateMatrixWorld(true);
        siren.headWorldPos(_tv);
        camera.position.set(_tv.x - 6 + k * 2, _tv.y - 1.5, _tv.z - 8 + k);
        camera.lookAt(_tv.x, _tv.y - 0.3, _tv.z);
      } else if (shot === 3 && ver.moths && moths && moths.moths) { // a moth at the end of an alley, caught in a torch beam
        siren.root.visible = false;
        const spot = titleMothSpot();
        const mx = spot.x, mz = spot.z;
        camera.position.set(mx - 8 + k * 2, 1.6, mz);
        titleMoth(0, mx, mz, camera.position.x, camera.position.z, titleT);
        camera.lookAt(mx, 1.5, mz - 2.8);
        if (titleSpot) { titleSpot.position.copy(camera.position); titleSpot.target.position.set(mx, 1.4, mz); titleSpot.intensity = 7; }
      } else if (shot === 4 || (!ver.moths && shot === 3)) {   // Siren Head stalking between buildings
        siren.pos.set(S0[2], 0, -40 + k * 14); siren.yaw = 0; siren.speedNow = 2.2; siren.glowOverride = 0.3;
        camera.position.set(S0[2] - 3.5, 2.2, -72 + k * 3);
        camera.lookAt(S0[2] + 5, 8, -34 + k * 14);
        if (titleSpot) { titleSpot.position.set(S0[2] - 3.5, 1.5, -70); titleSpot.target.position.set(S0[2], 9, -34 + k * 14); titleSpot.intensity = 10; }
      } else if (shot === 5 && ver.moths && world.enterables && world.enterables.length) { // two moths waiting just inside a doorway
        siren.root.visible = false;
        const b = world.enterables.find(e => !e.sheriff) || world.enterables[0];
        const m1 = b.F.point(-0.7, b.hd - 1.6), m2 = b.F.point(0.8, b.hd - 3.2), cp = b.F.point(0.3 * Math.sin(titleT * 0.2), b.hd + 5.5 - k * 1.5);
        camera.position.set(cp.x, 1.55, cp.z);
        titleMoth(1, m1.x, m1.z, cp.x, cp.z, titleT);
        titleMoth(2, m2.x, m2.z, cp.x, cp.z, titleT);
        const in1 = b.F.point(0, b.hd - 2.2);
        camera.lookAt(in1.x, 1.5, in1.z);
        if (titleSpot) { titleSpot.position.copy(camera.position); titleSpot.target.position.set(in1.x, 1.3, in1.z); titleSpot.intensity = 6; }
      } else {                                                 // Type-III ROAD CLOSED barricades & debris at the town gate
        siren.root.visible = false;
        camera.position.set(-6.8 + k * 3.8, 1.55, -124.0 + k * 2.2);
        camera.lookAt(-1.2, 1.1, -113.5);
        if (titleSpot) {
          titleSpot.position.copy(camera.position);
          titleSpot.target.position.set(0.2, 0.9, -113.5);
          titleSpot.intensity = 7.5;
        }
      }
      siren.update(dt, null, titleT);
      if (world.update) world.update(dt, titleT, { still: false, enabled: !!ver.forestBirds });
    } catch (err) {
      console.warn('[title] Title scene update error:', err);
      if (tf) tf.style.opacity = 0;
    }
  }

  function goTitle() {
    cleanupGhostReplay();
    clearGlitch();
    clearFlashStrobe();
    A.silenceWorld(false);
    if (cutscene) endCutscene();
    LO.TVFX.clear();
    A.stopDeathMusic(); A.stopRinging(); clearTimeout(deathTimer);
    A.stopVoices();
    closeChat(false);
    clearChatLogs();
    coopMenuOpen = false;
    spectateId = null;
    coopTeamWiped = false;
    lastWorldSnap = null;
    lastCoopHudHtml = null;
    resetAfkActivity();
    afkKicking = false;
    if (Net && Net.isCoop()) {
      // Everyone in the roster is leaving with us: treat them all as gone so a
      // stale DEAD/HP status can never linger, and drop their meshes.
      Net.players.forEach(p => { p.left = true; p.alive = false; });
      Net.leave();
    }
    disposeRemotePlayers();
    restoreLocalVersion();
    document.body.classList.remove('spectating', 'in-coop', 'in-coop-match', 'match-id-copyable');
    updateMatchIdWatermark();
    updateVoiceUI();
    const sb = $('spectate-bar'); if (sb) sb.classList.remove('show');
    const th = $('coop-team-hud'); if (th) { th.classList.remove('show'); th.innerHTML = ''; }
    hideAllScreens();
    if (document.pointerLockElement) document.exitPointerLock();
    if (player) { player.enabled = false; player.flashOn = false; player.mapOpen = false; }
    show('map-overlay', false);
    const mb = $('map-hud-badge'); if (mb) mb.classList.remove('show', 'open');
    document.body.classList.remove('map-open', 'has-map');
    resetHudCache();
    A.setReverbZone && A.setReverbZone(false, false);
    A.setFlashlightBuzz(false); A.setHeartbeat(0); A.setTenant(0); A.setSilentOne(0);
    A.setBreathing && A.setBreathing(0);
    A.setStillness(false); document.body.classList.remove('still'); A.setMothFlutter(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.15);
    A.setEnvHum && A.setEnvHum(0);
    $('silent-one').style.opacity = 0;
    if (worldDirty || state === 'ending' || state === 'credits' || state === 'dead' || state === 'spectate') buildWorld();
    setupTitleScene();
    state = 'title';
    show('title');
    $('credits-roll').classList.remove('rolling');
    ui.fadeIn(1.5);
    A.playMusic('title', 2);
    A.setWind(0.12);
    camera.fov = S.fov; camera.updateProjectionMatrix();
  }

  // ============================================================
  //  GAME FLOW
  // ============================================================
  function resetRun(seed, evSeed) {
    lastWorldSnap = null;
    lastCoopHudHtml = null;
    currentRunSeed = seed !== undefined ? seed : null;
    currentEvSeed = evSeed !== undefined ? evSeed : null;
    if (seed !== undefined) {
      buildWorld(seed, evSeed);
    } else {
      if (worldDirty || V().randomSheriff) buildWorld();
      world.placeEvidence();          // every game the evidence moves (except the sheriff's tape)
    }
    clearAllHideOccupancy();
    coopTeamWiped = false;
    spectateId = null;
    coopMenuOpen = false;
    document.body.classList.remove('spectating');
    const sb = $('spectate-bar'); if (sb) sb.classList.remove('show');
    if (Net && Net.isCoop()) {
      Net.players.forEach(p => { p.alive = true; p.hidden = false; p.hideSpotIdx = -1; p.health = 100; });
      syncRemotePlayersRoster();
    }
    titleSpot.intensity = 0; siren.root.visible = true; $('title-fade').style.opacity = 0;
    const showRocks = V().rocks;
    world.pickups.forEach(p => {
      p.taken = (p.type === 'rock' && !showRocks);
      p.mesh.visible = !p.taken;
    });
    evidenceCount = 0; endingQueued = false;
    siren.scripted = false;
    siren.root.rotation.x = 0;
    siren.glowOverride = undefined; siren.forceLean = undefined; siren.armRaise = 0; siren.neckDip = 0;
    siren.anger = 0; siren.catchDisabled = false; siren.state = 'wander'; siren.path = []; siren.lastHeardTime = -999;
    siren.fenceDistractUntil = 0; siren.ignorePlayerUntil = 0; siren.fenceLockPos = null;
    siren.spawnFar();
    const slotOff = (Net && Net.isCoop()) ? (Net.localSlot - 1.5) * 1.15 : 0;
    const spawnPos = world.spawn.clone();
    spawnPos.x += slotOff;
    player.reset(spawnPos, Math.PI);
    moths.reset();
    LO.ambush = { active: null, gapUntil: 0, now: 0 };
    sneaky.reset();
    if (fastone) fastone.reset();
    if (hazards && hazards.reset) hazards.reset();
    gameTime = 0;
    lastEvidenceTime = 0; hintUntil = 0; hintTarget = null;
    updateEvidenceUI();
    if (LO.Map && LO.Map.prebuild && world && (!LO.ver || V().townMap)) {
      LO.Map.prebuild({
        world,
        forestRing: !!V().forestRing,
        hazards: (hazards && V().hazards && !(LO.admin && LO.admin.noHazards)) ? hazards.list : null,
      });
    }
  }

  function startGame(skipIntro, seed, evSeed) {
    cleanupGhostReplay();
    clearGlitch();
    LO.TVFX.clear();
    A.stopDeathMusic(); A.stopRinging(); clearTimeout(deathTimer);
    A.init();
    A.stopVoices();
    hideAllScreens();
    state = 'loading';
    if (seed !== undefined) buildWorld(seed, evSeed);
    resetRun(seed, evSeed);
    ui.fadeOut(0.8);
    setTimeout(() => {
      if (skipIntro) { beginPlay(); return; }
      state = 'opening';
      show('cutscene');
      document.querySelector('.skip-hint').style.display = ''; $('skip-bar').style.display = '';
      cutCtx = makeCutCtx(() => {
        endCutscene();
        if (Net && Net.isHost()) Net.broadcast({ type: 'begin_play' });
        beginPlay();
      });
      cutscene = LO.Cutscenes.opening(cutCtx);
    }, 900);
  }

  function makeCutCtx(onDone) {
    return {
      world, camera, siren, scene, ui, cleanup: [], onDone,
      shake(a) { shakeAmt = Math.max(shakeAmt, a); },
      applyShake(v) { if (shakeAmt > 0) { v.x += (Math.random() - 0.5) * shakeAmt; v.y += (Math.random() - 0.5) * shakeAmt; } },
    };
  }
  function endCutscene() {
    if (cutCtx) cutCtx.cleanup.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
    cutscene = null; cutCtx = null;
    skipHeld = 0; $('skip-bar').firstChild.style.width = '0';
    ui.caption('');
  }

  function beginPlay() {
    A.silenceWorld(false);
    A.stopVoices();
    hideAllScreens();
    if (world.setBarricadesRammed) world.setBarricadesRammed();
    if (!parkedCar) {
      const c = world.playerCarPos;
      parkedCar = world.car(c.x, c.z, 0, { paint: world.mat({ color: 0x23384f, roughness: 0.4, metalness: 0.4 }) });
    }
    siren.scripted = false;
    siren.glowOverride = undefined;
    siren.spawnFar();
    siren.state = 'wander'; siren.path = [];
    siren.fenceDistractUntil = 0; siren.ignorePlayerUntil = 0; siren.fenceLockPos = null;
    const slotOff = (Net && Net.isCoop()) ? (Net.localSlot - 1.5) * 1.15 : 0;
    const spawnPos = world.spawn.clone();
    spawnPos.x += slotOff;
    player.reset(spawnPos, Math.PI);
    const ver = V();
    applyAdminLighting();
    const hpRow = $('health-fill') && $('health-fill').closest('.bar-row');
    if (hpRow) hpRow.style.display = ver.health ? '' : 'none';
    const throwBtn = $('t-throw');
    if (throwBtn) throwBtn.style.display = ver.rocks ? '' : 'none';
    lastEvidenceTime = gameTime; hintUntil = 0; hintTarget = null;
    player.enabled = true;
    coopMenuOpen = false;
    show('map-overlay', false);
    const mb = $('map-hud-badge'); if (mb) mb.classList.remove('show', 'open');
    document.body.classList.remove('map-open', 'has-map', 'spectating');
    resetHudCache();
    resetAfkActivity();
    _afkTrackInit = false;
    resetReplayRecording();
    state = 'play';
    recordReplayFrame(true);
    saveReplayToStorage();
    show('hud');
    updateMatchIdWatermark();
    updateVoiceUI();
    updateCoopTeamHUD();
    if (Net && Net.isHost && Net.isHost() && Net.pushRoomHeartbeat) Net.pushRoomHeartbeat();
    ui.fadeIn(1.5);
    A.playMusic('explore', 3);
    windStrength = 1;
    A.setWind(ver.wind ? 0.26 : 0, 0.5);
    if (!(LO.admin && LO.admin.open)) lockPointer();
    setTimeout(() => {
      if (state !== 'play') return;
      showHint(`Photograph ${EVIDENCE_NEEDED} pieces of evidence. Raise your camera with ${LO.isTouch ? 'the CAMERA button' : 'RIGHT MOUSE or Q'}.`, 7000);
      A.say('player', 'Okay. Evidence. Footprints, wreckage, anything that proves that thing was here.');
    }, 1800);
  }

  function lockPointer() {
    if (LO.isTouch || chatOpen || (LO.admin && LO.admin.open)) return;
    const el = renderer.domElement;
    try {
      const p = el.requestPointerLock && el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* user gesture needed */ }
  }

  LO.pauseGame = () => pause();
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && (state === 'play' || state === 'spectate') && !coopMenuOpen && !chatOpen && !(LO.admin && LO.admin.open)) pause();
  });

  function pause() {
    // A dead co-op player can open the same menu while spectating a teammate.
    if (state !== 'play' && state !== 'spectate') return;
    closeChat(false);
    if (LO.admin && LO.admin.open) LO.admin.closePanel(true);
    if (Net && Net.isCoop()) {
      coopMenuOpen = true;
      player.enabled = false;
      player.mapOpen = false;
      show('map-overlay', false);
      document.body.classList.remove('map-open');
      show('pause');
      updateMatchIdWatermark();
      return;
    }
    state = 'paused';
    player.enabled = false;
    player.mapOpen = false;
    show('map-overlay', false);
    document.body.classList.remove('map-open');
    if (sneaky && sneaky.pause) sneaky.pause();
    clearGlitch();
    clearFlashStrobe();
    clearFallFx();
    show('pause');
    updateMatchIdWatermark();
    if (window.speechSynthesis) try { speechSynthesis.pause(); } catch (e) {}
    A.setFlashlightBuzz(false); A.setTenant(0); A.setSilentOne(0); A.setMothFlutter(0); A.setExposure(0);
    A.setBreathing && A.setBreathing(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.15);
    A.setEnvHum && A.setEnvHum(0);
  }
  function resume() {
    hideAllScreens();
    show('hud');
    if (Net && Net.isCoop()) {
      coopMenuOpen = false;
      const me = Net.getPlayer ? Net.getPlayer(Net.localId) : null;
      const localDead = !!(me && me.alive === false) || !!(player && player.alive === false) || !!Net.localHiddenAdmin;
      // Resuming from the pause menu must not put a dead player back in control.
      state = localDead ? 'spectate' : 'play';
      if (state === 'play') {
        player.enabled = true;
        lockPointer();
      } else {
        player.enabled = false;
        updateSpectateLabel();
      }
      updateMatchIdWatermark();
      return;
    }
    state = 'play';
    player.enabled = true;
    clock.getDelta();
    if (window.speechSynthesis) try { speechSynthesis.resume(); } catch (e) {}
    lockPointer();
  }

  // ---------- evidence ----------
  const EVIDENCE_LINES = [
    'Got it. They can\'t call that a gas leak.',
    'That\'s two. Keep going. Quietly.',
    'Three. Two more.',
    'Four. One more and I can call it in.',
    'That\'s five. That should do it.',
    'More proof. Good.',
  ];
  function onPhoto(ev) {
    if (V().photoStrobe) triggerFlashStrobe(0.92, 0.025, 0.155);
    else triggerFlashStrobe(0.85, 0.04, 0.36);
    pendingCapture = { ev };
    if (Net && Net.isClient()) Net.sendToHost({ type: 'remote_photo', id: Net.localId });
    else if (Net && Net.isHost()) Net.broadcast({ type: 'remote_photo', id: 'host' });
    if (!ev) return;
    if (Net && Net.isClient()) {
      if (!ev.found) {
        ev.found = true;
        A.evidenceSting();
        Net.sendToHost({ type: 'ev_found', evId: ev.id });
      }
      return;
    }
    if (ev.found) return;
    ev.found = true;
    evidenceCount++;
    lastEvidenceTime = gameTime;
    if (ev === hintTarget) hintTarget = null;
    A.evidenceSting();
    updateEvidenceUI();
    A.say('player', EVIDENCE_LINES[Math.min(EVIDENCE_LINES.length - 1, evidenceCount - 1)]);
    if (Net && Net.isHost()) {
      Net.broadcast({
        type: 'ev_sync',
        foundIds: world.evidence.filter(e => e.found).map(e => e.id),
        evidenceCount,
        evName: ev.name,
        finderName: Net.localName,
      });
      Net.pushRoomHeartbeat && Net.pushRoomHeartbeat();
    }
    if (evidenceCount >= EVIDENCE_NEEDED && !endingQueued) queueEnding();
  }

  function updateEvidenceUI() {
    $('ev-count').textContent = evidenceCount;
    $('ev-need').textContent = EVIDENCE_NEEDED;
    const list = $('ev-list');
    list.innerHTML = '';
    world.evidence.filter(e => e.found).forEach(e => {
      const d = document.createElement('div'); d.className = 'got'; d.textContent = e.name; list.appendChild(d);
    });
    const left = Math.max(0, EVIDENCE_NEEDED - evidenceCount);
    if (left) { const d = document.createElement('div'); d.textContent = `${left} more needed`; list.appendChild(d); }
  }

  function queueEnding() {
    endingQueued = true;
    // every entity except Siren Head is switched off while you wait for the police
    player.calm = true;
    player.noSilent = true;
    player.exposure = 0;
    if (fastone) fastone.clearHighlight();
    A.setTenant(0); A.setSilentOne(0); A.setMothFlutter(0); A.setExposure(0);
    if (Net && Net.isHost()) Net.broadcast({ type: 'ending_queue' });
    setTimeout(async () => {
      await A.say('player', 'That\'s enough. Sending everything to the county sheriff now.');
      await A.say('radio', 'Hollow Creek caller, we received your photos. Stay where you are. All units, heavy response to Hollow Creek. This is not a drill. I repeat, this is not a drill.');
      await A.say('player', 'They\'re coming. They\'re actually coming.');
      if (Net && Net.isHost()) {
        if (state === 'play' || state === 'spectate' || state === 'paused') {
          Net.broadcast({ type: 'ending_start' });
          startEnding();
        }
      } else if (!Net || Net.isSolo()) {
        if (state === 'play' || state === 'paused') startEnding();
      }
    }, 2500);
  }

  function startEnding() {
    if (sneaky) sneaky.reset();
    if (fastone) fastone.reset();
    if (moths) { moths.root.visible = false; A.setMothFlutter(0); }
    state = 'ending';
    coopMenuOpen = false;
    spectateId = null;
    document.body.classList.remove('spectating');
    const sb = $('spectate-bar'); if (sb) sb.classList.remove('show');
    closeChat(false);
    remotePlayers.forEach(rp => { rp.root.visible = false; if (rp.spot) rp.spot.intensity = 0; });
    player.enabled = false;
    player.mapOpen = false;
    show('map-overlay', false);
    const mb = $('map-hud-badge'); if (mb) mb.classList.remove('show', 'open');
    document.body.classList.remove('map-open', 'has-map');
    if (document.pointerLockElement) document.exitPointerLock();
    clearGlitch();
    clearFlashStrobe();
    clearFallFx();
    A.setFlashlightBuzz(false); A.setHeartbeat(0);
    A.setBreathing && A.setBreathing(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.15);
    A.setEnvHum && A.setEnvHum(0);
    player.flashOn = false; player.flash.intensity = 0;
    hideAllScreens();
    ui.fadeOut(1.5);
    setTimeout(() => {
      show('cutscene');
      document.querySelector('.skip-hint').style.display = 'none'; $('skip-bar').style.display = 'none';
      camera.fov = 60; camera.updateProjectionMatrix();
      cutCtx = makeCutCtx(() => { endCutscene(); rollCredits(); });
      cutscene = LO.Cutscenes.ending(cutCtx);
      worldDirty = true;
    }, 1600);
  }

  function rollCredits() {
    state = 'credits';
    hideAllScreens();
    show('credits');
    const roll = $('credits-roll');
    roll.classList.remove('rolling'); void roll.offsetWidth; roll.classList.add('rolling');
    ui.fadeIn(1);
    A.playMusic('ending', 2);
  }

  // ---------- death ----------
  let dieT = 0;
  let dieCause = 'siren', deathP = null;
  function startDeathSound() {
    deathP = LO.TVFX.profile(S.fastDeath);
    A.playDeathNoise(S.fastDeath);
  }
  // seconds since death, from the audio clock when possible so pictures and sound stay locked
  function deathClock(dt) { const a = A.deathElapsed(); return a !== null ? a : dieT + dt; }
  const DEATHS = {
    siren: { title: 'YOU WERE TOO LOUD', tips: [
      'He only hunts what he can hear. Stand still and switch off your light.',
      'Sprinting is the loudest thing you can do. Crouch-walk near him.',
      'Hide in dumpsters and lockers — inside, you make no sound at all.',
      'Watch the marker on the noise bar: it shows how close he is.',
      'Out of breath? Crouch to hold your breath.',
    ] },
    silent: { title: 'YOU WERE TOO QUIET', tips: [
      'The Silent One comes for anyone who stays silent for 30 seconds. Make a small sound — click your flashlight or take a step.',
      'Hiding is silent too. Don\'t wait out Siren Head forever.',
    ] },
    moth: { title: 'YOU STARED TOO LONG', tips: [
      'Moths shriek if your light stays on them for 2 seconds. Sweep your beam past them.',
      'A moth\'s shriek takes 10 HP and tells Siren Head exactly where to look.',
    ] },
    tenant: { title: 'YOU OVERSTAYED YOUR WELCOME', tips: [
      'The Tenant takes 30 HP every time it throws you out. Leave before the red bar fills.',
      'Your health never comes back. Every hit counts.',
    ] },
    sneaky: { title: 'NEVER LOOKED BACK', tips: [
      'When your flashlight flickers and you hear breathing behind you, turn around within ~2.5 seconds.',
    ] },
    exposure: { title: 'IN THE VIEWFINDER', tips: [
      'Do not keep your camera raised for too long. Lower it and use your flashlight to see.',
    ] },
    fastone: { title: 'TOO SLOW', tips: [
      'When The Fast One breaches the perimeter fence, sprint straight to the blue-outlined locker or dumpster.',
      'In the forest with nowhere to hide, look directly at The Fast One when it gets close to drive it back into the trees.',
      'If safety is far away, an adrenaline surge doubles your sprint speed.',
    ] },
    powerline: { title: 'HIGH VOLTAGE', tips: [
      'Downed power lines cycle every few seconds. Wait for the puddle glow and sparking buzz to fade before crossing.',
      'Getting shocked strips 42 HP and sends a loud crack echoing across Hollow Creek.',
    ] },
    beartrap: { title: 'CAUGHT IN THE JAWS', tips: [
      'Bear traps sit along woodland trails and forest edges. Watch your flashlight beam before sprinting off-road.',
      'Throw a rock ([G]) onto a bear trap to snap it shut safely from a distance.',
    ] },
    steam: { title: 'SCALDED', tips: [
      'Pressurized alley pipes hiss softly before erupting with boiling steam. Hold back for 3 seconds until the vent clears.',
    ] },
    fall: { title: 'FELL TO YOUR DEATH', tips: [
      'Drops over 2.5m hurt — 1F roofs bruise (~15 HP), while 2F roofs strip ~68 HP and towers are lethal.',
      'Use interior stairwells to climb down safely instead of leaping off high rooftops.',
    ] },
  };
  // death by damage (the Silent One / the Tenant)
  function clearGlitch() {
    const gr = document.getElementById('game-root');
    if (gr) gr.style.filter = '';
    const vf = $('viewfinder');
    if (vf) vf.style.opacity = '';
    lastRootFilter = '';
  }
  function clearFallFx() {
    _hc.fallOp = '';
    _hc.fallScale = '';
    const el = hudEl('fallFx', () => $('fall-fx'));
    if (el) {
      el.style.opacity = '0';
      el.style.transform = '';
    }
  }
  function checkMatchOver() {
    if (!Net || !Net.isHost || !Net.isHost() || !Net.inGame || coopTeamWiped) return false;
    if (state === 'ending' || state === 'credits' || state === 'dead' || state === 'replay' || state === 'title' || state === 'gate') {
      return false;
    }
    const livingConnectedPlayers = Net.getLivingConnectedPlayers
      ? Net.getLivingConnectedPlayers()
      : Net.players.filter(p => p && !p.left && !p.hiddenAdmin && p.alive !== false && (p.id === Net.localId || (Net.conns && Net.conns.has(p.id))));
    if (livingConnectedPlayers.length === 0) {
      coopTeamWiped = true;
      if (Net.broadcast) Net.broadcast({ type: 'team_wipe' });
      if (state === 'spectate' || state === 'paused' || coopMenuOpen) {
        coopMenuOpen = false;
        if ($('pause')) show('pause', false);
        showTeamWipeDeath();
      } else if (state !== 'dying') {
        showTeamWipeDeath();
      }
      return true;
    }
    return false;
  }

  function markLocalDeadInCoop(cause) {
    if (!Net || !Net.isCoop()) return;
    const me = Net.getPlayer(Net.localId);
    if (me) me.alive = false;
    if (Net.isClient()) Net.sendToHost({ type: 'player_dead', cause });
    else if (Net.isHost()) {
      Net.broadcast({ type: 'player_dead', id: 'host', cause });
      checkMatchOver();
    }
    updateCoopTeamHUD();
  }

  function dieBy(cause) {
    clearGlitch();
    clearFlashStrobe();
    clearFallFx();
    if (state === 'play' && (!Net || !Net.isCoop())) A.silenceWorld(true);
    if (sneaky && cause !== 'sneaky' && sneaky.attacking) sneaky.vanish(player, false);
    if (fastone && (!Net || !Net.isCoop())) { fastone.clearHighlight(); if (cause !== 'fastone') fastone.reset(); }
    else if (fastone) fastone.clearHighlight();
    if (state !== 'play') return;
    recordReplayFrame(true);
    saveReplayToStorage(cause);
    dieCause = cause;
    state = 'dying';
    coopMenuOpen = false;
    closeChat(false);
    dieT = 0;
    player.alive = false;
    player.adrenaline = 0;
    player.enabled = false;
    player.flashOn = false;
    player.mapOpen = false;
    show('map-overlay', false);
    document.body.classList.remove('map-open');
    markLocalDeadInCoop(cause);
    A.stopVoices();
    A.setBreathing && A.setBreathing(0);
    A.setTenant(0);
    if (document.pointerLockElement) document.exitPointerLock();
    A.playMusic(null, 0.5);
    startDeathSound();
    A.setMothFlutter(0);
  }
  function onCaught() {
    clearGlitch();
    clearFlashStrobe();
    clearFallFx();
    if (sneaky && sneaky.attacking) sneaky.vanish(player, false);
    if (fastone && (!Net || !Net.isCoop())) fastone.reset();
    if (state === 'play' && !siren.catchDisabled && (!Net || !Net.isCoop())) A.silenceWorld(true);
    if (state !== 'play' || siren.catchDisabled) return;
    recordReplayFrame(true);
    saveReplayToStorage('siren');
    dieCause = 'siren';
    state = 'dying';
    coopMenuOpen = false;
    closeChat(false);
    dieT = 0;
    player.alive = false;
    player.adrenaline = 0;
    player.enabled = false;
    player.flashOn = false;
    player.mapOpen = false;
    show('map-overlay', false);
    document.body.classList.remove('map-open');
    markLocalDeadInCoop('siren');
    A.stopVoices();
    A.setBreathing && A.setBreathing(0);
    if (document.pointerLockElement) document.exitPointerLock();
    if (!Net || !Net.isCoop()) {
      siren.scripted = true;
      siren.forceLean = 0.95;
      siren.glowOverride = 1;
      siren.speedNow = 0;
      siren.yaw = Math.atan2(player.pos.x - siren.pos.x, player.pos.z - siren.pos.z);
    }
    startDeathSound();
    A.playMusic(null, 0.5);
  }
  const _dieMat = new THREE.Matrix4(), _dieQuat = new THREE.Quaternion(), _dieUp = new THREE.Vector3(0, 1, 0);
  function updateDying(dt) {
    dieT = deathClock(dt);
    const P = deathP || LO.TVFX.profile(S.fastDeath);
    LO.TVFX.dying(dieT, dieCause, P);    // red flood + the creature, red static, grey static
    if (dieCause !== 'siren' || (Net && Net.isCoop())) {
      // collapse to the ground (in co-op, Siren Head stays live for surviving teammates)
      const k = Math.min(1, dieT / 1.4);
      camera.position.y = Math.max(0.25, camera.position.y - dt * 1.4);
      camera.rotation.z = k * 1.2;
      camera.rotation.x = player.pitch * (1 - k) + 0.2 * k;
      if (dieT > P.end) finishDeath();
      return;
    }
    siren.neckDip = Math.min(1, dieT) * -0.5;
    siren.update(dt, null, dieT);
    const hp = siren.headWorldPos();
    const cam = camera;
    cam.position.set(player.pos.x + (Math.random() - 0.5) * 0.15, 1.4 + Math.min(1, dieT) * 0.6, player.pos.z + (Math.random() - 0.5) * 0.15);
    _dieMat.lookAt(cam.position, hp, _dieUp);
    _dieQuat.setFromRotationMatrix(_dieMat);
    cam.quaternion.slerp(_dieQuat, Math.min(1, dt * 6));
    if (dieT > P.end && state === 'dying') finishDeath();
  }
  function enterSpectate(targetId) {
    state = 'spectate';
    remotePlayers.forEach(rp => { rp.firstPersonHidden = false; });
    spectateId = targetId;
    LO.TVFX.clear();
    hideAllScreens();
    show('hud');
    document.body.classList.add('spectating');
    const sb = $('spectate-bar');
    if (sb) sb.classList.add('show');
    A.silenceWorld(false);
    A.setSilentOne(0); A.setExposure(0); A.setMothFlutter(0); A.setTenant(0);
    A.setFlashlightBuzz(false); A.setBreathing && A.setBreathing(0);
    A.setStillness(false); document.body.classList.remove('still');
    $('silent-one').style.opacity = 0;
    $('damage').style.opacity = 0;
    $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
    updateSpectateLabel();
    updateCoopTeamHUD();
    updateMatchIdWatermark();
  }

  function updateSpectateLabel() {
    const el = $('spec-target');
    if (!el) return;
    const mate = spectateId && Net ? Net.getPlayer(spectateId) : null;
    const rp = spectateId ? remotePlayers.get(spectateId) : null;
    const hpTxt = rp ? ` (${Math.max(0, Math.round(rp.health))} HP)` : '';
    const prefix = (Net && Net.localHiddenAdmin) ? 'ADMIN SPECTATING (HIDDEN): ' : 'SPECTATING: ';
    const nextTxt = mate ? `${prefix}${mate.name.toUpperCase()}${hpTxt}` : 'SPECTATING TEAMMATE';
    if (nextTxt !== lastSpecLabelText) {
      lastSpecLabelText = nextTxt;
      el.textContent = nextTxt;
    }
  }

  function cycleSpectate(dir) {
    if (state !== 'spectate' || !Net) return;
    // Only living, connected teammates can be spectated.
    const alive = Net.getLivingConnectedPlayers
      ? Net.getLivingConnectedPlayers().filter(p => p.id !== Net.localId)
      : Net.players.filter(p => p.alive !== false && !p.left && !p.hiddenAdmin && p.id !== Net.localId);
    if (!alive.length) {
      if (Net.isHost && Net.isHost()) checkMatchOver();
      return;
    }
    const curIdx = alive.findIndex(p => p.id === spectateId);
    const nextIdx = curIdx < 0
      ? (dir < 0 ? alive.length - 1 : 0)
      : (curIdx + (dir || 1) + alive.length) % alive.length;
    if (spectateId && remotePlayers.has(spectateId)) remotePlayers.get(spectateId).firstPersonHidden = false;
    spectateId = alive[nextIdx].id;
    lastSpecLabelText = '';
    updateSpectateLabel();
  }

  function showTeamWipeDeath() {
    coopTeamWiped = true;
    state = 'dead';
    updateMatchIdWatermark();
    if (Net && Net.isHost && Net.isHost() && Net.pushRoomHeartbeat) Net.pushRoomHeartbeat();
    deathShown = false;
    spectateId = null;
    document.body.classList.remove('spectating');
    const sb = $('spectate-bar'); if (sb) sb.classList.remove('show');
    A.silenceWorld(true);
    A.setSilentOne(0); A.setExposure(0); A.setMothFlutter(0); A.setTenant(0);
    A.setBreathing && A.setBreathing(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.15);
    A.setEnvHum && A.setEnvHum(0);
    A.setStillness(false); document.body.classList.remove('still');
    $('silent-one').style.opacity = 0;
    const retryBtn = document.querySelector('#death button[data-action="retry"]');
    if (retryBtn) {
      retryBtn.style.display = (Net && Net.isClient()) ? 'none' : '';
    }
    syncDeathReplayButton();
    const deathEl = $('death');
    if (!V().deathRoom) {
      LO.TVFX.clear();
      hideAllScreens();
      deathEl.classList.add('legacy');
      const D = DEATHS[dieCause] || DEATHS.siren;
      $('death-title').textContent = D.title;
      $('death-tip').textContent = D.tips[(Math.random() * D.tips.length) | 0] || '';
      show('death');
      syncDeathReplayButton();
      $('damage').style.opacity = 0;
      $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
      A.playMusic('title', 1.5);
      A.stopRinging();
      return;
    }
    deathEl.classList.remove('legacy');
    LO.TVFX.off(() => {
      hideAllScreens();
      show('death');
      syncDeathReplayButton();
      $('damage').style.opacity = 0;
      deathRoom.show(dieCause);
      deathShown = true;
      A.playMusic(null, 0.3);
      A.stopRinging();
      if (!Net || !Net.isCoop()) {
        const kickToTitle = () => {
          if (state !== 'dead') return;
          ui.fadeOut(0.25);
          setTimeout(goTitle, 300);
        };
        clearTimeout(deathTimer);
        if (!A.playDeathMusic(kickToTitle)) deathTimer = setTimeout(kickToTitle, 58000);
      } else {
        A.playDeathMusic(() => {});
      }
      $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
    }, null, (() => { const P = deathP || LO.TVFX.profile(S.fastDeath); const now = A.deathElapsed(); return now === null ? P.roomAt - P.end - 0.16 : P.roomAt - now - 0.16; })());
  }

  function finishDeath() {
    {
      if (state !== 'dying') return;
      if (Net && Net.isCoop()) {
        if (Net.isHost()) checkMatchOver();
        if (coopTeamWiped) {
          showTeamWipeDeath();
          return;
        }
        const aliveMates = Net.getLivingConnectedPlayers
          ? Net.getLivingConnectedPlayers().filter(p => p.id !== Net.localId)
          : Net.players.filter(p => p.alive !== false && !p.left && !p.hiddenAdmin && p.id !== Net.localId);
        if (aliveMates.length > 0 && !coopTeamWiped) {
          enterSpectate(aliveMates[0].id);
          return;
        }
        if (Net.isHost() && !coopTeamWiped) {
          coopTeamWiped = true;
          Net.broadcast({ type: 'team_wipe' });
        }
        showTeamWipeDeath();
        return;
      }
      const retryBtn = document.querySelector('#death button[data-action="retry"]');
      if (retryBtn) retryBtn.style.display = '';
      state = 'dead';
      syncDeathReplayButton();
      deathShown = false;
      A.setSilentOne(0); A.setExposure(0); A.setMothFlutter(0); A.setTenant(0);
      A.setBreathing && A.setBreathing(0);
      A.setProximityAmbient && A.setProximityAmbient(0);
      A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
      A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.15);
      A.setEnvHum && A.setEnvHum(0);
      A.setStillness(false); document.body.classList.remove('still');
      $('silent-one').style.opacity = 0;
      const deathEl = $('death');
      if (!V().deathRoom) {
        LO.TVFX.clear();
        hideAllScreens();
        deathEl.classList.add('legacy');
        const D = DEATHS[dieCause] || DEATHS.siren;
        $('death-title').textContent = D.title;
        $('death-tip').textContent = D.tips[(Math.random() * D.tips.length) | 0] || '';
        show('death');
        syncDeathReplayButton();
        $('damage').style.opacity = 0;
        $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
        A.playMusic('title', 1.5);
        A.stopRinging();
        return;
      }
      deathEl.classList.remove('legacy');
      // the picture switches off like an old TV, then flicks back on in the death room
      LO.TVFX.off(() => {
        hideAllScreens();
        show('death');
        syncDeathReplayButton();
        $('damage').style.opacity = 0;
        deathRoom.show(dieCause);
        deathShown = true;
        A.playMusic(null, 0.3);
        A.stopRinging();
        const kickToTitle = () => {
          if (state !== 'dead') return;
          ui.fadeOut(0.25);
          setTimeout(goTitle, 300);
        };
        clearTimeout(deathTimer);
        if (!A.playDeathMusic(kickToTitle)) deathTimer = setTimeout(kickToTitle, 58000);
        $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
      }, null, (() => { const P = deathP || LO.TVFX.profile(S.fastDeath); const now = A.deathElapsed(); return now === null ? P.roomAt - P.end - 0.16 : P.roomAt - now - 0.16; })());
    }
  }

  // ---------- wind: dies completely after 15 seconds of silence ----------
  const WIND_STOP = 15;
  let windStrength = 1, gustT = 0;
  function updateWindState(dt) {
    const ver = V();
    if (!ver.wind) {
      A.setWind(0, 0, 1.2);
      A.setForestWindRustle && A.setForestWindRustle(0, 0, 0, 0.2);
      A.setStillness(false);
      document.body.classList.remove('still');
      world.updateWind(dt, 0.35, camera.position, gameTime);
      return;
    }
    const still = ver.windStillness && player.silentTime >= WIND_STOP;
    const target = still ? 0 : 1;
    // it stops quickly and eerily, and comes back gradually
    windStrength += (target - windStrength) * Math.min(1, dt * (still ? 2.5 : 0.6));
    if (windStrength < 0.01) windStrength = 0;
    gustT += dt;
    const gust = Math.max(0, Math.min(1, 0.45 + Math.sin(gustT * 0.31) * 0.3 + Math.sin(gustT * 0.83 + 1.7) * 0.25));
    A.setWind(still ? 0 : 0.26 * windStrength, gust, still ? 0.01 : 1.2);
    A.setForestWindRustle && A.setForestWindRustle(still ? 0 : windStrength, gust, world.forestProximity ? world.forestProximity(player.pos) : 0, still ? 0.01 : 0.75);
    // when the wind dies, everything else dies with it: sounds, voices, text
    A.setStillness(still);
    document.body.classList.toggle('still', still);
    world.updateWind(dt, windStrength * (0.6 + gust * 0.6), camera.position, gameTime);
  }

  // ============================================================
  //  HUD
  // ============================================================
  const STATUS_TEXT = {
    calm: 'HE CAN\'T HEAR YOU', heard: 'HE HEARD SOMETHING', searching: 'HE\'S SEARCHING — STAY SILENT',
    angry: 'HE\'S ANGRY — GO SILENT!', hidden: 'HIDDEN — YOU MAKE NO SOUND',
  };
  let lastStatus = '', lastRootFilter = '', lastHideType = '';
  const _hud = {};
  const _hc = {
    hasMap: null, mapOpen: null, noiseW: '', markLeft: '', stamW: '',
    stamTired: null, stamCrit: null, stamLow: null, batW: '', batLow: null,
    prompt: null, crossDisp: '', hpW: '', hpNum: '', hpLow: null, hpBeat: null,
    vfOpen: null, vfLocked: null, vfInfo: '', vfFilm: '', vfFlareVis: null, subMode: '', fallOp: '', fallScale: ''
  };
  const _flPos = new THREE.Vector3(), _flDir = new THREE.Vector3(), _flCamDir = new THREE.Vector3();
  const _flProj = new THREE.Vector3(), _flBounceHit = new THREE.Vector3();
  const _flRay = new THREE.Raycaster();
  const _flState = {
    int: 0, x: 0, y: 0, r: 255, g: 224, b: 178, s: 1,
    occT: 0, bounceT: 0, lampClear: false, moonClear: false,
    lastLamp: null, bounceValid: false, bounceDist: 99,
  };
  const _strobe = { active: false, justTriggered: false, elapsed: 0, peak: 0.92, hold: 0.025, fade: 0.155 };
  function triggerFlashStrobe(peak, hold, fade) {
    _strobe.active = true;
    _strobe.justTriggered = true;
    _strobe.elapsed = 0;
    _strobe.peak = peak !== undefined ? peak : 0.92;
    _strobe.hold = hold !== undefined ? hold : 0.025;
    _strobe.fade = fade !== undefined ? fade : 0.155;
  }
  function clearFlashStrobe() {
    _strobe.active = false;
    _strobe.justTriggered = false;
    _strobe.elapsed = 0;
    const f = hudEl('flash', () => $('flash'));
    if (f) f.style.opacity = '0';
  }
  function updateFlashStrobe(dt) {
    if (!_strobe.active) return;
    const f = hudEl('flash', () => $('flash'));
    if (!f) { _strobe.active = false; return; }
    if (_strobe.justTriggered) {
      _strobe.justTriggered = false;
      f.style.opacity = _strobe.peak.toFixed(3);
      return;
    }
    _strobe.elapsed += dt;
    if (_strobe.elapsed <= _strobe.hold) {
      f.style.opacity = _strobe.peak.toFixed(3);
      return;
    }
    const u = Math.min(1, (_strobe.elapsed - _strobe.hold) / Math.max(0.01, _strobe.fade));
    if (u >= 1) {
      _strobe.active = false;
      f.style.opacity = '0';
      return;
    }
    const op = _strobe.peak * Math.pow(1 - u, 2.4);
    f.style.opacity = op.toFixed(3);
  }
  function resetFlareState() {
    _flState.int = 0; _flState.x = 0; _flState.y = 0; _flState.s = 1;
    _flState.occT = 0; _flState.bounceT = 0; _flState.lastLamp = null;
    _flState.lampClear = false; _flState.moonClear = false; _flState.bounceValid = false;
    const fl = hudEl('vfFlare', () => $('vf-flare'));
    if (fl) fl.style.opacity = '0';
  }
  function updateViewfinderFlare(dt, active) {
    const fl = hudEl('vfFlare', () => $('vf-flare'));
    if (!fl) return;
    if (!active) {
      if (_hc.vfFlareVis !== false) {
        _hc.vfFlareVis = false;
        _flState.int = 0;
        fl.style.opacity = '0';
      }
      return;
    }
    camera.getWorldDirection(_flCamDir);
    let bestInt = 0, bestX = 0, bestY = 0, bestR = 255, bestG = 224, bestB = 178, bestS = 1;

    // 1. Camera shutter flash burst
    const burst = player.burst ? player.burst.intensity : 0;
    if (burst > 0.15) {
      const bi = Math.min(1, burst / 10) * 0.94;
      bestInt = bi; bestX = 0; bestY = 0; bestR = 236; bestG = 245; bestB = 255; bestS = 1.45;
    }

    // 2. Flashlight bounce glare & lens scatter
    if (player.flashOn && !player.hidden && player.flash && player.flash.intensity > 0.05) {
      const fNorm = Math.min(1.15, player.flash.intensity / (LO.settings.lighting === 'simple' ? 3 : 8));
      // Subtle ambient lens scatter from handheld beam
      const baseInt = fNorm * 0.16;
      const gx = 0.18 + (player.swayX || 0) * 0.05;
      const gy = -0.14 + (player.swayY || 0) * 0.04;
      if (baseInt > bestInt) {
        bestInt = baseInt; bestX = gx; bestY = gy; bestR = 255; bestG = 236; bestB = 198; bestS = 0.72;
      }
      // Wall / prop specular bounce check (throttled ~20 Hz)
      _flState.bounceT -= dt;
      if (_flState.bounceT <= 0 && world && world.occluders && world.occluders.length) {
        _flState.bounceT = 0.05;
        player.flash.getWorldPosition(_flPos);
        player.flashTarget.getWorldPosition(_flDir);
        _flDir.sub(_flPos).normalize();
        _flRay.set(_flPos, _flDir);
        _flRay.far = 12.0;
        const bx = _flPos.x + _flDir.x * 12.0, bz = _flPos.z + _flDir.z * 12.0;
        const occl = world.queryOccluders ? world.queryOccluders(_flPos.x, _flPos.z, bx, bz) : world.occluders;
        const hits = occl.length ? _flRay.intersectObjects(occl, false) : [];
        if (hits.length && hits[0].distance < 11.5) {
          _flState.bounceValid = true;
          _flState.bounceDist = hits[0].distance;
          _flBounceHit.copy(hits[0].point);
        } else {
          _flState.bounceValid = false;
        }
      }
      if (_flState.bounceValid) {
        _flProj.copy(_flBounceHit).project(camera);
        if (_flProj.z < 1 && Math.abs(_flProj.x) <= 1.15 && Math.abs(_flProj.y) <= 1.15) {
          const prox = Math.pow(Math.max(0, 1 - _flState.bounceDist / 11.5), 1.35);
          const edge = Math.max(0.2, 1 - Math.hypot(_flProj.x, _flProj.y) * 0.45);
          const bInt = Math.min(0.86, prox * edge * fNorm * 0.85);
          if (bInt > bestInt) {
            bestInt = bInt; bestX = _flProj.x; bestY = _flProj.y;
            bestR = 255; bestG = 232; bestB = 186; bestS = 0.95 + prox * 0.55;
          }
        }
      }
    } else {
      _flState.bounceValid = false;
    }

    // 3. External light sources: lit/flickering streetlamps & moonlight
    _flState.occT -= dt;
    const doOcc = _flState.occT <= 0;
    if (doOcc) _flState.occT = 0.06;

    if (world && world.flickers && world.flickers.length) {
      let cand = null, candScore = 0, candNx = 0, candNy = 0, candDist = 999;
      for (let i = 0; i < world.flickers.length; i++) {
        const f = world.flickers[i];
        if (!f.light || f.light.intensity <= 0.08) continue;
        _flPos.copy(f.light.position).sub(camera.position);
        const dist = _flPos.length();
        if (dist < 0.8 || dist > 68) continue;
        _flDir.copy(_flPos).divideScalar(dist);
        const dot = _flDir.dot(_flCamDir);
        if (dot <= 0.35) continue;
        _flProj.copy(f.light.position).project(camera);
        if (_flProj.z >= 1 || Math.abs(_flProj.x) > 1.2 || Math.abs(_flProj.y) > 1.2) continue;
        const centerW = Math.max(0, 1 - Math.hypot(_flProj.x, _flProj.y) * 0.55);
        const distW = Math.pow(1 - dist / 68, 1.15);
        const lInt = Math.min(1, f.light.intensity / 1.4);
        const sc = distW * (0.35 + centerW * 0.65) * lInt;
        if (sc > candScore) {
          candScore = sc; cand = f; candNx = _flProj.x; candNy = _flProj.y; candDist = dist;
        }
      }
      if (cand) {
        if (cand !== _flState.lastLamp || doOcc) {
          _flState.lastLamp = cand;
          const lp = cand.light.position;
          if (world.segmentHitsTree && world.segmentHitsTree(camera.position.x, camera.position.z, lp.x, lp.z)) {
            _flState.lampClear = false;
          } else {
            _flPos.copy(lp).sub(camera.position).normalize();
            _flRay.set(camera.position, _flPos);
            _flRay.far = Math.max(0.5, candDist - 1.4);
            const occl = world.queryOccluders
              ? world.queryOccluders(camera.position.x, camera.position.z, lp.x, lp.z)
              : world.occluders;
            const hits = (occl && occl.length) ? _flRay.intersectObjects(occl, false) : [];
            _flState.lampClear = hits.length === 0;
          }
        }
        if (_flState.lampClear) {
          const lInt = Math.min(0.88, candScore * 0.92);
          if (lInt > bestInt) {
            bestInt = lInt; bestX = candNx; bestY = candNy;
            bestR = 255; bestG = 204; bestB = 132; bestS = 0.9 + candScore * 0.5;
          }
        }
      } else {
        _flState.lastLamp = null;
        _flState.lampClear = false;
      }
    }

    if (world && world.moon && world.moon.visible) {
      _flPos.copy(world.moon.position).sub(camera.position).normalize();
      const mDot = _flPos.dot(_flCamDir);
      if (mDot > 0.42) {
        _flProj.copy(world.moon.position).project(camera);
        if (_flProj.z < 1 && Math.abs(_flProj.x) <= 1.15 && Math.abs(_flProj.y) <= 1.15) {
          if (doOcc) {
            const mx = camera.position.x + _flPos.x * 160, mz = camera.position.z + _flPos.z * 160;
            if (world.segmentHitsTree && world.segmentHitsTree(camera.position.x, camera.position.z, mx, mz)) {
              _flState.moonClear = false;
            } else {
              _flRay.set(camera.position, _flPos);
              _flRay.far = 160;
              const occl = world.queryOccluders
                ? world.queryOccluders(camera.position.x, camera.position.z, mx, mz)
                : world.occluders;
              const hits = (occl && occl.length) ? _flRay.intersectObjects(occl, false) : [];
              _flState.moonClear = hits.length === 0;
            }
          }
          if (_flState.moonClear) {
            const cW = Math.max(0, 1 - Math.hypot(_flProj.x, _flProj.y) * 0.5);
            const mInt = 0.24 + cW * 0.34;
            if (mInt > bestInt) {
              bestInt = mInt; bestX = _flProj.x; bestY = _flProj.y;
              bestR = 194; bestG = 216; bestB = 255; bestS = 0.95 + cW * 0.35;
            }
          }
        }
      }
    }

    const rate = bestInt > _flState.int ? 22 : 12;
    const k = Math.min(1, (dt || 0.016) * rate);
    _flState.int += (bestInt - _flState.int) * k;
    const pk = Math.min(1, (dt || 0.016) * 18);
    _flState.x += (bestX - _flState.x) * pk;
    _flState.y += (bestY - _flState.y) * pk;
    _flState.r += (bestR - _flState.r) * pk;
    _flState.g += (bestG - _flState.g) * pk;
    _flState.b += (bestB - _flState.b) * pk;
    _flState.s += (bestS - _flState.s) * pk;

    if (_flState.int < 0.015) {
      if (_hc.vfFlareVis !== false) { _hc.vfFlareVis = false; fl.style.opacity = '0'; }
      return;
    }
    _hc.vfFlareVis = true;
    const hw = window.innerWidth * 0.5, hh = window.innerHeight * 0.5;
    const px = _flState.x * hw;
    const py = -_flState.y * hh;
    fl.style.opacity = Math.min(0.95, _flState.int).toFixed(3);
    fl.style.setProperty('--fx', px.toFixed(1) + 'px');
    fl.style.setProperty('--fy', py.toFixed(1) + 'px');
    fl.style.setProperty('--gx1', (-px * 0.42).toFixed(1) + 'px');
    fl.style.setProperty('--gy1', (-py * 0.42).toFixed(1) + 'px');
    fl.style.setProperty('--gx2', (-px * 0.88).toFixed(1) + 'px');
    fl.style.setProperty('--gy2', (-py * 0.88).toFixed(1) + 'px');
    fl.style.setProperty('--gx3', (px * 0.34).toFixed(1) + 'px');
    fl.style.setProperty('--gy3', (py * 0.34).toFixed(1) + 'px');
    fl.style.setProperty('--flare-rgb', `${Math.round(_flState.r)}, ${Math.round(_flState.g)}, ${Math.round(_flState.b)}`);
    fl.style.setProperty('--bloom-s', _flState.s.toFixed(2));
    fl.style.setProperty('--streak-s', (0.75 + _flState.int * 0.7).toFixed(2));
  }
  function hudEl(key, getter) { return _hud[key] || (_hud[key] = getter()); }
  function resetHudCache() {
    for (const k in _hc) _hc[k] = null;
    _hc.noiseW = _hc.markLeft = _hc.stamW = _hc.batW = _hc.crossDisp = _hc.hpW = _hc.hpNum = _hc.vfInfo = _hc.vfFilm = _hc.subMode = _hc.fallOp = _hc.fallScale = '';
    lastStatus = ''; lastHideType = '';
    resetFlareState();
    clearFlashStrobe();
    clearFallFx();
    const hpBar = $('health-fill') && $('health-fill').parentNode;
    if (hpBar) {
      hpBar.classList.remove('low');
      if (hpBar.parentNode) hpBar.parentNode.classList.remove('health-crit');
    }
  }
  function updateHUD(dt) {
    const verNow = V();
    const hasMap = !!(player.hasMap && verNow.townMap);
    const mapOpen = !!(player.mapOpen && hasMap);
    if (_hc.hasMap !== hasMap) {
      _hc.hasMap = hasMap;
      document.body.classList.toggle('has-map', hasMap);
      const badge = hudEl('badge', () => $('map-hud-badge'));
      if (badge) badge.classList.toggle('show', hasMap);
    }
    if (_hc.mapOpen !== mapOpen) {
      _hc.mapOpen = mapOpen;
      document.body.classList.toggle('map-open', mapOpen);
      const badge = hudEl('badge', () => $('map-hud-badge'));
      if (badge) badge.classList.toggle('open', mapOpen);
      show('map-overlay', mapOpen);
    }
    if (mapOpen && LO.Map) {
      let rpList = null;
      if (Net && Net.isCoop()) {
        _rpList.length = 0;
        remotePlayers.forEach(rp => _rpList.push(rp));
        rpList = _rpList;
      }
      LO.Map.draw({
        world,
        player,
        remotePlayers: rpList,
        hintTarget,
        evidenceCount,
        evidenceNeeded: EVIDENCE_NEEDED,
        forestRing: !!verNow.forestRing,
        hazards: (hazards && verNow.hazards && !(LO.admin && LO.admin.noHazards)) ? hazards.list : null,
      });
    }

    const noiseW = Math.min(100, player.noiseRadius / 50 * 100).toFixed(1) + '%';
    if (noiseW !== _hc.noiseW) { _hc.noiseW = noiseW; hudEl('noiseFill', () => $('noise-fill')).style.width = noiseW; }

    const d = siren.distToPlayer || 999;
    const markLeft = Math.min(99, d / 50 * 100).toFixed(1) + '%';
    if (markLeft !== _hc.markLeft) { _hc.markLeft = markLeft; hudEl('barMark', () => $('bars').querySelector('.bar-mark')).style.left = markLeft; }

    const stamW = player.stamina.toFixed(1) + '%';
    const stamBar = hudEl('stamBar', () => $('stamina-fill').parentNode);
    if (stamW !== _hc.stamW) { _hc.stamW = stamW; hudEl('stamFill', () => $('stamina-fill')).style.width = stamW; }
    const isTired = !!(player.exhausted || player.windedTimer > 0);
    const isCrit = !isTired && player.stamina <= 25;
    const isStamLow = !isTired && player.stamina > 25 && player.stamina <= 55;
    if (isTired !== _hc.stamTired) { _hc.stamTired = isTired; stamBar.classList.toggle('tired', isTired); }
    if (isCrit !== _hc.stamCrit) { _hc.stamCrit = isCrit; stamBar.classList.toggle('critical', isCrit); }
    if (isStamLow !== _hc.stamLow) { _hc.stamLow = isStamLow; stamBar.classList.toggle('low', isStamLow); }

    const batW = player.battery.toFixed(1) + '%';
    if (batW !== _hc.batW) { _hc.batW = batW; hudEl('batFill', () => $('battery-fill')).style.width = batW; }
    const batLow = player.battery < 15;
    if (batLow !== _hc.batLow) { _hc.batLow = batLow; hudEl('batBar', () => $('battery-fill').parentNode).classList.toggle('low', batLow); }

    const st = siren.status(player);
    if (st !== lastStatus) {
      lastStatus = st;
      hudEl('shStatus', () => $('sh-status')).className = st;
      hudEl('shText', () => $('sh-text')).textContent = STATUS_TEXT[st];
    }
    if (player.prompt !== _hc.prompt) {
      _hc.prompt = player.prompt;
      hudEl('prompt', () => $('prompt')).innerHTML = player.prompt;
    }
    const crossDisp = (player.cameraUp || mapOpen) ? 'none' : 'block';
    if (crossDisp !== _hc.crossDisp) {
      _hc.crossDisp = crossDisp;
      hudEl('crosshair', () => $('crosshair')).style.display = crossDisp;
    }
    const hideEl = hudEl('hideEl', () => $('hide-overlay'));
    show('hide-overlay', !!player.hideView);
    const hideType = player.hideView ? (player.hideSpotType || 'locker') : '';
    if (hideType !== lastHideType) {
      lastHideType = hideType;
      hideEl.classList.toggle('type-locker', hideType === 'locker');
      hideEl.classList.toggle('type-dumpster', hideType === 'dumpster');
    }
    // the Tenant grows restless the longer you hide
    const tf = Math.min(1, player.hideTime / LO.TENANT_LIMIT);
    let tenantEye = 0;
    if (player.hidden) {
      // a red eye opens in the dark and keeps coming closer until it reaches you
      tenantEye = Math.max(0, (tf - 0.25) / 0.75);
      const ex = hudEl('tenantEye', () => $('tenant-eye'));
      ex.style.opacity = tenantEye > 0 ? Math.min(1, 0.35 + tenantEye) : 0;
      ex.style.transform = `translate(-50%, -50%) scale(${(0.18 + Math.pow(tenantEye, 1.6) * 3.6).toFixed(3)})`;
      hudEl('tenantRed', () => $('tenant-red')).style.opacity = (Math.pow(tenantEye, 1.3) * 0.95).toFixed(3);
      hudEl('hideText', () => $('hide-text')).textContent = tenantEye > 0 ? 'Get out of there' : 'HIDING — press E to leave';
      hideEl.classList.toggle('restless', tenantEye > 0.6);
      A.setTenant(Math.max(0, (tf - 0.3) / 0.7));
    } else {
      A.setTenant(0);
    }

    // the Exposure, seen only through the viewfinder
    const ex = hudEl('exposure', () => $('exposure'));
    const ek = Math.max(0, Math.min(1, (player.exposure - LO.EXPO.SHOW) / (LO.EXPO.LUNGE - LO.EXPO.SHOW)));
    if (player.zoom > 0.5 && player.exposure >= LO.EXPO.SHOW - 0.5) {
      ex.style.opacity = 0.25 + ek * 0.75;
      ex.style.setProperty('--s', (0.3 + ek * 1.2).toFixed(3));
      ex.style.setProperty('--b', (6 - ek * 4).toFixed(1) + 'px');
      ex.classList.toggle('twitch', ek > 0.6);
      A.setExposure(0.2 + ek * 0.8);
    } else {
      if (ex.style.opacity !== '0') ex.style.opacity = 0;
      ex.classList.remove('twitch');
      A.setExposure(0);
    }

    // health + accelerating heartbeat pulse below 30%
    const hpVal = Math.max(0, Math.min(100, player.health));
    const hpW = hpVal.toFixed(1) + '%';
    const hpCeil = Math.ceil(hpVal);
    const hpNum = String(hpCeil);
    const hpLow = hpVal > 0 && hpVal < 30;
    const hpBar = hudEl('hpBar', () => $('health-fill').parentNode);
    const hpRow = hudEl('hpRow', () => hpBar.parentNode);
    if (hpW !== _hc.hpW) { _hc.hpW = hpW; hudEl('hpFill', () => $('health-fill')).style.width = hpW; }
    if (hpNum !== _hc.hpNum) { _hc.hpNum = hpNum; hudEl('hpNum', () => $('health-num')).textContent = hpNum; }
    if (hpLow !== _hc.hpLow) {
      _hc.hpLow = hpLow;
      hpBar.classList.toggle('low', hpLow);
      if (hpRow) hpRow.classList.toggle('health-crit', hpLow);
    }
    const hbBeat = hpLow ? hpCeil : -1;
    if (hbBeat !== _hc.hpBeat) {
      _hc.hpBeat = hbBeat;
      if (hpLow) {
        const t = Math.max(0, Math.min(1, (30 - hpVal) / 29));
        const dur = (1.05 - t * 0.63).toFixed(2) + 's';
        const scale = (1.10 + t * 0.28).toFixed(3);
        const glow = (6 + t * 18).toFixed(1) + 'px';
        const bright = (1.2 + t * 0.65).toFixed(2);
        const target = hpRow || hpBar;
        target.style.setProperty('--hb-dur', dur);
        target.style.setProperty('--hb-scale', scale);
        target.style.setProperty('--hb-glow', glow);
        target.style.setProperty('--hb-bright', bright);
      }
    }

    // the Silent One: warnings from 20s of silence, attack from 30s
    const st2 = player.silentTime, W2 = LO.SILENT.WARN, AT = LO.SILENT.ATTACK;
    const so = hudEl('silentOne', () => $('silent-one'));
    if (st2 >= W2) {
      const k = Math.min(1, (st2 - W2) / (AT - W2));
      const attacking = st2 >= AT;
      so.style.opacity = attacking ? 1 : 0.25 + k * 0.6;
      so.classList.toggle('attack', attacking);
      so.style.setProperty('--k', k);
      hudEl('soText', () => $('so-text')).textContent = attacking ? 'MAKE A SOUND' : k < 0.5 ? 'it\'s too quiet...' : 'something is standing very close to you...';
      A.setSilentOne(attacking ? 1 : 0.2 + k * 0.6);
    } else {
      if (so.style.opacity !== '0') so.style.opacity = 0;
      so.classList.remove('attack');
      A.setSilentOne(0);
    }
    const vfOpen = player.zoom > 0.5;
    if (vfOpen !== _hc.vfOpen) { _hc.vfOpen = vfOpen; show('viewfinder', vfOpen); }
    // the Sneaky One makes your camera glitch too, and Siren Head smashes cause dizziness blur
    const glitch = !!(sneaky && sneaky.attacking && vfOpen);
    const vfEl = hudEl('viewfinder', () => $('viewfinder'));
    vfEl.style.opacity = glitch ? (Math.random() < 0.4 ? 0.15 : 1) : '';
    const rootEl = hudEl('gameRoot', () => document.getElementById('game-root'));
    const nextFilter = (glitch && Math.random() < 0.3) ? 'brightness(0.15) contrast(1.6)' : '';
    if (nextFilter !== lastRootFilter) {
      lastRootFilter = nextFilter;
      rootEl.style.filter = nextFilter;
    }
    if (vfOpen) {
      const vf = player.vfTarget;
      const locked = !!(vf && vf.ok);
      const vfInfo = !vf ? 'NO SUBJECT' : vf.ok ? 'EVIDENCE: ' + vf.ev.name.toUpperCase() : 'MOVE CLOSER';
      const vfFilm = `EVIDENCE ${evidenceCount}/${EVIDENCE_NEEDED}`;
      if (locked !== _hc.vfLocked) { _hc.vfLocked = locked; vfEl.classList.toggle('locked', locked); }
      if (vfInfo !== _hc.vfInfo) { _hc.vfInfo = vfInfo; hudEl('vfInfo', () => $('vf-info')).textContent = vfInfo; }
      if (vfFilm !== _hc.vfFilm) { _hc.vfFilm = vfFilm; hudEl('vfFilm', () => $('vf-film')).textContent = vfFilm; }
    }
    updateViewfinderFlare(dt, !!(vfOpen && verNow.viewfinderFlare));
    // dynamic subtitle placement + intense readability mode
    if (A.setSubMode) {
      const intense = siren.state === 'hunt' || d < 42 ||
        (fastone && fastone.state !== 'idle') ||
        (sneaky && sneaky.attacking) ||
        st2 >= W2 ||
        tenantEye > 0.05 ||
        (vfOpen && player.exposure >= LO.EXPO.SHOW);
      let mode = '';
      if (vfOpen) mode += 'mode-viewfinder ';
      if (player.hideView) mode += 'mode-hiding ';
      if (intense) mode += 'mode-intense';
      const trimmed = mode.trim();
      if (trimmed !== _hc.subMode) { _hc.subMode = trimmed; A.setSubMode(trimmed); }
    }
    const fallEl = hudEl('fallFx', () => $('fall-fx'));
    if (fallEl) {
      const fAir = player.hidden ? 0 : (player.fallAir || 0);
      const fImp = player.hidden ? 0 : (player.fallImpact || 0);
      const fInt = Math.min(1, Math.max(fAir * 0.85, fImp * 0.9));
      const fOp = fInt > 0.015 ? fInt.toFixed(2) : '0';
      const fSc = fInt > 0.015 ? `scale(${(1.06 - fInt * 0.06).toFixed(3)})` : '';
      if (fOp !== _hc.fallOp) { _hc.fallOp = fOp; fallEl.style.opacity = fOp; }
      if (fSc !== _hc.fallScale) { _hc.fallScale = fSc; fallEl.style.transform = fSc; }
    }
  }

  let _photoCapCanvas = null, _photoCapCtx = null, _photoBlobUrl = '';
  function showCapturedPhoto(url, ev) {
    const img = $('photo-img');
    if (img) img.src = url || '';
    $('photo-caption').textContent = ev ? ev.name : 'Nothing useful...';
    const pop = $('photo-pop');
    pop.classList.add('show');
    clearTimeout(pop._t);
    pop._t = setTimeout(() => pop.classList.remove('show'), ev ? 3200 : 1800);
    if (!ev) hintOnce('nothing', 'Nothing useful in that shot.', 3000);
  }
  function capturePhoto() {
    if (!pendingCapture) return;
    const { ev } = pendingCapture;
    pendingCapture = null;
    try {
      const src = renderer && renderer.domElement;
      if (!src) { showCapturedPhoto('', ev); return; }
      if (!_photoCapCanvas) {
        _photoCapCanvas = document.createElement('canvas');
        _photoCapCanvas.width = 320;
        _photoCapCanvas.height = 200;
        _photoCapCtx = _photoCapCanvas.getContext('2d');
      }
      if (_photoCapCtx) {
        _photoCapCtx.drawImage(src, 0, 0, _photoCapCanvas.width, _photoCapCanvas.height);
        if (_photoCapCanvas.toBlob && typeof URL !== 'undefined' && URL.createObjectURL) {
          _photoCapCanvas.toBlob(blob => {
            if (_photoBlobUrl && URL.revokeObjectURL) {
              try { URL.revokeObjectURL(_photoBlobUrl); } catch (e) { /* ignore */ }
              _photoBlobUrl = '';
            }
            if (blob) {
              _photoBlobUrl = URL.createObjectURL(blob);
              showCapturedPhoto(_photoBlobUrl, ev);
            } else {
              showCapturedPhoto('', ev);
            }
          }, 'image/jpeg', 0.76);
          return;
        }
        showCapturedPhoto(_photoCapCanvas.toDataURL('image/jpeg', 0.76), ev);
        return;
      }
    } catch (e) { /* ignore */ }
    showCapturedPhoto('', ev);
  }

  // ============================================================
  //  MAIN LOOP
  // ============================================================
  let fpsAcc = 0, fpsFrames = 0;
  const fwd = new THREE.Vector3(), upv = new THREE.Vector3();
  const _threatSiren = { pos: null, radius: 24 };
  const _threatFast = { pos: null, radius: 20 };
  const _threatsList = [];
  const _onBirdScatter = p => { A.birdScatter && A.birdScatter(p); };
  const _worldUpdateOpts = { pos: null, disturbed: false, still: false, enabled: true, threats: null, onScatter: _onBirdScatter };
  let _rafPending = false;
  function broadcastHostWorldSnap() {
    if (!Net || !Net.isHost() || !Net.broadcast) return;
    const snapPlayers = [];
    if (player) {
      const lp = player.getNetState ? player.getNetState() : {};
      lp.id = 'host';
      snapPlayers.push(lp);
      const hm = Net.getPlayer('host');
      if (hm) {
        hm.alive = player.alive !== false;
        hm.hidden = !!lp.hidden;
        hm.hideSpotIdx = lp.hideSpotIdx !== undefined ? lp.hideSpotIdx : -1;
        hm.health = lp.health;
      }
    }
    Net.players.forEach(np => {
      if (!np || np.id === 'host' || np.left || np.hiddenAdmin) return;
      const st = Net.remoteStates && Net.remoteStates.get(np.id);
      if (st) {
        snapPlayers.push({
          id: np.id,
          x: st.x,
          y: st.y,
          z: st.z,
          yaw: st.yaw,
          pitch: st.pitch,
          crouch: st.crouch || 0,
          flashOn: !!st.flashOn,
          cameraUp: !!st.cameraUp,
          hidden: !!st.hidden,
          hideSpotIdx: st.hideSpotIdx !== undefined ? st.hideSpotIdx : -1,
          alive: np.alive !== false && !np.left,
          moving: !!st.moving,
          sprinting: !!st.sprinting,
          noiseRadius: st.noiseRadius || 0,
          health: typeof np.health === 'number' ? np.health : (typeof st.health === 'number' ? st.health : 100),
        });
      }
    });
    Net.broadcast({
      type: 'world_snap',
      siren: siren ? siren.getNetState() : null,
      moths: moths ? moths.getNetSync() : null,
      players: snapPlayers,
    });
  }

  function loop() {
    _rafPending = false;
    if (!document.hidden && !_rafPending) {
      _rafPending = true;
      requestAnimationFrame(loop);
    }
    const dt = Math.min(0.05, clock.getDelta());
    shakeAmt = Math.max(0, shakeAmt - dt * 1.5);
    if (state === 'title' || state === 'gate') {
      A.setReverbZone && A.setReverbZone(false, false);
      updateTitle(dt);
    } else if (state === 'play') {
      const adm = LO.isTesting ? LO.admin : null;
      const frozenByPanel = !!(adm && adm.open && adm.freezeWhenOpen);
      const simDt = frozenByPanel ? 0 : dt * (adm && typeof adm.timeScale === 'number' ? adm.timeScale : 1);
      if (simDt > 0) {
        gameTime += simDt;
        LO.ambush.now = gameTime;
        player.update(simDt, gameTime);

        const isCoop = !!(Net && Net.isCoop());
        const isClient = !!(Net && Net.isClient());
        let hasRemoteBeam = false;

        if (isCoop) {
          syncRemotePlayersRoster();
          _coopPlayers.length = 0;
          _coopPlayers.push(player);
          remotePlayers.forEach((rp, id) => {
            const st = Net.remoteStates && Net.remoteStates.get(id);
            if (st) rp.applyNetState(st);
            const np = Net.getPlayer ? Net.getPlayer(id) : null;
            if (np && np.alive === false) rp.alive = false;
            syncHideSpotOccupation(id, rp.hidden && rp.alive !== false, rp.hideSpotIdx, rp);
            rp.update(simDt, camera ? camera.position : null);
            if (rp.alive !== false) {
              _coopPlayers.push(rp);
              if (rp.flashOn && !rp.hidden) hasRemoteBeam = true;
            }
          });
          updateRemoteRocks(simDt);
        }

        if (isClient) {
          siren.applyNetState(lastWorldSnap ? lastWorldSnap.siren : null, simDt, player.pos);
          if (state === 'play') moths.applyNetSync(lastWorldSnap ? lastWorldSnap.moths : null, player, hasRemoteBeam, camera, gameTime);
        } else {
          siren.update(simDt, isCoop ? _coopPlayers : player, gameTime);
          if (state === 'play') moths.update(simDt, isCoop ? _coopPlayers : player, camera, gameTime);
        }

        if (isCoop) {
          netSyncAccum += simDt;
          if (netSyncAccum >= SYNC_INTERVAL) {
            netSyncAccum = 0;
            if (Net.isHost()) {
              broadcastHostWorldSnap();
            } else if (Net.sendToHost) {
              const pkt = player.getNetState ? player.getNetState() : {
                x: player.pos.x, y: player.pos.y, z: player.pos.z,
                yaw: player.yaw, pitch: player.pitch, crouch: player.crouch || 0,
                flashOn: !!player.flashOn, cameraUp: !!player.cameraUp,
                hidden: !!player.hidden, hideSpotIdx: -1,
                alive: player.alive !== false, moving: !!player.moving,
                sprinting: !!player.sprinting, noiseRadius: player.noiseRadius || 0,
                health: player.health !== undefined ? player.health : 100,
              };
              pkt.type = 'p_state';
              Net.sendToHost(pkt);
            }
          }
          coopHudAccum += simDt;
          if (coopHudAccum >= 0.2) {
            coopHudAccum = 0;
            updateCoopTeamHUD();
          }
        }

        if (state === 'play' && sneaky.update(simDt, player, camera, siren) === 'kill') dieBy('sneaky');
        if (state === 'play' && fastone.update(simDt, player, camera, siren, gameTime) === 'kill') dieBy('fastone');
        if (state === 'play' && hazards) hazards.update(simDt, player, siren, gameTime);
        const verNow = V();
        const birdDisturbed = !!(player.sprinting || player.noiseRadius >= 28 || player.spike >= 12);
        _threatsList.length = 0;
        if (siren && siren.pos) { _threatSiren.pos = siren.pos; _threatsList.push(_threatSiren); }
        if (fastone && fastone.state !== 'idle' && fastone.pos) { _threatFast.pos = fastone.pos; _threatsList.push(_threatFast); }
        _worldUpdateOpts.pos = player.pos;
        _worldUpdateOpts.disturbed = birdDisturbed && !!verNow.birdFade;
        _worldUpdateOpts.still = A.still;
        _worldUpdateOpts.enabled = !!verNow.forestBirds;
        _worldUpdateOpts.threats = verNow.forestRing ? _threatsList : null;
        _worldUpdateOpts.onScatter = verNow.forestRing ? _onBirdScatter : null;
        world.update(simDt, gameTime, _worldUpdateOpts);
        if (state === 'play') {
          updateHUD(simDt);
          updateHintUI();
          updateWindState(simDt);
          const inForest = !!(world && world.isForest && world.isForest(player.pos) && !player.indoor);
          if (A.setReverbZone) {
            if (verNow.reverb) A.setReverbZone(!!player.indoor, inForest);
            else A.setReverbZone(false, false);
          }
          // music & heartbeat follow the danger
          const d = siren.distToPlayer || 999;
          const near = Math.max(0, 1 - d / 70);
          // entity proximity layer: rustling forest + wind chimes grow in frequency and volume when any entity is nearby
          let entNear = Math.max(0, 1 - d / 46);
          if (fastone && fastone.state !== 'idle' && fastone.root) {
            const df = Math.hypot(fastone.root.position.x - player.pos.x, fastone.root.position.z - player.pos.z);
            entNear = Math.max(entNear, Math.max(0, 1 - df / 32));
          }
          if (sneaky && sneaky.attacking) entNear = Math.max(entNear, 0.85);
          if (moths && moths.moths) {
            let dm = 999;
            for (let mi = 0; mi < moths.moths.length; mi++) {
              const m = moths.moths[mi];
              if (!m.active) continue;
              const distM = Math.hypot(m.g.position.x - player.pos.x, m.g.position.z - player.pos.z);
              if (distM < dm) dm = distM;
            }
            if (dm < 22) entNear = Math.max(entNear, Math.max(0, 1 - dm / 22) * 0.72);
          }
          A.setProximityAmbient && A.setProximityAmbient(verNow.proximityAmbient && !A.still ? entNear : 0);
          A.updateBirdsong && A.updateBirdsong(simDt, player.pos, player.indoor, world.HALF, !!verNow.extBirdsong, birdDisturbed && !!verNow.birdFade);
          A.setEnvHum && A.setEnvHum(verNow.envShake && !A.still ? (player.envProx || 0) : 0);
          // the ground trembles when he's right on top of you
          if (d < 35 && !A.still) player.shake = Math.max(player.shake, Math.pow(1 - d / 35, 1.5) * 0.3);
          if (siren.state === 'hunt') A.playMusic('chase', 1);
          else A.playMusic('explore', 4);
          A.intensity = Math.min(1, near * 0.7 + ((siren.state === 'investigate' || siren.state === 'investigate_breach') ? 0.4 : siren.state === 'search' ? 0.5 : 0));
          A.setHeartbeat(siren.state === 'wander' ? near * 0.5 : Math.max(0.35, near));

          // Log coordinate + camera view vector frames for Ghost Match Replay
          replaySampleAccum += simDt;
          if (replaySampleAccum >= REPLAY_SAMPLE_SEC) {
            replaySampleAccum = 0;
            recordReplayFrame(false);
          }
          replaySaveAccum += simDt;
          if (replaySaveAccum >= REPLAY_SAVE_SEC) {
            replaySaveAccum = 0;
            saveReplayToStorage();
          }
        }
      }
    } else if (state === 'dying') {
      updateDying(dt);
      world.update(dt, gameTime, { still: true, enabled: !!V().forestBirds });
    } else if (cutscene) {
      A.setReverbZone && A.setReverbZone(false, false);
      // hold space to skip
      if ((player.keys.Space || LO.touchHold) && state === 'opening') {
        skipHeld += dt;
        $('skip-bar').firstChild.style.width = Math.min(100, skipHeld / 1.2 * 100) + '%';
        if (skipHeld > 1.2) { A.stopVoices(); cutscene.finish(); }
      } else if (skipHeld) { skipHeld = 0; $('skip-bar').firstChild.style.width = '0'; }
      if (cutscene) cutscene.update(dt);
      A.setSubMode && A.setSubMode('mode-cutscene');
      if (world && world.updateWind) world.updateWind(dt, 0.5, camera.position, gameTime);
      if (world) world.update(dt, gameTime += dt, { still: false, enabled: !!V().forestBirds });
    } else if (state === 'spectate') {
      gameTime += dt;
      LO.ambush.now = gameTime;
      const isCoop = !!(Net && Net.isCoop());
      const isClient = !!(Net && Net.isClient());
      let hasRemoteBeam = false;
      if (isCoop) {
        syncRemotePlayersRoster();
        _coopPlayers.length = 0;
        if (player) _coopPlayers.push(player);
        remotePlayers.forEach((rp, id) => {
          const st = Net.remoteStates && Net.remoteStates.get(id);
          if (st) rp.applyNetState(st);
          const np = Net.getPlayer ? Net.getPlayer(id) : null;
          if (np && np.alive === false) rp.alive = false;
          syncHideSpotOccupation(id, rp.hidden && rp.alive !== false, rp.hideSpotIdx, rp);
          rp.update(dt, camera ? camera.position : null);
          if (rp.alive !== false) {
            _coopPlayers.push(rp);
            if (rp.flashOn && !rp.hidden) hasRemoteBeam = true;
          }
        });
        updateRemoteRocks(dt);
      }
      if (isClient) {
        if (siren) siren.applyNetState(lastWorldSnap ? lastWorldSnap.siren : null, dt, camera ? camera.position : null);
        if (moths) moths.applyNetSync(lastWorldSnap ? lastWorldSnap.moths : null, null, hasRemoteBeam, camera, gameTime);
      } else {
        if (siren) siren.update(dt, isCoop ? _coopPlayers : player, gameTime);
        if (moths) moths.update(dt, isCoop ? _coopPlayers : player, camera, gameTime);
        // Keep co-op waves advancing for surviving clients if the host is dead/spectating.
        if (Net && Net.isHost() && _coopPlayers.length > 1) {
          if (fastone && V().fastone && !(LO.admin && LO.admin.noFastOne) && !LO.ambush.active && LO.ambush.now >= LO.ambush.gapUntil) {
            if (fastone.cooldown > 0) fastone.cooldown = Math.max(0, fastone.cooldown - dt);
            else {
              fastone.timer -= dt;
              if (fastone.timer <= 0) {
                Net.broadcast({ type: 'fast_wave' });
                fastone.timer = 135 + Math.random() * 45;
                fastone.cooldown = 35;
              }
            }
          }
          if (sneaky && V().sneaky && !(LO.admin && LO.admin.noSneaky) && !LO.ambush.active && LO.ambush.now >= LO.ambush.gapUntil) {
            sneaky.timer -= dt;
            if (sneaky.timer <= 0) {
              Net.broadcast({ type: 'sneaky_wave' });
              sneaky.timer = 150 + Math.random() * 60;
            }
          }
        }
      }
      if (Net && Net.isHost()) {
        netSyncAccum += dt;
        if (netSyncAccum >= SYNC_INTERVAL) {
          netSyncAccum = 0;
          broadcastHostWorldSnap();
        }
      }
      const spectateMeta = (spectateId && Net && Net.getPlayer) ? Net.getPlayer(spectateId) : null;
      const spectateConnected = !!(
        spectateMeta &&
        !spectateMeta.left &&
        !spectateMeta.hiddenAdmin &&
        spectateMeta.alive !== false &&
        (!Net.isHost || !Net.isHost() || (Net.conns && Net.conns.has(spectateId)))
      );
      let targetRp = (spectateId && spectateConnected) ? remotePlayers.get(spectateId) : null;
      if (!spectateConnected || !targetRp || !targetRp.alive) {
        if (targetRp) targetRp.firstPersonHidden = false;
        const alive = (Net && Net.getLivingConnectedPlayers)
          ? Net.getLivingConnectedPlayers().filter(p => p.id !== Net.localId)
          : (Net ? Net.players.filter(p => p.alive !== false && !p.left && !p.hiddenAdmin && p.id !== Net.localId) : []);
        if (alive.length > 0) {
          spectateId = alive[0].id;
          targetRp = remotePlayers.get(spectateId);
          lastSpecLabelText = '';
          updateSpectateLabel();
        } else {
          if (spectateId && remotePlayers.has(spectateId)) {
            remotePlayers.get(spectateId).firstPersonHidden = false;
          }
          spectateId = null;
          targetRp = null;
          if (Net && Net.isHost && Net.isHost()) checkMatchOver();
        }
      }
      remotePlayers.forEach((rp, id) => {
        if (id !== spectateId && rp.firstPersonHidden) rp.firstPersonHidden = false;
      });
      if (targetRp && camera) {
        targetRp.firstPersonHidden = !!spectateFirstPerson;
        if (spectateFirstPerson) {
          const eyeY = targetRp.pos.y + 1.62 - (targetRp.crouch || 0) * 0.42;
          camera.position.set(targetRp.pos.x, eyeY, targetRp.pos.z);
          camera.rotation.order = 'YXZ';
          camera.rotation.set(targetRp.pitch || 0, targetRp.yaw || 0, 0);
        } else {
          const yaw = targetRp.yaw || 0;
          const behindX = targetRp.pos.x + Math.sin(yaw) * 3.2;
          const behindZ = targetRp.pos.z + Math.cos(yaw) * 3.2;
          _specTarget.set(behindX, targetRp.pos.y + 2.1, behindZ);
          camera.position.lerp(_specTarget, Math.min(1, dt * 12));
          camera.lookAt(targetRp.pos.x, targetRp.pos.y + 1.45, targetRp.pos.z);
        }
        const verNow = V();
        if (A.setReverbZone) {
          if (verNow.reverb) {
            const specIn = !!(world && world.isIndoor && world.isIndoor(targetRp.pos));
            const specFor = !!(world && world.isForest && world.isForest(targetRp.pos) && !specIn);
            A.setReverbZone(specIn, specFor);
          } else A.setReverbZone(false, false);
        }
        if (world) {
          _worldUpdateOpts.pos = targetRp.pos;
          _worldUpdateOpts.disturbed = false;
          _worldUpdateOpts.still = false;
          _worldUpdateOpts.enabled = !!verNow.forestBirds;
          _worldUpdateOpts.threats = null;
          _worldUpdateOpts.onScatter = null;
          world.update(dt, gameTime, _worldUpdateOpts);
        }
      }
      if (siren && camera) {
        const dSpec = Math.hypot(siren.pos.x - camera.position.x, siren.pos.z - camera.position.z);
        const nearSpec = Math.max(0, 1 - dSpec / 70);
        if (siren.state === 'hunt') A.playMusic('chase', 1);
        else A.playMusic('explore', 4);
        A.setHeartbeat(siren.state === 'wander' ? nearSpec * 0.5 : Math.max(0.35, nearSpec));
      }
      coopHudAccum += dt;
      if (coopHudAccum >= 0.2) {
        coopHudAccum = 0;
        updateSpectateLabel();
        updateCoopTeamHUD();
      }
    } else if (state === 'replay') {
      A.setReverbZone && A.setReverbZone(false, false);
      A.setSubMode && A.setSubMode('');
      updateGhostReplay(dt);
    } else if (state !== 'play') {
      A.setReverbZone && A.setReverbZone(false, false);
      A.setSubMode && A.setSubMode('');
    }

    if (LO.admin && LO.admin.update) LO.admin.update(dt);

    if (world && world.sky) { world.sky.position.copy(camera.position); world.stars.position.copy(camera.position); }
    if (state === 'dead') {
      if (deathShown && V().deathRoom) { deathRoom.update(dt, window.innerWidth / window.innerHeight, A.deathMusicTime()); deathRoom.render(renderer); }
    } else if (state !== 'credits') renderer.render(scene, camera);
    if (pendingCapture) capturePhoto();
    updateFlashStrobe(dt);

    // 3D audio listener & directional subtitle tracker follow the camera
    camera.getWorldDirection(fwd);
    upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
    A.setListener(camera.position, fwd, upv);
    updateAfkTracker(dt);
    if (Net && Net.isCoop() && Net.updateVoiceProximity) {
      const inCutscene = (state === 'opening' || state === 'ending' || state === 'credits' || state === 'loading' || state === 'dying' || state === 'dead' || state === 'replay' || !!cutscene);
      const inWorld = !inCutscene && (state === 'play' || state === 'spectate');
      Net.updateVoiceProximity(
        camera ? camera.position : null,
        id => {
          const rp = remotePlayers.get(id);
          if (!rp) return null;
          _voiceRemotePos.copy(rp.pos);
          return _voiceRemotePos;
        },
        inWorld,
        inCutscene
      );
      voiceUiAccum += dt;
      if (voiceUiAccum >= 0.12) {
        voiceUiAccum = 0;
        updateVoiceUI();
        if (state === 'play' && !coopMenuOpen) updateCoopTeamHUD();
      }
    }
    LO.TVFX.update(dt);
    if (S.showFps) {
      fpsAcc += dt; fpsFrames++;
      if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; fpsAcc = 0; fpsFrames = 0; }
    }
  }

  // ============================================================
  //  BOOT
  // ============================================================
  function wireMenus() {
    document.body.addEventListener('click', e => {
      const stab = e.target.closest('#settings-tabs button[data-stab]');
      if (stab) { A.click(true); setSettingsTab(stab.dataset.stab); return; }
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      A.click(true);
      const act = b.dataset.action;
      const inPause = state === 'paused' || coopMenuOpen || !!b.closest('#pause');
      switch (act) {
        case 'play': startGame(false); break;
        case 'multiplayer':
          openPanel('coop-join', 'title');
          break;
        case 'coop-host':
          if (LO.Net && LO.Net.host) {
            const nameEl = document.getElementById('coop-name-join') || document.getElementById('coop-name-lobby');
            const rawName = nameEl ? nameEl.value : loadSavedCallsign();
            const clean = saveCallsign(rawName);
            syncCallsignInputs(clean);
            openPanel('coop-lobby', 'title');
            LO.Net.host(clean, LO.settings && LO.settings.gameVersion).catch(() => {});
          }
          break;
        case 'coop-connect':
          if (LO.Net && LO.Net.join) {
            const codeEl = document.getElementById('coop-code-input');
            const nameEl = document.getElementById('coop-name-join');
            const code = codeEl ? codeEl.value : '';
            const rawName = nameEl ? nameEl.value : loadSavedCallsign();
            const clean = saveCallsign(rawName);
            syncCallsignInputs(clean);
            LO.Net.join(code, clean).then(res => {
              syncCallsignInputs(clean);
              if (!res || !res.inGame) openPanel('coop-lobby', 'title');
            }).catch(() => {});
          }
          break;
        case 'coop-start':
          if (LO.Net && LO.Net.isHost()) {
            const seed = (Math.random() * 0x7fffffff) | 0;
            const evSeed = (Math.random() * 0x7fffffff) | 0;
            LO.Net.inGame = true;
            if (LO.Net.broadcast) LO.Net.broadcast({ type: 'start_run', seed, evSeed });
            startGame(false, seed, evSeed);
            LO.Net.pushRoomHeartbeat && LO.Net.pushRoomHeartbeat();
          }
          break;
        case 'coop-leave':
        case 'coop-cancel':
          if (LO.Net && LO.Net.leave) LO.Net.leave();
          resetAfkActivity();
          clearChatLogs();
          updateVoiceUI();
          restoreLocalVersion();
          closePanel();
          break;
        case 'settings': settingsTab = 'all'; openPanel('settings', inPause ? 'pause' : 'title'); break;
        case 'graphics': openPanel('graphics', inPause ? 'pause' : 'title'); break;
        case 'audio': openPanel('audio', inPause ? 'pause' : 'title'); break;
        case 'updates': openPanel('updates', 'title'); break;
        case 'credits-panel': openPanel('credits-panel', 'title'); break;
        case 'versions': openPanel('versions', 'title'); break;
        case 'admin': if (LO.isTesting && LO.admin) LO.admin.openPanel(inPause ? 'pause' : 'title'); break;
        case 'back': closePanel(); break;
        case 'resume': resume(); break;
        case 'retry':
          if (Net && Net.isCoop() && Net.isHost()) {
            if (Array.isArray(Net.players)) {
              Net.players = Net.players.filter(p => !p.left);
              Net.players.forEach(p => { p.alive = !p.hiddenAdmin; p.hidden = false; p.hideSpotIdx = -1; p.health = 100; });
            }
            coopTeamWiped = false;
            const seed = (Math.random() * 0x7fffffff) | 0;
            const evSeed = (Math.random() * 0x7fffffff) | 0;
            Net.inGame = true;
            if (Net.broadcast) Net.broadcast({ type: 'start_run', seed, evSeed });
            startGame(false, seed, evSeed);
            Net.pushRoomHeartbeat && Net.pushRoomHeartbeat();
          } else {
            startGame(true);
          }
          break;
        case 'replay': startGhostReplay(); break;
        case 'quit': ui.fadeOut(0.6); setTimeout(goTitle, 650); break;
      }
    });
    window.addEventListener('keydown', e => {
      if (LO.isTesting && (e.code === 'Backquote' || e.code === 'F9') && state !== 'gate') {
        e.preventDefault();
        if (LO.admin) LO.admin.toggle(state);
        return;
      }
      if (chatOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          closeChat(state === 'play');
        }
        return;
      }
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (state === 'replay') {
        if (e.code === 'Escape') {
          e.preventDefault();
          exitGhostReplay();
          return;
        }
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          if (replayData && replayTime >= replayData.duration) replayTime = 0;
          replayPlaying = !replayPlaying;
          syncReplayControlsUI();
          return;
        }
        if (e.code === 'KeyV' && !e.repeat) {
          e.preventDefault();
          replayFirstPerson = !replayFirstPerson;
          const snap = sampleReplayAt(replayTime);
          if (snap) applyReplayFrame(snap, 0.016, true);
          syncReplayControlsUI();
          return;
        }
        if (e.code === 'KeyF' && !e.repeat) {
          e.preventDefault();
          replaySpeed = replaySpeed === 1 ? 2 : replaySpeed === 2 ? 4 : 1;
          syncReplayControlsUI();
          return;
        }
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          e.preventDefault();
          replayTime = Math.max(0, replayTime - 2);
          const snap = sampleReplayAt(replayTime);
          if (snap) applyReplayFrame(snap, 0.016, true);
          syncReplayControlsUI();
          return;
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          e.preventDefault();
          const dur = replayData ? replayData.duration : 0;
          replayTime = Math.min(dur, replayTime + 2);
          const snap = sampleReplayAt(replayTime);
          if (snap) applyReplayFrame(snap, 0.016, true);
          syncReplayControlsUI();
          return;
        }
      }
      if (Net && Net.isCoop() && (state === 'play' || state === 'spectate') && !coopMenuOpen && !(LO.admin && LO.admin.open)) {
        if ((e.code === 'KeyT' || e.code === 'Enter') && !e.repeat) {
          e.preventDefault();
          openChat();
          return;
        }
        if (e.code === 'KeyX' && !e.repeat) {
          e.preventDefault();
          A.init && A.init();
          if (Net.toggleMicMute) Net.toggleMicMute().then(() => updateVoiceUI());
          return;
        }
      }
      if (e.code === 'KeyH' && state === 'play' && !(LO.admin && LO.admin.open)) useHint();
      if (e.code === 'Escape') {
        if (LO.admin && LO.admin.open) { LO.admin.closePanel(); return; }
        if ((state === 'paused' || coopMenuOpen) && $('pause').classList.contains('active')) resume();
        else if (document.querySelector('.panel-screen.active')) closePanel();
        else if ((state === 'play' || state === 'spectate') && !coopMenuOpen) pause();
      }
    });
    window.addEventListener('keydown', onAfkUserInput, { passive: true });
    window.addEventListener('keyup', onAfkUserInput, { passive: true });
    window.addEventListener('mousedown', onAfkUserInput, { passive: true });
    window.addEventListener('touchstart', onAfkUserInput, { passive: true });
    window.addEventListener('wheel', onAfkUserInput, { passive: true });
    window.addEventListener('input', onAfkUserInput, { passive: true });
    window.addEventListener('mousemove', e => {
      const dx = Math.abs(e.movementX || 0) + (afkMouseX !== null ? Math.abs(e.clientX - afkMouseX) : 0);
      const dy = Math.abs(e.movementY || 0) + (afkMouseY !== null ? Math.abs(e.clientY - afkMouseY) : 0);
      afkMouseX = e.clientX;
      afkMouseY = e.clientY;
      if (dx > 0 || dy > 0) onAfkUserInput();
    }, { passive: true });
    const rpPlay = $('replay-play-btn');
    if (rpPlay) rpPlay.addEventListener('click', () => {
      A.click(true);
      if (replayData && replayTime >= replayData.duration) replayTime = 0;
      replayPlaying = !replayPlaying;
      syncReplayControlsUI();
    });
    const rpSpeed = $('replay-speed-btn');
    if (rpSpeed) rpSpeed.addEventListener('click', () => {
      A.click(true);
      replaySpeed = replaySpeed === 1 ? 2 : replaySpeed === 2 ? 4 : 1;
      syncReplayControlsUI();
    });
    const rpCam = $('replay-cam-btn');
    if (rpCam) rpCam.addEventListener('click', () => {
      A.click(true);
      replayFirstPerson = !replayFirstPerson;
      const snap = sampleReplayAt(replayTime);
      if (snap) applyReplayFrame(snap, 0.016, true);
      syncReplayControlsUI();
    });
    const rpExit = $('replay-exit-btn');
    if (rpExit) rpExit.addEventListener('click', () => {
      A.click(true);
      exitGhostReplay();
    });
    const rpScrub = $('replay-scrub');
    if (rpScrub) rpScrub.addEventListener('input', () => {
      replayTime = parseFloat(rpScrub.value) || 0;
      replayPlaying = false;
      const snap = sampleReplayAt(replayTime);
      if (snap) applyReplayFrame(snap, 0.016, true);
      syncReplayControlsUI();
    });
    const matchIdBtn = $('coop-match-id');
    if (matchIdBtn) matchIdBtn.addEventListener('click', e => { e.stopPropagation(); copyMatchIdToClipboard(matchIdBtn); });
    const pauseMatchBtn = $('pause-match-id');
    if (pauseMatchBtn) pauseMatchBtn.addEventListener('click', e => { e.stopPropagation(); copyMatchIdToClipboard(pauseMatchBtn); });
    $('hint-btn').addEventListener('click', e => { e.stopPropagation(); useHint(); });
    const mapBadge = $('map-hud-badge');
    if (mapBadge) mapBadge.addEventListener('click', e => { e.stopPropagation(); if (player) player.toggleMap(); });
    const mapClose = $('map-close-btn');
    if (mapClose) mapClose.addEventListener('click', e => { e.stopPropagation(); if (player) player.toggleMap(false); });
    window.addEventListener('resize', applyDisplay);
    LO.events.addEventListener('settings', () => applyDisplay());
    if (window.LO && LO.Net) {
      const codeDisplay = document.getElementById('coop-room-code');
      const rosterEl = document.getElementById('coop-roster');
      const lobbyStatus = document.getElementById('coop-lobby-status');
      const joinStatus = document.getElementById('coop-join-status');
      const startBtn = document.getElementById('coop-start-btn');
      const copyBtn = document.getElementById('coop-copy-btn');
      const joinNameInput = document.getElementById('coop-name-join');
      const lobbyNameInput = document.getElementById('coop-name-lobby');

      const savedCallsign = loadSavedCallsign();
      if (savedCallsign) {
        syncCallsignInputs(savedCallsign);
        LO.Net.localName = LO.Net.sanitizeName ? LO.Net.sanitizeName(savedCallsign, 0) : savedCallsign;
      }

      const wireCallsignInput = el => {
        if (!el) return;
        const onInput = () => {
          const clean = saveCallsign(el.value);
          syncCallsignInputs(clean, el);
          if (LO.Net.setLocalName) LO.Net.setLocalName(clean);
        };
        el.addEventListener('input', onInput);
        el.addEventListener('change', () => {
          const clean = saveCallsign(el.value);
          el.value = clean;
          syncCallsignInputs(clean, el);
          if (LO.Net.setLocalName) LO.Net.setLocalName(clean);
        });
      };
      wireCallsignInput(joinNameInput);
      wireCallsignInput(lobbyNameInput);

      LO.Net.onStatus = (msg, isErr) => {
        [lobbyStatus, joinStatus].forEach(el => {
          if (!el) return;
          el.textContent = msg || '';
          el.classList.toggle('err', !!isErr);
          el.style.color = '';
        });
      };

      LO.Net.onChat = msg => appendChatMessage(msg);
      LO.Net.onVoiceChange = () => updateVoiceUI();
      LO.Net.onPingUpdate = () => updatePingUI();
      LO.Net.onDataTick = () => checkAfkTimeout();
      LO.Net.checkMatchOver = () => checkMatchOver();
      LO.Net.onPlayerLeave = () => checkMatchOver();

      const lobbyMicBtn = $('lobby-mic-btn');
      if (lobbyMicBtn) {
        lobbyMicBtn.addEventListener('click', () => {
          A.init && A.init();
          if (LO.Net.toggleMicMute) LO.Net.toggleMicMute().then(() => updateVoiceUI());
        });
      }
      const hudMicBtn = $('hud-mic-btn');
      if (hudMicBtn) {
        hudMicBtn.addEventListener('click', e => {
          e.stopPropagation();
          A.init && A.init();
          if (LO.Net.toggleMicMute) LO.Net.toggleMicMute().then(() => {
            updateVoiceUI();
            if (state === 'play' && !chatOpen && !coopMenuOpen) lockPointer();
          });
        });
      }
      const hudChatBtn = $('hud-chat-btn');
      if (hudChatBtn) {
        hudChatBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (chatOpen) closeChat(state === 'play');
          else openChat();
        });
      }
      const lobbyChatForm = $('lobby-chat-form');
      const lobbyChatInput = $('lobby-chat-input');
      if (lobbyChatForm && lobbyChatInput) {
        lobbyChatForm.addEventListener('submit', e => {
          e.preventDefault();
          const val = lobbyChatInput.value;
          if (LO.Net.sendChat && LO.Net.sendChat(val)) lobbyChatInput.value = '';
          lobbyChatInput.focus();
        });
      }
      const hudChatForm = $('hud-chat-form');
      const hudChatInput = $('hud-chat-input');
      if (hudChatForm && hudChatInput) {
        hudChatForm.addEventListener('submit', e => {
          e.preventDefault();
          const val = hudChatInput.value;
          if (LO.Net.sendChat && LO.Net.sendChat(val)) hudChatInput.value = '';
          closeChat(state === 'play');
        });
      }

      const verBadge = $('coop-ver-badge');
      if (verBadge) {
        verBadge.addEventListener('click', () => {
          if (LO.Net && LO.Net.isClient && LO.Net.isClient()) return;
          A.click(true);
          openPanel('versions', 'lobby');
        });
      }

      LO.Net.getSessionSnapshot = () => {
        let wave = 'Lobby';
        let status = 'lobby';
        if (LO.Net.inGame) {
          if (coopTeamWiped || state === 'dead') { wave = 'Team Wipe'; status = 'wipe'; }
          else if (state === 'opening') { wave = 'Opening'; status = 'opening'; }
          else if (endingQueued || state === 'ending' || state === 'credits') { wave = 'Ending'; status = 'ending'; }
          else if (fastone && fastone.state && fastone.state !== 'idle') { wave = `Fast One · ${evidenceCount}/${EVIDENCE_NEEDED}`; status = 'playing'; }
          else if (siren && siren.state === 'hunt') { wave = `Siren Hunt · ${evidenceCount}/${EVIDENCE_NEEDED}`; status = 'playing'; }
          else { wave = `Evidence ${evidenceCount}/${EVIDENCE_NEEDED}`; status = 'playing'; }
        }
        return { wave, status };
      };

      LO.Net.getRunSyncState = () => ({
        seed: currentRunSeed,
        evSeed: currentEvSeed,
        gameTime,
        foundIds: (world && world.evidence) ? world.evidence.filter(e => e.found).map(e => e.id) : [],
        evidenceCount,
        mapTaken: !!(world && world.wallMap && world.wallMap.taken),
        endingQueued: !!endingQueued,
        runPhase: state,
      });

      LO.Net.onForceExit = (reason, kind) => {
        handleCoopForceExit(reason, kind);
      };

      LO.Net.onLobbyUpdate = (players, roomCode) => {
        if (codeDisplay) codeDisplay.textContent = roomCode || '-----';
        if (startBtn) startBtn.style.display = LO.Net.isHost() ? '' : 'none';
        if (LO.Net.isClient() && LO.Net.hostVersion) applyHostVersion(LO.Net.hostVersion);
        else syncCoopVersionBadge();
        updateMatchIdWatermark();
        if (rosterEl) {
          const list = Array.isArray(players) ? players.filter(m => m && !m.hiddenAdmin) : [];
          let html = '';
          for (let i = 0; i < LO.Net.MAX_PLAYERS; i++) {
            const p = list.find(m => m.slot === i) || list[i];
            if (p) {
              const role = p.id === 'host' ? 'HOST' : (p.id === LO.Net.localId ? 'YOU' : 'READY');
              const vs = LO.Net.getVoiceState ? LO.Net.getVoiceState(p.id) : { hasMic: !!p.hasMic, muted: !!p.muted, speaking: false };
              const m = rosterMicMeta(vs);
              const pingTag = p.id === 'host'
                ? '<span class="coop-ping-tag" style="display:none"></span>'
                : `<span class="coop-ping-tag ${typeof p.ping === 'number' ? pingQuality(p.ping) : ''}">${typeof p.ping === 'number' ? Math.round(p.ping) + ' ms' : '-- ms'}</span>`;
              html += `<div class="coop-slot" data-pid="${escHtml(p.id)}">
                <span class="coop-slot-left"><i class="coop-swatch" style="background:${escHtml(p.color || '#4a78a8')}"></i><span>${escHtml(p.name)}</span></span>
                <span class="coop-slot-right">
                  ${pingTag}
                  <span class="coop-mic-pill ${m.cls}" data-vstate="${m.state}" title="${m.title}">${m.html}</span>
                  <span class="coop-badge ${p.id === 'host' ? 'host' : ''}">${role}</span>
                </span>
              </div>`;
            } else {
              html += `<div class="coop-slot empty"><span class="coop-slot-left">Waiting for investigator...</span><span class="coop-badge">OPEN</span></div>`;
            }
          }
          rosterEl.innerHTML = html;
        }
        updateVoiceUI();
      };

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (LO.Net.roomCode && navigator.clipboard) {
            navigator.clipboard.writeText(LO.Net.roomCode);
            if (lobbyStatus) lobbyStatus.textContent = 'Copied room code: ' + LO.Net.roomCode;
          }
        });
      }

      LO.Net.onDisconnect = reason => {
        const msg = reason || 'Disconnected from host.';
        resetAfkActivity();
        clearChatLogs();
        updateVoiceUI();
        if (state !== 'title' && state !== 'gate') {
          goTitle();
          showHint(msg, 5000);
        } else if (joinStatus) {
          joinStatus.textContent = msg;
          joinStatus.classList.add('err');
        }
      };

      LO.Net.onMessage = (senderId, msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'start_run') {
          coopTeamWiped = false;
          if (Array.isArray(Net.players)) {
            Net.players = Net.players.filter(p => !p.left);
            Net.players.forEach(p => { p.alive = !p.hiddenAdmin; p.hidden = false; p.hideSpotIdx = -1; p.health = 100; });
          }
          LO.Net.inGame = true;
          startGame(false, msg.seed, msg.evSeed);
        } else if (msg.type === 'admin_midjoin') {
          const rs = msg.runState || {};
          coopTeamWiped = false;
          LO.Net.inGame = true;
          A.init();
          A.stopVoices();
          hideAllScreens();
          const seedArg = rs.seed !== null && rs.seed !== undefined ? rs.seed : undefined;
          const evSeedArg = rs.evSeed !== null && rs.evSeed !== undefined ? rs.evSeed : undefined;
          if (seedArg !== undefined) buildWorld(seedArg, evSeedArg);
          resetRun(seedArg, evSeedArg);
          if (world && world.evidence && Array.isArray(rs.foundIds)) {
            const idSet = new Set(rs.foundIds);
            world.evidence.forEach(e => { e.found = idSet.has(e.id); });
          }
          if (typeof rs.evidenceCount === 'number') evidenceCount = rs.evidenceCount;
          if (rs.mapTaken && world && world.wallMap) {
            world.wallMap.taken = true;
            if (world.wallMap.mesh) world.wallMap.mesh.visible = false;
            if (world.wallMap.building) world.wallMap.building.hasMap = false;
            if (player) player.hasMap = true;
          }
          if (typeof rs.gameTime === 'number') gameTime = rs.gameTime;
          endingQueued = !!rs.endingQueued;
          updateEvidenceUI();
          syncRemotePlayersRoster();
          if (msg.adminHidden) {
            const me = Net.getPlayer ? Net.getPlayer(Net.localId) : null;
            if (me) { me.alive = false; me.hiddenAdmin = true; }
            if (player) { player.alive = false; player.enabled = false; }
            const aliveMates = Net.players.filter(p => p && !p.left && !p.hiddenAdmin && p.alive !== false && p.id !== Net.localId);
            const targetId = aliveMates.length ? aliveMates[0].id : 'host';
            enterSpectate(targetId);
            showHint(`Admin joined match ${Net.roomCode} (hidden spectator).`, 3500);
          } else {
            beginPlay();
            showHint(`Admin joined match ${Net.roomCode}.`, 3500);
          }
          updateMatchIdWatermark();
        } else if (msg.type === 'world_snap') {
          lastWorldSnap = msg;
        } else if (msg.type === 'sneaky_wave') {
          if (sneaky && !sneaky.attacking) {
            sneaky.waveActive = true;
            sneaky.timer = Math.random() * 10;
          }
        } else if (msg.type === 'sneaky_result') {
          if (Net.isHost() && sneaky && sneaky.finishHostAmbush) sneaky.finishHostAmbush();
        } else if (msg.type === 'fast_wave') {
          if (fastone && player && fastone.triggerLocalAttack) {
            fastone.triggerLocalAttack(player, gameTime);
          }
        } else if (msg.type === 'fastone_breach') {
          if (Net.isHost() && siren && siren.investigateFence && V().fastoneV2) {
            siren.investigateFence({ x: msg.x || 0, z: msg.z || 0 });
          }
        } else if (msg.type === 'begin_play') {
          if (typeof endCutscene === 'function') endCutscene();
          if (typeof beginPlay === 'function') beginPlay();
        } else if (msg.type === 'p_state') {
          syncRemotePlayersRoster();
          const mate = Net.getPlayer ? Net.getPlayer(senderId) : null;
          if (mate && mate.alive === false) msg.alive = false;
          const rp = remotePlayers.get(senderId);
          if (rp) {
            const firstSync = !rp._hasNetSync;
            rp.applyNetState(msg);
            syncHideSpotOccupation(senderId, rp.hidden && rp.alive !== false, rp.hideSpotIdx, rp);
            if (firstSync && msg.x !== undefined) {
              rp.pos.set(msg.x, msg.y || 0, msg.z);
              rp.yaw = msg.yaw !== undefined ? msg.yaw : rp.yaw;
              rp._hasNetSync = true;
            }
          }
        } else if (msg.type === 'ev_found') {
          if (!Net.isHost() || !world || !world.evidence) return;
          const ev = world.evidence.find(e => e.id === msg.evId);
          if (!ev || ev.found) return;
          ev.found = true;
          evidenceCount++;
          lastEvidenceTime = gameTime;
          if (ev === hintTarget) hintTarget = null;
          A.evidenceSting();
          updateEvidenceUI();
          const finder = Net.getPlayer ? Net.getPlayer(senderId) : null;
          const finderName = finder ? finder.name : 'Teammate';
          showHint(`${finderName} photographed: ${ev.name}`, 3600);
          Net.broadcast({
            type: 'ev_sync',
            foundIds: world.evidence.filter(e => e.found).map(e => e.id),
            evidenceCount,
            evName: ev.name,
            finderName,
          });
          Net.pushRoomHeartbeat && Net.pushRoomHeartbeat();
          if (evidenceCount >= EVIDENCE_NEEDED && !endingQueued) queueEnding();
        } else if (msg.type === 'ev_sync') {
          if (world && world.evidence && Array.isArray(msg.foundIds)) {
            const idSet = new Set(msg.foundIds);
            world.evidence.forEach(e => { if (idSet.has(e.id)) e.found = true; });
          }
          if (typeof msg.evidenceCount === 'number') evidenceCount = msg.evidenceCount;
          lastEvidenceTime = gameTime;
          if (hintTarget && hintTarget.found) hintTarget = null;
          A.evidenceSting();
          updateEvidenceUI();
          if (msg.evName) {
            const who = msg.finderName ? `${msg.finderName} photographed` : 'Evidence photographed';
            showHint(`${who}: ${msg.evName}`, 3600);
          }
        } else if (msg.type === 'ending_queue') {
          if (!endingQueued) {
            endingQueued = true;
            if (player) { player.calm = true; player.noSilent = true; player.exposure = 0; }
            if (fastone) fastone.clearHighlight();
            A.setTenant(0); A.setSilentOne(0); A.setMothFlutter(0); A.setExposure(0);
            setTimeout(async () => {
              if (state !== 'play' && state !== 'spectate') return;
              await A.say('player', 'That\'s enough. Sending everything to the county sheriff now.');
              if (state !== 'play' && state !== 'spectate') return;
              await A.say('radio', 'Hollow Creek caller, we received your photos. Stay where you are. All units, heavy response to Hollow Creek. This is not a drill. I repeat, this is not a drill.');
              if (state !== 'play' && state !== 'spectate') return;
              await A.say('player', 'They\'re coming. They\'re actually coming.');
            }, 2500);
          }
        } else if (msg.type === 'ending_start') {
          if (state === 'play' || state === 'spectate' || state === 'paused') startEnding();
        } else if (msg.type === 'pickup_taken') {
          if (!Net.isHost()) return;
          const p = world && world.pickups && world.pickups[msg.idx];
          if (p && !p.taken) {
            p.taken = true;
            if (p.mesh) p.mesh.visible = false;
            Net.broadcast({ type: 'pickup_sync', idx: msg.idx });
          }
        } else if (msg.type === 'pickup_sync') {
          const p = world && world.pickups && world.pickups[msg.idx];
          if (p) { p.taken = true; if (p.mesh) p.mesh.visible = false; }
        } else if (msg.type === 'map_found') {
          if (!Net.isHost()) return;
          const wm = world && world.wallMap;
          if (wm && !wm.taken) {
            wm.taken = true;
            if (wm.mesh) wm.mesh.visible = false;
            if (wm.building) wm.building.hasMap = false;
            if (player) player.hasMap = true;
            A.pickup();
            const finder = Net.getPlayer ? Net.getPlayer(senderId) : null;
            const finderName = finder ? finder.name : 'Teammate';
            showHint(`${finderName} picked up the Town Map! Press ${LO.isTouch ? 'MAP' : 'M or Tab'} to view.`, 5000);
            Net.broadcast({ type: 'map_sync', finderName });
          }
        } else if (msg.type === 'map_sync') {
          const wm = world && world.wallMap;
          if (wm) {
            wm.taken = true;
            if (wm.mesh) wm.mesh.visible = false;
            if (wm.building) wm.building.hasMap = false;
          }
          if (player && !player.hasMap) {
            player.hasMap = true;
            A.pickup();
            const who = msg.finderName || 'Teammate';
            showHint(`${who} picked up the Town Map! Press ${LO.isTouch ? 'MAP' : 'M or Tab'} to view.`, 5000);
          }
        } else if (msg.type === 'rock_throw') {
          if (Net.isHost()) Net.broadcast(msg, senderId);
          if (msg.fromId !== Net.localId) spawnRemoteRock(msg);
        } else if (msg.type === 'noise_evt') {
          if (!Net.isHost()) return;
          const pos = { x: msg.x || 0, y: msg.y || 0, z: msg.z || 0 };
          if (siren && siren.hearNoise) siren.hearNoise(pos, msg.radius || 20);
          if (msg.kind === 'shutter') {
            Net.broadcast({ type: 'remote_photo', id: senderId });
          } else if (msg.kind && msg.kind !== 'jump' && msg.kind !== 'land' && msg.kind !== 'kicked' && msg.kind !== 'rock') {
            Net.broadcast({ type: 'remote_sfx', kind: msg.kind, x: pos.x, y: pos.y, z: pos.z, fromId: senderId });
          }
        } else if (msg.type === 'remote_photo') {
          if (msg.id && msg.id !== Net.localId) {
            const rp = remotePlayers.get(msg.id);
            if (rp && rp.triggerPhotoFlash) rp.triggerPhotoFlash();
          }
        } else if (msg.type === 'haz_state') {
          if (Net.isHost()) Net.broadcast(msg, senderId);
          if (hazards && hazards.applyRemoteState) hazards.applyRemoteState(msg.idx, msg.st);
        } else if (msg.type === 'remote_sfx') {
          if (msg.fromId === Net.localId) return;
          const pos = { x: msg.x || 0, y: msg.y || 0, z: msg.z || 0 };
          if (msg.kind === 'powerline' && A.hazardZap) A.hazardZap(pos);
          else if (msg.kind === 'beartrap' && A.hazardTrapSnap) A.hazardTrapSnap(pos);
          else if (msg.kind === 'steam' && A.hazardSteamBurn) A.hazardSteamBurn(pos);
          else if (msg.kind === 'glass' && A.hazardGlass) A.hazardGlass(pos);
          else if (msg.kind === 'floorboard' && A.hazardCreak) A.hazardCreak(pos);
          else if (msg.kind === 'tindebris' && A.hazardTinClatter) A.hazardTinClatter(pos);
        } else if (msg.type === 'moth_shriek') {
          const pos = { x: msg.x || 0, y: msg.y || 2, z: msg.z || 0 };
          if (A.mothShriek) A.mothShriek(pos);
          if (player && player.alive) player.shake = Math.max(player.shake, 0.5);
          if (msg.targetId === Net.localId && player && player.alive && player.damage) {
            player.damage(msg.dmg || (V().mothDamage || 20), 'moth');
          }
        } else if (msg.type === 'siren_sfx' && msg.evt && siren) {
          const e = msg.evt;
          if (e.kind === 'echo') {
            if (A.echoPing) A.echoPing(siren.voice);
            siren.onEcho && siren.onEcho(siren.distToPlayer || 0);
          } else if (e.kind === 'siren') {
            A.siren && A.siren(siren.voice, e.sirenKind, e.loud);
          } else if (e.kind === 'static') {
            A.staticBurst && A.staticBurst(siren.voice, e.dur, e.vol);
          } else if (e.kind === 'creak') {
            A.creak && A.creak(siren.voice);
          } else if (e.kind === 'say' && !A.still) {
            if (e.lineKind === 'static') A.staticBurst && A.staticBurst(siren.voice, 1.2, 0.6);
            else if (e.lineKind === 'radio') A.radioGarble && A.radioGarble(siren.voice, 2.2, 0.7);
            else if (e.line) A.say('siren', e.line, { panner: siren.voice && siren.voice.panner, rate: 0.72, pitch: 0.45 });
          }
        } else if (msg.type === 'world_evt') {
          if (msg.kind === 'smash_building' && world && world.buildings && world.smashBuilding) {
            const b = world.buildings.find(x => x.id === msg.bId);
            if (b) {
              world.smashBuilding(b, { x: msg.x || 0, z: msg.z || 0 }, { x: msg.dx || 0, z: msg.dz || 1 });
              A.buildingSmash && A.buildingSmash({ x: msg.x || 0, y: 2, z: msg.z || 0 });
              if (player && player.alive) {
                const d = Math.hypot((msg.x || 0) - player.pos.x, (msg.z || 0) - player.pos.z);
                if (d < 120) player.shake = Math.max(player.shake, Math.max(0.4, 1.25 * (1 - d / 120)));
                if (d < 100) player.triggerDizzy(Math.max(0.45, 1.15 * (1 - d / 100)));
              }
            }
          }
        } else if (msg.type === 'eject_hide') {
          if (player && (player.hidden || player.hideAnim)) player.ejectFromHide();
        } else if (msg.type === 'player_caught') {
          onCaught();
        } else if (msg.type === 'player_kill') {
          dieBy(msg.cause || 'fastone');
        } else if (msg.type === 'player_dead') {
          const deadId = msg.id || senderId;
          const mate = Net.getPlayer ? Net.getPlayer(deadId) : null;
          if (mate) { mate.alive = false; mate.hidden = false; mate.hideSpotIdx = -1; }
          const rp = remotePlayers.get(deadId);
          if (rp) {
            syncHideSpotOccupation(deadId, false, -1, rp);
            rp.alive = false;
            if (rp.root) rp.root.visible = false;
          }
          if (typeof updateCoopTeamHUD === 'function') updateCoopTeamHUD();
          if (typeof updateSpectateLabel === 'function') updateSpectateLabel();
          if (Net.isHost()) {
            Net.broadcast({ type: 'player_dead', id: deadId, cause: msg.cause });
            checkMatchOver();
          }
        } else if (msg.type === 'team_wipe') {
          if (!coopTeamWiped) showTeamWipeDeath();
        } else if (msg.type === 'player_left' || msg.type === 'PLAYER_LEFT') {
          const leftId = msg.id || senderId;
          const mate = Net.getPlayer ? Net.getPlayer(leftId) : null;
          if (mate) { mate.left = true; mate.alive = false; mate.hidden = false; mate.hideSpotIdx = -1; }
          const rp = remotePlayers.get(leftId);
          if (rp) {
            syncHideSpotOccupation(leftId, false, -1, rp);
            if (rp.dispose) rp.dispose();
            remotePlayers.delete(leftId);
          }
          if (Net.remoteStates && Net.remoteStates.delete) Net.remoteStates.delete(leftId);
          if (spectateId === leftId) {
            spectateId = null;
            if (state === 'spectate') cycleSpectate(1);
          }
          if (typeof updateCoopTeamHUD === 'function') updateCoopTeamHUD();
          if (typeof updateSpectateLabel === 'function') updateSpectateLabel();
          if (Net.isHost()) {
            Net.broadcast({ type: 'player_left', id: leftId });
            checkMatchOver();
          }
        }
      };
    }
  }

function boot() {
    document.body.classList.toggle('testing-build', !!LO.isTesting);
    document.body.classList.toggle('has-touch', !!LO.isTouch);
    try {
      const grain = LO.tex.canvas('grainOverlay');
      $('grain').style.backgroundImage = `url(${grain.toDataURL()})`;
    } catch (e) { /* non-fatal */ }
    createRenderer();
    try { deathRoom = new LO.DeathRoom(); } catch (e) { console.warn('[boot] DeathRoom init error:', e); }
    try { document.fonts && document.fonts.load('40px Caveat'); } catch (e) { /* fallback fonts are fine */ }
    try {
      buildWorld();
      setupTitleScene();
      if (renderer && scene && camera) {
        updateTitle(0.02);
        renderer.render(scene, camera);
      }
    } catch (e) {
      console.warn('[boot] Title scene init error:', e);
    }
    syncVersionUI();
    wireMenus();
    ui.fadeIn(0.1);
    clock.start();
    loop();
    document.addEventListener('visibilitychange', () => {
      if (checkAfkTimeout()) return;
      if (!document.hidden) {
        clock.getDelta();
        if (!_rafPending) {
          _rafPending = true;
          requestAnimationFrame(loop);
        }
      }
    });
    setInterval(() => {
      if (document.hidden && Net && Net.isCoop()) {
        if (checkAfkTimeout()) return;
        loop();
      }
    }, 100);
    const gate = $('gate');
    const leaveGate = () => {
      if (state !== 'gate') return;
      try { A.init(); } catch (e) { console.warn('[audio] Init error:', e); }
      ui.fadeOut(0.01);
      gate.classList.remove('active');
      state = 'title';
      show('title');
      setTimeout(() => ui.fadeIn(2.5), 50);
      try {
        A.playMusic('title', 3);
        A.setWind(0.12);
      } catch (e) { /* non-fatal */ }
      window.removeEventListener('keydown', leaveGate);
    };
    gate.addEventListener('click', leaveGate);
    window.addEventListener('keydown', leaveGate);
    LO.adminHost = {
      getState: () => state,
      isPaused: () => state === 'paused' || coopMenuOpen,
      getGameTime: () => gameTime,
      getEvidenceCount: () => evidenceCount,
      getWorld: () => world,
      getSiren: () => siren,
      getPlayer: () => player,
      getMoths: () => moths,
      getSneaky: () => sneaky,
      getFastOne: () => fastone,
      getHazards: () => hazards,
      getRenderer: () => renderer,
      getScene: () => scene,
      getCamera: () => camera,
      pause,
      resume,
      lockPointer,
      startPlay: () => startGame(true),
      goTitle,
      showHint,
      applyDisplay,
      applyAdminLighting,
      scatterBirds: () => world && world.scatterBirdsAt && player && world.scatterBirdsAt(player.pos, 45, gameTime),
      resetSilence: () => { if (player) { player.silentTime = 0; player.silentTick = 0; } },
      markEvidence(ev) {
        if (!ev || ev.found) return;
        ev.found = true;
        evidenceCount++;
        lastEvidenceTime = gameTime;
        if (ev === hintTarget) hintTarget = null;
        A.evidenceSting();
        updateEvidenceUI();
        if (evidenceCount >= EVIDENCE_NEEDED && !endingQueued) queueEnding();
      },
      resetEvidence() {
        world.evidence.forEach(e => { e.found = false; });
        evidenceCount = 0;
        endingQueued = false;
        player.calm = false;
        player.noSilent = false;
        hintTarget = null;
        updateEvidenceUI();
      },
      unlockHint() {
        lastEvidenceTime = gameTime - HINT_DELAY;
        updateHintUI();
        if (state === 'play') useHint();
      },
      queueEnding() { if (!endingQueued) queueEnding(); },
      startEnding() { startEnding(); },
      triggerDeath(cause) {
        if (LO.admin && LO.admin.open) LO.admin.closePanel(true);
        if (state === 'paused') { hideAllScreens(); show('hud'); state = 'play'; }
        if (state !== 'play') return false;
        const wasGod = !!(LO.admin && LO.admin.god);
        if (LO.admin) LO.admin.god = false;
        siren.catchDisabled = false;
        if (cause === 'siren') onCaught();
        else dieBy(cause || 'siren');
        if (LO.admin) LO.admin.god = wasGod;
        return true;
      },
      showScreen: (id, on) => show(id, on),
      hideAllScreens,
      setPlayEnabled: on => { if (player) player.enabled = !!on; },
      syncClock: () => { clock.getDelta(); },
      syncMatchIdUI: () => { updateMatchIdWatermark(); },
      async joinMatchAdmin(roomId, hidden) {
        if (!LO.Net || !LO.Net.join) throw new Error('Networking unavailable');
        const joinEl = $('coop-name-join');
        const rawName = (joinEl && joinEl.value) || loadSavedCallsign() || 'Admin';
        const clean = saveCallsign(rawName) || 'Admin';
        const res = await LO.Net.join(roomId, clean, { adminJoin: true, adminHidden: !!hidden });
        if (LO.admin && LO.admin.open) LO.admin.closePanel(true);
        if (!res || !res.inGame) {
          openPanel('coop-lobby', 'title');
        }
        return res;
      },
      async shutdownMatchAdmin(roomId) {
        if (!LO.Net || !LO.Net.adminRemoteShutdown) return { ok: false };
        return await LO.Net.adminRemoteShutdown(roomId, 'Match shut down by Admin');
      },
    };
    if (LO.isTesting && LO.admin && LO.admin.init) LO.admin.init();
    // expose for debugging
    LO.debug = { setTitleT(t) { titleT = t; }, get deathRoom() { return deathRoom; }, setGameTime(t) { gameTime = t; }, get cutscene() { return cutscene; }, get state() { return state; }, get world() { return world; }, get siren() { return siren; }, get player() { return player; }, get moths() { return moths; }, get sneaky() { return sneaky; }, get fastone() { return fastone; }, get hazards() { return hazards; }, startGame, startEnding, beginPlay };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  function updateCoopTeamHUD() {
    const el = document.getElementById('coop-team-hud');
    if (!el) return;
    if (!window.LO || !LO.Net || LO.Net.mode === 'solo') {
      el.classList.remove('show');
      if (lastCoopHudHtml !== '') {
        lastCoopHudHtml = '';
        el.innerHTML = '';
      }
      return;
    }
    el.classList.add('show');
    const list = Array.isArray(LO.Net.players) ? LO.Net.players.filter(p => p && !p.hiddenAdmin) : [];
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const rp = p.id !== LO.Net.localId ? remotePlayers.get(p.id) : null;
      const hp = p.id === LO.Net.localId && player ? player.health : (rp ? rp.health : p.health);
      const isDead = p.left || p.alive === false;
      const status = p.left ? 'LEFT' : p.alive === false ? 'DEAD' : (p.hidden ? 'HIDDEN' : (typeof hp === 'number' ? Math.max(0, Math.ceil(hp)) + ' HP' : 'OK'));
      const vs = LO.Net.getVoiceState ? LO.Net.getVoiceState(p.id) : null;
      const micTag = !p.left && vs && vs.hasMic ? (vs.speaking ? 'TALK' : vs.muted ? 'MUTE' : 'MIC') : '';
      const cls = 'coop-mate' + (isDead ? ' dead' : '') + (vs && vs.speaking ? ' talking' : '') + (vs && vs.hasMic && vs.muted ? ' mic-muted' : '');
      html += `<div class="${cls}">
        <span class="coop-mate-dot" style="background:${escHtml(p.color || '#4a78a8')}"></span>
        <span>${escHtml(p.name || 'Investigator')}</span>
        ${micTag ? `<span class="coop-mate-mic">${micTag}</span>` : ''}
        <span class="coop-mate-hp">${status}</span>
      </div>`;
    }
    if (html !== lastCoopHudHtml) {
      lastCoopHudHtml = html;
      el.innerHTML = html;
    }
  }
})();