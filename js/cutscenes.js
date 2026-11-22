// ============================================================
//  THE LOUD ONE — cutscenes: the drive in, and the arrest
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Generic timeline: events fire once at their time, update runs per frame
  function Timeline(duration, events, update, onEnd) {
    this.t = 0; this.duration = duration; this.events = events.map(e => Object.assign({ done: false }, e));
    this.updateFn = update; this.onEnd = onEnd; this.finished = false;
  }
  Timeline.prototype.update = function (dt) {
    if (this.finished) return;
    this.t += dt;
    this.events.forEach(e => { if (!e.done && this.t >= e.at) { e.done = true; e.fn(); } });
    this.updateFn(this.t, dt);
    if (this.t >= this.duration) this.finish();
  };
  Timeline.prototype.finish = function () {
    if (this.finished) return;
    this.finished = true;
    this.onEnd && this.onEnd();
  };

  // ==========================================================
  //  OPENING — driving into Hollow Creek
  // ==========================================================
  function opening(ctx) {
    const { world: W, camera, siren, ui } = ctx;
    const A = LO.audio;
    const carStop = W.playerCarPos;
    const car = W.car(carStop.x, -480, 0, { headlightsOn: true, noCollide: true, paint: W.mat({ color: 0x23384f, roughness: 0.4, metalness: 0.4 }) });
    const lights = [];
    [-0.65, 0.65].forEach(x => {
      const l = new THREE.SpotLight(0xfff0d0, 6, 70, 0.45, 0.5, 1.2);
      l.position.set(x, 0.8, 2.3);
      const tg = new THREE.Object3D(); tg.position.set(x * 2, 0, 20);
      car.add(l); car.add(tg); l.target = tg;
      lights.push(l);
    });
    ctx.cleanup.push(() => { car.parent && car.parent.remove(car); });

    siren.scripted = true;
    siren.pos.set(0, 0, 40);
    siren.yaw = Math.PI; // facing the road
    siren.glowOverride = 0.35;
    siren.speedNow = 0;

    let engine = A.engine();
    ctx.cleanup.push(() => { if (engine) { engine.stop(); engine = null; } });

    // stand barricades intact before the car drives in, then leave them rammed afterward
    W.setBarricadesIntact && W.setBarricadesIntact();
    const cutDebris = new THREE.Group();
    W.root.add(cutDebris);
    const barShards = [];
    let rammed = false, ramClock = 0;
    ctx.cleanup.push(() => {
      cutDebris.parent && cutDebris.parent.remove(cutDebris);
      W.setBarricadesRammed && W.setBarricadesRammed();
    });

    function triggerBarricadeRam(impactZ) {
      rammed = true;
      ramClock = 0;
      A.fenceSmash && A.fenceSmash({ x: carStop.x, y: 0.7, z: impactZ });
      A.boom && A.boom(0.65);
      ctx.shake(0.85);
      // spawn flying striped planks & wooden barricade splinters over/beside the hood
      const plankGeo = new THREE.BoxGeometry(1.15, 0.06, 0.24);
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(plankGeo, i % 2 === 0 ? W.M.barricade : W.M.wood);
        m.position.set(carStop.x + (Math.random() - 0.5) * 4.2, 0.55 + Math.random() * 0.7, impactZ + (Math.random() - 0.5) * 1.4);
        m.scale.set(0.45 + Math.random() * 0.85, 0.8 + Math.random() * 0.6, 0.6 + Math.random() * 0.7);
        cutDebris.add(m);
        barShards.push({
          mesh: m,
          vx: (Math.random() - 0.5) * 11 + (i % 2 ? -2.2 : 2.2),
          vy: 3.5 + Math.random() * 6.5,
          vz: 8 + Math.random() * 14,
          rx: (Math.random() - 0.5) * 13,
          ry: (Math.random() - 0.5) * 13,
          rz: (Math.random() - 0.5) * 13,
        });
      }
    }

    // car z as a function of time (decelerates smoothly after plowing through -114)
    function carZ(t) {
      if (t < 21) return -480 + t * 16;
      const u = clamp01((t - 21) / 8);
      const k = 1 - Math.pow(1 - u, 2.4);
      return lerp(-144, carStop.z, k);
    }
    const look = new V3();
    // the shots were designed on a 38s clock; stretched to 58s to fit the recorded narration
    const KNOTS = [[0, 0], [9, 7], [19, 15], [27, 21], [37, 29], [58, 38]];
    function warp(T) {
      for (let i = 1; i < KNOTS.length; i++) {
        const [a0, b0] = KNOTS[i - 1], [a1, b1] = KNOTS[i];
        if (T <= a1) return b0 + (T - a0) / (a1 - a0) * (b1 - b0);
      }
      return 38;
    }
    const tl = new Timeline(58, [
      { at: 0.3, fn: () => { A.playMusic('tension', 3); ui.fadeIn(2.5); } },
      { at: 1.5, fn: () => ui.caption('HOLLOW CREEK', 'October 24 · 2:47 AM') },
      { at: 2.5, fn: () => A.say('player', 'Three weeks ago, Hollow Creek had two thousand people living in it. Now it has none.') },
      { at: 7.5, fn: () => ui.caption('') },
      { at: 13.0, fn: () => A.say('player', 'The news called it a gas leak. Everybody just packed up and left in the middle of the night.') },
      { at: 21.3, fn: () => A.say('player', 'But I heard the emergency calls. Those weren\'t gas leaks. Those were sirens.') },
      { at: 23.5, fn: () => A.siren(siren.voice, 'call', 0.7) },
      { at: 29.2, fn: () => A.say('player', '...Wait. What is that?') },
      { at: 32.4, fn: () => { lights.forEach(l => l.intensity = 0); A.staticBurst(null, 0.6, 0.3); } },
      { at: 32.75, fn: () => { lights.forEach(l => l.intensity = 6); } },
      { at: 33.0, fn: () => { lights.forEach(l => l.intensity = 0); } },
      { at: 33.75, fn: () => { lights.forEach(l => l.intensity = 6); siren.pos.set(W.STREETS[4], 0, W.STREETS[4]); siren.glowOverride = 0; } },
      { at: 34.4, fn: () => A.say('player', 'Gone. Okay. Okay. It\'s just the dark.') },
      { at: 39.0, fn: () => A.say('player', 'I need photos. Real proof that thing did this. Get enough, and the police will have to send in everything they\'ve got.') },
      { at: 50.6, fn: () => A.say('player', 'Stay quiet. Whatever happens... stay quiet.') },
      { at: 55.6, fn: () => ui.fadeOut(2) },
    ], (T, dt) => {
      const t = warp(T);
      const z = carZ(t);
      car.position.set(carStop.x, 0, z);
      const barLine = -(W.HALF + 4);
      if (!rammed && z + 2.2 >= barLine) {
        triggerBarricadeRam(barLine);
      }
      if (rammed && W.barricades) {
        ramClock += dt;
        const rk = ease(clamp01(ramClock / 0.85));
        W.barricades.forEach(b => {
          b.group.position.lerpVectors(b.basePos, b.ramPos, rk);
          b.group.rotation.set(
            lerp(b.baseRot.x, b.ramRot.x, rk),
            lerp(b.baseRot.y, b.ramRot.y, rk),
            lerp(b.baseRot.z, b.ramRot.z, rk)
          );
        });
        for (let i = 0; i < barShards.length; i++) {
          const s = barShards[i];
          s.vy -= 18 * dt;
          s.mesh.position.x += s.vx * dt;
          s.mesh.position.y += s.vy * dt;
          s.mesh.position.z += s.vz * dt;
          if (s.mesh.position.y <= 0.04) {
            s.mesh.position.y = 0.04;
            s.vy *= -0.22; s.vx *= 0.55; s.vz *= 0.55;
            s.rx *= 0.3; s.ry *= 0.3; s.rz *= 0.3;
          }
          s.mesh.rotation.x += s.rx * dt;
          s.mesh.rotation.y += s.ry * dt;
          s.mesh.rotation.z += s.rz * dt;
        }
      }
      if (engine) engine.set(t < 29 ? 0.35 : Math.max(0, 0.35 - (t - 29) * 0.15), t < 21 ? 1 : Math.max(0.2, 1 - (t - 21) / 8));
      if (t > 31 && engine) { engine.stop(); engine = null; }
      siren.update(dt, null, 0);

      if (t < 7) {                       // aerial over the forest
        camera.position.set(carStop.x + 30 - t * 2, 38 - t * 1.5, z - 40 + t * 2);
        look.set(carStop.x, 0, z + 30);
      } else if (t < 15) {               // tracking alongside
        const k = (t - 7) / 8;
        camera.position.set(carStop.x - 5.5, 1.2, z + lerp(4, -2, k));
        look.set(carStop.x, 0.9, z + 8);
      } else if (t < 21) {               // passing the welcome sign
        camera.position.set(-14, 1.6, -147);
        look.set(lerp(-8, carStop.x, clamp01((t - 15) / 6)), 1.5, Math.max(-150, z));
        if (t < 18) look.set(-8, 2.4, -150);
      } else if (t < 29) {               // driver's POV toward the roadblock & town
        camera.position.set(carStop.x - 0.4, 1.25, z + 0.4);
        const dip = Math.sin(clamp01((t - 23.4) / 2.2) * Math.PI);
        const ly = t < 26.2 ? lerp(9, 4.2, dip) : 3;
        const lx = t < 26.2 ? lerp(0, carStop.x * 0.4, dip) : carStop.x - 0.2 + Math.sin(t) * 0.1;
        const lz = t < 26.2 ? 40 : z + 60;
        look.set(lx, ly, lz);
      } else {                           // parked, outside the car
        const k = clamp01((t - 29) / 7);
        camera.position.set(carStop.x + 4 + k * 1.5, 1.7, carStop.z - 2 - k * 2);
        look.set(carStop.x + 0.5, 1.2, carStop.z + 6);
      }
      ctx.applyShake(look);
      camera.lookAt(look);
      camera.updateMatrixWorld();
    }, () => {
      ctx.onDone && ctx.onDone(car);
    });
    return tl;
  }

  // ==========================================================
  //  ENDING — the heavy response arrives
  // ==========================================================
  function ending(ctx) {
    const { world: W, camera, siren, scene, ui } = ctx;
    const A = LO.audio;
    const group = new THREE.Group(); W.root.add(group);
    ctx.cleanup.push(() => W.root.remove(group));

    // ---- dawn ----
    {
      const c = document.createElement('canvas'); c.width = 2; c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#1d2638'); gr.addColorStop(0.5, '#6b5a6a'); gr.addColorStop(0.8, '#c98a62'); gr.addColorStop(1, '#e6b07a');
      g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
      W.skyMat.map = tex; W.skyMat.needsUpdate = true;
      W.stars.visible = false; W.moon.visible = false; W.moonHalo.visible = false;
      scene.fog.color.set(0x6a5a58);
      if (scene.fog.density) scene.fog.density *= 0.6;
      W.hemi.color.set(0xb8a8a8); W.hemi.groundColor.set(0x30282a); W.hemi.intensity = 0.9;
      W.moonLight.color.set(0xffc49a); W.moonLight.intensity = 1.1;
      W.moonLight.position.set(120, 40, -160);
    }

    // ---- Siren Head waits in the town centre ----
    siren.scripted = true;
    siren.pos.set(0, 0, 0);
    siren.yaw = Math.PI;
    siren.root.rotation.order = 'YXZ';
    siren.root.rotation.x = 0;
    siren.glowOverride = 0.6;
    siren.forceLean = 0.15;
    siren.speedNow = 0;
    siren.state = 'hunt';

    // ---- convoy ----
    const vehicles = [];
    function addVehicle(mesh, x, stopZ, delay, speed) {
      mesh.position.set(x, 0, -260 - delay * speed);
      group.add(mesh);
      vehicles.push({ mesh, x, stopZ, delay, speed: speed || 18 });
      return mesh;
    }
    const police = [];
    [[-3, -24, 0], [3, -28, 0.6], [-3.5, -36, 1.2], [3.5, -40, 1.8]].forEach(([x, z, d]) => {
      const c = W.car(0, 0, 0, { police: true, lightsOn: true, noCollide: true, parent: group });
      police.push(c);
      addVehicle(c, x, z, d, 20);
    });
    // ---- heavy trucks: proper cab, chassis, six rimmed wheels ----
    const chromeM = W.mat({ color: 0xa8a8a8, roughness: 0.35, metalness: 0.8 });
    const glassM = W.M.glass, darkM = W.M.dark, steelM = W.mat({ color: 0x3a3c40, roughness: 0.5, metalness: 0.6 });
    function box(w, h, d, m, x, y, z, parent, rx, ry, rz) {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o;
    }
    function cyl(rt, rb, h, m, x, y, z, parent, rx, rz, seg) {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 14), m); o.position.set(x, y, z); o.rotation.set(rx || 0, 0, rz || 0); parent.add(o); return o;
    }
    function truck(color, label, bed) {
      const g = new THREE.Group();
      const paint = W.mat({ color, roughness: 0.55, metalness: 0.3 });
      box(2.3, 0.35, 8.2, steelM, 0, 0.75, -0.4, g);                                   // chassis rails
      // cab with windscreen, side windows, grille, bumper, mirrors
      box(2.6, 1.5, 2.2, paint, 0, 1.75, 3.0, g);
      box(2.5, 0.85, 1.9, paint, 0, 2.9, 2.85, g);
      box(2.2, 0.7, 0.04, glassM, 0, 2.95, 3.81, g, -0.08);
      [-1, 1].forEach(sd => { box(0.04, 0.6, 1.3, glassM, sd * 1.26, 2.95, 2.95, g); box(0.1, 0.35, 0.2, darkM, sd * 1.45, 2.8, 3.6, g); });
      box(1.8, 0.8, 0.06, darkM, 0, 1.55, 4.11, g);
      for (let i = 0; i < 5; i++) box(1.7, 0.04, 0.03, chromeM, 0, 1.25 + i * 0.15, 4.15, g);
      box(2.7, 0.3, 0.3, chromeM, 0, 0.85, 4.2, g);
      [-0.95, 0.95].forEach(x => box(0.38, 0.2, 0.05, new THREE.MeshBasicMaterial({ color: 0xfff2cc }), x, 1.3, 4.14, g));
      // six wheels with rims
      const tg = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 16), rg = new THREE.CylinderGeometry(0.32, 0.32, 0.47, 10);
      [[-1.25, 3.0], [1.25, 3.0], [-1.25, -1.6], [1.25, -1.6], [-1.25, -3.0], [1.25, -3.0]].forEach(([x, z]) => {
        const w = new THREE.Mesh(tg, W.M.tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w);
        const r = new THREE.Mesh(rg, chromeM); r.rotation.z = Math.PI / 2; r.position.set(x, 0.55, z); g.add(r);
      });
      if (bed === 'box') {
        box(2.6, 2.6, 5.4, paint, 0, 2.25, -1.6, g);
        box(2.62, 0.1, 5.42, steelM, 0, 3.55, -1.6, g);
      } else {
        box(2.5, 0.25, 5.4, steelM, 0, 1.05, -1.6, g);                                  // flatbed
      }
      if (label) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 64;
        const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.fillText(label, 128, 48);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
        const y = bed === 'box' ? 2.6 : 1.75, z = bed === 'box' ? -1.6 : 3.0, hx = bed === 'box' ? 1.32 : 1.32;
        m.position.set(hx, y, z); m.rotation.y = Math.PI / 2; g.add(m);
        const m2 = m.clone(); m2.position.x = -hx; m2.rotation.y = -Math.PI / 2; g.add(m2);
      }
      const beacon = box(0.6, 0.18, 0.3, new THREE.MeshBasicMaterial({ color: 0xff8800 }), 0, 3.42, 2.85, g);
      g.userData.beacon = beacon;
      return g;
    }
    const swat1 = addVehicle(truck(0x1d2430, 'S.W.A.T.', 'box'), -2.5, -52, 2.6, 16);
    const swat2 = addVehicle(truck(0x1d2430, 'S.W.A.T.', 'box'), 2.5, -60, 3.2, 16);

    // ---- power winch trucks: winch drum, hydraulic ram and a lattice boom with a hook ----
    const cranes = [];
    const yellow = W.mat({ color: 0xd8b030, roughness: 0.55, metalness: 0.2 });
    [[-4, -18, 3.6], [4, -19, 4.4]].forEach(([x, z, d]) => {
      const t = truck(0xc9a227, 'RESTRAINT', 'flat');
      // winch drum wound with cable
      cyl(0.45, 0.45, 1.8, yellow, 0, 1.75, -3.4, t, 0, Math.PI / 2);
      cyl(0.4, 0.4, 1.5, darkM, 0, 1.75, -3.4, t, 0, Math.PI / 2, 20);
      [-1, 1].forEach(sd => box(0.12, 1.2, 1.1, yellow, sd * 1.0, 1.65, -3.4, t));
      // outriggers planted on the road
      [[-1, 0.6], [1, 0.6], [-1, -3.9], [1, -3.9]].forEach(([sd, oz]) => {
        box(1.0, 0.18, 0.25, yellow, sd * 1.7, 0.9, oz, t);
        box(0.2, 0.9, 0.2, steelM, sd * 2.15, 0.45, oz, t);
        box(0.5, 0.06, 0.5, steelM, sd * 2.15, 0.03, oz, t);
      });
      // turntable + boom (pivots at its base)
      cyl(0.9, 1.0, 0.35, steelM, 0, 1.35, -1.6, t);
      const boom = new THREE.Group(); boom.position.set(0, 2.0, -1.9); t.add(boom);
      const L = 11;
      [-0.32, 0.32].forEach(xo => { box(0.16, 0.16, L, yellow, xo, 0.3, L / 2, boom); box(0.16, 0.16, L, yellow, xo, -0.3, L / 2, boom); });
      for (let i = 0; i <= 11; i++) {                                                   // lattice
        const zz = i * L / 11;
        box(0.8, 0.06, 0.06, yellow, 0, 0.3, zz, boom); box(0.8, 0.06, 0.06, yellow, 0, -0.3, zz, boom);
        [-0.32, 0.32].forEach(xo => box(0.06, 0.06, 0.95, yellow, xo, 0, zz + 0.45, boom, 0.63));
      }
      cyl(0.35, 0.35, 0.8, steelM, 0, 0, L, boom, 0, Math.PI / 2);                      // head pulley
      const hookLine = cyl(0.03, 0.03, 1.6, darkM, 0, -0.8, L, boom);
      const hook = box(0.35, 0.45, 0.25, steelM, 0, -1.7, L, boom);
      // hydraulic ram from the bed to the boom
      const ram = cyl(0.14, 0.14, 4.2, chromeM, 0, -0.6, 2.2, boom, -1.2);
      const ramBody = cyl(0.2, 0.2, 2.2, yellow, 0, -1.4, 1.1, boom, -1.2);
      boom.rotation.x = -0.05;
      const tip = new THREE.Object3D(); tip.position.z = L; boom.add(tip);
      t.userData.boom = boom; t.userData.tip = tip; t.userData.hook = [hookLine, hook];
      void ram; void ramBody;
      cranes.push(addVehicle(t, x, z, d, 15));
    });
    void swat1; void swat2;

    // ---- police helicopter ----
    const heli = new THREE.Group();
    {
      const body = W.mat({ color: 0x14213a, roughness: 0.45, metalness: 0.35 });
      const white = W.mat({ color: 0xe0e0e0, roughness: 0.5 });
      const canopy = new THREE.MeshStandardMaterial({ color: 0x0b1c24, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.85 });
      const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 14), body); cabin.scale.set(1.05, 1.0, 1.65); heli.add(cabin);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1.22, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), canopy);
      nose.rotation.x = Math.PI / 2 - 0.25; nose.position.set(0, 0.15, 1.0); nose.scale.set(1.0, 1.0, 0.9); heli.add(nose);
      box(2.65, 0.25, 2.2, white, 0, -0.35, -0.2, heli);                                  // police stripe
      const boomG = new THREE.CylinderGeometry(0.18, 0.42, 5.2, 12); boomG.rotateX(Math.PI / 2);
      const tailBoom = new THREE.Mesh(boomG, body); tailBoom.position.set(0, 0.25, -4.3); heli.add(tailBoom);
      box(0.12, 1.5, 0.9, body, 0, 0.9, -6.6, heli, 0.3);                                 // vertical fin
      box(1.8, 0.08, 0.6, body, 0, 0.3, -6.1, heli);                                      // stabiliser
      const tailRotor = new THREE.Group(); tailRotor.position.set(0.2, 0.9, -6.75); heli.add(tailRotor);
      box(0.04, 1.4, 0.16, darkM, 0, 0, 0, tailRotor); box(0.04, 0.16, 1.4, darkM, 0, 0, 0, tailRotor);
      // skids
      [-1, 1].forEach(sd => {
        const sk = cyl(0.07, 0.07, 3.6, steelM, sd * 0.95, -1.55, 0, heli, Math.PI / 2);
        void sk;
        [0.9, -0.9].forEach(zz => cyl(0.05, 0.05, 0.75, steelM, sd * 0.85, -1.2, zz, heli, 0, sd * 0.25));
      });
      // main rotor: mast, hub, four blades
      cyl(0.12, 0.15, 0.6, steelM, 0, 1.45, -0.2, heli);
      const rotor = new THREE.Group(); rotor.position.set(0, 1.8, -0.2); heli.add(rotor);
      cyl(0.28, 0.28, 0.18, steelM, 0, 0, 0, rotor);
      for (let i = 0; i < 4; i++) { const bl = box(5.2, 0.05, 0.32, darkM, 2.6, 0, 0, new THREE.Group(), 0, 0, 0); bl.parent.rotation.y = i * Math.PI / 2; rotor.add(bl.parent); }
      heli.userData.rotor = rotor; heli.userData.tailRotor = tailRotor;
      // searchlight under the nose + nav lights
      cyl(0.22, 0.28, 0.4, steelM, 0, -1.05, 1.3, heli, Math.PI / 2 - 0.4);
      const navR = cyl(0.07, 0.07, 0.07, new THREE.MeshBasicMaterial({ color: 0xff2020 }), -1.3, 0, -0.2, heli);
      const navG = cyl(0.07, 0.07, 0.07, new THREE.MeshBasicMaterial({ color: 0x20ff40 }), 1.3, 0, -0.2, heli);
      heli.userData.nav = [navR, navG];
      const spot = new THREE.SpotLight(0xffffff, 8, 120, 0.22, 0.4, 1);
      spot.position.set(0, -1.1, 1.4);
      const tg = new THREE.Object3D(); group.add(tg);
      spot.target = tg; heli.add(spot); heli.userData.spotTarget = tg;
      heli.position.set(0, 60, -300);
      group.add(heli);
    }

    // restraint cables — thin cylinders stretched between two points
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const cables = [];
    function addCable(fromObj, fromLocal, toFn, start, dur) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 5), cableMat);
      m.visible = false; group.add(m);
      cables.push({ m, fromObj, fromLocal, toFn, start, dur });
    }
    const tmpA = new V3(), tmpB = new V3(), up = new V3(0, 1, 0);
    function updateCables(t) {
      cables.forEach(c => {
        const k = clamp01((t - c.start) / c.dur);
        if (k <= 0) { c.m.visible = false; return; }
        c.m.visible = true;
        c.fromObj.localToWorld(tmpA.copy(c.fromLocal));
        c.toFn(tmpB);
        tmpB.lerpVectors(tmpA, tmpB, k);
        const len = tmpA.distanceTo(tmpB);
        c.m.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
        c.m.scale.set(1, len, 1);
        c.m.quaternion.setFromUnitVectors(up, tmpB.clone().sub(tmpA).normalize());
      });
    }
    const handL = v => siren.arms[0].hand.getWorldPosition(v);
    const handR = v => siren.arms[1].hand.getWorldPosition(v);
    const neck = v => siren.neck.getWorldPosition(v).add(new V3(0, 1.2, 0));
    const hip = v => siren.hip.getWorldPosition(v);
    const tip0 = cranes[0].userData.tip, tip1 = cranes[1].userData.tip;
    addCable(tip0, new V3(), handL, 14, 0.8);
    addCable(tip1, new V3(), handR, 14.6, 0.8);
    addCable(tip0, new V3(), neck, 16.5, 0.9);
    addCable(tip1, new V3(), neck, 17.0, 0.9);
    addCable(police[0], new V3(0, 1, 2), hip, 18, 0.6);
    addCable(police[1], new V3(0, 1, 2), hip, 18.3, 0.6);
    addCable(heli, new V3(0, -1, 0), neck, 20, 1.2);

    let sirens = [], heliSnd = null, fallStart = -1;
    ctx.cleanup.push(() => { sirens.forEach(s => s.stop()); sirens = []; if (heliSnd) heliSnd.stop(); heliSnd = null; });

    function segmentHitsBox(ax, ay, az, bx, by, bz, minX, maxX, minY, maxY, minZ, maxZ) {
      let t0 = 0, t1 = 1;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const clip = (p, q) => {
        if (Math.abs(p) < 1e-8) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else       { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      return clip(-dx, ax - minX) && clip(dx, maxX - ax)
          && clip(-dy, ay - minY) && clip(dy, maxY - ay)
          && clip(-dz, az - minZ) && clip(dz, maxZ - az)
          && t0 <= t1;
    }
    function ensureClearCam(camPos, target) {
      const blds = W.buildings;
      if (!blds || !blds.length) return;
      const pad = 1.6;
      for (let pass = 0; pass < 3; pass++) {
        let adjusted = false;
        for (let i = 0; i < blds.length; i++) {
          const b = blds[i];
          const x0 = b.minX - pad, x1 = b.maxX + pad;
          const z0 = b.minZ - pad, z1 = b.maxZ + pad;
          const top = (b.H || 8) + 2.0;
          const inside = camPos.x >= x0 && camPos.x <= x1 && camPos.z >= z0 && camPos.z <= z1 && camPos.y < top;
          if (inside) {
            // push horizontally onto the nearest open Main/Fourth street corridor if low, or lift above roofline
            const ox = Math.abs(camPos.x) < 9 ? (camPos.x < 0 ? x1 + 0.5 : x0 - 0.5) : camPos.x;
            const oz = Math.abs(camPos.z) < 9 ? (camPos.z < 0 ? z1 + 0.5 : z0 - 0.5) : camPos.z;
            if (Math.abs(ox) < 5.2 && Math.abs(camPos.x) >= 5.2) camPos.x = ox;
            else if (Math.abs(oz) < 5.2 && Math.abs(camPos.z) >= 5.2) camPos.z = oz;
            else camPos.y = Math.max(camPos.y, top);
            adjusted = true;
          } else if (segmentHitsBox(camPos.x, camPos.y, camPos.z, target.x, target.y, target.z,
            b.minX - 0.5, b.maxX + 0.5, -0.5, (b.H || 8) + 0.8, b.minZ - 0.5, b.maxZ + 0.5)) {
            camPos.y = Math.max(camPos.y + 1.5, top);
            adjusted = true;
          }
        }
        if (!adjusted) break;
      }
    }

    const look = new V3();
    const tl = new Timeline(43, [
      { at: 0.1, fn: () => { ui.fadeIn(2.5); ui.caption('6:02 AM', 'Thirty minutes after the photos were sent'); A.playMusic('chase', 2); } },
      { at: 0.5, fn: () => { sirens.push(A.policeSirens({ x: 0, y: 1, z: -200 })); sirens[0].set(0.6); heliSnd = A.helicopter({ x: 0, y: 60, z: -300 }); heliSnd.set(0.5); } },
      { at: 1.5, fn: () => A.say('radio', 'All units, proceed to Main and Fourth. Heavy equipment is cleared to engage.') },
      { at: 5, fn: () => ui.caption('') },
      { at: 7, fn: () => { A.siren(siren.voice, 'blare', 1.6); siren.forceLean = 0.35; siren.armRaise = -0.6; } },
      { at: 8.5, fn: () => A.say('radio', 'Target in sight. My god... it\'s real. It\'s actually real.') },
      { at: 13.5, fn: () => A.say('radio', 'Fire the restraints! Fire, fire, fire!') },
      { at: 14, fn: () => A.chains() },
      { at: 14.6, fn: () => A.chains() },
      { at: 16.5, fn: () => { A.chains(); A.siren(siren.voice, 'blare', 1.8); } },
      { at: 18, fn: () => A.chains() },
      { at: 20, fn: () => { A.chains(); A.say('radio', 'Pull it down! All winches, full power!'); } },
      { at: 22.5, fn: () => { fallStart = tl.t; A.siren(siren.voice, 'die', 1.4); } },
      { at: 25.6, fn: () => { A.boom(1.2); ctx.shake(1.2); siren.glowOverride = 0; } },
      { at: 27, fn: () => { A.playMusic('ending', 3); ui.caption('SUSPECT IN CUSTODY', 'Hollow Creek, 6:12 AM'); } },
      { at: 28, fn: () => A.say('radio', 'Suspect is down and restrained. Hollow Creek is secure. Good work, everyone.') },
      { at: 33, fn: () => A.say('player', 'It\'s over. Hollow Creek can finally be quiet... for the right reasons.') },
      { at: 40.5, fn: () => ui.fadeOut(2.5) },
    ], (t, dt) => {
      // drive vehicles in
      vehicles.forEach(v => {
        if (t < v.delay) return;
        const z = v.mesh.position.z;
        if (z < v.stopZ) {
          const remaining = v.stopZ - z;
          v.mesh.position.z = Math.min(v.stopZ, z + Math.min(v.speed, remaining * 1.2 + 2) * dt);
        }
        v.mesh.position.x = v.x;
      });
      // flashing lights
      const on = Math.floor(t * 6) % 2 === 0;
      police.forEach((c, i) => {
        const r = c.userData.red, b = c.userData.blue;
        if (r) { r.material.color.set((on ^ (i % 2)) ? 0xff2020 : 0x300000); b.material.color.set((on ^ (i % 2)) ? 0x000030 : 0x2050ff); }
      });
      cranes.concat([swat1, swat2]).forEach(v => { if (v.userData.beacon) v.userData.beacon.material.color.set(Math.sin(t * 8) > 0 ? 0xff8800 : 0x331a00); });
      // crane booms rise toward the target
      cranes.forEach(c => { c.userData.boom.rotation.x = -lerp(0.05, 0.55, ease(clamp01((t - 9) / 4))); });
      // helicopter circles
      const ha = t * 0.25;
      const hr = lerp(140, 30, ease(clamp01(t / 14)));
      heli.position.set(Math.sin(ha) * hr, lerp(60, 34, clamp01(t / 14)), -Math.cos(ha) * hr - (t < 14 ? 0 : 0));
      heli.lookAt(0, heli.position.y, 0);
      heli.userData.rotor.rotation.y += dt * 30;
      heli.userData.tailRotor.rotation.x += dt * 45;
      heli.userData.nav.forEach((n, i) => { n.visible = Math.sin(t * 6 + i * Math.PI) > 0; });
      heli.userData.spotTarget.position.copy(siren.pos).setY(6);
      if (heliSnd) heliSnd.move(heli.position);
      if (sirens[0]) sirens[0].move(police[0].position);

      // struggle
      if (t > 14 && fallStart < 0) {
        siren.speedNow = 2.5 + Math.sin(t * 3) * 2;
        siren.yaw = Math.PI + Math.sin(t * 1.7) * 0.25;
        siren.forceLean = 0.25 + Math.sin(t * 2.3) * 0.2;
        siren.armRaise = -0.8 + Math.sin(t * 2.9) * 0.4;
      }
      // fall forward
      if (fallStart >= 0) {
        const k = clamp01((t - fallStart) / 3.1);
        siren.root.rotation.x = Math.pow(k, 2.2) * (Math.PI / 2 - 0.06);
        siren.speedNow = 0;
        siren.armRaise = lerp(-0.8, -2.2, k);
        siren.forceLean = 0.1;
      }
      siren.update(dt, null, t);
      updateCables(t);

      // ---- cameras (kept strictly along open street corridors / above roofs) ----
      if (t < 7) {               // high wide shot of the convoy
        camera.position.set(lerp(-30, -16, t / 7), lerp(42, 30, t / 7), lerp(-118, -86, t / 7));
        look.set(0, 2, lerp(-140, -36, t / 7));
      } else if (t < 13.5) {     // low hero angle down open Main St corridor, police lights flanking
        const k = (t - 7) / 6.5;
        camera.position.set(lerp(-1.1, 0.7, k), lerp(1.6, 2.2, k), lerp(-14.5, -10.5, k));
        look.set(0, lerp(7.5, 13.0, k), 0);
      } else if (t < 22.5) {     // restraint cables firing from open West cross-street (z in [-4, 4])
        const k = (t - 13.5) / 9;
        camera.position.set(lerp(-17, -25, k), lerp(4.0, 5.8, k), lerp(-3.2, 3.6, k));
        look.set(0, 7.8, -5.5);
      } else if (t < 27) {       // the fall: unobstructed shot from open East cross-street (z in [-3, 4])
        const k = clamp01((t - 22.5) / 4.5);
        camera.position.set(lerp(17, 22, k), lerp(4.2, 5.6, k), lerp(-2.5, 3.5, k));
        look.set(0, lerp(9.5, 1.4, clamp01((t - 22.5) / 3.2)), -6.0);
      } else {                   // aftermath: rise quickly above roofs before sweeping over -Z
        const k = clamp01((t - 27) / 13);
        camera.position.set(lerp(22, 15, k), lerp(5.6, 29, Math.pow(k, 0.72)), lerp(3.5, -34, Math.pow(k, 1.85)));
        look.set(0, 1.2, -7.5);
      }
      ensureClearCam(camera.position, look);
      ctx.applyShake(look);
      camera.lookAt(look);
      camera.updateMatrixWorld();
    }, () => { ctx.onDone && ctx.onDone(); });
    return tl;
  }

  LO.Cutscenes = { opening, ending, Timeline };
})();
