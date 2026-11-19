// ============================================================
//  THE LOUD ONE — game flow, menus, HUD and main loop
// ============================================================
(function () {
  const S = LO.settings;
  const A = LO.audio;
  const $ = id => document.getElementById(id);
  const EVIDENCE_NEEDED = 5;

  let sneaky = null, fastone = null;
  let renderer, scene, camera, world, siren, player, moths, deathRoom, deathShown = false, deathTimer = null, titleSpot = null;
  let state = 'gate';          // gate | title | opening | play | paused | dying | dead | ending | credits
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
  const V = () => LO.ver ? LO.ver() : { hint: true, darkLight: true, tenant: true, sirenFast: true, health: true, silent: true, wind: true, windStillness: true, rocks: true, echo: true, moths: true, exposure: true, deathRoom: true, tenantBlind: true, fastDeathAllowed: true, sneaky: true, fastone: true, sirenSmash: true, fastoneV2: true, staminaBuff: true, flashSway: true, dynamicSubs: true, proximityAmbient: true, richInteriors: true, cleanSubs: true, extBirdsong: true, envShake: true, forestBirds: true, birdFade: true };
  // ---- hint system: unlocks after 3 minutes without finding evidence ----
  const HINT_DELAY = 180, HINT_SHOW = 15;
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
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = S.shadows !== 'off';
    renderer.shadowMap.type = S.shadows === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    $('game-root').appendChild(renderer.domElement);
    renderer.domElement.addEventListener('click', () => {
      if (state === 'play' && !document.pointerLockElement) lockPointer();
    });
    applyDisplay();
  }

  function applyDisplay() {
    if (!renderer) return;
    const rawDpr = window.devicePixelRatio || 1;
    const capPr = S.quality === 'low' ? Math.min(rawDpr, 1.0) : Math.min(rawDpr, 2);
    const pr = Math.min(2.0, capPr * S.renderScale);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    document.body.classList.toggle('pixelated', S.renderScale < 0.75);
    document.body.classList.toggle('low-perf', S.quality === 'low' || S.lighting === 'simple');
    renderer.toneMappingExposure = 1.15 * S.brightness;
    if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
    if (scene && scene.fog && state !== 'ending') {
      scene.fog.density = (LO.admin && LO.admin.fullbright)
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

  function buildWorld() {
    if (siren) siren.dispose();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.fog = new THREE.FogExp2(0x010102, 0.022);
    if (!camera) camera = new THREE.PerspectiveCamera(S.fov, window.innerWidth / window.innerHeight, 0.1, 1100);
    camera.children.slice().forEach(c => camera.remove(c));
    world = LO.World.build(scene);
    siren = new LO.SirenHead(scene, world);
    if (moths) moths.dispose();
    if (sneaky) scene && sneaky.root.parent && sneaky.root.parent.remove(sneaky.root);
    if (fastone) fastone.dispose();
    LO.ambush = { active: null, gapUntil: 0, now: 0 };
    moths = new LO.Moths(scene, world);
    sneaky = new LO.Sneaky(scene, world);
    sneaky.onAttack = lightOff => {
      if (lightOff) showHint('Your equipment is flickering...', 3000);
    };
    fastone = new LO.FastOne(scene, world);
    fastone.onBreach = pos => {
      if (state !== 'play' || !V().fastoneV2) return;
      siren.investigateFence && siren.investigateFence(pos);
    };
    titleSpot = new THREE.SpotLight(0xfff1d6, 0, 90, 0.42, 0.5, 1.2);
    scene.add(titleSpot, titleSpot.target);
    moths.onShriek = pos => {
      if (state !== 'play') return;
      // a moth's shriek carries a long way and it makes him angry
      siren.anger = Math.min(100, siren.anger + 35);
      siren.hearNoise(pos, 90);
      player.shake = Math.max(player.shake, 0.5);
    };
    player = new LO.Player(camera, world, scene);
    player.onTenantBlinded = () => {
      const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      A.click(true); A.staticBurst(null, 0.6, 0.45); A.setTenant(0);
    };
    player.hint = showHint;
    player.onPhoto = onPhoto;
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
      siren.hearNoise(pos, 45);
    };
    siren.onEcho = d => {
      if (state !== 'play' || A.still) return;
      const r = $('echo-ring');
      r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
    };
    player.onKicked = () => {
      A.tenantScream();
      A.playRinging();      // your ears ring after it throws you out
      const f = $('tenant-face');
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    };
    siren.onCatch = onCaught;
    siren.onStep = p => {
      if (state !== 'play') return;
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < 80) player.shake = Math.max(player.shake, Math.pow(1 - d / 80, 1.4) * 0.95);
    };
    siren.onSmash = (b, pos) => {
      if (state !== 'play') return;
      const fastActive = LO.ambush && LO.ambush.active === 'fastone';
      if (!fastActive && b && b.hideSpots && b.hideSpots.length && (player.hidden || player.hideAnim)) {
        const curSpot = player.hidden || (player.hideAnim && player.hideAnim.spot);
        if (curSpot && b.hideSpots.includes(curSpot)) player.ejectFromHide();
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
    parkedCar = null;
    worldDirty = false;
    applyDisplay();
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
        renderVersions();
        if (state === 'title') { buildWorld(); setupTitleScene(); }
        else worldDirty = true;
        closePanel();
      };
      list.appendChild(b);
    });
  }

  function openPanel(id, from) {
    menuReturn = from;
    hideAllScreens();
    if (id === 'graphics') renderOptions('graphics-list', LO.Settings.GRAPHICS_OPTIONS);
    if (id === 'audio') renderOptions('audio-list', LO.Settings.AUDIO_OPTIONS);
    if (id === 'versions') renderVersions();
    if (id === 'updates') syncVersionUI();
    show(id);
  }
  function closePanel() {
    hideAllScreens();
    if (menuReturn === 'pause') { show('pause'); show('hud'); }
    else show('title');
  }

  // ============================================================
  //  TITLE SCREEN
  // ============================================================
  let titleT = 0;
  function setupTitleScene() {
    siren.scripted = true;
    siren.pos.set(world.STREETS[3], 0, world.STREETS[3] + 8);
    siren.yaw = Math.PI * 1.15;
    siren.glowOverride = 0.45;
    siren.forceLean = 0.2;
    siren.neckDip = 0; siren.armRaise = 0;
    siren.root.rotation.x = 0;
    if (fastone) {
      fastone.root.visible = false;
      fastone.head.rotation.y = 0;
      fastone.jaw.rotation.x = 0;
    }
    if (sneaky) sneaky.root.visible = false;
    world.hemi.intensity = 0.3; world.moonLight.intensity = 0.35;
    titleT = 0;
  }
  // ---- title screen: slow atmospheric shots fading through black ----
  const SHOT_LEN = 6.5;
  const _tv = new THREE.Vector3();
  function titleMoth(i, x, z, faceX, faceZ, t) {
    const m = moths.moths[i];
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
    titleT += dt;
    const shot = Math.floor(titleT / SHOT_LEN) % 7, k = (titleT % SHOT_LEN) / SHOT_LEN, lt = titleT % SHOT_LEN;
    // fade to black at the start and end of every shot
    const f = lt < 1.2 ? 1 - lt / 1.2 : lt > SHOT_LEN - 1.2 ? (lt - (SHOT_LEN - 1.2)) / 1.2 : 0;
    $('title-fade').style.opacity = f;
    world.updateWind(dt, 0.8, camera.position, titleT);
    moths.moths.forEach(m => { m.g.visible = false; });
    if (fastone) {
      fastone.root.visible = false;
      fastone.head.rotation.y = 0;
      fastone.jaw.rotation.x = 0;
    }
    if (sneaky) sneaky.root.visible = false;
    titleSpot.intensity = 0;
    siren.root.visible = true;
    siren.scripted = true;
    const S0 = world.STREETS;
    const ver = V();
    if (shot === 0) {                                        // looking up at Siren Head in the street
      siren.pos.set(S0[3], 0, 20); siren.yaw = Math.PI * 1.1; siren.speedNow = 0; siren.glowOverride = 0.35;
      camera.position.set(S0[3] - 3, 1.3 + k * 0.8, -6 + k * 5);
      camera.lookAt(S0[3] + 7, 9 + k * 3, 20);
      titleSpot.position.set(S0[3] - 3, 1, -4); titleSpot.target.position.set(S0[3], 10, 20); titleSpot.intensity = 9;
    } else if (shot === 1) {                                 // Hollow Creek highway sign (front face) & dark pine treeline
      siren.root.visible = false;
      camera.position.set(-4.8 - k * 2.2, 2.25, -140.5 + k * 1.0);
      camera.lookAt(-8.0, 3.2, -150.0);
      titleSpot.position.copy(camera.position);
      titleSpot.target.position.set(-8.0, 3.3, -150.0);
      titleSpot.intensity = 6.0;
    } else if (shot === 2) {                                 // close on the horns
      siren.pos.set(S0[3], 0, 20); siren.yaw = Math.PI * 1.1; siren.speedNow = 0; siren.glowOverride = 0.55 + Math.sin(titleT * 2) * 0.1;
      siren.update(0, null, titleT);
      siren.root.updateMatrixWorld(true);
      siren.headWorldPos(_tv);
      camera.position.set(_tv.x - 6 + k * 2, _tv.y - 1.5, _tv.z - 8 + k);
      camera.lookAt(_tv.x, _tv.y - 0.3, _tv.z);
    } else if (shot === 3 && ver.moths) {                    // a moth at the end of an alley, caught in a torch beam
      siren.root.visible = false;
      const spot = titleMothSpot();
      const mx = spot.x, mz = spot.z;
      camera.position.set(mx - 8 + k * 2, 1.6, mz);
      titleMoth(0, mx, mz, camera.position.x, camera.position.z, titleT);
      camera.lookAt(mx, 1.5, mz - 2.8);
      titleSpot.position.copy(camera.position); titleSpot.target.position.set(mx, 1.4, mz); titleSpot.intensity = 7;
    } else if (shot === 4 || (!ver.moths && shot === 3)) {   // Siren Head stalking between buildings
      siren.pos.set(S0[2], 0, -40 + k * 14); siren.yaw = 0; siren.speedNow = 2.2; siren.glowOverride = 0.3;
      camera.position.set(S0[2] - 3.5, 2.2, -72 + k * 3);
      camera.lookAt(S0[2] + 5, 8, -34 + k * 14);
      titleSpot.position.set(S0[2] - 3.5, 1.5, -70); titleSpot.target.position.set(S0[2], 9, -34 + k * 14); titleSpot.intensity = 10;
    } else if (shot === 5 && ver.moths) {                    // two moths waiting just inside a doorway
      siren.root.visible = false;
      const b = world.enterables.find(e => !e.sheriff) || world.enterables[0];
      const m1 = b.F.point(-0.7, b.hd - 1.6), m2 = b.F.point(0.8, b.hd - 3.2), cp = b.F.point(0.3 * Math.sin(titleT * 0.2), b.hd + 5.5 - k * 1.5);
      camera.position.set(cp.x, 1.55, cp.z);
      titleMoth(1, m1.x, m1.z, cp.x, cp.z, titleT);
      titleMoth(2, m2.x, m2.z, cp.x, cp.z, titleT);
      const in1 = b.F.point(0, b.hd - 2.2);
      camera.lookAt(in1.x, 1.5, in1.z);
      titleSpot.position.copy(camera.position); titleSpot.target.position.set(in1.x, 1.3, in1.z); titleSpot.intensity = 6;
    } else {                                                 // Type-III ROAD CLOSED barricades & debris at the town gate
      siren.root.visible = false;
      camera.position.set(-6.8 + k * 3.8, 1.55, -124.0 + k * 2.2);
      camera.lookAt(-1.2, 1.1, -113.5);
      titleSpot.position.copy(camera.position);
      titleSpot.target.position.set(0.2, 0.9, -113.5);
      titleSpot.intensity = 7.5;
    }
    siren.update(dt, null, titleT);
    world.update(dt, titleT, { still: false, enabled: !!ver.forestBirds });
  }

  function goTitle() {
    clearGlitch();
    A.silenceWorld(false);
    if (cutscene) endCutscene();
    LO.TVFX.clear();
    A.stopDeathMusic(); A.stopRinging(); clearTimeout(deathTimer);
    A.stopVoices();
    hideAllScreens();
    if (document.pointerLockElement) document.exitPointerLock();
    player.enabled = false;
    player.flashOn = false;
    A.setFlashlightBuzz(false); A.setHeartbeat(0); A.setTenant(0); A.setSilentOne(0);
    A.setStillness(false); document.body.classList.remove('still'); A.setMothFlutter(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setEnvHum && A.setEnvHum(0);
    $('silent-one').style.opacity = 0;
    if (worldDirty || state === 'ending' || state === 'credits' || state === 'dead') buildWorld();
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
  function resetRun() {
    if (worldDirty || V().randomSheriff) buildWorld();
    world.placeEvidence();          // every game the evidence moves (except the sheriff's tape)
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
    player.reset(world.spawn, Math.PI);
    moths.reset();
    LO.ambush = { active: null, gapUntil: 0, now: 0 };
    sneaky.reset();
    if (fastone) fastone.reset();
    gameTime = 0;
    lastEvidenceTime = 0; hintUntil = 0; hintTarget = null;
    updateEvidenceUI();
  }

  function startGame(skipIntro) {
    clearGlitch();
    LO.TVFX.clear();
    A.stopDeathMusic(); A.stopRinging(); clearTimeout(deathTimer);
    A.init();
    A.stopVoices();
    hideAllScreens();
    state = 'loading';
    resetRun();
    ui.fadeOut(0.8);
    setTimeout(() => {
      if (skipIntro) { beginPlay(); return; }
      state = 'opening';
      show('cutscene');
      document.querySelector('.skip-hint').style.display = ''; $('skip-bar').style.display = '';
      cutCtx = makeCutCtx(() => { endCutscene(); beginPlay(); });
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
    player.reset(world.spawn, Math.PI);
    const ver = V();
    applyAdminLighting();
    const hpRow = $('health-fill') && $('health-fill').closest('.bar-row');
    if (hpRow) hpRow.style.display = ver.health ? '' : 'none';
    const throwBtn = $('t-throw');
    if (throwBtn) throwBtn.style.display = ver.rocks ? '' : 'none';
    lastEvidenceTime = gameTime; hintUntil = 0; hintTarget = null;
    player.enabled = true;
    state = 'play';
    show('hud');
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
    if (LO.isTouch || (LO.admin && LO.admin.open)) return;
    const el = renderer.domElement;
    try {
      const p = el.requestPointerLock && el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* user gesture needed */ }
  }

  LO.pauseGame = () => pause();
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && state === 'play' && !(LO.admin && LO.admin.open)) pause();
  });

  function pause() {
    if (state !== 'play') return;
    if (LO.admin && LO.admin.open) LO.admin.closePanel(true);
    state = 'paused';
    player.enabled = false;
    if (sneaky && sneaky.pause) sneaky.pause();
    clearGlitch();
    show('pause');
    if (window.speechSynthesis) try { speechSynthesis.pause(); } catch (e) {}
    A.setFlashlightBuzz(false); A.setTenant(0); A.setSilentOne(0); A.setMothFlutter(0); A.setExposure(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
    A.setEnvHum && A.setEnvHum(0);
  }
  function resume() {
    hideAllScreens();
    show('hud');
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
    $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go');
    pendingCapture = { ev };
    if (!ev) return;
    ev.found = true;
    evidenceCount++;
    lastEvidenceTime = gameTime;
    if (ev === hintTarget) hintTarget = null;
    A.evidenceSting();
    updateEvidenceUI();
    A.say('player', EVIDENCE_LINES[Math.min(EVIDENCE_LINES.length - 1, evidenceCount - 1)]);
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
    A.setTenant(0); A.setSilentOne(0); A.setMothFlutter(0); A.setExposure(0); A.setExposure(0);
    setTimeout(async () => {
      await A.say('player', 'That\'s enough. Sending everything to the county sheriff now.');
      await A.say('radio', 'Hollow Creek caller, we received your photos. Stay where you are. All units, heavy response to Hollow Creek. This is not a drill. I repeat, this is not a drill.');
      await A.say('player', 'They\'re coming. They\'re actually coming.');
      if (state === 'play' || state === 'paused') startEnding();
    }, 2500);
  }

  function startEnding() {
    if (sneaky) sneaky.reset();
    if (fastone) fastone.reset();
    if (moths) { moths.root.visible = false; A.setMothFlutter(0); }
    state = 'ending';
    player.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    clearGlitch();
    A.setFlashlightBuzz(false); A.setHeartbeat(0);
    A.setProximityAmbient && A.setProximityAmbient(0);
    A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
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
      'If safety is far away, an adrenaline surge doubles your sprint speed.',
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
  function dieBy(cause) {
    clearGlitch();
    if (state === 'play') A.silenceWorld(true);
    if (sneaky && cause !== 'sneaky' && sneaky.attacking) sneaky.vanish(player, false);
    if (fastone) { fastone.clearHighlight(); if (cause !== 'fastone') fastone.reset(); }
    if (state !== 'play') return;
    dieCause = cause;
    state = 'dying';
    dieT = 0;
    player.alive = false;
    player.adrenaline = 0;
    player.enabled = false;
    player.flashOn = false;
    A.stopVoices();
    A.setTenant(0);
    if (document.pointerLockElement) document.exitPointerLock();
    A.playMusic(null, 0.5);
    startDeathSound();
    A.setMothFlutter(0);
  }
  function onCaught() {
    clearGlitch();
    if (sneaky && sneaky.attacking) sneaky.vanish(player, false);
    if (fastone) fastone.reset();
    if (state === 'play' && !siren.catchDisabled) A.silenceWorld(true);
    if (state !== 'play' || siren.catchDisabled) return;
    dieCause = 'siren';
    state = 'dying';
    dieT = 0;
    player.alive = false;
    player.adrenaline = 0;
    player.enabled = false;
    player.flashOn = false;
    A.stopVoices();
    if (document.pointerLockElement) document.exitPointerLock();
    siren.scripted = true;
    siren.forceLean = 0.95;
    siren.glowOverride = 1;
    siren.speedNow = 0;
    // turn to face the player
    siren.yaw = Math.atan2(player.pos.x - siren.pos.x, player.pos.z - siren.pos.z);
    startDeathSound();
    A.playMusic(null, 0.5);
  }
  function updateDying(dt) {
    dieT = deathClock(dt);
    const P = deathP || LO.TVFX.profile(S.fastDeath);
    LO.TVFX.dying(dieT, dieCause, P);    // red flood + the creature, red static, grey static
    if (dieCause !== 'siren') {
      // collapse to the ground
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
    const m = new THREE.Matrix4().lookAt(cam.position, hp, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    cam.quaternion.slerp(q, Math.min(1, dt * 6));
    if (dieT > P.end && state === 'dying') finishDeath();
  }
  function finishDeath() {
    {
      if (state !== 'dying') return;
      state = 'dead';
      deathShown = false;
      A.setSilentOne(0); A.setExposure(0); A.setMothFlutter(0); A.setTenant(0);
      A.setProximityAmbient && A.setProximityAmbient(0);
      A.updateBirdsong && A.updateBirdsong(0, null, true, 110, false);
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
  function updateHUD(dt) {
    const noisePct = Math.min(100, player.noiseRadius / 50 * 100);
    $('noise-fill').style.width = noisePct + '%';
    const d = siren.distToPlayer || 999;
    $('bars').querySelector('.bar-mark').style.left = Math.min(99, d / 50 * 100) + '%';
    $('stamina-fill').style.width = player.stamina + '%';
    const stamBar = $('stamina-fill').parentNode;
    const isTired = !!(player.exhausted || player.windedTimer > 0);
    stamBar.classList.toggle('tired', isTired);
    stamBar.classList.toggle('critical', !isTired && player.stamina <= 25);
    stamBar.classList.toggle('low', !isTired && player.stamina > 25 && player.stamina <= 55);
    $('battery-fill').style.width = player.battery + '%';
    $('battery-fill').parentNode.classList.toggle('low', player.battery < 15);
    const st = siren.status(player);
    if (st !== lastStatus) {
      lastStatus = st;
      $('sh-status').className = st;
      $('sh-text').textContent = STATUS_TEXT[st];
    }
    $('prompt').innerHTML = player.prompt;
    $('crosshair').style.display = player.cameraUp ? 'none' : 'block';
    const hideEl = $('hide-overlay');
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
      const ex = $('tenant-eye');
      ex.style.opacity = tenantEye > 0 ? Math.min(1, 0.35 + tenantEye) : 0;
      ex.style.transform = `translate(-50%, -50%) scale(${(0.18 + Math.pow(tenantEye, 1.6) * 3.6).toFixed(3)})`;
      $('tenant-red').style.opacity = (Math.pow(tenantEye, 1.3) * 0.95).toFixed(3);
      $('hide-text').textContent = tenantEye > 0 ? 'Get out of there' : 'HIDING — press E to leave';
      hideEl.classList.toggle('restless', tenantEye > 0.6);
      A.setTenant(Math.max(0, (tf - 0.3) / 0.7));
    } else {
      A.setTenant(0);
    }

    // the Exposure, seen only through the viewfinder
    const ex = $('exposure');
    const ek = Math.max(0, Math.min(1, (player.exposure - LO.EXPO.SHOW) / (LO.EXPO.LUNGE - LO.EXPO.SHOW)));
    if (player.zoom > 0.5 && player.exposure >= LO.EXPO.SHOW - 0.5) {
      ex.style.opacity = 0.25 + ek * 0.75;
      ex.style.setProperty('--s', (0.3 + ek * 1.2).toFixed(3));
      ex.style.setProperty('--b', (6 - ek * 4).toFixed(1) + 'px');
      ex.classList.toggle('twitch', ek > 0.6);
      A.setExposure(0.2 + ek * 0.8);
    } else {
      ex.style.opacity = 0; ex.classList.remove('twitch');
      A.setExposure(0);
    }

    // health
    $('health-fill').style.width = player.health + '%';
    $('health-num').textContent = Math.ceil(player.health);
    $('health-fill').parentNode.classList.toggle('low', player.health <= 30);

    // the Silent One: warnings from 20s of silence, attack from 30s
    const st2 = player.silentTime, W2 = LO.SILENT.WARN, AT = LO.SILENT.ATTACK;
    const so = $('silent-one');
    if (st2 >= W2) {
      const k = Math.min(1, (st2 - W2) / (AT - W2));
      const attacking = st2 >= AT;
      so.style.opacity = attacking ? 1 : 0.25 + k * 0.6;
      so.classList.toggle('attack', attacking);
      so.style.setProperty('--k', k);
      $('so-text').textContent = attacking ? 'MAKE A SOUND' : k < 0.5 ? 'it\'s too quiet...' : 'something is standing very close to you...';
      A.setSilentOne(attacking ? 1 : 0.2 + k * 0.6);
    } else {
      so.style.opacity = 0; so.classList.remove('attack');
      A.setSilentOne(0);
    }
    show('viewfinder', player.zoom > 0.5);
    // the Sneaky One makes your camera glitch too, and Siren Head smashes cause dizziness blur
    const glitch = sneaky && sneaky.attacking && player.zoom > 0.5;
    $('viewfinder').style.opacity = glitch ? (Math.random() < 0.4 ? 0.15 : 1) : '';
    const rootEl = document.getElementById('game-root');
    const nextFilter = (glitch && Math.random() < 0.3)
      ? 'brightness(0.15) contrast(1.6)'
      : (player.dizzy > 0.04 ? `blur(${(Math.round(Math.min(1, player.dizzy) * 10) * 0.25).toFixed(2)}px)` : '');
    if (nextFilter !== lastRootFilter) {
      lastRootFilter = nextFilter;
      rootEl.style.filter = nextFilter;
    }
    if (player.zoom > 0.5) {
      const vf = player.vfTarget;
      $('viewfinder').classList.toggle('locked', !!(vf && vf.ok));
      $('vf-info').textContent = !vf ? 'NO SUBJECT' : vf.ok ? 'EVIDENCE: ' + vf.ev.name.toUpperCase() : 'MOVE CLOSER';
      $('vf-film').textContent = `EVIDENCE ${evidenceCount}/${EVIDENCE_NEEDED}`;
    }
    // dynamic subtitle placement + intense readability mode
    if (A.setSubMode) {
      const intense = siren.state === 'hunt' || d < 42 ||
        (fastone && fastone.state !== 'idle') ||
        (sneaky && sneaky.attacking) ||
        st2 >= W2 ||
        tenantEye > 0.05 ||
        (player.zoom > 0.5 && player.exposure >= LO.EXPO.SHOW);
      let mode = '';
      if (player.zoom > 0.5) mode += 'mode-viewfinder ';
      if (player.hideView) mode += 'mode-hiding ';
      if (intense) mode += 'mode-intense';
      A.setSubMode(mode.trim());
    }
  }

  function capturePhoto() {
    if (!pendingCapture) return;
    const { ev } = pendingCapture;
    pendingCapture = null;
    let url = '';
    try { url = renderer.domElement.toDataURL('image/jpeg', 0.75); } catch (e) { /* ignore */ }
    $('photo-img').src = url;
    $('photo-caption').textContent = ev ? ev.name : 'Nothing useful...';
    const pop = $('photo-pop');
    pop.classList.add('show');
    clearTimeout(pop._t);
    pop._t = setTimeout(() => pop.classList.remove('show'), ev ? 3200 : 1800);
    if (!ev) hintOnce('nothing', 'Nothing useful in that shot.', 3000);
  }

  // ============================================================
  //  MAIN LOOP
  // ============================================================
  let fpsAcc = 0, fpsFrames = 0;
  const fwd = new THREE.Vector3(), upv = new THREE.Vector3();
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    shakeAmt = Math.max(0, shakeAmt - dt * 1.5);

    if (state === 'title' || state === 'gate') {
      updateTitle(dt);
    } else if (state === 'play') {
      const adm = LO.isTesting ? LO.admin : null;
      const frozenByPanel = !!(adm && adm.open && adm.freezeWhenOpen);
      const simDt = frozenByPanel ? 0 : dt * (adm && typeof adm.timeScale === 'number' ? adm.timeScale : 1);
      if (simDt > 0) {
        gameTime += simDt;
        LO.ambush.now = gameTime;
        player.update(simDt, gameTime);
        siren.update(simDt, player, gameTime);
        if (state === 'play') moths.update(simDt, player, camera, gameTime);
        if (state === 'play' && sneaky.update(simDt, player, camera, siren) === 'kill') dieBy('sneaky');
        if (state === 'play' && fastone.update(simDt, player, camera, siren, gameTime) === 'kill') dieBy('fastone');
        const verNow = V();
        const birdDisturbed = !!(player.sprinting || player.noiseRadius >= 28 || player.spike >= 12);
        world.update(simDt, gameTime, {
          pos: player.pos,
          disturbed: birdDisturbed && !!verNow.birdFade,
          still: A.still,
          enabled: !!verNow.forestBirds,
        });
        if (state === 'play') {
          updateHUD(simDt);
          updateHintUI();
          updateWindState(simDt);
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
        }
      }
    } else if (state === 'dying') {
      updateDying(dt);
      world.update(dt, gameTime, { still: true, enabled: !!V().forestBirds });
    } else if (cutscene) {
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
    } else if (state !== 'play') {
      A.setSubMode && A.setSubMode('');
    }

    if (LO.admin && LO.admin.update) LO.admin.update(dt);

    if (world && world.sky) { world.sky.position.copy(camera.position); world.stars.position.copy(camera.position); }
    if (state === 'dead') {
      if (deathShown && V().deathRoom) { deathRoom.update(dt, window.innerWidth / window.innerHeight, A.deathMusicTime()); deathRoom.render(renderer); }
    } else if (state !== 'credits') renderer.render(scene, camera);
    if (pendingCapture) capturePhoto();

    // 3D audio listener & directional subtitle tracker follow the camera
    camera.getWorldDirection(fwd);
    upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
    A.setListener(camera.position, fwd, upv);
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
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      A.click(true);
      const act = b.dataset.action;
      const inPause = state === 'paused';
      switch (act) {
        case 'play': startGame(false); break;
        case 'graphics': openPanel('graphics', inPause ? 'pause' : 'title'); break;
        case 'audio': openPanel('audio', inPause ? 'pause' : 'title'); break;
        case 'updates': openPanel('updates', 'title'); break;
        case 'versions': openPanel('versions', 'title'); break;
        case 'admin': if (LO.isTesting && LO.admin) LO.admin.openPanel(inPause ? 'pause' : 'title'); break;
        case 'back': closePanel(); break;
        case 'resume': resume(); break;
        case 'retry': startGame(true); break;
        case 'quit': ui.fadeOut(0.6); setTimeout(goTitle, 650); break;
      }
    });
    window.addEventListener('keydown', e => {
      if (LO.isTesting && (e.code === 'Backquote' || e.code === 'F9') && state !== 'gate') {
        e.preventDefault();
        if (LO.admin) LO.admin.toggle(state);
        return;
      }
      if (e.code === 'KeyH' && state === 'play' && !(LO.admin && LO.admin.open)) useHint();
      if (e.code === 'Escape') {
        if (LO.admin && LO.admin.open) { LO.admin.closePanel(); return; }
        if (state === 'paused' && $('pause').classList.contains('active')) resume();
        else if (document.querySelector('.panel-screen.active')) closePanel();
      }
    });
    $('hint-btn').addEventListener('click', e => { e.stopPropagation(); useHint(); });
    window.addEventListener('resize', applyDisplay);
    LO.events.addEventListener('settings', () => applyDisplay());
  }

  function boot() {
    document.body.classList.toggle('testing-build', !!LO.isTesting);
    document.body.classList.toggle('has-touch', !!LO.isTouch);
    // film grain image
    const grain = LO.tex.canvas('grainOverlay');
    $('grain').style.backgroundImage = `url(${grain.toDataURL()})`;
    createRenderer();
    deathRoom = new LO.DeathRoom();
    try { document.fonts && document.fonts.load('40px Caveat'); } catch (e) { /* fallback fonts are fine */ }
    buildWorld();
    setupTitleScene();
    syncVersionUI();
    wireMenus();
    ui.fadeIn(0.1);
    clock.start();
    loop();

    const gate = $('gate');
    const leaveGate = () => {
      if (state !== 'gate') return;
      A.init();
      ui.fadeOut(0.01);
      gate.classList.remove('active');
      state = 'title';
      show('title');
      setTimeout(() => ui.fadeIn(2.5), 50);
      A.playMusic('title', 3);
      A.setWind(0.12);
      window.removeEventListener('keydown', leaveGate);
    };
    gate.addEventListener('click', leaveGate);
    window.addEventListener('keydown', leaveGate);
    LO.adminHost = {
      getState: () => state,
      getGameTime: () => gameTime,
      getEvidenceCount: () => evidenceCount,
      getWorld: () => world,
      getSiren: () => siren,
      getPlayer: () => player,
      getMoths: () => moths,
      getSneaky: () => sneaky,
      getFastOne: () => fastone,
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
    };
    if (LO.isTesting && LO.admin && LO.admin.init) LO.admin.init();
    // expose for debugging
    LO.debug = { setTitleT(t) { titleT = t; }, get deathRoom() { return deathRoom; }, setGameTime(t) { gameTime = t; }, get cutscene() { return cutscene; }, get state() { return state; }, get world() { return world; }, get siren() { return siren; }, get player() { return player; }, get moths() { return moths; }, get sneaky() { return sneaky; }, get fastone() { return fastone; }, startGame, startEnding, beginPlay };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
