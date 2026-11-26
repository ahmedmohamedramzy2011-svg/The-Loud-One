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
    this._frame = 0;
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
    const lowT = !!(LO.settings && LO.settings.textures === 'low');
    const c = document.createElement('canvas'); c.width = lowT ? 128 : 256; c.height = lowT ? 128 : 256;
    const g = c.getContext('2d');
    if (lowT) g.scale(0.5, 0.5);
    // base: dusty grey-brown, darker toward the body
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, hind ? '#6d6253' : '#5a5045'); gr.addColorStop(1, hind ? '#a8998a' : '#9a8b78');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    // mottled dust (quantized alpha buckets avoid repeated fillStyle strings)
    const dustN = lowT ? 650 : 2200;
    for (let i = 0; i < dustN; i++) {
      const v = (i & 1) ? 255 : 0;
      const a = (((i * 13) % 4) + 1) * 0.02;
      g.fillStyle = `rgba(${v},${v},${v},${a})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
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
    const lowT = !!(LO.settings && LO.settings.textures === 'low');
    const c = document.createElement('canvas'); c.width = c.height = lowT ? 64 : 128;
    const g = c.getContext('2d');
    if (lowT) g.scale(0.5, 0.5);
    g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, 128, 128);
    const hairN = lowT ? 450 : 1400;
    const shades = ['rgba(165,157,145,0.6)', 'rgba(190,182,170,0.6)', 'rgba(215,207,195,0.6)', 'rgba(232,224,212,0.6)'];
    for (let i = 0; i < hairN; i++) {
      g.strokeStyle = shades[i & 3]; g.lineWidth = 1;
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

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function mergePartEntries(entries) {
    const geos = [];
    let totalVerts = 0;
    for (let i = 0; i < entries.length; i++) {
      const it = entries[i];
      let g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
      if (it.mat4) g.applyMatrix4(it.mat4);
      else {
        _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
        _p.set(it.x || 0, it.y || 0, it.z || 0);
        _s.set(it.sx !== undefined ? it.sx : 1, it.sy !== undefined ? it.sy : 1, it.sz !== undefined ? it.sz : 1);
        g.applyMatrix4(_m4.compose(_p, _q, _s));
      }
      totalVerts += g.attributes.position.count;
      geos.push(g);
    }
    const pos = new Float32Array(totalVerts * 3);
    const nor = new Float32Array(totalVerts * 3);
    const uv = new Float32Array(totalVerts * 2);
    let offset = 0;
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i], cnt = g.attributes.position.count;
      pos.set(g.attributes.position.array, offset * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, offset * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
      offset += cnt;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    return merged;
  }

  Moths.prototype.kit = function () {
    if (this._kit) return this._kit;
    const lowQ = !!(LO.settings && LO.settings.quality === 'low');
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
    const thoraxG = lathe(0.75, [[0.05, 0], [0.2, 0.08], [0.24, 0.35], [0.2, 0.75], [0.12, 1]], lowQ ? 6 : 10);
    const abdomenG = lathe(0.55, [[0.12, 0], [0.16, 0.3], [0.13, 0.75], [0.05, 1]], lowQ ? 6 : 10);
    const thighG = lathe(0.76, [[0.072, 0], [0.064, 0.25], [0.052, 0.75], [0.042, 1]], lowQ ? 5 : 7);
    const shinG = lathe(0.74, [[0.044, 0], [0.038, 0.35], [0.028, 0.8], [0.024, 1]], lowQ ? 5 : 7);
    const kneeG = new THREE.SphereGeometry(0.046, lowQ ? 5 : 7, lowQ ? 4 : 6);
    const footG = new THREE.ConeGeometry(0.036, 0.14, lowQ ? 4 : 6);
    const armG = lathe(0.62, [[0.04, 0], [0.03, 0.9], [0.022, 1]], lowQ ? 4 : 6);
    const fingerG = lathe(0.2, [[0.012, 0], [0.004, 1]], 4);
    const headBaseG = new THREE.SphereGeometry(0.13, lowQ ? 8 : 12, lowQ ? 6 : 10);
    const eyeG = new THREE.SphereGeometry(0.075, lowQ ? 8 : 12, lowQ ? 6 : 10);
    const collarG = new THREE.ConeGeometry(0.03, 0.14, 4);
    const ringGs = [0, 1, 2].map(i => new THREE.TorusGeometry(0.135 - i * 0.012, 0.012, 4, lowQ ? 8 : 14));
    const antTubes = antCurves.map(c => new THREE.TubeGeometry(c, lowQ ? 6 : 10, 0.008, 4));
    const barbG = new THREE.CylinderGeometry(0.003, 0.003, 0.07, 3);

    // Bake static fur body parts (thorax, abdomen, 10 neck collar tufts) into 1 geometry
    const furParts = [
      { geo: thoraxG, x: 0, y: 2.15, z: 0, sx: 1, sy: 1, sz: 0.75 },
      { geo: abdomenG, x: 0, y: 1.42, z: -0.04, sx: 0.9, sy: 1, sz: 0.8 },
    ];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      furParts.push({ geo: collarG, x: Math.cos(a) * 0.17, y: 2.1, z: Math.sin(a) * 0.13, rx: Math.sin(a) * 1.2, ry: 0, rz: -Math.cos(a) * 1.2 });
    }
    const bodyFurGeo = mergePartEntries(furParts);

    // Bake static skin body parts (connected hip->knee->shin->foot chains, arms+fingers, abdomen rings) into 1 geometry
    const skinParts = [];
    const localM = new THREE.Matrix4(), childM = new THREE.Matrix4(), footM = new THREE.Matrix4();
    [-1, 1].forEach(sd => {
      localM.compose(new V3(sd * 0.105, 1.45, -0.01), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, 0, sd * 0.03)), new V3(1, 1, 1));
      skinParts.push({ geo: thighG, mat4: localM.clone() });
      childM.compose(new V3(0, -0.74, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.26, 0, -sd * 0.02)), new V3(1, 1, 1));
      const kneeM = localM.clone().multiply(childM);
      skinParts.push({ geo: kneeG, mat4: kneeM.clone() });
      skinParts.push({ geo: shinG, mat4: kneeM.clone() });
      footM.compose(new V3(0, -0.73, 0.04), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.12, 0, 0)), new V3(1, 1, 0.6));
      skinParts.push({ geo: footG, mat4: kneeM.clone().multiply(footM) });

      // Arms + elbows + 3 fingers per arm
      localM.compose(new V3(sd * 0.2, 2.05, 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sd * 0.12)), new V3(1, 1, 1));
      skinParts.push({ geo: armG, mat4: localM.clone() });
      childM.compose(new V3(0, -0.62, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0, 0)), new V3(1, 1, 1));
      const elM = localM.clone().multiply(childM);
      skinParts.push({ geo: armG, mat4: elM.clone() });
      for (let f = 0; f < 3; f++) {
        footM.compose(new V3((f - 1) * 0.025, -0.62, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, (f - 1) * 0.15)), new V3(1, 1, 1));
        skinParts.push({ geo: fingerG, mat4: elM.clone().multiply(footM) });
      }
    });
    for (let i = 0; i < 3; i++) {
      skinParts.push({ geo: ringGs[i], x: 0, y: 1.3 - i * 0.12, z: -0.04, rx: Math.PI / 2, ry: 0, rz: 0 });
    }
    const bodySkinGeo = mergePartEntries(skinParts);

    // Bake head fur, compound eyes, and feathery antennae into 3 geometries
    const headFurGeo = mergePartEntries([{ geo: headBaseG, x: 0, y: 0.05, z: 0, sx: 1, sy: 1.05, sz: 0.95 }]);
    const headEyeGeo = mergePartEntries([
      { geo: eyeG, x: -0.085, y: 0.07, z: 0.07, sx: 0.85, sy: 1.1, sz: 0.9 },
      { geo: eyeG, x: 0.085, y: 0.07, z: 0.07, sx: 0.85, sy: 1.1, sz: 0.9 },
    ]);
    const antParts = [];
    antCurves.forEach((c, idx) => {
      const sd = idx === 0 ? -1 : 1;
      antParts.push({ geo: antTubes[idx], x: 0, y: 0, z: 0 });
      for (let b = 1; b < 9; b++) {
        const pt = c.getPoint(b / 9);
        antParts.push({ geo: barbG, x: pt.x, y: pt.y + 0.02, z: pt.z, rx: 0.4, ry: 0, rz: sd * 0.6 });
      }
    });
    const headAntGeo = mergePartEntries(antParts);

    // Dispose raw source geometries now that merged kits exist
    [thoraxG, abdomenG, thighG, shinG, kneeG, footG, armG, fingerG, headBaseG, eyeG, collarG, barbG]
      .concat(ringGs, antTubes)
      .forEach(g => g.dispose());

    this._kit = {
      fur, skin, eye, fore, hind,
      bodyFurGeo, bodySkinGeo, headFurGeo, headEyeGeo, headAntGeo,
      foreG: wingGeo([[0, 0], [0.25, 0.32], [0.78, 0.5], [0.95, 0.25], [0.8, -0.1], [0.4, -0.28], [0.08, -0.12]]),
      hindG: wingGeo([[0, 0], [0.4, 0.05], [0.72, -0.15], [0.7, -0.5], [0.38, -0.62], [0.1, -0.35]]),
    };
    return this._kit;
  };

  Moths.prototype.makeMoth = function () {
    const K = this.kit();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(K.bodyFurGeo, K.fur));
    g.add(new THREE.Mesh(K.bodySkinGeo, K.skin));

    // the head: big, glossy, black compound eyes and feathery antennae
    const head = new THREE.Group(); head.position.y = 2.28; g.add(head);
    head.add(new THREE.Mesh(K.headFurGeo, K.fur));
    head.add(new THREE.Mesh(K.headEyeGeo, K.eye));
    head.add(new THREE.Mesh(K.headAntGeo, K.skin));

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

  const _fwd = new V3(), _to = new V3(), _chest = new V3(), _pFwd = new V3(), _pEye = new V3();
  Moths.prototype.update = function (dt, playerOrList, camera, time) {
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
    const isMulti = Array.isArray(playerOrList);
    const allPlayers = isMulti ? playerOrList : [playerOrList];
    const localPlayer = allPlayers[0];
    camera.getWorldDirection(_fwd);
    this.maxLit = 0;
    this.nearestLit = null;

    if (localPlayer && localPlayer.calm) {
      this.moths.forEach(m => { m.g.visible = false; m.lit = 0; });
      LO.audio.setMothFlutter(0);
      return;
    }
    const BEAM_COS = Math.cos(BEAM_ANGLE);
    const BEAM_RANGE_SQ = BEAM_RANGE * BEAM_RANGE;
    const MOTH_VIS_R2 = (LO.admin && LO.admin.fullbright) ? 1e9 : 60 * 60;
    this._frame = (this._frame + 1) | 0;
    const camP = camera.position;

    // Gather all active flashlights (local + remote players in co-op)
    const beams = [];
    for (let pi = 0; pi < allPlayers.length; pi++) {
      const p = allPlayers[pi];
      if (!p || !p.alive || p.calm || p.hidden || !p.flashOn) continue;
      if (pi === 0 && p.flash && p.flash.intensity <= 0.5) continue;
      if (pi === 0 && camera) {
        beams.push({ p, origin: camP, dir: _fwd.clone(), isLocal: true });
      } else {
        const cp = Math.cos(p.pitch || 0);
        const d = new V3(-Math.sin(p.yaw || 0) * cp, Math.sin(p.pitch || 0), -Math.cos(p.yaw || 0) * cp).normalize();
        const o = new V3(p.pos.x, (p.pos.y || 0) + 1.62 - (p.crouch || 0) * 0.67, p.pos.z);
        beams.push({ p, origin: o, dir: d, isLocal: false });
      }
    }

    for (let idx = 0; idx < this.moths.length; idx++) {
      const m = this.moths[idx];
      if (idx >= activeLimit) { m.g.visible = false; continue; }
      const mdx = m.g.position.x - camP.x, mdz = m.g.position.z - camP.z;
      const md2 = mdx * mdx + mdz * mdz;
      if (!m.active) {
        m.g.visible = false;
        m.cooldown -= dt;
        if (m.cooldown <= 0) this.place(m);   // it settles somewhere else
        continue;
      }

      let inBeam = false;
      let litBy = null;
      let anyLightNear = false;
      if (!(LO.admin && LO.admin.noMoths)) {
        _chest.copy(m.g.position); _chest.y += 1.7;
        for (let bi = 0; bi < beams.length; bi++) {
          const b = beams[bi];
          _to.copy(_chest).sub(b.origin);
          const d2 = _to.lengthSq();
          if (d2 >= BEAM_RANGE_SQ || d2 <= 1e-6) continue;
          const d = Math.sqrt(d2);
          _to.multiplyScalar(1 / d);
          if (_to.dot(b.dir) <= BEAM_COS) continue;
          if (d2 > 196 && m.lit === 0 && ((idx + this._frame) & 1) === 1) continue;
          if (W.segmentHitsTree && W.segmentHitsTree(b.origin.x, b.origin.z, _chest.x, _chest.z)) continue;
          this.raycaster.set(b.origin, _to);
          this.raycaster.far = d;
          const occl = W.queryOccluders ? W.queryOccluders(b.origin.x, b.origin.z, _chest.x, _chest.z) : W.occluders;
          const hits = this.raycaster.intersectObjects(occl, false);
          if (!hits.length || hits[0].distance > d - 0.6) {
            inBeam = true;
            litBy = b.p;
            anyLightNear = true;
            break;
          }
        }
      }

      const localShow = !!(localPlayer && localPlayer.flashOn && localPlayer.flash.intensity > 0.5 && !localPlayer.calm);
      m.g.visible = m.active && (localShow || anyLightNear) && md2 <= MOTH_VIS_R2;

      if (inBeam) m.lit += dt; else m.lit = Math.max(0, m.lit - dt * 0.7);
      const k = m.lit / stareLimit;
      if (k > this.maxLit) { this.maxLit = k; this.nearestLit = m; }

      if (!m.g.visible && m.lit <= 0) continue;

      // reacts to the light: turns its faceless head to whoever lit it, wings start to quiver
      if (m.lit > 0.05) {
        const lookAtPos = (litBy && litBy.pos) ? litBy.pos : camera.position;
        const want = Math.atan2(lookAtPos.x - m.g.position.x, lookAtPos.z - m.g.position.z);
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

      if (m.lit >= stareLimit) this.shriek(m, litBy || localPlayer, idx);
    }
    LO.audio.setMothFlutter(Math.min(1, this.maxLit));
  };

  Moths.prototype.shriek = function (m, player, idx) {
    const V = LO.ver ? LO.ver() : { mothDamage: DAMAGE };
    const pos = m.g.position.clone(); pos.y = 2;
    LO.audio.mothShriek(pos);
    m.active = false; m.g.visible = false;
    m.lit = 0;
    m.cooldown = 50 + Math.random() * 30;
    this.onShriek && this.onShriek(pos, player, idx);
    if (player && player.damage) player.damage(V.mothDamage || DAMAGE, 'moth');
  };

  Moths.prototype.getNetSync = function () {
    const out = [];
    for (let i = 0; i < this.moths.length; i++) {
      const m = this.moths[i];
      out.push(m.active ? [1, +m.g.position.x.toFixed(1), +m.g.position.z.toFixed(1), +m.g.rotation.y.toFixed(2), +m.lit.toFixed(2)] : [0]);
    }
    return out;
  };

  Moths.prototype.applyNetSync = function (arr, player, allBeams, camera, time) {
    const V = LO.ver ? LO.ver() : { moths: true, mothCount: COUNT, mothLimit: LIGHT_LIMIT };
    if (!V.moths || !arr) {
      this.root.visible = false;
      LO.audio.setMothFlutter(0);
      return;
    }
    this.root.visible = true;
    const stareLimit = V.mothLimit || LIGHT_LIMIT;
    const camP = camera.position;
    const MOTH_VIS_R2 = (LO.admin && LO.admin.fullbright) ? 1e9 : 60 * 60;
    const localShow = !!(player && player.flashOn && player.flash && player.flash.intensity > 0.5 && !player.calm);
    this.maxLit = 0;
    for (let i = 0; i < this.moths.length && i < arr.length; i++) {
      const m = this.moths[i], d = arr[i];
      if (!d || !d[0]) {
        m.active = false; m.g.visible = false; m.lit = 0;
        continue;
      }
      m.active = true;
      m.g.position.set(d[1], 0.12, d[2]);
      m.g.rotation.y = d[3];
      m.lit = d[4] || 0;
      const k = m.lit / stareLimit;
      if (k > this.maxLit) this.maxLit = k;
      const mdx = m.g.position.x - camP.x, mdz = m.g.position.z - camP.z;
      const md2 = mdx * mdx + mdz * mdz;
      let anyRemoteBeam = false;
      if (!localShow && allBeams && m.lit > 0.05) anyRemoteBeam = true;
      m.g.visible = (localShow || anyRemoteBeam) && md2 <= MOTH_VIS_R2;
      if (!m.g.visible) continue;
      const quiver = k * k;
      for (let wi = 0; wi < m.wings.length; wi++) {
        const w = m.wings[wi];
        w.mesh.rotation.y = w.side * (0.5 + quiver * 0.9 + Math.sin(time * 40 + w.side) * quiver * 0.35);
      }
      m.head.rotation.z = quiver > 0.2 ? Math.sin(time * 23) * 0.25 * quiver : 0;
    }
    LO.audio.setMothFlutter(Math.min(1, this.maxLit));
  };

  Moths.prototype.dispose = function () {
    this.scene.remove(this.root);
  };
})();
