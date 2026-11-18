// ============================================================
//  THE LOUD ONE — the Moths
//  Pale, motionless figures standing in dark corners and alleys.
//  Keep your flashlight on one for more than ~2 seconds and it
//  shrieks: Siren Head hears it, and it tears off some of your HP.
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const LIGHT_LIMIT = 1.0;   // seconds of light before it shrieks
  const DAMAGE = 20;
  const COUNT = 24;
  const BEAM_ANGLE = 0.42;   // radians — roughly the bright part of the beam
  const BEAM_RANGE = 34;
  LO.MOTH = { LIGHT_LIMIT, DAMAGE };

  function Moths(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.raycaster = new THREE.Raycaster();
    this.mat = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 });
    this.wingMat = new THREE.MeshLambertMaterial({ color: 0xbdb7a6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    this.buildSpots();
    this.moths = [];
    for (let i = 0; i < COUNT; i++) this.moths.push(this.makeMoth());
    this.reset();
  }
  LO.Moths = Moths;

  // candidate places: dark corners inside buildings and alleys between them
  Moths.prototype.buildSpots = function () {
    const W = this.world, spots = [];
    const clearAt = (x, z) => {
      for (let i = 0; i < W.colliders.length; i++) {
        const c = W.colliders[i];
        if (c.disabled || c.minY > 1.75 || c.maxY < 0.35) continue;
        if (x + 0.45 > c.minX && x - 0.45 < c.maxX && z + 0.45 > c.minZ && z - 0.45 < c.maxZ) return false;
      }
      return true;
    };
    W.interiors.forEach(r => {
      const m = 0.9;
      [[r.minX + m, r.minZ + m], [r.maxX - m, r.maxZ - m], [r.minX + m, r.maxZ - m], [r.maxX - m, r.minZ + m],
       [(r.minX + r.maxX) * 0.5, r.minZ + 1.4], [(r.minX + r.maxX) * 0.5, r.maxZ - 1.4]].forEach(([sx, sz]) => {
        if (clearAt(sx, sz)) spots.push({ x: sx, z: sz, indoor: true });
      });
    });
    LO.World.BLOCK_C.forEach(bx => LO.World.BLOCK_C.forEach(bz => {
      [-14, -7, 7, 14].forEach(o => {
        if (clearAt(bx + o, bz)) spots.push({ x: bx + o, z: bz, indoor: false });
        if (clearAt(bx, bz + o)) spots.push({ x: bx, z: bz + o, indoor: false });
      });
    }));
    // keep them away from the start
    this.spots = spots.filter(s => Math.hypot(s.x - W.spawn.x, s.z - W.spawn.z) > 30);
  };

  // ---------- shared look: furry pale body, patterned wings, glossy compound eyes ----------
  function wingTexture(hind) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    // base: dusty grey-brown, darker toward the body
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, hind ? '#6d6253' : '#5a5045'); gr.addColorStop(1, hind ? '#a8998a' : '#9a8b78');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    // mottled dust
    for (let i = 0; i < 2200; i++) { const v = Math.random() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    // wavy bands
    g.strokeStyle = 'rgba(40,30,22,0.55)'; g.lineWidth = 5;
    [90, 150, 205].forEach(x => { g.beginPath(); for (let y = 0; y <= 256; y += 16) g.lineTo(x + Math.sin(y * 0.06) * 10, y); g.stroke(); });
    // veins fanning out from the base
    g.strokeStyle = 'rgba(30,22,16,0.45)'; g.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(0, 128); g.quadraticCurveTo(110, 128 + (i - 4) * 18, 256, (i + 0.5) * 28); g.stroke(); }
    // an eyespot
    const ex = hind ? 160 : 175, ey = hind ? 120 : 110;
    [[26, '#1c140e'], [20, '#c9b48e'], [12, '#2a1a12'], [4, '#e8dcc0']].forEach(([r, col]) => { g.fillStyle = col; g.beginPath(); g.arc(ex, ey, r, 0, 7); g.fill(); });
    // ragged, torn edges (alpha)
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(256 - Math.random() * 18, Math.random() * 256, 4 + Math.random() * 10, 0, 7); g.fill(); }
    for (let i = 0; i < 10; i++) { g.beginPath(); g.arc(Math.random() * 256, 256 - Math.random() * 10, 3 + Math.random() * 8, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function furTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      const v = 150 + Math.random() * 90; g.strokeStyle = `rgba(${v},${v - 8},${v - 20},0.6)`; g.lineWidth = 1;
      const x = Math.random() * 128, y = Math.random() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 4 + Math.random() * 5); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); t.encoding = THREE.sRGBEncoding;
    return t;
  }
  // a wing outline with UVs mapped across the texture
  function wingGeo(pts) {
    const sh = new THREE.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
    const geo = new THREE.ShapeGeometry(sh);
    geo.computeBoundingBox(); const bb = geo.boundingBox;
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    return geo;
  }

  Moths.prototype.kit = function () {
    if (this._kit) return this._kit;
    const fur = new THREE.MeshLambertMaterial({ map: furTexture(), color: 0xe6dccb });
    const skin = new THREE.MeshLambertMaterial({ color: 0xb8ae9c });
    const eye = new THREE.MeshStandardMaterial({ color: 0x120808, roughness: 0.12, metalness: 0.2 });
    const fore = new THREE.MeshLambertMaterial({ map: wingTexture(false), side: THREE.DoubleSide, alphaTest: 0.45, transparent: true });
    const hind = new THREE.MeshLambertMaterial({ map: wingTexture(true), side: THREE.DoubleSide, alphaTest: 0.45, transparent: true });
    const V2 = THREE.Vector2;
    const lathe = (len, prof, seg) => new THREE.LatheGeometry(prof.map(([r, t]) => new V2(r, -t * len)), seg || 8);
    const antCurves = [-1, 1].map(sd => new THREE.CatmullRomCurve3([
      new V3(sd * 0.04, 0.16, 0.06),
      new V3(sd * 0.14, 0.34, 0.1),
      new V3(sd * 0.3, 0.42, 0.02),
    ]));
    this._kit = {
      fur, skin, eye, fore, hind,
      thorax: lathe(0.75, [[0.05, 0], [0.2, 0.08], [0.24, 0.35], [0.2, 0.75], [0.12, 1]], 10),
      abdomen: lathe(0.55, [[0.12, 0], [0.16, 0.3], [0.13, 0.75], [0.05, 1]], 10),
      leg: lathe(1.0, [[0.06, 0], [0.055, 0.45], [0.035, 0.55], [0.03, 0.95], [0.02, 1]], 6),
      arm: lathe(0.62, [[0.04, 0], [0.03, 0.9], [0.022, 1]], 6),
      finger: lathe(0.2, [[0.012, 0], [0.004, 1]], 4),
      head: new THREE.SphereGeometry(0.13, 12, 10),
      eyeG: new THREE.SphereGeometry(0.075, 12, 10),
      collar: new THREE.ConeGeometry(0.03, 0.14, 4),
      rings: [0, 1, 2].map(i => new THREE.TorusGeometry(0.135 - i * 0.012, 0.012, 4, 14)),
      antTubes: antCurves.map(c => new THREE.TubeGeometry(c, 10, 0.008, 4)),
      antBarbs: antCurves.map((c, idx) => {
        const sd = idx === 0 ? -1 : 1, pts = [];
        for (let b = 1; b < 9; b++) { const p = c.getPoint(b / 9); pts.push({ x: p.x, y: p.y + 0.02, z: p.z, rz: sd * 0.6 }); }
        return pts;
      }),
      barbG: new THREE.CylinderGeometry(0.003, 0.003, 0.07, 3),
      foreG: wingGeo([[0, 0], [0.25, 0.32], [0.78, 0.5], [0.95, 0.25], [0.8, -0.1], [0.4, -0.28], [0.08, -0.12]]),
      hindG: wingGeo([[0, 0], [0.4, 0.05], [0.72, -0.15], [0.7, -0.5], [0.38, -0.62], [0.1, -0.35]]),
    };
    return this._kit;
  };

  Moths.prototype.makeMoth = function () {
    const K = this.kit();
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx, ry, rz, parent) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); (parent || g).add(m); return m;
    };
    // long, thin, slightly bent legs
    [-1, 1].forEach(sd => { add(K.leg, K.skin, sd * 0.1, 1.28, 0, 0.06, 0, sd * 0.03); add(K.leg, K.skin, sd * 0.11, 0.55, 0.05, -0.12, 0, 0).scale.setScalar(0.62); });
    // furry thorax and a hanging, segmented abdomen
    add(K.thorax, K.fur, 0, 2.15, 0).scale.set(1, 1, 0.75);
    const ab = add(K.abdomen, K.fur, 0, 1.42, -0.04); ab.scale.set(0.9, 1, 0.8);
    for (let i = 0; i < 3; i++) add(K.rings[i], K.skin, 0, 1.3 - i * 0.12, -0.04, Math.PI / 2);
    // a ruff of fur around the neck
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; add(K.collar, K.fur, Math.cos(a) * 0.17, 2.1, Math.sin(a) * 0.13, Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); }
    // long arms with spindly fingers
    [-1, 1].forEach(sd => {
      const sh = new THREE.Group(); sh.position.set(sd * 0.2, 2.05, 0.02); sh.rotation.z = sd * 0.12; g.add(sh);
      add(K.arm, K.skin, 0, 0, 0, 0, 0, 0, sh);
      const el = new THREE.Group(); el.position.y = -0.62; el.rotation.x = -0.25; sh.add(el);
      add(K.arm, K.skin, 0, 0, 0, 0, 0, 0, el);
      for (let f = 0; f < 3; f++) add(K.finger, K.skin, (f - 1) * 0.025, -0.62, 0, 0.2, 0, (f - 1) * 0.15, el);
    });
    // the head: big, glossy, black compound eyes and feathery antennae
    const head = new THREE.Group(); head.position.y = 2.28; g.add(head);
    add(K.head, K.fur, 0, 0.05, 0, 0, 0, 0, head).scale.set(1, 1.05, 0.95);
    [0, 1].forEach(idx => {
      const sd = idx === 0 ? -1 : 1;
      add(K.eyeG, K.eye, sd * 0.085, 0.07, 0.07, 0, 0, 0, head).scale.set(0.85, 1.1, 0.9);
      add(K.antTubes[idx], K.skin, 0, 0, 0, 0, 0, 0, head);
      K.antBarbs[idx].forEach(bp => add(K.barbG, K.skin, bp.x, bp.y, bp.z, 0.4, 0, bp.rz, head));
    });
    // four wings, half-folded behind the back
    const wings = [];
    [-1, 1].forEach(side => {
      const root = new THREE.Group(); root.position.set(side * 0.08, 2.05, -0.14); g.add(root);
      const fw = new THREE.Mesh(K.foreG, K.fore); fw.scale.set(side * 1.15, 1.15, 1); fw.rotation.z = side * 0.15; root.add(fw);
      const hw = new THREE.Mesh(K.hindG, K.hind); hw.scale.set(side * 1.05, 1.05, 1); hw.position.set(0, -0.08, -0.01); hw.rotation.z = side * 0.05; root.add(hw);
      root.rotation.y = side * 0.5;
      wings.push({ mesh: root, side });
    });
    g.visible = false;
    this.root.add(g);
    return { g, head, wings, lit: 0, active: false, cooldown: 0, spot: null, twitch: 0 };
  };

  Moths.prototype.place = function (m) {
    const used = new Set(this.moths.filter(o => o.active && o !== m).map(o => o.spot));
    const free = this.spots.filter(s => !used.has(s));
    const s = free[(Math.random() * free.length) | 0];
    m.spot = s;
    m.g.position.set(s.x, s.indoor ? 0.14 : 0.12, s.z);
    m.g.rotation.y = Math.random() * Math.PI * 2;
    m.lit = 0; m.active = true; m.g.visible = true;
  };

  Moths.prototype.reset = function () {
    const V = LO.ver ? LO.ver() : { moths: true, mothCount: COUNT };
    const limit = V.moths ? (V.mothCount || COUNT) : 0;
    this.moths.forEach((m, i) => {
      m.active = false; m.g.visible = false; m.cooldown = 0; m.spot = null;
      if (i < limit) this.place(m);
    });
    this.root.visible = V.moths;
    this.maxLit = 0;
  };

  const _fwd = new V3(), _to = new V3(), _chest = new V3();
  Moths.prototype.update = function (dt, player, camera, time) {
    const V = LO.ver ? LO.ver() : { moths: true, mothCount: COUNT, mothLimit: LIGHT_LIMIT, mothDamage: DAMAGE };
    if (!V.moths) {
      this.root.visible = false;
      LO.audio.setMothFlutter(0);
      return;
    }
    this.root.visible = true;
    const activeLimit = V.mothCount || COUNT;
    const stareLimit = V.mothLimit || LIGHT_LIMIT;
    const W = this.world;
    camera.getWorldDirection(_fwd);
    this.maxLit = 0;
    this.nearestLit = null;
    // they can only be seen in flashlight — with it off, they're simply not there
    const show = player.flashOn && player.flash.intensity > 0.5 && !player.calm;
    if (player.calm) {
      this.moths.forEach(m => { m.g.visible = false; m.lit = 0; });
      LO.audio.setMothFlutter(0);
      return;
    }
    const BEAM_COS = Math.cos(BEAM_ANGLE);
    const BEAM_RANGE_SQ = BEAM_RANGE * BEAM_RANGE;
    const beamActive = player.flashOn && player.flash.intensity > 0.5 && !player.hidden;
    for (let idx = 0; idx < this.moths.length; idx++) {
      const m = this.moths[idx];
      if (idx >= activeLimit) { m.g.visible = false; continue; }
      m.g.visible = m.active && show;
      if (!m.active) {
        m.cooldown -= dt;
        if (m.cooldown <= 0) this.place(m);   // it settles somewhere else
        continue;
      }
      let inBeam = false;
      if (beamActive) {
        _chest.copy(m.g.position); _chest.y += 1.7;
        _to.copy(_chest).sub(camera.position);
        const d2 = _to.lengthSq();
        if (d2 < BEAM_RANGE_SQ && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          _to.multiplyScalar(1 / d);
          if (_to.dot(_fwd) > BEAM_COS) {
            this.raycaster.set(camera.position, _to);
            this.raycaster.far = d;
            const hits = this.raycaster.intersectObjects(W.occluders, false);
            inBeam = !hits.length || hits[0].distance > d - 0.6;
          }
        }
      }
      if (LO.admin && LO.admin.noMoths) inBeam = false;
      if (inBeam) m.lit += dt; else m.lit = Math.max(0, m.lit - dt * 0.7);
      const k = m.lit / stareLimit;
      if (k > this.maxLit) { this.maxLit = k; this.nearestLit = m; }

      if (!m.g.visible && m.lit <= 0) continue;

      // reacts to the light: turns its faceless head to you, wings start to quiver
      if (m.lit > 0.05) {
        const want = Math.atan2(camera.position.x - m.g.position.x, camera.position.z - m.g.position.z);
        let diff = want - m.g.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        m.g.rotation.y += diff * Math.min(1, dt * (1 + k * 6));
      }
      const quiver = k * k;
      for (let wi = 0; wi < m.wings.length; wi++) {
        const w = m.wings[wi];
        w.mesh.rotation.y = w.side * (0.5 + quiver * 0.9 + Math.sin(time * 40 + w.side) * quiver * 0.35);
      }
      m.head.rotation.z = quiver > 0.2 ? Math.sin(time * 23) * 0.25 * quiver : 0;

      if (m.lit >= stareLimit) this.shriek(m, player);
    }
    LO.audio.setMothFlutter(Math.min(1, this.maxLit));
  };

  Moths.prototype.shriek = function (m, player) {
    const V = LO.ver ? LO.ver() : { mothDamage: DAMAGE };
    const pos = m.g.position.clone(); pos.y = 2;
    LO.audio.mothShriek(pos);
    m.active = false; m.g.visible = false;
    m.cooldown = 50 + Math.random() * 30;
    this.onShriek && this.onShriek(pos);
    player.damage(V.mothDamage || DAMAGE, 'moth');
  };

  Moths.prototype.dispose = function () {
    this.scene.remove(this.root);
  };
})();
