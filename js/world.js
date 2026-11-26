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

  function build(scene, opts) {
    opts = opts || {};
    const S = LO.settings;
    const rand = mulberry(opts.seed !== undefined ? (opts.seed >>> 0) : 1337);
    const R = (a, b) => a + rand() * (b - a);
    const pick = arr => arr[(rand() * arr.length) | 0];
    const shadows = S.shadows !== 'off';
    const simple = S.lighting === 'simple';

    const W = {
      root: new THREE.Group(),
      colliders: [], occluders: [], baseOccluders: [], hideSpots: [], pickups: [], evidence: [],
      interiors: [], walkSurfaces: [], flickers: [], animated: [], STREETS, HALF,
      enterables: [], closedFronts: [], openLots: [], fixedEvidence: [],
      evColliders: [], evOccluders: [], buildings: [], flyingDebris: [],
      debrisGroup: new THREE.Group(),
      fenceDebrisGroup: new THREE.Group(),
      barricades: [],
      noisyObjects: [],
      trails: [],
      lookout: null,
      _gridVersion: 0,
    };
    W.root.add(W.debrisGroup);
    W.root.add(W.fenceDebrisGroup);
    scene.add(W.root);
    let curB = null;

    // global 2D footprint reservations so exterior props never spawn inside buildings, cars, lamps, dumpsters, or doorways
    const RESERVED = [];
    function reserveBox(minX, maxX, minZ, maxZ, tag) {
      RESERVED.push({ minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ), tag: tag || 'prop' });
    }
    function canPlaceBox(minX, maxX, minZ, maxZ, pad, ignoreTag) {
      pad = pad || 0;
      const x0 = Math.min(minX, maxX) - pad, x1 = Math.max(minX, maxX) + pad;
      const z0 = Math.min(minZ, maxZ) - pad, z1 = Math.max(minZ, maxZ) + pad;
      for (let i = 0; i < RESERVED.length; i++) {
        const r = RESERVED[i];
        if (ignoreTag && r.tag === ignoreTag) continue;
        if (x1 > r.minX && x0 < r.maxX && z1 > r.minZ && z0 < r.maxZ) return false;
      }
      return true;
    }
    function rotBoxExtents(x, z, w, d, ry) {
      const c = Math.abs(Math.cos(ry || 0)), s = Math.abs(Math.sin(ry || 0));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      return [x - hw, x + hw, z - hd, z + hd];
    }
    function nearIntersection(x, z, pad) {
      const reach = ST * 0.65 + (pad || 0);
      for (let i = 0; i < STREETS.length; i++) {
        if (Math.abs(x - STREETS[i]) < reach) {
          for (let j = 0; j < STREETS.length; j++) {
            if (Math.abs(z - STREETS[j]) < reach) return true;
          }
        }
      }
      return false;
    }
    reserveBox(-5.8, 3.6, -HALF + 0.5, -HALF + 9.5, 'spawn');

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
      bark: mat({ color: 0x3b2c20 }),
      leaves: mat({ color: 0x18251a }),
      pineBark: mat({ color: 0x433326, vertexColors: true }),
      pineLeaves: mat({ color: 0x203324, vertexColors: true }),
      birdFeather: mat({ color: 0x1d222b, roughness: 0.78, metalness: 0.08 }),
      birdBeak: mat({ color: 0x6b604e, roughness: 0.7 }),
      tire: mat({ color: 0x111111 }),
      cctv: new THREE.MeshBasicMaterial({ map: T('cctv', { size: 256 }) }),
      warning: mat({ map: T('warning') }),
      poster: mat({ map: T('poster', { size: 128 }) }),
      sign: mat({ map: T('sign', { size: 512 }) }),
      barricade: mat({ map: T('barricade', { size: 512 }), roughness: 0.72, metalness: 0.08 }),
      roadClosed: mat({ map: T('roadClosed', { size: 256 }), roughness: 0.68, metalness: 0.05 }),
      coneOrange: mat({ color: 0xd95516, roughness: 0.55, metalness: 0.05 }),
      coneReflect: mat({ color: 0xe6e4dc, roughness: 0.4, metalness: 0.1 }),
      amberBeacon: new THREE.MeshBasicMaterial({ color: 0xff9b28 }),
      water: mat({ map: T('metal', { color: '#5a6066' }), roughness: 0.5, metalness: 0.5 }),
      footprint: new THREE.MeshLambertMaterial({ map: T('footprint', { size: 256 }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      trail: mat({ map: T('trail') }),
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
    const COL_CELL = 16;
    const _colGrid = new Map();
    let _indexedCols = 0;
    let _colQSeq = 0;
    const _colQOut = [];
    function indexCollider(c) {
      const gx0 = Math.floor(c.minX / COL_CELL), gx1 = Math.floor(c.maxX / COL_CELL);
      const gz0 = Math.floor(c.minZ / COL_CELL), gz1 = Math.floor(c.maxZ / COL_CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const k = ((gx + 256) << 12) | (gz + 256);
          let bucket = _colGrid.get(k);
          if (!bucket) { bucket = []; _colGrid.set(k, bucket); }
          bucket.push(c);
        }
      }
    }
    W.queryColliders = function (x, z, r) {
      while (_indexedCols < W.colliders.length) indexCollider(W.colliders[_indexedCols++]);
      _colQOut.length = 0;
      _colQSeq++;
      const rad = r || 0;
      const gx0 = Math.floor((x - rad) / COL_CELL), gx1 = Math.floor((x + rad) / COL_CELL);
      const gz0 = Math.floor((z - rad) / COL_CELL), gz1 = Math.floor((z + rad) / COL_CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const bucket = _colGrid.get(((gx + 256) << 12) | (gz + 256));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const c = bucket[i];
            if (c._qSeq !== _colQSeq) {
              c._qSeq = _colQSeq;
              _colQOut.push(c);
            }
          }
        }
      }
      return _colQOut;
    };
    function walkSurface(surf) {
      surf.disabled = false;
      W.walkSurfaces.push(surf);
      if (curB) curB.walkSurfaces.push(surf);
      return surf;
    }
    // axis aligned box from world extents
    function boxAt(x0, x1, y0, y1, z0, z1, material, opts) {
      opts = opts || {};
      const w = x1 - x0, h = y1 - y0, d = z1 - z0;
      const g = worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, opts.tile || 4);
      const m = new THREE.Mesh(g, material);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(m, opts);
      if (opts.collide !== false) collider(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), y1, opts.minY !== undefined ? opts.minY : y0);
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
        collider(x - hw, x + hw, z - hd, z + hd, y + h / 2, opts.minY !== undefined ? opts.minY : Math.max(0, y - h / 2));
      }
      return m;
    }
    W.box = box;

    // Helper to merge homogeneous static BufferGeometries into a single draw call
    function batchGeos(geos) {
      let n = 0;
      for (let i = 0; i < geos.length; i++) n += geos[i].attributes.position.count;
      if (!n) return new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o = 0;
      for (let i = 0; i < geos.length; i++) {
        const raw = geos[i];
        const g = raw.index ? raw.toNonIndexed() : raw;
        const cnt = g.attributes.position.count;
        pos.set(g.attributes.position.array, o * 3);
        if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
        o += cnt;
        raw.dispose();
        if (g !== raw) g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.computeBoundingSphere();
      return out;
    }

    const _discardedGeos = new Set();
    const _mInv = new THREE.Matrix4();
    const _mRel = new THREE.Matrix4();
    const _bBox = new THREE.Box3();
    const _bCtr = new THREE.Vector3();
    function mergeSubtreeByMaterial(rootObj, opts) {
      opts = opts || {};
      const target = opts.target || rootObj;
      const occSet = opts.occSet || null;
      const outOccluders = opts.outOccluders || null;
      const skipSet = opts.skipSet || null;
      const cellSize = opts.cellSize || 0;
      const ignoreRootKeepDynamic = !!opts.ignoreRootKeepDynamic;

      target.updateWorldMatrix(true, false);
      rootObj.updateWorldMatrix(true, true);
      _mInv.copy(target.matrixWorld).invert();

      const meshes = [];
      function walk(obj, isRoot) {
        if (!obj) return;
        if (!isRoot) {
          if (skipSet && skipSet.has(obj)) return;
          if (obj.userData && (obj.userData.keepDynamic || obj.userData.noBatch)) return;
          if (obj.isLight || obj.isSprite || obj.isPoints || obj.isInstancedMesh) return;
        } else if (!ignoreRootKeepDynamic && obj.userData && (obj.userData.keepDynamic || obj.userData.noBatch)) {
          return;
        }
        if (obj.isMesh) {
          if (!obj.visible || !obj.geometry || !obj.geometry.attributes || !obj.geometry.attributes.position) return;
          meshes.push(obj);
          return;
        }
        const ch = obj.children;
        for (let i = 0; i < ch.length; i++) walk(ch[i], false);
      }
      walk(rootObj, true);

      const buckets = new Map();
      const tempGeos = [];
      const removedMeshes = new Set();

      const pushSlice = (mat, cast, recv, isOcc, cx, cz, posArr, norArr, uvArr, colArr, count) => {
        if (!mat || !count) return;
        let cellKey = '0';
        if (cellSize > 0) {
          cellKey = `${Math.floor(cx / cellSize)},${Math.floor(cz / cellSize)}`;
        }
        const key = `${cellKey}|${mat.uuid}|${cast ? 1 : 0}${recv ? 1 : 0}${isOcc ? 1 : 0}`;
        let b = buckets.get(key);
        if (!b) {
          b = { mat, cast, recv, isOcc, slices: [], totalVerts: 0 };
          buckets.set(key, b);
        }
        b.slices.push({ pos: posArr, nor: norArr, uv: uvArr, col: colArr, count });
        b.totalVerts += count;
      };

      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        _mRel.multiplyMatrices(_mInv, m.matrixWorld);
        if (_mRel.determinant() < 0) continue;

        const rawGeo = m.geometry;
        const ni = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
        ni.applyMatrix4(_mRel);
        tempGeos.push(ni);

        let cx = 0, cz = 0;
        if (cellSize > 0) {
          ni.computeBoundingBox();
          ni.boundingBox.getCenter(_bCtr);
          cx = _bCtr.x; cz = _bCtr.z;
        }

        const posA = ni.attributes.position && ni.attributes.position.array;
        if (!posA) continue;
        const norA = ni.attributes.normal ? ni.attributes.normal.array : null;
        const uvA = ni.attributes.uv ? ni.attributes.uv.array : null;
        const colA = ni.attributes.color ? ni.attributes.color.array : null;
        const total = ni.attributes.position.count;
        const cast = !!m.castShadow;
        const recv = !!m.receiveShadow;
        const isOcc = !!(occSet && occSet.has(m));

        if (Array.isArray(m.material) && ni.groups && ni.groups.length > 0) {
          for (let gi = 0; gi < ni.groups.length; gi++) {
            const grp = ni.groups[gi];
            const subMat = m.material[grp.materialIndex];
            if (!subMat || grp.count <= 0) continue;
            const s = grp.start, e = Math.min(total, grp.start + grp.count);
            const cnt = e - s;
            if (cnt <= 0) continue;
            pushSlice(
              subMat, cast, recv, isOcc, cx, cz,
              posA.subarray(s * 3, e * 3),
              norA ? norA.subarray(s * 3, e * 3) : null,
              uvA ? uvA.subarray(s * 2, e * 2) : null,
              colA ? colA.subarray(s * 3, e * 3) : null,
              cnt
            );
          }
        } else {
          const singleMat = Array.isArray(m.material) ? m.material[0] : m.material;
          pushSlice(singleMat, cast, recv, isOcc, cx, cz, posA, norA, uvA, colA, total);
        }

        if (m.parent) m.parent.remove(m);
        removedMeshes.add(m);
        _discardedGeos.add(rawGeo);
      }

      buckets.forEach(b => {
        const n = b.totalVerts;
        if (!n) return;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        const uv = new Float32Array(n * 2);
        const needCol = !!b.mat.vertexColors;
        const col = needCol ? new Float32Array(n * 3) : null;
        let o = 0;
        for (let si = 0; si < b.slices.length; si++) {
          const sl = b.slices[si];
          pos.set(sl.pos, o * 3);
          if (sl.nor) nor.set(sl.nor, o * 3);
          if (sl.uv) uv.set(sl.uv, o * 2);
          if (col) {
            if (sl.col) col.set(sl.col, o * 3);
            else col.fill(1, o * 3, (o + sl.count) * 3);
          }
          o += sl.count;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, b.mat);
        if (shadows) { mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; }
        target.add(mesh);
        if (b.isOcc && outOccluders) outOccluders.push(mesh);
      });

      for (let i = 0; i < tempGeos.length; i++) tempGeos[i].dispose();

      // Retain any unmerged (e.g. keepDynamic) occluders cleanly
      if (occSet && outOccluders) {
        occSet.forEach(m => {
          if (m && !removedMeshes.has(m)) outOccluders.push(m);
        });
      }

      // Prune empty non-dynamic static wrapper groups
      function pruneEmpty(obj, isRoot) {
        for (let i = obj.children.length - 1; i >= 0; i--) {
          const ch = obj.children[i];
          if (skipSet && skipSet.has(ch)) continue;
          if (ch.userData && (ch.userData.keepDynamic || ch.userData.noBatch)) continue;
          if (ch.isGroup) {
            pruneEmpty(ch, false);
            if (!isRoot && ch.children.length === 0) obj.remove(ch);
          }
        }
      }
      pruneEmpty(rootObj, true);
    }

    // =========================================================
    //  GROUND, STREETS, SKY
    // =========================================================
    const groundGeo = new THREE.PlaneGeometry(1400, 1400);
    groundGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 140; });
    const ground = new THREE.Mesh(groundGeo, M.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.userData.noBatch = true;
    add(ground, { cast: false });

    const streetLen = HALF * 2;
    const roadEWMat = M.road.clone();
    roadEWMat.map = M.road.map.clone();
    roadEWMat.map.rotation = Math.PI / 2;
    roadEWMat.map.needsUpdate = true;
    const nsGeos = [], ewGeos = [], interGeos = [], swGeos = [];
    const _tM = new THREE.Matrix4(), _tQ = new THREE.Quaternion(), _tE = new THREE.Euler(), _tP = new THREE.Vector3(), _tS = new THREE.Vector3(1, 1, 1);
    const bakePlane = (geo, x, y, z) => {
      const ni = geo.index ? geo.toNonIndexed() : geo;
      if (ni !== geo) geo.dispose();
      _tQ.setFromEuler(_tE.set(-Math.PI / 2, 0, 0));
      ni.applyMatrix4(_tM.compose(_tP.set(x, y, z), _tQ, _tS));
      return ni;
    };
    STREETS.forEach(s => {
      // N-S street
      let g = new THREE.PlaneGeometry(ST, streetLen);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v * streetLen / ST : v; });
      nsGeos.push(bakePlane(g, s, 0.02, 0));
      // E-W street (shared rotated texture & material)
      g = new THREE.PlaneGeometry(streetLen, ST);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v : v * streetLen / ST; });
      ewGeos.push(bakePlane(g, 0, 0.025, s));
    });
    // intersections: plain asphalt patches to hide line overlap
    STREETS.forEach(x => STREETS.forEach(z => {
      interGeos.push(bakePlane(new THREE.PlaneGeometry(ST, ST), x, 0.03, z));
    }));
    // road out of town to the south (opening drive)
    {
      const len = 520;
      const g = new THREE.PlaneGeometry(ST - 2, len);
      g.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v * len / ST : v; });
      nsGeos.push(bakePlane(g, 0, 0.02, -HALF - len / 2 + 1));
    }
    // sidewalks (block slabs merged into 1 draw call)
    BLOCK_C.forEach(bx => BLOCK_C.forEach(bz => {
      const g = worldUV(new THREE.BoxGeometry(BLOCK, 0.12, BLOCK), BLOCK, 0.12, BLOCK, 4);
      const ni = g.index ? g.toNonIndexed() : g;
      if (ni !== g) g.dispose();
      ni.translate(bx, 0.06, bz);
      swGeos.push(ni);
    }));
    const mNS = add(new THREE.Mesh(batchGeos(nsGeos), M.road), { cast: false }); mNS.userData.noBatch = true;
    const mEW = add(new THREE.Mesh(batchGeos(ewGeos), roadEWMat), { cast: false }); mEW.userData.noBatch = true;
    const mInt = add(new THREE.Mesh(batchGeos(interGeos), M.asphalt), { cast: false }); mInt.userData.noBatch = true;
    const mSW = add(new THREE.Mesh(batchGeos(swGeos), M.sidewalk), { cast: false }); mSW.userData.noBatch = true;

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
      const sm = S.quality === 'ultra' ? 2048 : 1024;
      W.moonLight.shadow.mapSize.set(sm, sm);
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
        red.userData.keepDynamic = true; blue.userData.keepDynamic = true;
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
      } else {
        // Merge standalone cutscene / evidence / parked cars internally by material (~35 -> ~9 draw calls)
        mergeSubtreeByMaterial(g, { target: g });
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
        head.userData.keepDynamic = true; light.userData.keepDynamic = true; glow.userData.keepDynamic = true;
        W.flickers.push({ light, head, glow, base: 1.4, mode: state, t: rand() * 10, on: true });
      }
    }

    // dumpster: a bin on wheels with a slightly propped hinged lid so you can peer through the rim gap
    function dumpster(x, z, ry, baseY) {
      baseY = baseY || 0;
      const g = new THREE.Group();
      g.userData.keepDynamic = true;
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.18, 1.3), M.dumpster); b.position.y = 0.79; g.add(b);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 1.38), M.dumpster); rim.position.y = 1.4; g.add(rim);
      // ribs and side bars
      [-0.75, 0, 0.75].forEach(rx => { const rb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.1, 0.04), M.dumpster); rb.position.set(rx, 0.8, 0.67); g.add(rb); });
      [-1, 1].forEach(sd => { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), M.pole); bar.position.set(sd * 1.16, 1.05, 0); g.add(bar); });
      // casters
      [[-0.95, -0.5], [0.95, -0.5], [-0.95, 0.5], [0.95, 0.5]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 6), M.tire); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.11, wz); g.add(w);
      });
      // the lid: hinged along the back edge, cracked slightly when hiding/propped
      const hinge = new THREE.Group(); hinge.position.set(0, 1.45, -0.66); hinge.userData.keepDynamic = true; g.add(hinge);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.06, 1.36), M.dark); lid.position.set(0, 0.03, 0.68); hinge.add(lid);
      const lidRidge = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.1), M.dark); lidRidge.position.set(0, 0.07, 1.25); hinge.add(lidRidge);
      hinge.rotation.x = -0.075;
      g.position.set(x, baseY, z); g.rotation.y = ry; add(g);
      mergeSubtreeByMaterial(hinge, { target: hinge, ignoreRootKeepDynamic: true });
      const dOccOut = [];
      mergeSubtreeByMaterial(g, { target: g, ignoreRootKeepDynamic: true, occSet: new Set([b]), outOccluders: dOccOut });
      dOccOut.forEach(addOccluder);
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      collider(x - (2.2 * c + 1.3 * s) / 2, x + (2.2 * c + 1.3 * s) / 2, z - (2.2 * s + 1.3 * c) / 2, z + (2.2 * s + 1.3 * c) / 2, baseY + 1.45, baseY);
      const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const spot = {
        type: 'dumpster', mesh: g, disabled: false, baseY,
        pos: new THREE.Vector3(x + front.x * 0.06, baseY + 1.47, z + front.z * 0.06), yaw: ry,
        interact: new THREE.Vector3(x, baseY + 1, z).addScaledVector(front, 1.3),
        exit: new THREE.Vector3(x, baseY, z).addScaledVector(front, 1.6),
        setOpen(a) { hinge.rotation.x = -0.075 - a * 1.45; },
      };
      W.hideSpots.push(spot);
      if (curB) curB.hideSpots.push(spot);
    }

    // locker: an open-fronted cabinet with a hinged door and real see-through eye-level louver slits
    function locker(x, z, ry, baseY) {
      baseY = baseY !== undefined ? baseY : 0.14;
      const g = new THREE.Group();
      g.userData.keepDynamic = true;
      const W2 = 0.9, H2 = 2.0, D2 = 0.68, t = 0.03;
      const part = (w, h, d, px, py, pz, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || M.locker); o.position.set(px, py, pz); g.add(o); return o; };
      const back = part(W2, H2, t, 0, H2 / 2, -D2 / 2 + t / 2);
      part(t, H2, D2, -W2 / 2 + t / 2, H2 / 2, 0); part(t, H2, D2, W2 / 2 - t / 2, H2 / 2, 0);
      part(W2, t, D2, 0, H2 - t / 2, 0); part(W2, t, D2, 0, t / 2, 0);
      part(W2 - 2 * t, 0.02, D2 - 0.06, 0, H2 - 0.16, -0.02);                         // upper shelf
      part(W2 - 2 * t, H2 - 2 * t, 0.01, 0, H2 / 2, -D2 / 2 + t + 0.006, M.dark);     // dark inside
      // the door, hinged on the left edge, framed around a real slotted eye-level vent cutout (y = 1.35..1.82)
      const hinge = new THREE.Group(); hinge.position.set(-W2 / 2, 0, D2 / 2); hinge.userData.keepDynamic = true; g.add(hinge);
      const dPart = (w, h, d, px, py, pz, m, rx) => {
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || M.locker);
        o.position.set(px, py, pz);
        if (rx) o.rotation.x = rx;
        hinge.add(o);
        return o;
      };
      const lowerDoor = dPart(W2, 1.34, 0.025, W2 / 2, 0.68, 0);         // y = 0.01..1.35
      dPart(W2, 0.17, 0.025, W2 / 2, 1.905, 0);                          // upper header y = 1.82..1.99
      dPart(0.14, 0.47, 0.025, 0.07, 1.585, 0);                          // left stile
      dPart(0.14, 0.47, 0.025, W2 - 0.07, 1.585, 0);                     // right stile
      // open eye-level horizontal metal louver slats with clear ~6.8cm sightline gaps
      for (let i = 0; i < 5; i++) {
        dPart(W2 - 0.28, 0.022, 0.028, W2 / 2, 1.40 + i * 0.09, 0.002, M.trim, 0.22);
      }
      // lower decorative vent slots
      for (let i = 0; i < 2; i++) {
        dPart(0.46, 0.025, 0.02, W2 / 2, 0.25 + i * 0.08, 0.015, M.dark);
      }
      dPart(0.04, 0.16, 0.04, W2 - 0.07, 1.05, 0.03, M.pole);
      g.position.set(x, baseY, z); g.rotation.y = ry; add(g);
      const hOccOut = [], lOccOut = [];
      mergeSubtreeByMaterial(hinge, { target: hinge, ignoreRootKeepDynamic: true, occSet: new Set([lowerDoor]), outOccluders: hOccOut });
      mergeSubtreeByMaterial(g, { target: g, ignoreRootKeepDynamic: true, occSet: new Set([back]), outOccluders: lOccOut });
      lOccOut.forEach(addOccluder); hOccOut.forEach(addOccluder);
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      collider(x - (W2 * c + D2 * s) / 2, x + (W2 * c + D2 * s) / 2, z - (W2 * s + D2 * c) / 2, z + (W2 * s + D2 * c) / 2, baseY + 2.1, baseY);
      const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const spot = {
        type: 'locker', mesh: g, disabled: false, baseY,
        pos: new THREE.Vector3(x - front.x * 0.10, baseY + 1.53, z - front.z * 0.10), yaw: ry,
        interact: new THREE.Vector3(x, baseY + 1, z).addScaledVector(front, 0.9),
        exit: new THREE.Vector3(x, baseY, z).addScaledVector(front, 1.1),
        setOpen(a) { hinge.rotation.y = -a * 1.85; },
      };
      W.hideSpots.push(spot);
      if (curB) curB.hideSpots.push(spot);
    }

    const batteryMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    function battery(x, y, z) {
      const g = new THREE.Group();
      g.userData.keepDynamic = true;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 6), mat({ color: 0x222222 }));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.08, 6), batteryMat);
      cap.position.y = 0.09; g.add(body, cap);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,120,0.45)'), depthWrite: false, transparent: true }));
      glow.scale.set(0.9, 0.9, 1); g.add(glow);
      g.position.set(x, y, z); W.root.add(g);
      W.pickups.push({ type: 'battery', mesh: g, pos: g.position, baseY: y, taken: false });
    }

    // remodeled multi-tier pine & gnarled dead tree geometries (shared across park & forest instances)
    function mergeTreeParts(parts) {
      const nonIdx = parts.map(p => {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        if (p.geo.index) p.geo.dispose();
        const pos = g.attributes.position;
        const cnt = pos.count;
        const col = new Float32Array(cnt * 3);
        const yMin = p.yMin, ySpan = Math.max(0.01, p.yMax - p.yMin);
        for (let i = 0; i < cnt; i++) {
          const py = pos.getY(i);
          const k = Math.max(0, Math.min(1, (py - yMin) / ySpan));
          col[i * 3]     = p.c0[0] + (p.c1[0] - p.c0[0]) * k;
          col[i * 3 + 1] = p.c0[1] + (p.c1[1] - p.c0[1]) * k;
          col[i * 3 + 2] = p.c0[2] + (p.c1[2] - p.c0[2]) * k;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
      });
      let n = 0; nonIdx.forEach(g => { n += g.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      let o = 0;
      nonIdx.forEach(g => {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
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
    }

    const pineTrunkGeo = (() => {
      const parts = [];
      const addG = (geo, c0, c1, yMin, yMax) => parts.push({ geo, c0, c1, yMin, yMax });
      // root flare + tapered trunk + lower dead branch snags
      const flare = new THREE.CylinderGeometry(0.28, 0.50, 1.15, 6); flare.translate(0, 0.56, 0);
      addG(flare, [0.42, 0.36, 0.31], [0.68, 0.60, 0.52], 0, 1.15);
      const main = new THREE.CylinderGeometry(0.07, 0.30, 8.8, 6); main.translate(0, 4.4, 0);
      addG(main, [0.62, 0.56, 0.48], [0.48, 0.42, 0.38], 0, 8.8);
      [[1.9, 0.4, 0.9], [2.45, 2.5, -0.85], [3.05, 4.4, 0.78]].forEach(([by, rotY, tilt], i) => {
        const sn = new THREE.CylinderGeometry(0.02, 0.055, 0.95 - i * 0.1, 4);
        sn.translate(0, 0.45, 0);
        sn.rotateZ(tilt);
        sn.rotateY(rotY);
        sn.translate(0, by, 0);
        addG(sn, [0.55, 0.48, 0.40], [0.40, 0.35, 0.30], by - 0.2, by + 0.9);
      });
      return mergeTreeParts(parts);
    })();

    const pineCrownGeo = (() => {
      const parts = [];
      // 5 tiered bough skirts + pointed spire cap (darker shaded interior/bottom, misty pine needles outer/upper)
      const tiers = [
        { y: 3.35, rTop: 0.72, rBot: 2.55, h: 2.35, ry: 0.25, tilt: 0.03 },
        { y: 4.85, rTop: 0.62, rBot: 2.18, h: 2.15, ry: 1.45, tilt: -0.025 },
        { y: 6.25, rTop: 0.48, rBot: 1.78, h: 1.95, ry: 2.80, tilt: 0.02 },
        { y: 7.55, rTop: 0.34, rBot: 1.38, h: 1.75, ry: 0.85, tilt: -0.02 },
        { y: 8.75, rTop: 0.04, rBot: 0.96, h: 1.75, ry: 2.10, tilt: 0.015 },
      ];
      tiers.forEach(t => {
        const c = new THREE.CylinderGeometry(t.rTop, t.rBot, t.h, 7, 1, false);
        c.rotateY(t.ry);
        c.rotateZ(t.tilt);
        c.translate(0, t.y, 0);
        parts.push({ geo: c, c0: [0.46, 0.54, 0.48], c1: [0.95, 1.05, 0.92], yMin: t.y - t.h * 0.5, yMax: t.y + t.h * 0.5 });
      });
      return mergeTreeParts(parts);
    })();

    const deadTreeGeo = (() => {
      const parts = [];
      const addSeg = (rT, rB, len, x, y, z, rx, ry, rz) => {
        const g = new THREE.CylinderGeometry(rT, rB, len, 5);
        g.translate(0, len * 0.5, 0);
        g.rotateX(rx || 0); g.rotateZ(rz || 0); g.rotateY(ry || 0);
        g.translate(x, y, z);
        parts.push({ geo: g, c0: [0.46, 0.41, 0.36], c1: [0.70, 0.64, 0.56], yMin: 0, yMax: 6.5 });
      };
      // root flare + crooked trunk + gnarled primary & secondary branches
      addSeg(0.28, 0.48, 1.0, 0, 0, 0, 0, 0, 0);
      addSeg(0.16, 0.28, 2.7, 0, 0.9, 0, 0.05, 0.3, -0.08);
      addSeg(0.09, 0.16, 2.3, 0.18, 3.45, 0.1, -0.1, 0.8, 0.22);
      addSeg(0.05, 0.12, 1.85, 0.14, 3.25, 0.08, 0.25, 0.5, -0.78);
      addSeg(0.04, 0.10, 1.65, -0.1, 2.85, -0.05, -0.2, 2.4, 0.85);
      addSeg(0.03, 0.07, 1.35, 0.05, 4.3, 0.15, 0.35, 4.1, -0.65);
      addSeg(0.025, 0.055, 1.15, -0.22, 4.6, -0.08, -0.25, 1.4, 0.72);
      return mergeTreeParts(parts);
    })();

    function tree(x, z, s, dead) {
      const ry = R(0, Math.PI * 2);
      if (!dead) {
        const g = new THREE.Group();
        const tr = new THREE.Mesh(pineTrunkGeo, M.pineBark);
        const cr = new THREE.Mesh(pineCrownGeo, M.pineLeaves);
        g.add(tr, cr);
        g.scale.set(s, s * R(0.92, 1.14), s);
        g.rotation.y = ry;
        g.position.set(x, 0, z);
        add(g);
      } else {
        const dm = new THREE.Mesh(deadTreeGeo, M.pineBark);
        dm.scale.set(s, s * R(0.9, 1.15), s);
        dm.rotation.y = ry;
        dm.position.set(x, 0, z);
        add(dm);
      }
      collider(x - 0.32 * s, x + 0.32 * s, z - 0.32 * s, z + 0.32 * s, 6);
    }

    function rubblePile(x, z, r, n, parent) {
      for (let i = 0; i < n; i++) {
        const s = R(0.4, 1.45);
        const h = s * R(0.35, 0.85);
        const m = box(s * R(0.8, 1.9), h, s * R(0.8, 1.5), rand() < 0.6 ? M.rubble : M.brick,
          x + R(-r, r), h * 0.42, z + R(-r, r), { ry: R(0, 3), rx: R(-0.14, 0.14), rz: R(-0.14, 0.14), parent, cast: false });
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

    // Barricade cluster: overturned table, tipped chairs, fallen shelf, crates, and leaning painting blocking a doorway or staircase
    function buildBarricadeCluster(F, ca, cb, baseY, yawFacing, spanW) {
      const p = F.point(ca, cb);
      const g = new THREE.Group();
      const M2 = (w, h, d, m, lx, ly, lz, rx, ry, rz) => {
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        o.position.set(lx, ly, lz);
        o.rotation.set(rx || 0, ry || 0, rz || 0);
        g.add(o);
      };
      // upended heavy wooden table turned across the gap
      const tw = Math.min(spanW * 0.85, 1.65);
      M2(tw, 0.82, 0.08, M.wood, 0, 0.44, 0, 0.22, 0.08, -0.05);
      [-tw * 0.42, tw * 0.42].forEach(lx => [-0.32, 0.32].forEach(ly => {
        M2(0.08, 0.08, 0.65, M.wood, lx, 0.42 + ly, -0.30, 0.18, 0, 0);
      }));
      // overturned chairs stacked/wedged against the table (complete with 4 legs)
      const chMat = pick(FABRICS);
      const addTippedChair = (seatMat, w, backH, px, py, pz, rx, ry, rz) => {
        const cg = new THREE.Group();
        const addP = (pw, ph, pd, matC, lx, ly, lz) => {
          const o = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), matC);
          o.position.set(lx, ly, lz);
          cg.add(o);
        };
        addP(w, 0.06, w, seatMat, 0, 0, 0);
        addP(w, backH, 0.06, seatMat, 0, backH * 0.5, -w * 0.5 + 0.03);
        const legOff = w * 0.40;
        [[-legOff, -legOff], [legOff, -legOff], [-legOff, legOff], [legOff, legOff]].forEach(([lx, lz]) => {
          addP(0.046, 0.40, 0.046, M.wood, lx, -0.21, lz);
        });
        cg.position.set(px, py, pz);
        cg.rotation.set(rx, ry, rz);
        g.add(cg);
      };
      addTippedChair(chMat, 0.46, 0.52, -tw * 0.28, 0.78, 0.18, 0.85, 0.4, 0.55);
      addTippedChair(M.wood, 0.44, 0.48, tw * 0.26, 0.42, -0.25, -0.65, -0.5, 0.4);
      // wooden crate & fallen shelf plank wedged at an angle
      M2(0.58, 0.52, 0.55, M.wood, tw * 0.22, 0.26, 0.16, 0, 0.28, 0);
      M2(0.18, 1.35, 0.42, M.wood, -tw * 0.36, 0.70, -0.08, 0.12, -0.3, 0.48);
      // crooked framed painting leaned against the pile
      M2(0.74, 0.58, 0.04, M.wood, 0.08, 0.34, 0.28, -0.38, 0.18, 0.22);
      M2(0.62, 0.46, 0.05, pick(PAINTINGS), 0.08, 0.34, 0.28, -0.38, 0.18, 0.22);

      g.position.set(p.x, baseY, p.z);
      g.rotation.y = yawFacing;
      g.updateMatrixWorld(true);
      const map = decoMap();
      g.traverse(o => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (!map.has(o.material)) map.set(o.material, []);
        map.get(o.material).push(geo.index ? geo.toNonIndexed() : geo);
        o.geometry.dispose();
      });
      const halfA = spanW * 0.5, halfB = 0.55;
      const [x0, x1, z0, z1] = F.rect(ca - halfA, ca + halfA, cb - halfB, cb + halfB);
      collider(x0, x1, z0, z1, baseY + 2.2, baseY);
    }

    // Preset queue for rich enterable buildings (4x 1-floor, 4x 2-floor, 2x distinct rooftop-access = 10 presets + unique Sheriff HQ)
    const ENTER_PRESETS = [
      // 1. One-floor Ranch House
      {
        id: 'house_1f_ranch', kind: 'house', floors: 1, roofAccess: false, L: 14, D: 14, H: 4.6,
        build(ctx) {
          const { F, hl, hd, t, addCrossWall, addSideWall, placeFurn, placeLocker, placeCoffeeTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const pb = 0.6;
          addCrossWall(pb, -hl + t, 0.6, 0, 3.5, -3.2, 1.55);
          addSideWall(0.6, -hd + t, pb - 0.1, 0, 3.5, null);
          const rightDoorA = 3.5;
          addCrossWall(pb, 0.7, hl - t, 0, 3.5, rightDoorA, 1.45);
          // Front living area
          placeFurn('couch', -hl + t, 3.6, 1, 0, 2.0, 0.14);
          placeCoffeeTable(-4.6, 3.6, 0, 0.14);
          placeRug(-3.5, 3.6, 2.4, 3.0, 0.14);
          placeFurn('bookshelf', hl - t, 3.2, -1, 0, 1.8, 0.14);
          placePainting(-hl + t + 0.03, 1.8, 1, 0, 0.14);
          placePainting(hl - t - 0.03, 5.2, -1, 0, 0.14);
          placeLamp(-2.5, 3.6, 3.5);
          placeLamp(3.5, 3.6, 3.5);
          // Back-west bedroom
          placeFurn('bed', -3.0, -hd + t, 0, 1, 2.1, 0.14);
          placeFurn('dresser', -hl + t, -3.2, 1, 0, 1.3, 0.14);
          placeRug(-3.0, -3.0, 2.2, 2.4, 0.14);
          placePainting(-hl + t + 0.03, -5.0, 1, 0, 0.14);
          placeLamp(-3.0, -3.0, 3.5);
          // Back-east study (optionally barricaded if non-evidence)
          placeFurn('desk', hl - t, -2.5, -1, 0, 1.8, 0.14);
          placeLocker(1.55, -hd + t + 0.38, 0, 1, 0.14);
          placeLamp(3.6, -3.0, 3.5);
          if (R() < 0.28 && !ctx.sheriff) {
            addBarricade(rightDoorA, pb, 0.14, 0, 1, 1.45);
          } else {
            addSafeDesk(4.0, -hd + t + 0.9, 0, 1, 0.14);
          }
          addSafeWall(-3.6, hd - t - 0.04, 0, -1, 0.14);
          addSafeWall(3.8, hd - t - 0.04, 0, -1, 0.14);
          if (R() < 0.45) placeBattery(-4.2, -1.6, 0.14);
        },
      },
      // 2. One-floor Split Parlor Residence
      {
        id: 'house_1f_parlor', kind: 'house', floors: 1, roofAccess: false, L: 14, D: 14, H: 4.8,
        build(ctx) {
          const { hl, hd, t, addSideWall, placeFurn, placeLocker, placeDiningTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          addSideWall(-2.2, -hd + t, hd - t - 1.6, 0, 3.5, 2.4, 1.55);
          addSideWall(2.2, -hd + t, hd - t - 1.6, 0, 3.5, -2.2, 1.55);
          // Center hall
          placeRug(0, 0.5, 2.2, 5.0, 0.14);
          placeLocker(-0.7, -hd + t + 0.38, 0, 1, 0.14);
          placePainting(-2.08, -0.5, 1, 0, 0.14);
          placePainting(2.08, -0.5, -1, 0, 0.14);
          placeLamp(0, 2.2, 3.5);
          placeLamp(0, -2.8, 3.5);
          addSafeWall(-4.4, -hd + t + 0.04, 0, 1, 0.14);
          // West wing (living & bedroom)
          placeFurn('couch', -hl + t, 3.2, 1, 0, 1.9, 0.14);
          placeFurn('bookshelf', -hl + t, -0.2, 1, 0, 1.6, 0.14);
          placeFurn('bed', -hl + t, -4.0, 1, 0, 2.1, 0.14);
          placeRug(-4.4, -1.2, 2.0, 3.2, 0.14);
          placeLamp(-4.4, -0.5, 3.5);
          // East wing (study & dining)
          placeDiningTable(4.4, 3.0, 0.14);
          placeFurn('desk', hl - t, -2.2, -1, 0, 1.8, 0.14);
          placeFurn('dresser', hl - t, -5.0, -1, 0, 1.3, 0.14);
          placePainting(hl - t - 0.03, 3.4, -1, 0, 0.14);
          placeLamp(4.4, 0.0, 3.5);
          if (R() < 0.28 && !ctx.sheriff) {
            addBarricade(2.2, -2.2, 0.14, -1, 0, 1.55);
          } else {
            addSafeDesk(4.2, -hd + t + 0.9, 0, 1, 0.14);
            addSafeWall(hl - t - 0.04, 1.2, -1, 0, 0.14);
          }
          if (R() < 0.45) placeBattery(-4.2, 3.2, 0.56);
        },
      },
      // 3. One-floor Corner General Store
      {
        id: 'shop_1f_corner', kind: 'shop', floors: 1, roofAccess: false, L: 15, D: 14, H: 4.9, awning: true,
        build(ctx) {
          const { hl, hd, t, addCrossWall, placeFurn, placeLocker, placeCrates, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addMapWall, addBarricade, R } = ctx;
          const pb = -2.4;
          const backDoorA = 3.2;
          addCrossWall(pb, -hl + t, hl - t, 0, 3.5, backDoorA, 1.6);
          // Front shop floor
          placeFurn('counter', -hl + t, 3.4, 1, 0, 2.4, 0.14);
          placeFurn('aisle', -1.8, 1.0, 1, 0, 2.6, 0.14);
          placeFurn('aisle', 1.8, 1.0, 1, 0, 2.6, 0.14);
          placeFurn('shopShelf', hl - t, 3.2, -1, 0, 2.2, 0.14);
          placeFurn('shopShelf', hl - t, 0.0, -1, 0, 2.2, 0.14);
          placeFurn('shopShelf', -hl + t, 0.2, 1, 0, 2.0, 0.14);
          placeRug(-4.6, 3.4, 1.8, 2.8, 0.14);
          placeLamp(-3.2, 2.2, 3.5);
          placeLamp(3.2, 2.2, 3.5);
          // Back stockroom
          placeFurn('shopShelf', -hl + t, -4.6, 1, 0, 2.0, 0.14);
          placeCrates(-4.8, -5.0, 0.14);
          placeLocker(-1.2, -hd + t + 0.38, 0, 1, 0.14);
          placeLocker(0.2, -hd + t + 0.38, 0, 1, 0.14);
          placePainting(-3.6, hd - t - 0.03, 0, -1, 0.14);
          placeLamp(0, -4.6, 3.5);
          addSafeWall(-3.2, pb + 0.12, 0, 1, 0.14);
          addMapWall(hl - t - 0.04, 5.45, -1, 0, 0.14, 'shelf');
          if (R() < 0.25 && !ctx.sheriff && !ctx.isSpawnLeft) {
            addBarricade(backDoorA, pb, 0.14, 0, 1, 1.6);
          } else {
            addMapWall(3.2, hd - t - 0.04, 0, -1, 0.14, 'current');
            addMapWall(-2.75, -hd + t + 0.04, 0, 1, 0.14, 'locker');
            addSafeDesk(4.4, -hd + t + 0.9, 0, 1, 0.14);
            addSafeWall(hl - t - 0.04, -4.5, -1, 0, 0.14);
          }
          if (R() < 0.5) placeBattery(-5.0, -3.8, 0.72);
        },
      },
      // 4. One-floor Records & Municipal Office
      {
        id: 'office_1f_records', kind: 'office', floors: 1, roofAccess: false, L: 14, D: 15, H: 4.9, awning: true,
        build(ctx) {
          const { hl, hd, t, addCrossWall, addSideWall, placeFurn, placeLocker, placeCoffeeTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const pb = 0.8;
          addCrossWall(pb, -hl + t, hl - t, 0, 3.5, -2.6, 1.65);
          addSideWall(0, -hd + t, pb - 0.1, 0, 3.5, -3.0, 1.45);
          // Reception lobby
          placeFurn('counter', -hl + t, 3.8, 1, 0, 2.2, 0.14);
          placeFurn('couch', hl - t, 3.8, -1, 0, 2.0, 0.14);
          placeCoffeeTable(4.4, 3.8, 0, 0.14);
          placeRug(0, 4.0, 2.8, 2.8, 0.14);
          placePainting(hl - t - 0.03, 3.8, -1, 0, 0.14);
          placeLamp(0, 3.8, 3.5);
          // West archive room
          placeFurn('bookshelf', -hl + t, -1.6, 1, 0, 2.0, 0.14);
          placeFurn('bookshelf', -hl + t, -4.6, 1, 0, 2.0, 0.14);
          placeFurn('desk', -1.8, -hd + t, 0, 1, 1.7, 0.14);
          placeLocker(-4.5, -hd + t + 0.38, 0, 1, 0.14);
          placeLamp(-3.4, -3.2, 3.5);
          addSafeWall(2.4, pb + 0.12, 0, 1, 0.14);
          // East manager office
          placeFurn('desk', hl - t, -3.2, -1, 0, 1.9, 0.14);
          placeFurn('dresser', hl - t, -5.8, -1, 0, 1.3, 0.14);
          placeRug(3.4, -3.2, 2.2, 2.6, 0.14);
          placePainting(hl - t - 0.03, -3.2, -1, 0, 0.14);
          placeLamp(3.4, -3.2, 3.5);
          if (R() < 0.25 && !ctx.sheriff) {
            addBarricade(0, -3.0, 0.14, 1, 0, 1.45);
          } else {
            addSafeDesk(3.2, -hd + t + 0.9, 0, 1, 0.14);
          }
          if (R() < 0.45) placeBattery(4.2, -5.6, 0.95);
        },
      },
      // 5. Two-floor Colonial House (East Staircase)
      {
        id: 'house_2f_colonial', kind: 'house', floors: 2, roofAccess: false, L: 14, D: 14, H: 8.2,
        build(ctx) {
          const { hl, hd, t, floor2Y, ceil1, ceil2, addStair1to2, addF2SlabsAndRails, addCrossWall, addSideWall, placeFurn, placeLocker, placeCoffeeTable, placeDiningTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const stA0 = hl - t - 1.95, stA1 = hl - t - 0.04;
          addStair1to2(stA0, stA1, 3.55, -1.55, 1);
          addF2SlabsAndRails(stA0, stA1, 3.55, -1.55, 1);
          // Floor 1 layout
          const pb1 = 0.2;
          addCrossWall(pb1, -hl + t, stA0 - 0.16, 0, ceil1, -2.5, 1.6);
          placeFurn('couch', -hl + t, 3.4, 1, 0, 2.0, 0.14);
          placeCoffeeTable(-4.5, 3.4, 0, 0.14);
          placeRug(-3.2, 3.4, 2.4, 2.8, 0.14);
          placeFurn('bookshelf', stA0 - 0.17, 2.2, -1, 0, 1.6, 0.14);
          placePainting(-hl + t + 0.03, 1.5, 1, 0, 0.14);
          placeLamp(-1.5, 3.4, ceil1);
          // Floor 1 back room
          placeDiningTable(-3.8, -3.4, 0.14);
          placeFurn('dresser', -hl + t, -3.4, 1, 0, 1.3, 0.14);
          placeLocker(0.6, -hd + t + 0.38, 0, 1, 0.14);
          placeLamp(-1.2, -3.4, ceil1);
          addSafeWall(-1.8, -hd + t + 0.04, 0, 1, 0.14);
          addSafeDesk(3.1, -hd + t + 0.9, 0, 1, 0.14);
          // Floor 2 layout
          const pb2 = -0.2;
          const f2End = stA0 - 0.05;
          addCrossWall(pb2, -hl + t, f2End, floor2Y, ceil2, -2.4, 1.5);
          addSideWall(-0.2, pb2 + 0.1, hd - t, floor2Y, ceil2, 3.2, 1.45);
          // F2 Front-west master bedroom
          placeFurn('bed', -hl + t, 3.4, 1, 0, 2.1, floor2Y);
          placeFurn('dresser', -4.4, pb2 + 0.1, 0, 1, 1.2, floor2Y);
          placeRug(-3.5, 3.6, 2.2, 2.6, floor2Y);
          placePainting(-hl + t + 0.03, 1.2, 1, 0, floor2Y);
          placeLamp(-3.4, 3.4, ceil2);
          // F2 Front-east sitting room
          placeFurn('couch', 2.0, hd - t, 0, -1, 1.8, floor2Y);
          placeLamp(2.0, 3.4, ceil2);
          // F2 Back study
          placeFurn('desk', -hl + t, -3.2, 1, 0, 1.8, floor2Y);
          placeFurn('bookshelf', 1.8, -hd + t, 0, 1, 1.8, floor2Y);
          placeLocker(-1.8, -hd + t + 0.38, 0, 1, floor2Y);
          placeRug(-1.5, -3.4, 2.6, 2.4, floor2Y);
          placeLamp(-1.2, -3.4, ceil2);
          if (R() < 0.25 && !ctx.sheriff) {
            addBarricade(-0.2, 3.2, floor2Y, 1, 0, 1.45);
          } else {
            addSafeDesk(1.8, -3.6, 0, 1, floor2Y);
          }
          if (R() < 0.5) placeBattery(-2.8, -3.4, floor2Y + 0.5);
        },
      },
      // 6. Two-floor Shop + Upstairs Apartment (West Staircase)
      {
        id: 'shop_2f_apartment', kind: 'shop', floors: 2, roofAccess: false, L: 15, D: 14, H: 8.5, awning: true,
        build(ctx) {
          const { hl, hd, t, floor2Y, ceil1, ceil2, addStair1to2, addF2SlabsAndRails, addCrossWall, placeFurn, placeLocker, placeCoffeeTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addMapWall, addBarricade, R } = ctx;
          const stA0 = -hl + t + 0.04, stA1 = -hl + t + 1.99;
          addStair1to2(stA0, stA1, 3.55, -1.55, -1);
          addF2SlabsAndRails(stA0, stA1, 3.55, -1.55, -1);
          // Floor 1 Shop floor
          const pb1 = -1.45;
          addCrossWall(pb1, stA1 + 0.16, hl - t, 0, ceil1, 2.8, 1.55);
          placeFurn('counter', hl - t, 3.4, -1, 0, 2.2, 0.14);
          placeFurn('aisle', 0.2, 1.2, 1, 0, 2.6, 0.14);
          placeFurn('shopShelf', hl - t, 0.2, -1, 0, 2.0, 0.14);
          placeFurn('shopShelf', stA1 + 0.17, 1.6, 1, 0, 2.2, 0.14);
          placeRug(4.6, 3.4, 1.8, 2.6, 0.14);
          placeLamp(1.5, 2.0, ceil1);
          // F1 back storeroom
          placeFurn('shopShelf', -1.8, -hd + t, 0, 1, 2.0, 0.14);
          placeLocker(-3.8, -hd + t + 0.38, 0, 1, 0.14);
          placeLamp(1.5, -4.4, ceil1);
          addSafeWall(hl - t - 0.04, -4.4, -1, 0, 0.14);
          addMapWall(3.4, hd - t - 0.04, 0, -1, 0.14, 'current');
          addMapWall(-5.45, -hd + t + 0.04, 0, 1, 0.14, 'locker');
          addMapWall(0.45, -hd + t + 0.04, 0, 1, 0.14, 'shelf');
          addSafeDesk(2.2, -hd + t + 0.9, 0, 1, 0.14);
          // Floor 2 Apartment loft
          const pb2 = -0.2;
          addCrossWall(pb2, stA1 + 0.05, hl - t, floor2Y, ceil2, 1.5, 1.5);
          placeFurn('couch', hl - t, 3.4, -1, 0, 2.0, floor2Y);
          placeCoffeeTable(4.8, 3.4, 0, floor2Y);
          placeFurn('bookshelf', -0.5, hd - t, 0, -1, 1.8, floor2Y);
          placeRug(2.5, 3.4, 2.6, 2.6, floor2Y);
          placePainting(hl - t - 0.03, 1.6, -1, 0, floor2Y);
          placeLamp(2.0, 3.4, ceil2);
          // F2 back bedroom
          placeFurn('bed', hl - t, -3.4, -1, 0, 2.1, floor2Y);
          placeFurn('desk', -2.6, -hd + t, 0, 1, 1.7, floor2Y);
          placeLocker(0.4, -hd + t + 0.38, 0, 1, floor2Y);
          placePainting(2.2, -hd + t + 0.03, 0, 1, floor2Y);
          placeLamp(2.0, -3.4, ceil2);
          if (R() < 0.25 && !ctx.sheriff) {
            addBarricade(1.5, pb2, floor2Y, 0, 1, 1.5);
          } else {
            addSafeDesk(3.2, -3.6, 0, 1, floor2Y);
          }
          if (R() < 0.5) placeBattery(4.8, 3.4, floor2Y + 0.64);
        },
      },
      // 7. Two-floor Municipal Office (East Staircase)
      {
        id: 'office_2f_archive', kind: 'office', floors: 2, roofAccess: false, L: 14, D: 15, H: 8.8, awning: true,
        build(ctx) {
          const { hl, hd, t, floor2Y, ceil1, ceil2, addStair1to2, addF2SlabsAndRails, addCrossWall, addSideWall, placeFurn, placeLocker, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const stA0 = hl - t - 1.95, stA1 = hl - t - 0.04;
          addStair1to2(stA0, stA1, 3.55, -1.55, 1);
          addF2SlabsAndRails(stA0, stA1, 3.55, -1.55, 1);
          // Floor 1
          const pb1 = 0.6;
          addCrossWall(pb1, -hl + t, stA0 - 0.16, 0, ceil1, -1.5, 1.6);
          placeFurn('counter', -hl + t, 4.0, 1, 0, 2.2, 0.14);
          placeFurn('couch', 2.4, hd - t, 0, -1, 1.8, 0.14);
          placeFurn('bookshelf', stA0 - 0.17, 2.1, -1, 0, 1.5, 0.14);
          placeRug(-1.4, 4.0, 2.4, 2.8, 0.14);
          placeLamp(-1.4, 4.0, ceil1);
          // F1 back office
          placeFurn('desk', -hl + t, -2.4, 1, 0, 1.8, 0.14);
          placeFurn('bookshelf', -hl + t, -5.2, 1, 0, 1.8, 0.14);
          placeLocker(0.6, -hd + t + 0.38, 0, 1, 0.14);
          placePainting(-hl + t + 0.03, -3.5, 1, 0, 0.14);
          placeLamp(-1.4, -3.4, ceil1);
          addSafeWall(-2.0, -hd + t + 0.04, 0, 1, 0.14);
          addSafeDesk(3.0, -hd + t + 0.9, 0, 1, 0.14);
          // Floor 2
          const pb2 = 0.0;
          addCrossWall(pb2, -hl + t, stA0 - 0.05, floor2Y, ceil2, -2.6, 1.5);
          addSideWall(-0.2, -hd + t, pb2 - 0.1, floor2Y, ceil2, -3.6, 1.45);
          placeFurn('desk', -hl + t, 3.6, 1, 0, 1.8, floor2Y);
          placeFurn('bookshelf', 1.6, hd - t, 0, -1, 1.8, floor2Y);
          placeRug(-1.4, 3.6, 2.6, 2.6, floor2Y);
          placeLamp(-1.4, 3.6, ceil2);
          // F2 back rooms
          placeFurn('bookshelf', -hl + t, -3.6, 1, 0, 2.0, floor2Y);
          placeFurn('desk', 2.0, -hd + t, 0, 1, 1.7, floor2Y);
          placeLocker(-3.5, -hd + t + 0.38, 0, 1, floor2Y);
          placePainting(hl - t - 0.03, -4.0, -1, 0, floor2Y);
          placeLamp(-1.4, -3.6, ceil2);
          if (R() < 0.25 && !ctx.sheriff) {
            addBarricade(-0.2, -3.6, floor2Y, 1, 0, 1.45);
          } else {
            addSafeDesk(-3.2, -3.6, 0, 1, floor2Y);
          }
          if (R() < 0.45) placeBattery(1.6, 4.0, floor2Y + 0.45);
        },
      },
      // 8. Two-floor Townhouse (West Staircase, deep parlor + library)
      {
        id: 'house_2f_townhouse', kind: 'house', floors: 2, roofAccess: false, L: 14, D: 14, H: 8.6,
        build(ctx) {
          const { hl, hd, t, floor2Y, ceil1, ceil2, addStair1to2, addF2SlabsAndRails, addCrossWall, placeFurn, placeLocker, placeDiningTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const stA0 = -hl + t + 0.04, stA1 = -hl + t + 1.99;
          addStair1to2(stA0, stA1, 3.55, -1.55, -1);
          addF2SlabsAndRails(stA0, stA1, 3.55, -1.55, -1);
          // Floor 1
          const pb1 = -0.6;
          addCrossWall(pb1, stA1 + 0.16, hl - t, 0, ceil1, 2.8, 1.55);
          placeFurn('couch', hl - t, 3.2, -1, 0, 2.0, 0.14);
          placeFurn('bookshelf', stA1 + 0.17, 2.4, 1, 0, 1.8, 0.14);
          placeRug(1.8, 3.0, 2.6, 2.8, 0.14);
          placePainting(hl - t - 0.03, 1.0, -1, 0, 0.14);
          placeLamp(1.5, 3.0, ceil1);
          // F1 rear dining/den
          placeDiningTable(2.0, -3.6, 0.14);
          placeFurn('dresser', hl - t, -3.8, -1, 0, 1.3, 0.14);
          placeLocker(-2.4, -hd + t + 0.38, 0, 1, 0.14);
          placeLamp(1.5, -3.6, ceil1);
          addSafeWall(0.6, -hd + t + 0.04, 0, 1, 0.14);
          addSafeDesk(4.0, -hd + t + 0.9, 0, 1, 0.14);
          // Floor 2
          const pb2 = 0.0;
          addCrossWall(pb2, stA1 + 0.05, hl - t, floor2Y, ceil2, 0.4, 1.5);
          placeFurn('bed', hl - t, 3.2, -1, 0, 2.1, floor2Y);
          placeFurn('dresser', 2.2, hd - t, 0, -1, 1.3, floor2Y);
          placeRug(2.0, 3.2, 2.4, 2.4, floor2Y);
          placePainting(hl - t - 0.03, 5.0, -1, 0, floor2Y);
          placeLamp(2.0, 3.2, ceil2);
          // F2 rear library
          placeFurn('bookshelf', hl - t, -3.2, -1, 0, 2.0, floor2Y);
          placeFurn('desk', 1.6, -hd + t, 0, 1, 1.8, floor2Y);
          placeLocker(-2.0, -hd + t + 0.38, 0, 1, floor2Y);
          placeRug(1.8, -3.4, 2.4, 2.4, floor2Y);
          placeLamp(1.8, -3.4, ceil2);
          if (R() < 0.25 && !ctx.sheriff) {
            addBarricade(0.4, pb2, floor2Y, 0, 1, 1.5);
          } else {
            addSafeDesk(4.0, -3.6, 0, 1, floor2Y);
          }
          if (R() < 0.5) placeBattery(2.2, -3.4, floor2Y + 0.45);
        },
      },
      // 9. Rooftop Preset A: 1-Floor Brick Corner Store with West Stairwell -> Rooftop Water Tank Deck (no 2F)
      {
        id: 'rooftop_shop_loft', kind: 'shop', floors: 1, roofAccess: true, L: 14, D: 14, H: 3.75, awning: true,
        build(ctx) {
          const { hl, hd, t, ceil1, roofY, addF1RoofStairsAndDeck, addCrossWall, placeFurn, placeLocker, placeCrates, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addMapWall, addBarricade, R } = ctx;
          const rStA0 = -hl + t + 0.04, rStA1 = -hl + t + 1.99;
          // Stair climbs front -> back (+3.2 -> -2.2) along West wall straight to Rooftop
          addF1RoofStairsAndDeck(rStA0, rStA1, 3.2, -2.2, -1);
          // Floor 1 Shop + Back Storeroom
          const pb1 = -2.1;
          addCrossWall(pb1, rStA1 + 0.16, hl - t, 0, ceil1, 2.8, 1.6);
          placeFurn('counter', hl - t, 3.2, -1, 0, 2.3, 0.14);
          placeFurn('aisle', 0.4, 1.4, 1, 0, 2.4, 0.14);
          placeFurn('shopShelf', rStA1 + 0.17, 1.4, 1, 0, 2.0, 0.14);
          placeRug(3.6, 3.2, 2.0, 2.4, 0.14);
          placePainting(hl - t - 0.03, 0.6, -1, 0, 0.14);
          placeLamp(1.5, 2.0, ceil1);
          // Rear storeroom
          placeFurn('shopShelf', -1.8, -hd + t, 0, 1, 2.0, 0.14);
          placeLocker(-3.8, -hd + t + 0.38, 0, 1, 0.14);
          placeCrates(4.6, -3.5, 0.14);
          placeLamp(1.5, -4.6, ceil1);
          addSafeWall(hl - t - 0.04, -4.4, -1, 0, 0.14);
          addMapWall(hl - t - 0.04, 5.4, -1, 0, 0.14, 'current');
          addMapWall(-5.40, -hd + t + 0.04, 0, 1, 0.14, 'locker');
          addMapWall(0.45, -hd + t + 0.04, 0, 1, 0.14, 'shelf');
          addSafeDesk(2.8, -hd + t + 0.9, 0, 1, 0.14);
          // Rooftop deck: Wooden water tank on steel stilts + crates + locker
          ctx.addRoofWaterTank(2.6, 2.2);
          placeCrates(-2.2, -4.6, roofY);
          placeLocker(4.8, -4.4, -1, 0, roofY);
          if (R() < 0.28 && !ctx.sheriff) {
            addBarricade((rStA0 + rStA1) * 0.5, -2.35, roofY, 0, -1, rStA1 - rStA0);
          } else if (R() < 0.55) {
            placeBattery(3.4, -4.6, roofY + 0.45);
          }
        },
      },
      // 10. Rooftop Preset B: 1-Floor Municipal Annex with East Reverse Stairwell -> Rooftop HVAC & Antenna Deck (no 2F)
      {
        id: 'rooftop_office_patio', kind: 'office', floors: 1, roofAccess: true, L: 15, D: 14, H: 3.75, awning: true,
        build(ctx) {
          const { hl, hd, t, ceil1, roofY, addF1RoofStairsAndDeck, addCrossWall, placeFurn, placeLocker, placeCoffeeTable, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, addSafeDesk, addBarricade, R } = ctx;
          const rStA0 = hl - t - 1.99, rStA1 = hl - t - 0.04;
          // Stair climbs back -> front (-2.4 -> +2.8) along East wall straight to Rooftop
          addF1RoofStairsAndDeck(rStA0, rStA1, -2.4, 2.8, 1);
          // Floor 1 Reception + Back Office
          const pb1 = 0.0;
          addCrossWall(pb1, -hl + t, rStA0 - 0.16, 0, ceil1, -2.2, 1.6);
          placeFurn('couch', -hl + t, 3.2, 1, 0, 2.0, 0.14);
          placeCoffeeTable(-4.6, 3.2, 0, 0.14);
          placeFurn('bookshelf', rStA0 - 0.17, 1.4, -1, 0, 1.6, 0.14);
          placeRug(-1.4, 3.2, 2.6, 2.8, 0.14);
          placeLamp(-1.4, 3.2, ceil1);
          // Rear office
          placeFurn('desk', -hl + t, -3.2, 1, 0, 1.9, 0.14);
          placeFurn('dresser', -hl + t, -5.6, 1, 0, 1.2, 0.14);
          placeLocker(0.6, -hd + t + 0.38, 0, 1, 0.14);
          placePainting(-hl + t + 0.03, -1.6, 1, 0, 0.14);
          placeLamp(-1.4, -3.4, ceil1);
          addSafeWall(-1.8, -hd + t + 0.04, 0, 1, 0.14);
          addSafeDesk(3.3, -hd + t + 0.9, 0, 1, 0.14);
          // Rooftop deck: Dual HVACs, Chimney, Radio Antenna & Locker
          ctx.addRoofHVAC(-3.4, -3.6);
          ctx.addRoofHVAC(-3.4, 3.2);
          ctx.addRoofChimney(0.4, 4.4);
          ctx.addRoofAntenna(-0.4, -4.6);
          placeLocker(-5.0, -0.4, 1, 0, roofY);
          if (R() < 0.28 && !ctx.sheriff) {
            addBarricade((rStA0 + rStA1) * 0.5, 2.95, roofY, 0, 1, rStA1 - rStA0);
          } else if (R() < 0.55) {
            placeBattery(-3.4, 0.0, roofY + 0.45);
          }
        },
      },
    ];

    // Unique Sheriff's Station Preset (ONLY building with 2nd floor + rooftop access, bespoke Police HQ design)
    const SHERIFF_PRESET = {
      id: 'sheriff_hq', kind: 'police', floors: 2, roofAccess: true, sheriff: true, L: 15, D: 15, H: 7.05, awning: true,
      build(ctx) {
        const { F, hl, hd, t, floor2Y, ceil1, ceil2, roofY, addStair1to2, addF2SlabsAndRails, addRoofStairsAndDeck, addCrossWall, addSideWall, placeFurn, placeLocker, placeRug, placePainting, placeLamp, placeBattery, addSafeWall, decoBox, box, collider, add, M, R } = ctx;
        const stA0 = hl - t - 1.99, stA1 = hl - t - 0.04;
        const rStA0 = -hl + t + 0.04, rStA1 = -hl + t + 1.89;
        addStair1to2(stA0, stA1, 3.6, -1.6, 1);
        addF2SlabsAndRails(stA0, stA1, 3.6, -1.6, 1);
        // Floor 1: Sheriff Lobby, Holding Cell (west rear) & Evidence Room (east rear)
        const pb1 = 0.4;
        // Front lobby counter + waiting area
        placeFurn('counter', -hl + t, 3.8, 1, 0, 2.4, 0.14);
        placeFurn('couch', 2.4, hd - t, 0, -1, 1.8, 0.14);
        placeRug(0.0, 3.8, 3.2, 2.8, 0.14);
        placePainting(-hl + t + 0.03, 1.8, 1, 0, 0.14);
        placeLamp(-1.2, 3.8, ceil1);
        placeLamp(2.8, 3.8, ceil1);
        // Back-west Holding Cell with 3D steel jail bars & open cell doorway
        const cellDivA = -2.0;
        addSideWall(cellDivA, -hd + t, pb1 - 0.1, 0, ceil1, -3.2, 1.35);
        // Cell front steel bar wall (pb1) from -hl+t to cellDivA with doorway at a = -4.6
        const cellDoorA = -4.6, cellGap = 1.25;
        for (let bx = -hl + t + 0.3; bx < cellDivA - 0.15; bx += 0.34) {
          if (Math.abs(bx - cellDoorA) < cellGap * 0.5) continue;
          const bp = F.point(bx, pb1);
          decoBox(M.iron, 0.055, ceil1 - 0.14, 0.055, bp.x, (ceil1 + 0.14) * 0.5, bp.z);
        }
        {
          const [hb0, hb1, hz0, hz1] = F.rect(-hl + t, cellDoorA - cellGap * 0.5, pb1 - 0.06, pb1 + 0.06);
          collider(hb0, hb1, hz0, hz1, ceil1, 0.14);
          const [hb2, hb3, hz2, hz3] = F.rect(cellDoorA + cellGap * 0.5, cellDivA - 0.1, pb1 - 0.06, pb1 + 0.06);
          collider(hb2, hb3, hz2, hz3, ceil1, 0.14);
          const [ht0, ht1, htz0, htz1] = F.rect(-hl + t, cellDivA, pb1 - 0.06, pb1 + 0.06);
          box(ht1 - ht0, 0.22, htz1 - htz0, M.iron, (ht0 + ht1) * 0.5, 2.55, (htz0 + htz1) * 0.5, { collide: false });
        }
        // Bunk inside holding cell
        placeFurn('bed', -hl + t, -4.4, 1, 0, 2.1, 0.14);
        placeLamp(-4.6, -3.4, ceil1);
        // Back-east Sheriff Evidence & Security Office (guaranteed unobstructed!)
        addCrossWall(pb1, cellDivA + 0.09, stA0 - 0.16, 0, ceil1, 1.0, 1.8);
        placeFurn('bookshelf', cellDivA + 0.12, -3.2, 1, 0, 1.8, 0.14);
        placeLocker(-0.3, -hd + t + 0.38, 0, 1, 0.14);
        placeLamp(1.5, -3.4, ceil1);
        // Bulletin board on back partition wall (clear of doorway)
        {
          const bPos = F.point(3.4, pb1 - 0.13);
          decoBox(M.wood, 1.6, 1.0, 0.05, bPos.x, 1.75, bPos.z, 0, F.yawBack(), 0);
          decoBox(M.poster, 0.45, 0.6, 0.06, bPos.x, 1.75, bPos.z, 0, F.yawBack(), 0);
        }
        addSafeWall(hl - t - 0.04, -3.6, -1, 0, 0.14);
        // Floor 2: Detective Bureau & Dispatch Room + West Roof Staircase
        addRoofStairsAndDeck(rStA0, rStA1, -2.2, 2.6, -1);
        addCrossWall(0.0, rStA1 + 0.16, stA0 - 0.05, floor2Y, ceil2, 0.2, 1.6);
        placeFurn('desk', -2.6, hd - t, 0, -1, 1.8, floor2Y);
        placeFurn('couch', 2.4, hd - t, 0, -1, 1.8, floor2Y);
        placeRug(0.0, 3.6, 2.8, 2.6, floor2Y);
        placePainting(-2.2, 0.13, 0, 1, floor2Y);
        placeLamp(0.0, 3.6, ceil2);
        // F2 rear Detective Archive
        placeFurn('desk', -1.8, -hd + t, 0, 1, 1.8, floor2Y);
        placeFurn('bookshelf', 1.6, -hd + t, 0, 1, 1.8, floor2Y);
        placeLocker(3.8, -hd + t + 0.38, 0, 1, floor2Y);
        placeRug(0.0, -3.6, 2.8, 2.4, floor2Y);
        placeLamp(0.0, -3.6, ceil2);
        // Unique Sheriff Roof Deck: Tall Steel Radio Mast + Beacon Lights + Dual HVAC + Rooftop Locker + Battery
        ctx.addSheriffRadioTower(3.2, -3.4);
        ctx.addRoofHVAC(-2.2, -4.4);
        ctx.addRoofHVAC(3.4, 3.6);
        placeLocker(5.2, 0.2, -1, 0, roofY);
        placeBattery(4.2, -1.8, roofY + 0.45);
        void add; void R;
      },
    };

    const presetQueue = [];
    function nextEnterPreset(kind) {
      if (!presetQueue.length) {
        for (let i = 0; i < ENTER_PRESETS.length; i++) presetQueue.push(ENTER_PRESETS[i]);
        for (let i = presetQueue.length - 1; i > 0; i--) {
          const j = (rand() * (i + 1)) | 0;
          const tmp = presetQueue[i]; presetQueue[i] = presetQueue[j]; presetQueue[j] = tmp;
        }
      }
      if (kind) {
        const idx = presetQueue.findIndex(p => p.kind === kind);
        if (idx >= 0) return presetQueue.splice(idx, 1)[0];
        const matching = ENTER_PRESETS.filter(p => p.kind === kind);
        if (matching.length) return matching[(rand() * matching.length) | 0];
      }
      return presetQueue.pop();
    }

    function buildEnterable(cx, cz, L, D, H, axis, sign, kind, opts) {
      const rich = !LO.ver || LO.ver().richInteriors;
      let preset = null;
      if (rich) {
        if (opts && opts.sheriff) preset = SHERIFF_PRESET;
        else preset = nextEnterPreset(opts && opts.kind ? opts.kind : null);
        L = preset.L;
        D = preset.D;
        H = preset.H;
        kind = preset.kind;
      }
      const hasRoof = !!(preset && preset.roofAccess);

      const F = frame(cx, cz, axis, sign, L, D);
      const t = 0.35, doorW = 2.2, doorH = 2.8;
      const facade = (preset && preset.sheriff) ? M.walls[3] : pick(M.walls);
      const inner = pick(M.plaster);
      const floorMat = kind === 'shop' || kind === 'police' ? M.tile : M.wood;
      const hl = L / 2, hd = D / 2;
      const [fx0, fx1, fz0, fz1] = F.rect(-hl, hl, -hd, hd);
      reserveBox(fx0, fx1, fz0, fz1, 'building');
      const [dClearX0, dClearX1, dClearZ0, dClearZ1] = F.rect(-2.2, 2.2, hd - 1.2, hd + 3.4);
      reserveBox(dClearX0, dClearX1, dClearZ0, dClearZ1, 'doorway');

      const b = {
        id: W.buildings.length, type: 'enter', sheriff: !!(opts && opts.sheriff),
        presetId: preset ? preset.id : 'legacy',
        cx, cz, minX: fx0, maxX: fx1, minZ: fz0, maxZ: fz1, L, D, H,
        group: new THREE.Group(), deco: new Map(), colliders: [], occluders: [], hideSpots: [], walkSurfaces: [],
        interior: null, debrisGroup: null, debrisColliders: [], debrisOccluders: [],
        smashed: false, hasEvidence: !!(opts && opts.sheriff),
        safeWallSpots: [], safeDeskSpots: [], mapWallSpots: [],
      };
      W.root.add(b.group);
      W.buildings.push(b);
      curB = b;

      const ceil1 = rich ? 3.50 : 3.60;
      const floor2Y = 3.68;
      const ceil2 = 7.05;
      const roofY = hasRoof ? ((preset && preset.floors === 1) ? 3.90 : 7.45) : undefined;

      // Exterior walls (front with doorway, back, sides)
      wall(F, -hl, -doorW / 2, hd - t, hd, 0, H, facade, inner, 'front');
      wall(F, doorW / 2, hl, hd - t, hd, 0, H, facade, inner, 'front');
      wall(F, -doorW / 2, doorW / 2, hd - t, hd, doorH, H, facade, inner, 'front');
      wall(F, -hl, hl, -hd, -hd + t, 0, H, facade, inner, 'back');
      wall(F, -hl, -hl + t, -hd + t, hd - t, 0, H, facade, inner, 'left');
      wall(F, hl - t, hl, -hd + t, hd - t, 0, H, facade, inner, 'right');

      // Floor 1 slab + walkable surface
      boxAt(fx0 + t, fx1 - t, 0, 0.14, fz0 + t, fz1 - t, floorMat, { collide: false, tile: 3, cast: false });
      walkSurface({ type: 'flat', minX: fx0 + t, maxX: fx1 - t, minZ: fz0 + t, maxZ: fz1 - t, y: 0.14 });

      // Dark exterior doorframe
      const dp = F.point(0, hd + 0.02);
      box(axis === 'z' ? doorW + 0.3 : 0.1, 0.2, axis === 'z' ? 0.1 : doorW + 0.3, M.trim, dp.x, doorH + 0.1, dp.z);

      const intr = { minX: fx0, maxX: fx1, minZ: fz0, maxZ: fz1, ceil: ceil1, roofY, disabled: false };
      W.interiors.push(intr);
      b.interior = intr;

      // Helper converting local building direction (da, db) into world orientation
      const localWorldVec = (da, db) => axis === 'z' ? [da, sign * db] : [sign * db, da];
      const yawFurnDir = (da, db) => { const [wx, wz] = localWorldVec(da, db); return Math.atan2(-wz, wx); };
      const yawFaceDir = (da, db) => { const [wx, wz] = localWorldVec(da, db); return Math.atan2(wx, wz); };

      if (!rich) {
        // Legacy <2.6 single-story enterable layout
        const f1Occ = [];
        const inBounds = (a0, a1, b0, b1) =>
          Math.min(a0, a1) >= -hl + t + 0.01 && Math.max(a0, a1) <= hl - t - 0.01 &&
          Math.min(b0, b1) >= -hd + t + 0.01 && Math.max(b0, b1) <= hd - t - 0.01;
        const canOcc = (occ, a0, a1, b0, b1, pad) => {
          pad = pad || 0;
          const la0 = Math.min(a0, a1) - pad, la1 = Math.max(a0, a1) + pad;
          const lb0 = Math.min(b0, b1) - pad, lb1 = Math.max(b0, b1) + pad;
          if (!inBounds(Math.min(a0, a1), Math.max(a0, a1), Math.min(b0, b1), Math.max(b0, b1))) return false;
          for (let i = 0; i < occ.length; i++) {
            const r = occ[i];
            if (la1 > r.a0 && la0 < r.a1 && lb1 > r.b0 && lb0 < r.b1) return false;
          }
          return true;
        };
        const addOcc = (occ, a0, a1, b0, b1) => occ.push({ a0: Math.min(a0, a1), a1: Math.max(a0, a1), b0: Math.min(b0, b1), b1: Math.max(b0, b1) });
        addOcc(f1Occ, -2.1, 2.1, hd - t - 2.8, hd - t);
        if (opts && opts.sheriff) addOcc(f1Occ, -hl + t, -hl + t + 3.8, -hd + t, -hd + t + 2.3);

        const pb = R(-1, 1.5), gapA = R(-1.5, 1.5), gw = 1.6;
        wall(F, -hl + t, gapA - gw / 2, pb - 0.1, pb + 0.1, 0, ceil1, inner, inner, 'front');
        wall(F, gapA + gw / 2, hl - t, pb - 0.1, pb + 0.1, 0, ceil1, inner, inner, 'front');
        wall(F, gapA - gw / 2, gapA + gw / 2, pb - 0.1, pb + 0.1, 2.5, ceil1, inner, inner, 'front');
        addOcc(f1Occ, -hl + t, hl - t, pb - 0.45, pb + 0.45);
        boxAt(fx0, fx1, ceil1, ceil1 + 0.15, fz0, fz1, inner, { collide: false, tile: 4 });
        boxAt(fx0 - 0.3, fx1 + 0.3, H, H + 0.4, fz0 - 0.3, fz1 + 0.3, M.roof, { collide: false, tile: 6 });

        const info = { F, hl, hd, t, pb, gapA, axis, sign, kind, sheriff: !!(opts && opts.sheriff), cx, cz, building: b };
        for (let k = 0; k < 8; k++) {
          const la = R(-hl + 1.5, hl - 1.5);
          if (canOcc(f1Occ, la - 0.55, la + 0.55, -hd + t + 0.02, -hd + t + 1.15, 0.05)) {
            addOcc(f1Occ, la - 0.55, la + 0.55, -hd + t + 0.02, -hd + t + 1.15);
            const lp = F.point(la, -hd + t + 0.38);
            locker(lp.x, lp.z, F.yawFront(), 0.14);
            break;
          }
        }
        b.safeWallSpots.push({ p: F.point(gapA > 0 ? -hl + t + 0.03 : hl - t - 0.03, (-hd + pb) * 0.5), yaw: F.yawLeft() + (gapA > 0 ? 0 : Math.PI), y: 0.14 });
        b.safeWallSpots.push({ p: F.point(0, -hd + t + 0.03), yaw: F.yawFront(), y: 0.14 });
        const placeAlongLegacy = (b0, b1, side) => {
          let bb = b0 + 0.5;
          while (bb < b1 - 1.2) {
            const len = R(1.3, 2.3);
            if (bb + len > b1 - 0.5) break;
            const fa0 = side > 0 ? hl - t - 1.35 : -hl + t + 0.03;
            const fa1 = side > 0 ? hl - t - 0.03 : -hl + t + 1.35;
            if (canOcc(f1Occ, fa0, fa1, bb, bb + len, 0.08)) {
              addOcc(f1Occ, fa0, fa1, bb, bb + len);
              const p = F.point(side * (hl - t), bb + len / 2);
              const into = axis === 'z' ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
              let item = kind === 'shop' ? (rand() < 0.75 ? 'shopShelf' : 'counter')
                : kind === 'house' ? pick(['couch', 'bed', 'bookshelf', 'dresser', 'desk'])
                : pick(['desk', 'bookshelf', 'dresser']);
              furniture(item, p.x, p.z, into, len, kind, 0.14);
            }
            bb += len + R(0.3, 1.0);
          }
        };
        placeAlongLegacy(pb + 0.3, hd - t - 1.2, -1);
        placeAlongLegacy(pb + 0.3, hd - t - 1.2, 1);
        placeAlongLegacy(-hd + t, pb - 0.3, -1);
        placeAlongLegacy(-hd + t, pb - 0.3, 1);
        W.enterables.push(info);
      } else {
        // ============================================================
        // V2.6.1 PRESET-BASED ENTERABLE BUILDINGS (4x 1F, 4x 2F, 2x 1F+Rooftop + Unique 2F+Rooftop Sheriff HQ)
        // ============================================================
        let roofSafeZone = null;
        let hasBarricade = false;
        const addBulkhead = (rStA0, rStA1, rStBotB, rStTopB) => {
          const minB = Math.min(rStBotB, rStTopB), maxB = Math.max(rStBotB, rStTopB);
          const bhH = roofY + 2.35;
          if (rStTopB > rStBotB) {
            wall(F, rStA0 - 0.14, rStA1 + 0.14, minB - 0.16, minB, roofY, bhH, facade, inner, 'back');
            wall(F, rStA0 - 0.14, rStA0 + 0.02, minB, maxB + 0.14, roofY, bhH, facade, inner, 'left');
            wall(F, rStA1 - 0.02, rStA1 + 0.14, minB, maxB + 0.14, roofY, bhH, facade, inner, 'right');
            const [hx0, hx1, hz0, hz1] = F.rect(rStA0 - 0.14, rStA1 + 0.14, minB - 0.16, maxB + 0.14);
            boxAt(hx0, hx1, bhH, bhH + 0.18, hz0, hz1, M.roof, { collide: false, tile: 4 });
            roofSafeZone = { a0: rStA0 - 1.0, a1: rStA1 + 1.0, b0: minB - 0.8, b1: maxB + 2.0 };
          } else {
            wall(F, rStA0 - 0.14, rStA1 + 0.14, maxB, maxB + 0.16, roofY, bhH, facade, inner, 'front');
            wall(F, rStA0 - 0.14, rStA0 + 0.02, minB - 0.14, maxB, roofY, bhH, facade, inner, 'left');
            wall(F, rStA1 - 0.02, rStA1 + 0.14, minB - 0.14, maxB, roofY, bhH, facade, inner, 'right');
            const [hx0, hx1, hz0, hz1] = F.rect(rStA0 - 0.14, rStA1 + 0.14, minB - 0.14, maxB + 0.16);
            boxAt(hx0, hx1, bhH, bhH + 0.18, hz0, hz1, M.roof, { collide: false, tile: 4 });
            roofSafeZone = { a0: rStA0 - 1.0, a1: rStA1 + 1.0, b0: minB - 2.0, b1: maxB + 0.8 };
          }
          // Safety roof parapet colliders (removed in v2.8+ for rooftop fall damage)
          if (LO.ver && !LO.ver().fallDamage) {
            const [p1x0, p1x1, p1z0, p1z1] = F.rect(-hl - 0.2, hl + 0.2, -hd - 0.2, -hd + 0.15);
            collider(p1x0, p1x1, p1z0, p1z1, roofY + 1.15, roofY);
            const [p2x0, p2x1, p2z0, p2z1] = F.rect(-hl - 0.2, hl + 0.2, hd - 0.15, hd + 0.2);
            collider(p2x0, p2x1, p2z0, p2z1, roofY + 1.15, roofY);
            const [p3x0, p3x1, p3z0, p3z1] = F.rect(-hl - 0.2, -hl + 0.15, -hd + 0.15, hd - 0.15);
            collider(p3x0, p3x1, p3z0, p3z1, roofY + 1.15, roofY);
            const [p4x0, p4x1, p4z0, p4z1] = F.rect(hl - 0.15, hl + 0.2, -hd + 0.15, hd - 0.15);
            collider(p4x0, p4x1, p4z0, p4z1, roofY + 1.15, roofY);
          }
        };
        const pCtx = {
          F, hl, hd, t, floor2Y, ceil1, ceil2, roofY,
          sheriff: !!preset.sheriff,
          isSpawnLeft: !!(opts && opts.isSpawnLeft),
          R: rand,
          M, collider, add, box, decoBox,
          addCrossWall(bPos, a0, a1, y0, y1, doorA, doorW2) {
            if (doorA === null || doorA === undefined) {
              wall(F, a0, a1, bPos - 0.1, bPos + 0.1, y0, y1, inner, inner, 'front');
              return;
            }
            const halfD = (doorW2 || 1.5) * 0.5, dH = 2.45;
            wall(F, a0, doorA - halfD, bPos - 0.1, bPos + 0.1, y0, y1, inner, inner, 'front');
            wall(F, doorA + halfD, a1, bPos - 0.1, bPos + 0.1, y0, y1, inner, inner, 'front');
            if (y1 - y0 > dH) wall(F, doorA - halfD, doorA + halfD, bPos - 0.1, bPos + 0.1, y0 + dH, y1, inner, inner, 'front');
          },
          addSideWall(aPos, b0, b1, y0, y1, doorB, doorW2) {
            if (doorB === null || doorB === undefined) {
              wall(F, aPos - 0.1, aPos + 0.1, b0, b1, y0, y1, inner, inner, 'left');
              return;
            }
            const halfD = (doorW2 || 1.5) * 0.5, dH = 2.45;
            wall(F, aPos - 0.1, aPos + 0.1, b0, doorB - halfD, y0, y1, inner, inner, 'left');
            wall(F, aPos - 0.1, aPos + 0.1, doorB + halfD, b1, y0, y1, inner, inner, 'left');
            if (y1 - y0 > dH) wall(F, aPos - 0.1, aPos + 0.1, doorB - halfD, doorB + halfD, y0 + dH, y1, inner, inner, 'left');
          },
          addStair1to2(stA0, stA1, stBotB, stTopB, stairSide) {
            const stCenterA = (stA0 + stA1) * 0.5;
            const stInnerA = stairSide > 0 ? stA0 - 0.08 : stA1 + 0.08;
            wall(F, stInnerA - 0.09, stInnerA + 0.09, stTopB, stBotB + 0.1, 0, ceil1, inner, inner, 'left');
            const numTreads = 12, treadRun = (stBotB - stTopB) / numTreads, treadRise = (floor2Y - 0.14) / numTreads;
            for (let ti = 0; ti < numTreads; ti++) {
              const tb0 = stBotB - (ti + 1) * treadRun, tb1 = stBotB - ti * treadRun + 0.04;
              const ty1 = 0.14 + (ti + 1) * treadRise, ty0 = Math.max(0.14, ty1 - treadRise - 0.10);
              const [sx0, sx1, sz0, sz1] = F.rect(stA0 + 0.05, stA1 - 0.05, tb0, tb1);
              boxAt(sx0, sx1, ty0, ty1, sz0, sz1, M.wood, { collide: false, tile: 2 });
            }
            const [rx0, rx1, rz0, rz1] = F.rect(stA0, stA1, stTopB - 0.18, stBotB + 0.18);
            const botP = F.point(stCenterA, stBotB), topP = F.point(stCenterA, stTopB);
            walkSurface({
              type: 'ramp', minX: rx0, maxX: rx1, minZ: rz0, maxZ: rz1,
              axis: axis === 'z' ? 'z' : 'x',
              u0: axis === 'z' ? botP.z : botP.x,
              u1: axis === 'z' ? topP.z : topP.x,
              y0: 0.14, y1: floor2Y,
            });
          },
          addF2SlabsAndRails(stA0, stA1, stBotB, stTopB, stairSide) {
            const addFloorSlab = (a0, a1, b0, b1) => {
              if (a1 - a0 < 0.08 || b1 - b0 < 0.08) return;
              const [sx0, sx1, sz0, sz1] = F.rect(a0, a1, b0, b1);
              boxAt(sx0, sx1, ceil1, floor2Y, sz0, sz1, floorMat, { tile: 3, collide: false });
              walkSurface({ type: 'flat', minX: sx0, maxX: sx1, minZ: sz0, maxZ: sz1, y: floor2Y });
            };
            addFloorSlab(-hl + t, hl - t, -hd + t, stTopB);
            addFloorSlab(-hl + t, hl - t, stBotB, hd - t);
            if (stairSide > 0) addFloorSlab(-hl + t, stA0, stTopB, stBotB);
            else addFloorSlab(stA1, hl - t, stTopB, stBotB);
            const railA = stairSide > 0 ? stA0 : stA1;
            const [gx0, gx1, gz0, gz1] = F.rect(railA - 0.06, railA + 0.06, stTopB, stBotB);
            boxAt(gx0, gx1, floor2Y, floor2Y + 0.95, gz0, gz1, M.wood, { tile: 2 });
            const endA0 = stairSide > 0 ? stA0 + 0.06 : stA0;
            const endA1 = stairSide > 0 ? stA1 : stA1 - 0.06;
            const [fx0r, fx1r, fz0r, fz1r] = F.rect(endA0, endA1, stBotB - 0.06, stBotB + 0.06);
            boxAt(fx0r, fx1r, floor2Y, floor2Y + 0.95, fz0r, fz1r, M.wood, { tile: 2 });
          },
          // Direct 1st-floor-to-rooftop enclosed staircase (used only by the 2 non-Sheriff rooftop presets)
          addF1RoofStairsAndDeck(rStA0, rStA1, rStBotB, rStTopB, rSide) {
            const minB = Math.min(rStBotB, rStTopB), maxB = Math.max(rStBotB, rStTopB);
            const rStCenterA = (rStA0 + rStA1) * 0.5;
            const rTreads = 12, treadRise = (roofY - 0.14) / rTreads;
            for (let ti = 0; ti < rTreads; ti++) {
              const bA = rStBotB + (rStTopB - rStBotB) * (ti / rTreads);
              const bB = rStBotB + (rStTopB - rStBotB) * ((ti + 1) / rTreads);
              const tb0 = Math.min(bA, bB) - 0.02, tb1 = Math.max(bA, bB) + 0.02;
              const ty1 = 0.14 + (ti + 1) * treadRise, ty0 = Math.max(0.14, ty1 - treadRise - 0.10);
              const [sx0, sx1, sz0, sz1] = F.rect(rStA0 + 0.05, rStA1 - 0.05, tb0, tb1);
              boxAt(sx0, sx1, ty0, ty1, sz0, sz1, M.wood, { collide: false, tile: 2 });
            }
            const [rx0, rx1, rz0, rz1] = F.rect(rStA0, rStA1, minB - 0.18, maxB + 0.18);
            const botP = F.point(rStCenterA, rStBotB), topP = F.point(rStCenterA, rStTopB);
            walkSurface({
              type: 'ramp', minX: rx0, maxX: rx1, minZ: rz0, maxZ: rz1,
              axis: axis === 'z' ? 'z' : 'x',
              u0: axis === 'z' ? botP.z : botP.x,
              u1: axis === 'z' ? topP.z : topP.x,
              y0: 0.14, y1: roofY,
            });
            const rInnerA = rSide > 0 ? rStA0 - 0.08 : rStA1 + 0.08;
            wall(F, rInnerA - 0.09, rInnerA + 0.09, minB, maxB, 0, ceil1, inner, inner, 'left');
            const addRoofSlab = (a0, a1, b0, b1) => {
              if (a1 - a0 < 0.08 || b1 - b0 < 0.08) return;
              const [sx0, sx1, sz0, sz1] = F.rect(a0, a1, b0, b1);
              boxAt(sx0, sx1, ceil1, roofY, sz0, sz1, M.roof, { tile: 5, collide: false });
              walkSurface({ type: 'flat', minX: sx0, maxX: sx1, minZ: sz0, maxZ: sz1, y: roofY });
            };
            addRoofSlab(-hl, hl, -hd, minB);
            addRoofSlab(-hl, hl, maxB, hd);
            if (rSide > 0) addRoofSlab(-hl, rStA0, minB, maxB);
            else addRoofSlab(rStA1, hl, minB, maxB);
            addBulkhead(rStA0, rStA1, rStBotB, rStTopB);
          },
          // 2nd-floor-to-rooftop staircase (used exclusively by Sheriff HQ)
          addRoofStairsAndDeck(rStA0, rStA1, rStBotB, rStTopB, rSide) {
            const minB = Math.min(rStBotB, rStTopB), maxB = Math.max(rStBotB, rStTopB);
            const rStCenterA = (rStA0 + rStA1) * 0.5;
            const rTreads = 12, rRun = (rStTopB - rStBotB) / rTreads, rRise = (roofY - floor2Y) / rTreads;
            for (let ti = 0; ti < rTreads; ti++) {
              const tb0 = rStBotB + ti * rRun - 0.04, tb1 = rStBotB + (ti + 1) * rRun;
              const ty1 = floor2Y + (ti + 1) * rRise, ty0 = Math.max(floor2Y, ty1 - rRise - 0.10);
              const [sx0, sx1, sz0, sz1] = F.rect(rStA0 + 0.05, rStA1 - 0.05, tb0, tb1);
              boxAt(sx0, sx1, ty0, ty1, sz0, sz1, M.wood, { collide: false, tile: 2 });
            }
            const [rx0, rx1, rz0, rz1] = F.rect(rStA0, rStA1, minB - 0.18, maxB + 0.18);
            const botP = F.point(rStCenterA, rStBotB), topP = F.point(rStCenterA, rStTopB);
            walkSurface({
              type: 'ramp', minX: rx0, maxX: rx1, minZ: rz0, maxZ: rz1,
              axis: axis === 'z' ? 'z' : 'x',
              u0: axis === 'z' ? botP.z : botP.x,
              u1: axis === 'z' ? topP.z : topP.x,
              y0: floor2Y, y1: roofY,
            });
            const rInnerA = rSide > 0 ? rStA0 - 0.08 : rStA1 + 0.08;
            wall(F, rInnerA - 0.09, rInnerA + 0.09, minB, maxB, floor2Y, ceil2, inner, inner, 'left');
            const addRoofSlab = (a0, a1, b0, b1) => {
              if (a1 - a0 < 0.08 || b1 - b0 < 0.08) return;
              const [sx0, sx1, sz0, sz1] = F.rect(a0, a1, b0, b1);
              boxAt(sx0, sx1, ceil2, roofY, sz0, sz1, M.roof, { tile: 5, collide: false });
              walkSurface({ type: 'flat', minX: sx0, maxX: sx1, minZ: sz0, maxZ: sz1, y: roofY });
            };
            addRoofSlab(-hl, hl, -hd, minB);
            addRoofSlab(-hl, hl, maxB, hd);
            if (rSide > 0) addRoofSlab(-hl, rStA0, minB, maxB);
            else addRoofSlab(rStA1, hl, minB, maxB);
            addBulkhead(rStA0, rStA1, rStBotB, rStTopB);
          },
          placeFurn(type, a, bPos, da, db, len, baseY) {
            const p = F.point(a, bPos);
            furniture(type, p.x, p.z, yawFurnDir(da, db), len, kind, baseY);
          },
          placeLocker(a, bPos, da, db, baseY) {
            const p = F.point(a, bPos);
            locker(p.x, p.z, yawFaceDir(da, db), baseY);
          },
          placeCoffeeTable(a, bPos, ryOff, baseY) {
            const p = F.point(a, bPos);
            const ry = F.yawFront() + (ryOff || 0);
            decoBox(M.wood, 0.95, 0.06, 0.56, p.x, baseY + 0.42, p.z, 0, ry, 0);
            [-0.38, 0.38].forEach(lx => [-0.20, 0.20].forEach(lz => {
              const c = Math.cos(ry), s = Math.sin(ry);
              decoBox(M.wood, 0.05, 0.40, 0.05, p.x + lx * c + lz * s, baseY + 0.20, p.z - lx * s + lz * c);
            }));
            decoBox(LINEN, 0.22, 0.04, 0.30, p.x + 0.12, baseY + 0.47, p.z, 0, ry + 0.3, 0);
            collider(p.x - 0.5, p.x + 0.5, p.z - 0.5, p.z + 0.5, baseY + 0.48, baseY);
          },
          placeDiningTable(a, bPos, baseY) {
            const p = F.point(a, bPos);
            decoBox(M.wood, 1.4, 0.06, 0.95, p.x, baseY + 0.76, p.z);
            [[-0.58, -0.36], [0.58, -0.36], [-0.58, 0.36], [0.58, 0.36]].forEach(([lx, lz]) => {
              decoBox(M.wood, 0.06, 0.74, 0.06, p.x + lx, baseY + 0.37, p.z + lz);
            });
            const chMat = pick(FABRICS);
            [-0.45, 0.45].forEach(ox => {
              [[-0.72, -0.90], [0.72, 0.90]].forEach(([seatZ, backZ]) => {
                decoBox(chMat, 0.42, 0.06, 0.42, p.x + ox, baseY + 0.44, p.z + seatZ);
                decoBox(chMat, 0.42, 0.46, 0.06, p.x + ox, baseY + 0.68, p.z + backZ);
                [-0.16, 0.16].forEach(lx => [-0.16, 0.16].forEach(lz => {
                  decoBox(M.wood, 0.048, 0.41, 0.048, p.x + ox + lx, baseY + 0.205, p.z + seatZ + lz);
                }));
              });
            });
            collider(p.x - 0.9, p.x + 0.9, p.z - 1.0, p.z + 1.0, baseY + 0.8, baseY);
          },
          placeCrates(a, bPos, baseY) {
            const p = F.point(a, bPos);
            decoBox(M.wood, 0.78, 0.72, 0.78, p.x, baseY + 0.36, p.z, 0, 0.15, 0);
            decoBox(M.wood, 0.66, 0.56, 0.66, p.x + 0.78, baseY + 0.28, p.z + 0.1, 0, -0.22, 0);
            decoBox(M.wood, 0.52, 0.48, 0.52, p.x + 0.06, baseY + 0.96, p.z - 0.05, 0, 0.42, 0);
            collider(p.x - 0.5, p.x + 1.2, p.z - 0.5, p.z + 0.5, baseY + 1.2, baseY);
          },
          placeRug(a, bPos, wA, dB, baseY) {
            const p = F.point(a, bPos);
            decoBox(pick(RUGS), axis === 'z' ? wA : dB, 0.02, axis === 'z' ? dB : wA, p.x, baseY + 0.015, p.z);
          },
          placePainting(a, bPos, da, db, baseY) {
            const p = F.point(a, bPos);
            const ry = yawFaceDir(da, db);
            decoBox(M.wood, 0.78, 0.62, 0.04, p.x, baseY + 1.65, p.z, 0, ry, 0);
            decoBox(pick(PAINTINGS), 0.64, 0.48, 0.05, p.x, baseY + 1.65, p.z, 0, ry, 0);
          },
          placeLamp(a, bPos, ceilY) {
            const p = F.point(a, bPos);
            decoCyl(M.pole, 0.02, 0.02, 0.45, p.x, ceilY - 0.22, p.z, 6);
            decoCyl(M.lampOff, 0.30, 0.18, 0.16, p.x, ceilY - 0.48, p.z, 12);
          },
          placeBattery(a, bPos, y) {
            const p = F.point(a, bPos);
            battery(p.x, y, p.z);
          },
          addSafeWall(a, bPos, da, db, baseY) {
            b.safeWallSpots.push({ p: F.point(a, bPos), yaw: yawFaceDir(da, db), y: baseY });
          },
          addSafeDesk(a, bPos, da, db, baseY) {
            b.safeDeskSpots.push({ p: F.point(a, bPos), yaw: yawFaceDir(da, db), y: baseY });
          },
          addMapWall(a, bPos, da, db, baseY, tag) {
            b.mapWallSpots.push({ p: F.point(a, bPos), yaw: yawFaceDir(da, db), y: baseY, tag: tag || 'spot' });
          },
          addBarricade(a, bPos, baseY, da, db, spanW) {
            hasBarricade = true;
            buildBarricadeCluster(F, a, bPos, baseY, yawFaceDir(da, db), spanW);
          },
          addRoofWaterTank(a, bPos) {
            const p = F.point(a, bPos);
            decoCyl(M.wood, 1.1, 1.1, 1.9, p.x, roofY + 2.35, p.z, 8);
            decoCyl(M.roof, 0.05, 1.2, 0.58, p.x, roofY + 3.6, p.z, 8);
            [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([ox, oz]) => decoBox(M.pole, 0.1, 1.4, 0.1, p.x + ox, roofY + 0.7, p.z + oz));
            collider(p.x - 1.1, p.x + 1.1, p.z - 1.1, p.z + 1.1, roofY + 3.5, roofY);
            W.noisyObjects.push({ x: p.x, y: roofY + 1.2, z: p.z, radius: 6.2, strength: 0.75, kind: 'tank' });
          },
          addRoofHVAC(a, bPos) {
            const p = F.point(a, bPos);
            decoBox(M.metal, 1.45, 0.9, 1.25, p.x, roofY + 0.45, p.z);
            decoBox(M.trim, 1.2, 0.08, 1.0, p.x, roofY + 0.93, p.z);
            collider(p.x - 0.75, p.x + 0.75, p.z - 0.65, p.z + 0.65, roofY + 1.0, roofY);
            W.noisyObjects.push({ x: p.x, y: roofY + 0.6, z: p.z, radius: 6.5, strength: 0.95, kind: 'hvac' });
          },
          addRoofChimney(a, bPos) {
            const p = F.point(a, bPos);
            decoBox(M.brick, 0.75, 1.45, 0.75, p.x, roofY + 0.725, p.z);
            decoBox(M.rubble, 0.88, 0.12, 0.88, p.x, roofY + 1.48, p.z);
            collider(p.x - 0.42, p.x + 0.42, p.z - 0.42, p.z + 0.42, roofY + 1.55, roofY);
          },
          addRoofAntenna(a, bPos) {
            const p = F.point(a, bPos);
            decoBox(M.iron, 0.45, 0.35, 0.45, p.x, roofY + 0.17, p.z);
            decoBox(M.pole, 0.07, 4.2, 0.07, p.x, roofY + 2.1, p.z);
            decoBox(M.pole, 0.9, 0.05, 0.05, p.x, roofY + 3.6, p.z);
          },
          addSheriffRadioTower(a, bPos) {
            const p = F.point(a, bPos);
            decoBox(M.concrete, 1.4, 0.3, 1.4, p.x, roofY + 0.15, p.z);
            [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].forEach(([ox, oz]) => {
              decoBox(M.iron, 0.08, 4.6, 0.08, p.x + ox * 0.7, roofY + 2.45, p.z + oz * 0.7);
            });
            decoBox(M.pole, 0.07, 2.2, 0.07, p.x, roofY + 5.7, p.z);
            decoBox(M.pole, 1.5, 0.06, 0.06, p.x, roofY + 5.4, p.z);
            decoBox(M.amberBeacon, 0.18, 0.18, 0.18, p.x, roofY + 6.85, p.z);
            collider(p.x - 0.75, p.x + 0.75, p.z - 0.75, p.z + 0.75, roofY + 4.8, roofY);
            W.noisyObjects.push({ x: p.x, y: roofY + 1.5, z: p.z, radius: 7.5, strength: 1.0, kind: 'tower' });
          },
        };

        // Ceilings / Roof slab for non-rooftop presets
        if (!hasRoof && preset.floors === 1) {
          boxAt(fx0 + t, fx1 - t, ceil1, ceil1 + 0.15, fz0 + t, fz1 - t, inner, { collide: false, tile: 4 });
          boxAt(fx0 - 0.3, fx1 + 0.3, H, H + 0.4, fz0 - 0.3, fz1 + 0.3, M.roof, { collide: false, tile: 6 });
        } else if (!hasRoof) {
          boxAt(fx0 + t, fx1 - t, ceil2, ceil2 + 0.15, fz0 + t, fz1 - t, inner, { collide: false, tile: 4 });
          boxAt(fx0 - 0.3, fx1 + 0.3, H, H + 0.4, fz0 - 0.3, fz1 + 0.3, M.roof, { collide: false, tile: 6 });
        }

        preset.build(pCtx);

        const info = {
          F, hl, hd, t, pb: 0, gapA: 0, axis, sign, kind,
          sheriff: !!(opts && opts.sheriff), presetId: preset.id,
          floors: preset.floors,
          cx, cz, building: b, hasRoof, hasBarricade, roofSafeZone,
        };
        W.enterables.push(info);
      }

      // Scattered papers / missing poster inside every enterable
      for (let i = 0; i < 4; i++) {
        const p = F.point(R(-1.6, 1.6), R(hd - 3.6, hd - 1.5));
        box(R(0.2, 0.42), 0.01, R(0.2, 0.32), rand() < 0.5 ? M.poster : M.plaster[0], p.x, 0.15, p.z, { ry: R(0, 3) });
      }
      {
        const p = F.point(1.4, hd - t - 0.02);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), M.poster);
        pm.position.set(p.x, 1.6, p.z);
        pm.rotation.y = F.yawBack();
        add(pm, { cast: false });
      }

      const entInfo = W.enterables[W.enterables.length - 1];
      decorate(fx0, fx1, fz0, fz1, H, F, {
        doorGap: true,
        doorA: 0,
        sheriff: entInfo.sheriff,
        roofAccess: hasRoof,
        skipRoofClutter: !!(preset && hasRoof),
        roofSafeZone: entInfo.roofSafeZone || null,
        awning: entInfo.sheriff || (preset ? !!preset.awning : (kind === 'shop' || kind === 'office')),
        awningMat: entInfo.sheriff ? mat({ color: 0x16243d }) : kind === 'shop' ? mat({ color: 0x5a1f1a }) : mat({ color: 0x1f3a5a }),
      });

      if (entInfo.sheriff) {
        // SHERIFF sign above the door
        const c = document.createElement('canvas'); c.width = 512; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#1a2233'; g.fillRect(0, 0, 512, 128);
        g.strokeStyle = '#c9a227'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116);
        g.fillStyle = '#e8d9a0'; g.font = 'bold 76px Arial'; g.textAlign = 'center'; g.fillText('SHERIFF', 256, 92);
        const sm = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
        const sp = F.point(0, hd + 0.16);
        sm.position.set(sp.x, doorH + 1.35, sp.z); sm.rotation.y = F.yawFront();
        add(sm, { cast: false });
        // Sheriff evidence desk (in back-east Security Office, guaranteed free of lockers/bars)
        const da = 2.6;
        const dp = F.point(da, -hd + t + 0.72);
        box(axis === 'z' ? 2.6 : 1.1, 0.9, axis === 'z' ? 1.1 : 2.6, M.wood, dp.x, 0.59, dp.z, { collide: true, minY: 0.14 });
        const tv = new THREE.Group();
        tv.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), mat({ color: 0x1e1e1c })));
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ color: 0x0c1410 }));
        scr.position.z = 0.31; tv.add(scr);
        tv.position.set(dp.x, 1.34, dp.z); tv.rotation.y = F.yawFront();
        add(tv);
        const tp = F.point(da - 0.7, -hd + t + 0.92);
        const tape = new THREE.Group();
        const shell = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.025, 0.1), mat({ color: 0x111111 }));
        const lc = document.createElement('canvas'); lc.width = 128; lc.height = 64;
        const lg = lc.getContext('2d'); lg.fillStyle = '#eee8d0'; lg.fillRect(0, 0, 128, 64);
        lg.fillStyle = '#b11'; lg.font = 'bold 15px Courier'; lg.fillText('OCT 23', 8, 24); lg.fillText('DO NOT ERASE', 8, 48);
        const label = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.07), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc) }));
        label.rotation.x = -Math.PI / 2; label.position.y = 0.014;
        tape.add(shell, label);
        tape.position.set(tp.x, 1.055, tp.z); tape.rotation.y = F.yawFront();
        add(tape);
        W.fixedEvidence.push({ id: 'tape', name: 'Sheriff\'s security tape', pos: new THREE.Vector3(tp.x, 1.09, tp.z), maxDist: 4, found: false, margin: 0.6 });
      }
      flushDeco(b.deco, b.group);
      curB = null;
    }

    function buildClosed(cx, cz, L, D, H, axis, sign, opts) {
      opts = opts || {};
      const F = frame(cx, cz, axis, sign, L, D);
      const facade = pick(M.walls);
      const [x0, x1, z0, z1] = F.rect(-L / 2, L / 2, -D / 2, D / 2);
      const w = x1 - x0, d = z1 - z0;
      const b = {
        id: W.buildings.length, type: 'closed', sheriff: false, outskirt: !!opts.outskirt,
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
      if (!opts.outskirt) W.closedFronts.push({ F, L, D, H, doorA, axis, building: b });
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
      const [rx0, rx1, rz0, rz1] = F.rect(-L / 2, L / 2, -D / 2, D / 2);
      reserveBox(rx0, rx1, rz0, rz1, 'building');
      return { F, mesh: m, x0, x1, z0, z1, building: b };
    }

    function buildRuin(cx, cz, L, D) {
      reserveBox(cx - L / 2, cx + L / 2, cz - D / 2, cz + D / 2, 'building');
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
        // keep center [-3.5..3.5] open for water tower evidence; park cars toward corners without overlaps
        for (let i = 0; i < 2; i++) {
          for (let tries = 0; tries < 10; tries++) {
            const ox = (i === 0 ? -5.2 : 5.2) + R(-0.8, 0.8);
            const oz = (i === 0 ? 4.8 : -4.8) + R(-1.2, 1.2);
            const cry = R(0, 6.28);
            const [bx0, bx1, bz0, bz1] = rotBoxExtents(cx + ox, cz + oz, 2.0, 4.5, cry);
            if (canPlaceBox(bx0, bx1, bz0, bz1, 0.5)) {
              car(cx + ox, cz + oz, cry, { flipped: rand() < 0.2 });
              reserveBox(bx0, bx1, bz0, bz1, 'car');
              break;
            }
          }
        }
      } else if (kind === 'park') {
        for (let i = 0; i < 4; i++) {
          for (let tries = 0; tries < 12; tries++) {
            const tx = cx + R(-6, 6), tz = cz + R(-6, 6), ts = R(0.8, 1.3);
            if (canPlaceBox(tx - 0.8, tx + 0.8, tz - 0.8, tz + 0.8, 0.4)) {
              tree(tx, tz, ts, rand() < 0.7);
              reserveBox(tx - 0.6, tx + 0.6, tz - 0.6, tz + 0.6, 'park');
              break;
            }
          }
        }
        // grounded park bench with legs and backrest (avoid trees & sidewalks)
        for (let tries = 0; tries < 12; tries++) {
          const bx = cx + R(-4, 4), bz = cz + R(-4, 4), bry = R(0, 3);
          const [bx0, bx1, bz0, bz1] = rotBoxExtents(bx, bz, 2.0, 0.65, bry);
          if (!canPlaceBox(bx0, bx1, bz0, bz1, 0.4)) continue;
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
          reserveBox(bx - hw, bx + hw, bz - hd, bz + hd, 'park');
          break;
        }
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

      // rooftop clutter (skipped on presets that build dedicated walkable rooftop layouts)
      if (!opts.skipRoofClutter) {
        const inSafeZone = (px, pz) => {
          if (!opts.roofAccess || !F) return false;
          const rz = opts.roofSafeZone;
          if (!rz) return false;
          const [rx0, rx1, rz0, rz1] = F.rect(rz.a0, rz.a1, rz.b0, rz.b1);
          return px > rx0 && px < rx1 && pz > rz0 && pz < rz1;
        };
        const roofBase = opts.roofAccess ? (H + 0.4) : H;
        const r = rand();
        if (r < 0.45) {   // water tank on stilts (low-poly 8-sided)
          const tx = cx + R(-w / 4, w / 4), tz = cz + R(-d / 4, d / 4);
          if (!inSafeZone(tx, tz)) {
            decoCyl(M.wood, 1.1, 1.1, 2.0, tx, roofBase + 2.4, tz, 8); decoCyl(M.roof, 0.05, 1.2, 0.6, tx, roofBase + 3.7, tz, 8);
            [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([a, b]) => decoBox(M.pole, 0.1, 1.4, 0.1, tx + a, roofBase + 0.7, tz + b));
            if (opts.roofAccess) collider(tx - 1.1, tx + 1.1, tz - 1.1, tz + 1.1, roofBase + 3.5, roofBase);
          }
        } else {
          for (let i = 0; i < 2; i++) {
            const ax = cx + R(-w / 3, w / 3), az = cz + R(-d / 3, d / 3);
            const aw = R(1, 1.6), ah = R(0.7, 1.0), ad = R(1, 1.5);
            if (!inSafeZone(ax, az)) {
              decoBox(M.metal, aw, ah, ad, ax, roofBase + ah * 0.5, az);
              if (opts.roofAccess) collider(ax - aw * 0.5, ax + aw * 0.5, az - ad * 0.5, az + ad * 0.5, roofBase + ah, roofBase);
            }
          }
        }
        if (rand() < 0.5) { decoBox(M.pole, 0.06, R(2.5, 4.5), 0.06, cx + R(-w / 3, w / 3), roofBase + 1.8, cz + R(-d / 3, d / 3)); }   // antenna
        {
          const vx = cx + R(-w / 3, w / 3), vz = cz + R(-d / 3, d / 3);
          if (!inSafeZone(vx, vz)) {
            decoBox(M.brick, 0.7, 1.4, 0.7, vx, roofBase + 0.7, vz);
            if (opts.roofAccess) collider(vx - 0.35, vx + 0.35, vz - 0.35, vz + 0.35, roofBase + 1.4, roofBase);
          }
        }
      }

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
    function furniture(type, x, z, yaw, len, kind, baseY) {
      const g = new THREE.Group();
      const P = (w, h, d, m, px, py, pz, rx, ry, rz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.rotation.set(rx || 0, ry || 0, rz || 0); g.add(o); return o; };
      const C = (rt, rb, h, m, px, py, pz) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 6), m); o.position.set(px, py, pz); g.add(o); return o; };
      const fy = baseY !== undefined ? baseY : 0.14;  // floor height inside
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
      collider(bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.max.y, fy);
    }

    // ---------- forced special lots ----------
    // key: "blockI,blockJ,lotX,lotZ" (lotX/lotZ = -1 | 1)
    const SPECIAL = {
      '0,2,1,-1': { type: 'enter', kind: 'house' },
      '1,0,-1,1': { type: 'enter', kind: 'shop' },          // near spawn (right)
      '2,0,-1,-1': { type: 'enter', kind: 'shop' },         // near spawn (left — Town Map v2.7.2+)
      '2,1,-1,-1': { type: 'enter', kind: 'office' },
      '3,1,1,1': { type: 'enter', kind: 'house' },
      '0,0,1,1': { type: 'enter', kind: 'office' },
      '1,1,1,1': { type: 'ruin' },                            // town centre devastation
      '1,3,1,1': { type: 'park' },
      '2,0,1,-1': { type: 'park' },
      '3,3,-1,-1': { type: 'parking' },
      '0,3,1,-1': { type: 'parking' },
    };
    let sheriffKey = '2,0,-1,1';
    if (!LO.ver || LO.ver().randomSheriff) {
      const candidates = [];
      for (let bi = 0; bi < NB; bi++) for (let bj = 0; bj < NB; bj++) {
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
          const k = `${bi},${bj},${lx},${lz}`;
          if (!SPECIAL[k]) candidates.push(k);
        }
      }
      if (candidates.length) {
        const skPick = opts.seed !== undefined ? rand : Math.random;
        sheriffKey = candidates[(skPick() * candidates.length) | 0];
      }
    }

    let enterCount = 0;
    W.spawnLeftBuilding = null;
    for (let bi = 0; bi < NB; bi++) for (let bj = 0; bj < NB; bj++) {
      const bx = BLOCK_C[bi], bz = BLOCK_C[bj];
      for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
        const cx = bx + lx * 10, cz = bz + lz * 10;
        const key = `${bi},${bj},${lx},${lz}`;
        const sp = key === sheriffKey
          ? { type: 'enter', kind: 'police', sheriff: true }
          : SPECIAL[key];
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
          const entOpts = sp && key === '2,0,-1,-1' ? Object.assign({}, sp, { isSpawnLeft: true }) : sp;
          buildEnterable(cx, cz, L, D, Math.max(H, 6), axis, sign, (sp && sp.kind) || pick(['house', 'shop', 'office', 'house']), entOpts);
          if (key === '2,0,-1,-1') W.spawnLeftBuilding = W.enterables[W.enterables.length - 1];
        } else if (type === 'closed') {
          buildClosed(cx, cz, L, D, H, axis, sign);
        } else if (type === 'ruin') {
          buildRuin(cx, cz, L, D);
        } else {
          buildLot(cx, cz, type);
          W.openLots.push({ cx, cz, type });
        }
      }
      // dumpster in each block's central alley (checked against buildings, doorways & dumpsters)
      const tryPlaceDumpster = (dx, dz, ry, pad) => {
        const [bx0, bx1, bz0, bz1] = rotBoxExtents(dx, dz, 2.3, 1.38, ry);
        const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
        const ex = dx + front.x * 1.4, ez = dz + front.z * 1.4;
        if (!canPlaceBox(bx0, bx1, bz0, bz1, pad || 0.3)) return false;
        if (!canPlaceBox(ex - 0.6, ex + 0.6, ez - 0.6, ez + 0.6, 0.1)) return false;
        dumpster(dx, dz, ry);
        reserveBox(Math.min(bx0, ex - 0.5), Math.max(bx1, ex + 0.5), Math.min(bz0, ez - 0.5), Math.max(bz1, ez + 0.5), 'dumpster');
        return true;
      };
      for (let tries = 0; tries < 10; tries++) {
        const ry = rand() < 0.5 ? 0 : Math.PI / 2;
        const dx = bx + (ry ? R(-1.2, 1.2) : R(-11, 11));
        const dz = bz + (ry ? R(-11, 11) : R(-1.2, 1.2));
        if (tryPlaceDumpster(dx, dz, ry + (rand() < 0.5 ? Math.PI : 0), 0.35)) break;
      }
    }
    // Assign deterministic human-readable POI labels to every enterable building
    {
      let hIdx = 0, sIdx = 0, oIdx = 0;
      W.enterables.forEach(ent => {
        if (ent.sheriff) {
          ent.poiLabel = 'Sheriff HQ';
          ent.poiShort = 'SHERIFF HQ';
        } else if (ent.kind === 'shop') {
          sIdx++;
          ent.poiLabel = `Shop ${sIdx}`;
          ent.poiShort = `SHOP ${sIdx}`;
        } else if (ent.kind === 'office') {
          oIdx++;
          ent.poiLabel = `Office ${oIdx}`;
          ent.poiShort = `OFFICE ${oIdx}`;
        } else {
          hIdx++;
          ent.poiLabel = `House ${hIdx}`;
          ent.poiShort = `HOUSE ${hIdx}`;
        }
        if (ent.building) {
          ent.building.poiLabel = ent.poiLabel;
          ent.building.poiShort = ent.poiShort;
        }
      });
    }

    // =========================================================
    //  STREET DRESSING (all validated against doorways, buildings & each other)
    // =========================================================
    // lamps along streets
    let lampI = 0;
    STREETS.forEach((s, i) => {
      for (let k = 0; k < NB; k++) {
        const along = BLOCK_C[k];
        const side = (k + i) % 2 ? 1 : -1;
        const st = lampI++ % 7 === 3 ? 'flicker' : (rand() < 0.15 ? 'bent' : 'off');
        const lx1 = s + side * (ST / 2 + 0.7), lz1 = along + R(-6, 6);
        if (canPlaceBox(lx1 - 0.5, lx1 + 0.5, lz1 - 0.5, lz1 + 0.5, 0.4)) {
          streetLamp(lx1, lz1, side > 0 ? -Math.PI / 2 : Math.PI / 2, st);
          reserveBox(lx1 - 0.4, lx1 + 0.4, lz1 - 0.4, lz1 + 0.4, 'lamp');
        }
        if (rand() < 0.5) {
          const lx2 = along + R(-6, 6), lz2 = s + side * (ST / 2 + 0.7);
          if (canPlaceBox(lx2 - 0.5, lx2 + 0.5, lz2 - 0.5, lz2 + 0.5, 0.4)) {
            streetLamp(lx2, lz2, side > 0 ? Math.PI : 0, rand() < 0.12 ? 'bent' : 'off');
            reserveBox(lx2 - 0.4, lx2 + 0.4, lz2 - 0.4, lz2 + 0.4, 'lamp');
          }
        }
      }
    });
    // abandoned cars on the streets (keep intersections, doorways & other cars/lamps clear)
    for (let i = 0; i < 18; i++) {
      for (let tries = 0; tries < 14; tries++) {
        const s = pick(STREETS), along = pick(BLOCK_C) + R(-11, 11);
        const lane = pick([-3, 3]);
        const vertical = rand() < 0.5;
        const cx0 = vertical ? s + lane : along;
        const cz0 = vertical ? along : s + lane;
        const ry = vertical ? (R(-0.3, 0.3) + (lane > 0 ? 0 : Math.PI)) : (Math.PI / 2 + R(-0.3, 0.3) + (lane > 0 ? Math.PI : 0));
        if (nearIntersection(cx0, cz0, 1.8)) continue;
        const [bx0, bx1, bz0, bz1] = rotBoxExtents(cx0, cz0, 2.0, 4.5, ry);
        if (!canPlaceBox(bx0, bx1, bz0, bz1, 0.65)) continue;
        car(cx0, cz0, ry, { flipped: rand() < 0.15 });
        reserveBox(bx0, bx1, bz0, bz1, 'car');
        break;
      }
    }
    // street-side dumpsters (keep doorways, buildings, cars & lamps clear)
    for (let i = 0; i < 8; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const bx = pick(BLOCK_C), bz = pick(BLOCK_C);
        const side = pick([-1, 1]);
        const vert = rand() < 0.5;
        const dx = vert ? bx + side * (BLOCK / 2 - 1.2) : bx + R(-13, 13);
        const dz = vert ? bz + R(-13, 13) : bz + side * (BLOCK / 2 - 1.2);
        const ry = vert ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
        const [bx0, bx1, bz0, bz1] = rotBoxExtents(dx, dz, 2.3, 1.38, ry);
        const front = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
        const ex = dx + front.x * 1.4, ez = dz + front.z * 1.4;
        if (!canPlaceBox(bx0, bx1, bz0, bz1, 0.35) || !canPlaceBox(ex - 0.6, ex + 0.6, ez - 0.6, ez + 0.6, 0.1)) continue;
        dumpster(dx, dz, ry);
        reserveBox(Math.min(bx0, ex - 0.5), Math.max(bx1, ex + 0.5), Math.min(bz0, ez - 0.5), Math.max(bz1, ez + 0.5), 'dumpster');
        break;
      }
    }
    // additional exterior dumpsters covering perimeter & open dead zones (v2.4.3+, shifted cleanly if blocked by doorways/buildings)
    if (!LO.ver || LO.ver().fastoneV2) {
      [
        [-92.0, -96.0, Math.PI],
        [59.8, 90.0, -Math.PI / 2],
        [-96.8, 25.0, -Math.PI / 2],
        [44.5, -96.2, Math.PI],
      ].forEach(([dx, dz, dry]) => {
        const offsets = [[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5], [5, 5], [-5, -5]];
        for (const [ox, oz] of offsets) {
          const cx0 = dx + ox, cz0 = dz + oz;
          const [bx0, bx1, bz0, bz1] = rotBoxExtents(cx0, cz0, 2.3, 1.38, dry);
          const front = new THREE.Vector3(Math.sin(dry), 0, Math.cos(dry));
          const ex = cx0 + front.x * 1.4, ez = cz0 + front.z * 1.4;
          if (canPlaceBox(bx0, bx1, bz0, bz1, 0.25) && canPlaceBox(ex - 0.5, ex + 0.5, ez - 0.5, ez + 0.5, 0.05)) {
            dumpster(cx0, cz0, dry);
            reserveBox(Math.min(bx0, ex - 0.5), Math.max(bx1, ex + 0.5), Math.min(bz0, ez - 0.5), Math.max(bz1, ez + 0.5), 'dumpster');
            break;
          }
        }
      });
    }
    // large municipal power transformers & industrial backup generators along utility pads/alleys (noisy ground-level landmarks)
    function powerUnit(x, z, ry) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 1.5), M.concrete); pad.position.y = 0.08; g.add(pad);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.55, 1.15), M.metal); cab.position.y = 0.935; g.add(cab);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.10, 1.22), M.iron); lid.position.y = 1.74; g.add(lid);
      // side cooling radiator fins + exhaust stack + porcelain bushings + caution beacon
      [-0.7, -0.35, 0, 0.35, 0.7].forEach(fx => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 1.24), M.iron); fin.position.set(fx, 0.95, 0); g.add(fin);
      });
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.55, 6), M.pole); vent.position.set(-0.65, 2.02, -0.2); g.add(vent);
      [0.2, 0.55].forEach(ix => {
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.38, 6), M.dark); ins.position.set(ix, 1.96, 0.2); g.add(ins);
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.04), M.dark); panel.position.set(0.48, 1.02, 0.58); g.add(panel);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), M.amberBeacon); led.position.set(0.58, 1.18, 0.59); g.add(led);
      g.position.set(x, 0, z); g.rotation.y = ry;
      add(g);
      addOccluder(cab);
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const hw = (2.3 * c + 1.5 * s) / 2, hd2 = (2.3 * s + 1.5 * c) / 2;
      collider(x - hw, x + hw, z - hd2, z + hd2, 2.0, 0);
      W.noisyObjects.push({ x, y: 1.0, z, radius: 6.8, strength: 1.0, kind: 'generator' });
    }
    {
      let placedUnits = 0;
      const trySites = [
        [-78, -60, 0], [-26, -96, Math.PI / 2], [26, -60, 0], [78, -26, Math.PI / 2],
        [-78, 26, Math.PI / 2], [-26, 78, 0], [26, 26, Math.PI / 2], [78, 78, 0],
        [-45, -26, 0], [45, 26, 0], [-26, 45, Math.PI / 2], [26, -45, Math.PI / 2],
      ];
      for (const [ux, uz, ury] of trySites) {
        if (placedUnits >= 6) break;
        const tries = [[0, 0], [2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]];
        for (const [ox, oz] of tries) {
          const px = ux + ox, pz = uz + oz;
          const [bx0, bx1, bz0, bz1] = rotBoxExtents(px, pz, 2.4, 1.6, ury);
          if (canPlaceBox(bx0, bx1, bz0, bz1, 0.65)) {
            powerUnit(px, pz, ury);
            reserveBox(bx0, bx1, bz0, bz1, 'generator');
            placedUnits++;
            break;
          }
        }
      }
    }
    // outdoor batteries
    {
      const freeSpot = (cx, cz, pad) => !W.colliders.some(c =>
        !c.disabled && c.minY < 1.5 && c.maxY > 0.05 &&
        cx + pad > c.minX && cx - pad < c.maxX && cz + pad > c.minZ && cz - pad < c.maxZ
      ) && canPlaceBox(cx - pad, cx + pad, cz - pad, cz + pad, 0.2);
      const bTries = [[0, 0], [2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4], [3.5, 2.5], [-3.5, -2.5], [4.2, -2.2], [-4.2, 2.2]];
      [[-58, -20], [47, 58], [-20, 47], [56, -80], [-102, 70], [80, 100], [4, -40]].forEach(([x, z]) => {
        for (const [ox, oz] of bTries) {
          const bx = x + ox, bz = z + oz;
          if (freeSpot(bx, bz, 0.5)) {
            battery(bx, 0.4, bz);
            reserveBox(bx - 0.45, bx + 0.45, bz - 0.45, bz + 0.45, 'battery');
            break;
          }
        }
      });
    }
    // throwable rocks lying around (sparse — you only find one occasionally)
    {
      const rg = new THREE.DodecahedronGeometry(0.14);
      const rm = mat({ color: 0x77736c });
      for (let i = 0; i < 16; i++) {
        let rx = 0, rz = 0, ok = false;
        for (let t = 0; t < 16; t++) {
          const s = pick(STREETS), a = R(-HALF + 10, HALF - 10), off = R(-4.5, 4.5);
          const v = rand() < 0.5;
          const cx = v ? s + off : a, cz = v ? a : s + off;
          if (canPlaceBox(cx - 0.4, cx + 0.4, cz - 0.4, cz + 0.4, 0.2) &&
            !W.colliders.some(c => !c.disabled && c.minY < 0.8 && c.maxY > 0.02 && cx + 0.45 > c.minX && cx - 0.45 < c.maxX && cz + 0.45 > c.minZ && cz - 0.45 < c.maxZ)) {
            rx = cx; rz = cz; ok = true; break;
          }
        }
        if (!ok) continue;
        const m = new THREE.Mesh(rg, rm);
        m.userData.keepDynamic = true;
        m.position.set(rx, 0.12, rz);
        m.rotation.set(R(0, 3), R(0, 3), 0);
        W.root.add(m);
        W.pickups.push({ type: 'rock', mesh: m, pos: m.position, baseY: 0.12, taken: false, still: true });
      }
    }
    // debris (instanced in 2 draw calls instead of 40, grounded flush on street)
    {
      const dg = new THREE.BoxGeometry(1, 1, 1);
      const dmR = new THREE.InstancedMesh(dg, M.rubble, 20);
      const dmW = new THREE.InstancedMesh(dg, M.wood, 20);
      if (shadows) { dmR.receiveShadow = true; dmW.receiveShadow = true; }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler();
      const sc = new THREE.Vector3(), pos = new THREE.Vector3();
      let iR = 0, iW = 0;
      for (let i = 0; i < 40; i++) {
        let px = 0, pz = 0, ok = false;
        const h = R(0.1, 0.4);
        for (let t = 0; t < 10; t++) {
          const s = pick(STREETS), a = R(-HALF + 8, HALF - 8), v = rand() < 0.5;
          const cx = v ? s + R(-5, 5) : a, cz = v ? a : s + R(-5, 5);
          if (canPlaceBox(cx - 0.8, cx + 0.8, cz - 0.8, cz + 0.8, 0.2) &&
            !W.colliders.some(c => !c.disabled && c.minY < 0.9 && c.maxY > 0.02 && cx + 0.8 > c.minX && cx - 0.8 < c.maxX && cz + 0.8 > c.minZ && cz - 0.8 < c.maxZ)) {
            px = cx; pz = cz; ok = true; break;
          }
        }
        if (!ok) continue;
        q.setFromEuler(eu.set(0, R(0, 3), 0));
        m4.compose(pos.set(px, h * 0.5, pz), q, sc.set(R(0.3, 1.2), h, R(0.3, 1.2)));
        if (rand() < 0.5 && iR < 20) dmR.setMatrixAt(iR++, m4);
        else if (iW < 20) dmW.setMatrixAt(iW++, m4);
        else if (iR < 20) dmR.setMatrixAt(iR++, m4);
      }
      dmR.count = iR; dmW.count = iW;
      dmR.instanceMatrix.needsUpdate = true; dmW.instanceMatrix.needsUpdate = true;
      W.root.add(dmR, dmW);
    }

    // =========================================================
    //  TOWN EDGE, ENTRANCE, FOREST
    // =========================================================
    // playable perimeter (v2.7+ opens a ~39m Woodland Perimeter Ring outside town fences)
    const forestRing = !LO.ver || !!LO.ver().forestRing;
    const E = HALF + 3;
    const OUTER_E = forestRing ? HALF + 42 : E;
    W.E = E;
    W.OUTER_E = OUTER_E;
    W.isForest = function (p) {
      if (!forestRing || !p) return false;
      const ax = Math.abs(p.x), az = Math.abs(p.z);
      return (ax > E || az > E) && ax <= OUTER_E + 2 && az <= OUTER_E + 2;
    };
    W.forestProximity = function (p) {
      if (!forestRing || !p) return 0;
      const d = Math.max(Math.abs(p.x), Math.abs(p.z));
      return Math.max(0, Math.min(1, (d - (HALF - 18)) / 36));
    };
    collider(-OUTER_E - 5, -OUTER_E, -OUTER_E - 5, OUTER_E + 5);
    collider(OUTER_E, OUTER_E + 5, -OUTER_E - 5, OUTER_E + 5);
    collider(-OUTER_E, OUTER_E, OUTER_E, OUTER_E + 5);
    collider(-OUTER_E, OUTER_E, -OUTER_E - 5, -OUTER_E);
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
    // Static perimeter wing panels bridging [-112.5..-110.0] (2.5m corner gap) and [+112.0..+112.5] (0.5m end seam)
    const makeWingFenceGeo = (width, slatXs) => {
      const list = [];
      const addPart = (w, h, d, x, y, z, cr, cg, cb, verticalGrain) => {
        const g = new THREE.BoxGeometry(w, h, d);
        const uvs = g.attributes.uv;
        for (let i = 0; i < uvs.count; i++) {
          const u = uvs.getX(i), v = uvs.getY(i);
          if (verticalGrain) uvs.setXY(i, v * 0.85, u * 0.45);
          else uvs.setXY(i, u * 1.4, v * 0.35);
        }
        g.translate(x, y, z);
        const nonIdx = g.index ? g.toNonIndexed() : g;
        if (g.index) g.dispose();
        const cnt = nonIdx.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb; }
        nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
        list.push(nonIdx);
      };
      addPart(width, 0.10, 0.06, 0, 0.44, -0.04, 0.56, 0.51, 0.45, false);
      addPart(width, 0.10, 0.06, 0, 1.92, -0.04, 0.56, 0.51, 0.45, false);
      addPart(width, 0.035, 0.035, 0, 2.28, 0, 0.24, 0.25, 0.27, false);
      slatXs.forEach((sx, idx) => {
        const shade = 0.62 + ((idx * 29) % 5) * 0.045;
        addPart(0.22, 2.04, 0.045, sx, 0.12 + 1.02, 0.03, shade, shade * 0.94, shade * 0.85, true);
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
    };
    const wingFenceGeo25 = makeWingFenceGeo(2.54, [-0.90, -0.45, 0.0, 0.45, 0.90]);
    const wingFenceGeo06 = makeWingFenceGeo(0.62, [0.0]);
    [[0, E - 0.5, 0], [0, -E + 0.5, 0], [E - 0.5, 0, Math.PI / 2], [-E + 0.5, 0, Math.PI / 2]].forEach(([x, z, r]) => {
      // Seal negative (-112.5..-110.0) and positive (+112.0..+112.5) corner seams on all 4 sides
      [[-111.25, 1.32, wingFenceGeo25], [112.25, 0.38, wingFenceGeo06]].forEach(([off, halfSpan, wGeo]) => {
        const wx = r ? x : off, wz = r ? off : z;
        const wm = new THREE.Mesh(wGeo, fenceMat);
        wm.position.set(wx, 0, wz); wm.rotation.y = r;
        add(wm, { cast: false });
        if (r) collider(wx - 0.22, wx + 0.22, wz - halfSpan, wz + halfSpan, 2.4);
        else collider(wx - halfSpan, wx + halfSpan, wz - 0.22, wz + 0.22, 2.4);
      });
      for (let k = -HALF; k < HALF; k += 6) {
        if (z < 0 && r === 0 && Math.abs(k + 3) < 7) continue; // entrance gap
        const px = r ? x : k + 3, pz = r ? k + 3 : z;
        // 3 permanent broken woodland trail gates (East -> Lookout, North -> Ranger Evidence, West -> Forest Loop)
        const isPermGate = forestRing && (
          (r !== 0 && x > 0 && Math.abs(pz - 27) < 3.1) ||
          (r === 0 && z > 0 && Math.abs(px + 27) < 3.1) ||
          (r !== 0 && x < 0 && Math.abs(pz + 27) < 3.1)
        );
        const p = new THREE.Mesh(fenceGeo, fenceMat);
        p.userData.keepDynamic = true;
        p.position.set(px, 0, pz);
        p.rotation.y = r;
        add(p, { cast: false });
        const col = r
          ? collider(px - 0.18, px + 0.18, pz - 3.0, pz + 3.0, 2.4)
          : collider(px - 3.0, px + 3.0, pz - 0.18, pz + 0.18, 2.4);
        if (isPermGate) {
          p.visible = false;
          col.disabled = true;
          // permanent weathered gate posts & fallen gate slats framing the woodland trail entry
          const alongX = r === 0;
          [-2.91, 2.91].forEach(off => {
            const gx = px + (alongX ? off : 0), gz = pz + (alongX ? 0 : off);
            decoBox(M.trim, 0.22, 2.42, 0.22, gx, 1.21, gz);
            decoBox(M.trim, 0.28, 0.09, 0.28, gx, 2.46, gz);
            collider(gx - 0.16, gx + 0.16, gz - 0.16, gz + 0.16, 2.4);
          });
          decoBox(M.wood, 0.20, 0.05, 1.85, px + (alongX ? -0.9 : 1.2), 0.04, pz + (alongX ? 1.1 : -0.8), 0, 0.42, 0);
          decoBox(M.wood, 0.18, 0.05, 1.55, px + (alongX ? 1.1 : -1.1), 0.04, pz + (alongX ? -0.9 : 0.9), 0, -0.55, 0);
        }
        W.fences.push({
          mesh: p,
          pos: new THREE.Vector3(px, 1.1, pz),
          basePos: p.position.clone(),
          baseRot: p.rotation.clone(),
          axis: r ? 'z' : 'x',
          collider: col,
          broken: isPermGate,
          permanentGate: isPermGate,
        });
      }
    });
    // corner & entrance end-posts so every fence run terminates cleanly on a solid post
    [[-E + 0.5, -E + 0.5], [E - 0.5, -E + 0.5], [-E + 0.5, E - 0.5], [E - 0.5, E - 0.5], [-8, -E + 0.5], [4, -E + 0.5]].forEach(([ex, ez]) => {
      decoBox(M.trim, 0.20, 2.38, 0.20, ex, 1.19, ez);
      decoBox(M.trim, 0.24, 0.08, 0.24, ex, 2.41, ez);
      collider(ex - 0.16, ex + 0.16, ez - 0.16, ez + 0.16, 2.4);
    });
    // remodeled Type-III municipal / police roadblock barricades at entrance road (z = -E - 1)
    {
      const barRoot = new THREE.Group();
      barRoot.userData.keepDynamic = true;
      W.root.add(barRoot);
      const rammedDebris = new THREE.Group();
      barRoot.add(rammedDebris);
      const plankGeo = new THREE.BoxGeometry(2.36, 0.26, 0.055);
      const postGeo = new THREE.BoxGeometry(0.065, 1.24, 0.065);
      const skidGeo = new THREE.BoxGeometry(0.08, 0.06, 1.08);
      const strutGeo = new THREE.BoxGeometry(0.05, 0.92, 0.05);
      const braceGeo = new THREE.BoxGeometry(2.05, 0.05, 0.05);
      const placardGeo = new THREE.BoxGeometry(1.18, 0.34, 0.032);
      const placardMats = [M.dark, M.dark, M.dark, M.dark, M.roadClosed, M.roadClosed];
      const coneGeo = new THREE.CylinderGeometry(0.05, 0.18, 0.58, 10);
      const coneBaseGeo = new THREE.BoxGeometry(0.38, 0.04, 0.38);
      const coneRingGeo = new THREE.CylinderGeometry(0.095, 0.125, 0.13, 10);

      const barSpecs = [
        { x: -4.4, z: -E - 1, ry: 0.06, hit: true,  ramPos: [-5.65, 0.06, -E + 1.4], ramRot: [-1.42, 0.55, 0.22] },
        { x: -1.6, z: -E - 1, ry: -0.04, hit: true, ramPos: [-0.35, 0.06, -E + 1.9], ramRot: [-1.48, -0.78, -0.18] },
        { x:  1.4, z: -E - 1, ry: 0.05, hit: false, ramPos: [ 1.65, 0.0,  -E - 0.85], ramRot: [0, 0.22, 0] },
        { x:  4.3, z: -E - 1, ry: -0.07, hit: false, ramPos: [ 4.35, 0.0,  -E - 1.05], ramRot: [0, -0.12, 0] },
      ];
      barSpecs.forEach((sp, idx) => {
        const g = new THREE.Group();
        // twin galvanized skids & A-frame steel legs
        [-0.96, 0.96].forEach(lx => {
          const sk = new THREE.Mesh(skidGeo, M.iron); sk.position.set(lx, 0.03, 0); g.add(sk);
          const up = new THREE.Mesh(postGeo, M.iron); up.position.set(lx, 0.64, -0.03); g.add(up);
          const st = new THREE.Mesh(strutGeo, M.iron); st.position.set(lx, 0.44, 0.26); st.rotation.x = -0.48; g.add(st);
          const stB = new THREE.Mesh(strutGeo, M.iron); stB.position.set(lx, 0.44, -0.26); stB.rotation.x = 0.48; g.add(stB);
        });
        const br = new THREE.Mesh(braceGeo, M.iron); br.position.set(0, 0.22, -0.03); g.add(br);
        // twin reflective hazard rails + ROAD CLOSED sign plate
        const rTop = new THREE.Mesh(plankGeo, M.barricade); rTop.position.set(0, 1.06, 0.02); g.add(rTop);
        const rLow = new THREE.Mesh(plankGeo, M.barricade); rLow.position.set(0, 0.62, 0.02); g.add(rLow);
        const signPl = new THREE.Mesh(placardGeo, placardMats); signPl.position.set(0, 0.86, 0.06); g.add(signPl);
        // top amber barricade warning lamp on outer post
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.1), M.dark);
        housing.position.set(idx < 2 ? -0.96 : 0.96, 1.32, 0); g.add(housing);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 8), M.amberBeacon);
        lens.rotation.x = Math.PI / 2; lens.position.set(idx < 2 ? -0.96 : 0.96, 1.32, 0); g.add(lens);

        if (shadows) g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        barRoot.add(g);
        mergeSubtreeByMaterial(g, { target: g });
        W.barricades.push({
          group: g,
          hit: sp.hit,
          basePos: new THREE.Vector3(sp.x, 0, sp.z),
          baseRot: new THREE.Euler(0, sp.ry, 0),
          ramPos: new THREE.Vector3(sp.ramPos[0], sp.ramPos[1], sp.ramPos[2]),
          ramRot: new THREE.Euler(sp.ramRot[0], sp.ramRot[1], sp.ramRot[2]),
        });
      });

      // scattered broken wooden/striped barricade planks left across the car's rammed lane
      const splinters = [
        [-3.8, 0.03, -E - 0.1, 0.02, 0.48, 0.04, 1.25],
        [-2.3, 0.03, -E + 0.7, -0.03, -0.62, 0.02, 1.05],
        [-3.1, 0.035, -E + 2.2, 0.04, 1.15, -0.05, 0.9],
        [-4.9, 0.03, -E + 0.4, 0.02, -0.35, 0.06, 0.85],
        [-1.1, 0.03, -E + 1.1, -0.04, 0.85, 0.02, 0.75],
      ];
      splinters.forEach(([sx, sy, sz, rx, ry, rz, len], i) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.22), i % 2 === 0 ? M.barricade : M.wood);
        m.position.set(sx, sy, sz);
        m.rotation.set(rx, ry, rz);
        if (shadows) { m.castShadow = true; m.receiveShadow = true; }
        rammedDebris.add(m);
      });

      // orange reflective traffic cones flanking & knocked beside the roadblock
      const makeCone = (x, y, z, rx, ry, rz) => {
        const cg = new THREE.Group();
        const b = new THREE.Mesh(coneBaseGeo, M.dark); b.position.y = 0.02; cg.add(b);
        const c = new THREE.Mesh(coneGeo, M.coneOrange); c.position.y = 0.31; cg.add(c);
        const rf = new THREE.Mesh(coneRingGeo, M.coneReflect); rf.position.y = 0.36; cg.add(rf);
        cg.position.set(x, y, z); cg.rotation.set(rx || 0, ry || 0, rz || 0);
        return cg;
      };
      const coneUpright1 = makeCone(-5.7, 0, -E - 1.3, 0, 0.2, 0);
      const coneUpright2 = makeCone(5.6, 0, -E - 1.1, 0, -0.3, 0);
      const coneKnocked = makeCone(-1.9, 0.16, -E + 2.6, 1.48, 0.9, 0);
      const coneKnockedIntact = makeCone(-3.0, 0, -E - 1.5, 0, 0.4, 0);
      W.root.add(coneUpright1, coneUpright2);
      rammedDebris.add(coneKnocked);
      const intactExtras = new THREE.Group();
      intactExtras.add(coneKnockedIntact);
      barRoot.add(intactExtras);
      mergeSubtreeByMaterial(rammedDebris, { target: rammedDebris });
      mergeSubtreeByMaterial(intactExtras, { target: intactExtras });

      W.setBarricadesIntact = function () {
        W.barricades.forEach(b => {
          b.group.position.copy(b.basePos);
          b.group.rotation.copy(b.baseRot);
        });
        rammedDebris.visible = false;
        intactExtras.visible = true;
      };
      W.setBarricadesRammed = function () {
        W.barricades.forEach(b => {
          b.group.position.copy(b.ramPos);
          b.group.rotation.copy(b.ramRot);
        });
        rammedDebris.visible = true;
        intactExtras.visible = false;
      };
      W.setBarricadesRammed();
      // Static left shoulder Type-III barricade wing sealing x = -8.0..-5.7 between fence post and main roadblock
      const sg = new THREE.Group();
      [-0.96, 0.96].forEach(lx => {
        const sk = new THREE.Mesh(skidGeo, M.iron); sk.position.set(lx, 0.03, 0); sg.add(sk);
        const up = new THREE.Mesh(postGeo, M.iron); up.position.set(lx, 0.64, -0.03); sg.add(up);
        const st = new THREE.Mesh(strutGeo, M.iron); st.position.set(lx, 0.44, 0.26); st.rotation.x = -0.48; sg.add(st);
        const stB = new THREE.Mesh(strutGeo, M.iron); stB.position.set(lx, 0.44, -0.26); stB.rotation.x = 0.48; sg.add(stB);
      });
      const sBr = new THREE.Mesh(braceGeo, M.iron); sBr.position.set(0, 0.22, -0.03); sg.add(sBr);
      const sTop = new THREE.Mesh(plankGeo, M.barricade); sTop.position.set(0, 1.06, 0.02); sg.add(sTop);
      const sLow = new THREE.Mesh(plankGeo, M.barricade); sLow.position.set(0, 0.62, 0.02); sg.add(sLow);
      sg.position.set(-6.85, 0, -E - 0.15); sg.rotation.y = 0.08;
      if (shadows) sg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      W.root.add(sg);
    }
    collider(-8.2, 6.2, -E - 2.2, -E + 0.6, 2.6);
    // welcome sign beside the south road (2:1 reflective highway signboard on twin steel posts)
    {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.25, 0.14), M.iron);
      board.position.set(0, 3.55, -0.075);
      g.add(board);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 3.15), M.sign);
      s.position.set(0, 3.55, 0.01);
      g.add(s);
      [-2.5, 2.5].forEach(x => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.2, 0.16), M.pole);
        p.position.set(x, 2.6, -0.15);
        g.add(p);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.42), M.concrete);
        foot.position.set(x, 0.12, -0.15);
        g.add(foot);
      });
      if (shadows) g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(-8, 0, -150); g.rotation.y = 0.15; add(g);
      W.sign = g;
    }
    // Playable Woodland Perimeter Ring (v2.7+): weaving dirt trails, town-styled outskirt buildings, Fire Lookout Tower, and navigable forest pines
    const treelinePerches = [];
    const ringPerches = [];
    if (forestRing) {
      // Reserve gate aprons, landmark clearings, south highway & hero pine corridor
      reserveBox(107, 121, 21, 33, 'trail');
      reserveBox(-33, -21, 107, 121, 'trail');
      reserveBox(-121, -107, -33, -21, 'trail');
      reserveBox(129.5, 146.5, 20.5, 33.5, 'landmark'); // Fire Lookout Tower clearing
      reserveBox(-34.5, -19.5, 130.5, 145.5, 'landmark'); // Wrecked Ranger Truck clearing
      reserveBox(-14, 14, -520, -HALF, 'road');
      reserveBox(10, 25, -176, -162, 'hero');

      // Outskirt buildings beyond the wooden fence: full town-styled models spaced with weaving paths between them
      const outskirtBoxes = [];
      for (const side of [0, 1, 2, 3]) {
        for (let k = -HALF - 10; k <= HALF + 10; ) {
          const step = R(25, 31);
          if (side === 1 && Math.abs(k) < 20) { k += step; continue; }
          const L = Math.round(R(10, 13)), D = Math.round(R(10, 12));
          const H = rand() < 0.65 ? R(7, 11) : R(12, 16);
          const axis = (side === 0 || side === 1) ? 'z' : 'x';
          const sign = (side === 0 || side === 2) ? -1 : 1;
          const d = HALF + R(16.5, 20.5);
          const cx = (side === 0 || side === 1) ? k : (side === 2 ? d : -d);
          const cz = (side === 0 || side === 1) ? (side === 0 ? d : -d) : k;
          const hw = (axis === 'z' ? L : D) * 0.5;
          const hd = (axis === 'z' ? D : L) * 0.5;
          if (canPlaceBox(cx - hw, cx + hw, cz - hd, cz + hd, 3.2)) {
            buildClosed(cx, cz, L, D, H, axis, sign, { outskirt: true });
            outskirtBoxes.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, cx, cz });
          }
          k += step;
        }
      }

      // Steer any trail point clear of outskirt buildings & landmarks so paths wind smoothly between structures
      const steerClear = (px, pz) => {
        let x = px, z = pz;
        const pad = 3.2;
        for (let pass = 0; pass < 3; pass++) {
          for (let bi = 0; bi < outskirtBoxes.length; bi++) {
            const b = outskirtBoxes[bi];
            if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) {
              const dl = Math.abs(x - (b.x0 - pad)), dr = Math.abs((b.x1 + pad) - x);
              const dt = Math.abs(z - (b.z0 - pad)), db = Math.abs((b.z1 + pad) - z);
              const m = Math.min(dl, dr, dt, db);
              if (m === dl) x = b.x0 - pad;
              else if (m === dr) x = b.x1 + pad;
              else if (m === dt) z = b.z0 - pad;
              else z = b.z1 + pad;
            }
          }
          x = Math.max(-(OUTER_E - 4.5), Math.min(OUTER_E - 4.5, x));
          z = Math.max(-(OUTER_E - 4.5), Math.min(OUTER_E - 4.5, z));
        }
        return [x, z];
      };

      const addTrailPath = (pts, width) => {
        const w = width || 4.0;
        const sampled = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const segLen = Math.hypot(bx - ax, bz - az);
          const steps = Math.max(1, Math.ceil(segLen / 5.5));
          for (let s = (i === 0 ? 0 : 1); s <= steps; s++) {
            const t = s / steps;
            const wave = Math.sin(t * Math.PI) * (s % 2 === 0 ? 1.1 : -1.1);
            const nx = segLen > 0.1 ? -(bz - az) / segLen : 0;
            const nz = segLen > 0.1 ? (bx - ax) / segLen : 0;
            const rawX = ax + (bx - ax) * t + nx * wave * (steps > 1 ? 1 : 0);
            const rawZ = az + (bz - az) * t + nz * wave * (steps > 1 ? 1 : 0);
            sampled.push(steerClear(rawX, rawZ));
          }
        }
        for (let i = 0; i < sampled.length - 1; i++) {
          const [ax, az] = sampled[i], [bx, bz] = sampled[i + 1];
          const dx = bx - ax, dz = bz - az;
          const segLen = Math.hypot(dx, dz);
          if (segLen < 0.25) continue;
          const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
          const ang = Math.atan2(dx, dz);
          const len = segLen + w * 0.36;
          box(w, 0.028, len, M.trail, mx, 0.015, mz, { ry: ang, collide: false, cast: false, tile: 4 });
          const [rx0, rx1, rz0, rz1] = rotBoxExtents(mx, mz, w + 0.8, len + 0.4, ang);
          reserveBox(rx0, rx1, rz0, rz1, 'trail');
        }
        W.trails.push({ pts: sampled, width: w });
      };

      // Weaving & winding dirt trails leading from the town gates, curving between outskirt buildings into the woods
      addTrailPath([[109, 27], [116, 28.5], [123, 25.2], [129, 27.4], [133.5, 27.0]], 4.0); // East gate -> Fire Lookout
      addTrailPath([[123, 25.2], [121, 46], [142, 66], [120, 88], [142, 110], [134, 136], [104, 121], [72, 143], [38, 121], [4, 142], [-27, 138]], 4.2); // NE woodland loop
      addTrailPath([[123, 25.2], [120, 2], [142, -24], [120, -52], [142, -82], [134, -118], [96, -142], [60, -120], [22, -138]], 4.2); // SE woodland loop
      addTrailPath([[-27, 109], [-24.5, 117], [-29.2, 125], [-27, 138]], 4.0); // North gate -> Ranger Evidence
      addTrailPath([[-27, 138], [-58, 121], [-94, 143], [-134, 134], [-142, 98], [-120, 62], [-142, 24], [-121, -8], [-135, -24]], 4.2); // NW woodland loop
      addTrailPath([[-109, -27], [-116.5, -24.5], [-125.5, -29.2], [-135, -24]], 4.0); // West gate -> West loop
      addTrailPath([[-135, -24], [-142, -56], [-120, -88], [-136, -126], [-102, -142], [-66, -120], [-22, -138]], 4.2); // SW woodland loop

      // Abandoned Fire Lookout Tower at (140, 0, 27): walkable timber stairs up to 4.6m observation deck + battery/rock stash
      {
        const lx = 140, lz = 27, deckY = 4.60, roofY = 7.05;
        W.lookout = { x: lx, z: lz };
        // 4 heavy corner stilts grounded cleanly at y = 0
        [[-2.25, -2.25], [2.25, -2.25], [-2.25, 2.25], [2.25, 2.25]].forEach(([ox, oz]) => {
          box(0.28, roofY, 0.28, M.wood, lx + ox, roofY * 0.5, lz + oz, { collide: true });
        });
        // diagonal cross-bracing between stilts
        [[-2.25, 2.25]].forEach(([a, b]) => {
          decoStrut(M.wood, lx + a, 0.3, lz + a, lx + b, deckY - 0.3, lz + a, 0.12, 0.12);
          decoStrut(M.wood, lx + b, 0.3, lz + a, lx + a, deckY - 0.3, lz + a, 0.12, 0.12);
          decoStrut(M.wood, lx + a, 0.3, lz + b, lx + b, deckY - 0.3, lz + b, 0.12, 0.12);
          decoStrut(M.wood, lx + b, 0.3, lz + b, lx + a, deckY - 0.3, lz + b, 0.12, 0.12);
        });
        // elevated timber observation deck + walkSurface
        boxAt(137.5, 142.5, deckY - 0.18, deckY, 24.5, 29.5, M.wood, { collide: false, occlude: true, tile: 3 });
        walkSurface({ type: 'flat', minX: 137.5, maxX: 142.5, minZ: 24.5, maxZ: 29.5, y: deckY });
        // perimeter deck guardrails (open stair entry on west side z in [26.2, 27.8])
        boxAt(137.5, 142.5, deckY + 0.96, deckY + 1.04, 24.46, 24.62, M.wood, { collide: true, minY: deckY });
        boxAt(137.5, 142.5, deckY + 0.48, deckY + 0.54, 24.48, 24.60, M.wood, { collide: false });
        boxAt(137.5, 142.5, deckY + 0.96, deckY + 1.04, 29.38, 29.54, M.wood, { collide: true, minY: deckY });
        boxAt(137.5, 142.5, deckY + 0.48, deckY + 0.54, 29.40, 29.52, M.wood, { collide: false });
        boxAt(142.38, 142.54, deckY + 0.96, deckY + 1.04, 24.5, 29.5, M.wood, { collide: true, minY: deckY });
        boxAt(142.40, 142.52, deckY + 0.48, deckY + 0.54, 24.5, 29.5, M.wood, { collide: false });
        boxAt(137.46, 137.62, deckY + 0.96, deckY + 1.04, 24.5, 26.2, M.wood, { collide: true, minY: deckY });
        boxAt(137.46, 137.62, deckY + 0.96, deckY + 1.04, 27.8, 29.5, M.wood, { collide: true, minY: deckY });
        // corrugated lookout cabin roof & trim fascia
        boxAt(137.1, 142.9, roofY, roofY + 0.22, 24.1, 29.9, M.roof, { collide: false, occlude: true, tile: 4 });
        boxAt(138.0, 142.0, roofY + 0.22, roofY + 0.48, 25.0, 29.0, M.roof, { collide: false, tile: 4 });
        // walkable timber stair ramp from trail (x=132.0) to deck (x=137.6) along z=27
        const sx0 = 132.0, sx1 = 137.6;
        walkSurface({ type: 'ramp', axis: 'x', minX: 131.6, maxX: 137.7, minZ: 26.2, maxZ: 27.8, u0: sx0, u1: sx1, y0: 0, y1: deckY });
        for (let si = 0; si < 14; si++) {
          const k = (si + 0.5) / 14;
          const tx = sx0 + (sx1 - sx0) * k;
          const ty = deckY * k;
          box(0.44, 0.08, 1.56, M.wood, tx, ty - 0.04, lz, { collide: false, tile: 2 });
        }
        [26.15, 27.85].forEach(sz => {
          decoStrut(M.wood, sx0, -0.05, sz, sx1, deckY - 0.05, sz, 0.14, 0.18);
          decoStrut(M.wood, sx0, 0.95, sz, sx1, deckY + 0.95, sz, 0.07, 0.07);
          decoBox(M.wood, 0.10, 1.05, 0.10, sx0 + 0.1, 0.52, sz);
          decoBox(M.wood, 0.10, deckY * 0.5 + 1.0, 0.10, (sx0 + sx1) * 0.5, (deckY * 0.5 + 1.0) * 0.5, sz);
        });
        collider(sx0, sx1, 25.98, 26.20, deckY + 1.4, 0);
        collider(sx0, sx1, 27.80, 28.02, deckY + 1.4, 0);
        // ranger supply desk & guaranteed battery + rock stash on the deck
        box(0.85, 0.78, 1.55, M.wood, 141.55, deckY + 0.39, lz, { collide: true, minY: deckY });
        battery(141.55, deckY + 1.04, 26.45);
        battery(141.55, deckY + 1.04, 27.55);
        const rockGeo = new THREE.DodecahedronGeometry(0.14);
        const rockMat = mat({ color: 0x77736c });
        [[138.7, 25.3], [139.2, 28.6], [140.4, 25.4]].forEach(([rx, rz]) => {
          const rm = new THREE.Mesh(rockGeo, rockMat);
          rm.userData.keepDynamic = true;
          rm.position.set(rx, deckY + 0.12, rz);
          rm.rotation.set(R(0, 3), R(0, 3), 0);
          W.root.add(rm);
          W.pickups.push({ type: 'rock', mesh: rm, pos: rm.position, baseY: deckY + 0.12, taken: false, still: true });
        });
      }
    } else {
      // legacy v1.0–v2.6.3 outskirts: backdrop ring beyond the fence
      for (const side of [0, 1, 2, 3]) {
        for (let k = -HALF - 20; k < HALF + 20; k += R(13, 17)) {
          if (side === 1 && Math.abs(k) < 16) continue;
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
    }

    // forest outside town (remodeled multi-tier pine InstancedMesh: 2 draw calls total, visible in cutscene & in-game)
    W.treeColliders = [];
    const TREE_CELL = 16;
    const _treeGrid = new Map();
    const recordTreeTrunk = (x, z, r) => {
      const item = { x, z, r, r2: r * r };
      W.treeColliders.push(item);
      const gx = Math.floor(x / TREE_CELL), gz = Math.floor(z / TREE_CELL);
      const key = ((gx + 256) << 12) | (gz + 256);
      let b = _treeGrid.get(key);
      if (!b) { b = []; _treeGrid.set(key, b); }
      b.push(item);
    };
    W.segmentHitsTree = function (ax, az, bx, bz) {
      const minX = Math.min(ax, bx) - 1, maxX = Math.max(ax, bx) + 1;
      const minZ = Math.min(az, bz) - 1, maxZ = Math.max(az, bz) + 1;
      const gx0 = Math.floor(minX / TREE_CELL), gx1 = Math.floor(maxX / TREE_CELL);
      const gz0 = Math.floor(minZ / TREE_CELL), gz1 = Math.floor(maxZ / TREE_CELL);
      const abx = bx - ax, abz = bz - az;
      const len2 = abx * abx + abz * abz;
      if (len2 < 1e-6) return false;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const bucket = _treeGrid.get(((gx + 256) << 12) | (gz + 256));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const tr = bucket[i];
            let t = ((tr.x - ax) * abx + (tr.z - az) * abz) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const dx = ax + abx * t - tr.x, dz = az + abz * t - tr.z;
            if (dx * dx + dz * dz <= tr.r2) return true;
          }
        }
      }
      return false;
    };
    {
      const n = S.quality === 'low' ? 540 : S.viewDistance === 'near' ? 820 : 1320;
      const trunk = new THREE.InstancedMesh(pineTrunkGeo, M.pineBark, n);
      const top = new THREE.InstancedMesh(pineCrownGeo, M.pineLeaves, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      const yAxis = new THREE.Vector3(0, 1, 0);
      // deterministic hero pine cluster just outside the south road for atmospheric treeline views
      const heroPines = [
        [15.8, -169.8, 1.32, 0.4],
        [18.5, -168.1, 1.24, 1.9],
        [19.9, -171.6, 1.42, 3.2],
        [22.4, -170.2, 1.30, 4.7],
        [17.1, -173.4, 1.18, 2.5],
        [23.2, -174.5, 1.48, 0.9],
      ];
      let i = 0;
      for (; i < heroPines.length && i < n; i++) {
        const [hx, hz, hs, hry] = heroPines[i];
        q.setFromAxisAngle(yAxis, hry);
        m4.compose(p.set(hx, 0, hz), q, sc.set(hs, hs * 1.05, hs));
        trunk.setMatrixAt(i, m4);
        top.setMatrixAt(i, m4);
        recordTreeTrunk(hx, hz, 0.42 * hs);
        treelinePerches.push({ x: hx, y: 9.65 * hs * 1.05, z: hz });
      }
      // Populate navigable pines inside the playable Woodland Perimeter Ring first so cover is evenly distributed
      const ringTarget = forestRing ? Math.min(n - i, S.quality === 'low' ? 175 : S.viewDistance === 'near' ? 230 : 310) : 0;
      let ringPlaced = 0, ringAttempts = 0;
      while (ringPlaced < ringTarget && ringAttempts < 4800 && i < n) {
        ringAttempts++;
        const x = R(-OUTER_E + 2, OUTER_E - 2), z = R(-OUTER_E + 2, OUTER_E - 2);
        if (Math.abs(x) < E + 1.8 && Math.abs(z) < E + 1.8) continue;
        if (Math.abs(x) < 12 && z < -HALF) continue;
        if (!canPlaceBox(x - 1.35, x + 1.35, z - 1.35, z + 1.35, 0.35)) continue;
        const s = R(0.88, 1.38);
        const hs = s * R(0.95, 1.20);
        q.setFromAxisAngle(yAxis, R(0, 6.28));
        m4.compose(p.set(x, 0, z), q, sc.set(s, hs, s));
        trunk.setMatrixAt(i, m4);
        top.setMatrixAt(i, m4);
        collider(x - 0.36 * s, x + 0.36 * s, z - 0.36 * s, z + 0.36 * s, 7);
        recordTreeTrunk(x, z, 0.42 * s);
        reserveBox(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 'tree');
        if (ringPerches.length < 28) ringPerches.push({ x, y: 9.65 * hs, z });
        ringPlaced++;
        i++;
      }
      // Concentrate ~45% of exterior treeline in the visible near perimeter buffer, rest across distant woods
      const nearBeltEnd = i + Math.floor((n - i) * 0.45);
      while (i < n) {
        const nearBelt = i < nearBeltEnd;
        const span = nearBelt ? (OUTER_E + 90) : 420;
        const x = R(-span, span), z = R(nearBelt ? -span : -560, span);
        if (Math.abs(x) < OUTER_E + 2.5 && Math.abs(z) < OUTER_E + 2.5) continue;
        if (Math.abs(x) < 12 && z < -HALF) continue; // keep the road clear
        if (Math.abs(x + 8) < 6 && Math.abs(z + 150) < 6) continue;
        if (x > 9.5 && x < 24.5 && z > -176 && z < -162) continue; // keep hero ambush corridor unblocked
        const s = R(0.85, 1.55);
        const hs = s * R(0.92, 1.24);
        q.setFromAxisAngle(yAxis, R(0, 6.28));
        m4.compose(p.set(x, 0, z), q, sc.set(s, hs, s));
        trunk.setMatrixAt(i, m4);
        top.setMatrixAt(i, m4);
        if (nearBelt) recordTreeTrunk(x, z, 0.42 * s);
        if (treelinePerches.length < 28 && Math.abs(x) < OUTER_E + 42 && Math.abs(z) < OUTER_E + 42) {
          treelinePerches.push({ x, y: 9.65 * hs, z });
        }
        i++;
      }
      trunk.instanceMatrix.needsUpdate = true;
      top.instanceMatrix.needsUpdate = true;
      W.root.add(trunk, top);
    }
    // distant hills silhouette (low-poly 4-sided cones batched into 1 mesh)
    {
      const hillGeos = [];
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        const cg = new THREE.ConeGeometry(R(120, 220), R(40, 90), 4).toNonIndexed();
        cg.translate(Math.cos(a) * 640, 0, Math.sin(a) * 640);
        hillGeos.push(cg);
      }
      const hillsMesh = new THREE.Mesh(batchGeos(hillGeos), M.leaves);
      hillsMesh.userData.noBatch = true;
      W.root.add(hillsMesh);
    }

    // subtle 3D forest birds (flock clusters perching on perimeter fences / pine crowns & circling treeline sky)
    W.birdsGroup = new THREE.Group();
    W.birdsGroup.userData.keepDynamic = true;
    W.root.add(W.birdsGroup);
    W.birds = [];
    W.birdClusters = [];
    {
      const birdBodyGeo = new THREE.BoxGeometry(0.11, 0.10, 0.28);
      const birdHeadGeo = new THREE.BoxGeometry(0.08, 0.08, 0.10);
      const birdBeakGeo = new THREE.ConeGeometry(0.025, 0.08, 4); birdBeakGeo.rotateX(Math.PI * 0.5);
      const birdTailGeo = new THREE.BoxGeometry(0.10, 0.02, 0.16);
      const birdWingInGeo = new THREE.BoxGeometry(0.24, 0.018, 0.13);
      const birdWingTipGeo = new THREE.BoxGeometry(0.15, 0.014, 0.09);
      const makeWingGeo = (side) => {
        const g1 = birdWingInGeo.toNonIndexed();
        g1.translate(side * 0.12, 0, -0.01);
        const g2 = birdWingTipGeo.toNonIndexed();
        g2.rotateY(side * -0.25);
        g2.translate(side * 0.28, -0.01, -0.03);
        return batchGeos([g1, g2]);
      };
      const birdWingLGeo = makeWingGeo(-1);
      const birdWingRGeo = makeWingGeo(1);
      birdWingInGeo.dispose(); birdWingTipGeo.dispose();

      const makeBirdMesh = (scale) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(birdBodyGeo, M.birdFeather);
        const head = new THREE.Group(); head.position.set(0, 0.055, 0.13);
        const skull = new THREE.Mesh(birdHeadGeo, M.birdFeather);
        const beak = new THREE.Mesh(birdBeakGeo, M.birdBeak); beak.position.set(0, -0.008, 0.075);
        head.add(skull, beak);
        const tail = new THREE.Mesh(birdTailGeo, M.birdFeather);
        tail.position.set(0, 0.01, -0.18); tail.rotation.x = 0.18;
        const lw = new THREE.Mesh(birdWingLGeo, M.birdFeather);
        lw.position.set(-0.05, 0.035, 0.02);
        const rw = new THREE.Mesh(birdWingRGeo, M.birdFeather);
        rw.position.set(0.05, 0.035, 0.02);
        g.add(body, head, tail, lw, rw);
        g.scale.setScalar(scale);
        W.birdsGroup.add(g);
        return { g, head, tail, lw, rw };
      };

      const totalFly = S.quality === 'low' ? 6 : 11;
      const flockSize = S.quality === 'low' ? 2 : 3;
      const clusterAnchors = [];
      if (W.fences && W.fences.length) {
        const intact = W.fences.filter(f => !f.permanentGate);
        const stride = Math.max(1, Math.floor(intact.length / 4));
        for (let fi = 2; fi < intact.length && clusterAnchors.length < 3; fi += stride) {
          const f = intact[fi];
          clusterAnchors.push({ x: f.pos.x, y: 2.46, z: f.pos.z, fence: f });
        }
      }
      const treePool = ringPerches.length ? ringPerches : treelinePerches;
      for (let ti = 0; ti < treePool.length && clusterAnchors.length < 7; ti += Math.max(1, Math.floor(treePool.length / 4))) {
        const tp = treePool[ti];
        clusterAnchors.push({ x: tp.x, y: tp.y + 0.05, z: tp.z, fence: null });
      }
      clusterAnchors.forEach((anc, ci) => {
        const cl = { id: ci, x: anc.x, y: anc.y, z: anc.z, fence: anc.fence, scared: false, cooldown: 0 };
        W.birdClusters.push(cl);
        for (let bi = 0; bi < flockSize; bi++) {
          const ox = anc.fence ? ((anc.fence.axis === 'x' ? (bi - 1) * 1.15 : 0)) : R(-1.3, 1.3);
          const oz = anc.fence ? ((anc.fence.axis === 'z' ? (bi - 1) * 1.15 : 0)) : R(-1.3, 1.3);
          const oy = anc.fence ? 0 : R(-0.4, 0.35);
          const px = anc.x + ox, py = anc.y + oy, pz = anc.z + oz;
          const parts = makeBirdMesh(R(0.9, 1.25));
          const yaw = R(0, Math.PI * 2);
          parts.g.position.set(px, py, pz);
          parts.g.rotation.y = yaw;
          const outLen = Math.hypot(px, pz) || 1;
          const randAng = R(0, Math.PI * 2);
          const dirX = Math.cos(randAng) * 0.65 + (px / outLen) * 0.55;
          const dirZ = Math.sin(randAng) * 0.65 + (pz / outLen) * 0.55;
          const dLen = Math.hypot(dirX, dirZ) || 1;
          W.birds.push({
            mode: 'perch',
            cluster: cl,
            parts,
            homeX: px, homeY: py, homeZ: pz,
            homeYaw: yaw,
            fence: anc.fence,
            outX: dirX / dLen,
            outZ: dirZ / dLen,
            climbSpeed: R(4.2, 6.8),
            horizSpeed: R(6.5, 10.5),
            swirlAmp: R(2.2, 4.8),
            state: 'perched', // perched | flee | return
            fleeT: 0,
            calmTimer: 0,
            lookTimer: R(0.6, 2.8),
            targetHeadYaw: 0,
            targetHeadPitch: 0,
            ruffleT: R(2, 7),
            phase: R(0, 6.28),
            flapSpeed: R(11, 14),
          });
        }
      });
      for (let fi = 0; fi < totalFly; fi++) {
        const parts = makeBirdMesh(R(0.95, 1.35));
        const ang = (fi / totalFly) * Math.PI * 2 + R(-0.2, 0.2);
        const rad = R(HALF + 16, OUTER_E + 24);
        const alt = R(10.5, 18.5);
        W.birds.push({
          mode: 'fly',
          parts,
          cx: Math.cos(ang) * rad * 0.25,
          cz: Math.sin(ang) * rad * 0.25,
          rx: rad * R(0.75, 1.05),
          rz: rad * R(0.75, 1.05),
          ang,
          speed: (fi % 2 ? 1 : -1) * R(0.055, 0.095),
          alt,
          bobAmp: R(0.6, 1.4),
          phase: R(0, 6.28),
          flapSpeed: R(9.5, 12.5),
          scareBoost: 0,
        });
      }
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
      if (Math.abs(p.x) > HALF + 2 && !(p.x > 130 && p.x < 146 && p.z > 23 && p.z < 31)) return false;
      const py = p.y || 0;
      for (let i = 0; i < W.interiors.length; i++) {
        const r = W.interiors[i];
        if (!r.disabled && p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ && (r.roofY === undefined || py < r.roofY - 0.15)) {
          return true;
        }
      }
      return false;
    };
    W.floorHeightAt = function (x, z, curY) {
      if (Math.abs(x) > HALF + 2 && !(x > 130 && x < 146 && z > 23 && z < 31)) return 0;
      const maxStep = (curY || 0) + 0.72;
      let best = 0;
      for (let i = 0; i < W.walkSurfaces.length; i++) {
        const s = W.walkSurfaces[i];
        if (s.disabled) continue;
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
        let h;
        if (s.type === 'ramp') {
          const u = s.axis === 'x' ? x : z;
          const t = Math.max(0, Math.min(1, (u - s.u0) / (s.u1 - s.u0)));
          h = s.y0 + (s.y1 - s.y0) * t;
        } else {
          h = s.y;
        }
        if (h <= maxStep && h > best) best = h;
      }
      return best;
    };

    // =========================================================
    //  BUILDING SMASHING & EVIDENCE PATH QUERIES
    // =========================================================
    const OCC_CELL = 24;
    const _occGrid = new Map();
    const _occBBox = new THREE.Box3();
    let _occQSeq = 0;
    const _occQOut = [];
    W.syncOccluders = function () {
      W.occluders.length = 0;
      _occGrid.clear();
      const pushOcc = (mesh) => {
        if (!mesh || !mesh.visible) return;
        W.occluders.push(mesh);
        if (!mesh.userData) mesh.userData = {};
        if (!mesh.userData._occBox) {
          mesh.updateWorldMatrix(true, false);
          mesh.userData._occBox = new THREE.Box3().setFromObject(mesh);
        }
        const b = mesh.userData._occBox;
        if (b.isEmpty()) return;
        const gx0 = Math.floor(b.min.x / OCC_CELL), gx1 = Math.floor(b.max.x / OCC_CELL);
        const gz0 = Math.floor(b.min.z / OCC_CELL), gz1 = Math.floor(b.max.z / OCC_CELL);
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gz = gz0; gz <= gz1; gz++) {
            const key = ((gx + 256) << 12) | (gz + 256);
            let bucket = _occGrid.get(key);
            if (!bucket) { bucket = []; _occGrid.set(key, bucket); }
            bucket.push(mesh);
          }
        }
      };
      for (let i = 0; i < W.baseOccluders.length; i++) pushOcc(W.baseOccluders[i]);
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        const list = b.smashed ? b.debrisOccluders : b.occluders;
        for (let j = 0; j < list.length; j++) pushOcc(list[j]);
      }
    };
    W.queryOccluders = function (ax, az, bx, bz) {
      _occQOut.length = 0;
      _occQSeq++;
      const gx0 = Math.floor(Math.min(ax, bx) / OCC_CELL), gx1 = Math.floor(Math.max(ax, bx) / OCC_CELL);
      const gz0 = Math.floor(Math.min(az, bz) / OCC_CELL), gz1 = Math.floor(Math.max(az, bz) / OCC_CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const bucket = _occGrid.get(((gx + 256) << 12) | (gz + 256));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const m = bucket[i];
            if (m._occQSeq !== _occQSeq) {
              m._occQSeq = _occQSeq;
              _occQOut.push(m);
            }
          }
        }
      }
      return _occQOut;
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
        const guardMap = !!(b.hasMap && W.wallMap && !W.wallMap.taken);
        if (!b.hasEvidence && !guardMap && !b.smashed && !b.outskirt && x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return b;
      }
      return null;
    };

    const _debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    W.smashBuilding = function (b, impactPos, dir) {
      const guardMap = !!(b && b.hasMap && W.wallMap && !W.wallMap.taken);
      if (!b || b.smashed || b.hasEvidence || guardMap) return false;
      b.smashed = true;
      W._gridVersion++;
      b.group.visible = false;
      b.colliders.forEach(c => { c.disabled = true; });
      if (b.walkSurfaces) b.walkSurfaces.forEach(s => { s.disabled = true; });
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
        const debOccSet = new Set(b.debrisOccluders);
        b.debrisOccluders.length = 0;
        mergeSubtreeByMaterial(dg, { target: dg, occSet: debOccSet, outOccluders: b.debrisOccluders });
        dg.updateMatrixWorld(true);
        b.debrisGroup = dg;
        b.restore = function () {
          b.smashed = false;
          W._gridVersion++;
          b.group.visible = true;
          b.colliders.forEach(c => { c.disabled = false; });
          if (b.walkSurfaces) b.walkSurfaces.forEach(s => { s.disabled = false; });
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

      // erupting flying debris parts pushed in Siren Head's travel direction (reusing pooled meshes)
      const ox = impactPos ? impactPos.x : b.cx, oz = impactPos ? impactPos.z : b.cz;
      const dx = dir ? dir.x : 0, dz = dir ? dir.z : 1;
      const mats = [M.brick, M.rubble, M.wood, M.trim];
      for (let i = 0; i < 20; i++) {
        const sx = 0.28 + Math.random() * 0.65, sy = 0.18 + Math.random() * 0.4, sz = 0.28 + Math.random() * 0.9;
        const m = acquireDebrisMesh(_debrisGeo, mats[i % mats.length]);
        m.scale.set(sx, sy, sz);
        m.position.set(ox + (Math.random() - 0.5) * 5, 1.5 + Math.random() * Math.min(7, b.H * 0.6), oz + (Math.random() - 0.5) * 5);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
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

    const _plankGeo = new THREE.BoxGeometry(1, 1, 1);
    const _debrisPool = [];
    function acquireDebrisMesh(geo, material, castRecv) {
      let m = null;
      if (_debrisPool.length) {
        m = _debrisPool.pop();
        m.geometry = geo;
        m.material = material;
        m.visible = true;
      } else {
        m = new THREE.Mesh(geo, material);
        W.debrisGroup.add(m);
      }
      if (shadows && castRecv) { m.castShadow = true; m.receiveShadow = true; }
      else { m.castShadow = false; m.receiveShadow = false; }
      return m;
    }
    function releaseDebrisMesh(m) {
      m.visible = false;
      if (_debrisPool.length < 96) _debrisPool.push(m);
      else W.debrisGroup.remove(m);
    }

    W.smashFence = function (f, impactPos, dir) {
      if (f && f.broken) return false;
      const pos = f ? f.pos : impactPos;
      const fgTmp = new THREE.Group();
      if (f) {
        f.broken = true;
        f.mesh.visible = false;
        if (f.collider) f.collider.disabled = true;

        // leave jagged snapped timber stumps at the fence's post positions
        const alongX = f.axis === 'x';
        [-2.91, 0].forEach((offset, idx) => {
          const sh = 0.36 + ((idx * 37 + Math.abs(Math.round(pos.x + pos.z))) % 4) * 0.11;
          const stump = new THREE.Mesh(_plankGeo, fenceMat);
          stump.scale.set(0.18, sh, 0.18);
          stump.position.set(
            pos.x + (alongX ? offset : 0),
            sh * 0.5,
            pos.z + (alongX ? 0 : offset)
          );
          stump.rotation.set((Math.random() - 0.5) * 0.25, Math.random() * 0.4, (Math.random() - 0.5) * 0.25);
          if (shadows) { stump.castShadow = true; stump.receiveShadow = true; }
          fgTmp.add(stump);
        });
      }

      // travel vector pushed into the ground scatter
      let dx = dir && dir.x ? dir.x : 0;
      let dz = dir && dir.z ? dir.z : 0;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-4) { dx /= dl; dz /= dl; }
      else {
        const rl = Math.hypot(pos.x, pos.z) || 1;
        dx = -pos.x / rl; dz = -pos.z / rl;
      }

      // grounded shattered fence planks & snapped rails remaining permanently across the breach
      for (let i = 0; i < 12; i++) {
        const isRail = i < 2;
        const pw = isRail ? 0.10 : 0.18 + Math.random() * 0.08;
        const ph = isRail ? 0.07 : 0.045;
        const pl = isRail ? (1.8 + Math.random() * 1.1) : (0.75 + Math.random() * 1.35);
        const m = new THREE.Mesh(_plankGeo, M.wood);
        m.scale.set(pw, ph, pl);
        const fwd = -0.8 + Math.random() * 6.5;
        const side = (Math.random() - 0.5) * 5.2;
        m.position.set(
          pos.x + dx * fwd + (-dz) * side,
          ph * 0.5 + 0.015,
          pos.z + dz * fwd + dx * side
        );
        m.rotation.set((Math.random() - 0.5) * 0.14, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.14);
        if (shadows) { m.castShadow = true; m.receiveShadow = true; }
        fgTmp.add(m);
      }
      if (fgTmp.children.length) {
        mergeSubtreeByMaterial(fgTmp, { target: fgTmp });
        while (fgTmp.children.length) {
          const ch = fgTmp.children[0];
          fgTmp.remove(ch);
          W.fenceDebrisGroup.add(ch);
        }
      }

      // dynamic airborne boards that bounce and stay settled on the ground permanently (pooled)
      for (let i = 0; i < 18; i++) {
        const pw = 0.14 + Math.random() * 0.10;
        const ph = 0.045;
        const pl = 0.65 + Math.random() * 1.15;
        const m = acquireDebrisMesh(_plankGeo, M.wood, true);
        m.scale.set(pw, ph, pl);
        m.position.set(
          pos.x + (Math.random() - 0.5) * 3.8,
          0.4 + Math.random() * 1.7,
          pos.z + (Math.random() - 0.5) * 3.8
        );
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const fwdSp = 4 + Math.random() * 11, sideSp = (Math.random() - 0.5) * 10;
        W.flyingDebris.push({
          mesh: m,
          halfY: ph * 0.5,
          floorY: 0.025 + ph * 0.5,
          isFence: true,
          persistent: true,
          vx: dx * fwdSp + (-dz) * sideSp,
          vy: 2.2 + Math.random() * 6.2,
          vz: dz * fwdSp + dx * sideSp,
          rx: (Math.random() - 0.5) * 12,
          ry: (Math.random() - 0.5) * 12,
          rz: (Math.random() - 0.5) * 12,
          settled: false,
          life: 999,
        });
      }
      return true;
    };

    W.repairFences = function () {
      if (W.fences) {
        W.fences.forEach(f => {
          if (f.permanentGate) return;
          f.broken = false;
          f.mesh.visible = true;
          f.mesh.position.copy(f.basePos);
          f.mesh.rotation.copy(f.baseRot);
          if (f.collider) f.collider.disabled = false;
        });
      }
      W.fenceDebrisGroup.clear();
      for (let i = W.flyingDebris.length - 1; i >= 0; i--) {
        if (W.flyingDebris[i].isFence) {
          releaseDebrisMesh(W.flyingDebris[i].mesh);
          W.flyingDebris.splice(i, 1);
        }
      }
      W._gridVersion++;
    };

    // =========================================================
    //  UPDATE (flickering lights, pickups bobbing)
    // =========================================================
    // ---------- wind-blown dust and leaves around the camera ----------
    {
      const N = S.quality === 'low' ? 140 : S.textures === 'low' ? 220 : 380, BOX = 36, H = 10;
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

    W.scatterBirdsAt = function (pos, radius, time) {
      if (!W.birdClusters || !pos) return 0;
      const rad = radius || 30, r2 = rad * rad;
      const t = time || 0;
      let count = 0;
      for (let ci = 0; ci < W.birdClusters.length; ci++) {
        const cl = W.birdClusters[ci];
        const dx = cl.x - pos.x, dz = cl.z - pos.z;
        if (dx * dx + dz * dz <= r2) {
          cl.scared = true;
          if (cl.cooldown <= t && LO.audio && LO.audio.birdScatter) {
            cl.cooldown = t + 8.0;
            LO.audio.birdScatter({ x: cl.x, y: cl.y + 4, z: cl.z });
          }
          count++;
        }
      }
      if (W.birds) {
        for (let i = 0; i < W.birds.length; i++) {
          const b = W.birds[i];
          if (b.mode === 'fly') b.scareBoost = 1;
          else if (b.cluster && b.cluster.scared && b.state === 'perched') {
            b.state = 'flee'; b.fleeT = 0; b.calmTimer = 10 + (i % 5) * 1.4;
          }
        }
      }
      return count;
    };

    W.updateBirds = function (dt, time, opts) {
      if (!W.birdsGroup) return;
      opts = opts || {};
      const enabled = opts.enabled !== false;
      if (W.birdsGroup.visible !== enabled) W.birdsGroup.visible = enabled;
      if (!enabled || !W.birds || !W.birds.length) return;
      if (LO.admin && LO.admin.dbgFreezeBirds) return;
      const pPos = opts.pos || null;
      const disturbed = !!opts.disturbed;
      const still = !!opts.still;
      const threats = opts.threats || null;
      const t = time || 0;

      // Evaluate cluster-level flock scattering from player proximity, loud noise, broken fences, or stalking entities
      if (W.birdClusters) {
        for (let ci = 0; ci < W.birdClusters.length; ci++) {
          const cl = W.birdClusters[ci];
          let trig = false;
          if (cl.fence && cl.fence.broken) trig = true;
          if (!still && pPos) {
            const pd = Math.hypot(pPos.x - cl.x, pPos.z - cl.z);
            if (pd < 14 || (disturbed && pd < 34)) trig = true;
          }
          if (!still && threats) {
            for (let ti = 0; ti < threats.length; ti++) {
              const th = threats[ti];
              if (!th || !th.pos) continue;
              const td = Math.hypot(th.pos.x - cl.x, th.pos.z - cl.z);
              if (td < (th.radius || 22)) { trig = true; break; }
            }
          }
          if (trig) {
            if (!cl.scared && opts.onScatter && cl.cooldown <= t) {
              cl.cooldown = t + 8.0;
              opts.onScatter({ x: cl.x, y: cl.y + 4, z: cl.z });
            }
            cl.scared = true;
          } else {
            cl.scared = false;
          }
        }
      }

      const birdCullR = !pPos ? 9999 : (S.quality === 'low' || S.viewDistance === 'near' ? 72 : S.viewDistance === 'far' ? 140 : 98);
      const birdCullR2 = birdCullR * birdCullR;
      const lowCull = !!pPos;
      for (let i = 0; i < W.birds.length; i++) {
        const b = W.birds[i];
        const parts = b.parts;
        const g = parts.g, head = parts.head, tail = parts.tail, lw = parts.lw, rw = parts.rw;
        if (b.mode === 'fly') {
          if (disturbed) b.scareBoost = Math.min(1, b.scareBoost + dt * 2.5);
          else b.scareBoost = Math.max(0, b.scareBoost - dt * 0.22);
          const mul = still ? 0.45 : (1 + b.scareBoost * 0.85);
          b.ang += b.speed * mul * dt;
          const nx = b.cx + Math.cos(b.ang) * b.rx;
          const nz = b.cz + Math.sin(b.ang) * b.rz;
          const ny = b.alt + Math.sin(t * 0.9 + b.phase) * b.bobAmp + b.scareBoost * 6.5;
          const tx = -Math.sin(b.ang) * b.rx * (b.speed >= 0 ? 1 : -1);
          const tz = Math.cos(b.ang) * b.rz * (b.speed >= 0 ? 1 : -1);
          g.position.set(nx, ny, nz);
          g.rotation.y = Math.atan2(tx, tz);
          g.rotation.z = (b.speed >= 0 ? -0.18 : 0.18);
          const cycle = (t * 0.42 + b.phase) % 3.2;
          const flapping = !still && (cycle < 1.55 || b.scareBoost > 0.2);
          const wAng = flapping
            ? Math.sin(t * b.flapSpeed + b.phase * 3) * (0.68 + b.scareBoost * 0.25) + 0.12
            : 0.14 + Math.sin(t * 1.8 + b.phase) * 0.04;
          lw.rotation.z = -wAng;
          rw.rotation.z = wAng;
          tail.rotation.x = 0.08 + Math.sin(t * 2 + b.phase) * 0.05;
          head.rotation.set(0.06, 0, 0);
        } else {
          const nearLoud = !!(b.cluster && b.cluster.scared) || !!(b.fence && b.fence.broken);

          if (b.state === 'perched') {
            if (nearLoud) {
              if (!g.visible) g.visible = true;
              b.state = 'flee';
              b.fleeT = 0;
              b.calmTimer = 10 + (i % 5) * 1.4;
            } else {
              if (lowCull) {
                const dx = pPos.x - b.homeX, dz = pPos.z - b.homeZ;
                const d2 = dx * dx + dz * dz;
                if (d2 > birdCullR2) {
                  if (g.visible) g.visible = false;
                  continue;
                }
                if (!g.visible) g.visible = true;
              }
              b.lookTimer -= dt;
              if (b.lookTimer <= 0) {
                b.lookTimer = 0.9 + ((i * 17 + Math.floor(t * 3)) % 20) * 0.12;
                b.targetHeadYaw = (Math.sin(t * 4.3 + i * 2.1) * 0.55);
                b.targetHeadPitch = Math.cos(t * 3.1 + i) * 0.18;
              }
              head.rotation.y += (b.targetHeadYaw - head.rotation.y) * Math.min(1, dt * 9);
              head.rotation.x += (b.targetHeadPitch - head.rotation.x) * Math.min(1, dt * 9);
              b.ruffleT -= dt;
              let ruffle = 0;
              if (b.ruffleT <= 0 && !still) {
                if (b.ruffleT > -0.45) ruffle = Math.sin((b.ruffleT + 0.45) * 28) * 0.35;
                else b.ruffleT = 3.5 + ((i * 23) % 7);
              }
              lw.rotation.z = 1.05 - Math.abs(ruffle);
              rw.rotation.z = -1.05 + Math.abs(ruffle);
              tail.rotation.x = 0.25 + Math.sin(t * 2.4 + b.phase) * 0.08;
              g.position.set(b.homeX, b.homeY + Math.abs(ruffle) * 0.03, b.homeZ);
              g.rotation.set(0, b.homeYaw, 0);
            }
          } else if (b.state === 'flee') {
            b.fleeT += dt;
            if (nearLoud) b.calmTimer = Math.max(b.calmTimer, 10);
            const k = Math.min(1, b.fleeT / 3.4);
            const arc = b.fleeT * (b.horizSpeed || 8.0);
            const swirl = b.swirlAmp || 3.5;
            const fx = b.homeX + b.outX * arc + Math.sin(b.fleeT * 1.9 + b.phase) * swirl;
            const fz = b.homeZ + b.outZ * arc + Math.cos(b.fleeT * 1.7 + b.phase) * swirl;
            const fy = b.homeY + Math.min(20, b.fleeT * (b.climbSpeed || 5.2)) + Math.sin(b.fleeT * 3.2 + b.phase) * 0.45;
            g.position.set(fx, fy, fz);
            g.rotation.y = Math.atan2(b.outX, b.outZ) + Math.sin(b.fleeT * 1.5 + b.phase) * 0.4;
            g.rotation.z = Math.sin(b.fleeT * 2.4 + b.phase) * 0.22;
            const flap = Math.sin(t * (b.flapSpeed * 1.45) + b.phase) * 0.82 + 0.1;
            lw.rotation.z = -flap;
            rw.rotation.z = flap;
            tail.rotation.x = 0.08;
            head.rotation.set(0.05, 0, 0);
            if (!nearLoud && !disturbed) {
              b.calmTimer -= dt;
              if (b.calmTimer <= 0 && (!b.fence || !b.fence.broken)) {
                b.state = 'return';
                b.fleeT = 0;
              }
            }
            if (k >= 1 && b.state === 'flee') {
              const cx = b.homeX + b.outX * 26 + Math.cos(t * 0.48 + b.phase) * 9;
              const cz = b.homeZ + b.outZ * 26 + Math.sin(t * 0.48 + b.phase) * 9;
              g.position.set(cx, b.homeY + 15.5 + Math.sin(t + b.phase) * 0.8, cz);
              g.rotation.y = Math.atan2(-Math.sin(t * 0.48 + b.phase), Math.cos(t * 0.48 + b.phase));
            }
          } else {
            b.fleeT += dt;
            if (nearLoud) { b.state = 'flee'; b.fleeT = 0; b.calmTimer = 10; continue; }
            const r = Math.min(1, b.fleeT / 2.6);
            const ease = r * r * (3 - 2 * r);
            const sx = b.homeX + b.outX * 22, sz = b.homeZ + b.outZ * 22, sy = b.homeY + 14;
            g.position.set(sx + (b.homeX - sx) * ease, sy + (b.homeY - sy) * ease, sz + (b.homeZ - sz) * ease);
            g.rotation.y = Math.atan2(-b.outX, -b.outZ) * (1 - ease) + b.homeYaw * ease;
            g.rotation.z = 0;
            const flap = r < 0.85 ? Math.sin(t * 11 + b.phase) * 0.55 + 0.1 : 0.4;
            lw.rotation.z = -flap;
            rw.rotation.z = flap;
            if (r >= 1) b.state = 'perched';
          }
        }
      }
    };

    W.update = function (dt, time, birdCtx) {
      W.updateBirds(dt, time, birdCtx);
      const pPos = birdCtx && birdCtx.pos ? birdCtx.pos : null;
      const noFog = !!(LO.admin && LO.admin.noFog);
      if (W.fences) {
        const fenceCullR = (!pPos || noFog) ? 9999 : (S.viewDistance === 'near' ? 88 : S.viewDistance === 'far' ? 175 : 118);
        const fenceCullR2 = fenceCullR * fenceCullR;
        for (let i = 0; i < W.fences.length; i++) {
          const f = W.fences[i];
          if (f.broken || !f.mesh) continue;
          const vis = (!pPos || noFog) ? true : ((pPos.x - f.pos.x) * (pPos.x - f.pos.x) + (pPos.z - f.pos.z) * (pPos.z - f.pos.z) <= fenceCullR2);
          if (f.mesh.visible !== vis) f.mesh.visible = vis;
        }
      }
      for (let i = 0; i < W.flickers.length; i++) {
        const f = W.flickers[i];
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
      }
      const pkCullR = (!pPos || noFog) ? 9999 : (S.viewDistance === 'near' ? 68 : S.viewDistance === 'far' ? 140 : 92);
      const pkCullR2 = pkCullR * pkCullR;
      for (let i = 0; i < W.pickups.length; i++) {
        const p = W.pickups[i];
        if (p.taken) continue;
        const vis = (!pPos || noFog) ? true : ((pPos.x - p.pos.x) * (pPos.x - p.pos.x) + (pPos.z - p.pos.z) * (pPos.z - p.pos.z) <= pkCullR2);
        if (p.mesh.visible !== vis) p.mesh.visible = vis;
        if (!vis || p.type === 'rock') continue;
        p.mesh.position.y = p.baseY + Math.sin(time * 2 + p.pos.x) * 0.06;
        p.mesh.rotation.y += dt;
      }
      for (let i = W.flyingDebris.length - 1; i >= 0; i--) {
        const d = W.flyingDebris[i];
        if (!d.persistent) {
          d.life -= dt;
          if (d.life <= 0) {
            releaseDebrisMesh(d.mesh);
            W.flyingDebris.splice(i, 1);
            continue;
          }
        }
        if (d.settled) continue;
        d.vy -= 22 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.y += d.ry * dt;
        d.mesh.rotation.z += d.rz * dt;
        const floorY = d.floorY !== undefined ? d.floorY : (0.22 + d.halfY);
        if (d.mesh.position.y <= floorY) {
          d.mesh.position.y = floorY;
          if (Math.abs(d.vy) > 3.2) {
            d.vy = -d.vy * 0.32;
            d.vx *= 0.55; d.vz *= 0.55;
            d.rx *= 0.4; d.ry *= 0.4; d.rz *= 0.4;
          } else {
            d.vy = 0; d.vx = 0; d.vz = 0;
            d.mesh.rotation.x = d.isFence ? (Math.random() - 0.5) * 0.08 : 0;
            d.mesh.rotation.z = d.isFence ? (Math.random() - 0.5) * 0.08 : 0;
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
    const wallMapTex = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 384;
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 512, 384);
      bg.addColorStop(0, '#dfd2b2'); bg.addColorStop(0.5, '#d4c39b'); bg.addColorStop(1, '#c3b083');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 384);
      // woodland border tint
      g.fillStyle = 'rgba(46, 68, 42, 0.16)';
      g.fillRect(24, 24, 464, 336);
      g.fillStyle = '#ddd0b0';
      g.fillRect(82, 54, 348, 276);
      // folded paper crease grid
      g.strokeStyle = 'rgba(84, 62, 34, 0.22)'; g.lineWidth = 2;
      [170, 342].forEach(vx => { g.beginPath(); g.moveTo(vx, 0); g.lineTo(vx, 384); g.stroke(); });
      [128, 256].forEach(hy => { g.beginPath(); g.moveTo(0, hy); g.lineTo(512, hy); g.stroke(); });
      // double ink border
      g.strokeStyle = '#33281d'; g.lineWidth = 3; g.strokeRect(20, 20, 472, 344);
      g.lineWidth = 1; g.strokeRect(26, 26, 460, 332);
      // town street grid
      g.strokeStyle = 'rgba(54, 46, 38, 0.65)'; g.lineWidth = 7;
      for (let i = 0; i < 5; i++) {
        const p = 104 + i * 76;
        g.beginPath(); g.moveTo(p, 58); g.lineTo(p, 326); g.stroke();
      }
      for (let j = 0; j < 5; j++) {
        const p = 72 + j * 60;
        g.beginPath(); g.moveTo(88, p); g.lineTo(424, p); g.stroke();
      }
      // south road
      g.beginPath(); g.moveTo(256, 326); g.lineTo(256, 368); g.stroke();
      // block buildings
      g.fillStyle = 'rgba(68, 52, 38, 0.68)';
      for (let bx = 0; bx < 4; bx++) for (let bz = 0; bz < 4; bz++) {
        const x0 = 116 + bx * 76, y0 = 80 + bz * 60;
        g.fillRect(x0, y0, 22, 18);
        g.fillRect(x0 + 30, y0 + 24, 22, 18);
      }
      // header & compass
      g.fillStyle = '#231a12'; g.font = 'bold 20px Georgia, serif'; g.textAlign = 'center';
      g.fillText('HOLLOW CREEK TOWN MAP', 256, 46);
      g.strokeStyle = '#99221d'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(444, 74, 15, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#99221d'; g.font = 'bold 14px Georgia, serif'; g.fillText('N', 444, 79);
      return new THREE.CanvasTexture(c);
    })();
    {
      const mg = new THREE.Group();
      mg.userData.keepDynamic = true;
      const paperMat = mat({ map: wallMapTex, roughness: 0.88, metalness: 0.0 });
      const paperBack = mat({ color: 0xbfb291, roughness: 0.92 });
      const sheet = new THREE.Mesh(
        new THREE.BoxGeometry(1.44, 1.08, 0.016),
        [paperBack, paperBack, paperBack, paperBack, paperMat, paperBack]
      );
      mg.add(sheet);
      const batten = new THREE.Mesh(new THREE.BoxGeometry(1.50, 0.05, 0.028), M.wood);
      batten.position.set(0, 0.545, 0.004);
      mg.add(batten);
      const pinMat = mat({ color: 0xb82420, roughness: 0.45, metalness: 0.25 });
      const pinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.024, 8);
      pinGeo.rotateX(Math.PI / 2);
      [[-0.66, 0.48], [0.66, 0.48], [-0.66, -0.48], [0.66, -0.48]].forEach(([px, py]) => {
        const pin = new THREE.Mesh(pinGeo, pinMat);
        pin.position.set(px, py, 0.014);
        mg.add(pin);
      });
      mg.visible = false;
      W.root.add(mg);
      W.wallMap = {
        mesh: mg,
        pos: new THREE.Vector3(),
        yaw: 0,
        baseY: 0.14,
        taken: false,
        disabled: false,
        building: null,
      };
    }

    W.debrisGroup.userData.keepDynamic = true;
    W.fenceDebrisGroup.userData.keepDynamic = true;
    W.evGroup.userData.keepDynamic = true;

    W.placeWallMap = function (preferEnterable, randFn) {
      const rf = randFn || Math.random;
      const wm = W.wallMap;
      if (!wm) return null;
      W.buildings.forEach(b => { b.hasMap = false; });
      if (LO.ver && !LO.ver().townMap) {
        wm.disabled = true;
        wm.taken = true;
        wm.building = null;
        wm.mesh.visible = false;
        return null;
      }
      const hasGroundWall = b => b && b.building && (
        (b.building.mapWallSpots && b.building.mapWallSpots.length > 0) ||
        (b.building.safeWallSpots && b.building.safeWallSpots.some(s => (s.y === undefined || s.y <= 0.25)))
      );
      let candidates = [];
      if (preferEnterable && hasGroundWall(preferEnterable)) {
        candidates = [preferEnterable];
      } else {
        candidates = W.enterables.filter(b => !b.sheriff && !(b.building && b.building.hasEvidence) && hasGroundWall(b));
        if (!candidates.length) candidates = W.enterables.filter(b => !(b.building && b.building.hasEvidence) && hasGroundWall(b));
        if (!candidates.length) candidates = W.enterables.filter(hasGroundWall);
      }
      if (!candidates.length) {
        wm.disabled = true;
        wm.mesh.visible = false;
        return null;
      }
      const chosen = candidates[(rf() * candidates.length) | 0];
      const useThreeSpots = !LO.ver || LO.ver().mapThreeSpots;
      const mapSpots = (useThreeSpots && chosen.building.mapWallSpots && chosen.building.mapWallSpots.length)
        ? chosen.building.mapWallSpots : null;
      const groundSpots = chosen.building.safeWallSpots.filter(s => s.y === undefined || s.y <= 0.25);
      const pool = mapSpots || groundSpots;
      const clearWallSpot = s => !W.evidence || !W.evidence.some(ev =>
        (ev.id === 'claws' || ev.id === 'warning') && ev.pos &&
        Math.abs((s.y !== undefined ? s.y : 0.14) + 1.54 - ev.pos.y) < 1.2 &&
        Math.hypot(s.p.x - ev.pos.x, s.p.z - ev.pos.z) < 2.6
      );
      const cleanPool = pool.filter(clearWallSpot);
      const pickFrom = cleanPool.length ? cleanPool : pool;
      const spot = pickFrom[(rf() * pickFrom.length) | 0] || chosen.building.safeWallSpots[0];
      const baseY = spot.y !== undefined ? spot.y : 0.14;
      const nx = Math.sin(spot.yaw), nz = Math.cos(spot.yaw);
      wm.pos.set(spot.p.x + nx * 0.035, baseY + 1.54, spot.p.z + nz * 0.035);
      wm.yaw = spot.yaw;
      wm.baseY = baseY;
      wm.slotTag = spot.tag || 'wall';
      wm.taken = false;
      wm.disabled = false;
      wm.building = chosen.building;
      if (chosen.building) chosen.building.hasMap = true;
      wm.mesh.position.copy(wm.pos);
      wm.mesh.rotation.set(0, wm.yaw, 0.015);
      wm.mesh.visible = true;
      return wm;
    };

    W._evOwnedGeos = W._evOwnedGeos || [];
    W.placeEvidence = function (evSeed) {
      for (let i = 0; i < W._evOwnedGeos.length; i++) {
        const g = W._evOwnedGeos[i];
        if (g && g.dispose) g.dispose();
      }
      W._evOwnedGeos.length = 0;
      W.evGroup.clear();
      W.evColliders.length = 0; W.evOccluders.length = 0;
      W.evidence = [];
      for (let i = W.flyingDebris.length - 1; i >= 0; i--) W.debrisGroup.remove(W.flyingDebris[i].mesh);
      W.flyingDebris.length = 0;
      W.buildings.forEach(b => {
        if (b.smashed && b.restore) b.restore();
        b.hasEvidence = b.sheriff;
        b.hasMap = !!(W.wallMap && !W.wallMap.taken && W.wallMap.building === b);
      });
      W.repairFences();
      const r = evSeed !== undefined ? mulberry(evSeed >>> 0) : Math.random, pk = a => a[(r() * a.length) | 0];
      const leftB = (!LO.ver || LO.ver().leftBuildingMap) ? W.spawnLeftBuilding : null;
      const used = new Set();
      const hasRichDesks = W.enterables.some(e => !e.sheriff && e.building && e.building.safeDeskSpots && e.building.safeDeskSpots.length > 0);
      const hasRichWalls = W.enterables.some(e => !e.sheriff && e.building && e.building.safeWallSpots && e.building.safeWallSpots.length > 0);
      const takeEnter = (req) => {
        const match = b => !b.sheriff &&
          (!req || !req.desk || (b.building && b.building.safeDeskSpots && b.building.safeDeskSpots.length > 0)) &&
          (!req || !req.wall || (b.building && b.building.safeWallSpots && b.building.safeWallSpots.length > 0));
        let c = W.enterables.filter(b => b !== leftB && !used.has(b) && match(b));
        if (!c.length) c = W.enterables.filter(b => !used.has(b) && match(b));
        if (!c.length) c = W.enterables.filter(match);
        if (!c.length) c = W.enterables.filter(b => !b.sheriff);
        const b = pk(c); used.add(b); if (b && b.building) b.building.hasEvidence = true; return b;
      };
      const takeFront = () => { const c = W.closedFronts.filter(b => !used.has(b) && b.H >= 7); const b = pk(c); used.add(b); if (b && b.building) b.building.hasEvidence = true; return b; };
      const evCol = (x0, x1, z0, z1, maxY, minY) => W.evColliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY, minY: minY || 0 });
      const isClear = (cx, cz, pad) => !W.colliders.some(c =>
        !c.disabled && c.minY <= 2.5 && c.maxY >= 0.08 &&
        cx + pad > c.minX && cx - pad < c.maxX && cz + pad > c.minZ && cz - pad < c.maxZ
      ) && canPlaceBox(cx - pad, cx + pad, cz - pad, cz + pad, 0.25) &&
        !W.evColliders.some(c => cx + pad > c.minX && cx - pad < c.maxX && cz + pad > c.minZ && cz - pad < c.maxZ);
      const streetPoint = (pad) => {
        pad = pad || 2.0;
        for (let tries = 0; tries < 24; tries++) {
          const s0 = pk(STREETS), along = pk(BLOCK_C) + (r() - 0.5) * 20, off = (r() - 0.5) * 4.5;
          const vert = r() < 0.5;
          const cx = vert ? s0 + off : along, cz = vert ? along : s0 + off;
          if (!nearIntersection(cx, cz, 1.5) && isClear(cx, cz, pad)) return { x: cx, z: cz, vertical: vert };
        }
        const s0 = pk(STREETS), along = pk(BLOCK_C), off = (r() - 0.5) * 4;
        return r() < 0.5 ? { x: s0 + off, z: along, vertical: true } : { x: along, z: s0 + off, vertical: false };
      };
      // pick a clean unblocked wall spot inside an enterable building (pre-verified by FloorPlan when available)
      const wallSpot = (b, which) => {
        if (b.building && b.building.safeWallSpots && b.building.safeWallSpots.length) {
          return pk(b.building.safeWallSpots);
        }
        const { F, hl, hd, t, pb } = b;
        if (which === 'back') return { p: F.point(0, -hd + t + 0.04), yaw: F.yawFront(), y: 0.14 };
        const side = r() < 0.5 ? 1 : -1;
        const lo = -hd + t + 1.5, hi = pb - 1.2;
        const bb = hi > lo ? lo + r() * (hi - lo) : (pb + hd) / 2;
        return { p: F.point(side * (hl - t - 0.04), bb), yaw: F.yawLeft() + (side > 0 ? Math.PI : 0), y: 0.14 };
      };

      // 1. giant footprint — clearly visible on an unobstructed street or open parking pad
      {
        const clearVer = !LO.ver || LO.ver().clearFootprint;
        const onBlock = (cx, cz) =>
          BLOCK_C.some(bx => Math.abs(cx - bx) <= BLOCK / 2 + 0.4) &&
          BLOCK_C.some(bz => Math.abs(cz - bz) <= BLOCK / 2 + 0.4);

        let x, z, sy = 0.06, rot = r() * 6.28;
        if (clearVer) {
          const parkingLots = W.openLots.filter(l => l.type === 'parking');
          let picked = false;
          for (let tries = 0; tries < 40; tries++) {
            let cand;
            if ((r() < 0.8 || !parkingLots.length) && tries < 34) {
              const s0 = pk(STREETS), along = pk(BLOCK_C) + (r() - 0.5) * 20, off = (r() - 0.5) * 2.8;
              const vert = r() < 0.5;
              cand = {
                x: vert ? s0 + off : along,
                z: vert ? along : s0 + off,
                rot: (vert ? 0 : Math.PI / 2) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.35,
                sy: 0.036,
              };
            } else if (parkingLots.length) {
              const l = pk(parkingLots);
              cand = { x: l.cx + (r() - 0.5) * 4, z: l.cz + (r() - 0.5) * 4, rot: r() * 6.28, sy: 0.138 };
            } else {
              const sp = streetPoint(2.8);
              cand = { x: sp.x, z: sp.z, rot: r() * 6.28, sy: onBlock(sp.x, sp.z) ? 0.138 : 0.036 };
            }
            if (isClear(cand.x, cand.z, 2.8)) {
              x = cand.x; z = cand.z; rot = cand.rot; sy = cand.sy; picked = true; break;
            }
          }
          if (!picked) {
            const sp = streetPoint(2.2);
            x = sp.x; z = sp.z; rot = (r() < 0.5 ? 0 : Math.PI); sy = 0.036;
          }
          const fp = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 8.6), M.footprint);
          fp.rotation.x = -Math.PI / 2; fp.rotation.z = rot; fp.position.set(x, sy + 0.025, z);
          W.evGroup.add(fp);
          evCol(x - 1.6, x + 1.6, z - 1.6, z + 1.6, 0.05, 0);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + (r() - 0.5) * 0.4;
            const dist = 2.6 + r() * 1.4;
            const sx = x + Math.cos(a) * (2.2 + r() * 0.8), sz = z + Math.sin(a) * dist;
            const ch = 0.05 + r() * 0.07;
            box(0.24 + r() * 0.36, ch, 0.22 + r() * 0.34, M.rubble, sx, sy + ch * 0.5, sz, {
              ry: r() * 6.28, rx: (r() - 0.5) * 0.18, rz: (r() - 0.5) * 0.18, parent: W.evGroup, cast: false
            });
          }
          W.evidence.push({ id: 'footprint', name: 'Giant footprint', pos: new THREE.Vector3(x, sy + 0.2, z), maxDist: 18, found: false, ground: true });
        } else {
          if (r() < 0.7 || !W.openLots.length) { const sp = streetPoint(2.2); x = sp.x; z = sp.z; }
          else { const l = pk(W.openLots); x = l.cx + (r() - 0.5) * 6; z = l.cz + (r() - 0.5) * 6; }
          const fp = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 8), M.footprint);
          fp.rotation.x = -Math.PI / 2; fp.rotation.z = rot; fp.position.set(x, 0.06, z);
          W.evGroup.add(fp);
          rubblePile(x, z, 3, 6, W.evGroup);
          W.evidence.push({ id: 'footprint', name: 'Giant footprint', pos: new THREE.Vector3(x, 0.1, z), maxDist: 16, found: false, ground: true });
        }
      }
      // 2. crushed police cruiser — somewhere unobstructed on the streets
      {
        const sp = streetPoint(2.9);
        const ry = (sp.vertical ? 0 : Math.PI / 2) + (r() - 0.5) * 1.2;
        const g = car(sp.x, sp.z, ry, { police: true, crushed: true, parent: W.evGroup, noCollide: true });
        evCol(sp.x - 2.4, sp.x + 2.4, sp.z - 2.4, sp.z + 2.4, 1.2);
        rubblePile(sp.x, sp.z, 3.5, 5, W.evGroup);
        W.evidence.push({ id: 'police', name: 'Crushed police cruiser', pos: new THREE.Vector3(sp.x, 0.6, sp.z), maxDist: 16, found: false, margin: 3 });
        void g;
      }
      // 3. giant claw marks — outside on a wall, or inside a clean room
      {
        if (r() < 0.5) {
          const b = takeFront();
          let a = (r() - 0.5) * (b.L - 8); if (Math.abs(a - b.doorA) < 3) a = b.doorA + (a < b.doorA ? -3 : 3);
          const p = b.F.point(a, b.D / 2 + 0.17), y = Math.min(4.4, b.H * 0.5);
          const cm = new THREE.Mesh(new THREE.PlaneGeometry(7, Math.min(8, b.H * 0.85)), decalMat(clawTex));
          cm.position.set(p.x, y, p.z); cm.rotation.y = b.F.yawFront(); W.evGroup.add(cm);
          W.evidence.push({ id: 'claws', name: 'Giant claw marks', pos: new THREE.Vector3(p.x, y, p.z), maxDist: 22, found: false });
        } else {
          const b = takeEnter({ wall: hasRichWalls }), w = wallSpot(b, 'side');
          const wy = (w.y || 0.14) + 1.66;
          const cm = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.0), decalMat(clawTex));
          cm.position.set(w.p.x, wy, w.p.z); cm.rotation.y = w.yaw; W.evGroup.add(cm);
          W.evidence.push({ id: 'claws', name: 'Giant claw marks', pos: new THREE.Vector3(w.p.x, wy, w.p.z), maxDist: 9, found: false });
        }
      }
      // 4. survivor's warning — inside on a clean wall, or sprayed outside
      {
        if (r() < 0.6) {
          const b = takeEnter({ wall: hasRichWalls }), w = wallSpot(b, 'back');
          const wy = (w.y || 0.14) + 1.56;
          const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.4), M.warning);
          pm.position.set(w.p.x, wy, w.p.z); pm.rotation.y = w.yaw; W.evGroup.add(pm);
          W.evidence.push({ id: 'warning', name: 'Survivor\'s warning', pos: new THREE.Vector3(w.p.x, wy, w.p.z), maxDist: 9, found: false });
        } else {
          const b = takeFront();
          let a = (r() - 0.5) * (b.L - 7); if (Math.abs(a - b.doorA) < 3) a = b.doorA + (a < b.doorA ? -3 : 3);
          const p = b.F.point(a, b.D / 2 + 0.17);
          const pm = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), decalMat(sprayTex));
          pm.position.set(p.x, 2.4, p.z); pm.rotation.y = b.F.yawFront(); W.evGroup.add(pm);
          W.evidence.push({ id: 'warning', name: 'Survivor\'s warning', pos: new THREE.Vector3(p.x, 2.4, p.z), maxDist: 16, found: false });
        }
      }
      // 5. CCTV still — on a pre-reserved unblocked security desk inside a random building
      {
        const b = takeEnter({ desk: hasRichDesks });
        const { F, hd, t, gapA, axis } = b;
        const dSpot = b.building && b.building.safeDeskSpots && b.building.safeDeskSpots.length
          ? pk(b.building.safeDeskSpots)
          : { p: F.point(-gapA * 0.3 + (gapA > 0 ? -2.5 : 2.5), -hd + t + 1.0), yaw: F.yawFront(), y: 0.14 };
        const p = dSpot.p, baseY = dSpot.y !== undefined ? dSpot.y : 0.14;
        const desk = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? 2.4 : 1, 0.9, axis === 'z' ? 1 : 2.4), M.wood);
        desk.position.set(p.x, baseY + 0.45, p.z); W.evGroup.add(desk);
        evCol(p.x - (axis === 'z' ? 1.2 : 0.5), p.x + (axis === 'z' ? 1.2 : 0.5), p.z - (axis === 'z' ? 0.5 : 1.2), p.z + (axis === 'z' ? 0.5 : 1.2), baseY + 0.9, baseY);
        const mon = new THREE.Group();
        mon.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.5), mat({ color: 0x2b2b28 })));
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.7), M.cctv);
        screen.position.z = 0.26; mon.add(screen);
        mon.position.set(p.x, baseY + 1.35, p.z); mon.rotation.y = dSpot.yaw;
        W.evGroup.add(mon);
        W.evidence.push({ id: 'cctv', name: 'CCTV still of the creature', pos: new THREE.Vector3(p.x, baseY + 1.35, p.z), maxDist: 7, found: false });
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
      // 7. optional forest evidence — wrecked ranger truck & claw-scarred pole in the North Woodland Ring
      if (!LO.ver || LO.ver().forestRing) {
        const rx = -27, rz = 138;
        car(rx, rz, 0.42, { crushed: true, paint: mat({ color: 0x2c4732, roughness: 0.5, metalness: 0.3 }), parent: W.evGroup, noCollide: true });
        evCol(rx - 2.2, rx + 2.2, rz - 2.2, rz + 2.2, 1.3);
        rubblePile(rx, rz, 3.2, 4, W.evGroup);
        box(0.24, 3.2, 0.24, M.wood, rx + 2.4, 1.45, rz - 1.6, { ry: 0.35, rz: 0.42, parent: W.evGroup, cast: false });
        const gouge = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.2), decalMat(clawTex));
        gouge.position.set(rx + 2.32, 1.5, rz - 1.45);
        gouge.rotation.y = Math.PI;
        W.evGroup.add(gouge);
        W.evidence.push({ id: 'ranger', name: 'Wrecked forest ranger truck', pos: new THREE.Vector3(rx, 0.9, rz), maxDist: 16, found: false, margin: 3 });
      }
      // 8. the sheriff's tape — always in the sheriff's station
      W.fixedEvidence.forEach(e => { e.found = false; W.evidence.push(e); });
      W.placeWallMap((!LO.ver || LO.ver().leftBuildingMap) ? W.spawnLeftBuilding : null, r);
      if (shadows) W.evGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      {
        const evOccSet = new Set(W.evOccluders);
        W.evOccluders.length = 0;
        mergeSubtreeByMaterial(W.evGroup, {
          target: W.evGroup,
          ignoreRootKeepDynamic: true,
          occSet: evOccSet,
          outOccluders: W.evOccluders,
        });
        W.evGroup.traverse(o => {
          if (o.isMesh && o.geometry && !(W._keepStaticGeos && W._keepStaticGeos.has(o.geometry)) && !W._evOwnedGeos.includes(o.geometry)) {
            W._evOwnedGeos.push(o.geometry);
          }
        });
        if (W._keepStaticGeos) {
          _discardedGeos.forEach(g => {
            if (g && !W._keepStaticGeos.has(g) && g.dispose) g.dispose();
          });
          _discardedGeos.clear();
        }
        W.evGroup.updateMatrixWorld(true);
      }
      W.syncOccluders();
    };
    flushDeco(DECO, W.root);

    // Batch static geometry per building (keeping destructibility & occluders) and chunk static town props in 96m cells
    {
      const skipRoot = new Set();
      for (let i = 0; i < W.buildings.length; i++) {
        const b = W.buildings[i];
        skipRoot.add(b.group);
        const occSet = new Set(b.occluders);
        b.occluders.length = 0;
        mergeSubtreeByMaterial(b.group, { target: b.group, occSet, outOccluders: b.occluders });
      }
      const baseOccSet = new Set(W.baseOccluders);
      W.baseOccluders.length = 0;
      mergeSubtreeByMaterial(W.root, {
        target: W.root,
        skipSet: skipRoot,
        occSet: baseOccSet,
        outOccluders: W.baseOccluders,
        cellSize: 96,
      });

      // Safely dispose geometries that are no longer referenced anywhere in the static world or shared kits
      const keepGeos = new Set([pineTrunkGeo, pineCrownGeo, deadTreeGeo, fenceGeo, wingFenceGeo25, wingFenceGeo06, _debrisGeo, _plankGeo]);
      if (KIT) Object.values(KIT).forEach(v => { if (v && v.isBufferGeometry) keepGeos.add(v); });
      W.root.traverse(o => { if (o.geometry) keepGeos.add(o.geometry); });
      W._keepStaticGeos = keepGeos;
      _discardedGeos.forEach(g => { if (g && !keepGeos.has(g) && g.dispose) g.dispose(); });
      _discardedGeos.clear();
    }

    W.placeEvidence(opts.evSeed);
    for (let i = 0; i < W.fences.length; i++) W.fences[i].idx = i;
    for (let i = 0; i < W.hideSpots.length; i++) W.hideSpots[i].idx = i;
    for (let i = 0; i < W.pickups.length; i++) W.pickups[i].idx = i;

    // Freeze static world matrices once after assembly to eliminate redundant per-frame matrixWorld walks on low-end CPUs
    W.root.updateMatrixWorld(true);
    (function freezeStatic(obj) {
      if (!obj || (obj.userData && obj.userData.keepDynamic)) return;
      const ch = obj.children;
      for (let i = 0; i < ch.length; i++) freezeStatic(ch[i]);
      if (obj !== W.root && obj !== W.sky && obj !== W.stars && (!W.dust || obj !== W.dust.pts)) {
        obj.matrixAutoUpdate = false;
        obj.updateMatrix();
      }
    })(W.root);

    W.spawn = new THREE.Vector3(1.2, 0, -HALF + 6);
    W.playerCarPos = new THREE.Vector3(-3, 0, -HALF + 5);
    return W;
  }
})();
