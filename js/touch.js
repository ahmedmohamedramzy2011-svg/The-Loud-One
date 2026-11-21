// ============================================================
//  THE LOUD ONE — mobile / touch controls
//  Left: movement joystick. Right half: drag to look.
//  Buttons: sprint (hold), jump, crouch, light, camera, snap, hide, pause.
// ============================================================
(function () {
  if (!LO.isTouch) return;
  document.body.classList.add('touch');

  const $ = id => document.getElementById(id);
  const P = () => LO.debug && LO.debug.player;
  const playing = () => LO.debug && LO.debug.state === 'play';

  // ---------- joystick ----------
  const stick = $('t-stick'), knob = $('t-knob');
  let stickId = null, sx = 0, sy = 0;
  const R = 55;
  stick.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    sx = r.left + r.width / 2; sy = r.top + r.height / 2;
    moveStick(t);
    e.preventDefault();
  }, { passive: false });
  function moveStick(t) {
    let dx = t.clientX - sx, dy = t.clientY - sy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const p = P(); if (p) p.touchMove = { x: dx / R, y: dy / R };
  }
  function endStick() {
    stickId = null;
    knob.style.transform = '';
    const p = P(); if (p) p.touchMove = null;
  }

  // ---------- look ----------
  const look = $('t-look');
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) moveStick(t);
      else if (t.identifier === lookId) {
        const p = P();
        if (p && p.enabled) {
          const s = 0.0055 * LO.settings.sensitivity * (p.cameraUp ? 0.6 : 1);
          p.yaw -= (t.clientX - lx) * s;
          p.pitch -= (t.clientY - ly) * s * (LO.settings.invertY ? -1 : 1);
          p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
        }
        lx = t.clientX; ly = t.clientY;
      }
    }
    if (stickId !== null || lookId !== null) e.preventDefault();
  }, { passive: false });
  const endTouch = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) endStick();
      if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  // ---------- buttons ----------
  let crouchOn = false;
  document.querySelectorAll('#touch .t-btn').forEach(b => {
    const act = b.dataset.t;
    b.addEventListener('touchstart', e => {
      e.preventDefault(); e.stopPropagation();
      const p = P();
      if (act === 'pause') { if (playing()) LO.pauseGame(); return; }
      if (!p || !p.enabled) return;
      switch (act) {
        case 'sprint': p.keys.ShiftLeft = true; b.classList.add('on'); break;
        case 'jump': p.keys.Space = true; setTimeout(() => { p.keys.Space = false; }, 150); break;
        case 'crouch': crouchOn = !crouchOn; p.keys.KeyC = crouchOn; break;
        case 'light': p.toggleFlash(); break;
        case 'camera': p.cameraUp = !p.cameraUp; break;
        case 'shutter': if (p.cameraUp) p.takePhoto(); break;
        case 'use': p.interact(); break;
        case 'map': p.toggleMap && p.toggleMap(); break;
        case 'hint': LO.useHint && LO.useHint(); break;
        case 'throw': p.throwRock(); break;
      }
    }, { passive: false });
    b.addEventListener('touchend', e => {
      e.preventDefault();
      const p = P();
      if (act === 'sprint') { if (p) p.keys.ShiftLeft = false; b.classList.remove('on'); }
    }, { passive: false });
  });

  // ---------- hold anywhere to skip the opening cutscene ----------
  window.addEventListener('touchstart', () => { if (LO.debug && LO.debug.state === 'opening') LO.touchHold = true; });
  window.addEventListener('touchend', e => { if (!e.touches.length) LO.touchHold = false; });

  // ---------- keep button states in sync with the game ----------
  function sync() {
    requestAnimationFrame(sync);
    const p = P();
    if (!p) return;
    if (!playing()) {
      // release everything when not playing
      if (crouchOn || p.keys.ShiftLeft) { crouchOn = false; p.keys.KeyC = false; p.keys.ShiftLeft = false; }
      if (stickId !== null) endStick();
    }
    $('t-light').classList.toggle('on', p.flashOn);
    $('t-camera').classList.toggle('on', p.cameraUp);
    $('t-crouch').classList.toggle('on', crouchOn);
    $('t-use').classList.toggle('on', !!p.prompt || !!p.mapOpen);
    $('t-use').textContent = p.mapOpen ? 'CLOSE' : p.hidden ? 'LEAVE' : (p.nearestWallMap && p.nearestWallMap() ? 'MAP' : 'HIDE');
    const tMap = $('t-map');
    if (tMap) {
      const mapAllowed = !LO.ver || LO.ver().townMap;
      tMap.style.display = (p.hasMap && mapAllowed) ? '' : 'none';
      tMap.classList.toggle('on', !!p.mapOpen);
    }
    document.body.classList.toggle('cam-up', p.cameraUp);
  }
  sync();
})();
