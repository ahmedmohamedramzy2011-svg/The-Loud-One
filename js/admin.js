// ============================================================
//  THE LOUD ONE — Admin & Testing Panel
//  Comprehensive live QA controls: entities, player cheats,
//  teleports, evidence, world tools, time scale & debug visuals
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const $ = id => document.getElementById(id);

  const admin = {
    open: false,
    returnTo: 'title',     // 'play' | 'pause' | 'title'
    activeTab: 'entities', // 'entities' | 'hazards' | 'player' | 'world' | 'debug'
    freezeWhenOpen: true,
    timeScale: 1,
    // cheats & overrides
    god: false,
    infStamina: false,
    infBattery: false,
    zeroNoise: false,
    noclip: false,
    fullbright: false,
    noFog: false,
    speedMult: 1,
    sirenIgnore: false,
    sirenFreeze: false,
    noFastOne: false,
    noSneaky: false,
    noMoths: false,
    noSilent: false,
    noTenant: false,
    noExposure: false,
    // hazards
    noHazards: false,
    noPowerlines: false,
    noBearTraps: false,
    noSteam: false,
    noNoiseHazards: false,
    // 3D debug helpers
    dbgSiren: false,
    dbgEvidence: false,
    dbgHideSpots: false,
    dbgHazards: false,
    dbgFreezeBirds: false,
    // multiplayer admin controls
    adminJoinHidden: true,
    sessions: [],
    sessionsLoading: false,
    sessionsError: '',
  };
  window.LO = window.LO || {};
  LO.admin = admin;

  const host = () => LO.adminHost;
  let statusMsg = '';
  let statusTimer = null;
  let uiAccum = 0;

  // 3D overlay scene references (rebuilt automatically if scene changes)
  let dbgScene = null;
  let dbgGroup = null;
  let dbgSirenLine = null;
  let dbgSirenTarget = null;
  let dbgEvidenceGroup = null;
  let dbgHideGroup = null;
  let dbgHazardGroup = null;

  function setStatus(msg) {
    statusMsg = msg || '';
    const el = $('adm-toast');
    if (el) {
      el.textContent = statusMsg;
      el.classList.toggle('show', !!statusMsg);
    }
    clearTimeout(statusTimer);
    if (statusMsg) {
      statusTimer = setTimeout(() => {
        statusMsg = '';
        if ($('adm-toast')) $('adm-toast').classList.remove('show');
      }, 3200);
    }
  }

  function inRun() {
    const H = host();
    if (!H) return false;
    const s = H.getState();
    return s === 'play' || s === 'paused';
  }

  function ensurePlayContext() {
    const H = host();
    if (!H) return false;
    const s = H.getState();
    if (s === 'play' || s === 'paused') return true;
    setStatus('Start a run first (use "Start Play (Skip Intro)" below).');
    return false;
  }

  function isBlocked(world, x, z, y) {
    if (!world || !world.colliders) return false;
    const r = 0.45;
    const py = y || 0;
    const cols = world.queryColliders ? world.queryColliders(x, z, r + 0.5) : world.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.disabled || c.maxY < py + 0.3 || c.minY > py + 1.75) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    const evc = world.evColliders;
    if (evc && evc.length) {
      for (let i = 0; i < evc.length; i++) {
        const c = evc[i];
        if (c.disabled || c.maxY < py + 0.3 || c.minY > py + 1.75) continue;
        if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
      }
    }
    return false;
  }

  function safeTeleport(pos, lookAt) {
    const H = host();
    if (!H || !ensurePlayContext()) return;
    const player = H.getPlayer();
    const world = H.getWorld();
    if (!player || !world) return;
    if (player.hidden || player.hideAnim) player.ejectFromHide();

    let tx = pos.x, tz = pos.z;
    const baseY = pos.y || 0;
    const targetFloor = admin.noclip
      ? Math.max(0.2, baseY || 0.2)
      : (world.floorHeightAt ? world.floorHeightAt(tx, tz, baseY + 0.5) : baseY);
    if (!admin.noclip && isBlocked(world, tx, tz, targetFloor)) {
      let found = false;
      const radii = [1.5, 2.8, 4.2, 6.0];
      for (const rad of radii) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const cx = pos.x + Math.cos(a) * rad, cz = pos.z + Math.sin(a) * rad;
          const cf = world.floorHeightAt ? world.floorHeightAt(cx, cz, baseY + 0.5) : baseY;
          if (!isBlocked(world, cx, cz, cf)) { tx = cx; tz = cz; found = true; break; }
        }
        if (found) break;
      }
      if (!found && world.projectToStreet && targetFloor < 1.5) {
        const sp = world.projectToStreet(pos);
        tx = sp.x; tz = sp.z;
      }
    }
    const finalY = admin.noclip
      ? Math.max(0.2, baseY || 0.2)
      : (world.floorHeightAt ? world.floorHeightAt(tx, tz, baseY + 0.5) : baseY);
    player.pos.set(tx, finalY, tz);
    player.vel.set(0, 0, 0);
    player.onGround = true;
    player.fallPeakY = finalY;
    if (lookAt) {
      const dx = lookAt.x - tx, dz = lookAt.z - tz;
      player.yaw = Math.atan2(-dx, -dz);
      const dy = (lookAt.y !== undefined ? lookAt.y : (finalY + 1.5)) - (finalY + 1.62);
      player.pitch = Math.max(-1.0, Math.min(1.0, Math.atan2(dy, Math.hypot(dx, dz) || 1)));
    }
    player.applyCamera(0.016, H.getGameTime());
  }

  // ---------------- Debug 3D Scene Helpers ----------------
  function disposeGroup(g) {
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }

  function syncDebugVisuals() {
    const H = host();
    if (!H) return;
    const scene = H.getScene();
    const world = H.getWorld();
    const siren = H.getSiren();
    if (!scene) return;

    const hazards = H.getHazards ? H.getHazards() : null;
    const anyOn = admin.dbgSiren || admin.dbgEvidence || admin.dbgHideSpots || admin.dbgHazards;
    if (!anyOn) {
      if (dbgGroup) { disposeGroup(dbgGroup); dbgGroup = null; dbgScene = null; dbgSirenLine = null; dbgSirenTarget = null; dbgEvidenceGroup = null; dbgHideGroup = null; dbgHazardGroup = null; }
      return;
    }

    if (dbgScene !== scene) {
      if (dbgGroup) disposeGroup(dbgGroup);
      dbgGroup = new THREE.Group();
      scene.add(dbgGroup);
      dbgScene = scene;
      dbgSirenLine = null; dbgSirenTarget = null;
      dbgEvidenceGroup = null; dbgHideGroup = null; dbgHazardGroup = null;
    }

    // 1. Siren Head path & target marker
    if (admin.dbgSiren && siren) {
      if (!dbgSirenTarget) {
        dbgSirenTarget = new THREE.Mesh(
          new THREE.SphereGeometry(0.9, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: true })
        );
        dbgGroup.add(dbgSirenTarget);
      }
      if (!dbgSirenLine) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
        dbgSirenLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff4444 }));
        dbgSirenLine.frustumCulled = false;
        dbgGroup.add(dbgSirenLine);
      }
      const tgt = siren.fenceLockPos || siren.lastHeard || siren.pos;
      dbgSirenTarget.visible = true;
      dbgSirenTarget.position.set(tgt.x, 3.0, tgt.z);

      const pts = [new V3(siren.pos.x, 3.0, siren.pos.z)];
      if (siren.path && siren.path.length) {
        for (let i = 0; i < Math.min(20, siren.path.length); i++) {
          pts.push(new V3(siren.path[i].x, 3.0, siren.path[i].z));
        }
      }
      pts.push(new V3(tgt.x, 3.0, tgt.z));
      const posAttr = dbgSirenLine.geometry.attributes.position;
      for (let i = 0; i < Math.min(24, pts.length); i++) {
        posAttr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
      }
      posAttr.needsUpdate = true;
      dbgSirenLine.geometry.setDrawRange(0, Math.min(24, pts.length));
      dbgSirenLine.visible = true;
    } else {
      if (dbgSirenTarget) dbgSirenTarget.visible = false;
      if (dbgSirenLine) dbgSirenLine.visible = false;
    }

    // 2. Evidence beacons
    if (admin.dbgEvidence && world && world.evidence) {
      if (!dbgEvidenceGroup || dbgEvidenceGroup._evRef !== world.evidence) {
        if (dbgEvidenceGroup) disposeGroup(dbgEvidenceGroup);
        dbgEvidenceGroup = new THREE.Group();
        dbgEvidenceGroup._evRef = world.evidence;
        const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 28, 6);
        world.evidence.forEach(ev => {
          const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.45, depthWrite: false }));
          beam.position.set(ev.pos.x, 14, ev.pos.z);
          beam._ev = ev;
          dbgEvidenceGroup.add(beam);
        });
        dbgGroup.add(dbgEvidenceGroup);
      }
      dbgEvidenceGroup.visible = true;
      dbgEvidenceGroup.children.forEach(c => {
        c.visible = !(c._ev && c._ev.found);
      });
    } else if (dbgEvidenceGroup) {
      dbgEvidenceGroup.visible = false;
    }

    // 3. Hiding spots coverage markers
    if (admin.dbgHideSpots && world && world.hideSpots) {
      if (!dbgHideGroup || dbgHideGroup._spotCount !== world.hideSpots.length) {
        if (dbgHideGroup) disposeGroup(dbgHideGroup);
        dbgHideGroup = new THREE.Group();
        dbgHideGroup._spotCount = world.hideSpots.length;
        const boxGeo = new THREE.OctahedronGeometry(0.5, 0);
        world.hideSpots.forEach(sp => {
          const isDumpster = sp.type === 'dumpster';
          const m = new THREE.Mesh(
            boxGeo,
            new THREE.MeshBasicMaterial({ color: isDumpster ? 0x38aaff : 0x55ee77, wireframe: true })
          );
          m.position.set(sp.pos.x, (sp.baseY || 0) + 4.0, sp.pos.z);
          m._sp = sp;
          dbgHideGroup.add(m);
        });
        dbgGroup.add(dbgHideGroup);
      }
      dbgHideGroup.visible = true;
      dbgHideGroup.children.forEach(c => {
        c.visible = !(c._sp && c._sp.disabled);
        c.rotation.y += 0.03;
      });
    } else if (dbgHideGroup) {
      dbgHideGroup.visible = false;
    }

    // 4. Hazard beacons
    if (admin.dbgHazards && hazards && hazards.list && hazards.list.length) {
      if (!dbgHazardGroup || dbgHazardGroup._hazRef !== hazards.list) {
        if (dbgHazardGroup) disposeGroup(dbgHazardGroup);
        dbgHazardGroup = new THREE.Group();
        dbgHazardGroup._hazRef = hazards.list;
        const hazGeo = new THREE.OctahedronGeometry(0.45, 0);
        const cols = {
          powerline: 0x55d8ff,
          beartrap: 0xff5544,
          steam: 0xffaa33,
          glass: 0xb8ecff,
          floorboard: 0xd8a862,
          tindebris: 0xd4d8dc,
        };
        for (let i = 0; i < hazards.list.length; i++) {
          const h = hazards.list[i];
          const m = new THREE.Mesh(
            hazGeo,
            new THREE.MeshBasicMaterial({ color: cols[h.type] || 0xf0a830, wireframe: true })
          );
          m.position.set(h.pos.x, (h.pos.y || 0) + 2.8, h.pos.z);
          m._h = h;
          dbgHazardGroup.add(m);
        }
        dbgGroup.add(dbgHazardGroup);
      }
      dbgHazardGroup.visible = true;
      for (let i = 0; i < dbgHazardGroup.children.length; i++) {
        const c = dbgHazardGroup.children[i];
        const h = c._h;
        c.visible = !!(h && h.group && h.group.visible && !h.disarmed && !h.toppled);
        c.rotation.y += 0.035;
      }
    } else if (dbgHazardGroup) {
      dbgHazardGroup.visible = false;
    }
  }

  // ---------------- Open / Close Panel ----------------
  admin.openPanel = function (from) {
    const tok = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
    if (!LO.isTesting || !tok) {
      if (admin.open) admin.closePanel(true);
      return;
    }
    const H = host();
    if (!H) return;
    if (admin.open) return;
    admin.returnTo = from || H.getState() || 'title';
    admin.open = true;

    if (admin.returnTo === 'play') {
      H.setPlayEnabled(false);
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (admin.returnTo === 'pause') {
      H.showScreen('pause', false);
    } else if (admin.returnTo === 'title') {
      H.showScreen('title', false);
    }

    renderBody();
    refreshLiveUI();
    $('admin-panel').classList.add('active');
    H.syncMatchIdUI && H.syncMatchIdUI();
    if (admin.activeTab === 'multiplayer') refreshSessions();
  };

  admin.closePanel = function (silentTransition) {
    if (!admin.open) return;
    const H = host();
    admin.open = false;
    $('admin-panel').classList.remove('active');
    if (H && H.syncMatchIdUI) H.syncMatchIdUI();
    if (silentTransition || !H) return;

    if (admin.returnTo === 'play' && H.getState() === 'play') {
      H.showScreen('hud', true);
      H.setPlayEnabled(true);
      H.syncClock();
      H.lockPointer();
    } else if (admin.returnTo === 'pause' && (H.getState() === 'paused' || (H.isPaused && H.isPaused()))) {
      H.showScreen('pause', true);
      H.showScreen('hud', true);
    } else if (H.getState() === 'title') {
      H.showScreen('title', true);
    }
  };

  admin.toggle = function (currentState) {
    const tok = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
    if (!LO.isTesting || !tok) {
      if (admin.open) admin.closePanel(true);
      return;
    }
    if (admin.open) {
      admin.closePanel();
      return;
    }
    if (currentState === 'gate' || currentState === 'opening' || currentState === 'ending' || currentState === 'credits' || currentState === 'dying') return;
    const H = host();
    const paused = currentState === 'paused' || !!(H && H.isPaused && H.isPaused());
    const from = paused ? 'pause' : currentState === 'play' ? 'play' : 'title';
    admin.openPanel(from);
  };

  // ---------------- Actions ----------------
  function doAction(act, arg) {
    const H = host();
    if (!H) return;
    const player = H.getPlayer();
    const world = H.getWorld();
    const siren = H.getSiren();
    const moths = H.getMoths();
    const sneaky = H.getSneaky();
    const fastone = H.getFastOne();
    const camera = H.getCamera();
    const gt = H.getGameTime();

    switch (act) {
      case 'start-play':
        admin.closePanel(true);
        H.startPlay();
        setStatus('Jumped straight into Hollow Creek.');
        return;

      case 'restart-run':
        admin.closePanel(true);
        H.startPlay();
        return;

      case 'go-title':
        admin.closePanel(true);
        H.goTitle();
        return;

      // ---- Fast One ----
      case 'fo-spawn':
        if (!ensurePlayContext() || !fastone) return;
        admin.noFastOne = false;
        fastone.forceSpawn(player, gt);
        setStatus('The Fast One breached the farthest fence!');
        break;
      case 'fo-chase':
        if (!ensurePlayContext() || !fastone) return;
        if (fastone.state === 'idle') fastone.forceSpawn(player, gt);
        if (fastone.state === 'telegraph') {
          fastone.state = 'chase';
          fastone.chaseT = 0;
          fastone.trailFade = 1;
        }
        setStatus('Fast One skipped straight to pursuit.');
        break;
      case 'fo-exit':
        if (!ensurePlayContext() || !fastone) return;
        if (fastone.state === 'idle') { setStatus('Fast One is idle.'); break; }
        fastone.startExit(player);
        setStatus('Fast One forced into distant exit sprint.');
        break;
      case 'fo-despawn':
        if (!ensurePlayContext() || !fastone) return;
        fastone.clearHighlight();
        fastone.finishEncounter();
        setStatus('Fast One dismissed.');
        break;
      case 'fo-timer3':
        if (!ensurePlayContext() || !fastone) return;
        if (fastone.state !== 'idle') fastone.finishEncounter();
        LO.ambush.active = null; LO.ambush.gapUntil = 0;
        fastone.cooldown = 0;
        fastone.timer = 3;
        setStatus('Fast One cooldown cleared & timer set to 3s.');
        break;

      // ---- Sneaky One ----
      case 'sn-spawn':
        if (!ensurePlayContext() || !sneaky) return;
        admin.noSneaky = false;
        sneaky.forceSpawn(player, camera);
        setStatus('The Sneaky One spawned right behind you!');
        break;
      case 'sn-vanish':
        if (!ensurePlayContext() || !sneaky) return;
        if (sneaky.attacking) sneaky.vanish(player, true);
        setStatus('The Sneaky One banished.');
        break;
      case 'sn-timer5':
        if (!ensurePlayContext() || !sneaky) return;
        LO.ambush.active = null; LO.ambush.gapUntil = 0;
        sneaky.timer = 5;
        setStatus('Sneaky One timer set to 5s.');
        break;

      // ---- Siren Head (single entity) ----
      case 'sh-wander':
        if (!ensurePlayContext() || !siren) return;
        siren.anger = 0; siren.hunting = false; siren.echoApproach = false;
        siren.fenceLockPos = null; siren.ignorePlayerUntil = 0; siren.fenceDistractUntil = 0;
        siren.setState('wander');
        setStatus('Siren Head set to WANDER.');
        break;
      case 'sh-investigate':
        if (!ensurePlayContext() || !siren) return;
        siren.lastHeard.copy(player.pos);
        siren.lastHeardTime = gt;
        siren.echoApproach = false;
        siren.fenceLockPos = null; siren.ignorePlayerUntil = 0; siren.fenceDistractUntil = 0;
        siren.setState('investigate');
        setStatus('Siren Head investigating your current position.');
        break;
      case 'sh-breach-far': {
        if (!ensurePlayContext() || !siren || !world) return;
        const f = fastone && fastone.farthestFence ? fastone.farthestFence(player.pos) : null;
        const pos = f ? f.pos : new V3(-90, 0, 90);
        siren.investigateFence(pos);
        setStatus('Siren Head locked onto farthest fence breach (12s commit, 1.5x speed).');
        break;
      }
      case 'sh-search':
        if (!ensurePlayContext() || !siren) return;
        siren.hunting = false;
        siren.lastHeard.copy(player.pos);
        siren.lastHeardTime = gt;
        siren.setState('search');
        setStatus('Siren Head searching near you.');
        break;
      case 'sh-hunt':
        if (!ensurePlayContext() || !siren) return;
        siren.anger = 100;
        siren.lastHeard.copy(player.pos);
        siren.lastHeardTime = gt;
        siren.fenceLockPos = null; siren.ignorePlayerUntil = 0; siren.fenceDistractUntil = 0;
        siren.startHunt(Math.hypot(player.pos.x - siren.pos.x, player.pos.z - siren.pos.z));
        setStatus('Siren Head HUNTING you!');
        break;
      case 'sh-echo':
        if (!ensurePlayContext() || !siren) return;
        siren.echoTimer = 0;
        setStatus('Echolocation ping queued.');
        break;
      case 'sh-tp-near': {
        if (!ensurePlayContext() || !siren || !world) return;
        const dest = world.projectToStreet({
          x: player.pos.x - Math.sin(player.yaw) * 35,
          z: player.pos.z - Math.cos(player.yaw) * 35,
        });
        siren.pos.set(dest.x, 0, dest.z);
        siren.path = [];
        setStatus('Teleported Siren Head ~35m ahead on street.');
        break;
      }
      case 'sh-tp-far':
        if (!ensurePlayContext() || !siren) return;
        siren.spawnFar();
        siren.path = [];
        setStatus('Teleported Siren Head to far town corner.');
        break;
      case 'sh-anger-0':
        if (!ensurePlayContext() || !siren) return;
        siren.anger = 0; siren.hunting = false;
        setStatus('Siren Head anger reset to 0%.');
        break;
      case 'sh-anger-100':
        if (!ensurePlayContext() || !siren) return;
        siren.anger = 100;
        setStatus('Siren Head anger set to 100%.');
        break;

      // ---- Moths / Silent / Tenant / Exposure ----
      case 'moth-shriek': {
        if (!ensurePlayContext() || !moths) return;
        const active = moths.moths.filter(m => m.active);
        if (!active.length) { setStatus('No active moths available.'); break; }
        active.sort((a, b) => a.g.position.distanceTo(player.pos) - b.g.position.distanceTo(player.pos));
        moths.shriek(active[0], player);
        setStatus('Triggered nearest moth shriek!');
        break;
      }
      case 'moth-reset':
        if (!ensurePlayContext() || !moths) return;
        moths.reset();
        setStatus('All moths reset & placed.');
        break;
      case 'silent-warn':
        if (!ensurePlayContext()) return;
        admin.noSilent = false; player.noSilent = false;
        player.silentTime = (LO.SILENT ? LO.SILENT.WARN : 20) + 2;
        setStatus('Silent One set to warning stage (22s).');
        break;
      case 'silent-atk':
        if (!ensurePlayContext()) return;
        admin.noSilent = false; player.noSilent = false;
        player.silentTime = (LO.SILENT ? LO.SILENT.ATTACK : 30) + 0.5;
        player.silentTick = 0;
        setStatus('Silent One attacking!');
        break;
      case 'silent-clear':
        if (!ensurePlayContext()) return;
        player.silentTime = 0; player.silentTick = 0;
        setStatus('Silent One timer cleared.');
        break;
      case 'tenant-max':
        if (!ensurePlayContext()) return;
        if (!player.hidden) { setStatus('Hide in a locker or dumpster first to test The Tenant.'); break; }
        admin.noTenant = false;
        player.hideTime = LO.TENANT_LIMIT - 0.8;
        setStatus('Tenant at critical threshold!');
        break;
      case 'tenant-clear':
        if (!ensurePlayContext()) return;
        player.hideTime = 0; player.tenantTick = 0;
        setStatus('Tenant agitation reset to 0s.');
        break;
      case 'tenant-blind':
        if (!ensurePlayContext()) return;
        if (!player.hidden) { setStatus('Hide inside a spot first, or press F while hiding.'); break; }
        player.blindTenant();
        setStatus('Tenant blinded!');
        break;
      case 'expo-show':
        if (!ensurePlayContext()) return;
        admin.noExposure = false;
        player.cameraUp = true;
        player.exposure = (LO.EXPO ? LO.EXPO.SHOW : 4) + 1.5;
        setStatus('Exposure raised to viewfinder stage (raise camera to see).');
        break;
      case 'expo-lunge':
        if (!ensurePlayContext()) return;
        admin.noExposure = false;
        player.cameraUp = true;
        player.exposure = (LO.EXPO ? LO.EXPO.LUNGE : 10) - 0.35;
        setStatus('Exposure about to lunge!');
        break;
      case 'expo-clear':
        if (!ensurePlayContext()) return;
        player.exposure = 0;
        setStatus('Exposure cleared.');
        break;

      // ---- Player Meters & Cheats ----
      case 'p-heal':
        if (!ensurePlayContext()) return;
        player.health = 100;
        setStatus('Health restored to 100 HP.');
        break;
      case 'p-dmg':
        if (!ensurePlayContext()) return;
        player.health = Math.max(1, player.health - 25);
        player.shake = Math.max(player.shake, 0.35);
        setStatus(`Health set to ${Math.ceil(player.health)} HP.`);
        break;
      case 'p-stamina':
        if (!ensurePlayContext()) return;
        player.stamina = 100; player.exhausted = false; player.windedTimer = 0; player.panting = 0;
        setStatus('Stamina refilled & Winded cleared.');
        break;
      case 'p-battery':
        if (!ensurePlayContext()) return;
        player.battery = 100;
        setStatus('Flashlight battery refilled to 100%.');
        break;
      case 'p-rocks':
        if (!ensurePlayContext()) return;
        player.rocks = LO.MAX_ROCKS || 3;
        setStatus(`Inventory set to ${player.rocks} rocks.`);
        break;
      case 'p-adrenaline':
        if (!ensurePlayContext()) return;
        player.adrenalineCooldown = 0;
        player.triggerAdrenaline(9.0);
        LO.audio.adrenaline && LO.audio.adrenaline();
        H.showHint('Adrenaline surge activated (Admin)!', 2600);
        setStatus('Adrenaline activated!');
        break;
      case 'p-adrenaline-cd':
        if (!ensurePlayContext()) return;
        player.adrenalineCooldown = 0;
        setStatus('Adrenaline cooldown reset to 0s.');
        break;
      case 'p-winded':
        if (!ensurePlayContext()) return;
        player.adrenalineArmed = true;
        player.startWinded();
        setStatus('Applied 5s Exhausted / Winded penalty.');
        break;
      case 'p-dizzy':
        if (!ensurePlayContext()) return;
        player.triggerDizzy(1.25);
        player.shake = Math.max(player.shake, 1.0);
        setStatus('Applied heavy shake & dizziness.');
        break;
      case 'p-give-map':
        if (!ensurePlayContext()) return;
        player.hasMap = true;
        if (world && world.wallMap) {
          world.wallMap.taken = true;
          if (world.wallMap.mesh) world.wallMap.mesh.visible = false;
          if (world.wallMap.building) world.wallMap.building.hasMap = false;
        }
        setStatus('Town Map granted (press M or Tab to view).');
        break;
      case 'p-clear-slow':
        if (!ensurePlayContext()) return;
        player.trapSlowTimer = 0;
        setStatus('Cleared bear trap slow.');
        break;

      // ---- World / Evidence / Teleports ----
      case 'ev-mark': {
        if (!ensurePlayContext() || !world) return;
        const ev = world.evidence[parseInt(arg, 10)];
        if (ev) { H.markEvidence(ev); setStatus(`Marked "${ev.name}" as found.`); }
        break;
      }
      case 'ev-tp': {
        if (!ensurePlayContext() || !world) return;
        const ev = world.evidence[parseInt(arg, 10)];
        if (ev) {
          const offsetPos = { x: ev.pos.x + 2.8, y: Math.max(0, (ev.pos.y || 0) - 0.8), z: ev.pos.z + 2.8 };
          safeTeleport(offsetPos, ev.pos);
          setStatus(`Teleported to ${ev.name}.`);
        }
        break;
      }
      case 'ev-4': {
        if (!ensurePlayContext() || !world) return;
        let count = H.getEvidenceCount();
        for (const ev of world.evidence) {
          if (count >= 4) break;
          if (!ev.found) { H.markEvidence(ev); count++; }
        }
        setStatus('Collected 4/5 evidence items.');
        break;
      }
      case 'ev-all':
        if (!ensurePlayContext() || !world) return;
        for (const ev of world.evidence) {
          if (H.getEvidenceCount() >= 5) break;
          if (!ev.found) H.markEvidence(ev);
        }
        setStatus('5/5 evidence marked! Ending sequence queued.');
        break;
      case 'ev-ending':
        if (!ensurePlayContext()) return;
        admin.closePanel(true);
        H.startEnding();
        return;
      case 'ev-reset':
        if (!ensurePlayContext()) return;
        H.resetEvidence();
        setStatus('All evidence reset to unfound.');
        break;
      case 'ev-hint':
        if (!ensurePlayContext()) return;
        H.unlockHint();
        setStatus('Hint unlocked & pointing to nearest evidence.');
        break;

      case 'tp-spawn':
        if (!ensurePlayContext() || !world) return;
        safeTeleport(world.spawn, { x: 0, y: 1.5, z: 0 });
        setStatus('Teleported to spawn car.');
        break;
      case 'tp-sheriff': {
        if (!ensurePlayContext() || !world) return;
        const sh = (world.enterables || []).find(b => b.sheriff);
        if (sh) {
          const p = sh.F.point(0, sh.hd + 4.5);
          safeTeleport({ x: p.x, y: 0, z: p.z }, { x: sh.cx, y: 1.5, z: sh.cz });
          setStatus('Teleported outside Sheriff\'s Station.');
        }
        break;
      }
      case 'tp-center':
        if (!ensurePlayContext()) return;
        safeTeleport({ x: 0, y: 0, z: 0 });
        setStatus('Teleported to town center (0, 0).');
        break;
      case 'tp-hide': {
        if (!ensurePlayContext() || !world) return;
        const spots = (world.hideSpots || []).filter(s => !s.disabled);
        if (!spots.length) break;
        spots.sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
        safeTeleport({ x: spots[0].exit.x, y: spots[0].baseY || spots[0].exit.y || 0, z: spots[0].exit.z }, spots[0].pos);
        setStatus(`Teleported to nearest ${spots[0].type}.`);
        break;
      }
      case 'tp-dumpster': {
        if (!ensurePlayContext() || !world) return;
        const dumpsters = (world.hideSpots || []).filter(s => !s.disabled && s.type === 'dumpster');
        if (!dumpsters.length) break;
        const cur = dumpsters.find(d => d.pos.distanceTo(player.pos) > 8) || dumpsters[0];
        dumpsters.sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
        const pick = dumpsters[0].pos.distanceTo(player.pos) < 5 && dumpsters[1] ? dumpsters[1] : cur;
        safeTeleport(pick.exit, pick.pos);
        setStatus('Teleported to exterior dumpster.');
        break;
      }
      case 'tp-fence': {
        if (!ensurePlayContext() || !world || !world.fences || !world.fences.length) return;
        let far = world.fences[0], bd = -1;
        for (const f of world.fences) {
          const d = f.pos.distanceTo(player.pos);
          if (d > bd) { bd = d; far = f; }
        }
        const inward = new V3(-far.pos.x, 0, -far.pos.z).normalize();
        safeTeleport({ x: far.pos.x + inward.x * 5, y: 0, z: far.pos.z + inward.z * 5 }, far.pos);
        setStatus('Teleported near farthest perimeter fence.');
        break;
      }
      case 'tp-wallmap': {
        if (!ensurePlayContext() || !world) return;
        const wm = world.wallMap;
        if (!wm || wm.disabled) { setStatus('Town Map disabled in selected game version.'); break; }
        const stepOut = 2.0;
        const px = wm.pos.x + Math.sin(wm.yaw) * stepOut;
        const pz = wm.pos.z + Math.cos(wm.yaw) * stepOut;
        safeTeleport({ x: px, y: wm.baseY || 0.14, z: pz }, wm.pos);
        setStatus(wm.taken ? 'Teleported to Wall Map building (already collected).' : 'Teleported inside facing the Town Wall Map.');
        break;
      }
      case 'tp-lookout': {
        if (!ensurePlayContext() || !world) return;
        if (!world.lookout) { setStatus('Fire Lookout Tower not available in selected game version.'); break; }
        const lx = world.lookout.x, lz = world.lookout.z;
        safeTeleport({ x: lx - 8, y: 0, z: lz }, { x: lx, y: 6, z: lz });
        setStatus('Teleported to Fire Lookout Tower clearing.');
        break;
      }

      case 'w-repair-fences':
        if (!ensurePlayContext() || !world || !world.fences) return;
        if (world.repairFences) {
          world.repairFences();
        } else {
          world.fences.forEach(f => {
            f.broken = false;
            f.mesh.visible = true;
            f.mesh.position.copy(f.basePos);
            f.mesh.rotation.copy(f.baseRot);
            if (f.collider) f.collider.disabled = false;
          });
        }
        setStatus('All perimeter fences repaired.');
        break;
      case 'w-smash-bldg': {
        if (!ensurePlayContext() || !world || !world.buildings) return;
        const cands = world.buildings.filter(b => !b.hasEvidence && !b.smashed);
        if (!cands.length) { setStatus('No non-evidence buildings left to smash.'); break; }
        cands.sort((a, b) => Math.hypot(a.cx - player.pos.x, a.cz - player.pos.z) - Math.hypot(b.cx - player.pos.x, b.cz - player.pos.z));
        const b = cands[0];
        const dir = { x: Math.sin(siren ? siren.yaw : 0), z: Math.cos(siren ? siren.yaw : 0) };
        if (world.smashBuilding(b, new V3(b.cx, 0, b.cz), dir)) {
          LO.audio.buildingSmash && LO.audio.buildingSmash(new V3(b.cx, 0, b.cz));
          const d = Math.hypot(b.cx - player.pos.x, b.cz - player.pos.z);
          if (d < 120) player.shake = Math.max(player.shake, Math.max(0.4, 1.2 * (1 - d / 120)));
          if (d < 100) player.triggerDizzy(Math.max(0.45, 1.1 * (1 - d / 100)));
          setStatus('Smashed nearest non-evidence building!');
        }
        break;
      }
      case 'w-restore-bldgs':
        if (!ensurePlayContext() || !world || !world.buildings) return;
        world.buildings.forEach(b => { if (b.smashed && b.restore) b.restore(); });
        setStatus('Restored all smashed buildings.');
        break;
      case 'w-scatter-birds':
        if (!ensurePlayContext()) return;
        if (H.scatterBirds && H.scatterBirds()) setStatus('Scattered nearby perched birds!');
        else setStatus('No perched birds nearby to scatter.');
        break;

      // ---- Hazards ----
      case 'haz-tp': {
        if (!ensurePlayContext()) return;
        const haz = H.getHazards && H.getHazards();
        if (!haz || !haz.list || !haz.list.length) { setStatus('Hazards not spawned.'); break; }
        const matches = haz.list.filter(h => h.type === arg);
        if (!matches.length) { setStatus(`No ${arg} hazards found in this world.`); break; }
        matches.sort((a, b) => Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z) - Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z));
        const pick = matches[0];
        const baseY = pick.pos.y > 1.5 ? pick.pos.y : 0;
        safeTeleport({ x: pick.pos.x + 2.7, y: baseY, z: pick.pos.z + 2.7 }, pick.pos);
        setStatus(`Teleported near ${pick.label}.`);
        break;
      }
      case 'haz-disarm-traps': {
        if (!ensurePlayContext()) return;
        const haz = H.getHazards && H.getHazards();
        const n = haz && haz.disarmAllTraps ? haz.disarmAllTraps() : 0;
        setStatus(`Disarmed ${n} bear trap${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'haz-reset-tin': {
        if (!ensurePlayContext()) return;
        const haz = H.getHazards && H.getHazards();
        const n = haz && haz.resetTin ? haz.resetTin() : 0;
        setStatus(`Restored ${n} tin debris pile${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'haz-reset-all': {
        if (!ensurePlayContext()) return;
        const haz = H.getHazards && H.getHazards();
        if (haz && haz.reset) haz.reset();
        setStatus('All hazards reset to active/initial state.');
        break;
      }

      case 'timescale':
        admin.timeScale = parseFloat(arg) || 1;
        setStatus(`Time scale set to ${admin.timeScale}x`);
        break;

      case 'speedmult':
        admin.speedMult = parseFloat(arg) || 1;
        setStatus(`Player speed multiplier set to ${admin.speedMult}x`);
        break;

      // ---- Test Death Screens ----
      case 'die':
        if (!ensurePlayContext()) return;
        H.triggerDeath(arg || 'siren');
        return;
    }
    renderBody();
    refreshLiveUI();
    syncDebugVisuals();
  }

  function toggleFlag(key) {
    const H = host();
    admin[key] = !admin[key];
    if ((key === 'fullbright' || key === 'noFog') && H) H.applyAdminLighting();
    if (key === 'showFps') {
      LO.Settings && LO.Settings.set('showFps', !LO.settings.showFps);
      admin.showFps = !!LO.settings.showFps;
    }
    if (key === 'dbgSiren' || key === 'dbgEvidence' || key === 'dbgHideSpots' || key === 'dbgHazards') syncDebugVisuals();
    renderBody();
    refreshLiveUI();
  }

  // ---------------- Rendering ----------------
  function btn(label, act, arg, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'adm-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.onclick = () => { LO.audio && LO.audio.click(true); doAction(act, arg); };
    return b;
  }

  function toggleBtn(label, key, note) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = key === 'showFps' ? !!LO.settings.showFps : !!admin[key];
    b.className = 'adm-toggle' + (on ? ' on' : '');
    b.innerHTML = `<span>${label}${note ? `<small>${note}</small>` : ''}</span><b>${on ? 'ON' : 'OFF'}</b>`;
    b.onclick = () => { LO.audio && LO.audio.click(true); toggleFlag(key); };
    return b;
  }

  function group(title, elList) {
    const card = document.createElement('div');
    card.className = 'adm-card';
    const h = document.createElement('div');
    h.className = 'adm-card-title';
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'adm-grid';
    elList.forEach(el => grid.appendChild(el));
    card.append(h, grid);
    return card;
  }

  function renderBody() {
    const body = $('adm-body');
    if (!body) return;
    body.innerHTML = '';

    document.querySelectorAll('#adm-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === admin.activeTab);
    });
    const fw = $('adm-freeze-btn');
    if (fw) {
      fw.classList.toggle('on', admin.freezeWhenOpen);
      fw.textContent = admin.freezeWhenOpen ? 'FREEZE WHEN OPEN: ON' : 'FREEZE WHEN OPEN: OFF';
    }

    const H = host();
    if (!inRun() && admin.activeTab !== 'multiplayer') {
      const banner = document.createElement('div');
      banner.className = 'adm-banner';
      const txt = document.createElement('span');
      txt.textContent = 'Currently on Title / Outside Play — start immediately to test entities & teleports.';
      banner.append(txt, btn('START PLAY (SKIP INTRO)', 'start-play', null, 'primary'));
      body.appendChild(banner);
    }

    if (admin.activeTab === 'entities') {
      body.appendChild(group('THE FAST ONE (PHENOMENON-242)', [
        btn('Spawn Breach Now', 'fo-spawn', null, 'danger'),
        btn('Skip Telegraph -> Chase', 'fo-chase'),
        btn('Force Distant Exit', 'fo-exit'),
        btn('Finish / Despawn', 'fo-despawn'),
        btn('Set Timer = 3s', 'fo-timer3'),
        toggleBtn('Disable Fast One', 'noFastOne'),
      ]));

      body.appendChild(group('THE SNEAKY ONE (PHENOMENON-241)', [
        btn('Ambush Behind Now', 'sn-spawn', null, 'danger'),
        btn('Banish / Vanish Now', 'sn-vanish'),
        btn('Set Timer = 5s', 'sn-timer5'),
        toggleBtn('Disable Sneaky One', 'noSneaky'),
      ]));

      body.appendChild(group('SIREN HEAD (SINGLE ENTITY CONTROLS)', [
        btn('State: Wander', 'sh-wander'),
        btn('State: Investigate Here', 'sh-investigate'),
        btn('State: Breach Far Fence', 'sh-breach-far'),
        btn('State: Search Here', 'sh-search'),
        btn('State: Hunt Me', 'sh-hunt', null, 'danger'),
        btn('Trigger Echo Ping', 'sh-echo'),
        btn('TP ~35m Front (Street)', 'sh-tp-near'),
        btn('TP Far Corner', 'sh-tp-far'),
        btn('Anger -> 0%', 'sh-anger-0'),
        btn('Anger -> 100%', 'sh-anger-100'),
        toggleBtn('Ignore Player / No Catch', 'sirenIgnore', 'Allows watching AI safely'),
        toggleBtn('Freeze Siren AI', 'sirenFreeze'),
      ]));

      body.appendChild(group('THE MOTHS · SILENT ONE · TENANT · EXPOSURE', [
        btn('Shriek Nearest Moth', 'moth-shriek'),
        btn('Reset All Moths', 'moth-reset'),
        toggleBtn('Disable Moth Shrieks', 'noMoths'),
        btn('Silent One: Warn (22s)', 'silent-warn'),
        btn('Silent One: Attack (31s)', 'silent-atk', null, 'danger'),
        btn('Silent One: Clear (0s)', 'silent-clear'),
        toggleBtn('Disable Silent One', 'noSilent'),
        btn('Tenant: Max Agitation', 'tenant-max', null, 'danger'),
        btn('Tenant: Reset (0s)', 'tenant-clear'),
        btn('Tenant: Blind Flash', 'tenant-blind'),
        toggleBtn('Disable Tenant', 'noTenant'),
        btn('Exposure: Viewfinder (5s)', 'expo-show'),
        btn('Exposure: Pre-Lunge (9.5s)', 'expo-lunge', null, 'danger'),
        btn('Exposure: Clear', 'expo-clear'),
        toggleBtn('Disable Exposure', 'noExposure'),
      ]));
    } else if (admin.activeTab === 'hazards') {
      const haz = H && H.getHazards && H.getHazards();
      const sum = haz && haz.getSummary ? haz.getSummary() : null;
      const summaryNote = sum
        ? `Powerlines:${sum.powerline} · Traps:${sum.beartrapActive}/${sum.beartrap} · Steam:${sum.steam} · Glass:${sum.glass} · Boards:${sum.floorboard} · Tin:${sum.tinIntact}/${sum.tindebris}`
        : 'Hazards spawn during active play.';
      const banner = document.createElement('div');
      banner.className = 'adm-banner';
      const txt = document.createElement('span');
      txt.textContent = summaryNote;
      banner.append(txt);
      body.appendChild(banner);

      body.appendChild(group('HAZARD TOGGLES & VISUALS', [
        toggleBtn('Disable All Hazards', 'noHazards', 'Master switch for all 6 types'),
        toggleBtn('Disable Power Lines', 'noPowerlines', 'Street puddle shock arcs'),
        toggleBtn('Disable Bear Traps', 'noBearTraps', 'Forest trail traps + slow'),
        toggleBtn('Disable Steam Leaks', 'noSteam', 'Alley pipe bursts'),
        toggleBtn('Disable Noise Hazards', 'noNoiseHazards', 'Glass, boards, tin piles'),
        toggleBtn('Show Hazard Beacons', 'dbgHazards', 'Floating diamonds above hazards'),
      ]));

      body.appendChild(group('TELEPORT TO NEAREST HAZARD', [
        btn('Nearest Power Line', 'haz-tp', 'powerline'),
        btn('Nearest Bear Trap', 'haz-tp', 'beartrap'),
        btn('Nearest Steam Leak', 'haz-tp', 'steam'),
        btn('Nearest Broken Glass', 'haz-tp', 'glass'),
        btn('Nearest Creak Boards', 'haz-tp', 'floorboard'),
        btn('Nearest Tin Debris', 'haz-tp', 'tindebris'),
      ]));

      body.appendChild(group('HAZARD STATE ACTIONS', [
        btn('Disarm All Bear Traps', 'haz-disarm-traps'),
        btn('Restore Tin Debris', 'haz-reset-tin'),
        btn('Reset All Hazards', 'haz-reset-all', null, 'primary'),
        btn('Clear Bear Trap Slow', 'p-clear-slow'),
      ]));

      body.appendChild(group('TEST HAZARD DEATH TAPES', [
        btn('Die: Power Line (Zap)', 'die', 'powerline', 'danger'),
        btn('Die: Bear Trap (Jaws)', 'die', 'beartrap', 'danger'),
        btn('Die: Steam Leak (Scald)', 'die', 'steam', 'danger'),
      ]));
    } else if (admin.activeTab === 'player') {
      body.appendChild(group('SURVIVAL & UTILITY CHEATS', [
        toggleBtn('God Mode (Invincible)', 'god', 'Blocks all damage & catches'),
        toggleBtn('Infinite Stamina', 'infStamina', 'No exhaustion or winded'),
        toggleBtn('Infinite Battery', 'infBattery', 'Also free Tenant blinds'),
        toggleBtn('Zero Noise (0m)', 'zeroNoise', 'Silent sprint / jump / light'),
        toggleBtn('Noclip / Fly Mode', 'noclip', 'Space up · C/Ctrl down'),
        toggleBtn('Fullbright + Clear Fog', 'fullbright', 'Bright night inspection'),
      ]));

      body.appendChild(group('METERS & STATUS EFFECTS', [
        btn('Heal 100 HP', 'p-heal', null, 'primary'),
        btn('Damage -25 HP', 'p-dmg'),
        btn('Refill Stamina', 'p-stamina'),
        btn('Refill Battery 100%', 'p-battery'),
        btn('Give 3 Rocks', 'p-rocks'),
        btn('Trigger Adrenaline', 'p-adrenaline'),
        btn('Reset Adr. Cooldown', 'p-adrenaline-cd'),
        btn('Apply Winded (5s)', 'p-winded'),
        btn('Clear Bear Trap Slow', 'p-clear-slow'),
        btn('Test Dizzy + Shake', 'p-dizzy'),
        btn('Give Town Map', 'p-give-map', null, 'primary'),
      ]));

      const speedCard = document.createElement('div');
      speedCard.className = 'adm-card';
      const sh = document.createElement('div');
      sh.className = 'adm-card-title';
      sh.textContent = 'MOVEMENT SPEED MULTIPLIER';
      const sg = document.createElement('div');
      sg.className = 'adm-row-pills';
      [0.5, 1, 1.5, 2.5, 4].forEach(v => {
        const b = btn(v + 'x', 'speedmult', v, admin.speedMult === v ? 'active' : '');
        sg.appendChild(b);
      });
      speedCard.append(sh, sg);
      body.appendChild(speedCard);
    } else if (admin.activeTab === 'world') {
      const world = H && H.getWorld();
      const evCard = document.createElement('div');
      evCard.className = 'adm-card';
      const eh = document.createElement('div');
      eh.className = 'adm-card-title';
      eh.textContent = 'EVIDENCE CHECKLIST & TELEPORTS';
      const eList = document.createElement('div');
      eList.className = 'adm-ev-list';
      if (world && world.evidence && world.evidence.length) {
        world.evidence.forEach((ev, idx) => {
          const row = document.createElement('div');
          row.className = 'adm-ev-row' + (ev.found ? ' found' : '');
          const name = document.createElement('span');
          name.textContent = `${ev.found ? '✓ ' : '• '}${ev.name}`;
          const ctrls = document.createElement('div');
          ctrls.className = 'adm-ev-ctrls';
          ctrls.appendChild(btn('TP', 'ev-tp', idx));
          if (!ev.found) ctrls.appendChild(btn('Mark Found', 'ev-mark', idx));
          row.append(name, ctrls);
          eList.appendChild(row);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'adm-muted';
        empty.textContent = 'No world evidence loaded.';
        eList.appendChild(empty);
      }
      const bulk = document.createElement('div');
      bulk.className = 'adm-grid';
      bulk.style.marginTop = '10px';
      bulk.append(
        btn('Collect 4 / 5', 'ev-4'),
        btn('Collect 5 / 5 (Queue Ending)', 'ev-all', null, 'primary'),
        btn('Trigger Ending Cutscene', 'ev-ending'),
        btn('Reset Evidence', 'ev-reset'),
        btn('Unlock Hint Now', 'ev-hint')
      );
      evCard.append(eh, eList, bulk);
      body.appendChild(evCard);

      body.appendChild(group('LANDMARK TELEPORTS', [
        btn('Spawn Car', 'tp-spawn'),
        btn('Sheriff\'s Station', 'tp-sheriff'),
        btn('Fire Lookout Tower', 'tp-lookout'),
        btn('Center Crossroads', 'tp-center'),
        btn('Nearest Hiding Spot', 'tp-hide'),
        btn('Nearest Exterior Dumpster', 'tp-dumpster'),
        btn('Farthest Perimeter Fence', 'tp-fence'),
        btn('Wall Map Location', 'tp-wallmap'),
      ]));

      body.appendChild(group('WORLD & PROPS', [
        btn('Repair All Fences', 'w-repair-fences'),
        btn('Smash Nearest Building', 'w-smash-bldg'),
        btn('Restore Smashed Buildings', 'w-restore-bldgs'),
        btn('Scatter Nearby Birds', 'w-scatter-birds'),
        btn('Restart Run (Skip Intro)', 'restart-run'),
        btn('Quit To Title', 'go-title'),
      ]));

      const tsCard = document.createElement('div');
      tsCard.className = 'adm-card';
      const th = document.createElement('div');
      th.className = 'adm-card-title';
      th.textContent = 'SIMULATION TIME SCALE';
      const tg = document.createElement('div');
      tg.className = 'adm-row-pills';
      [0.25, 0.5, 1, 2].forEach(v => {
        tg.appendChild(btn(v + 'x', 'timescale', v, admin.timeScale === v ? 'active' : ''));
      });
      tsCard.append(th, tg);
      body.appendChild(tsCard);
    } else if (admin.activeTab === 'debug') {
      const rend = H && H.getRenderer && H.getRenderer();
      const world = H && H.getWorld && H.getWorld();
      const haz = H && H.getHazards && H.getHazards();
      const info = rend && rend.info ? rend.info : null;
      const perfCard = document.createElement('div');
      perfCard.className = 'adm-card';
      const ph = document.createElement('div');
      ph.className = 'adm-card-title';
      ph.textContent = 'LIVE PERF & PARTS TELEMETRY';
      const pBody = document.createElement('div');
      pBody.className = 'adm-muted';
      pBody.style.lineHeight = '1.55';
      pBody.innerHTML = info
        ? `Draw Calls: <b>${info.render.calls}</b> · Triangles: <b>${info.render.triangles.toLocaleString()}</b> · Geometries: <b>${info.memory.geometries}</b> · Textures: <b>${info.memory.textures}</b><br>` +
          `Tree Colliders: <b>${world && world.treeColliders ? world.treeColliders.length : 0}</b> · Occluders: <b>${world && world.occluders ? world.occluders.length : 0}</b> · Birds: <b>${world && world.birds ? world.birds.length : 0}</b> · Hazards: <b>${haz && haz.list ? haz.list.length : 0}</b>`
        : 'Renderer telemetry unavailable.';
      perfCard.append(ph, pBody);
      body.appendChild(perfCard);

      body.appendChild(group('3D DEBUG OVERLAYS & STATS', [
        toggleBtn('Siren Head Path & Target', 'dbgSiren', 'Red line + target sphere'),
        toggleBtn('Unfound Evidence Beams', 'dbgEvidence', 'Tall cyan beacons'),
        toggleBtn('Hiding Spot Markers', 'dbgHideSpots', 'Blue dumpster · Green locker'),
        toggleBtn('Hazard Beacons', 'dbgHazards', 'Color-coded diamonds above hazards'),
        toggleBtn('Freeze Bird Flocks', 'dbgFreezeBirds', 'Stops bird scatter & flapping'),
        toggleBtn('Disable Scene Fog', 'noFog', 'Clear long-distance visibility'),
        toggleBtn('Show FPS Counter', 'showFps'),
      ]));

      body.appendChild(group('TEST DEATH SCREENS & CRT TAPES', [
        btn('Die: Siren Head', 'die', 'siren', 'danger'),
        btn('Die: The Fast One', 'die', 'fastone', 'danger'),
        btn('Die: The Sneaky One', 'die', 'sneaky', 'danger'),
        btn('Die: The Silent One', 'die', 'silent', 'danger'),
        btn('Die: The Tenant', 'die', 'tenant', 'danger'),
        btn('Die: The Moths', 'die', 'moth', 'danger'),
        btn('Die: The Exposure', 'die', 'exposure', 'danger'),
        btn('Die: Power Line', 'die', 'powerline', 'danger'),
        btn('Die: Bear Trap', 'die', 'beartrap', 'danger'),
        btn('Die: Steam Leak', 'die', 'steam', 'danger'),
        btn('Die: Fall Damage', 'die', 'fall', 'danger'),
      ]));
    } else if (admin.activeTab === 'multiplayer') {
      const Net = LO.Net;
      if (Net && Net.isCoop && Net.isCoop() && Net.roomCode) {
        const curBanner = document.createElement('div');
        curBanner.className = 'adm-banner';
        const curTxt = document.createElement('span');
        curTxt.textContent = `Current Match ID: ${Net.roomCode} (${Net.isHost() ? 'HOST' : 'CLIENT'}${Net.localHiddenAdmin ? ' · HIDDEN SPECTATOR' : ''})`;
        const curCopy = document.createElement('button');
        curCopy.type = 'button';
        curCopy.className = 'adm-btn';
        curCopy.textContent = 'Copy Match ID';
        curCopy.onclick = () => {
          LO.audio && LO.audio.click(true);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(Net.roomCode).catch(() => {});
          }
          setStatus(`Copied Match ID: ${Net.roomCode}`);
        };
        curBanner.append(curTxt, curCopy);
        body.appendChild(curBanner);
      }

      const card = document.createElement('div');
      card.className = 'adm-card';
      const head = document.createElement('div');
      head.className = 'adm-sess-head';
      const title = document.createElement('div');
      title.className = 'adm-card-title';
      title.style.marginBottom = '0';
      title.style.borderBottom = 'none';
      title.style.paddingBottom = '0';
      title.textContent = 'ACTIVE MULTIPLAYER SESSIONS';

      const ctrls = document.createElement('div');
      ctrls.style.display = 'flex';
      ctrls.style.flexWrap = 'wrap';
      ctrls.style.gap = '6px';
      ctrls.style.alignItems = 'center';

      const hiddenToggle = toggleBtn('Hidden Spectator Join', 'adminJoinHidden', 'Join invisibly without player slot');
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'adm-btn primary';
      refreshBtn.textContent = admin.sessionsLoading ? 'Refreshing...' : 'Refresh';
      refreshBtn.disabled = !!admin.sessionsLoading;
      refreshBtn.onclick = () => {
        LO.audio && LO.audio.click(true);
        refreshSessions();
      };
      ctrls.append(hiddenToggle, refreshBtn);
      head.append(title, ctrls);
      card.appendChild(head);

      const listEl = document.createElement('div');
      listEl.className = 'adm-sess-list';

      if (admin.sessionsError) {
        const errEl = document.createElement('div');
        errEl.className = 'adm-muted';
        errEl.style.color = '#ff8a80';
        errEl.textContent = admin.sessionsError;
        listEl.appendChild(errEl);
      } else if (admin.sessionsLoading && (!admin.sessions || !admin.sessions.length)) {
        const loadingEl = document.createElement('div');
        loadingEl.className = 'adm-muted';
        loadingEl.textContent = 'Querying active multiplayer sessions...';
        listEl.appendChild(loadingEl);
      } else if (!admin.sessions || !admin.sessions.length) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'adm-muted';
        emptyEl.textContent = 'No active multiplayer sessions found (25s heartbeat TTL). Host a Co-op room or click Refresh.';
        listEl.appendChild(emptyEl);
      } else {
        admin.sessions.forEach(sess => {
          const row = document.createElement('div');
          row.className = 'adm-sess-row';

          const info = document.createElement('div');
          info.className = 'adm-sess-info';

          const top = document.createElement('div');
          top.className = 'adm-sess-top';
          const idBadge = document.createElement('span');
          idBadge.className = 'adm-sess-id';
          idBadge.textContent = sess.roomId || '-----';
          const hostName = document.createElement('span');
          hostName.textContent = `Host: ${sess.hostCallsign || 'Investigator 1'}`;
          top.append(idBadge, hostName);

          const meta = document.createElement('div');
          meta.className = 'adm-sess-meta';
          const playersTxt = `${sess.playerCount || 1}/${sess.maxPlayers || 4} Players`;
          const waveTxt = `${sess.wave || 'Lobby'} (${String(sess.status || 'lobby').toUpperCase()})`;
          const uptimeTxt = `Uptime ${formatUptime(sess.uptimeMs)}`;
          meta.textContent = `${playersTxt} · ${waveTxt} · ${uptimeTxt}`;

          info.append(top, meta);

          const actions = document.createElement('div');
          actions.className = 'adm-sess-actions';

          const joinBtn = document.createElement('button');
          joinBtn.type = 'button';
          joinBtn.className = 'adm-btn primary';
          const isHere = !!(Net && Net.isCoop && Net.isCoop() && Net.roomCode === sess.roomId);
          joinBtn.textContent = isHere ? 'Connected' : (admin.adminJoinHidden ? 'Join (Hidden)' : 'Join Match');
          joinBtn.disabled = isHere;
          joinBtn.onclick = async () => {
            LO.audio && LO.audio.click(true);
            if (!H || !H.joinMatchAdmin) return;
            joinBtn.disabled = true;
            joinBtn.textContent = 'Connecting...';
            setStatus(`Connecting to match ${sess.roomId}...`);
            try {
              await H.joinMatchAdmin(sess.roomId, admin.adminJoinHidden);
            } catch (err) {
              setStatus((err && err.message) ? err.message : `Failed to join ${sess.roomId}.`);
              joinBtn.disabled = false;
              joinBtn.textContent = admin.adminJoinHidden ? 'Join (Hidden)' : 'Join Match';
            }
          };

          const shutBtn = document.createElement('button');
          shutBtn.type = 'button';
          shutBtn.className = 'adm-btn danger';
          shutBtn.textContent = 'Shut Down Match';
          shutBtn.onclick = async () => {
            LO.audio && LO.audio.click(true);
            if (!H || !H.shutdownMatchAdmin) return;
            shutBtn.disabled = true;
            shutBtn.textContent = 'Shutting down...';
            try {
              const res = await H.shutdownMatchAdmin(sess.roomId);
              if (res && res.ok) {
                setStatus(`Shut down match ${sess.roomId}.`);
                setTimeout(() => refreshSessions(), 350);
              } else {
                setStatus((res && res.error) || `Failed to shut down ${sess.roomId}.`);
                shutBtn.disabled = false;
                shutBtn.textContent = 'Shut Down Match';
                if (res && res.status === 401) {
                  admin.closePanel();
                }
              }
            } catch (err) {
              setStatus(`Failed to shut down ${sess.roomId}.`);
              shutBtn.disabled = false;
              shutBtn.textContent = 'Shut Down Match';
            }
          };

          actions.append(joinBtn, shutBtn);
          row.append(info, actions);
          listEl.appendChild(row);
        });
      }

      card.appendChild(listEl);
      body.appendChild(card);
    }
  }

  function formatUptime(ms) {
    const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  async function refreshSessions() {
    if (admin.sessionsLoading) return;
    const token = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
    if (!token) {
      admin.sessions = [];
      admin.sessionsError = 'Admin authorization required.';
      if (admin.open && admin.activeTab === 'multiplayer') renderBody();
      return;
    }
    admin.sessionsLoading = true;
    admin.sessionsError = '';
    if (admin.open && admin.activeTab === 'multiplayer') renderBody();
    try {
      const res = await fetch('/api/rooms', {
        headers: {
          'X-Admin-Secret': token,
          'Authorization': `Bearer ${token}`,
        },
        cache: 'no-store',
      });
      if (res && res.status === 401) {
        if (LO.AdminAuth && LO.AdminAuth.clear) LO.AdminAuth.clear();
        admin.sessions = [];
        admin.sessionsError = 'Admin session expired. Press Ctrl+Shift+F9 to verify.';
        admin.closePanel();
        return;
      }
      if (!res || !res.ok) throw new Error('Could not load active rooms.');
      const json = await res.json();
      admin.sessions = (json && Array.isArray(json.rooms)) ? json.rooms : [];
    } catch (err) {
      admin.sessionsError = (err && err.message) ? err.message : 'Failed to query /api/rooms.';
    } finally {
      admin.sessionsLoading = false;
      if (admin.open && admin.activeTab === 'multiplayer') renderBody();
    }
  }

  function refreshLiveUI() {
    const H = host();
    const strip = $('adm-telemetry');
    if (!H || !strip) return;
    const player = H.getPlayer();
    const siren = H.getSiren();
    const fastone = H.getFastOne();
    const sneaky = H.getSneaky();
    const world = H.getWorld();
    const haz = H.getHazards && H.getHazards();
    const rend = H.getRenderer && H.getRenderer();
    const st = H.getState();

    const px = player ? player.pos.x.toFixed(1) : '0';
    const py = player ? player.pos.y.toFixed(1) : '0';
    const pz = player ? player.pos.z.toFixed(1) : '0';
    const hp = player ? Math.ceil(player.health) : 100;
    const sta = player ? Math.round(player.stamina) : 100;
    const bat = player ? Math.round(player.battery) : 100;
    const noise = player ? Math.round(player.noiseRadius) : 0;
    const adr = player && player.adrenaline > 0
      ? `ACTIVE ${player.adrenaline.toFixed(1)}s`
      : player && player.adrenalineCooldown > 0
        ? `CD ${Math.ceil(player.adrenalineCooldown)}s`
        : 'READY';
    const shState = siren ? siren.state.toUpperCase() : '-';
    const shDist = siren && siren.distToPlayer !== undefined ? Math.round(siren.distToPlayer) + 'm' : '-';
    const shAnger = siren ? Math.round(siren.anger) + '%' : '0%';
    const foTxt = fastone
      ? (fastone.state === 'idle'
          ? (fastone.cooldown > 0
              ? `CD ${Math.ceil(fastone.cooldown)}s+${Math.max(0, Math.ceil(fastone.timer))}s`
              : `${Math.max(0, Math.ceil(fastone.timer))}s`)
          : fastone.state.toUpperCase())
      : '-';
    const snTxt = sneaky ? (sneaky.attacking ? 'ATTACK' : `${Math.max(0, Math.ceil(sneaky.timer))}s`) : '-';
    const brokenFences = world && world.fences ? world.fences.filter(f => f.broken).length : 0;
    const smashedBldgs = world && world.buildings ? world.buildings.filter(b => b.smashed).length : 0;
    const mapTxt = !player ? '-' : (player.hasMap ? (player.mapOpen ? 'OPEN' : 'CARRIED') : 'ON WALL');
    const hazCnt = haz && haz.list ? haz.list.length : 0;
    const dc = rend && rend.info ? rend.info.render.calls : '-';
    const tris = rend && rend.info ? rend.info.render.triangles : '-';
    const slowTxt = player && player.trapSlowTimer > 0 ? ` · SLOW ${player.trapSlowTimer.toFixed(1)}s` : '';

    strip.innerHTML =
      `<div><b>STATE</b> ${st.toUpperCase()} (${LO.settings ? 'v' + LO.settings.gameVersion : ''})</div>` +
      `<div><b>POS</b> ${px}, ${py}, ${pz}</div>` +
      `<div><b>PLAYER</b> ${hp}HP · ${sta}% STA · ${bat}% BAT · ${noise}m NOISE · MAP ${mapTxt}${slowTxt}</div>` +
      `<div><b>ADRENALINE</b> ${adr}${player && player.windedTimer > 0 ? ` · WINDED ${player.windedTimer.toFixed(1)}s` : ''}</div>` +
      `<div><b>SIREN</b> ${shState} · ${shDist} · ANGER ${shAnger}</div>` +
      `<div><b>AMBUSH</b> FAST:${foTxt} · SNEAKY:${snTxt}</div>` +
      `<div><b>WORLD</b> EV ${H.getEvidenceCount()}/5 · FENCES BROKEN ${brokenFences} · SMASHED ${smashedBldgs} · HAZ ${hazCnt}</div>` +
      `<div><b>PERF</b> CALLS ${dc} · TRIS ${tris}</div>`;
  }

  admin.update = function (dt) {
    if (!LO.isTesting) return;
    syncDebugVisuals();
    if (!admin.open) return;
    uiAccum += dt;
    if (uiAccum >= 0.12) {
      uiAccum = 0;
      refreshLiveUI();
    }
  };

  admin.init = function () {
    if (!LO.isTesting) return;
    const closeBtn = $('adm-close');
    if (closeBtn) closeBtn.onclick = () => { LO.audio && LO.audio.click(true); admin.closePanel(); };

    const fw = $('adm-freeze-btn');
    if (fw) {
      fw.onclick = () => {
        LO.audio && LO.audio.click(true);
        admin.freezeWhenOpen = !admin.freezeWhenOpen;
        renderBody();
      };
    }

    document.querySelectorAll('#adm-tabs button').forEach(b => {
      b.onclick = () => {
        LO.audio && LO.audio.click(true);
        admin.activeTab = b.dataset.tab;
        renderBody();
        if (admin.activeTab === 'multiplayer') refreshSessions();
      };
    });

    const backdrop = $('admin-panel');
    if (backdrop) {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) admin.closePanel();
      });
    }
    admin.showFps = !!(LO.settings && LO.settings.showFps);
  };
})();
