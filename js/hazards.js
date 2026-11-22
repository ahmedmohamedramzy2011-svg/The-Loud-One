// ============================================================
//  THE LOUD ONE — Environmental Hazards (v2.7.6)
//  3 Lethal Hazards (Power Lines, Bear Traps, Steam Leaks)
//  3 Noise Hazards (Broken Glass, Creaking Floorboards, Tin Debris)
// ============================================================
window.LO = window.LO || {};

(function () {
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Hazards(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.list = [];
    this._stepTick = 0;
    this._initShared();
    this._populate();
    this.reset();
  }
  LO.Hazards = Hazards;

  Hazards.prototype._initShared = function () {
    const simple = LO.settings && LO.settings.lighting === 'simple';
    const M = (o) => simple ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.78 }, o));

    this.mats = {
      puddle: new THREE.MeshBasicMaterial({ color: 0x0c141c, transparent: true, opacity: 0.85, depthWrite: false }),
      arc: new THREE.MeshBasicMaterial({ color: 0x7ae2ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }),
      wire: M({ color: 0x1e2024, roughness: 0.9 }),
      pole: M({ color: 0x453528, roughness: 0.9 }),
      rust: M({ color: 0x5c3624, metalness: 0.45, roughness: 0.75 }),
      steel: M({ color: 0x6b7075, metalness: 0.65, roughness: 0.45 }),
      valveRed: M({ color: 0x8f221b, roughness: 0.55 }),
      steam: new THREE.MeshBasicMaterial({ color: 0xdbe6ec, transparent: true, opacity: 0.0, depthWrite: false }),
      glass: new THREE.MeshBasicMaterial({ color: 0x9ec8d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      board: M({ color: 0x493524, roughness: 0.95 }),
      tin: M({ color: 0x677078, metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide }),
    };

    this.geos = {
      puddle: new THREE.CircleGeometry(1.9, 14),
      arcRing: new THREE.RingGeometry(0.45, 1.8, 16),
      wire: new THREE.CylinderGeometry(0.035, 0.035, 3.6, 5),
      poleStub: new THREE.CylinderGeometry(0.14, 0.16, 1.35, 6),
      trapBase: new THREE.CylinderGeometry(0.46, 0.52, 0.06, 10),
      trapJaw: new THREE.TorusGeometry(0.42, 0.04, 5, 12, Math.PI),
      pipeV: new THREE.CylinderGeometry(0.11, 0.12, 1.25, 7),
      valve: new THREE.TorusGeometry(0.18, 0.03, 5, 10),
      steamCone: new THREE.ConeGeometry(0.55, 2.5, 8, 1, true),
      glassShard: new THREE.PlaneGeometry(0.42, 0.32),
      boardPlank: new THREE.BoxGeometry(0.42, 0.04, 1.55),
      tinSheet: new THREE.BoxGeometry(1.35, 1.15, 0.04),
    };
  };

  Hazards.prototype._clearPos = function (x, z, pad, skipBuildings) {
    const W = this.world;
    if (!W) return true;
    const cols = W.queryColliders ? W.queryColliders(x, z, pad || 1.2) : W.colliders;
    const p = pad || 0.9;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.disabled || c.minY > 1.7 || c.maxY < 0.25) continue;
      if (x + p > c.minX && x - p < c.maxX && z + p > c.minZ && z - p < c.maxZ) return false;
    }
    if (!skipBuildings && W.buildings) {
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        if (b.smashed) continue;
        if (x + p > b.minX && x - p < b.maxX && z + p > b.minZ && z - p < b.maxZ) return false;
      }
    }
    return true;
  };

  Hazards.prototype._addPowerline = function (x, z, ry, phase) {
    const g = new THREE.Group();
    g.position.set(x, 0.02, z);
    g.rotation.y = ry;

    const puddle = new THREE.Mesh(this.geos.puddle, this.mats.puddle);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.015;
    g.add(puddle);

    const arcMat = this.mats.arc.clone();
    const arcRing = new THREE.Mesh(this.geos.arcRing, arcMat);
    arcRing.rotation.x = -Math.PI / 2;
    arcRing.position.y = 0.025;
    g.add(arcRing);

    const wire = new THREE.Mesh(this.geos.wire, this.mats.wire);
    wire.rotation.z = Math.PI / 2 - 0.14;
    wire.position.set(0.4, 0.35, 0);
    g.add(wire);

    const pole = new THREE.Mesh(this.geos.poleStub, this.mats.pole);
    pole.position.set(2.05, 0.55, 0);
    pole.rotation.z = 0.38;
    g.add(pole);

    this.root.add(g);
    this.list.push({
      id: 'haz_pw_' + this.list.length,
      type: 'powerline',
      label: 'Downed Power Line',
      lethal: true,
      pos: new THREE.Vector3(x, 0.1, z),
      radius: 2.05,
      phase: phase || 0,
      cycleLen: 6.0,
      activeLen: 3.7,
      warnLen: 0.75,
      hitCd: 0,
      warnPlayed: false,
      activeNow: false,
      group: g,
      arcRing,
      arcMat,
    });
  };

  Hazards.prototype._addBearTrap = function (x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, 0.03, z);
    g.rotation.y = ry || 0;

    const base = new THREE.Mesh(this.geos.trapBase, this.mats.rust);
    g.add(base);

    const jawL = new THREE.Mesh(this.geos.trapJaw, this.mats.steel);
    jawL.position.set(0, 0.04, 0);
    jawL.rotation.x = -0.35;
    g.add(jawL);

    const jawR = new THREE.Mesh(this.geos.trapJaw, this.mats.steel);
    jawR.position.set(0, 0.04, 0);
    jawR.rotation.x = Math.PI + 0.35;
    g.add(jawR);

    this.root.add(g);
    this.list.push({
      id: 'haz_bt_' + this.list.length,
      type: 'beartrap',
      label: 'Bear Trap',
      lethal: true,
      pos: new THREE.Vector3(x, 0.05, z),
      radius: 1.08,
      disarmed: false,
      group: g,
      jawL,
      jawR,
    });
  };

  Hazards.prototype._addSteam = function (x, z, ry, phase) {
    const g = new THREE.Group();
    g.position.set(x, 0.0, z);
    g.rotation.y = ry || 0;

    const pipe = new THREE.Mesh(this.geos.pipeV, this.mats.rust);
    pipe.position.set(0, 0.62, 0);
    g.add(pipe);

    const valve = new THREE.Mesh(this.geos.valve, this.mats.valveRed);
    valve.position.set(0, 1.15, 0.14);
    g.add(valve);

    const steamMat = this.mats.steam.clone();
    const plume = new THREE.Mesh(this.geos.steamCone, steamMat);
    plume.rotation.x = Math.PI * 0.45;
    plume.position.set(0, 1.05, 1.25);
    g.add(plume);

    this.root.add(g);
    this.list.push({
      id: 'haz_st_' + this.list.length,
      type: 'steam',
      label: 'Pressurized Steam Leak',
      lethal: true,
      pos: new THREE.Vector3(x, 0.9, z),
      hitPos: new THREE.Vector3(x + Math.sin(ry || 0) * 1.15, 0.8, z + Math.cos(ry || 0) * 1.15),
      radius: 1.55,
      phase: phase || 0,
      cycleLen: 6.7,
      quietLen: 3.2,
      warnLen: 0.9,
      hitCd: 0,
      warnPlayed: false,
      activeNow: false,
      group: g,
      plume,
      steamMat,
    });
  };

  Hazards.prototype._addGlass = function (x, y, z, rSeed) {
    const base = this.geos.glassShard;
    const src = base.index ? base.toNonIndexed() : base;
    const vCnt = src.attributes.position.count;
    const total = vCnt * 9;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rSeed;
      const dist = 0.25 + ((i * 37) % 10) * 0.12;
      const g = src.clone();
      q.setFromEuler(e.set(-Math.PI / 2, 0, a * 1.7));
      sc.set(0.75 + (i % 3) * 0.25, 0.7 + ((i + 1) % 3) * 0.25, 1);
      p.set(Math.cos(a) * dist, 0.005 + i * 0.0005, Math.sin(a) * dist);
      g.applyMatrix4(m4.compose(p, q, sc));
      pos.set(g.attributes.position.array, i * vCnt * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, i * vCnt * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, i * vCnt * 2);
      g.dispose();
    }
    if (src !== base) src.dispose();
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();

    const mesh = new THREE.Mesh(merged, this.mats.glass);
    mesh.position.set(x, (y || 0.14) + 0.015, z);
    this.root.add(mesh);
    this._glassGeos = this._glassGeos || [];
    this._glassGeos.push(merged);
    this.list.push({
      id: 'haz_gl_' + this.list.length,
      type: 'glass',
      label: 'Broken Window Glass',
      lethal: false,
      pos: new THREE.Vector3(x, y || 0.14, z),
      radius: 1.65,
      stepCd: 0,
      group: mesh,
    });
  };

  Hazards.prototype._addFloorboard = function (x, y, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, (y || 3.4) + 0.025, z);
    g.rotation.y = ry || 0;
    const planks = [];
    for (let i = -1; i <= 1; i++) {
      const m = new THREE.Mesh(this.geos.boardPlank, this.mats.board);
      m.position.set(i * 0.46, 0, (i === 0 ? 0.06 : -0.04));
      m.rotation.z = i * 0.025;
      g.add(m);
      planks.push(m);
    }
    this.root.add(g);
    this.list.push({
      id: 'haz_fb_' + this.list.length,
      type: 'floorboard',
      label: 'Creaking Floorboards',
      lethal: false,
      pos: new THREE.Vector3(x, y || 3.4, z),
      radius: 1.35,
      stepCd: 0,
      wobble: 0,
      group: g,
      planks,
    });
  };

  Hazards.prototype._addTinDebris = function (x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, 0.02, z);
    g.rotation.y = ry || 0;
    const sheets = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.geos.tinSheet, this.mats.tin);
      m.position.set((i - 1) * 0.28, 0.56, (i - 1) * 0.14);
      m.rotation.set(0.28 - i * 0.1, (i - 1) * 0.22, (i - 1) * 0.08);
      g.add(m);
      sheets.push(m);
    }
    this.root.add(g);
    this.list.push({
      id: 'haz_td_' + this.list.length,
      type: 'tindebris',
      label: 'Loose Tin Debris',
      lethal: false,
      pos: new THREE.Vector3(x, 0.2, z),
      radius: 1.55,
      toppled: false,
      group: g,
      sheets,
    });
  };

  Hazards.prototype._populate = function () {
    const W = this.world;
    if (!W) return;
    const rand = rng32(20260276);
    const spawn = W.spawn || { x: 1.2, z: -138 };
    const farFromSpawn = (x, z, minD) => Math.hypot(x - spawn.x, z - spawn.z) >= minD;

    // 1. Power Lines (5-6 along street curbs / corners)
    const sts = W.STREETS || [-108, -54, 0, 54, 108];
    const pwSpots = [
      [sts[1] + 5.8, sts[2] - 18, 0.4],
      [sts[3] - 5.8, sts[2] + 20, 2.2],
      [sts[2] + 5.8, sts[3] - 16, 1.1],
      [sts[1] - 5.8, sts[1] + 19, 3.0],
      [sts[3] + 5.8, sts[3] + 14, 0.8],
      [sts[2] - 5.8, sts[1] + 22, 1.9],
    ];
    for (let i = 0; i < pwSpots.length; i++) {
      const [px, pz, ry] = pwSpots[i];
      if (!farFromSpawn(px, pz, 22)) continue;
      if (!this._clearPos(px, pz, 1.4, true)) continue;
      this._addPowerline(px, pz, ry, rand() * 5.0);
    }

    // 2. Bear Traps (Woodland Perimeter Ring trails + forest approaches)
    const trails = W.trails || [];
    let trapsAdded = 0;
    for (let ti = 0; ti < trails.length && trapsAdded < 8; ti++) {
      const pts = trails[ti].pts || [];
      for (let pi = 1; pi < pts.length - 1 && trapsAdded < 8; pi += 2) {
        const tx = pts[pi][0] + (rand() - 0.5) * 1.4;
        const tz = pts[pi][1] + (rand() - 0.5) * 1.4;
        if (!farFromSpawn(tx, tz, 18)) continue;
        if (!this._clearPos(tx, tz, 0.8, true)) continue;
        this._addBearTrap(tx, tz, rand() * Math.PI * 2);
        trapsAdded++;
      }
    }
    if (trapsAdded < 5) {
      const fallbackTraps = [[-134, -40], [-136, 48], [134, -36], [135, 58], [-44, 134], [52, 136]];
      for (let i = 0; i < fallbackTraps.length && trapsAdded < 6; i++) {
        const [tx, tz] = fallbackTraps[i];
        if (this._clearPos(tx, tz, 0.8, true)) {
          this._addBearTrap(tx, tz, rand() * Math.PI * 2);
          trapsAdded++;
        }
      }
    }

    // 3. Steam / Gas Leaks (along block alleys & utility edges)
    const bc = (LO.World && LO.World.BLOCK_C) || [-81, -27, 27, 81];
    let steamAdded = 0;
    for (let bi = 0; bi < bc.length && steamAdded < 6; bi++) {
      for (let bj = 0; bj < bc.length && steamAdded < 6; bj++) {
        if ((bi + bj) % 2 !== 0) continue;
        const sx = bc[bi] + (bi % 2 ? -18.5 : 18.5);
        const sz = bc[bj] + (bj % 2 ? 12 : -12);
        if (!farFromSpawn(sx, sz, 20)) continue;
        if (!this._clearPos(sx, sz, 1.3, false)) continue;
        this._addSteam(sx, sz, (bi + bj) * 1.1, rand() * 5.5);
        steamAdded++;
      }
    }

    // 4. Broken Glass (ground-floor interior corridors + doorways)
    const ints = W.interiors || [];
    let glassAdded = 0;
    for (let i = 0; i < ints.length && glassAdded < 8; i++) {
      const r = ints[i];
      if (!r || r.disabled) continue;
      const gx = (r.minX + r.maxX) * 0.5 + (rand() - 0.5) * Math.max(1, (r.maxX - r.minX) * 0.32);
      const gz = (r.minZ + r.maxZ) * 0.5 + (rand() - 0.5) * Math.max(1, (r.maxZ - r.minZ) * 0.32);
      if (!farFromSpawn(gx, gz, 12)) continue;
      this._addGlass(gx, 0.14, gz, rand() * 6.28);
      glassAdded++;
    }

    // 5. Rotten Creaking Floorboards (upper floors + Lookout Tower deck)
    const surfs = W.walkSurfaces || [];
    let fbAdded = 0;
    for (let i = 0; i < surfs.length && fbAdded < 7; i++) {
      const s = surfs[i];
      if (!s || s.disabled || s.type === 'ramp' || s.y < 2.2) continue;
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
      if (w < 2.4 || d < 2.4) continue;
      const fx = (s.minX + s.maxX) * 0.5;
      const fz = (s.minZ + s.maxZ) * 0.5;
      this._addFloorboard(fx, s.y, fz, (fbAdded % 2) * (Math.PI / 2));
      fbAdded++;
    }

    // 6. Loose Corrugated Tin Debris (alleys / passages)
    let tinAdded = 0;
    for (let bi = 0; bi < bc.length && tinAdded < 6; bi++) {
      for (let bj = 0; bj < bc.length && tinAdded < 6; bj++) {
        if ((bi + bj) % 2 === 0) continue;
        const tx = bc[bi] + (rand() - 0.5) * 14;
        const tz = bc[bj] + (bj % 2 ? -18.5 : 18.5);
        if (!farFromSpawn(tx, tz, 18)) continue;
        if (!this._clearPos(tx, tz, 1.3, false)) continue;
        this._addTinDebris(tx, tz, rand() * Math.PI * 2);
        tinAdded++;
      }
    }
  };

  Hazards.prototype.reset = function () {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      h.hitCd = 0;
      h.stepCd = 0;
      h.warnPlayed = false;
      h.activeNow = false;
      if (h.type === 'beartrap') {
        h.disarmed = false;
        h.jawL.rotation.x = -0.35;
        h.jawR.rotation.x = Math.PI + 0.35;
      } else if (h.type === 'tindebris') {
        h.toppled = false;
        for (let s = 0; s < h.sheets.length; s++) {
          h.sheets[s].position.set((s - 1) * 0.28, 0.56, (s - 1) * 0.14);
          h.sheets[s].rotation.set(0.28 - s * 0.1, (s - 1) * 0.22, (s - 1) * 0.08);
        }
      } else if (h.type === 'floorboard') {
        h.wobble = 0;
      } else if (h.type === 'powerline') {
        h.arcMat.opacity = 0;
      } else if (h.type === 'steam') {
        h.steamMat.opacity = 0;
        h.plume.visible = false;
      }
    }
  };

  Hazards.prototype.disarmAllTraps = function () {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (h.type === 'beartrap' && !h.disarmed) {
        h.disarmed = true;
        h.jawL.rotation.x = 0.02;
        h.jawR.rotation.x = Math.PI - 0.02;
        n++;
      }
    }
    return n;
  };

  Hazards.prototype.resetTin = function () {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (h.type === 'tindebris' && h.toppled) {
        h.toppled = false;
        for (let s = 0; s < h.sheets.length; s++) {
          h.sheets[s].position.set((s - 1) * 0.28, 0.56, (s - 1) * 0.14);
          h.sheets[s].rotation.set(0.28 - s * 0.1, (s - 1) * 0.22, (s - 1) * 0.08);
        }
        n++;
      }
    }
    return n;
  };

  Hazards.prototype._isAllowed = function (h) {
    const adm = LO.admin;
    if (!adm) return true;
    if (adm.noHazards) return false;
    if (h.type === 'powerline' && adm.noPowerlines) return false;
    if (h.type === 'beartrap' && adm.noBearTraps) return false;
    if (h.type === 'steam' && adm.noSteam) return false;
    if (!h.lethal && adm.noNoiseHazards) return false;
    return true;
  };

  Hazards.prototype.onRockImpact = function (pos, onHint) {
    if (!pos) return false;
    const adm = LO.admin;
    if (adm && adm.noHazards) return false;
    let triggered = false;
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (!this._isAllowed(h)) continue;
      const dx = h.pos.x - pos.x, dz = h.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (h.type === 'beartrap' && !h.disarmed && d2 <= 2.3 * 2.3) {
        h.disarmed = true;
        h.jawL.rotation.x = 0.02;
        h.jawR.rotation.x = Math.PI - 0.02;
        if (LO.audio && LO.audio.hazardTrapSnap) LO.audio.hazardTrapSnap(h.pos);
        if (this.world && this.world.scatterBirdsAt) this.world.scatterBirdsAt(h.pos, 24, 0);
        if (onHint) onHint('The rock snapped a bear trap open.');
        triggered = true;
      } else if (h.type === 'tindebris' && !h.toppled && d2 <= 2.2 * 2.2) {
        h.toppled = true;
        for (let s = 0; s < h.sheets.length; s++) {
          h.sheets[s].position.set((s - 1) * 0.55, 0.05 + s * 0.02, (s - 1) * 0.3);
          h.sheets[s].rotation.set(Math.PI * 0.48, (s - 1) * 0.6, 0.1 * s);
        }
        if (LO.audio && LO.audio.hazardTinClatter) LO.audio.hazardTinClatter(h.pos);
        if (this.world && this.world.scatterBirdsAt) this.world.scatterBirdsAt(h.pos, 26, 0);
        triggered = true;
      }
    }
    return triggered;
  };

  Hazards.prototype.update = function (dt, player, siren, time) {
    const V = LO.ver ? LO.ver() : { hazards: true };
    const enabled = V.hazards !== false && !(LO.admin && LO.admin.noHazards);
    this.root.visible = enabled;
    if (!enabled) return;

    const pPos = player && player.pos ? player.pos : null;
    const crouching = !!(player && (player.crouching || player.crouch > 0.5));
    const moving = !!(player && !player.hidden && (player.moving || player.speedNow > 0.45 || (player.vel && Math.hypot(player.vel.x, player.vel.z) > 0.45)));
    const invuln = !!(LO.admin && (LO.admin.god || LO.admin.godMode));
    const addPlayerNoise = radius => {
      if (!player) return;
      if (player.addNoise) player.addNoise(radius);
      else if (!(LO.admin && LO.admin.zeroNoise)) {
        player.spike = Math.max(player.spike || 0, radius);
        player.noiseRadius = Math.max(player.noiseRadius || 0, player.spike);
      }
      if (siren && siren.hearNoise && !(LO.admin && LO.admin.zeroNoise)) siren.hearNoise(player.pos, radius);
    };

    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      const allowed = this._isAllowed(h);
      if (h.group.visible !== allowed) h.group.visible = allowed;
      if (!allowed) continue;

      if (h.hitCd > 0) h.hitCd = Math.max(0, h.hitCd - dt);
      if (h.stepCd > 0) h.stepCd = Math.max(0, h.stepCd - dt);

      if (h.type === 'powerline') {
        const cyc = (time + h.phase) % h.cycleLen;
        const on = cyc < h.activeLen;
        const warning = !on && cyc > h.cycleLen - h.warnLen;
        h.activeNow = on;
        if (on) {
          const pulse = 0.55 + Math.abs(Math.sin(time * 28 + h.phase)) * 0.45;
          h.arcMat.opacity = pulse;
          h.arcMat.color.setHex(0x88e8ff);
        } else if (warning) {
          h.arcMat.opacity = 0.25 + 0.25 * Math.sin(time * 42);
          h.arcMat.color.setHex(0xffc966);
        } else {
          h.arcMat.opacity = 0;
        }
        if (pPos && on && h.hitCd <= 0 && !player.hidden) {
          const dx = pPos.x - h.pos.x, dz = pPos.z - h.pos.z, dy = Math.abs((pPos.y || 0) - h.pos.y);
          if (dy < 1.2 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.hitCd = 1.4;
            if (LO.audio && LO.audio.hazardZap) LO.audio.hazardZap(h.pos);
            if (this.world && this.world.scatterBirdsAt) this.world.scatterBirdsAt(h.pos, 26, time);
            if (!invuln) {
              addPlayerNoise(36);
              player.damage(42, 'powerline');
            }
          }
        }
      } else if (h.type === 'beartrap') {
        if (!h.disarmed && pPos && !player.hidden) {
          const dx = pPos.x - h.pos.x, dz = pPos.z - h.pos.z, dy = Math.abs((pPos.y || 0) - h.pos.y);
          if (dy < 1.0 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.disarmed = true;
            h.jawL.rotation.x = 0.02;
            h.jawR.rotation.x = Math.PI - 0.02;
            if (LO.audio && LO.audio.hazardTrapSnap) LO.audio.hazardTrapSnap(h.pos);
            if (this.world && this.world.scatterBirdsAt) this.world.scatterBirdsAt(h.pos, 28, time);
            if (!invuln) {
              player.trapSlowTimer = 4.0;
              addPlayerNoise(34);
              player.damage(38, 'beartrap');
            }
          }
        }
      } else if (h.type === 'steam') {
        const cyc = (time + h.phase) % h.cycleLen;
        const warning = cyc >= h.quietLen && cyc < h.quietLen + h.warnLen;
        const venting = cyc >= h.quietLen + h.warnLen;
        h.activeNow = venting;
        if (venting) {
          h.plume.visible = true;
          h.steamMat.opacity = 0.42 + Math.sin(time * 24 + h.phase) * 0.12;
          const sc = 0.92 + Math.sin(time * 32) * 0.1;
          h.plume.scale.set(sc, 1.0 + Math.cos(time * 20) * 0.08, sc);
        } else if (warning) {
          h.plume.visible = true;
          h.steamMat.opacity = 0.16;
          h.plume.scale.set(0.45, 0.35, 0.45);
        } else {
          h.plume.visible = false;
          h.steamMat.opacity = 0;
        }
        if (pPos && venting && h.hitCd <= 0 && !player.hidden) {
          const hp = h.hitPos || h.pos;
          const dx = pPos.x - hp.x, dz = pPos.z - hp.z, dy = Math.abs((pPos.y || 0) - 0.1);
          if (dy < 1.3 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.hitCd = 1.15;
            if (LO.audio && LO.audio.hazardSteamBurn) LO.audio.hazardSteamBurn(hp);
            if (!invuln) {
              addPlayerNoise(24);
              player.damage(24, 'steam');
            }
          }
        }
      } else if (h.type === 'glass') {
        if (pPos && moving && !crouching && h.stepCd <= 0) {
          const dx = pPos.x - h.pos.x, dz = pPos.z - h.pos.z, dy = Math.abs((pPos.y || 0) - h.pos.y);
          if (dy < 0.9 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.stepCd = 0.48;
            if (LO.audio && LO.audio.hazardGlass) LO.audio.hazardGlass(h.pos);
            addPlayerNoise(28);
          }
        }
      } else if (h.type === 'floorboard') {
        if (h.wobble > 0) {
          h.wobble = Math.max(0, h.wobble - dt * 2.5);
          for (let p = 0; p < h.planks.length; p++) {
            h.planks[p].position.y = -0.04 * h.wobble * ((p % 2) ? 1 : 0.6);
          }
        }
        if (pPos && moving && !crouching && h.stepCd <= 0) {
          const dx = pPos.x - h.pos.x, dz = pPos.z - h.pos.z, dy = Math.abs((pPos.y || 0) - h.pos.y);
          if (dy < 0.9 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.stepCd = 0.55;
            h.wobble = 1;
            if (LO.audio && LO.audio.hazardCreak) LO.audio.hazardCreak(h.pos);
            addPlayerNoise(30);
          }
        }
      } else if (h.type === 'tindebris') {
        if (!h.toppled && pPos && moving && !crouching) {
          const dx = pPos.x - h.pos.x, dz = pPos.z - h.pos.z, dy = Math.abs((pPos.y || 0) - 0.1);
          if (dy < 1.1 && dx * dx + dz * dz <= h.radius * h.radius) {
            h.toppled = true;
            for (let s = 0; s < h.sheets.length; s++) {
              h.sheets[s].position.set((s - 1) * 0.55, 0.05 + s * 0.02, (s - 1) * 0.3);
              h.sheets[s].rotation.set(Math.PI * 0.48, (s - 1) * 0.6, 0.1 * s);
            }
            if (LO.audio && LO.audio.hazardTinClatter) LO.audio.hazardTinClatter(h.pos);
            if (this.world && this.world.scatterBirdsAt) this.world.scatterBirdsAt(h.pos, 26, time);
            addPlayerNoise(44);
          }
        }
      }
    }
  };

  Hazards.prototype.getSummary = function () {
    const counts = { powerline: 0, beartrap: 0, beartrapActive: 0, steam: 0, glass: 0, floorboard: 0, tindebris: 0, tinIntact: 0 };
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (counts[h.type] !== undefined) counts[h.type]++;
      if (h.type === 'beartrap' && !h.disarmed) counts.beartrapActive++;
      if (h.type === 'tindebris' && !h.toppled) counts.tinIntact++;
    }
    return counts;
  };

  Hazards.prototype.setCompileWarmup = function (on) {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (h.type === 'steam' && h.plume) {
        if (on) {
          h._prevVis = h.plume.visible;
          h.plume.visible = true;
        } else if (h._prevVis !== undefined) {
          h.plume.visible = h._prevVis;
          delete h._prevVis;
        }
      }
    }
  };

  Hazards.prototype.dispose = function () {
    this.scene.remove(this.root);
    Object.values(this.geos || {}).forEach(g => g.dispose && g.dispose());
    (this._glassGeos || []).forEach(g => g.dispose && g.dispose());
    Object.values(this.mats || {}).forEach(m => m.dispose && m.dispose());
  };
})();
