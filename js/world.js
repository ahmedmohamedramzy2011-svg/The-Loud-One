// ============================================================
//  THE LOUD ONE — the abandoned town of Hollow Creek
// ============================================================
(function () {
  const BLOCK = 40, ST = 12, NB = 4;
  const HALF = (NB * BLOCK + (NB + 1) * ST) / 2;          // 110
  const STREETS = [];                                      // street centre lines
  for (let i = 0; i <= NB; i++) STREETS.push(-HALF + ST / 2 + i * (BLOCK + ST));
  const BLOCK_C = [];
  for (let i = 0; i < NB; i++) BLOCK_C.push(STREETS[i] + ST / 2 + BLOCK / 2);

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Box UVs in world units so textures tile at a constant scale
  function worldUV(geo, w, h, d, tile) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const tl = Array.isArray(tile) ? tile[f] : tile;
        uv.setXY(i, uv.getX(i) * dims[f][0] / tl, uv.getY(i) * dims[f][1] / tl);
      }
    }
    uv.needsUpdate = true;
    return geo;
  }

  LO.World = { STREETS, BLOCK_C, HALF, build };

  function build(scene) {
    const S = LO.settings;
    const rand = mulberry(1337);
    const R = (a, b) => a + rand() * (b - a);
    const pick = arr => arr[(rand() * arr.length) | 0];
    const shadows = S.shadows !== 'off';
    const simple = S.lighting === 'simple';

    const W = {
      root: new THREE.Group(),
      colliders: [], occluders: [], baseOccluders: [], hideSpots: [], pickups: [], evidence: [],
      interiors: [], flickers: [], animated: [], STREETS, HALF,
      enterables: [], closedFronts: [], openLots: [], fixedEvidence: [],
      evColliders: [], evOccluders: [], buildings: [], flyingDebris: [],
      debrisGroup: new THREE.Group(),
    };
    W.root.add(W.debrisGroup);
    scene.add(W.root);
    let curB = null;

    // ---------- materials ----------
    function mat(o) {
      o = Object.assign({}, o);
      if (simple) {
        delete o.roughness; delete o.metalness;
        return new THREE.MeshLambertMaterial(o);
      }
      if (o.roughness === undefined) o.roughness = 0.92;
      if (o.metalness === undefined) o.metalness = 0.0;
      return new THREE.MeshStandardMaterial(o);
    }
    const T = LO.tex.get;
    const M = {
      grass: mat({ map: T('grass'), color: 0x9aa58a }),
      road: mat({ map: T('road') }),
      asphalt: mat({ map: T('asphalt') }),
      sidewalk: mat({ map: T('sidewalk') }),
      facades: [
        mat({ map: T('facade', { wall: 'brick', color: '#6b3426' }) }),
        mat({ map: T('facade', { wall: 'brick', color: '#5a4a3a' }) }),
        mat({ map: T('facade', { wall: 'concrete', color: '#77746c' }) }),
        mat({ map: T('facade', { wall: 'concrete', color: '#6a6f73' }) }),
        mat({ map: T('facade', { wall: 'brick', color: '#3f3a44' }) }),
      ],
      walls: [
        mat({ map: T('brick', { color: '#6b3426' }) }),
        mat({ map: T('brick', { color: '#5a4a3a' }) }),
        mat({ map: T('concrete', { color: '#77746c' }) }),
        mat({ map: T('concrete', { color: '#6a6f73' }) }),
        mat({ map: T('brick', { color: '#3f3a44' }) }),
      ],
      brick: mat({ map: T('brick', { color: '#5e3024' }) }),
      concrete: mat({ map: T('concrete') }),
      plaster: [mat({ map: T('plaster', { color: '#8c8573' }) }), mat({ map: T('plaster', { color: '#6f7a72' }) }), mat({ map: T('plaster', { color: '#7d6d6a' }) })],
      wood: mat({ map: T('wood') }),
      tile: mat({ map: T('tile') }),
      roof: mat({ map: T('roof') }),
      metal: mat({ map: T('metal'), roughness: 0.6, metalness: 0.4 }),
      dumpster: mat({ map: T('metal', { color: '#2f4a33' }), roughness: 0.7, metalness: 0.3 }),
      locker: mat({ map: T('metal', { color: '#4b5560' }), roughness: 0.6, metalness: 0.4 }),
      dark: mat({ color: 0x151515 }),
      trim: mat({ color: 0x24211e }),
      pole: mat({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.5 }),
      iron: mat({ color: 0x222528, roughness: 0.68, metalness: 0.45 }),
      lampOff: mat({ color: 0x555544, emissive: 0x000000 }),
      lampOn: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      glass: mat({ color: 0x10161e, roughness: 0.22, metalness: 0.55 }),
      windowLit: new THREE.MeshLambertMaterial({ color: 0x4b381a, emissive: 0x1a1206 }),
      rubble: mat({ map: T('concrete', { color: '#5b574f' }) }),
      fabric: mat({ color: 0x40302a }),
      bark: mat({ color: 0x2a2018 }),
      leaves: mat({ color: 0x18251a }),
      tire: mat({ color: 0x111111 }),
      cctv: new THREE.MeshBasicMaterial({ map: T('cctv', { size: 256 }) }),
      warning: mat({ map: T('warning') }),
      poster: mat({ map: T('poster', { size: 128 }) }),
      sign: mat({ map: T('sign', { size: 512 }) }),
      water: mat({ map: T('metal', { color: '#5a6066' }), roughness: 0.5, metalness: 0.5 }),
      footprint: new THREE.MeshLambertMaterial({ map: T('footprint', { size: 256 }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    M.carPaints = [0x5b1d1a, 0x1f2f4a, 0x3d3d3a, 0x7b6a45, 0x2e3d2c, 0x8a8a86].map(c => mat({ color: c, roughness: 0.5, metalness: 0.3 }));
    W.mat = mat; W.M = M;

    // ---------- helpers ----------
    function addOccluder(mesh) {
      if (curB) curB.occluders.push(mesh);
      else W.baseOccluders.push(mesh);
    }
    function add(mesh, opts) {
      opts = opts || {};
      if (shadows) { mesh.castShadow = opts.cast !== false; mesh.receiveShadow = true; }
      (opts.parent || (curB ? curB.group : W.root)).add(mesh);
      if (opts.occlude) addOccluder(mesh);
      return mesh;
    }
    function collider(minX, maxX, minZ, maxZ, maxY, minY) {
      const c = { minX, maxX, minZ, maxZ, maxY: maxY === undefined ? 50 : maxY, minY: minY || 0, disabled: false };
      W.colliders.push(c);
      if (curB) curB.colliders.push(c);
      return c;
    }
    // axis aligned box from world extents
    function boxAt(x0, x1, y0, y1, z0, z1, material, opts) {
      opts = opts || {};
      const w = x1 - x0, h = y1 - y0, d = z1 - z0;
      const g = worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, opts.tile || 4);
      const m = new THREE.Mesh(g, material);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(m, opts);
      if (opts.collide !== false) collider(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), y1);
      return m;
    }
    // simple centred box
    function box(w, h, d, material, x, y, z, opts) {
      opts = opts || {};
      const g = worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, opts.tile || 2);
      const m = new THREE.Mesh(g, material);
      m.position.set(x, y, z);
      if (opts.ry) m.rotation.y = opts.ry;
      if (opts.rx) m.rotation.x = opts.rx;
      if (opts.rz) m.rotation.z = opts.rz;
      add(m, opts);
      if (opts.collide) {
        const c = Math.abs(Math.cos(opts.ry || 0)), s = Math.abs(Math.sin(opts.ry || 0));
        const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
        collider(x - hw, x + hw, z - hd, z + hd, y + h / 2);
      }
      return m;
    }
    W.box = box;

    // =========================================================
    //  GROUND, STREETS, SKY
    // =========================================================
    const groundGeo = new THREE.PlaneGeometry(1400, 1400);
    groundGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 140; });
    const ground = new THREE.Mesh(groundGeo, M.grass);
    ground.rotation.x = -Math.PI / 2;
    add(ground, { cast: false });

    const streetLen = HALF * 2;
    STREETS.forEach((s, i) => {
      // N-S street
      let g = new THREE.PlaneGeometry(ST, streetLen);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v * streetLen / ST : v; });
      let m = new THREE.Mesh(g, M.road); m.rotation.x = -Math.PI / 2; m.position.set(s, 0.02, 0);
      add(m, { cast: false });
      // E-W street
      g = new THREE.PlaneGeometry(streetLen, ST);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v : v * streetLen / ST; });
      const mat2 = M.road.clone(); mat2.map = M.road.map.clone(); mat2.map.needsUpdate = true;
      mat2.map.rotation = Math.PI / 2;
      m = new THREE.Mesh(g, mat2); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.025, s);
      add(m, { cast: false });
    });
    // intersections: plain asphalt patches to hide line overlap
    STREETS.forEach(x => STREETS.forEach(z => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ST, ST), M.asphalt);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); add(m, { cast: false });
    }));
    // road out of town to the south (opening drive)
    {
      const len = 520;
      const g = new THREE.PlaneGeometry(ST - 2, len);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v * len / ST : v; });
      const m = new THREE.Mesh(g, M.road); m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.02, -HALF - len / 2 + 1); add(m, { cast: false });
    }
    // sidewalks (block slabs)
    BLOCK_C.forEach(bx => BLOCK_C.forEach(bz => {
      boxAt(bx - BLOCK / 2, bx + BLOCK / 2, 0, 0.12, bz - BLOCK / 2, bz + BLOCK / 2, M.sidewalk, { collide: false, tile: 4, cast: false });
    }));

    // sky dome
    {
      const c = document.createElement('canvas'); c.width = 2; c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#010103'); gr.addColorStop(0.55, '#03050a'); gr.addColorStop(1, '#06080c');
      g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
      W.skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), W.skyMat);
      sky.renderOrder = -10; W.sky = sky;
      scene.add(sky);
      // stars
      const pts = [];
      for (let i = 0; i < 900; i++) {
        const th = rand() * Math.PI * 2, ph = Math.acos(R(0.08, 1));
        pts.push(Math.cos(th) * Math.sin(ph) * 850, Math.cos(ph) * 850, Math.sin(th) * Math.sin(ph) * 850);
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      W.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab4cc, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.45 }));
      scene.add(W.stars);
      // moon
      const moon = new THREE.Mesh(new THREE.SphereGeometry(22, 20, 14), new THREE.MeshBasicMaterial({ color: 0xd8dccc, fog: false }));
      moon.position.set(-300, 420, 560); scene.add(moon); W.moon = moon;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(190,200,220,0.35)'), fog: false, depthWrite: false, transparent: true }));
      halo.scale.set(200, 200, 1); halo.position.copy(moon.position); scene.add(halo); W.moonHalo = halo;
    }

    // ---------- lights ----------
    // very dark night: the flashlight and the broken street lamps are the real light sources
    W.baseLight = { hemi: simple ? 0.04 : 0.032, moon: simple ? 0.022 : 0.025 };
    W.hemi = new THREE.HemisphereLight(0x2a3650, 0x050507, W.baseLight.hemi);
    scene.add(W.hemi);
    W.moonLight = new THREE.DirectionalLight(0x8fa0c8, W.baseLight.moon);
    W.moonLight.position.set(-60, 120, 110);
    if (S.shadows === 'high') {
      W.moonLight.castShadow = true;
      W.moonLight.shadow.mapSize.set(2048, 2048);
      const cam = W.moonLight.shadow.camera;
      cam.left = -130; cam.right = 130; cam.top = 130; cam.bottom = -130; cam.near = 1; cam.far = 400;
      W.moonLight.shadow.bias = -0.0008;
    }
    scene.add(W.moonLight); scene.add(W.moonLight.target);

    function glowTex(col) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }
    W.glowTex = glowTex;

    // =========================================================
    //  PROPS
    // =========================================================
    // ---------- cars: a boxy 80s sedan (front = +z) ----------
    let KIT = null;
    function carKit() {
      if (KIT) return KIT;
      const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
      KIT = {
        body: B(1.9, 0.5, 4.4), hood: B(1.86, 0.1, 1.35), trunk: B(1.86, 0.1, 0.95), roof: B(1.56, 0.07, 1.62),
        pillar: B(0.09, 1, 0.09), wind: B(1.5, 1, 0.025), side: B(0.025, 0.42, 1.72),
        bumper: B(2.02, 0.16, 0.22), tail: B(0.58, 0.2, 0.04), tailRim: B(0.66, 0.26, 0.03), plate: B(0.5, 0.16, 0.03),
        grille: B(1.0, 0.2, 0.04), head: B(0.34, 0.17, 0.04), trim: B(0.02, 0.05, 3.6), mirror: B(0.14, 0.1, 0.08),
        greenhouse: (() => {
          const sh = new THREE.Shape();
          [[0.88, 0], [0.47, 0.55], [-1.1, 0.55], [-1.32, 0]].forEach(([zz, yy], i) => i ? sh.lineTo(zz, yy) : sh.moveTo(zz, yy));
          const g2 = new THREE.ExtrudeGeometry(sh, { depth: 1.54, bevelEnabled: false });
          g2.rotateY(-Math.PI / 2); g2.translate(0.77, 0, 0);
          return g2;
        })(),
        door: B(0.025, 0.4, 1.8), tire: new THREE.CylinderGeometry(0.36, 0.36, 0.24, 8), rim: new THREE.CylinderGeometry(0.21, 0.21, 0.26, 6),
        chrome: mat({ color: 0xa8a8a8, roughness: 0.35, metalness: 0.8 }),
        tailOn: new THREE.MeshBasicMaterial({ color: 0xd01212 }), tailOff: mat({ color: 0x6a0c0c, roughness: 0.4 }),
        tailRimMat: mat({ color: 0xd9b0b0, roughness: 0.5 }),
        plateMat: mat({ color: 0xe8e2d2, roughness: 0.7 }),
        headOn: new THREE.MeshBasicMaterial({ color: 0xfff2cc }), headOff: mat({ color: 0x4a4a40, roughness: 0.3 }),
        white: mat({ color: 0xdedede }),
      };
      return KIT;
    }
    // a thin box stretched between two points (pillars, glass)
    function strut(geo, material, a, b, parent) {
      const m = new THREE.Mesh(geo, material);
      const d = new THREE.Vector3().subVectors(b, a);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.scale.y = d.length();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      parent.add(m);
      return m;
    }
    function car(x, z, ry, opts) {
      opts = opts || {};
      const K = carKit(), V = THREE.Vector3;
      const g = new THREE.Group();
      const paint = opts.police ? mat({ color: 0x111111, roughness: 0.5, metalness: 0.3 }) : (opts.paint || pick(M.carPaints));
      const add = (geo, m, px, py, pz, parent) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); (parent || g).add(o); return o; };
      // lower body, hood and trunk
      const body = add(K.body, paint, 0, 0.58, 0);
      const hood = add(K.hood, paint, 0, 0.86, 1.52); hood.rotation.x = 0.05;
      add(K.trunk, paint, 0, 0.88, -1.72);
      // cabin: roof on pillars, with glass between them
      const cab = new THREE.Group(); cab.position.y = 0.83; g.add(cab);
      add(K.greenhouse, M.glass, 0, 0, 0, cab);                                  // the tinted glass cabin
      add(K.roof, paint, 0, 0.575, -0.32, cab);
      [-1, 1].forEach(sd => {
        strut(K.pillar, paint, new V(sd * 0.79, 0, 0.88), new V(sd * 0.79, 0.56, 0.47), cab);    // A
        strut(K.pillar, paint, new V(sd * 0.795, 0, -0.3), new V(sd * 0.795, 0.56, -0.3), cab); // B
        strut(K.pillar, paint, new V(sd * 0.79, 0, -1.32), new V(sd * 0.79, 0.56, -1.1), cab);  // C
        add(K.pillar, paint, sd * 0.79, 0.03, -0.22, cab).scale.set(1, 0.06, 23);               // window sill
        const mr = add(K.mirror, paint, sd * 1.0, 0.12, 0.72, cab); void mr;
      });
      // bumpers, lights, plate, grille, trim
      add(K.bumper, K.chrome, 0, 0.36, 2.24); add(K.bumper, K.chrome, 0, 0.36, -2.24);
      [-1, 1].forEach(sd => {
        add(K.tailRim, K.tailRimMat, sd * 0.6, 0.68, -2.205);
        add(K.tail, opts.headlightsOn ? K.tailOn : K.tailOff, sd * 0.6, 0.68, -2.215);
        add(K.head, opts.headlightsOn ? K.headOn : K.headOff, sd * 0.68, 0.66, 2.215);
        add(K.trim, K.chrome, sd * 0.955, 0.72, 0);
        if (opts.police) add(K.door, K.white, sd * 0.958, 0.6, -0.2);
      });
      add(K.plate, K.plateMat, 0, 0.6, -2.22);
      add(K.grille, M.dark, 0, 0.66, 2.215);
      // wheels with rims
      [[-0.86, 1.38], [0.86, 1.38], [-0.86, -1.38], [0.86, -1.38]].forEach(([wx, wz], i) => {
        const w = new THREE.Group(); w.position.set(wx * (opts.crushed ? 1.15 : 1), 0.36, wz); g.add(w);
        const t = new THREE.Mesh(K.tire, M.tire); t.rotation.z = Math.PI / 2; w.add(t);
        const r = new THREE.Mesh(K.rim, K.chrome); r.rotation.z = Math.PI / 2; w.add(r);
        if (opts.crushed && i % 2) w.rotation.z = 0.5;
      });
      if (opts.police) {
        const bar = new THREE.Group();
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: opts.lightsOn ? 0xff2020 : 0x501010 }));
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: opts.lightsOn ? 0x2050ff : 0x101850 }));
        red.position.x = -0.35; blue.position.x = 0.35; bar.add(red, blue);
        bar.position.set(0, 0.67, -0.3);
        cab.add(bar); g.userData.red = red; g.userData.blue = blue;
      }
      if (opts.crushed) {
        // something stepped on it
        cab.scale.y = 0.3; cab.rotation.z = 0.12;
        body.scale.y = 0.8; body.position.y = 0.5;
        hood.rotation.x = 0.25; hood.position.y = 0.92;
      }
      g.position.set(x, 0, z); g.rotation.y = ry || 0;
      if (opts.flipped) { g.rotation.z = Math.PI; g.position.y = 1.45; }
      g.traverse(o => { if (o.isMesh && shadows) { o.castShadow = true; o.receiveShadow = true; } });
      (opts.parent || (curB ? curB.group : W.root)).add(g);
      if (!opts.noCollide) {
        const c = Math.abs(Math.cos(ry || 0)), s2 = Math.abs(Math.sin(ry || 0));
        const hw = (2 * c + 4.5 * s2) / 2 + 0.1, hd = (2 * s2 + 4.5 * c) / 2 + 0.1;
        collider(x - hw, x + hw, z - hd, z + hd, 1.6);
        addOccluder(body);
      }
      return g;
    }
    W.car = car;

    function streetLamp(x, z, ry, state) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 7, 6, 1, true), M.pole);
      pole.position.y = 3.5; g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2), M.pole);
      arm.position.set(0, 6.9, 0.9); g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.7), state === 'off' ? M.lampOff : M.lampOn);
      head.position.set(0, 6.8, 1.8); g.add(head);
      g.position.set(x, 0, z); g.rotation.y = ry;
      if (state === 'bent') { g.rotation.z = 0.35; }
      add(g);
      collider(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 7);
      if (state === 'flicker' || state === 'on') {
        const wp = new THREE.Vector3(0, 6.6, 1.8).applyEuler(g.rotation).add(g.position);
        const light = new THREE.PointLight(0xffc98a, 0, 26, 1.6);
        light.position.copy(wp); W.root.add(light);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,210,150,0.6)'), depthWrite: false, transparent: true }));
        glow.scale.set(3, 3, 1); glow.position.copy(wp); W.root.add(glow);
        W.flickers.push({ light, head, glow, base: 1.4, mode: state, t: rand() * 10, on: true });
      }
    }

    // dumpster: a bin on wheels with a lid hinged at the back (opens when you climb in/out)
    function dumpster(x, z, ry) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.18, 1.3), M.dumpster); b.position.y = 0.79; g.add(b);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 1.38), M.dumpster); rim.position.y = 1.4; g.add(rim);
      // ribs and side bars
      [-0.75, 0, 0.75].forEach(rx => { const rb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.1, 0.04), M.dumpster); rb.position.set(rx, 0.8, 0.67); g.add(rb); });
      [-1, 1].forEach(sd => { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), M.pole); bar.position.set(sd * 1.16, 1.05, 0); g.add(bar); });
      // casters
      [[-0.95, -0.5], [0.95, -0.5], [-0.95, 0.5], [0.95, 0.5]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 6), M.tire); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.11, wz); g.add(w);
      });
      // the lid: hinged along the back edge
      const hinge = new THREE.Group(); hinge.position.set(0, 1.45, -0.66); g.add(hinge);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.06, 1.36), M.dark); lid.position.set(0, 0.03, 0.68); hinge.add(lid);
      const lidRidge = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.1), M.dark); lidRidge.position.set(0, 0.07, 1.25); hinge.add(lidRidge);
      hinge.rotation.x = -0.03;
      g.position.set(x, 0, z); g.rotation.y = ry; add(g);
      addOccluder(b);
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      collider(x - (2.2 * c + 1.3 * s) / 2, x + (2.2 * c + 1.3 * s) / 2, z - (2.2 * s + 1.3 * c) / 2, z + (2.2 * s + 1.3 * c) / 2, 1.45);
      const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const spot = {
        type: 'dumpster', mesh: g, disabled: false,
        pos: new THREE.Vector3(x, 1.05, z), yaw: ry,
        interact: new THREE.Vector3(x, 1, z).addScaledVector(front, 1.3),
        exit: new THREE.Vector3(x, 0, z).addScaledVector(front, 1.6),
        setOpen(a) { hinge.rotation.x = -0.03 - a * 1.5; },
      };
      W.hideSpots.push(spot);
      if (curB) curB.hideSpots.push(spot);
    }

    // locker: an open-fronted cabinet with a hinged, vented door
    function locker(x, z, ry) {
      const g = new THREE.Group();
      const W2 = 0.9, H2 = 2.0, D2 = 0.6, t = 0.03;
      const part = (w, h, d, px, py, pz, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || M.locker); o.position.set(px, py, pz); g.add(o); return o; };
      const back = part(W2, H2, t, 0, H2 / 2, -D2 / 2 + t / 2);
      part(t, H2, D2, -W2 / 2 + t / 2, H2 / 2, 0); part(t, H2, D2, W2 / 2 - t / 2, H2 / 2, 0);
      part(W2, t, D2, 0, H2 - t / 2, 0); part(W2, t, D2, 0, t / 2, 0);
      part(W2 - 2 * t, 0.02, D2 - 0.06, 0, H2 - 0.35, -0.02);                         // inner shelf
      part(W2 - 2 * t, H2 - 2 * t, 0.01, 0, H2 / 2, -D2 / 2 + t + 0.006, M.dark);     // dark inside
      // the door, hinged on the left edge
      const hinge = new THREE.Group(); hinge.position.set(-W2 / 2, 0, D2 / 2); g.add(hinge);
      const door = new THREE.Mesh(new THREE.BoxGeometry(W2, H2 - 0.02, 0.025), M.locker); door.position.set(W2 / 2, H2 / 2, 0); hinge.add(door);
      for (let i = 0; i < 4; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.02), M.dark);
        slot.position.set(W2 / 2, 1.55 + i * 0.08, 0.015); hinge.add(slot);
      }
      for (let i = 0; i < 2; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.02), M.dark);
        slot.position.set(W2 / 2, 0.25 + i * 0.08, 0.015); hinge.add(slot);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), M.pole); handle.position.set(W2 - 0.1, 1.05, 0.03); hinge.add(handle);
      g.position.set(x, 0.12, z); g.rotation.y = ry; add(g);
      addOccluder(back); addOccluder(door);
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      collider(x - (0.9 * c + 0.6 * s) / 2, x + (0.9 * c + 0.6 * s) / 2, z - (0.9 * s + 0.6 * c) / 2, z + (0.9 * s + 0.6 * c) / 2, 2.1);
      const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const spot = {
        type: 'locker', mesh: g, disabled: false,
        pos: new THREE.Vector3(x, 1.65, z), yaw: ry,
        interact: new THREE.Vector3(x, 1, z).addScaledVector(front, 0.9),
        exit: new THREE.Vector3(x, 0, z).addScaledVector(front, 1.1),
        setOpen(a) { hinge.rotation.y = -a * 1.85; },
      };
      W.hideSpots.push(spot);
      if (curB) curB.hideSpots.push(spot);
    }

    const batteryMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    function battery(x, y, z) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 6), mat({ color: 0x222222 }));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.08, 6), batteryMat);
      cap.position.y = 0.09; g.add(body, cap);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,120,0.45)'), depthWrite: false, transparent: true }));
      glow.scale.set(0.9, 0.9, 1); g.add(glow);
      g.position.set(x, y, z); W.root.add(g);
      W.pickups.push({ type: 'battery', mesh: g, pos: g.position, baseY: y, taken: false });
    }

    // shared low-poly tree geometries for weak devices
    const treeTrunkGeo = new THREE.CylinderGeometry(0.14, 0.28, 5, 4, 1, true);
    treeTrunkGeo.translate(0, 2.5, 0);
    const treeCanopyGeo = new THREE.ConeGeometry(2.2, 6, 4);
    treeCanopyGeo.translate(0, 6.0, 0);
    const deadBranchGeo = new THREE.BoxGeometry(0.1, 2.0, 0.1);
    deadBranchGeo.translate(0, 1.0, 0);

    function tree(x, z, s, dead) {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(treeTrunkGeo, M.bark);
      trunk.scale.set(s, s, s);
      g.add(trunk);
      if (!dead) {
        const top = new THREE.Mesh(treeCanopyGeo, M.leaves);
        top.scale.set(s, s, s);
        top.rotation.y = R(0, Math.PI);
        g.add(top);
      } else {
        for (let i = 0; i < 3; i++) {
          const br = new THREE.Mesh(deadBranchGeo, M.bark);
          const a = i * 2.1 + R(-0.3, 0.3);
          br.scale.set(s, s * R(0.75, 1.05), s);
          br.position.set(0, (3.1 + i * 0.45) * s, 0);
          br.rotation.y = a;
          br.rotation.z = (i % 2 ? 1 : -1) * R(0.55, 0.9);
          g.add(br);
        }
      }
      g.position.set(x, 0, z); add(g);
      collider(x - 0.3 * s, x + 0.3 * s, z - 0.3 * s, z + 0.3 * s, 5);
    }

    function rubblePile(x, z, r, n, parent) {
      for (let i = 0; i < n; i++) {
        const s = R(0.4, 1.45);
        const h = s * R(0.35, 0.85);
        const m = box(s * R(0.8, 1.9), h, s * R(0.8, 1.5), rand() < 0.6 ? M.rubble : M.brick,
          x + R(-r, r), h * 0.42, z + R(-r, r), { ry: R(0, 3), rx: R(-0.14, 0.14), rz: R(-0.14, 0.14), parent });
        m.userData.rubble = true;
      }
    }

    // =========================================================
    //  BUILDINGS
    // =========================================================
    // local frame helper: building centre c, forward axis f ('x'|'z') and sign
    function frame(cx, cz, axis, sign, L, D) {
      // lateral axis is the other one
      return {
        cx, cz, axis, sign, L, D,
        // local rect (a0..a1 lateral, b0..b1 depth (+ toward front)) -> world extents
        rect(a0, a1, b0, b1) {
          if (axis === 'z') {
            const z0 = cz + sign * b0, z1 = cz + sign * b1;
            return [cx + a0, cx + a1, Math.min(z0, z1), Math.max(z0, z1)];
          }
          const x0 = cx + sign * b0, x1 = cx + sign * b1;
          return [Math.min(x0, x1), Math.max(x0, x1), cz + a0, cz + a1];
        },
        point(a, b) {
          return axis === 'z' ? new THREE.Vector3(cx + a, 0, cz + sign * b) : new THREE.Vector3(cx + sign * b, 0, cz + a);
        },
        // yaw that faces toward +b (front)
        yawFront() { return axis === 'z' ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? Math.PI / 2 : -Math.PI / 2); },
        yawBack() { return this.yawFront() + Math.PI; },
        yawLeft() { return this.yawFront() + Math.PI / 2 * (axis === 'z' ? sign : -sign); },
      };
    }
    // wall box with different materials on its outer/inner faces
    function wall(F, a0, a1, b0, b1, y0, y1, outer, inner, outward) {
      // outward: 'front' | 'back' | 'left' | 'right' (which local direction faces outside)
      const [x0, x1, z0, z1] = F.rect(a0, a1, b0, b1);
      // compute which world face index is outward
      let dir;
      if (outward === 'front' || outward === 'back') {
        const s = (outward === 'front' ? 1 : -1) * F.sign;
        dir = F.axis === 'z' ? (s > 0 ? 4 : 5) : (s > 0 ? 0 : 1);
      } else {
        const s = outward === 'right' ? 1 : -1;  // +a direction
        dir = F.axis === 'z' ? (s > 0 ? 0 : 1) : (s > 0 ? 4 : 5);
      }
      const opp = dir % 2 === 0 ? dir + 1 : dir - 1;
      const mats = [M.trim, M.trim, M.trim, M.trim, M.trim, M.trim];
      mats[dir] = outer; mats[opp] = inner;
      const w = x1 - x0, h = y1 - y0, d = z1 - z0;
      // facades tile every 12m (4 windows per tile), everything else every 4m
      const tiles = [4, 4, 4, 4, 4, 4];
      if (M.facades.includes(outer)) tiles[dir] = 12;
      const g = worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, tiles);
      const m = new THREE.Mesh(g, mats);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(m, { occlude: true });
      collider(x0, x1, z0, z1, y1, y0);
      return m;
    }

    function buildEnterable(cx, cz, L, D, H, axis, sign, kind, opts) {
      const F = frame(cx, cz, axis, sign, L, D);
      const t = 0.35, ceil = 3.6, doorW = 2.2, doorH = 2.8;
      const facade = pick(M.walls);
      const inner = pick(M.plaster);
      const floorMat = kind === 'shop' || kind === 'police' ? M.tile : M.wood;
      const hl = L / 2, hd = D / 2;
      const [fx0, fx1, fz0, fz1] = F.rect(-hl, hl, -hd, hd);
      const b = {
        id: W.buildings.length, type: 'enter', sheriff: !!(opts && opts.sheriff),
        cx, cz, minX: fx0, maxX: fx1, minZ: fz0, maxZ: fz1, L, D, H,
        group: new THREE.Group(), deco: new Map(), colliders: [], occluders: [], hideSpots: [],
        interior: null, debrisGroup: null, debrisColliders: [], debrisOccluders: [],
        smashed: false, hasEvidence: !!(opts && opts.sheriff),
      };
      W.root.add(b.group);
      W.buildings.push(b);
      curB = b;

      // front wall with door
      wall(F, -hl, -doorW / 2, hd - t, hd, 0, H, facade, inner, 'front');
      wall(F, doorW / 2, hl, hd - t, hd, 0, H, facade, inner, 'front');
      wall(F, -doorW / 2, doorW / 2, hd - t, hd, doorH, H, facade, inner, 'front');
      // back
      wall(F, -hl, hl, -hd, -hd + t, 0, H, facade, inner, 'back');
      // sides
      wall(F, -hl, -hl + t, -hd + t, hd - t, 0, H, facade, inner, 'left');
      wall(F, hl - t, hl, -hd + t, hd - t, 0, H, facade, inner, 'right');
      // partition with a gap
      const pb = R(-1, 1.5), gapA = R(-1.5, 1.5), gw = 1.6;
      wall(F, -hl + t, gapA - gw / 2, pb - 0.1, pb + 0.1, 0, ceil, inner, inner, 'front');
      wall(F, gapA + gw / 2, hl - t, pb - 0.1, pb + 0.1, 0, ceil, inner, inner, 'front');
      wall(F, gapA - gw / 2, gapA + gw / 2, pb - 0.1, pb + 0.1, 2.5, ceil, inner, inner, 'front');
      // floor, ceiling, roof
      boxAt(fx0 + t, fx1 - t, 0, 0.14, fz0 + t, fz1 - t, floorMat, { collide: false, tile: 3, cast: false });
      boxAt(fx0, fx1, ceil, ceil + 0.15, fz0, fz1, inner, { collide: false, tile: 4 });
      boxAt(fx0 - 0.3, fx1 + 0.3, H, H + 0.4, fz0 - 0.3, fz1 + 0.3, M.roof, { collide: false, tile: 6 });
      // dark door frame
      const dp = F.point(0, hd + 0.02);
      const frameMesh = box(axis === 'z' ? doorW + 0.3 : 0.1, 0.2, axis === 'z' ? 0.1 : doorW + 0.3, M.trim, dp.x, doorH + 0.1, dp.z);
      void frameMesh;

      const intr = { minX: fx0, maxX: fx1, minZ: fz0, maxZ: fz1, ceil, disabled: false };
      W.interiors.push(intr);
      b.interior = intr;

      // furniture along the side walls (keeping the centre path clear)
      const placeAlong = (b0, b1, side) => {
        let b = b0 + 0.5;
        while (b < b1 - 1.2) {
          const len = R(1.3, 2.3);
          if (b + len > b1 - 0.5) break;
          const roll = rand();
          const a = side * (hl - t);
          const p = F.point(a, b + len / 2);
          const into = axis === 'z' ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          let item;
          if (kind === 'shop') item = roll < 0.75 ? 'shopShelf' : 'counter';
          else if (kind === 'house') item = roll < 0.25 ? 'couch' : roll < 0.45 ? 'bed' : roll < 0.65 ? 'bookshelf' : roll < 0.85 ? 'dresser' : 'desk';
          else item = roll < 0.45 ? 'desk' : roll < 0.75 ? 'bookshelf' : 'dresser';
          furniture(item, p.x, p.z, into, len, kind);
          b += len + R(0.3, 1.0);
        }
      };
      placeAlong(pb + 0.3, hd - t - 1.2, -1);
      placeAlong(pb + 0.3, hd - t - 1.2, 1);
      placeAlong(-hd + t, pb - 0.3, -1);
      placeAlong(-hd + t, pb - 0.3, 1);
      // shop aisles: double-sided shelving units
      if (kind === 'shop' && L > 12) {
        [-2.4, 2.4].forEach(a => {
          const p = F.point(a + gapA * 0.2, (pb + hd) / 2 + 0.3);
          furniture('aisle', p.x, p.z, axis === 'z' ? 0 : Math.PI / 2, 2.6, kind);
        });
      }
      // a rug, a ceiling light per room, and pictures on the walls
      {
        const rp = F.point(gapA * 0.3, (pb + hd) / 2);
        decoBox(pick(RUGS), axis === 'z' ? 2.6 : 3.4, 0.02, axis === 'z' ? 3.4 : 2.6, rp.x, 0.15, rp.z);
        [(pb + hd) / 2, (pb - hd) / 2].forEach(bb => {
          const lp = F.point(0, bb);
          decoCyl(M.pole, 0.02, 0.02, 0.5, lp.x, ceil - 0.25, lp.z, 6);
          decoCyl(M.lampOff, 0.32, 0.18, 0.18, lp.x, ceil - 0.55, lp.z, 12);
        });
        for (let i = 0; i < 2; i++) {
          const sd = rand() < 0.5 ? -1 : 1, bb = R(-hd + 2, hd - 2.5);
          const pp = F.point(sd * (hl - t - 0.03), bb);
          const yaw = F.yawLeft() + (sd > 0 ? Math.PI : 0);
          decoBox(M.wood, 0.75, 0.6, 0.04, pp.x, 1.75, pp.z, 0, yaw, 0);
          decoBox(pick(PAINTINGS), 0.62, 0.47, 0.05, pp.x, 1.75, pp.z, 0, yaw, 0);
        }
      }
      // a locker against the back wall (hiding spot)
      {
        const a = R(-hl + 1.5, hl - 1.5);
        const p = F.point(a, -hd + t + 0.35);
        locker(p.x, p.z, F.yawFront());
      }
      // scattered papers / debris
      for (let i = 0; i < 6; i++) {
        const p = F.point(R(-hl + 1, hl - 1), R(-hd + 1, hd - 1));
        box(R(0.2, 0.5), 0.01, R(0.2, 0.4), rand() < 0.5 ? M.poster : M.plaster[0], p.x, 0.15, p.z, { ry: R(0, 3) });
      }
      // missing poster near the door
      {
        const p = F.point(hl - t - 0.02 - 0.0, hd - 2.5);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), M.poster);
        pm.position.set(p.x, 1.6, p.z);
        pm.rotation.y = F.yawLeft() + Math.PI;
        add(pm, { cast: false });
      }
      if (rand() < 0.5) {
        const p = F.point(R(-hl + 2, hl - 2), R(-hd + 1.5, pb - 1));
        battery(p.x, 0.5, p.z);
      }

      const info = { F, hl, hd, t, pb, gapA, axis, sign, kind, sheriff: !!(opts && opts.sheriff), cx, cz, building: b };
      W.enterables.push(info);
      decorate(fx0, fx1, fz0, fz1, H, F, { doorGap: true, doorA: 0, awning: kind === 'shop' || kind === 'office', awningMat: kind === 'shop' ? mat({ color: 0x5a1f1a }) : mat({ color: 0x1f3a5a }) });

      if (info.sheriff) {
        // SHERIFF sign above the door
        const c = document.createElement('canvas'); c.width = 512; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#1a2233'; g.fillRect(0, 0, 512, 128);
        g.strokeStyle = '#c9a227'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116);
        g.fillStyle = '#e8d9a0'; g.font = 'bold 76px Arial'; g.textAlign = 'center'; g.fillText('SHERIFF', 256, 92);
        const sm = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
        const sp = F.point(0, hd + 0.16);          // in front of the floor band
        sm.position.set(sp.x, doorH + 1.35, sp.z); sm.rotation.y = F.yawFront();
        add(sm, { cast: false });
        // evidence room: a desk with an old TV and the tape
        const da = gapA > 0 ? -hl + t + 2.0 : hl - t - 2.0;
        const dp = F.point(da, -hd + t + 0.7);
        box(axis === 'z' ? 2.6 : 1.1, 0.9, axis === 'z' ? 1.1 : 2.6, M.wood, dp.x, 0.45, dp.z, { collide: true });
        const tv = new THREE.Group();
        tv.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), mat({ color: 0x1e1e1c })));
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ color: 0x0c1410 }));
        scr.position.z = 0.31; tv.add(scr);
        tv.position.set(dp.x, 1.2, dp.z); tv.rotation.y = F.yawFront();
        add(tv);
        const tp = F.point(da + (gapA > 0 ? 0.7 : -0.7), -hd + t + 0.9);
        const tape = new THREE.Group();
        const shell = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.025, 0.1), mat({ color: 0x111111 }));
        const lc = document.createElement('canvas'); lc.width = 128; lc.height = 64;
        const lg = lc.getContext('2d'); lg.fillStyle = '#eee8d0'; lg.fillRect(0, 0, 128, 64);
        lg.fillStyle = '#b11'; lg.font = 'bold 15px Courier'; lg.fillText('OCT 23', 8, 24); lg.fillText('DO NOT ERASE', 8, 48);
        const label = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.07), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc) }));
        label.rotation.x = -Math.PI / 2; label.position.y = 0.014;
        tape.add(shell, label);
        tape.position.set(tp.x, 0.915, tp.z); tape.rotation.y = F.yawFront();
        add(tape);
        W.fixedEvidence.push({ id: 'tape', name: 'Sheriff\'s security tape', pos: new THREE.Vector3(tp.x, 0.95, tp.z), maxDist: 4, found: false, margin: 0.6 });
      }
      flushDeco(b.deco, b.group);
      curB = null;
    }

    function buildClosed(cx, cz, L, D, H, axis, sign) {
      const F = frame(cx, cz, axis, sign, L, D);
      const facade = pick(M.walls);
      const [x0, x1, z0, z1] = F.rect(-L / 2, L / 2, -D / 2, D / 2);
      const w = x1 - x0, d = z1 - z0;
      const b = {
        id: W.buildings.length, type: 'closed', sheriff: false,
        cx, cz, minX: x0, maxX: x1, minZ: z0, maxZ: z1, L, D, H,
        group: new THREE.Group(), deco: new Map(), colliders: [], occluders: [], hideSpots: [],
        interior: null, debrisGroup: null, debrisColliders: [], debrisOccluders: [],
        smashed: false, hasEvidence: false,
      };
      W.root.add(b.group);
      W.buildings.push(b);
      curB = b;

      const g = new THREE.BoxGeometry(w, H, d);
      // brick/concrete walls on sides, roof on top
      worldUV(g, w, H, d, 4);
      const m = new THREE.Mesh(g, [facade, facade, M.roof, M.roof, facade, facade]);
      m.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      add(m, { occlude: true });
      collider(x0, x1, z0, z1, H);
      // boarded door flush on the front face
      const doorA = R(-L / 4, L / 4);
      const dp = F.point(doorA, D / 2 + 0.05);
      const bp = F.point(doorA, D / 2 + 0.11);
      W.closedFronts.push({ F, L, D, H, doorA, axis, building: b });
      decorate(x0, x1, z0, z1, H, F, { awning: rand() < 0.25, doorA, awningMat: pick([mat({ color: 0x5a1f1a }), mat({ color: 0x2c4a2a }), mat({ color: 0x4a3f1f })]) });
      const door = box(axis === 'z' ? 1.6 : 0.1, 2.6, axis === 'z' ? 0.1 : 1.6, M.wood, dp.x, 1.3, dp.z);
      for (let i = 0; i < 3; i++) {
        box(axis === 'z' ? 1.85 : 0.08, 0.2, axis === 'z' ? 0.08 : 1.85, M.wood, bp.x, 0.68 + i * 0.78, bp.z, { rz: axis === 'z' ? R(-0.1, 0.1) : 0, rx: axis === 'x' ? R(-0.1, 0.1) : 0 });
      }
      void door;
      // rooftop details
      if (rand() < 0.6) box(2, 1.4, 2, M.metal, m.position.x + R(-w / 4, w / 4), H + 0.7, m.position.z + R(-d / 4, d / 4));
      flushDeco(b.deco, b.group);
      curB = null;
      return { F, mesh: m, x0, x1, z0, z1, building: b };
    }

    function buildRuin(cx, cz, L, D) {
      // the remains of a building that was stomped flat
      boxAt(cx - L / 2, cx + L / 2, 0, 0.3, cz - D / 2, cz + D / 2, M.concrete, { collide: false, tile: 4 });
      const segs = [
        [cx - L / 2, cx - L / 2 + 0.4, cz - D / 2, cz + R(-2, D / 2)],
        [cx - L / 2, cx + R(-2, L / 3), cz - D / 2, cz - D / 2 + 0.4],
        [cx + L / 2 - 0.4, cx + L / 2, cz + R(-D / 2, 0), cz + D / 2],
      ];
      segs.forEach(([x0, x1, z0, z1]) => {
        // jagged: several pieces of differing height
        const along = (x1 - x0) > (z1 - z0) ? 'x' : 'z';
        const len = along === 'x' ? x1 - x0 : z1 - z0;
        const n = Math.max(1, Math.round(len / 2));
        for (let i = 0; i < n; i++) {
          const h = R(0.6, 4.2);
          if (along === 'x') boxAt(x0 + i * len / n, x0 + (i + 1) * len / n, 0, h, z0, z1, M.brick, { occlude: true, tile: 4 });
          else boxAt(x0, x1, 0, h, z0 + i * len / n, z0 + (i + 1) * len / n, M.brick, { occlude: true, tile: 4 });
        }
      });
      rubblePile(cx, cz, Math.min(L, D) / 2.5, 12);
      // grounded fallen beams resting on the concrete slab (no floating planks)
      for (let i = 0; i < 3; i++) box(0.3, 0.28, R(4, 6.5), M.wood, cx + R(-3.5, 3.5), 0.44, cz + R(-3.5, 3.5), { ry: R(0, 3), collide: false });
    }

    function buildLot(cx, cz, kind) {
      if (kind === 'parking') {
        boxAt(cx - 8, cx + 8, 0, 0.13, cz - 8, cz + 8, M.asphalt, { collide: false, tile: 6, cast: false });
        for (let i = 0; i < 2; i++) car(cx + R(-4, 4), cz + R(-4, 4), R(0, 6.28), { flipped: rand() < 0.2 });
      } else if (kind === 'park') {
        for (let i = 0; i < 4; i++) tree(cx + R(-6, 6), cz + R(-6, 6), R(0.8, 1.3), rand() < 0.7);
        // grounded park bench with legs and backrest
        const bx = cx + R(-3, 3), bz = cz + R(-3, 3), bry = R(0, 3);
        const bg = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.56), M.wood); seat.position.y = 0.48; bg.add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.36, 0.08), M.wood); back.position.set(0, 0.76, -0.24); bg.add(back);
        [-0.78, 0.78].forEach(lx => {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.5), M.pole);
          leg.position.set(lx, 0.23, 0); bg.add(leg);
        });
        bg.position.set(bx, 0, bz); bg.rotation.y = bry;
        if (shadows) bg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        add(bg);
        const c = Math.abs(Math.cos(bry)), s = Math.abs(Math.sin(bry));
        const hw = (2.0 * c + 0.6 * s) / 2, hd = (2.0 * s + 0.6 * c) / 2;
        collider(bx - hw, bx + hw, bz - hd, bz + hd, 0.95);
      }
    }

    // =========================================================
    //  BUILDING DETAIL — batched into a few merged meshes (cheap to draw)
    // =========================================================
    const DECO = new Map();   // material -> list of transformed geometries
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    function decoMap() { return curB ? curB.deco : DECO; }
    function decoBox(material, w, h, d, x, y, z, rx, ry, rz) {
      const g = new THREE.BoxGeometry(w, h, d);
      _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
      g.applyMatrix4(_m4.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
      const map = decoMap();
      if (!map.has(material)) map.set(material, []);
      map.get(material).push(g.index ? g.toNonIndexed() : g);
    }
    const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
    function decoStrut(material, x0, y0, z0, x1, y1, z1, w, d) {
      _dir.set(x1 - x0, y1 - y0, z1 - z0);
      const len = _dir.length();
      if (len < 1e-4) return;
      _dir.divideScalar(len);
      const g = new THREE.BoxGeometry(w, len, d);
      _q.setFromUnitVectors(_up, _dir);
      g.applyMatrix4(_m4.compose(_p.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5), _q, _s.set(1, 1, 1)));
      const map = decoMap();
      if (!map.has(material)) map.set(material, []);
      map.get(material).push(g.index ? g.toNonIndexed() : g);
    }
    function decoCyl(material, rt, rb, h, x, y, z, seg) {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg || 8);
      g.applyMatrix4(_m4.makeTranslation(x, y, z));
      const map = decoMap();
      if (!map.has(material)) map.set(material, []);
      map.get(material).push(g.toNonIndexed());
    }
    function flushDeco(map, target) {
      map = map || DECO;
      target = target || W.root;
      map.forEach((list, material) => {
        let n = 0; list.forEach(g => n += g.attributes.position.count);
        if (!n) return;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        let o = 0;
        list.forEach(g => {
          pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
          if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
          o += g.attributes.position.count; g.dispose();
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        if (shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
        target.add(mesh);
      });
      map.clear();
    }
    // parapet, cornice, plinth, 3D windows, detailed fire escape, rooftop clutter, awning
    function decorate(x0, x1, z0, z1, H, F, opts) {
      opts = opts || {};
      const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const P = 0.22, ph = 0.7;
      decoBox(M.rubble, w + 0.3, ph, P, cx, H + ph / 2, z0 + P / 2 - 0.15);
      decoBox(M.rubble, w + 0.3, ph, P, cx, H + ph / 2, z1 - P / 2 + 0.15);
      decoBox(M.rubble, P, ph, d, x0 + P / 2 - 0.15, H + ph / 2, cz);
      decoBox(M.rubble, P, ph, d, x1 - P / 2 + 0.15, H + ph / 2, cz);
      // bands are thin strips on the OUTSIDE of the walls only (never solid slabs through the building)
      const ring = (y, h, p, doorGap) => {
        const front = F ? (F.axis === 'z' ? (F.sign > 0 ? 'z1' : 'z0') : (F.sign > 0 ? 'x1' : 'x0')) : null;
        const da = opts.doorA || 0, gap = 1.35;
        const strip = (face, lo, hi) => {     // lo/hi: lateral range along that face
          if (hi - lo < 0.05) return;
          const mid = (lo + hi) / 2, len = hi - lo;
          if (face === 'z0' || face === 'z1') decoBox(M.trim, len, h, p, mid, y, face === 'z0' ? z0 - p / 2 : z1 + p / 2);
          else decoBox(M.trim, p, h, len, face === 'x0' ? x0 - p / 2 : x1 + p / 2, y, mid);
        };
        ['z0', 'z1', 'x0', 'x1'].forEach(face => {
          const along = face[0] === 'z';
          const lo = along ? x0 - p : z0, hi = along ? x1 + p : z1;
          if (doorGap && face === front) {
            const c = (along ? cx : cz) + da;           // door centre along this face (lateral a maps onto it)
            strip(face, lo, c - gap); strip(face, c + gap, hi);
          } else strip(face, lo, hi);
        });
      };
      ring(H - 0.25, 0.22, 0.26, false);                                   // cornice
      ring(0.275, 0.55, 0.07, !!opts.doorGap);                             // plinth (gap at the door)

      // ---- 3D architectural windows on all 4 facades (batched into building deco) ----
      const floorStep = 3.2;
      const floorYs = [1.05];
      for (let fy = 3.85; fy + 2.35 < H - 0.55; fy += floorStep) floorYs.push(fy);
      const drawWin = (wx, wy, wz, alongZ, dirSign, wh) => {
        const ww = 1.24, jambW = 0.10, innerW = ww - jambW * 2;
        const sx = alongZ ? 1 : 0, sz = alongZ ? 0 : 1; // along-wall tangent
        const nx = alongZ ? 0 : dirSign, nz = alongZ ? dirSign : 0; // outward wall normal
        const yc = wy + wh * 0.5;
        const lit = rand() < 0.035;
        // recessed dark pane (cleanly offset off wall at +0.02m)
        decoBox(lit ? M.windowLit : M.glass, alongZ ? innerW : 0.02, wh, alongZ ? 0.02 : innerW, wx + nx * 0.02, yc, wz + nz * 0.02);
        // 2x2 cross mullions in front of pane (+0.05m)
        decoBox(M.trim, alongZ ? 0.055 : 0.03, wh, alongZ ? 0.03 : 0.055, wx + nx * 0.05, yc, wz + nz * 0.05);
        decoBox(M.trim, alongZ ? innerW : 0.03, 0.055, alongZ ? 0.03 : innerW, wx + nx * 0.05, yc, wz + nz * 0.05);
        // deep side jambs (+0.045m center -> +0.09m front, creating real physical frame recess)
        [-1, 1].forEach(sd => {
          const off = sd * (ww * 0.5 - jambW * 0.5);
          decoBox(M.trim, alongZ ? jambW : 0.09, wh, alongZ ? 0.09 : jambW, wx + sx * off + nx * 0.045, yc, wz + sz * off + nz * 0.045);
        });
        // top stone header lintel & projecting lower sill
        decoBox(M.rubble, alongZ ? ww + 0.24 : 0.11, 0.16, alongZ ? 0.11 : ww + 0.24, wx + nx * 0.055, wy + wh + 0.08, wz + nz * 0.055);
        decoBox(M.rubble, alongZ ? ww + 0.28 : 0.14, 0.11, alongZ ? 0.14 : ww + 0.28, wx + nx * 0.07, wy - 0.055, wz + nz * 0.07);
        // occasional boarded-up wooden planks across the window
        if (rand() < 0.16) {
          for (let b = 0; b < 2; b++) {
            const by = wy + wh * (0.28 + b * 0.44);
            const tilt = (rand() - 0.5) * 0.14;
            decoBox(M.wood, alongZ ? ww + 0.16 : 0.04, 0.14, alongZ ? 0.04 : ww + 0.16,
              wx + nx * 0.095, by, wz + nz * 0.095, alongZ ? 0 : tilt, 0, alongZ ? tilt : 0);
          }
        }
      };

      const makeCols = len => {
        const usable = len - 3.0;
        const count = Math.max(2, Math.round(usable / 3.2));
        const span = Math.max(2.6, len - 3.6);
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(count === 1 ? 0 : -span * 0.5 + (i / (count - 1)) * span);
        return arr;
      };
      const colsW = makeCols(w), colsD = makeCols(d);
      const frontFace = F ? (F.axis === 'z' ? (F.sign > 0 ? 'z1' : 'z0') : (F.sign > 0 ? 'x1' : 'x0')) : null;
      const doorCenter = opts.doorA || 0;
      const wallFaces = [
        { key: 'z1', alongZ: true, dirSign: 1, fixed: z1, mid: cx, cols: colsW },
        { key: 'z0', alongZ: true, dirSign: -1, fixed: z0, mid: cx, cols: colsW },
        { key: 'x1', alongZ: false, dirSign: 1, fixed: x1, mid: cz, cols: colsD },
        { key: 'x0', alongZ: false, dirSign: -1, fixed: x0, mid: cz, cols: colsD },
      ];
      wallFaces.forEach(wf => {
        const isFront = wf.key === frontFace;
        floorYs.forEach((fy, fi) => {
          const wh = fi === 0 ? 1.42 : 1.48;
          const sillY = fi === 0 ? fy : fy + 0.36;
          wf.cols.forEach(off => {
            // map offset relative to F door axis when on front face
            const lat = isFront && F ? (wf.alongZ ? off : off) : off;
            if (isFront && fi === 0 && Math.abs(lat - doorCenter) < 2.2) return;
            if (isFront && opts.sheriff && fi === 1 && Math.abs(lat) < 2.3) return;
            const wx = wf.alongZ ? wf.mid + off : wf.fixed;
            const wz = wf.alongZ ? wf.fixed : wf.mid + off;
            drawWin(wx, sillY, wz, wf.alongZ, wf.dirSign, wh);
          });
        });
      });

      // rooftop clutter
      const r = rand();
      if (r < 0.45) {   // water tank on stilts (low-poly 8-sided)
        const tx = cx + R(-w / 4, w / 4), tz = cz + R(-d / 4, d / 4);
        decoCyl(M.wood, 1.1, 1.1, 2.0, tx, H + 2.4, tz, 8); decoCyl(M.roof, 0.05, 1.2, 0.6, tx, H + 3.7, tz, 8);
        [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([a, b]) => decoBox(M.pole, 0.1, 1.4, 0.1, tx + a, H + 0.7, tz + b));
      } else {
        for (let i = 0; i < 2 + (rand() * 2 | 0); i++) decoBox(M.metal, R(1, 1.8), R(0.7, 1.1), R(1, 1.6), cx + R(-w / 3, w / 3), H + 0.45, cz + R(-d / 3, d / 3));
      }
      if (rand() < 0.5) { decoBox(M.pole, 0.06, R(2.5, 4.5), 0.06, cx + R(-w / 3, w / 3), H + 1.8, cz + R(-d / 3, d / 3)); }   // antenna
      decoBox(M.brick, 0.7, 1.4, 0.7, cx + R(-w / 3, w / 3), H + 0.7, cz + R(-d / 3, d / 3));                                  // chimney / vent stack

      // ---- detailed multi-floor fire escape (corbels, grate slats, railings, pickets, diagonal stairs & treads, drop ladder) ----
      if (H > 9 && F && rand() < 0.75) {
        const side = rand() < 0.5 ? -1 : 1;
        const alongZ = F.axis === 'z'; // true -> side wall is at X = side*L/2, runs along Z
        const wallOrigin = F.point(side * (F.L / 2), 0);
        // helper: local (u outward from wall, y world height, v along wall) -> world box / strut
        const fePos = (u, y, v) => alongZ
          ? [wallOrigin.x + side * u, y, wallOrigin.z + v]
          : [wallOrigin.x + v, y, wallOrigin.z + side * u];
        const feBox = (wOut, h, dAlong, u, y, v) => {
          const [px, py, pz] = fePos(u, y, v);
          decoBox(M.iron, alongZ ? wOut : dAlong, h, alongZ ? dAlong : wOut, px, py, pz);
        };
        const feStrut = (u0, y0, v0, u1, y1, v1, thick) => {
          const [ax, ay, az] = fePos(u0, y0, v0);
          const [bx, by, bz] = fePos(u1, y1, v1);
          decoStrut(M.iron, ax, ay, az, bx, by, bz, thick, thick);
        };

        const bayLen = 3.5, halfBay = bayLen * 0.5, depth = 1.18, railH = 0.96;
        let fi = 0;
        for (let y = 3.85; y + 2.35 < H - 0.55; y += floorStep, fi++) {
          // 1. perimeter steel frame & slatted deck grate (6 open steel slats)
          feBox(depth, 0.06, 0.07, depth * 0.5, y, -halfBay);
          feBox(depth, 0.06, 0.07, depth * 0.5, y, halfBay);
          feBox(0.07, 0.06, bayLen, depth - 0.035, y, 0);
          feBox(0.06, 0.08, bayLen, 0.03, y, 0); // wall ledger beam
          for (let g = 0; g < 5; g++) {
            const gu = 0.16 + g * 0.21;
            feBox(0.055, 0.03, bayLen - 0.1, gu, y + 0.01, 0);
          }

          // 2. heavy wall-mounted corbel support brackets under the landing
          [-1.25, 1.25].forEach(bv => {
            feBox(0.06, 0.72, 0.09, 0.03, y - 0.36, bv); // vertical wall anchor plate
            feBox(depth - 0.08, 0.055, 0.07, depth * 0.5, y - 0.055, bv); // horizontal shelf arm
            feStrut(0.05, y - 0.68, bv, depth - 0.12, y - 0.06, bv, 0.055); // 45-deg gusset brace
          });

          // 3. full 3-sided safety railing (top rail, mid rail, corner/mid posts, vertical pickets)
          feBox(0.045, 0.045, bayLen, depth - 0.03, y + railH, 0);      // front top rail
          feBox(0.035, 0.03, bayLen, depth - 0.03, y + railH * 0.5, 0); // front mid rail
          [-halfBay + 0.03, halfBay - 0.03].forEach(ev => {
            feBox(depth, 0.045, 0.045, depth * 0.5, y + railH, ev);     // end top rails
            feBox(depth, 0.03, 0.035, depth * 0.5, y + railH * 0.5, ev);// end mid rails
            feBox(0.05, railH, 0.05, depth - 0.03, y + railH * 0.5, ev);// outer corner stanchion
            feBox(0.045, railH, 0.045, 0.05, y + railH * 0.5, ev);      // inner wall stanchion
            // end pickets
            [-0.45, -0.80].forEach(pu => feBox(0.025, railH, 0.025, -pu, y + railH * 0.5, ev));
          });
          // front vertical balusters/pickets spaced evenly along the landing
          for (let pv = -1.35; pv <= 1.36; pv += 0.34) {
            const post = Math.abs(pv) < 0.18;
            feBox(post ? 0.045 : 0.024, railH, post ? 0.045 : 0.024, depth - 0.03, y + railH * 0.5, pv);
          }

          // 4. connecting zig-zag diagonal staircase to floor below, or drop-down ladder on floor 1
          if (fi > 0) {
            const dir = fi % 2 === 1 ? 1 : -1;
            const vBot = -1.15 * dir, vTop = 1.15 * dir;
            const yBot = y - floorStep + 0.04, yTop = y;
            // parallel stair stringers (inner + outer)
            [0.24, 0.86].forEach(su => feStrut(su, yBot, vBot, su, yTop, vTop, 0.065));
            // 7 horizontal stair treads stepping up cleanly between the stringers
            const treads = 7;
            for (let tIdx = 1; tIdx <= treads; tIdx++) {
              const k = tIdx / (treads + 1);
              feBox(0.58, 0.035, 0.22, 0.55, yBot + (yTop - yBot) * k, vBot + (vTop - vBot) * k);
            }
            // sloped outer handrail + upright posts
            feStrut(0.90, yBot + 0.78, vBot, 0.90, yTop + 0.78, vTop, 0.038);
            feStrut(0.90, yBot, vBot, 0.90, yBot + 0.78, vBot, 0.038);
            feStrut(0.90, yTop, vTop, 0.90, yTop + 0.78, vTop, 0.038);
          } else {
            // drop-down vertical iron ladder (2 parallel side rails + 8 rungs + guide brackets)
            const lu = depth + 0.06, botY = 1.75, topY = y + 0.65;
            [-0.24, 0.24].forEach(lv => {
              feBox(0.04, topY - botY, 0.04, lu, (botY + topY) * 0.5, lv);
              feBox(0.14, 0.04, 0.04, depth + 0.01, y + 0.03, lv); // mounting bracket
            });
            for (let ry = botY + 0.16; ry < topY - 0.1; ry += 0.30) {
              feBox(0.032, 0.032, 0.48, lu, ry, 0);
            }
          }
        }
      }
      // awning over a shop door
      if (opts.awning && F) {
        const a = F.point(opts.doorA || 0, F.D / 2 + 0.6);
        const along = F.axis === 'z';
        decoBox(opts.awningMat || M.fabric, along ? 3.6 : 1.3, 0.08, along ? 1.3 : 3.6, a.x, 3.15, a.z, along ? F.sign * 0.25 : 0, 0, along ? 0 : -F.sign * 0.25);
      }
    }

    // ---------- furniture (local: +x into the room from the wall, z along it) ----------
    const RUGS = [0x5a2a22, 0x2a3a52, 0x4a4a2a, 0x3a2a3a].map(c => mat({ color: c, roughness: 1 }));
    const PAINTINGS = [0x6a5a3a, 0x2a4a5a, 0x5a3a3a, 0x3a5a3a].map(c => mat({ color: c, roughness: 0.9 }));
    const BOOKS = [0x6a2020, 0x20406a, 0x2a5a2a, 0x7a6a3a, 0x3a2a4a, 0x8a8070].map(c => mat({ color: c }));
    const FABRICS = [0x4a3a32, 0x2f3a4a, 0x4a2f2f, 0x3a4a3a].map(c => mat({ color: c, roughness: 1 }));
    const LINEN = mat({ color: 0xcfcab8, roughness: 1 });
    const PRODUCTS = [0xc8b040, 0xb03030, 0x3060a0, 0x40a050, 0xd0d0c0, 0x8a5a30].map(c => mat({ color: c, roughness: 0.6 }));
    function furniture(type, x, z, yaw, len, kind) {
      const g = new THREE.Group();
      const P = (w, h, d, m, px, py, pz, rx, ry, rz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.rotation.set(rx || 0, ry || 0, rz || 0); g.add(o); return o; };
      const C = (rt, rb, h, m, px, py, pz) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 6), m); o.position.set(px, py, pz); g.add(o); return o; };
      const fy = 0.14;  // floor height inside
      if (type === 'bookshelf') {
        const H2 = R(1.8, 2.2), D2 = 0.38;
        P(0.03, H2, len, M.wood, 0.015, fy + H2 / 2, 0);
        [-1, 1].forEach(sd => P(D2, H2, 0.04, M.wood, D2 / 2, fy + H2 / 2, sd * (len / 2 - 0.02)));
        P(D2, 0.04, len, M.wood, D2 / 2, fy + H2, 0);
        for (let sh = 0; sh < 5; sh++) {
          const y = fy + 0.06 + sh * (H2 - 0.1) / 4.6;
          P(D2, 0.03, len - 0.08, M.wood, D2 / 2, y, 0);
          if (sh < 4) {
            let zz = -len / 2 + 0.1;
            while (zz < len / 2 - 0.16) {
              const bw = R(0.06, 0.14), bh = R(0.2, 0.3);
              if (rand() < 0.85) P(R(0.18, 0.26), bh, bw, pick(BOOKS), 0.16, y + bh / 2 + 0.015, zz + bw / 2, 0, 0, rand() < 0.08 ? 0.25 : 0);
              zz += bw + 0.015;
              if (rand() < 0.08) zz += R(0.12, 0.28);
            }
          }
        }
      } else if (type === 'desk') {
        const top = 0.76;
        P(0.75, 0.04, len, M.wood, 0.4, fy + top, 0);
        [[0.08, -1], [0.72, -1]].forEach(([xx]) => P(0.05, top, 0.05, M.wood, xx, fy + top / 2, -len / 2 + 0.06));
        P(0.62, top - 0.02, 0.45, M.wood, 0.4, fy + top / 2, len / 2 - 0.26);              // drawer unit
        for (let i = 0; i < 3; i++) { P(0.02, 0.18, 0.4, M.wood, 0.72, fy + 0.15 + i * 0.22, len / 2 - 0.26); P(0.03, 0.02, 0.1, M.pole, 0.74, fy + 0.15 + i * 0.22, len / 2 - 0.26); }
        if (kind === 'office' || kind === 'police') {
          P(0.06, 0.32, 0.48, M.dark, 0.22, fy + top + 0.22, -0.1); P(0.12, 0.02, 0.18, M.dark, 0.25, fy + top + 0.03, -0.1);
          P(0.16, 0.02, 0.42, M.dark, 0.5, fy + top + 0.03, -0.1);
        } else { P(0.25, 0.03, 0.32, LINEN, 0.35, fy + top + 0.03, R(-0.3, 0.3), 0, R(-0.4, 0.4), 0); }
        // a chair, pushed back
        const cx = 1.05, cz = R(-len / 4, len / 4) - 0.1, cm = pick(FABRICS);
        P(0.45, 0.06, 0.45, cm, cx, fy + 0.46, cz); P(0.06, 0.5, 0.45, cm, cx + 0.22, fy + 0.74, cz);
        [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(([a, c]) => P(0.04, 0.44, 0.04, M.pole, cx + a, fy + 0.22, cz + c));
      } else if (type === 'couch') {
        const cm = pick(FABRICS);
        P(0.9, 0.38, len, cm, 0.45, fy + 0.19, 0);
        P(0.25, 0.5, len, cm, 0.12, fy + 0.58, 0);
        [-1, 1].forEach(sd => P(0.9, 0.55, 0.18, cm, 0.45, fy + 0.27, sd * (len / 2 - 0.09)));
        const n = len > 1.8 ? 3 : 2;
        for (let i = 0; i < n; i++) P(0.62, 0.12, (len - 0.4) / n - 0.03, cm, 0.55, fy + 0.44, -len / 2 + 0.2 + (i + 0.5) * (len - 0.4) / n);
      } else if (type === 'bed') {
        len = Math.max(2.0, len);
        P(1.35, 0.3, len, M.wood, 0.7, fy + 0.15, 0);
        P(1.3, 0.2, len - 0.1, LINEN, 0.7, fy + 0.4, 0);
        P(1.35, 0.9, 0.06, M.wood, 0.7, fy + 0.45, -len / 2 + 0.03);                      // headboard
        P(0.5, 0.1, 0.32, LINEN, 0.7, fy + 0.55, -len / 2 + 0.28);
        P(1.32, 0.06, len * 0.6, pick(FABRICS), 0.7, fy + 0.52, len * 0.18, 0, 0, R(-0.05, 0.05));
      } else if (type === 'dresser') {
        const H2 = R(0.85, 1.2), w2 = Math.min(len, 1.4);
        P(0.5, H2, w2, M.wood, 0.26, fy + H2 / 2, 0);
        const rows = Math.round(H2 / 0.3);
        for (let i = 0; i < rows; i++) {
          const y = fy + 0.15 + i * (H2 - 0.1) / rows;
          P(0.02, (H2 - 0.1) / rows - 0.04, w2 - 0.08, M.trim, 0.52, y + 0.02, 0);
          P(0.03, 0.03, 0.14, M.pole, 0.54, y + 0.04, 0);
        }
        if (rand() < 0.6) C(0.08, 0.1, 0.3, M.lampOff, 0.25, fy + H2 + 0.15, w2 / 3);
      } else if (type === 'shopShelf' || type === 'aisle') {
        const D2 = type === 'aisle' ? 0.7 : 0.45, H2 = 1.7, ox = type === 'aisle' ? 0 : D2 / 2;
        [-1, 1].forEach(sd => P(D2, H2, 0.04, M.metal, ox, fy + H2 / 2, sd * (len / 2 - 0.02)));
        P(0.03, H2, len, M.metal, ox, fy + H2 / 2, 0);
        for (let sh = 0; sh < 4; sh++) {
          const y = fy + 0.12 + sh * 0.48;
          P(D2, 0.03, len - 0.08, M.metal, ox, y, 0);
          let zz = -len / 2 + 0.12;
          while (zz < len / 2 - 0.16) {
            const pm = pick(PRODUCTS), ph = R(0.16, 0.3);
            if (rand() < 0.72) { if (rand() < 0.6) P(D2 * 0.6, ph, 0.16, pm, ox, y + ph / 2 + 0.015, zz); else C(0.05, 0.05, ph, pm, ox + R(-0.1, 0.1), y + ph / 2 + 0.015, zz); }
            zz += R(0.22, 0.34);
          }
        }
      } else if (type === 'counter') {
        P(0.7, 1.0, len, M.wood, 0.4, fy + 0.5, 0);
        P(0.8, 0.05, len + 0.06, M.trim, 0.42, fy + 1.02, 0);
        P(0.35, 0.22, 0.4, M.dark, 0.4, fy + 1.15, R(-len / 4, len / 4));                // till
      }
      g.position.set(x, 0, z); g.rotation.y = yaw;
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      const map = decoMap();
      g.traverse(o => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (!map.has(o.material)) map.set(o.material, []);
        map.get(o.material).push(geo.index ? geo.toNonIndexed() : geo);
        o.geometry.dispose();
      });
      collider(bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.max.y);
    }

    // ---------- forced special lots ----------
    // key: "blockI,blockJ,lotX,lotZ" (lotX/lotZ = -1 | 1)
    const SPECIAL = {
      '2,0,-1,1': { type: 'enter', kind: 'police', sheriff: true },   // the sheriff's station never moves
      '0,2,1,-1': { type: 'enter', kind: 'house' },
      '1,0,-1,1': { type: 'enter', kind: 'shop' },          // near spawn
      '2,1,-1,-1': { type: 'enter', kind: 'office' },
      '3,1,1,1': { type: 'enter', kind: 'house' },
      '0,0,1,1': { type: 'enter', kind: 'office' },
      '1,1,1,1': { type: 'ruin' },                            // town centre devastation
      '1,3,1,1': { type: 'park' },
      '2,0,1,-1': { type: 'park' },
      '3,3,-1,-1': { type: 'parking' },
      '0,3,1,-1': { type: 'parking' },
    };

    let enterCount = 0;
    for (let bi = 0; bi < NB; bi++) for (let bj = 0; bj < NB; bj++) {
      const bx = BLOCK_C[bi], bz = BLOCK_C[bj];
      for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
        const cx = bx + lx * 10, cz = bz + lz * 10;
        const key = `${bi},${bj},${lx},${lz}`;
        const sp = SPECIAL[key];
        let type;
        if (sp) type = sp.type;
        else {
          // denser town: mostly buildings
          const r = rand();
          type = r < 0.32 ? 'enter' : r < 0.86 ? 'closed' : r < 0.95 ? 'ruin' : 'parking';
          if (type === 'enter' && enterCount > 11) type = 'closed';
        }
        const axis = rand() < 0.5 ? 'x' : 'z';
        const sign = axis === 'x' ? lx : lz;
        const L = Math.round(R(13, 16));
        const D = Math.round(R(13, 16));
        const H = rand() < 0.7 ? R(7, 11) : R(12, 18);
        if (type === 'enter') {
          enterCount++;
          buildEnterable(cx, cz, L, D, Math.max(H, 6), axis, sign, (sp && sp.kind) || pick(['house', 'shop', 'office', 'house']), sp);
        } else if (type === 'closed') {
          buildClosed(cx, cz, L, D, H, axis, sign);
        } else if (type === 'ruin') {
          buildRuin(cx, cz, L, D);
        } else {
          buildLot(cx, cz, type);
          W.openLots.push({ cx, cz, type });
        }
      }
      // dumpster in each block's central alley, sometimes two
      const ry = rand() < 0.5 ? 0 : Math.PI / 2;
      dumpster(bx + (ry ? 0 : R(-12, 12)), bz + (ry ? R(-12, 12) : 0), ry + (rand() < 0.5 ? Math.PI : 0));
    }

    // =========================================================
    //  STREET DRESSING
    // =========================================================
    // lamps along streets
    let lampI = 0;
    STREETS.forEach((s, i) => {
      for (let k = 0; k < NB; k++) {
        const along = BLOCK_C[k];
        const side = (k + i) % 2 ? 1 : -1;
        const st = lampI++ % 7 === 3 ? 'flicker' : (rand() < 0.15 ? 'bent' : 'off');
        streetLamp(s + side * (ST / 2 + 0.7), along + R(-6, 6), side > 0 ? -Math.PI / 2 : Math.PI / 2, st);
        if (rand() < 0.5) streetLamp(along + R(-6, 6), s + side * (ST / 2 + 0.7), side > 0 ? Math.PI : 0, rand() < 0.12 ? 'bent' : 'off');
      }
    });
    // abandoned cars on the streets (keep the very centre of intersections clear)
    for (let i = 0; i < 18; i++) {
      const s = pick(STREETS), along = pick(BLOCK_C) + R(-12, 12);
      const lane = pick([-3, 3]);
      const vertical = rand() < 0.5;
      if (vertical) car(s + lane, along, R(-0.3, 0.3) + (lane > 0 ? 0 : Math.PI), { flipped: rand() < 0.15 });
      else car(along, s + lane, Math.PI / 2 + R(-0.3, 0.3) + (lane > 0 ? Math.PI : 0), { flipped: rand() < 0.15 });
    }
    // street-side dumpsters
    for (let i = 0; i < 8; i++) {
      const bx = pick(BLOCK_C), bz = pick(BLOCK_C);
      const side = pick([-1, 1]);
      if (rand() < 0.5) dumpster(bx + side * (BLOCK / 2 - 1.2), bz + R(-14, 14), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      else dumpster(bx + R(-14, 14), bz + side * (BLOCK / 2 - 1.2), side > 0 ? 0 : Math.PI);
    }
    // additional exterior dumpsters covering perimeter & open dead zones (v2.4.3+)
    if (!LO.ver || LO.ver().fastoneV2) {
      [
        [-92.0, -96.0, Math.PI],       // SW perimeter corner building exterior
        [59.8, 90.0, -Math.PI / 2],    // NE avenue storefront edge near north road
        [-96.8, 25.0, -Math.PI / 2],   // West perimeter alley mouth
        [44.5, -96.2, Math.PI],        // South-East park / perimeter road edge
      ].forEach(([dx, dz, dry]) => dumpster(dx, dz, dry));
    }
    // outdoor batteries
    [[-58, -20], [47, 58], [-20, 47], [56, -80], [-102, 70], [80, 100], [4, -40]].forEach(([x, z]) => battery(x, 0.4, z));
    // throwable rocks lying around (sparse — you only find one occasionally)
    {
      const rg = new THREE.DodecahedronGeometry(0.14);
      const rm = mat({ color: 0x77736c });
      for (let i = 0; i < 16; i++) {
        const s = pick(STREETS), a = R(-HALF + 10, HALF - 10), off = R(-4.5, 4.5);
        const v = rand() < 0.5;
        const m = new THREE.Mesh(rg, rm);
        m.position.set(v ? s + off : a, 0.12, v ? a : s + off);
        m.rotation.set(R(0, 3), R(0, 3), 0);
        W.root.add(m);
        W.pickups.push({ type: 'rock', mesh: m, pos: m.position, baseY: 0.12, taken: false, still: true });
      }
    }
    // debris (grounded flush on street)
    for (let i = 0; i < 40; i++) {
      const s = pick(STREETS), a = R(-HALF + 8, HALF - 8);
      const v = rand() < 0.5, h = R(0.1, 0.4);
      box(R(0.3, 1.2), h, R(0.3, 1.2), rand() < 0.5 ? M.rubble : M.wood, v ? s + R(-5, 5) : a, h * 0.5, v ? a : s + R(-5, 5), { ry: R(0, 3) });
    }

    // =========================================================
    //  TOWN EDGE, ENTRANCE, FOREST
    // =========================================================
    // invisible perimeter
    const E = HALF + 3;
    collider(-E - 5, -E, -E - 5, E + 5); collider(E, E + 5, -E - 5, E + 5);
    collider(-E, E, E, E + 5); collider(-E, E, -E - 5, -E);
    // break-ready weathered timber perimeter fence (posts, rails, spaced slats with open gaps, grounded at y = 0)
    W.fences = [];
    const fenceMat = mat({ map: T('wood'), color: 0x7a6e5f, vertexColors: true, roughness: 0.95, metalness: 0.02 });
    const fenceGeo = (() => {
      const list = [];
      const addPart = (w, h, d, x, y, z, cr, cg, cb, verticalGrain, rz) => {
        const g = new THREE.BoxGeometry(w, h, d);
        const uvs = g.attributes.uv;
        for (let i = 0; i < uvs.count; i++) {
          const u = uvs.getX(i), v = uvs.getY(i);
          if (verticalGrain) uvs.setXY(i, v * 0.85, u * 0.45);
          else uvs.setXY(i, u * 1.4, v * 0.35);
        }
        if (rz) g.rotateZ(rz);
        g.translate(x, y, z);
        const nonIdx = g.index ? g.toNonIndexed() : g;
        if (g.index) g.dispose();
        const cnt = nonIdx.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) {
          col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb;
        }
        nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
        list.push(nonIdx);
      };
      // heavy posts & post caps at -2.91 and 0.00
      [-2.91, 0.0].forEach(px => {
        addPart(0.18, 2.34, 0.18, px, 1.17, 0, 0.44, 0.40, 0.36, true, 0);
        addPart(0.22, 0.07, 0.22, px, 2.375, 0, 0.36, 0.33, 0.30, false, 0);
      });
      // lower & upper horizontal stringer rails (cleanly behind slats at z = -0.04)
      addPart(5.96, 0.10, 0.06, 0, 0.44, -0.04, 0.56, 0.51, 0.45, false, 0);
      addPart(5.96, 0.10, 0.06, 0, 1.92, -0.04, 0.56, 0.51, 0.45, false, 0);
      // subtle dark iron top security rail between post caps
      addPart(5.96, 0.035, 0.035, 0, 2.28, 0, 0.24, 0.25, 0.27, false, 0);
      // 12 spaced vertical wooden slats/pickets with clear 0.23m see-through gaps
      const slatXs = [-2.55, -2.10, -1.65, -1.20, -0.75, -0.30, 0.30, 0.75, 1.20, 1.65, 2.10, 2.55];
      slatXs.forEach((sx, idx) => {
        const jH = ((idx * 37) % 5 - 2) * 0.03;
        const jTilt = ((idx * 53) % 5 - 2) * 0.009;
        const shade = 0.62 + ((idx * 29) % 5) * 0.045;
        const sh = 2.04 + jH;
        addPart(0.22, sh, 0.045, sx, 0.12 + sh * 0.5, 0.03, shade, shade * 0.94, shade * 0.85, true, jTilt);
      });
      let n = 0; list.forEach(g => { n += g.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      let o = 0;
      list.forEach(g => {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        uv.set(g.attributes.uv.array, o * 2);
        col.set(g.attributes.color.array, o * 3);
        o += g.attributes.position.count;
        g.dispose();
      });
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      merged.computeBoundingSphere();
      return merged;
    })();
    [[0, E - 0.5, 0], [0, -E + 0.5, 0], [E - 0.5, 0, Math.PI / 2], [-E + 0.5, 0, Math.PI / 2]].forEach(([x, z, r]) => {
      for (let k = -HALF; k < HALF; k += 6) {
        if (z < 0 && r === 0 && Math.abs(k + 3) < 7) continue; // entrance gap
        const p = new THREE.Mesh(fenceGeo, fenceMat);
        const px = r ? x : k + 3, pz = r ? k + 3 : z;
        p.position.set(px, 0, pz);
        p.rotation.y = r;
        add(p);
        W.fences.push({
          mesh: p,
          pos: new THREE.Vector3(px, 1.1, pz),
          basePos: p.position.clone(),
          baseRot: p.rotation.clone(),
          broken: false,
        });
      }
    });
    // corner & entrance end-posts so every fence run terminates cleanly on a post
    [[-E + 0.5, -E + 0.5], [E - 0.5, -E + 0.5], [-E + 0.5, E - 0.5], [E - 0.5, E - 0.5], [-8, -E + 0.5], [4, -E + 0.5]].forEach(([ex, ez]) => {
      decoBox(M.trim, 0.20, 2.38, 0.20, ex, 1.19, ez);
      decoBox(M.trim, 0.24, 0.08, 0.24, ex, 2.41, ez);
    });
    // road block at the entrance (behind the player's car)
    for (let i = -1; i <= 1; i++) {
      const b = box(1.6, 0.9, 0.4, mat({ color: 0xc8c0a0 }), i * 2, 0.45, -E - 1, { collide: true });
      void b;
    }
    collider(-6, 6, -E - 2, -E);
    // welcome sign beside the south road
    {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), M.sign);
      s.position.y = 2.6; g.add(s);
      [-2.6, 2.6].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), M.pole); p.position.set(x, 1.6, -0.05); g.add(p); });
      g.position.set(-8, 0, -150); g.rotation.y = 0.15; add(g);
      W.sign = g;
    }
    // forest outside town (instanced low-poly 4-sided trees, no distant shadow casting)
    {
      const n = S.viewDistance === 'near' ? 380 : 760;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.35, 6, 4, 1, true), M.bark, n);
      const top = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 8, 4), M.leaves, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      let i = 0;
      while (i < n) {
        const x = R(-420, 420), z = R(-560, 420);
        if (Math.abs(x) < HALF + 32 && Math.abs(z) < HALF + 32) continue;
        if (Math.abs(x) < 12 && z < -HALF) continue; // keep the road clear
        if (Math.abs(x + 8) < 6 && Math.abs(z + 150) < 6) continue;
        const s = R(0.8, 1.6);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R(0, 6.28));
        m4.compose(p.set(x, 3 * s, z), q, sc.set(s, s, s)); trunk.setMatrixAt(i, m4);
        m4.compose(p.set(x, 8.5 * s, z), q, sc.set(s, s * R(0.9, 1.3), s)); top.setMatrixAt(i, m4);
        i++;
      }
      W.root.add(trunk, top);
    }
    // outskirts: a ring of dark buildings beyond the fence
    for (const side of [0, 1, 2, 3]) {
      for (let k = -HALF - 20; k < HALF + 20; k += R(13, 17)) {
        if (side === 1 && Math.abs(k) < 16) continue;            // the south road
        const d = HALF + R(12, 24), h = R(6, 20), w = R(9, 13), dd = R(9, 13);
        const x = side === 0 ? k : side === 1 ? k : side === 2 ? d : -d;
        const z = side === 0 ? d : side === 1 ? -d : k;
        const g = worldUV(new THREE.BoxGeometry(w, h, dd), w, h, dd, 12);
        const f = pick(M.facades);
        const m = new THREE.Mesh(g, [f, f, M.roof, M.roof, f, f]);
        m.position.set(x, h / 2, z); add(m);
        decoBox(M.rubble, w + 0.3, 0.6, dd + 0.3, x, h + 0.3, z); decoBox(M.trim, w + 0.5, 0.2, dd + 0.5, x, h - 0.2, z);
      }
    }
    // distant hills silhouette (low-poly 4-sided cones)
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const h = new THREE.Mesh(new THREE.ConeGeometry(R(120, 220), R(40, 90), 4), M.leaves);
      h.position.set(Math.cos(a) * 640, 0, Math.sin(a) * 640); W.root.add(h);
    }

    // =========================================================
    //  NAV — street graph for the monster
    // =========================================================
    W.nodes = [];
    STREETS.forEach((x, i) => STREETS.forEach((z, j) => W.nodes.push({ i, j, x, z })));
    W.nodeAt = (i, j) => W.nodes[i * STREETS.length + j];
    // nearest point that lies on a street centre line
    W.projectToStreet = function (p) {
      const nearest = v => STREETS.reduce((a, s) => Math.abs(s - v) < Math.abs(a - v) ? s : a, STREETS[0]);
      const clamp = v => Math.max(-HALF + ST / 2, Math.min(HALF - ST / 2, v));
      const a = { x: nearest(p.x), z: clamp(p.z) };
      const b = { x: clamp(p.x), z: nearest(p.z) };
      const da = (a.x - p.x) ** 2 + (a.z - p.z) ** 2, db = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
      return da < db ? a : b;
    };
    W.nearestNode = function (p) {
      let best = null, bd = Infinity;
      W.nodes.forEach(n => { const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd) { bd = d; best = n; } });
      return best;
    };
    W.path = function (from, to) {
      // BFS on the 5x5 grid
      const N = STREETS.length;
      const start = W.nearestNode(from), goal = W.nearestNode(to);
      const prev = new Map(); const q = [start]; prev.set(start, null);
      while (q.length) {
        const n = q.shift();
        if (n === goal) break;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
          const ni = n.i + di, nj = n.j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) return;
          const m = W.nodeAt(ni, nj);
          if (!prev.has(m)) { prev.set(m, n); q.push(m); }
        });
      }
      const out = []; let n = goal;
      while (n) { out.unshift(n); n = prev.get(n); }
      return out;
    };
    W.isIndoor = function (p) {
      return W.interiors.some(r => !r.disabled && p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ);
    };

    // =========================================================
    //  BUILDING SMASHING & EVIDENCE PATH QUERIES
    // =========================================================
    W.syncOccluders = function () {
      W.occluders.length = 0;
      for (let i = 0; i < W.baseOccluders.length; i++) W.occluders.push(W.baseOccluders[i]);
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        const list = b.smashed ? b.debrisOccluders : b.occluders;
        for (let j = 0; j < list.length; j++) W.occluders.push(list[j]);
      }
    };

    W.segmentHitsBox = function (ax, az, bx, bz, x0, x1, z0, z1, pad) {
      pad = pad || 0;
      const minX = x0 - pad, maxX = x1 + pad, minZ = z0 - pad, maxZ = z1 + pad;
      const dx = bx - ax, dz = bz - az;
      let tmin = 0, tmax = 1;
      if (Math.abs(dx) < 1e-6) {
        if (ax < minX || ax > maxX) return false;
      } else {
        const inv = 1 / dx;
        let t1 = (minX - ax) * inv, t2 = (maxX - ax) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
      if (Math.abs(dz) < 1e-6) {
        if (az < minZ || az > maxZ) return false;
      } else {
        const inv = 1 / dz;
        let t1 = (minZ - az) * inv, t2 = (maxZ - az) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
      return true;
    };

    W.hitsEvidenceBuilding = function (from, to, pad) {
      pad = pad === undefined ? 1.8 : pad;
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        if (!b.hasEvidence) continue;
        if (W.segmentHitsBox(from.x, from.z, to.x, to.z, b.minX, b.maxX, b.minZ, b.maxZ, pad)) return b;
      }
      return null;
    };

    W.evidenceBuildingAt = function (x, z, pad) {
      pad = pad === undefined ? 1.5 : pad;
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        if (b.hasEvidence && x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return b;
      }
      return null;
    };

    W.smashableBuildingAt = function (x, z, pad) {
      pad = pad === undefined ? 1.3 : pad;
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        if (!b.hasEvidence && !b.smashed && x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return b;
      }
      return null;
    };

    const _debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    W.smashBuilding = function (b, impactPos, dir) {
      if (!b || b.smashed || b.hasEvidence) return false;
      b.smashed = true;
      b.group.visible = false;
      b.colliders.forEach(c => { c.disabled = true; });
      if (b.interior) b.interior.disabled = true;
      b.hideSpots.forEach(sp => { sp.disabled = true; sp.setOpen && sp.setOpen(0); });

      if (!b.debrisGroup) {
        const dg = new THREE.Group();
        const x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;

        // grounded concrete foundation slab
        const slabGeo = worldUV(new THREE.BoxGeometry(w, 0.3, d), w, 0.3, d, 4);
        const slab = new THREE.Mesh(slabGeo, M.concrete);
        slab.position.set(cx, 0.15, cz);
        if (shadows) { slab.receiveShadow = true; }
        dg.add(slab);

        // low jagged corner wall stubs (center path kept open for Siren Head / player)
        const corners = [
          [x0, x0 + 0.42, z0, z0 + Math.min(3.5, d * 0.25)],
          [x1 - 0.42, x1, z1 - Math.min(3.5, d * 0.25), z1],
          [x0, x0 + Math.min(3.5, w * 0.25), z1 - 0.42, z1],
          [x1 - Math.min(3.5, w * 0.25), x1, z0, z0 + 0.42],
        ];
        corners.forEach(([cx0, cx1, cz0, cz1]) => {
          const ch = 0.9 + Math.random() * 1.9;
          const cw = cx1 - cx0, cd = cz1 - cz0;
          const wm = new THREE.Mesh(worldUV(new THREE.BoxGeometry(cw, ch, cd), cw, ch, cd, 4), M.brick);
          wm.position.set((cx0 + cx1) / 2, ch / 2, (cz0 + cz1) / 2);
          if (shadows) { wm.castShadow = true; wm.receiveShadow = true; }
          dg.add(wm);
          b.debrisOccluders.push(wm);
          const col = { minX: cx0, maxX: cx1, minZ: cz0, maxZ: cz1, maxY: ch, minY: 0, disabled: false };
          W.colliders.push(col);
          b.debrisColliders.push(col);
        });

        // grounded scattered brick/concrete chunks and fallen timber beams on the slab
        for (let i = 0; i < 14; i++) {
          const sx = 0.5 + Math.random() * 1.3, sy = 0.22 + Math.random() * 0.42, sz = 0.5 + Math.random() * 1.2;
          const cm = new THREE.Mesh(_debrisGeo, i % 3 === 0 ? M.brick : M.rubble);
          cm.scale.set(sx, sy, sz);
          cm.position.set(cx + (Math.random() - 0.5) * (w - 2), 0.3 + sy * 0.45, cz + (Math.random() - 0.5) * (d - 2));
          cm.rotation.set((Math.random() - 0.5) * 0.12, Math.random() * Math.PI, (Math.random() - 0.5) * 0.12);
          if (shadows) { cm.castShadow = true; cm.receiveShadow = true; }
          dg.add(cm);
        }
        for (let i = 0; i < 3; i++) {
          const bm = new THREE.Mesh(_debrisGeo, M.wood);
          bm.scale.set(0.28, 0.24, 3.2 + Math.random() * 2.5);
          bm.position.set(cx + (Math.random() - 0.5) * (w * 0.45), 0.42, cz + (Math.random() - 0.5) * (d * 0.45));
          bm.rotation.y = Math.random() * Math.PI;
          if (shadows) { bm.castShadow = true; bm.receiveShadow = true; }
          dg.add(bm);
        }

        W.root.add(dg);
        b.debrisGroup = dg;
        b.restore = function () {
          b.smashed = false;
          b.group.visible = true;
          b.colliders.forEach(c => { c.disabled = false; });
          if (b.interior) b.interior.disabled = false;
          b.hideSpots.forEach(sp => { sp.disabled = false; sp.setOpen && sp.setOpen(0); });
          if (b.debrisGroup) b.debrisGroup.visible = false;
          b.debrisColliders.forEach(c => { c.disabled = true; });
        };
      } else {
        b.debrisGroup.visible = true;
        b.debrisColliders.forEach(c => { c.disabled = false; });
      }
      W.syncOccluders();

      // erupting flying debris parts pushed in Siren Head's travel direction
      const ox = impactPos ? impactPos.x : b.cx, oz = impactPos ? impactPos.z : b.cz;
      const dx = dir ? dir.x : 0, dz = dir ? dir.z : 1;
      const mats = [M.brick, M.rubble, M.wood, M.trim];
      for (let i = 0; i < 20; i++) {
        const sx = 0.28 + Math.random() * 0.65, sy = 0.18 + Math.random() * 0.4, sz = 0.28 + Math.random() * 0.9;
        const m = new THREE.Mesh(_debrisGeo, mats[i % mats.length]);
        m.scale.set(sx, sy, sz);
        m.position.set(ox + (Math.random() - 0.5) * 5, 1.5 + Math.random() * Math.min(7, b.H * 0.6), oz + (Math.random() - 0.5) * 5);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        W.debrisGroup.add(m);
        const fwdSp = 5 + Math.random() * 14, sideSp = (Math.random() - 0.5) * 14;
        W.flyingDebris.push({
          mesh: m, halfY: sy * 0.5,
          vx: dx * fwdSp + (-dz) * sideSp,
          vy: 3 + Math.random() * 10,
          vz: dz * fwdSp + dx * sideSp,
          rx: (Math.random() - 0.5) * 10,
          ry: (Math.random() - 0.5) * 10,
          rz: (Math.random() - 0.5) * 10,
          settled: false,
          life: 9.0,
        });
      }
      return true;
    };

    // =========================================================
    //  UPDATE (flickering lights, pickups bobbing)
    // =========================================================
    // ---------- wind-blown dust and leaves around the camera ----------
    {
      const N = S.textures === 'low' ? 220 : 480, BOX = 36, H = 10;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (rand() - 0.5) * BOX; pos[i * 3 + 1] = rand() * H; pos[i * 3 + 2] = (rand() - 0.5) * BOX;
        const leaf = rand() < 0.4, v = 0.25 + rand() * 0.3;
        col[i * 3] = leaf ? v * 1.1 : v; col[i * 3 + 1] = leaf ? v * 0.8 : v; col[i * 3 + 2] = leaf ? v * 0.45 : v * 0.95;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }));
      pts.frustumCulled = false;
      scene.add(pts);
      const phase = new Float32Array(N).map(() => rand() * 10);
      W.dust = { pts, pos, phase, N, BOX, H };
    }
    W.windDir = new THREE.Vector3(1, 0, 0.45).normalize();
    // strength 0..1; at 0 everything settles to the ground and goes still
    W.updateWind = function (dt, strength, cam, time) {
      const D = W.dust, p = D.pos, half = D.BOX / 2;
      const sp = 9 * strength;
      for (let i = 0; i < D.N; i++) {
        const k = i * 3;
        if (strength > 0.05) {
          const flutter = Math.sin(time * 3 + D.phase[i]);
          p[k] += (W.windDir.x * sp + flutter * 0.6 * strength) * dt;
          p[k + 2] += (W.windDir.z * sp + Math.cos(time * 2.3 + D.phase[i]) * 0.6 * strength) * dt;
          p[k + 1] += (flutter * 0.9 * strength - 0.25) * dt;
          if (p[k + 1] < 0.03) p[k + 1] = D.H * Math.random();
        } else if (p[k + 1] > 0.03) {
          p[k + 1] = Math.max(0.03, p[k + 1] - dt * 1.2); // drifts down and stays
        }
        // keep the particle box centred on the camera
        let x = p[k] - cam.x, z = p[k + 2] - cam.z;
        if (x > half) p[k] -= D.BOX; else if (x < -half) p[k] += D.BOX;
        if (z > half) p[k + 2] -= D.BOX; else if (z < -half) p[k + 2] += D.BOX;
      }
      D.pts.geometry.attributes.position.needsUpdate = true;
    };

    W.update = function (dt, time) {
      W.flickers.forEach(f => {
        f.t -= dt;
        if (f.mode === 'flicker') {
          if (f.t <= 0) { f.on = !f.on; f.t = f.on ? R(0.05, 1.8) : R(0.03, 0.4); }
          const v = f.on ? f.base : 0;
          f.light.intensity = v;
          if (f.head) f.head.material = f.on ? M.lampOn : M.lampOff;
          if (f.glow) f.glow.visible = f.on;
        } else if (f.mode === 'screen') {
          f.light.intensity = f.base * (0.8 + Math.random() * 0.3);
        } else {
          f.light.intensity = f.base;
        }
      });
      W.pickups.forEach(p => {
        if (p.taken || p.type === 'rock') return;
        p.mesh.position.y = p.baseY + Math.sin(time * 2 + p.pos.x) * 0.06;
        p.mesh.rotation.y += dt;
      });
      for (let i = W.flyingDebris.length - 1; i >= 0; i--) {
        const d = W.flyingDebris[i];
        d.life -= dt;
        if (d.life <= 0) {
          W.debrisGroup.remove(d.mesh);
          W.flyingDebris.splice(i, 1);
          continue;
        }
        if (d.settled) continue;
        d.vy -= 22 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.y += d.ry * dt;
        d.mesh.rotation.z += d.rz * dt;
        const floorY = 0.22 + d.halfY;
        if (d.mesh.position.y <= floorY) {
          d.mesh.position.y = floorY;
          if (Math.abs(d.vy) > 3.2) {
            d.vy = -d.vy * 0.32;
            d.vx *= 0.55; d.vz *= 0.55;
            d.rx *= 0.4; d.ry *= 0.4; d.rz *= 0.4;
          } else {
            d.vy = 0; d.vx = 0; d.vz = 0;
            d.mesh.rotation.x = 0; d.mesh.rotation.z = 0;
            d.settled = true;
          }
        }
      }
    };

    // =========================================================
    //  EVIDENCE — randomised every game (except the sheriff's tape)
    // =========================================================
    W.evGroup = new THREE.Group(); W.root.add(W.evGroup);
    const clawTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      for (let i = 0; i < 4; i++) {
        g.save(); g.translate(60 + i * 40, 20); g.rotate(0.18);
        const gr = g.createLinearGradient(0, 0, 14, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(5,3,2,0.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(7, 0); g.quadraticCurveTo(20, 110, 7, 220); g.quadraticCurveTo(-6, 110, 7, 0); g.fill();
        g.restore();
      }
      return new THREE.CanvasTexture(c);
    })();
    const sprayTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(150,12,12,0.92)'; g.font = 'bold 64px "Special Elite", Courier, monospace'; g.textAlign = 'center';
      ['DONT MAKE', 'A SOUND', 'IT HEARS', 'EVERYTHING'].forEach((l, i) => {
        g.save(); g.translate(256 + (Math.random() - 0.5) * 20, 100 + i * 100); g.rotate((Math.random() - 0.5) * 0.12); g.fillText(l, 0, 0); g.restore();
      });
      for (let i = 0; i < 30; i++) { g.fillRect(60 + Math.random() * 390, 90 + Math.random() * 330, 3, 10 + Math.random() * 40); }
      return new THREE.CanvasTexture(c);
    })();
    const decalMat = map => new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

    W.placeEvidence = function () {
      W.evGroup.clear();
      W.evColliders.length = 0; W.evOccluders.length = 0;
      W.evidence = [];
      for (let i = W.flyingDebris.length - 1; i >= 0; i--) W.debrisGroup.remove(W.flyingDebris[i].mesh);
      W.flyingDebris.length = 0;
      W.buildings.forEach(b => {
        if (b.smashed && b.restore) b.restore();
        b.hasEvidence = b.sheriff;
      });
      if (W.fences) {
        W.fences.forEach(f => {
          f.broken = false;
          f.mesh.visible = true;
          f.mesh.position.copy(f.basePos);
          f.mesh.rotation.copy(f.baseRot);
        });
      }
      const r = Math.random, pk = a => a[(r() * a.length) | 0];
      const used = new Set();
      const takeEnter = () => { const c = W.enterables.filter(b => !b.sheriff && !used.has(b)); const b = pk(c); used.add(b); if (b && b.building) b.building.hasEvidence = true; return b; };
      const takeFront = () => { const c = W.closedFronts.filter(b => !used.has(b) && b.H >= 7); const b = pk(c); used.add(b); if (b && b.building) b.building.hasEvidence = true; return b; };
      const evCol = (x0, x1, z0, z1, maxY) => W.evColliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY, minY: 0 });
      const streetPoint = () => {
        const s0 = pk(STREETS), along = pk(BLOCK_C) + (r() - 0.5) * 22, off = (r() - 0.5) * 6;
        return r() < 0.5 ? { x: s0 + off, z: along, vertical: true } : { x: along, z: s0 + off, vertical: false };
      };
      // a room spot inside an enterable building: on a side wall (+/-a) or the back wall
      const wallSpot = (b, which) => {
        const { F, hl, hd, t, pb } = b;
        if (which === 'back') return { p: F.point(0, -hd + t + 0.03), yaw: F.yawFront() };
        const side = r() < 0.5 ? 1 : -1;
        const lo = -hd + t + 1.5, hi = pb - 1.2;
        const bb = hi > lo ? lo + r() * (hi - lo) : (pb + hd) / 2;
        return { p: F.point(side * (hl - t - 0.03), bb), yaw: F.yawLeft() + (side > 0 ? Math.PI : 0) };
      };

      // 1. giant footprint — on a street or in an open lot
      {
        let x, z;
        if (r() < 0.7 || !W.openLots.length) { const sp = streetPoint(); x = sp.x; z = sp.z; }
        else { const l = pk(W.openLots); x = l.cx + (r() - 0.5) * 6; z = l.cz + (r() - 0.5) * 6; }
        const fp = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 8), M.footprint);
        fp.rotation.x = -Math.PI / 2; fp.rotation.z = r() * 6.28; fp.position.set(x, 0.06, z);
        W.evGroup.add(fp);
        rubblePile(x, z, 3, 6, W.evGroup);
        W.evidence.push({ id: 'footprint', name: 'Giant footprint', pos: new THREE.Vector3(x, 0.1, z), maxDist: 16, found: false, ground: true });
      }
      // 2. crushed police cruiser — somewhere on the streets
      {
        const sp = streetPoint();
        const ry = (sp.vertical ? 0 : Math.PI / 2) + (r() - 0.5) * 1.2;
        const g = car(sp.x, sp.z, ry, { police: true, crushed: true, parent: W.evGroup, noCollide: true });
        evCol(sp.x - 2.4, sp.x + 2.4, sp.z - 2.4, sp.z + 2.4, 1.2);
        rubblePile(sp.x, sp.z, 3.5, 5, W.evGroup);
        W.evidence.push({ id: 'police', name: 'Crushed police cruiser', pos: new THREE.Vector3(sp.x, 0.6, sp.z), maxDist: 16, found: false, margin: 3 });
        void g;
      }
      // 3. giant claw marks — outside on a wall, or inside a building
      {
        if (r() < 0.5) {
          const b = takeFront();
          let a = (r() - 0.5) * (b.L - 8); if (Math.abs(a - b.doorA) < 3) a = b.doorA + (a < b.doorA ? -3 : 3);
          const p = b.F.point(a, b.D / 2 + 0.17), y = Math.min(4.4, b.H * 0.5);
          const cm = new THREE.Mesh(new THREE.PlaneGeometry(7, Math.min(8, b.H * 0.85)), decalMat(clawTex));
          cm.position.set(p.x, y, p.z); cm.rotation.y = b.F.yawFront(); W.evGroup.add(cm);
          W.evidence.push({ id: 'claws', name: 'Giant claw marks', pos: new THREE.Vector3(p.x, y, p.z), maxDist: 22, found: false });
        } else {
          const b = takeEnter(), w = wallSpot(b, 'side');
          const cm = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.0), decalMat(clawTex));
          cm.position.set(w.p.x, 1.8, w.p.z); cm.rotation.y = w.yaw; W.evGroup.add(cm);
          W.evidence.push({ id: 'claws', name: 'Giant claw marks', pos: new THREE.Vector3(w.p.x, 1.8, w.p.z), maxDist: 9, found: false });
        }
      }
      // 4. survivor's warning — inside on a wall, or sprayed on a building outside
      {
        if (r() < 0.6) {
          const b = takeEnter(), w = wallSpot(b, 'back');
          const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), M.warning);
          pm.position.set(w.p.x, 1.7, w.p.z); pm.rotation.y = w.yaw; W.evGroup.add(pm);
          W.evidence.push({ id: 'warning', name: 'Survivor\'s warning', pos: new THREE.Vector3(w.p.x, 1.7, w.p.z), maxDist: 9, found: false });
        } else {
          const b = takeFront();
          let a = (r() - 0.5) * (b.L - 7); if (Math.abs(a - b.doorA) < 3) a = b.doorA + (a < b.doorA ? -3 : 3);
          const p = b.F.point(a, b.D / 2 + 0.17);
          const pm = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), decalMat(sprayTex));
          pm.position.set(p.x, 2.4, p.z); pm.rotation.y = b.F.yawFront(); W.evGroup.add(pm);
          W.evidence.push({ id: 'warning', name: 'Survivor\'s warning', pos: new THREE.Vector3(p.x, 2.4, p.z), maxDist: 16, found: false });
        }
      }
      // 5. CCTV still — on a security desk in a random building
      {
        const b = takeEnter();
        const { F, hd, t, gapA, axis } = b;
        const p = F.point(-gapA * 0.3 + (gapA > 0 ? -2.5 : 2.5), -hd + t + 1.0);
        const desk = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? 2.4 : 1, 0.9, axis === 'z' ? 1 : 2.4), M.wood);
        desk.position.set(p.x, 0.45, p.z); W.evGroup.add(desk);
        evCol(p.x - (axis === 'z' ? 1.2 : 0.5), p.x + (axis === 'z' ? 1.2 : 0.5), p.z - (axis === 'z' ? 0.5 : 1.2), p.z + (axis === 'z' ? 0.5 : 1.2), 0.9);
        const mon = new THREE.Group();
        mon.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.5), mat({ color: 0x2b2b28 })));
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.7), M.cctv);
        screen.position.z = 0.26; mon.add(screen);
        mon.position.set(p.x, 1.35, p.z); mon.rotation.y = F.yawFront();
        W.evGroup.add(mon);
        W.evidence.push({ id: 'cctv', name: 'CCTV still of the creature', pos: new THREE.Vector3(p.x, 1.35, p.z), maxDist: 7, found: false });
      }
      // 6. water tower with a giant handprint — in an open lot
      if (W.openLots.length) {
        const l = pk(W.openLots), cx = l.cx, cz = l.cz;
        const tg = new THREE.Group();
        for (const [ox, oz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 12, 6), M.pole);
          leg.position.set(ox, 6, oz); tg.add(leg);
        }
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 6, 10), M.water);
        tank.position.y = 15; tank.scale.set(1, 1, 0.85); tank.rotation.z = 0.12; tg.add(tank);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(4.8, 2.5, 10), M.roof); cone.position.y = 19.2; cone.rotation.z = 0.12; tg.add(cone);
        const txt = document.createElement('canvas'); txt.width = 512; txt.height = 256;
        const g = txt.getContext('2d');
        g.fillStyle = 'rgba(230,230,220,0.9)'; g.font = 'bold 70px Arial'; g.textAlign = 'center';
        g.fillText('HOLLOW', 256, 100); g.fillText('CREEK', 256, 180);
        g.fillStyle = 'rgba(25,10,8,0.9)';
        g.beginPath(); g.ellipse(330, 150, 55, 70, 0.2, 0, 7); g.fill();
        for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(275 + i * 32, 60 - Math.abs(i - 1.5) * 10, 12, 50, -0.2 + i * 0.12, 0, 7); g.fill(); }
        const label = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(txt), transparent: true }));
        label.position.set(0, 15, 3.9); tg.add(label);
        tg.position.set(cx, 0, cz); tg.rotation.y = r() * Math.PI * 2;
        W.evGroup.add(tg);
        tg.updateMatrixWorld(true);
        tg.traverse(o => o.isMesh && W.evOccluders.push(o));
        [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]].forEach(([ox, oz]) => {
          const v = new THREE.Vector3(ox, 0, oz).applyEuler(tg.rotation).add(tg.position);
          evCol(v.x - 0.3, v.x + 0.3, v.z - 0.3, v.z + 0.3, 12);
        });
        const lp = new THREE.Vector3(0, 15, 3.9).applyEuler(tg.rotation).add(tg.position);
        W.evidence.push({ id: 'tower', name: 'Handprint on the water tower', pos: lp, maxDist: 34, found: false, margin: 2 });
      }
      // 7. the sheriff's tape — always in the sheriff's station
      W.fixedEvidence.forEach(e => { e.found = false; W.evidence.push(e); });
      if (shadows) W.evGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      W.syncOccluders();
    };
    flushDeco(DECO, W.root);
    W.placeEvidence();

    W.spawn = new THREE.Vector3(1.2, 0, -HALF + 6);
    W.playerCarPos = new THREE.Vector3(-3, 0, -HALF + 5);
    return W;
  }
})();
