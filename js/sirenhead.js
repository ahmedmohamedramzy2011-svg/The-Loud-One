// ============================================================
//  THE LOUD ONE — Siren Head: model, animation and hearing AI
// ============================================================
(function () {
  const V3 = THREE.Vector3;

  const LINES = {
    wander: ['...is anyone... out there...', '...this is not a drill...', '...please remain indoors...', '...come home... come home...', '...the town is quiet now...'],
    heard: ['...I hear you...', '...who is there...', '...little noise...', '...something moved...'],
    search: ['...where did you go...', '...I know you are here...', '...make a sound... for me...', '...so quiet... so quiet...'],
    hunt: ['...FOUND YOU...', '...EMERGENCY... EMERGENCY...', '...run... run...', '...LOUD... SO LOUD...'],
  };

  function SirenHead(scene, world) {
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.buildModel();

    this.pos = this.root.position;
    this.yaw = 0;
    this.state = 'wander';
    this.anger = 0;
    this.lastHeard = new V3();
    this.lastHeardTime = -999;
    this.stateTime = 0;
    this.target = null;
    this.path = [];
    this.repathTimer = 0;
    this.speed = 0;
    this.phase = 0;
    this.lastStepSign = 1;
    this.callTimer = 10 + Math.random() * 10;
    this.lineTimer = 6;
    this.scripted = false;
    this.lean = 0;
    this.headTurn = 0;
    this.glow = 0;
    this.creakTimer = 4;
    this.hunting = false;
    this.echoTimer = 50 + Math.random() * 15;
    this.echoCount = 0;
    this.smashPulse = 0;
    this.fenceDistractUntil = 0;
    this.ignorePlayerUntil = 0;
    this.fenceLockPos = null;
    this.voice = LO.audio.createMonsterVoice();
    this.spawnFar();
  }
  LO.SirenHead = SirenHead;

  SirenHead.prototype.buildModel = function () {
    const S = LO.settings;
    const simple = S.lighting === 'simple';
    const Mat = o => simple ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.82 }, o));
    const skinTex = LO.tex.get('skin');
    const skin = Mat({ map: skinTex, color: 0xa39282 });
    const darkSkin = Mat({ map: skinTex, color: 0x5a4c42 });
    const bone = Mat({ map: skinTex, color: 0xc2b29c });
    const metal = Mat({ color: 0x55554e, metalness: 0.65, roughness: 0.45 });
    const rust = Mat({ map: LO.tex.get('metal', { color: '#5a4636' }), metalness: 0.5, roughness: 0.65 });
    const porcelain = Mat({ color: 0xd8d4c8, roughness: 0.3 });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const inside = new THREE.MeshBasicMaterial({ color: 0x050303, side: THREE.BackSide });
    this.mats = { skin, darkSkin, metal };
    const V2 = THREE.Vector2;

    // a tapered, slightly muscled limb from a radius profile [[r, t], ...] (t: 0 = top, 1 = bottom)
    function lathe(len, prof, m, seg) {
      const pts = prof.map(([r, t]) => new V2(r, -t * len));
      return new THREE.Mesh(new THREE.LatheGeometry(pts, seg || 10), m);
    }
    const knob = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
    const R = this.root;

    // ---------------- hips & legs ----------------
    const hip = new THREE.Group(); hip.position.y = 9.0; R.add(hip); this.hip = hip;
    const pelvis = lathe(0.9, [[0.05, 0], [0.62, 0.15], [0.7, 0.5], [0.45, 0.85], [0.05, 1]], darkSkin, 12);
    pelvis.position.y = 0.45; pelvis.scale.z = 0.55; hip.add(pelvis);
    this.legs = [-1, 1].map(side => {
      const thigh = new THREE.Group(); thigh.position.set(side * 0.5, 0, 0); hip.add(thigh);
      thigh.add(knob(0.3, darkSkin));
      thigh.add(lathe(4.7, [[0.05, 0], [0.32, 0.05], [0.36, 0.25], [0.24, 0.7], [0.19, 0.95], [0.05, 1]], skin));
      const knee = new THREE.Group(); knee.position.y = -4.7; thigh.add(knee);
      const kc = knob(0.27, bone); kc.scale.set(1, 1.2, 1.15); kc.position.z = 0.05; knee.add(kc);
      knee.add(lathe(4.4, [[0.05, 0], [0.22, 0.05], [0.25, 0.2], [0.14, 0.75], [0.11, 0.95], [0.05, 1]], skin));
      const ankle = new THREE.Group(); ankle.position.y = -4.4; knee.add(ankle);
      ankle.add(knob(0.16, darkSkin));
      const foot = lathe(1.5, [[0.05, 0], [0.2, 0.15], [0.17, 0.7], [0.06, 1]], darkSkin, 8);
      foot.rotation.x = -Math.PI / 2 + 0.05; foot.position.set(0, -0.12, -0.2); ankle.add(foot);
      for (let i = 0; i < 4; i++) {                                  // long, gripping toes
        const toe = lathe(0.75, [[0.05, 0], [0.06, 0.2], [0.035, 0.85], [0.005, 1]], darkSkin, 6);
        toe.rotation.x = -Math.PI / 2 + 0.35; toe.position.set((i - 1.5) * 0.11, -0.15, 1.2);
        ankle.add(toe);
      }
      return { thigh, knee, ankle, side };
    });

    // ---------------- torso ----------------
    const torso = new THREE.Group(); torso.position.y = 0.6; hip.add(torso); this.torso = torso;
    const waist = lathe(1.3, [[0.3, 0], [0.26, 0.5], [0.4, 1]], skin, 10);
    waist.rotation.x = Math.PI; waist.position.y = 1.3; waist.scale.z = 0.7; torso.add(waist);
    const chest = new THREE.Group(); chest.position.y = 1.25; torso.add(chest); this.chest = chest;
    const cage = lathe(2.4, [[0.42, 1], [0.72, 0.75], [0.8, 0.45], [0.72, 0.15], [0.45, 0]], skin, 14);
    cage.position.y = 2.4; cage.scale.z = 0.62; chest.add(cage);
    for (let i = 0; i < 6; i++) {                                    // ribs pushing through the skin
      const rr = 0.66 + Math.sin(i / 5 * Math.PI) * 0.12;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.045, 5, 16, Math.PI * 1.1), bone);
      rib.rotation.set(Math.PI / 2, 0, -Math.PI * 0.05); rib.scale.set(1, 0.64, 1);
      rib.position.set(0, 0.45 + i * 0.3, 0.03); chest.add(rib);
    }
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.08), bone); sternum.position.set(0, 1.4, 0.47); chest.add(sternum);
    for (let i = 0; i < 9; i++) {                                    // spine knuckles down the back
      const v = knob(0.09, bone); v.position.set(0, -1.1 + i * 0.42, -0.48 + Math.abs(i - 4) * 0.02); chest.add(v);
    }
    const clav = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.3, 6), bone);
    clav.rotation.z = Math.PI / 2; clav.position.set(0, 2.38, 0.18); chest.add(clav);
    [-1, 1].forEach(side => { const sb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.08), darkSkin); sb.position.set(side * 0.4, 1.8, -0.5); sb.rotation.y = side * 0.4; chest.add(sb); });

    // ---------------- arms: long enough to drag past the knees ----------------
    this.arms = [-1, 1].map(side => {
      const sh = new THREE.Group(); sh.position.set(side * 1.12, 2.3, 0); chest.add(sh);
      sh.add(knob(0.22, darkSkin));
      sh.add(lathe(3.9, [[0.05, 0], [0.22, 0.05], [0.24, 0.25], [0.15, 0.8], [0.12, 0.95], [0.05, 1]], skin));
      const elbow = new THREE.Group(); elbow.position.y = -3.9; sh.add(elbow);
      elbow.add(knob(0.15, bone));
      elbow.add(lathe(3.7, [[0.05, 0], [0.15, 0.05], [0.17, 0.3], [0.09, 0.92], [0.05, 1]], skin));
      const wrist = new THREE.Group(); wrist.position.y = -3.7; elbow.add(wrist);
      const hand = new THREE.Group(); wrist.add(hand);
      const palm = lathe(0.6, [[0.06, 0], [0.2, 0.2], [0.22, 0.7], [0.16, 1]], darkSkin, 8); palm.scale.z = 0.45; hand.add(palm);
      const fingers = [];
      for (let i = 0; i < 4; i++) {                                  // two-jointed, overlong fingers
        const f1 = new THREE.Group(); f1.position.set((i - 1.5) * 0.11, -0.58, 0); hand.add(f1);
        f1.add(lathe(0.75, [[0.045, 0], [0.04, 0.9], [0.035, 1]], darkSkin, 6));
        const f2 = new THREE.Group(); f2.position.y = -0.75; f1.add(f2);
        f2.add(lathe(0.7, [[0.035, 0], [0.025, 0.85], [0.004, 1]], darkSkin, 6));
        f1.rotation.z = (i - 1.5) * 0.06;
        fingers.push({ f1, f2 });
      }
      const th = new THREE.Group(); th.position.set(side * -0.17, -0.25, 0.08); th.rotation.z = side * -0.6; hand.add(th);
      th.add(lathe(0.55, [[0.04, 0], [0.03, 0.9], [0.005, 1]], darkSkin, 6));
      return { sh, elbow, wrist, hand, fingers, side };
    });

    // ---------------- neck: a utility pole growing out of the body ----------------
    const neck = new THREE.Group(); neck.position.y = 2.45; chest.add(neck); this.neck = neck;
    const stump = lathe(1.2, [[0.2, 1], [0.32, 0.6], [0.5, 0.15], [0.62, 0]], skin, 10);
    stump.rotation.x = Math.PI; stump.position.y = 1.2; neck.add(stump);
    for (let i = 0; i < 5; i++) {                                    // sinew wrapping up the pole
      const sinew = lathe(1.4, [[0.06, 0], [0.05, 0.7], [0.01, 1]], darkSkin, 5);
      const a = i / 5 * Math.PI * 2;
      sinew.position.set(Math.cos(a) * 0.2, 1.9, Math.sin(a) * 0.2); sinew.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      neck.add(sinew);
    }
    const poleG = new THREE.CylinderGeometry(0.13, 0.18, 3.8, 10); poleG.translate(0, 1.9 + 0.7, 0);
    neck.add(new THREE.Mesh(poleG, rust));
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), rust); cross.position.y = 3.6; neck.add(cross);
    [-0.6, -0.2, 0.2, 0.6].forEach(x => { const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), porcelain); ins.position.set(x, 3.76, 0); neck.add(ins); });

    // ---------------- head: two civil-defence sirens ----------------
    const head = new THREE.Group(); head.position.y = 4.45; neck.add(head); this.head = head;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.3), metal); head.add(bracket);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), metal); mount.position.y = -0.25; head.add(mount);
    this.mouths = [];
    const hornProfile = [[0.26, 0], [0.3, 0.25], [0.42, 0.55], [0.62, 0.78], [0.95, 0.94], [1.08, 1]];
    [-1, 1].forEach(side => {
      const s = new THREE.Group();
      s.position.set(side * 0.68, 0.32, 0.05);
      s.rotation.y = side * 0.72;
      const pts = hornProfile.map(([r, t]) => new V2(r, t * 2.2));
      const hornG = new THREE.LatheGeometry(pts, 20); hornG.rotateX(Math.PI / 2);
      s.add(new THREE.Mesh(hornG, metal));
      const innerM = new THREE.Mesh(hornG.clone(), inside); innerM.scale.set(0.96, 0.96, 1); s.add(innerM);
      [0.5, 1.1, 1.7].forEach((z, i) => {                            // stiffening rings
        const rr = [0.33, 0.47, 0.78][i];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.035, 5, 18), rust); ring.position.z = z; s.add(ring);
      });
      const lip = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.07, 6, 24), metal); lip.position.z = 2.2; s.add(lip);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.8, 14), rust);
      housing.rotation.x = Math.PI / 2; housing.position.z = -0.3; s.add(housing);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), rust);
      cap.rotation.x = -Math.PI / 2; cap.position.z = -0.7; s.add(cap);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      mouth.position.z = 0.7; s.add(mouth);
      this.mouths.push(mouth);
      head.add(s);
    });
    // sagging cables from the cross-arm
    [[-0.6, -1.2], [0.6, 1.3], [-0.2, -0.5]].forEach(([x0, x1]) => {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, 3.8, 0), new THREE.Vector3((x0 + x1) / 2, 2.4, 0.3), new THREE.Vector3(x1, 1.3, 0.2)]);
      neck.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 4), wireMat));
    });
    this.headGlow = new THREE.PointLight(0xff2a10, 0, 30, 2);
    this.headGlow.position.set(0, 0.3, 2.2); head.add(this.headGlow);

    if (S.shadows !== 'off') R.traverse(o => { if (o.isMesh) o.castShadow = true; });
  };

  SirenHead.prototype.headWorldPos = function (out) {
    return this.head.getWorldPosition(out || new V3());
  };

  SirenHead.prototype.spawnFar = function () {
    const n = this.world.nodeAt(4, 4);
    this.pos.set(n.x, 0, n.z);
    this.smashPulse = 0;
  };

  SirenHead.prototype.setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.onStateChange && this.onStateChange(s);
  };

  SirenHead.prototype.say = function (kind, dist) {
    const arr = LINES[kind];
    const line = arr[(Math.random() * arr.length) | 0];
    const vol = Math.max(0.15, 1 - dist / 140);
    LO.audio.staticBurst(this.voice, 0.5, 0.25);
    LO.audio.radioGarble(this.voice, 1.6 + line.length * 0.03, 0.35);
    LO.audio.say('siren', line, { volume: vol, pos: this.pos, urgent: kind === 'hunt' || dist < 45 });
  };

  // ------------------------------------------------------------
  //  AI update. `player` exposes: pos, noiseRadius, hidden, alive
  // ------------------------------------------------------------
  SirenHead.prototype.update = function (dt, player, time) {
    if (this.scripted || !player) { this.animate(dt); return; }
    if (LO.admin && LO.admin.sirenFreeze) { this.speedNow = 0; this.animate(dt); return; }
    this.stateTime += dt;
    this.lastTime = time;
    const W = this.world;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.distToPlayer = dist;

    const V = LO.ver ? LO.ver() : { echo: true, sirenFast: true, sirenSmash: true, fastoneV2: true };
    const adminIgnore = !!(LO.admin && LO.admin.sirenIgnore);
    const fastActive = !!(LO.ambush && LO.ambush.active === 'fastone');
    // Direct close-range spot check (only possible AFTER The Fast One has finished its encounter)
    const dirDot = dist > 0.01 ? ((dx / dist) * Math.sin(this.yaw) + (dz / dist) * Math.cos(this.yaw)) : 1;
    const directSpotClose = !adminIgnore && !fastActive && !player.hidden && dist < 8.5 && dirDot > 0.4 && player.noiseRadius > 0;
    if (directSpotClose && this.state === 'investigate_breach') {
      this.fenceLockPos = null;
      this.ignorePlayerUntil = 0;
      this.fenceDistractUntil = 0;
    }
    const fenceLocked = !!(V.fastoneV2 && this.fenceLockPos && (fastActive || time < this.ignorePlayerUntil) && !directSpotClose);
    if (!fenceLocked && time >= this.ignorePlayerUntil && time >= this.fenceDistractUntil) {
      this.fenceLockPos = null;
    }

    // ---------- HEARING ----------
    // he hears a little further than the raw noise radius (disabled while distracted by a Fast One fence breach)
    const HEAR = 1.3;
    let heard = false, strength = 0;
    const radius = player.noiseRadius * HEAR;
    if (!adminIgnore && !fenceLocked && !player.hidden && radius > 0 && dist < radius) {
      heard = true;
      strength = 1 - dist / radius;
    }
    this.heardNow = heard;
    if (fenceLocked) {
      this.anger = Math.max(0, this.anger - 35 * dt);
      this.hunting = false;
      this.echoApproach = false;
      this.lastHeard.copy(this.fenceLockPos);
      this.lastHeardTime = time;
      if (this.state !== 'investigate_breach') {
        this.reached = false;
        this.setState('investigate_breach');
      }
    } else if (heard) {
      const err = Math.min(6, dist * 0.07);
      // while hunting he leads his target, aiming where you are running to
      const lead = this.state === 'hunt' ? 1.2 : 0.4;
      this.lastHeard.set(
        player.pos.x + player.vel.x * lead + (Math.random() - 0.5) * err, 0,
        player.pos.z + player.vel.z * lead + (Math.random() - 0.5) * err);
      this.lastHeardTime = time;
      this.stalkTimer = 0;
      const rate = (26 + 115 * strength) * (this.state === 'hunt' ? 1.5 : this.state === 'search' ? 1.3 : 1);
      this.anger = Math.min(100, this.anger + rate * dt);
    } else {
      const decay = this.state === 'hunt' ? 3 : this.state === 'search' ? 5 : 5;
      if (time - this.lastHeardTime > 2.5) this.anger = Math.max(0, this.anger - decay * dt);
    }
    const sinceHeard = time - this.lastHeardTime;
    this.stalkTimer = fenceLocked ? 0 : (this.stalkTimer || 0) + dt;

    // ---------- ECHOLOCATION ----------
    // roughly once a minute he pings the town. It finds you even if you are
    // silent or hidden, and every ping narrows down where you are.
    if (V.echo && !adminIgnore) {
      this.echoTimer -= dt;
      if (!fenceLocked && this.echoTimer <= 0 && this.state !== 'hunt') {
        this.echoTimer = 52 + Math.random() * 16;
        this.echoCount++;
        LO.audio.echoPing(this.voice);
        const err = Math.max(6, Math.min(45, dist * 0.45) * Math.pow(0.8, this.echoCount - 1));
        const a = Math.random() * Math.PI * 2, r = Math.random() * err;
        this.lastHeard.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r);
        this.lastHeardTime = time;
        this.echoApproach = true;
        this.setState('investigate');
        this.onEcho && this.onEcho(dist);
      } else if (fenceLocked && this.echoTimer <= 0) {
        this.echoTimer = 10; // defer echo until fence distraction finishes
      }
    }
    if (heard) {
      this.echoApproach = false;
      this.fenceDistractUntil = 0;
      this.fenceLockPos = null;
    }

    // ---------- STATE MACHINE ----------
    switch (this.state) {
      case 'wander':
        this.speed = V.sirenFast ? 3.1 : 2.6;
        if (heard) { this.setState('investigate'); this.say('heard', dist); LO.audio.siren(this.voice, 'short', 0.8); break; }
        // he "senses" the living: every so often he heads straight for your area
        if (!adminIgnore && !fenceLocked && this.stalkTimer > 40) {
          this.stalkTimer = 0;
          const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 18;
          const p = W.projectToStreet({ x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r });
          this.path = this.buildSafeStreetPath(this.pos, p);
          break;
        }
        if (!this.path.length) {
          const nodes = W.nodes;
          let n = nodes[(Math.random() * nodes.length) | 0];
          if (Math.random() < 0.7) {
            const near = W.nearestNode(player.pos);
            const i = Math.max(0, Math.min(4, near.i + ((Math.random() * 3) | 0) - 1));
            const j = Math.max(0, Math.min(4, near.j + ((Math.random() * 3) | 0) - 1));
            n = W.nodeAt(i, j);
          }
          this.path = this.buildSafeStreetPath(this.pos, n);
        }
        break;
      case 'investigate_breach': {
        // High-priority fence breach response: 1.5x investigate speed to cover Hollow Creek quickly
        this.speed = (V.sirenFast ? 5.0 : 4.2) * 1.5;
        if (directSpotClose) {
          this.setState('investigate');
          this.lastHeard.set(player.pos.x, 0, player.pos.z);
          this.anger = Math.max(this.anger, 75);
          break;
        }
        if (!fenceLocked && heard) {
          if (this.anger >= 100) this.startHunt(dist);
          else { this.setState('investigate'); this.say('heard', dist); LO.audio.siren(this.voice, 'short', 0.8); }
          break;
        }
        const target = this.fenceLockPos || this.lastHeard;
        this.goTo(target, dt);
        const fenceHold = this.fenceDistractUntil && time < this.fenceDistractUntil;
        if (!fenceLocked && this.reached && sinceHeard > 2.5) {
          this.fenceDistractUntil = 0;
          this.fenceLockPos = null;
          this.setState('search');
        } else if (!fenceLocked && !fenceHold) {
          this.fenceLockPos = null;
          this.setState('search');
        }
        break;
      }
      case 'investigate': {
        // an echo only gives him a rough idea: he creeps closer slowly
        this.speed = this.echoApproach ? 2.6 : (V.sirenFast ? 5.0 : 4.2);
        if (!fenceLocked && this.anger >= 100) { this.startHunt(dist); break; }
        this.goTo(this.lastHeard, dt);
        const fenceHold = this.fenceDistractUntil && time < this.fenceDistractUntil;
        if (!fenceLocked && this.reached && sinceHeard > 2.5) {
          this.fenceDistractUntil = 0;
          this.fenceLockPos = null;
          this.setState('search');
        } else if (!fenceLocked && !fenceHold && sinceHeard > 18) {
          this.setState('search');
        }
        break;
      }
      case 'hunt':
        this.speed = V.sirenFast ? 7.4 : 6.0; // faster than you can sprint (or classic v1.0 speed)
        this.goTo(this.lastHeard, dt);
        if (sinceHeard > 9 && this.anger < 60 && this.stateTime > 6) {
          this.setState('search');
          LO.audio.siren(this.voice, 'short', 0.7);
          this.hunting = false;
        }
        // CATCH — only possible while he is angry AND you are making noise (never during Fast One fence distraction or admin god/ignore)
        if (!adminIgnore && !(LO.admin && LO.admin.god) && !fenceLocked && dist < 7 && player.noiseRadius > 0 && !player.hidden && this.stateTime > 0.6) {
          this.onCatch && this.onCatch();
          return;
        }
        break;
      case 'search':
        // sweeps the area around the last sound instead of standing still
        this.speed = 2.6;
        if (heard) {
          if (this.anger >= 100) this.startHunt(dist);
          else { this.setState('investigate'); if (Math.random() < 0.5) this.say('heard', dist); }
          break;
        }
        this.searchPause = (this.searchPause || 0) - dt;
        if (!this.path.length && this.searchPause <= 0) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
          const p = W.projectToStreet({ x: this.lastHeard.x + Math.cos(a) * r, z: this.lastHeard.z + Math.sin(a) * r });
          const safeP = this.clampOutsideEvidence(p);
          const ev = W.hitsEvidenceBuilding && W.hitsEvidenceBuilding(this.pos, safeP, 1.8);
          if (ev) {
            const det = this.detourPoint(this.pos, safeP, ev);
            det.push(safeP);
            this.path = det;
          } else {
            this.path = [safeP];
          }
          this.searchPause = 2 + Math.random() * 2;
        }
        if (this.path.length) this.followPath(dt); else this.speedNow = 0;
        if (this.stateTime > 18) { this.setState('wander'); this.hunting = false; }
        break;
    }

    // timers: calls and voice lines
    this.callTimer -= dt;
    this.lineTimer -= dt;
    if (this.state === 'hunt') {
      if (this.callTimer <= 0) { LO.audio.siren(this.voice, 'blare', 1.3); this.callTimer = 3.5 + Math.random() * 2; }
      if (this.lineTimer <= 0 && !heard) { this.say('hunt', dist); this.lineTimer = 7 + Math.random() * 5; }
    } else if (this.state === 'search') {
      if (this.lineTimer <= 0) { this.say('search', dist); this.lineTimer = 9 + Math.random() * 6; }
      if (this.callTimer <= 0) { LO.audio.staticBurst(this.voice, 1.4, 0.3); this.callTimer = 4 + Math.random() * 3; }
    } else if (this.state === 'wander') {
      if (this.callTimer <= 0) { LO.audio.siren(this.voice, 'call', 1); this.callTimer = 22 + Math.random() * 20; }
      if (this.lineTimer <= 0) { this.say('wander', dist); this.lineTimer = 26 + Math.random() * 20; }
    }
    this.creakTimer -= dt;
    if (this.creakTimer <= 0) { LO.audio.creak(this.voice); this.creakTimer = 5 + Math.random() * 8; }

    // ---------- MOVEMENT ----------
    if (this.state === 'wander') this.followPath(dt);
    this.animate(dt);
  };

  // a noise that is not the player (a thrown rock) — he goes to check it out
  SirenHead.prototype.hearNoise = function (pos, radius) {
    if (this.scripted) return false;
    const now = this.lastTime || 0;
    const V = LO.ver ? LO.ver() : { fastoneV2: true };
    if (V.fastoneV2 && this.fenceLockPos && ((LO.ambush && LO.ambush.active === 'fastone') || now < this.ignorePlayerUntil)) {
      return false;
    }
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d > radius * 1.3) return false;
    this.lastHeard.set(pos.x, 0, pos.z);
    this.lastHeardTime = now;
    this.echoApproach = false;
    this.path = [];
    if (this.state === 'hunt') return true;           // keeps hunting — but toward the rock
    this.anger = Math.min(90, this.anger + 15);
    this.setState('investigate');
    if (Math.random() < 0.6) this.say('heard', d);
    LO.audio.siren(this.voice, 'short', 0.8);
    return true;
  };

  // loud perimeter fence breach (The Fast One entry/exit) — enters high-priority INVESTIGATE_BREACH
  SirenHead.prototype.investigateFence = function (pos) {
    if (this.scripted || !pos) return false;
    const now = this.lastTime || 0;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    this.fenceLockPos = new V3(pos.x, 0, pos.z);
    this.lastHeard.copy(this.fenceLockPos);
    this.lastHeardTime = now;
    this.ignorePlayerUntil = now + 12;
    this.fenceDistractUntil = now + 24;
    this.anger = 0;
    this.echoApproach = false;
    this.path = [];
    this.hunting = false;
    this.reached = false;
    this.stateTime = 0;
    this.setState('investigate_breach');
    if (d < 120) this.say('heard', d);
    LO.audio.siren(this.voice, 'short', 0.9);
    return true;
  };

  SirenHead.prototype.startHunt = function (dist) {
    this.setState('hunt');
    this.hunting = true;
    LO.audio.siren(this.voice, 'blare', 1.5);
    this.callTimer = 3;
    this.lineTimer = 2;
    this.say('hunt', dist);
  };

  // compute 1- or 2-corner padded detour around an evidence building
  SirenHead.prototype.detourPoint = function (from, to, b) {
    const W = this.world;
    const pad = 2.4;
    const x0 = b.minX - pad, x1 = b.maxX + pad, z0 = b.minZ - pad, z1 = b.maxZ + pad;
    const corners = [
      new V3(x0, 0, z0),
      new V3(x1, 0, z0),
      new V3(x1, 0, z1),
      new V3(x0, 0, z1),
    ];
    const clear = (a, c) => !W.segmentHitsBox(a.x, a.z, c.x, c.z, b.minX, b.maxX, b.minZ, b.maxZ, 1.5);
    let best = null, bestLen = Infinity;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (clear(from, c) && clear(c, to)) {
        const len = Math.hypot(c.x - from.x, c.z - from.z) + Math.hypot(to.x - c.x, to.z - c.z);
        if (len < bestLen) { bestLen = len; best = [c]; }
      }
    }
    if (best) return best;
    for (let i = 0; i < 4; i++) {
      for (const step of [1, 3]) {
        const c1 = corners[i], c2 = corners[(i + step) & 3];
        if (clear(from, c1) && clear(c2, to)) {
          const len = Math.hypot(c1.x - from.x, c1.z - from.z) +
            Math.hypot(c2.x - c1.x, c2.z - c1.z) +
            Math.hypot(to.x - c2.x, to.z - c2.z);
          if (len < bestLen) { bestLen = len; best = [c1, c2]; }
        }
      }
    }
    return best || [corners[0]];
  };

  SirenHead.prototype.clampOutsideEvidence = function (pt) {
    const W = this.world;
    const out = new V3(pt.x, 0, pt.z);
    const b = W.evidenceBuildingAt && W.evidenceBuildingAt(out.x, out.z, 1.6);
    if (!b) return out;
    const pad = 1.9;
    const dL = Math.abs(out.x - (b.minX - pad)), dR = Math.abs((b.maxX + pad) - out.x);
    const dB = Math.abs(out.z - (b.minZ - pad)), dF = Math.abs((b.maxZ + pad) - out.z);
    const m = Math.min(dL, dR, dB, dF);
    if (m === dL) out.x = b.minX - pad;
    else if (m === dR) out.x = b.maxX + pad;
    else if (m === dB) out.z = b.minZ - pad;
    else out.z = b.maxZ + pad;
    return out;
  };

  SirenHead.prototype.buildSafeStreetPath = function (from, dest) {
    const W = this.world;
    const safeDest = this.clampOutsideEvidence(dest);
    const p = W.path(from, safeDest).map(n => new V3(n.x, 0, n.z));
    if (p.length > 1) {
      const a = p[0], b = p[1];
      const along = (b.x - a.x) * (from.x - a.x) + (b.z - a.z) * (from.z - a.z);
      if (along > 0) p.shift();
    }
    if (p.length && W.hitsEvidenceBuilding) {
      const evFirst = W.hitsEvidenceBuilding(from, p[0], 1.7);
      if (evFirst) {
        const det = this.detourPoint(from, p[0], evFirst);
        p.unshift(...det);
      }
    }
    const last = p.length ? p[p.length - 1] : from;
    const evLast = W.hitsEvidenceBuilding && W.hitsEvidenceBuilding(last, safeDest, 1.7);
    if (evLast) {
      p.push(...this.detourPoint(last, safeDest, evLast));
    }
    p.push(new V3(safeDest.x, 0, safeDest.z));
    return p;
  };

  // go toward a point: cut straight across non-evidence blocks when close/hunting,
  // but always path around buildings that contain evidence
  SirenHead.prototype.goTo = function (target, dt) {
    const W = this.world;
    const dest = this.clampOutsideEvidence(target);
    const d = Math.hypot(dest.x - this.pos.x, dest.z - this.pos.z);
    this.reached = d < 3.5;
    if (this.reached) { this.speedNow = 0; this.path = []; return; }
    this.repathTimer -= dt;
    const directLimit = this.state === 'hunt' ? 52 : 34;
    const blockedEv = W.hitsEvidenceBuilding && W.hitsEvidenceBuilding(this.pos, dest, 1.8);
    if (d < directLimit && !blockedEv) {
      this.path = [dest];
    } else if (d < 26 && blockedEv) {
      if (this.repathTimer <= 0 || !this.path.length) {
        this.repathTimer = 0.6;
        const det = this.detourPoint(this.pos, dest, blockedEv);
        det.push(dest);
        this.path = det;
      }
    } else if (this.repathTimer <= 0 || !this.path.length) {
      this.repathTimer = 1.4;
      const proj = W.projectToStreet(dest);
      this.path = this.buildSafeStreetPath(this.pos, proj);
    }
    this.followPath(dt);
  };

  SirenHead.prototype.followPath = function (dt) {
    if (!this.path.length) { this.speedNow = 0; return; }
    const W = this.world;
    const t = this.path[0];
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) { this.path.shift(); return; }
    const want = Math.atan2(dx, dz);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turnRate = this.state === 'investigate_breach' ? 4.2 : 1.6;
    this.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
    const facing = Math.max(0, Math.cos(diff));
    const step = this.speed * dt * (0.25 + 0.75 * facing);
    const move = Math.min(step, d);
    let nx = this.pos.x + Math.sin(this.yaw) * move;
    let nz = this.pos.z + Math.cos(this.yaw) * move;

    // never clip into an evidence-containing building — slide outside its perimeter and detour
    const evB = W.evidenceBuildingAt && W.evidenceBuildingAt(nx, nz, 1.5);
    if (evB) {
      const pad = 1.65;
      const dL = Math.abs(nx - (evB.minX - pad)), dR = Math.abs((evB.maxX + pad) - nx);
      const dB = Math.abs(nz - (evB.minZ - pad)), dF = Math.abs((evB.maxZ + pad) - nz);
      const m = Math.min(dL, dR, dB, dF);
      if (m === dL) nx = evB.minX - pad;
      else if (m === dR) nx = evB.maxX + pad;
      else if (m === dB) nz = evB.minZ - pad;
      else nz = evB.maxZ + pad;
      if (W.segmentHitsBox && W.segmentHitsBox(this.pos.x, this.pos.z, t.x, t.z, evB.minX, evB.maxX, evB.minZ, evB.maxZ, 1.4)) {
        const det = this.detourPoint({ x: nx, z: nz }, t, evB);
        if (det.length) this.path = det.concat(this.path);
      }
    }

    this.pos.x = nx;
    this.pos.z = nz;
    this.speedNow = step / Math.max(dt, 1e-4);

    // smash straight through non-evidence buildings in our path (v2.4.1+)
    if (!LO.ver || LO.ver().sirenSmash) {
      const hit = W.smashableBuildingAt && W.smashableBuildingAt(this.pos.x, this.pos.z, 1.3);
      if (hit) {
        const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
        if (W.smashBuilding(hit, this.pos, dir)) {
          LO.audio.buildingSmash(this.pos);
          this.smashPulse = 0.65;
          this.onSmash && this.onSmash(hit, this.pos);
        }
      }
    }
    // break through perimeter fences if touched (leaving persistent scattered wood planks)
    if (W.fences) {
      for (let i = 0; i < W.fences.length; i++) {
        const f = W.fences[i];
        if (f.broken) continue;
        const dx = Math.abs(this.pos.x - f.pos.x), dz = Math.abs(this.pos.z - f.pos.z);
        const hit = f.axis === 'z' ? (dx < 1.8 && dz < 3.15) : (dz < 1.8 && dx < 3.15);
        if (hit) {
          const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
          if (W.smashFence) W.smashFence(f, this.pos, dir);
          else {
            f.broken = true;
            f.mesh.visible = false;
            if (f.collider) f.collider.disabled = true;
          }
          LO.audio.fenceSmash && LO.audio.fenceSmash(f.pos);
        }
      }
    }
  };

  // ------------------------------------------------------------
  //  ANIMATION
  // ------------------------------------------------------------
  SirenHead.prototype.animate = function (dt) {
    const v = this.speedNow || 0;
    this.root.rotation.y = this.yaw;
    this.animT = (this.animT || 0) + dt;
    const T = this.animT;
    this.phase += dt * (0.5 + v * 0.34);
    const ph = this.phase;
    const amp = Math.min(1, v / 3.5);
    const hunt = this.state === 'hunt' ? 1 : 0;
    this.huntK = (this.huntK || 0) + (hunt - (this.huntK || 0)) * Math.min(1, dt * 2);
    const H = this.huntK;

    // ---- legs: long, heavy strides; knees fold during the swing, feet stay flat-ish
    this.legs.forEach(L => {
      const p = ph + (L.side > 0 ? Math.PI : 0);
      L.thigh.rotation.x = -Math.sin(p) * 0.55 * amp - 0.06;
      L.knee.rotation.x = 0.1 + (0.15 + Math.max(0, -Math.cos(p)) * 0.95) * amp;
      L.ankle.rotation.x = -(L.thigh.rotation.x + L.knee.rotation.x) * 0.75;
      L.thigh.rotation.z = L.side * 0.04;
    });
    // footstep when a stride lands
    const sgn = Math.sign(Math.sin(ph));
    if (amp > 0.1 && sgn !== this.lastStepSign) {
      this.lastStepSign = sgn;
      const footX = this.pos.x + Math.cos(this.yaw) * sgn * 0.6, footZ = this.pos.z - Math.sin(this.yaw) * sgn * 0.6;
      LO.audio.giantStep({ x: footX, y: 0, z: footZ }, 0.5 + amp * 0.6);
      this.onStep && this.onStep(this.pos);
    }
    // ---- hips: drop on each step and sway side to side
    this.hip.position.y = 9.0 - Math.abs(Math.cos(ph)) * 0.42 * amp;
    this.hip.rotation.z = Math.sin(ph) * 0.06 * amp;
    this.hip.rotation.y = Math.sin(ph) * 0.1 * amp;

    // ---- posture
    this.smashPulse = Math.max(0, (this.smashPulse || 0) - dt * 1.8);
    const sp = this.smashPulse;
    const searching = this.state === 'search' || ((this.state === 'investigate' || this.state === 'investigate_breach') && this.reached);
    const targetLean = this.forceLean !== undefined ? this.forceLean : (searching ? 0.5 : 0.14 + H * 0.22 + sp * 0.45);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 1.5);
    this.torso.rotation.x = this.lean;
    this.torso.rotation.y = -Math.sin(ph) * 0.13 * amp;            // shoulders counter-swing the hips
    this.torso.rotation.z = -Math.sin(ph) * 0.04 * amp;
    const breathe = Math.sin(T * 1.2) * 0.025;
    this.chest.scale.set(1 + breathe, 1 + breathe * 0.4, 1 + breathe);

    // ---- arms: dangle and swing with a lagging elbow; reach forward when hunting
    this.arms.forEach(A => {
      const p = ph + (A.side > 0 ? 0 : Math.PI);
      A.sh.rotation.x = Math.sin(p) * 0.34 * amp - this.lean * 0.85 + (this.armRaise || 0) - H * 0.35 - sp * 0.7;
      A.sh.rotation.z = A.side * (0.07 + H * 0.18 + sp * 0.22) + Math.sin(T * 0.7 + A.side) * 0.015;
      A.elbow.rotation.x = -(0.25 + Math.max(0, Math.sin(p - 0.7)) * 0.4 * amp) - H * 0.45;
      A.wrist.rotation.x = Math.sin(p - 1.3) * 0.25 * amp - 0.1;
      const curl = 0.25 + H * 0.55 + Math.max(0, Math.sin(T * 5 + A.side * 2)) * 0.06;
      A.fingers.forEach((f, i) => { f.f1.rotation.x = curl + i * 0.03; f.f2.rotation.x = curl * 1.3; });
    });

    // ---- head: delayed bob, listening turns, and the odd twitch
    this.headTurnT = (this.headTurnT || 0) + dt;
    const look = searching ? Math.sin(this.headTurnT * 0.7) * 0.9 : Math.sin(this.headTurnT * 0.3) * 0.2;
    this.headTurn += (look - this.headTurn) * Math.min(1, dt * 2);
    this.twitchT = (this.twitchT || 3) - dt;
    if (this.twitchT <= 0) { this.twitch = (Math.random() - 0.5) * 0.5; this.twitchT = 2 + Math.random() * 6; }
    this.twitch = (this.twitch || 0) * Math.exp(-dt * 6);
    this.neck.rotation.y = this.headTurn + this.twitch;
    this.neck.rotation.z = Math.sin(this.headTurnT * 0.9) * 0.05 + this.twitch * 0.4;
    this.neck.rotation.x = -this.lean * 0.45 + (this.neckDip || 0) + Math.sin(ph * 2 - 0.8) * 0.04 * amp;
    this.head.rotation.z = Math.sin(T * 0.5) * 0.03;

    // ---- horn glow by anger
    const g = this.glowOverride !== undefined ? this.glowOverride : this.anger / 100;
    this.glow += (g - this.glow) * Math.min(1, dt * 3);
    const flick = this.state === 'hunt' ? 0.75 + Math.random() * 0.25 : 1;
    this.mouths.forEach(m => { m.material.opacity = this.glow * 0.9 * flick; });
    this.headGlow.intensity = this.glow * 3 * flick;

    // sound emitter follows the head
    if (this.voice) {
      const hp = this.headWorldPos(tmp);
      LO.audio.setPannerPos(this.voice.panner, hp);
    }
  };
  const tmp = new V3();

  SirenHead.prototype.status = function (player) {
    if (player.hidden && this.state !== 'wander') return 'hidden';
    if (this.state === 'hunt') return 'angry';
    if (this.state === 'search') return 'searching';
    if (this.state === 'investigate' || this.state === 'investigate_breach') return 'heard';
    return 'calm';
  };

  SirenHead.prototype.dispose = function () {
    this.scene.remove(this.root);
    if (this.voice) { try { this.voice.out.disconnect(); } catch (e) {} }
  };
})();
