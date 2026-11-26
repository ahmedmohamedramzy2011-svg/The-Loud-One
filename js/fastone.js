// ============================================================
//  THE LOUD ONE — The Fast One (Phenomenon-242)
//  A low quadrupedal hound that smashes through the farthest
//  perimeter fence on a 30s-3m timer (with a mandatory 10-20s
//  gap from The Sneaky One, pausing when hiding or when Siren
//  Head is close). Highlights the closest locker/dumpster in
//  blue, triggers an adrenaline surge if safety is >7s away,
//  and chases you down on a ~6s kill timer. Hide in time and
//  it rears up, slams the door, and breaches back out.
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const MIN_T = 30, MAX_T = 180;
  const COOLDOWN_T = 60;
  const BREACH_DELAY = 2.5;
  const KILL_TIME = 6.0;
  const ADRENALINE_TIME_THRESHOLD = 10.5;
  const NORMAL_SPRINT_SPEED = 6.9;
  const LEGACY_THRESHOLD = 7.0;
  const LEGACY_WALK_SPEED = 3.3;
  const AFTERIMAGES = 4;

  LO.ambush = LO.ambush || { active: null, gapUntil: 0, now: 0 };
  const nextTime = () => MIN_T + Math.random() * (MAX_T - MIN_T);

  function FastOne(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.fxGroup = new THREE.Group();
    scene.add(this.fxGroup);

    this.splinters = [];
    this.dust = [];
    this.splinterPool = [];
    this.dustPool = [];
    this.trail = [];
    this.clones = [];
    this.highlightedSpot = null;
    this.onBreach = null;
    this.onEvent = null;
    this.onKillPlayer = null;
    this.targetPlayerId = null;

    // pre-allocate ONE PointLight and lightweight shared highlight materials (avoids runtime GLSL shader recompiles!)
    this.highlightLight = new THREE.PointLight(0x38aaff, 0, 10, 1.5);
    scene.add(this.highlightLight);
    this.hlShellMat = new THREE.MeshBasicMaterial({
      color: 0x2ea8ff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    this.hlEdgeMat = new THREE.LineBasicMaterial({
      color: 0x70d4ff,
      transparent: true,
      opacity: 0.85,
      fog: false,
      depthTest: false,
    });
    this.dustMatA = new THREE.MeshLambertMaterial({ color: 0x6c6558, transparent: true, opacity: 0.42, depthWrite: false });
    this.dustMatB = new THREE.MeshLambertMaterial({ color: 0x575046, transparent: true, opacity: 0.42, depthWrite: false });

    this.buildModel();
    this.buildAfterimages();
    this.initPools();
    this.prebuildHighlights();
    this.reset();
  }
  LO.FastOne = FastOne;

  // ---------------- low quadrupedal hound mesh ----------------
  FastOne.prototype.buildModel = function () {
    const simple = LO.settings.lighting === 'simple';
    const Mat = o => simple ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.78 }, o));
    const skin = Mat({ color: 0x1a1516 });
    const bone = Mat({ color: 0x6b6056 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b22 });
    const toothMat = new THREE.MeshBasicMaterial({ color: 0xe6dfd0 });

    const body = this.body = new THREE.Group();
    body.position.set(0, 0.62, 0);
    this.root.add(body);

    // gaunt ribbed chest and low haunches
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.78), skin);
    chest.position.set(0, 0.04, 0.25);
    body.add(chest);

    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.26, 0.68), skin);
    waist.position.set(0, 0.0, -0.34);
    body.add(waist);

    // bony ribs & dorsal spine ridges
    for (let i = 0; i < 6; i++) {
      const z = 0.52 - i * 0.19;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 4), bone);
      sp.position.set(0, 0.24 - i * 0.01, z);
      sp.rotation.x = -0.35;
      body.add(sp);
    }

    // neck & elongated canine skull (+z is forward)
    const head = this.head = new THREE.Group();
    head.position.set(0, 0.14, 0.72);
    body.add(head);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.34), skin);
    neck.position.set(0, -0.02, -0.08);
    neck.rotation.x = 0.25;
    head.add(neck);

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.42), skin);
    skull.position.set(0, 0.06, 0.16);
    head.add(skull);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.32), skin);
    snout.position.set(0, 0.04, 0.44);
    head.add(snout);

    // ears swept back
    [-1, 1].forEach(s => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), skin);
      ear.position.set(s * 0.11, 0.18, 0.06);
      ear.rotation.x = -0.65;
      ear.rotation.z = -s * 0.25;
      head.add(ear);
    });

    // glowing red eyes
    [-1, 1].forEach(s => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), eyeMat);
      eye.scale.set(1.2, 0.75, 0.8);
      eye.position.set(s * 0.095, 0.09, 0.34);
      head.add(eye);
    });

    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.world.glowTex('rgba(255,60,30,0.45)'),
      depthWrite: false,
      transparent: true,
    }));
    eyeGlow.scale.set(0.95, 0.45, 1);
    eyeGlow.position.set(0, 0.09, 0.38);
    head.add(eyeGlow);

    // hinged lower jaw + jagged pale fangs
    const jaw = this.jaw = new THREE.Group();
    jaw.position.set(0, -0.01, 0.22);
    head.add(jaw);
    const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.34), skin);
    jawMesh.position.set(0, -0.02, 0.18);
    jaw.add(jawMesh);
    for (let i = 0; i < 4; i++) {
      const z = 0.08 + i * 0.08;
      [-1, 1].forEach(s => {
        const upT = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.055, 4), toothMat);
        upT.position.set(s * 0.055, -0.01, 0.34 + i * 0.07);
        upT.rotation.x = Math.PI;
        head.add(upT);
        const loT = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 4), toothMat);
        loT.position.set(s * 0.048, 0.025, z);
        jaw.add(loT);
      });
    }

    // 4 articulated legs
    this.legs = [];
    const legSpecs = [
      { x: -0.22, y: -0.04, z: 0.46, front: true, phase: 0 },
      { x: 0.22, y: -0.04, z: 0.46, front: true, phase: 0.55 },
      { x: -0.20, y: -0.04, z: -0.50, front: false, phase: Math.PI },
      { x: 0.20, y: -0.04, z: -0.50, front: false, phase: Math.PI + 0.55 },
    ];
    legSpecs.forEach(sp => {
      const hip = new THREE.Group();
      hip.position.set(sp.x, sp.y, sp.z);
      body.add(hip);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), skin);
      upper.position.y = -0.15;
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -0.30;
      hip.add(knee);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.09), skin);
      lower.position.y = -0.15;
      knee.add(lower);

      const paw = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.18), bone);
      paw.position.set(0, -0.31, 0.04);
      knee.add(paw);

      this.legs.push({ hip, knee, front: sp.front, phase: sp.phase });
    });

    // segmented whip tail
    const tail = this.tail = new THREE.Group();
    tail.position.set(0, 0.06, -0.68);
    body.add(tail);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.55), skin);
    t1.position.set(0, 0.02, -0.26);
    t1.rotation.x = 0.25;
    tail.add(t1);
    const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.45, 5), bone);
    t2.position.set(0, 0.11, -0.64);
    t2.rotation.x = -Math.PI / 2 + 0.2;
    tail.add(t2);

    if (LO.settings.shadows !== 'off') {
      this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }
  };

  // ---------------- 4 fading afterimage trail clones ----------------
  FastOne.prototype.buildAfterimages = function () {
    const bodyGeo = new THREE.BoxGeometry(0.40, 0.32, 1.38);
    const headGeo = new THREE.BoxGeometry(0.24, 0.18, 0.48);
    const legGeo = new THREE.BoxGeometry(0.09, 0.54, 0.10);
    const eyeGeo = new THREE.SphereGeometry(0.035, 6, 4);

    for (let i = 0; i < AFTERIMAGES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6b1414,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const eyeMat = new THREE.MeshBasicMaterial({
        color: 0xff4422,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const g = new THREE.Group();
      const b = new THREE.Group();
      b.position.y = 0.62;
      g.add(b);

      const torso = new THREE.Mesh(bodyGeo, mat);
      torso.position.set(0, 0.02, -0.02);
      b.add(torso);

      const hd = new THREE.Mesh(headGeo, mat);
      hd.position.set(0, 0.18, 0.88);
      b.add(hd);

      [-1, 1].forEach(s => {
        const e = new THREE.Mesh(eyeGeo, eyeMat);
        e.position.set(s * 0.09, 0.21, 1.06);
        b.add(e);
      });

      [[-0.21, 0.45], [0.21, 0.45], [-0.19, -0.48], [0.19, -0.48]].forEach(([lx, lz]) => {
        const lg = new THREE.Mesh(legGeo, mat);
        lg.position.set(lx, -0.32, lz);
        b.add(lg);
      });

      g.visible = false;
      this.fxGroup.add(g);
      this.clones.push({ g, b, mat, eyeMat, baseAlpha: [0.44, 0.31, 0.20, 0.11][i] });
    }
  };

  FastOne.prototype.updateAfterimages = function (dt, active) {
    if (active) {
      this.trailTimer += dt;
      if (this.trailTimer >= 0.042) {
        this.trailTimer = 0;
        this.trail.unshift({
          x: this.pos.x,
          y: this.pos.y,
          z: this.pos.z,
          yaw: this.root.rotation.y,
          by: this.body.position.y,
          bx: this.body.rotation.x,
        });
        if (this.trail.length > AFTERIMAGES + 2) this.trail.length = AFTERIMAGES + 2;
      }
      this.trailFade = Math.min(1, this.trailFade + dt * 8);
    } else {
      this.trailFade = Math.max(0, this.trailFade - dt * 4);
    }

    for (let i = 0; i < this.clones.length; i++) {
      const c = this.clones[i];
      const snap = this.trail[i + 1];
      if (!snap || this.trailFade <= 0.02) {
        c.g.visible = false;
        continue;
      }
      c.g.visible = true;
      c.g.position.set(snap.x, snap.y, snap.z);
      c.g.rotation.y = snap.yaw;
      c.b.position.y = snap.by;
      c.b.rotation.x = snap.bx;
      const a = c.baseAlpha * this.trailFade;
      c.mat.opacity = a;
      c.eyeMat.opacity = Math.min(0.85, a * 1.6);
    }
  };

  // ---------------- splinter & dust cloud pools for zero-lag fence breach ----------------
  const splinterGeo = new THREE.BoxGeometry(0.08, 0.05, 0.46);
  const splinterMat = new THREE.MeshLambertMaterial({ color: 0x4b463e });
  const dustGeo = new THREE.DodecahedronGeometry(0.45, 0);
  const hlLockerBoxGeo = new THREE.BoxGeometry(0.98, 2.08, 0.76);
  const hlLockerEdgeGeo = new THREE.EdgesGeometry(hlLockerBoxGeo);
  const hlDumpBoxGeo = new THREE.BoxGeometry(2.38, 1.56, 1.46);
  const hlDumpEdgeGeo = new THREE.EdgesGeometry(hlDumpBoxGeo);

  FastOne.prototype.initPools = function () {
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(splinterGeo, splinterMat);
      m.visible = false;
      this.fxGroup.add(m);
      this.splinterPool.push(m);
    }
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(dustGeo, i % 2 ? this.dustMatA : this.dustMatB);
      m.visible = false;
      this.fxGroup.add(m);
      this.dustPool.push(m);
    }
  };

  FastOne.prototype.prebuildHighlights = function () {
    const spots = (this.world && this.world.hideSpots) || [];
    for (let i = 0; i < spots.length; i++) this.ensureHighlight(spots[i]);
    // invalidate cached BFS grid whenever world changes
    this._gridCache = null;
    this._gridVer = -1;
  };

  FastOne.prototype.spawnSplinters = function (origin, dir) {
    for (let i = 0; i < this.splinters.length; i++) this.splinters[i].mesh.visible = false;
    this.splinters.length = 0;
    const count = this.splinterPool.length;
    for (let i = 0; i < count; i++) {
      const m = this.splinterPool[i];
      m.position.set(
        origin.x + (Math.random() - 0.5) * 3.4,
        0.4 + Math.random() * 1.6,
        origin.z + (Math.random() - 0.5) * 3.4
      );
      m.scale.set(0.6 + Math.random() * 0.9, 0.6 + Math.random() * 0.8, 0.7 + Math.random() * 1.4);
      m.visible = true;
      const speed = 8 + Math.random() * 18;
      const spread = (Math.random() - 0.5) * 1.2;
      const vx = dir.x * speed + (-dir.z) * spread * speed * 0.55;
      const vz = dir.z * speed + dir.x * spread * speed * 0.55;
      const vy = 2.0 + Math.random() * 6.5;
      this.splinters.push({
        mesh: m,
        vx, vy, vz,
        rx: (Math.random() - 0.5) * 16,
        ry: (Math.random() - 0.5) * 16,
        rz: (Math.random() - 0.5) * 16,
        life: 2.2,
      });
    }
  };

  FastOne.prototype.spawnDustCloud = function (origin, dir) {
    for (let i = 0; i < this.dust.length; i++) this.dust[i].mesh.visible = false;
    this.dust.length = 0;
    const count = this.dustPool.length;
    for (let i = 0; i < count; i++) {
      const m = this.dustPool[i];
      m.position.set(
        origin.x + (Math.random() - 0.5) * 3.6,
        0.35 + Math.random() * 1.5,
        origin.z + (Math.random() - 0.5) * 3.6
      );
      const s0 = 0.7 + Math.random() * 0.8;
      m.scale.setScalar(s0);
      m.visible = true;
      const sp = 1.5 + Math.random() * 4.5;
      const side = (Math.random() - 0.5) * 3.2;
      const maxLife = 1.8 + Math.random() * 0.8;
      this.dust.push({
        mesh: m,
        vx: dir.x * sp + (-dir.z) * side,
        vy: 0.6 + Math.random() * 1.4,
        vz: dir.z * sp + dir.x * side,
        s0,
        life: maxLife,
        maxLife,
      });
    }
  };

  FastOne.prototype.updateSplinters = function (dt) {
    for (let i = this.splinters.length - 1; i >= 0; i--) {
      const s = this.splinters[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.splinters.splice(i, 1);
        continue;
      }
      s.vy -= 16 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      if (s.mesh.position.y <= 0.05) {
        s.mesh.position.y = 0.05;
        s.vy *= -0.25;
        s.vx *= 0.65;
        s.vz *= 0.65;
      }
      s.mesh.rotation.x += s.rx * dt;
      s.mesh.rotation.y += s.ry * dt;
      s.mesh.rotation.z += s.rz * dt;
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        this.dust.splice(i, 1);
        continue;
      }
      const k = 1 - d.life / d.maxLife;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      d.vx *= Math.max(0, 1 - dt * 1.6);
      d.vz *= Math.max(0, 1 - dt * 1.6);
      // smooth expand then dissipate down cleanly
      const fade = d.life < 0.5 ? (d.life / 0.5) : 1;
      d.mesh.scale.setScalar(Math.max(0.01, d.s0 * (1 + k * 2.1) * fade));
    }
  };

  FastOne.prototype.breachFence = function (fence, dir) {
    const pos = fence ? fence.pos : this.pos;
    if (this.world && this.world.smashFence) {
      this.world.smashFence(fence, pos, dir);
    } else if (fence && !fence.broken) {
      fence.broken = true;
      fence.mesh.visible = false;
      if (fence.collider) fence.collider.disabled = true;
    }
    this.spawnSplinters(pos, dir);
    if (!LO.ver || LO.ver().fastoneV2) this.spawnDustCloud(pos, dir);
    LO.audio.fenceSmash(pos);
    return pos;
  };

  // ---------------- blue outline highlight on closest locker/dumpster ----------------
  FastOne.prototype.ensureHighlight = function (spot) {
    if (spot._blueHighlight) return spot._blueHighlight;
    const isDump = spot.type === 'dumpster';
    const grp = new THREE.Group();
    const shell = new THREE.Mesh(isDump ? hlDumpBoxGeo : hlLockerBoxGeo, this.hlShellMat);
    shell.position.set(0, isDump ? 0.78 : 1.0, 0);
    const edges = new THREE.LineSegments(isDump ? hlDumpEdgeGeo : hlLockerEdgeGeo, this.hlEdgeMat);
    edges.position.copy(shell.position);
    edges.renderOrder = 20;
    grp.add(shell, edges);
    grp.visible = false;
    spot.mesh.add(grp);
    spot._blueHighlight = { grp };
    return spot._blueHighlight;
  };

  FastOne.prototype.setHighlight = function (spot, time) {
    if (this.highlightedSpot && this.highlightedSpot !== spot) {
      if (this.highlightedSpot._blueHighlight) {
        this.highlightedSpot._blueHighlight.grp.visible = false;
      }
      this.highlightedSpot = null;
    }
    if (!spot) {
      if (this.highlightLight) this.highlightLight.intensity = 0;
      return;
    }
    const h = this.ensureHighlight(spot);
    h.grp.visible = true;
    const pulse = 0.65 + 0.35 * Math.sin((time || 0) * 9);
    this.hlShellMat.opacity = 0.50 + pulse * 0.32;
    this.hlEdgeMat.opacity = 0.58 + pulse * 0.35;
    if (this.highlightLight) {
      this.highlightLight.position.set(spot.interact.x, (spot.baseY || 0) + 1.4, spot.interact.z);
      this.highlightLight.intensity = 1.1 + pulse * 1.2;
    }
    this.highlightedSpot = spot;
  };

  FastOne.prototype.clearHighlight = function () {
    this.setHighlight(null);
  };

  FastOne.prototype.getWalkGrid = function () {
    const STEP = 4, HALF = (this.world.HALF || 110);
    const MIN = -HALF, N = Math.floor((HALF * 2) / STEP) + 1;
    const ver = this.world._gridVersion || 0;
    if (this._gridCache && this._gridVer === ver) return this._gridCache;
    const colliders = this.world.colliders || [];
    const blocked = new Uint8Array(N * N);
    for (let ix = 0; ix < N; ix++) {
      const x = MIN + ix * STEP;
      for (let iz = 0; iz < N; iz++) {
        const z = MIN + iz * STEP;
        for (let ci = 0; ci < colliders.length; ci++) {
          const c = colliders[ci];
          if (c.disabled || c.maxY < 0.35 || c.minY > 1.75) continue;
          if (x + 0.35 > c.minX && x - 0.35 < c.maxX && z + 0.35 > c.minZ && z - 0.35 < c.maxZ) {
            blocked[ix * N + iz] = 1;
            break;
          }
        }
      }
    }
    this._gridVer = ver;
    this._gridCache = {
      STEP, HALF, MIN, N, blocked,
      distGrid: new Float32Array(N * N),
      queue: new Int32Array(N * N),
    };
    return this._gridCache;
  };

  FastOne.prototype.findClosestHideSpot = function (player, computePath) {
    const now = performance.now() / 1000;
    const spots = [];
    let best = null, bd = Infinity, best3d = Infinity;
    (this.world.hideSpots || []).forEach(sp => {
      if (sp.disabled) return;
      if (sp.lockedUntil && sp.lockedUntil > now) return;
      const dx = sp.interact.x - player.pos.x, dz = sp.interact.z - player.pos.z;
      const dy = (sp.baseY || 0) - (player.pos.y || 0);
      const d = Math.hypot(dx, dz);
      // slight penalty for spots on another floor so closest same-floor spot wins ties
      const score = d + Math.abs(dy) * 2.2;
      spots.push({ sp, d });
      if (score < best3d) { best3d = score; bd = d; best = sp; }
    });
    let pathDist = bd;
    if (computePath && spots.length && this.world.colliders) {
      // Single-source 4m grid BFS using cached blocked array + pre-allocated typed buffers
      const G = this.getWalkGrid();
      const { STEP, MIN, N, blocked, distGrid, queue } = G;
      distGrid.fill(1e9);
      const clampIdx = v => Math.max(0, Math.min(N - 1, Math.round((v - MIN) / STEP)));
      const sx = clampIdx(player.pos.x), sz = clampIdx(player.pos.z);
      const sIdx = sx * N + sz;
      distGrid[sIdx] = 0;
      let head = 0, tail = 0;
      queue[tail++] = sIdx;
      const dirs = [[1, 0, STEP], [-1, 0, STEP], [0, 1, STEP], [0, -1, STEP], [1, 1, STEP * 1.414], [1, -1, STEP * 1.414], [-1, 1, STEP * 1.414], [-1, -1, STEP * 1.414]];
      while (head < tail) {
        const cur = queue[head++], cx = (cur / N) | 0, cz = cur % N, cd = distGrid[cur];
        for (let di = 0; di < 8; di++) {
          const nx = cx + dirs[di][0], nz = cz + dirs[di][1];
          if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
          const ni = nx * N + nz;
          if (blocked[ni]) continue;
          const nd = cd + dirs[di][2];
          if (nd < distGrid[ni]) { distGrid[ni] = nd; queue[tail++] = ni; }
        }
      }
      let bestPath = Infinity;
      for (let i = 0; i < spots.length; i++) {
        const { sp, d } = spots[i];
        const tx = clampIdx(sp.interact.x), tz = clampIdx(sp.interact.z);
        let gd = distGrid[tx * N + tz];
        if (gd >= 1e8) {
          for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            const nx = tx + ox, nz = tz + oz;
            if (nx >= 0 && nx < N && nz >= 0 && nz < N) gd = Math.min(gd, distGrid[nx * N + nz] + STEP);
          }
        }
        const cand = gd < 1e8 ? Math.max(d, gd) : d;
        if (cand < bestPath) bestPath = cand;
      }
      if (bestPath < 1e8) pathDist = bestPath;
    }
    return { spot: best, dist: bd, pathDist };
  };

  FastOne.prototype.farthestFence = function (fromPos) {
    const fences = this.world.fences || [];
    let best = null, bd = -1;
    for (const f of fences) {
      if (f.broken) continue;
      const d = Math.hypot(f.pos.x - fromPos.x, f.pos.z - fromPos.z);
      if (d > bd) { bd = d; best = f; }
    }
    if (!best && fences.length) {
      for (const f of fences) {
        const d = Math.hypot(f.pos.x - fromPos.x, f.pos.z - fromPos.z);
        if (d > bd) { bd = d; best = f; }
      }
    }
    return best;
  };

  FastOne.prototype.closestFence = function (fromPos) {
    const fences = this.world.fences || [];
    let best = null, bd = Infinity;
    for (const f of fences) {
      if (f.broken) continue;
      const d = Math.hypot(f.pos.x - fromPos.x, f.pos.z - fromPos.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };

  // pick a distant intact fence (>= 70m away, preferring the farthest opposite-side perimeter)
  FastOne.prototype.distantExitFence = function (refPos) {
    const fences = this.world.fences || [];
    let best = null, bd = -1;
    for (const f of fences) {
      if (f.broken) continue;
      const d = Math.hypot(f.pos.x - refPos.x, f.pos.z - refPos.z);
      if (d >= 70 && d > bd) { bd = d; best = f; }
    }
    return best || this.farthestFence(refPos);
  };

  // ---------------- reset ----------------
  FastOne.prototype.reset = function () {
    this.state = 'idle';          // idle | telegraph | chase | slam | exit
    this.targetPlayerId = null;
    this.cooldown = 0;
    this.timer = nextTime();
    this.telegraphT = 0;
    this.chaseT = 0;
    this.slamT = 0;
    this.slamPhase = 'approach';
    this.slamImpacted = false;
    this.slamSpot = null;
    this.exitFence = null;
    this.exitBreached = false;
    this.exitAfterT = 0;
    this.forestT = 0;
    this.stareTime = 0;
    this.retreatDir = null;
    this.gait = 0;
    this.lastStepHalf = 0;
    this.trail = [];
    this.trailTimer = 0;
    this.trailFade = 0;
    this.pos = this.root.position;
    this.root.visible = false;
    this.body.position.set(0, 0.62, 0);
    this.body.rotation.set(0, 0, 0);
    this.jaw.rotation.x = 0.25;
    this.clones.forEach(c => { c.g.visible = false; });
    this.clearHighlight();
    if (this.world && this.world.fences) {
      this.world.fences.forEach(f => {
        if (f.permanentGate) return;
        f.broken = false;
        f.mesh.visible = true;
        f.mesh.position.copy(f.basePos);
        f.mesh.rotation.copy(f.baseRot);
      });
    }
    for (const s of this.splinters) s.mesh.visible = false;
    this.splinters.length = 0;
    for (const d of this.dust) d.mesh.visible = false;
    this.dust.length = 0;
    if (LO.ambush.active === 'fastone') LO.ambush.active = null;
  };
FastOne.prototype.triggerLocalAttack = function (localPlayer, time) {
  if (!localPlayer || !localPlayer.alive || localPlayer.calm || this.state !== 'idle') return;
  this.targetPlayerId = null;
  const inForest = !(LO.ver && !LO.ver().forestRing) && this.world.isForest && this.world.isForest(localPlayer.pos);
  if (inForest) this.startForestStalk(localPlayer, time);
  else this.spawnBreach(localPlayer, time, true);
};
  // ---------------- spawn breach ----------------
  FastOne.prototype.spawnBreach = function (player, time, isLocalTarget) {
    const localT = isLocalTarget !== undefined ? isLocalTarget : true;
    const fence = this.farthestFence(player.pos);
    let sx = 0, sz = this.world.HALF + 2;
    if (fence) { sx = fence.pos.x; sz = fence.pos.z; }

    // start right at/just outside the shattered fence facing inward
    const inward = new V3(player.pos.x - sx, 0, player.pos.z - sz).normalize();
    this.pos.set(sx - inward.x * 1.4, 0, sz - inward.z * 1.4);
    this.root.rotation.y = Math.atan2(inward.x, inward.z);
    this.root.visible = true;

    const breachPos = this.breachFence(fence, inward);
    LO.audio.fastHowl(this.pos);

    const v2 = !LO.ver || LO.ver().fastoneV2;
    if (v2 && this.onBreach) this.onBreach(breachPos, 'entry');

    this.state = v2 ? 'telegraph' : 'chase';
    this.telegraphT = 0;
    this.chaseT = 0;
    this.gait = 0;
    this.trail = [];
    this.trailTimer = 0;
    this.trailFade = v2 ? 0 : 1;
    LO.ambush.active = 'fastone';

    const nearest = this.findClosestHideSpot(player, v2);
    let needAdrenaline = false;
    if (nearest.spot) {
      if (localT) this.setHighlight(nearest.spot, time);
      else this.highlightedSpot = nearest.spot;
      if (v2) {
        const estSeconds = nearest.pathDist / NORMAL_SPRINT_SPEED;
        needAdrenaline = estSeconds > ADRENALINE_TIME_THRESHOLD;
        if (localT && needAdrenaline && player.triggerAdrenaline && player.triggerAdrenaline(BREACH_DELAY + KILL_TIME + 0.5)) {
          LO.audio.adrenaline();
        }
      } else {
        const estSeconds = nearest.dist / LEGACY_WALK_SPEED;
        needAdrenaline = estSeconds > LEGACY_THRESHOLD;
        if (localT && needAdrenaline) {
          player.adrenaline = 8.0;
          player.stamina = 100;
          player.exhausted = false;
          LO.audio.adrenaline();
        }
      }
    }
    this.onEvent && this.onEvent({
      kind: 'breach',
      targetId: player.id || 'host',
      fenceIdx: fence && fence.idx !== undefined ? fence.idx : -1,
      dx: inward.x, dz: inward.z,
      hlSpotIdx: nearest.spot && nearest.spot.idx !== undefined ? nearest.spot.idx : -1,
      adrenaline: needAdrenaline,
      dur: v2 ? (BREACH_DELAY + KILL_TIME + 0.5) : 8.0,
    });
  };

  // ---------------- forest stalk spawn (no town breach, no locker highlight) ----------------
  const _fFwd = new V3(), _fTo = new V3(), _fTarget = new V3();
  FastOne.prototype.isForestSpotFree = function (x, z) {
    const W = this.world;
    const lim = (W.OUTER_E || 152) - 3;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (W.isForest && !W.isForest({ x, z })) return false;
    const cols = W.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.disabled || c.minY > 1.5 || c.maxY < 0.5) continue;
      if (x + 0.65 > c.minX && x - 0.65 < c.maxX && z + 0.65 > c.minZ && z - 0.65 < c.maxZ) return false;
    }
    return true;
  };

  FastOne.prototype.slideForest = function (nx, nz) {
    const cols = (this.world && this.world.colliders) || [];
    const r = 0.45;
    let x = nx, z = nz;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.disabled || c.maxY < 0.4 || c.minY > 1.5) continue;
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = r - d;
        x += (dx / d) * push; z += (dz / d) * push;
      }
    }
    this.pos.x = x; this.pos.z = z;
  };

  FastOne.prototype.startForestStalk = function (player) {
    const W = this.world;
    const E = W.E || ((W.HALF || 110) + 3);
    const OUTER = W.OUTER_E || (E + 39);
    let sx = player.pos.x, sz = player.pos.z;
    let found = false;
    const baseAng = Math.atan2(-player.pos.z, -player.pos.x) + Math.PI;
    for (let t = 0; t < 24; t++) {
      const ang = baseAng + (Math.random() - 0.5) * Math.PI * 1.4;
      const dist = 22 + Math.random() * 6;
      const cx = Math.max(-(OUTER - 3), Math.min(OUTER - 3, player.pos.x + Math.cos(ang) * dist));
      const cz = Math.max(-(OUTER - 3), Math.min(OUTER - 3, player.pos.z + Math.sin(ang) * dist));
      if (this.isForestSpotFree(cx, cz)) { sx = cx; sz = cz; found = true; break; }
    }
    if (!found) {
      // Fallback: place along the nearest outer forest flank on the player's side
      const ax = Math.abs(player.pos.x), az = Math.abs(player.pos.z);
      if (ax >= az) {
        sx = Math.sign(player.pos.x || 1) * Math.min(OUTER - 4, Math.max(E + 14, ax));
        sz = player.pos.z + (player.pos.z > 0 ? -24 : 24);
      } else {
        sz = Math.sign(player.pos.z || 1) * Math.min(OUTER - 4, Math.max(E + 14, az));
        sx = player.pos.x + (player.pos.x > 0 ? -24 : 24);
      }
    }
    this.clearHighlight();
    this.pos.set(sx, 0, sz);
    const dx = player.pos.x - sx, dz = player.pos.z - sz;
    this.root.rotation.y = Math.atan2(dx, dz);
    this.root.visible = true;
    this.state = 'forest_stalk';
    this.forestT = 0;
    this.stareTime = 0;
    this.gait = 0;
    this.trail = [];
    this.trailTimer = 0;
    this.trailFade = 0.65;
    LO.ambush.active = 'fastone';
    LO.audio.fastHowl(this.pos);
    this.onEvent && this.onEvent({ kind: 'howl', x: this.pos.x, z: this.pos.z });
  };

  // ---------------- breach telegraph & gallop animation helpers ----------------
  FastOne.prototype.animateTelegraph = function (dt, player) {
    const t = this.telegraphT;
    const p = t / BREACH_DELAY;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    this.root.rotation.y = Math.atan2(dx, dz);
    // brace low & snarl violently, lunging forward near t -> 2.5s
    const crouch = p < 0.78 ? Math.sin(p * Math.PI) * 0.14 : 0.18 * (1 - (p - 0.78) / 0.22);
    this.body.position.y = 0.54 - crouch * 0.4 + Math.sin(t * 22) * 0.02;
    this.body.rotation.x = p < 0.78 ? -0.18 - Math.sin(t * 14) * 0.06 : 0.15;
    this.jaw.rotation.x = 0.45 + Math.abs(Math.sin(t * 11)) * 0.42;
    this.tail.rotation.y = Math.sin(t * 15) * 0.55;
    this.legs.forEach(L => {
      const scrape = L.front ? Math.sin(t * 9 + L.phase) * 0.28 : 0;
      L.hip.rotation.x = (L.front ? -0.25 : 0.28) + scrape;
      L.knee.rotation.x = L.front ? -0.35 : 0.45;
    });
    const half = Math.floor(t * 4);
    if (half !== this.lastStepHalf) {
      this.lastStepHalf = half;
      LO.audio.fastStep(this.pos);
    }
    const dist = Math.hypot(dx, dz);
    if (dist < 45) {
      player.shake = Math.max(player.shake, (1 - dist / 45) * 0.25);
    }
  };

  FastOne.prototype.animateRun = function (dt, speed, time) {
    this.gait += dt * (10 + speed * 0.65);
    const p = this.gait;
    this.body.position.y = 0.60 + Math.abs(Math.sin(p)) * 0.14;
    this.body.rotation.x = Math.sin(p) * 0.14;
    this.jaw.rotation.x = 0.35 + Math.max(0, Math.sin(p * 1.3)) * 0.35;
    this.tail.rotation.y = Math.sin(p * 1.5) * 0.35;
    this.legs.forEach(L => {
      const lp = p + L.phase;
      L.hip.rotation.x = Math.sin(lp) * 0.85;
      L.knee.rotation.x = L.front ? -0.45 + Math.cos(lp) * 0.5 : 0.45 - Math.cos(lp) * 0.5;
    });
    const half = Math.floor(p / Math.PI);
    if (half !== this.lastStepHalf) {
      this.lastStepHalf = half;
      LO.audio.fastStep(this.pos);
    }
  };

  // ---------------- update ----------------
  FastOne.prototype.forceSpawn = function (player, time) {
    if (!player) return false;
    if (this.state !== 'idle') this.finishEncounter();
    if (LO.ambush) { LO.ambush.active = null; LO.ambush.gapUntil = 0; }
    this.cooldown = 0;
    this.timer = 0;
    const inForest = (!LO.ver || LO.ver().forestRing) && this.world.isForest && this.world.isForest(player.pos);
    if (inForest) this.startForestStalk(player, time || 0);
    else this.spawnBreach(player, time || 0);
    return true;
  };

  FastOne.prototype.update = function (dt, playerOrList, camera, siren, time) {
    this.updateSplinters(dt);
    const isMulti = Array.isArray(playerOrList);
    const allPlayers = isMulti ? playerOrList : [playerOrList];
    const localPlayer = allPlayers[0];

    if ((LO.ver && !LO.ver().fastone) || (LO.admin && LO.admin.noFastOne)) {
      if (this.state !== 'idle') this.finishEncounter();
      this.updateAfterimages(dt, false);
      return;
    }

    const resolveTarget = () => {
      if (!isMulti) return localPlayer;
      return allPlayers.find(p => p && p.id === this.targetPlayerId) || null;
    };
    const isTargetLocal = t => !isMulti || (t && t === localPlayer);
    const getHidingSpot = t => {
      if (!t) return null;
      if (t.hidden && typeof t.hidden === 'object') return t.hidden;
      if (t.hideAnim && t.hideAnim.dir === 'in' && t.hideAnim.t >= 0.45) return t.hideAnim.spot;
      if (t.hidden && t.hideSpotIdx >= 0 && this.world && this.world.hideSpots) {
        return this.world.hideSpots[t.hideSpotIdx] || { pos: t.pos, exit: t.pos, baseY: t.pos.y || 0 };
      }
      return null;
    };

    let player = resolveTarget();

    if (this.state !== 'idle' && (!player || player.calm || !player.alive)) {
      this.clearHighlight();
      if (this.state === 'chase' || this.state === 'telegraph') this.startExit(player);
      else if (this.state === 'forest_stalk') {
        this.state = 'forest_retreat';
        this.forestT = 0;
        const rp = (player && player.pos) || { x: 0, z: 0 };
        this.retreatDir = new V3(this.pos.x - rp.x, 0, this.pos.z - rp.z).normalize();
      }
    }

    if (this.state === 'idle') {
      this.updateAfterimages(dt, false);
      if (this.cooldown > 0) {
        this.cooldown = Math.max(0, this.cooldown - dt);
        return;
      }
      // Pick eligible targets (alive, not calm, not hiding, not near Siren Head)
      const eligible = allPlayers.filter(p => {
        if (!p || !p.alive || p.calm || p.hidden || p.hideAnim) return false;
        const hearFlash = LO.NOISE.flashlight * 1.3 * (p.indoor ? 0.6 : 1);
        const dSiren = siren && siren.pos ? Math.hypot(p.pos.x - siren.pos.x, p.pos.z - siren.pos.z) : 999;
        return dSiren >= hearFlash + 4;
      });
      const isCoopClient = window.LO && LO.Net && LO.Net.isCoop && LO.Net.isCoop() && LO.Net.isClient && LO.Net.isClient();
    const isCoopHost = window.LO && LO.Net && LO.Net.isCoop && LO.Net.isCoop() && LO.Net.isHost && LO.Net.isHost();
    if (isCoopClient) return;
    // spawn timer pauses when no player is eligible
    if (!eligible.length) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    // mandatory 18-20s minimum gap from The Sneaky One
    if (LO.ambush.active || LO.ambush.now < LO.ambush.gapUntil) {
      this.timer = 0;
      return;
    }
    if (isCoopHost && LO.Net.broadcast) {
      LO.Net.broadcast({ type: 'fast_wave' });
    }
    this.triggerLocalAttack(localPlayer, time);
    return;
    }

    if (this.state === 'forest_stalk') {
      this.forestT += dt;
      this.clearHighlight();
      if (!player) { this.finishEncounter(); return; }
      if (this.world.isForest && !this.world.isForest(player.pos)) {
        this.state = 'forest_retreat';
        this.forestT = 0;
        this.retreatDir = new V3(this.pos.x - player.pos.x, 0, this.pos.z - player.pos.z).normalize();
        return;
      }
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const speed = 5.8 + Math.min(2.2, this.forestT * 0.25);

      const wantYaw = Math.atan2(dx, dz);
      let diff = wantYaw - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += Math.max(-8 * dt, Math.min(8 * dt, diff));

      const step = Math.min(dist, speed * dt);
      this.slideForest(this.pos.x + (dx / dist) * step, this.pos.z + (dz / dist) * step);
      this.pos.y = 0;

      if (isTargetLocal(player) && dist < 24) {
        player.shake = Math.max(player.shake, Math.pow(1 - dist / 24, 1.5) * 0.26);
      }

      this.animateRun(dt, speed, time);
      this.updateAfterimages(dt, true);

      // Look directly at The Fast One when it gets close (<= 18m) to drive it back into the trees
      if (dist <= 18) {
        let eyePos;
        if (isTargetLocal(player) && camera) {
          camera.getWorldDirection(_fFwd);
          eyePos = camera.position;
        } else {
          const cp = Math.cos(player.pitch || 0);
          _fFwd.set(-Math.sin(player.yaw || 0) * cp, Math.sin(player.pitch || 0), -Math.cos(player.yaw || 0) * cp).normalize();
          this._remoteEye = this._remoteEye || new V3();
          this._remoteEye.set(player.pos.x, (player.pos.y || 0) + 1.62 - (player.crouch || 0) * 0.67, player.pos.z);
          eyePos = this._remoteEye;
        }
        _fTarget.set(this.pos.x, 0.85, this.pos.z);
        _fTo.copy(_fTarget).sub(eyePos);
        const camDist = _fTo.length() || 0.001;
        _fTo.divideScalar(camDist);
        let clearLOS = _fTo.dot(_fFwd) > 0.76;
        if (clearLOS && this.world.segmentHitsTree && this.world.segmentHitsTree(eyePos.x, eyePos.z, _fTarget.x, _fTarget.z)) {
          clearLOS = false;
        }
        if (clearLOS && this.world.occluders && this.world.occluders.length) {
          this._losRay = this._losRay || new THREE.Raycaster();
          this._losRay.set(eyePos, _fTo);
          this._losRay.far = camDist;
          const occl = this.world.queryOccluders
            ? this.world.queryOccluders(eyePos.x, eyePos.z, _fTarget.x, _fTarget.z)
            : this.world.occluders;
          const hits = occl.length ? this._losRay.intersectObjects(occl, false) : [];
          if (hits.length && hits[0].distance < camDist - 0.9) clearLOS = false;
        }
        if (clearLOS) {
          this.stareTime += dt * (player.flashOn ? 1.55 : 1.0);
          if (isTargetLocal(player)) player.shake = Math.max(player.shake, 0.14);
          if (this.stareTime >= 0.42) {
            LO.audio.fastHowl(this.pos);
            this.onEvent && this.onEvent({ kind: 'howl', x: this.pos.x, z: this.pos.z });
            if (isTargetLocal(player)) player.shake = Math.max(player.shake, 0.35);
            this.state = 'forest_retreat';
            this.forestT = 0;
            this.retreatDir = new V3(this.pos.x - player.pos.x, 0, this.pos.z - player.pos.z).normalize();
            return;
          }
        } else {
          this.stareTime = Math.max(0, this.stareTime - dt * 0.8);
        }
      } else {
        this.stareTime = Math.max(0, this.stareTime - dt * 0.8);
      }

      if (dist < 2.05 || this.forestT >= 11.0) {
        const killed = player;
        this.finishEncounter();
        if (this.onKillPlayer) { this.onKillPlayer(killed); return; }
        return 'kill';
      }
      return;
    }

    if (this.state === 'forest_retreat') {
      this.forestT += dt;
      const d = this.retreatDir || new V3(1, 0, 0);
      const exitSpeed = 30;
      this.pos.x += d.x * exitSpeed * dt;
      this.pos.z += d.z * exitSpeed * dt;
      this.root.rotation.y = Math.atan2(d.x, d.z);
      this.animateRun(dt, exitSpeed, time);
      this.updateAfterimages(dt, true);
      if (this.forestT >= 0.95) this.finishEncounter();
      return;
    }

    if (this.state === 'telegraph') {
      this.telegraphT += dt;
      this.animateTelegraph(dt, player || localPlayer);
      this.updateAfterimages(dt, false);
      const hidingSpot = getHidingSpot(player);
      if (isTargetLocal(player)) {
        if (!hidingSpot) {
          const nearest = this.findClosestHideSpot(player);
          this.setHighlight(nearest.spot, time);
        } else {
          this.clearHighlight();
        }
      }
      if (this.telegraphT >= BREACH_DELAY) {
        this.state = 'chase';
        this.chaseT = 0;
        this.trailFade = 1;
        LO.audio.fastHowl(this.pos);
        this.onEvent && this.onEvent({ kind: 'howl', x: this.pos.x, z: this.pos.z });
      }
      return;
    }

    if (this.state === 'chase') {
      this.chaseT += dt;
      // did the target player make it into a hiding spot?
      const hidingSpot = getHidingSpot(player);
      if (hidingSpot) {
        this.clearHighlight();
        this.state = 'slam';
        this.slamSpot = hidingSpot;
        this.slamPhase = 'approach';
        this.slamT = 0;
        this.slamImpacted = false;
        return;
      }

      // keep the closest hiding spot highlighted in blue for local target
      if (isTargetLocal(player)) {
        const nearest = this.findClosestHideSpot(player);
        this.setHighlight(nearest.spot, time);
      }

      // steer straight toward target player so it arrives at ~6 seconds
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const rem = Math.max(0.12, KILL_TIME - this.chaseT);
      const speed = Math.max(22, dist / rem);

      const wantYaw = Math.atan2(dx, dz);
      let diff = wantYaw - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += Math.max(-10 * dt, Math.min(10 * dt, diff));

      const step = Math.min(dist, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;

      if (isTargetLocal(player) && dist < 32) {
        player.shake = Math.max(player.shake, Math.pow(1 - dist / 32, 1.5) * 0.45);
      }

      this.animateRun(dt, speed, time);
      this.updateAfterimages(dt, true);

      if (this.chaseT >= KILL_TIME && !hidingSpot) {
        const killed = player;
        this.clearHighlight();
        this.root.visible = false;
        this.updateAfterimages(dt, false);
        this.clones.forEach(c => { c.g.visible = false; });
        if (LO.ambush.active === 'fastone') {
          LO.ambush.active = null;
          LO.ambush.gapUntil = LO.ambush.now + 10 + Math.random() * 10;
        }
        this.state = 'idle';
        this.targetPlayerId = null;
        this.cooldown = (!LO.ver || LO.ver().fastoneCooldown) ? COOLDOWN_T : 0;
        this.timer = nextTime();
        if (this.onKillPlayer) { this.onKillPlayer(killed); return; }
        return 'kill';
      }
      return;
    }

    if (this.state === 'slam') {
      const sp = this.slamSpot;
      if (!sp || sp.disabled) { this.startExit(player); return; }
      if (this.slamPhase === 'approach') {
        const tx = sp.exit ? sp.exit.x : sp.pos.x, tz = sp.exit ? sp.exit.z : sp.pos.z;
        const dx = tx - this.pos.x, dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 1.2) {
          this.pos.set(tx, sp.baseY || 0, tz);
          this.root.rotation.y = Math.atan2(sp.pos.x - this.pos.x, sp.pos.z - this.pos.z);
          this.slamPhase = 'rear';
          this.slamT = 0;
          LO.audio.fastHowl(this.pos);
          this.onEvent && this.onEvent({ kind: 'howl', x: this.pos.x, z: this.pos.z });
        } else {
          const speed = 32;
          const step = Math.min(dist, speed * dt);
          this.pos.x += (dx / dist) * step;
          this.pos.z += (dz / dist) * step;
          this.pos.y += ((sp.baseY || 0) - this.pos.y) * Math.min(1, dt * 8);
          this.root.rotation.y = Math.atan2(dx, dz);
          this.animateRun(dt, speed, time);
          this.updateAfterimages(dt, true);
        }
        return;
      }

      // rear-up and slam animation against the locker/dumpster
      this.slamT += dt;
      this.updateAfterimages(dt, false);
      const t = this.slamT;
      this.root.rotation.y = Math.atan2(sp.pos.x - this.pos.x, sp.pos.z - this.pos.z);

      if (t < 0.45) {
        // rear up onto hind legs
        const k = t / 0.45;
        const e = k * k * (3 - 2 * k);
        this.body.position.y = 0.62 + e * 0.62;
        this.body.rotation.x = -e * 0.82;
        this.jaw.rotation.x = 0.25 + e * 0.65;
        this.legs.forEach(L => {
          if (L.front) {
            L.hip.rotation.x = -0.9 * e;
            L.knee.rotation.x = -0.4 * e;
          } else {
            L.hip.rotation.x = 0.45 * e;
            L.knee.rotation.x = 0.35 * e;
          }
        });
      } else if (t < 0.65) {
        // slam violently forward onto the hiding spot
        const k = (t - 0.45) / 0.20;
        const e = k * k;
        this.body.position.y = 1.24 - e * 0.62;
        this.body.rotation.x = -0.82 + e * 1.05;
        this.jaw.rotation.x = 0.90 - e * 0.55;
        this.legs.forEach(L => {
          if (L.front) {
            L.hip.rotation.x = -0.9 + e * 1.25;
            L.knee.rotation.x = -0.4 + e * 0.3;
          } else {
            L.hip.rotation.x = 0.45 * (1 - e);
            L.knee.rotation.x = 0.35 * (1 - e);
          }
        });
        if (!this.slamImpacted && t >= 0.56) {
          this.slamImpacted = true;
          LO.audio.fastSlam(sp.pos);
          this.onEvent && this.onEvent({ kind: 'slam', x: sp.pos.x, y: sp.baseY || 0, z: sp.pos.z });
          if (localPlayer && Math.hypot(localPlayer.pos.x - sp.pos.x, localPlayer.pos.z - sp.pos.z) < 25) {
            localPlayer.shake = Math.max(localPlayer.shake, 1.0);
          }
        }
      } else if (t < 1.35) {
        // rattle door briefly & recoil back to all fours
        const k = Math.min(1, (t - 0.65) / 0.35);
        this.body.position.y = 0.62;
        this.body.rotation.x = 0.23 * (1 - k);
        this.jaw.rotation.x = 0.35 + Math.sin(t * 24) * 0.12;
        this.legs.forEach(L => {
          L.hip.rotation.x *= (1 - k);
          L.knee.rotation.x *= (1 - k);
        });
        if ((!player || !player.hideAnim) && sp.setOpen) {
          sp.setOpen(t < 0.92 ? Math.max(0, Math.sin((t - 0.65) * 45) * 0.06) : 0);
        }
      } else {
        if ((!player || !player.hideAnim) && sp.setOpen) sp.setOpen(0);
        this.startExit(player);
      }
      return;
    }

    if (this.state === 'exit') {
      const f = this.exitFence;
      const v2 = !LO.ver || LO.ver().fastoneV2;
      const exitSpeed = v2 ? 44 : 34;
      const maxExitElapsed = v2 ? 9.0 : 4.5;
      if (!this.exitBreached) {
        this.exitElapsed += dt;
        const tx = f ? f.pos.x : 0;
        const tz = f ? f.pos.z : -(this.world.HALF + 2);
        const dx = tx - this.pos.x, dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const step = Math.min(dist, exitSpeed * dt);
        this.pos.x += (dx / dist) * step;
        this.pos.z += (dz / dist) * step;
        this.pos.y = Math.max(0, this.pos.y - dt * 12);
        this.root.rotation.y = Math.atan2(dx, dz);
        this.animateRun(dt, exitSpeed, time);
        this.updateAfterimages(dt, true);

        if (dist <= 2.6 || this.exitElapsed > maxExitElapsed) {
          this.exitBreached = true;
          this.exitAfterT = 0;
          const outDir = new V3(dx / dist, 0, dz / dist);
          this.exitDir = outDir;
          const exitPos = this.breachFence(f, outDir);
          this.onEvent && this.onEvent({
            kind: 'exit_breach',
            fenceIdx: f && f.idx !== undefined ? f.idx : -1,
            dx: outDir.x, dz: outDir.z,
          });
          if (v2 && this.onBreach) {
            this.onBreach(exitPos, 'exit');
          }
        }
      } else {
        this.exitAfterT += dt;
        const d = this.exitDir || new V3(0, 0, -1);
        this.pos.x += d.x * exitSpeed * dt;
        this.pos.z += d.z * exitSpeed * dt;
        this.animateRun(dt, exitSpeed, time);
        this.updateAfterimages(dt, true);

        if (this.exitAfterT >= 0.55) {
          this.finishEncounter();
        }
      }
    }
  };

  FastOne.prototype.getNetState = function () {
    return {
      state: this.state,
      vis: !!this.root.visible,
      x: +this.pos.x.toFixed(2),
      y: +this.pos.y.toFixed(2),
      z: +this.pos.z.toFixed(2),
      yaw: +this.root.rotation.y.toFixed(3),
      targetId: this.targetPlayerId || null,
      hlSpotIdx: (this.highlightedSpot && this.highlightedSpot.idx !== undefined) ? this.highlightedSpot.idx : -1,
    };
  };

  FastOne.prototype.applyNetState = function (snap, dt, localId, localPlayer, time) {
    this.updateSplinters(dt);
    if (!snap || snap.state === 'idle' || !snap.vis) {
      this.state = 'idle';
      this.root.visible = false;
      this.clearHighlight();
      this.updateAfterimages(dt, false);
      return;
    }
    this.state = snap.state;
    this.root.visible = true;
    const k = Math.min(1, 1 - Math.exp(-18 * (dt || 0.016)));
    this.pos.x += (snap.x - this.pos.x) * k;
    this.pos.y += (snap.y - this.pos.y) * k;
    this.pos.z += (snap.z - this.pos.z) * k;
    let dYaw = snap.yaw - this.root.rotation.y;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.root.rotation.y += dYaw * k;

    if (snap.targetId === localId && localPlayer && !localPlayer.hidden && (this.state === 'telegraph' || this.state === 'chase')) {
      const sp = snap.hlSpotIdx >= 0 && this.world && this.world.hideSpots ? this.world.hideSpots[snap.hlSpotIdx] : this.findClosestHideSpot(localPlayer).spot;
      this.setHighlight(sp, time);
    } else {
      this.clearHighlight();
    }

    if (this.state === 'telegraph') {
      this.telegraphT = (this.telegraphT || 0) + dt;
      this.animateTelegraph(dt, localPlayer || { pos: this.pos });
      this.updateAfterimages(dt, false);
    } else if (this.state === 'slam') {
      this.updateAfterimages(dt, false);
    } else {
      this.animateRun(dt, 24, time);
      this.updateAfterimages(dt, true);
    }
  };

  FastOne.prototype.startExit = function (player) {
    this.clearHighlight();
    this.state = 'exit';
    const v2 = !LO.ver || LO.ver().fastoneV2;
    const refPos = (player && player.pos) || this.pos;
    this.exitFence = v2 ? this.distantExitFence(refPos) : this.closestFence(this.pos);
    this.exitBreached = false;
    this.exitAfterT = 0;
    this.exitElapsed = 0;
    this.body.position.y = 0.62;
    this.body.rotation.set(0, 0, 0);
  };

  FastOne.prototype.finishEncounter = function () {
    this.state = 'idle';
    this.targetPlayerId = null;
    this.root.visible = false;
    this.clones.forEach(c => { c.g.visible = false; });
    this.trail = [];
    this.trailFade = 0;
    this.cooldown = (!LO.ver || LO.ver().fastoneCooldown) ? COOLDOWN_T : 0;
    this.timer = nextTime();
    if (LO.ambush.active === 'fastone') {
      LO.ambush.active = null;
      LO.ambush.gapUntil = LO.ambush.now + 10 + Math.random() * 10;
    }
  };

  FastOne.prototype.dispose = function () {
    this.clearHighlight();
    if (this.highlightLight) this.scene.remove(this.highlightLight);
    this.scene.remove(this.root);
    this.scene.remove(this.fxGroup);
  };
})();
