// ============================================================
//  THE LOUD ONE — the player: movement, noise, stamina,
//  flashlight, photo camera and hiding
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const RADIUS = 0.35;

  // noise radii in metres: how far away Siren Head can hear each thing
  const NOISE = {
    flashlight: 9, crouch: 4, walk: 16, sprint: 46, panting: 6,
    jump: 30, land: 36, shutter: 14, hide: 5, kicked: 42,
  };
  const TENANT_LIMIT = 14;
  const TENANT_HURT = 10;    // seconds of hiding before it starts to hurt you
  const TENANT_DAMAGE = 30;
  const MAX_ROCKS = 3;
  // THE EXPOSURE: appears in the viewfinder after 4s of camera use, lunges at 10s
  const EXPO = { SHOW: 4, LUNGE: 10, DECAY: 0.6, WASTED: 2.5, LUNGE_DMG: 40, BANISH_DMG: 25 };
  LO.EXPO = EXPO;
  LO.MAX_ROCKS = MAX_ROCKS;
  // THE SILENT ONE (Phenomenon-249): drawn to complete silence
  const SILENT_WARN = 20, SILENT_ATTACK = 30, SILENT_DAMAGE = 10, SILENT_TICK = 1.0;
  LO.SILENT = { WARN: SILENT_WARN, ATTACK: SILENT_ATTACK };   // seconds you can hide before the Tenant loses patience
  LO.TENANT_LIMIT = TENANT_LIMIT;
  LO.NOISE = NOISE;

  function Player(camera, world, scene) {
    this.camera = camera;
    this.world = world;
    this.scene = scene;
    this.pos = new V3();
    this.vel = new V3();
    this.yaw = 0; this.pitch = 0;
    this.keys = {};
    this.enabled = false;

    // flashlight
    this.flash = new THREE.SpotLight(0xfff1d6, 0, 48, 0.5, 0.45, 1.3);
    this.flash.position.set(0.28, -0.22, 0);
    this.flashTarget = new THREE.Object3D();
    this.flashTarget.position.set(0.1, -0.1, -10);
    camera.add(this.flash); camera.add(this.flashTarget);
    this.flash.target = this.flashTarget;
    const sh = LO.settings.shadows;
    if (sh !== 'off') {
      this.flash.castShadow = true;
      this.flash.shadow.mapSize.set(sh === 'high' ? 1024 : 512, sh === 'high' ? 1024 : 512);
      this.flash.shadow.bias = -0.0005;
      this.flash.shadow.camera.near = 0.3;
    }
    // camera flash burst
    this.burst = new THREE.PointLight(0xffffff, 0, 30, 1.5);
    camera.add(this.burst);
    scene.add(camera);

    this.raycaster = new THREE.Raycaster();
    this.reset(world.spawn, 0);
    this.bindInput();
  }
  LO.Player = Player;

  Player.prototype.reset = function (spawn, yaw) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = yaw || 0; this.pitch = 0;
    this.onGround = true;
    this.crouch = 0;
    this.stamina = 100;
    this.exhausted = false;
    this.panting = 0;
    this.battery = 100;
    this.flashOn = false;
    this.cameraUp = false;
    this.hidden = null;
    this.hideAnim = null;
    this.hideView = false;
    ((this.world && this.world.hideSpots) || []).forEach(sp => sp.setOpen && sp.setOpen(0));
    this.hideTime = 0;
    this.rocks = 0;
    (this.projectiles || []).forEach(r => r.mesh.parent && r.mesh.parent.remove(r.mesh));
    this.projectiles = [];
    this.health = 100;          // never regenerates
    this.silentTime = 0;
    this.silentTick = 0;
    this.noSilent = false;
    this.calm = false;
    this.flickerForce = false;
    this.exposure = 0;
    this.spike = 0;
    this.noiseRadius = 0;
    this.stepPhase = 0;
    this.lastStep = 0;
    this.photoCooldown = 0;
    this.vfTimer = 0;
    this.vfTarget = null;
    this.bob = 0;
    this.shake = 0;
    this.prompt = '';
    this.alive = true;
    this.zoom = 0;
    this.adrenaline = 0;
    this.dizzy = 0;
    this.dizzyT = 0;
  };

  Player.prototype.bindInput = function () {
    const self = this;
    window.addEventListener('keydown', e => {
      self.keys[e.code] = true;
      if (!self.enabled) return;
      if (e.code === 'KeyF') self.toggleFlash();
      if (e.code === 'KeyE') self.interact();
      if (e.code === 'KeyQ') self.cameraUp = !self.cameraUp;
      if (e.code === 'KeyG') self.throwRock();
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', e => { self.keys[e.code] = false; });
    document.addEventListener('mousemove', e => {
      if (!self.enabled || document.pointerLockElement == null) return;
      const s = 0.0022 * LO.settings.sensitivity * (self.cameraUp ? 0.6 : 1);
      self.yaw -= e.movementX * s;
      self.pitch -= e.movementY * s * (LO.settings.invertY ? -1 : 1);
      self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch));
    });
    document.addEventListener('mousedown', e => {
      if (!self.enabled || document.pointerLockElement == null) return;
      if (e.button === 2) self.cameraUp = true;
      if (e.button === 0) {
        if (self.cameraUp) self.takePhoto();
        else self.hint && self.hint('Raise your camera first — hold RIGHT MOUSE or press Q' + (LO.isTouch ? ' (tap CAMERA)' : ''));
      }
    });
    document.addEventListener('mouseup', e => { if (e.button === 2) self.cameraUp = false; });
    document.addEventListener('contextmenu', e => e.preventDefault());
  };

  // inside a hiding spot the flashlight is a last resort against the Tenant:
  // one blinding burst drives it off, draining 90% battery (95% in v2.1-v2.3)
  Player.prototype.blindTenant = function () {
    const V = LO.ver ? LO.ver() : { tenant: true, tenantBlind: true, tenantCost: 90 };
    if (!V.tenant || !V.tenantBlind) {
      LO.audio.click(false);
      this.hint && this.hint('Cannot use flashlight while hiding.');
      return;
    }
    const cost = V.tenantCost || 90;
    if (this.battery < cost) {
      LO.audio.click(false);
      this.hint && this.hint(`Not enough battery (needs ${cost}%).`);
      return;
    }
    this.battery -= cost;
    this.hideTime = 0;
    this.tenantTick = 0;
    this.burst.intensity = 18;
    this.onTenantBlinded && this.onTenantBlinded();
  };
  Player.prototype.toggleFlash = function () {
    if (this.hidden) { this.blindTenant(); return; }
    if (!this.flashOn && this.battery <= 0) { LO.audio.click(false); this.hint && this.hint('The flashlight is dead. Find batteries.'); return; }
    this.flashOn = !this.flashOn;
    LO.audio.click(this.flashOn);
  };

  // ------------------------------------------------------------
  Player.prototype.update = function (dt, time) {
    const W = this.world, k = this.keys;
    this.photoCooldown = Math.max(0, this.photoCooldown - dt);
    this.adrenaline = Math.max(0, (this.adrenaline || 0) - dt);
    if (this.dizzy > 0) {
      this.dizzy = Math.max(0, this.dizzy - dt * 0.22);
      this.dizzyT = (this.dizzyT || 0) + dt;
    }
    this.spike *= Math.exp(-dt * 3.2);
    if (this.spike < 0.5) this.spike = 0;

    let moving = false, sprinting = false;
    const indoor = W.isIndoor(this.pos);
    this.indoor = indoor;

    // mid-way into or out of a hiding spot: no control until the door shuts
    if (this.hideAnim) {
      this.vel.set(0, 0, 0);
      this.updateHideAnim(dt);
      this.noiseRadius = this.spike + (this.flashOn ? NOISE.flashlight : 0);
      // the light stays on until you're fully inside (it goes off as the door shuts)
      this.flash.intensity = this.flashOn ? (LO.settings.lighting === 'simple' ? 3 : 8) * Math.min(1, 0.4 + this.battery / 40) : 0;
      LO.audio.setFlashlightBuzz(this.flashOn);
      this.zoom = 0;
      return;
    }
    this.hideView = !!this.hidden;

    if (this.hidden) {
      // locked in place, can only look around a bit
      const sp = this.hidden;
      this.pos.set(sp.pos.x, 0, sp.pos.z);
      this.vel.set(0, 0, 0);
      let d = this.yaw - (sp.yaw + Math.PI);
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      d = Math.max(-0.9, Math.min(0.9, d));
      this.yaw = sp.yaw + Math.PI + d;
      this.pitch = Math.max(-0.5, Math.min(0.4, this.pitch));
      this.flashOn = false;
      this.cameraUp = false;
      this.stamina = Math.min(100, this.stamina + 18 * dt);
      // THE TENANT: something already lives in every hiding spot (v1.4+).
      // Stay too long and it throws you out.
      const Vh = LO.ver ? LO.ver() : { tenant: true };
      if (!Vh.tenant) {
        this.hideTime = 0;
      } else {
        if (!this.calm) this.hideTime += dt;
        // after ~10s of hiding it starts hurting you every second, harder the closer it gets
        const eyeK = (this.hideTime - TENANT_HURT) / (TENANT_LIMIT - TENANT_HURT);
        if (eyeK >= 0 && !this.calm) {
          this.tenantTick = (this.tenantTick || 0) - dt;
          if (this.tenantTick <= 0) {
            this.tenantTick = 1;
            this.damage(Math.round(2 + eyeK * 6), 'tenant');
          }
        } else this.tenantTick = 0;   // first hit lands the moment it starts
        if (this.hideTime >= TENANT_LIMIT) { this.damage(9999, 'tenant'); }   // it reached you
      }
      this.panting = Math.max(0, this.panting - dt * 0.5);
    } else {
      this.hideTime = Math.max(0, this.hideTime - dt * 0.5);
      // ---------- movement ----------
      const wantCrouch = k.KeyC || k.ControlLeft || k.ControlRight;
      this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
      let fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      let str = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      // analog touch joystick
      const tm = this.touchMove;
      let analog = 1;
      if (tm && Math.hypot(tm.x, tm.y) > 0.15) { fwd = -tm.y; str = tm.x; analog = Math.min(1, Math.hypot(tm.x, tm.y)); }
      moving = fwd !== 0 || str !== 0;
      const wantSprint = (k.ShiftLeft || k.ShiftRight) && moving && fwd > 0.3 && !wantCrouch && !this.cameraUp;
      if (this.adrenaline > 0) this.exhausted = false;
      if (this.exhausted && this.stamina > 35) this.exhausted = false;
      sprinting = wantSprint && !this.exhausted && this.stamina > 0;
      const sprintSpeed = this.adrenaline > 0 ? 13.8 : 6.9;
      let speed = (wantCrouch ? 1.6 : sprinting ? sprintSpeed : 3.3) * (sprinting ? 1 : Math.max(0.5, analog));
      if (this.cameraUp) speed *= 0.6;
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      let mx = -sinY * fwd + cosY * str, mz = -cosY * fwd - sinY * str;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const accel = this.onGround ? 12 : 3;
      this.vel.x += (mx * speed * (moving ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (mz * speed * (moving ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);

      // jump
      if (k.Space && this.onGround && this.stamina > 12 && !wantCrouch) {
        this.vel.y = 4.6; this.onGround = false;
        this.stamina -= 12;
        this.spike = Math.max(this.spike, NOISE.jump);
        LO.audio.jumpGrunt();
        k.Space = false;
      }
      this.vel.y -= 13 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0) {
        if (!this.onGround) {
          const hard = this.vel.y < -4;
          LO.audio.land(hard);
          this.spike = Math.max(this.spike, NOISE.land * (hard ? 1 : 0.6));
          this.shake = Math.max(this.shake, 0.15);
        }
        this.pos.y = 0; this.vel.y = 0; this.onGround = true;
      }
      this.collide();

      // stamina
      if (sprinting) {
        this.stamina -= (this.adrenaline > 0 ? 4.5 : 21) * dt;
        if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; this.panting = 1; }
      } else {
        this.stamina = Math.min(100, this.stamina + (moving ? 9 : 15) * dt);
      }
      if (sprinting && this.stamina < 40) this.panting = Math.max(this.panting, 0.6);
      if (!sprinting) this.panting = Math.max(0, this.panting - dt * (this.crouch > 0.5 ? 0.25 : 0.12));

      // footsteps
      const hspeed = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hspeed > 0.5) {
        this.stepPhase += dt * hspeed * (sprinting ? 0.42 : 0.55);
        if (Math.floor(this.stepPhase) !== this.lastStep) {
          this.lastStep = Math.floor(this.stepPhase);
          LO.audio.footstep(sprinting ? 'run' : this.crouch > 0.5 ? 'crouch' : 'walk', indoor);
        }
      }
      this.bob = this.onGround ? Math.sin(this.stepPhase * Math.PI) * Math.min(1, hspeed / 4) : 0;
      this.moving = hspeed > 0.5;
      this.sprinting = sprinting && hspeed > 3;
    }

    // ---------- battery ----------
    if (this.flashOn) {
      this.battery = Math.max(0, this.battery - dt * 100 / 360);
      if (this.battery <= 0) { this.flashOn = false; LO.audio.click(false); this.hint && this.hint('The flashlight died.'); }
    }
    let flick = 0;
    if (this.flashOn && this.battery < 15 && Math.random() < 0.08) flick = 1;
    // the Sneaky One makes the light stutter while it's behind you
    if (this.flickerForce && Math.random() < 0.35) flick = 1;
    this.flash.intensity = this.flashOn ? (flick ? (this.flickerForce ? 0.02 : 0.3) : 1) * (LO.settings.lighting === 'simple' ? 3 : 8) * Math.min(1, 0.4 + this.battery / 40) : 0;
    LO.audio.setFlashlightBuzz(this.flashOn, this.battery < 15 ? 1 : 0);

    // ---------- noise ----------
    // every source STACKS: walking with the light on is louder than either alone
    let n = 0;
    if (this.flashOn) n += NOISE.flashlight;
    if (this.moving && !this.hidden) n += this.sprinting ? NOISE.sprint : this.crouch > 0.5 ? NOISE.crouch : NOISE.walk;
    if (this.panting > 0.05 && !(this.crouch > 0.5 && !this.moving) && !this.hidden) n += NOISE.panting;
    n += this.spike;
    if (indoor) n *= 0.6;
    if (this.hidden) n = this.spike > 0 ? this.spike * 0.5 : 0;
    this.noiseRadius = n;

    // ---------- THE SILENT ONE ----------
    // any sound at all resets it; total silence (including hiding) feeds it
    const Vs = LO.ver ? LO.ver() : { silent: true, silentDamage: SILENT_DAMAGE, rocks: true, exposure: true };
    if (!Vs.silent || n > 0 || this.noSilent || this.calm) { this.silentTime = 0; this.silentTick = 0; }
    else {
      this.silentTime += dt;
      if (this.silentTime >= SILENT_ATTACK) {
        this.silentTick -= dt;
        if (this.silentTick <= 0) {
          this.silentTick = SILENT_TICK;
          this.damage(Vs.silentDamage || SILENT_DAMAGE, 'silent');
        }
      }
    }
    LO.audio.setBreathing(Math.min(1, this.panting * 1.2) * (this.crouch > 0.5 && !this.moving ? 0.15 : 1));

    // ---------- pickups ----------
    W.pickups.forEach(p => {
      if (p.taken) return;
      if (p.type === 'rock' && !Vs.rocks) return;
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 1.4) {
        if (p.type === 'rock') {
          if (this.hidden) return;
          if (this.rocks >= MAX_ROCKS) {
            if (!p.fullWarned) { p.fullWarned = true; this.hint && this.hint(`You can only carry ${MAX_ROCKS} rocks.`); }
            return;
          }
          p.taken = true; p.mesh.visible = false;
          this.rocks++;
          LO.audio.click(false);
          this.hint && this.hint(`Rock picked up (${this.rocks}/${MAX_ROCKS}). ${LO.isTouch ? 'Tap THROW' : 'Press G'} to throw and distract it.`);
          return;
        }
        p.taken = true; p.mesh.visible = false;
        this.battery = Math.min(100, this.battery + 45);
        LO.audio.pickup();
        this.hint && this.hint('Battery found (+45%)');
      }
    });

    // ---------- thrown rocks ----------
    this.updateRocks(dt);

    // ---------- interaction prompt ----------
    this.prompt = '';
    if (this.hidden) this.prompt = '<kbd>E</kbd>Leave hiding spot';
    else {
      const sp = this.nearestHideSpot();
      if (sp) this.prompt = sp.lockedUntil > performance.now() / 1000 ? 'Something is moving inside...' : `<kbd>E</kbd>Hide in ${sp.type}`;
    }

    // ---------- camera zoom & viewfinder ----------
    this.zoom += ((this.cameraUp ? 1 : 0) - this.zoom) * Math.min(1, dt * 8);

    // ---------- THE EXPOSURE ----------
    // it lives in the lens: the longer the camera is up, the closer it gets
    if (!Vs.exposure || this.calm) this.exposure = 0;
    else if (this.zoom > 0.5) this.exposure += dt;
    else this.exposure = Math.max(0, this.exposure - dt * EXPO.DECAY);
    if (Vs.exposure && this.exposure >= EXPO.LUNGE) {
      this.exposure = 0;
      this.cameraUp = false;
      this.damage(EXPO.LUNGE_DMG, 'exposure');
      if (this.health > 0) this.onExposure && this.onExposure('lunge');
    }
    this.vfTimer -= dt;
    if (this.cameraUp && this.vfTimer <= 0) { this.vfTimer = 0.12; this.vfTarget = this.findEvidence(); }
    this.burst.intensity *= Math.exp(-dt * 25);

    this.applyCamera(dt, time);
  };

  Player.prototype.triggerDizzy = function (strength) {
    this.dizzy = Math.max(this.dizzy || 0, Math.min(1.4, strength || 1));
  };

  Player.prototype.ejectFromHide = function () {
    const s = this.hidden || (this.hideAnim && this.hideAnim.spot);
    this.hidden = null;
    this.hideAnim = null;
    this.hideView = false;
    if (s) {
      this.pos.set(s.exit.x, 0, s.exit.z);
    }
    this.pos.y = 0;
    this.onGround = true;
  };

  Player.prototype.applyCamera = function (dt, time) {
    const cam = this.camera;
    const eye = this.hidden ? this.hidden.pos.y : (1.62 - this.crouch * 0.67);
    const bobAmt = LO.settings.headBob ? 1 : 0;
    this.shake = Math.max(0, this.shake - dt * 0.8);
    const sh = this.shake;
    const dz = Math.min(1, this.dizzy || 0);
    const dtz = this.dizzyT || 0;
    cam.position.set(
      this.pos.x + (Math.random() - 0.5) * sh,
      this.pos.y + eye + this.bob * 0.05 * bobAmt + (Math.random() - 0.5) * sh,
      this.pos.z + (Math.random() - 0.5) * sh,
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + dz * Math.cos(dtz * 2.1) * 0.055;
    cam.rotation.x = this.pitch + dz * Math.sin(dtz * 3.1) * 0.045;
    cam.rotation.z = Math.sin(this.stepPhase * Math.PI * 0.5) * 0.006 * bobAmt * (this.moving ? 1 : 0)
      + dz * (Math.sin(dtz * 2.5) * 0.14 + Math.sin(dtz * 5.2) * 0.045);
    const fov = LO.settings.fov * (1 - this.zoom * 0.35) + dz * Math.sin(dtz * 3.7) * 5.5;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };

  Player.prototype.collide = function () {
    const p = this.pos;
    const all = this.world.evColliders.length ? this.world.colliders.concat(this.world.evColliders) : this.world.colliders;
    for (const c of all) {
      if (c.disabled) continue;
      if (c.maxY < p.y + 0.3) continue;
      if (c.minY > p.y + 1.75) continue;   // e.g. the wall above a doorway
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = RADIUS - d;
        p.x += dx / d * push; p.z += dz / d * push;
      } else {
        // centre is inside the box: push out along the shortest axis
        const opts = [[c.minX - RADIUS - p.x, 0], [c.maxX + RADIUS - p.x, 0], [0, c.minZ - RADIUS - p.z], [0, c.maxZ + RADIUS - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0]; p.z += opts[0][1];
      }
    }
  };

  Player.prototype.kickOut = function () {
    const s = this.hidden;
    if (!s) return;
    this.hidden = null;
    s.lockedUntil = performance.now() / 1000 + 45;   // it keeps that spot for a while
    this.pos.copy(s.exit);
    this.yaw = s.yaw + Math.PI;
    this.pitch = 0.1;
    // shoved out hard — and it is LOUD
    const dir = new V3(s.exit.x - s.pos.x, 0, s.exit.z - s.pos.z).normalize();
    this.vel.set(dir.x * 7, 3, dir.z * 7);
    this.onGround = false;
    this.spike = Math.max(this.spike, NOISE.kicked);
    this.shake = Math.max(this.shake, 0.9);
    this.hideTime = TENANT_LIMIT * 0.6;              // still restless if you dive straight back in
    this.damage(TENANT_DAMAGE, 'tenant');
    if (this.health > 0) this.onKicked && this.onKicked();
  };

  // ------------------------------------------------------------
  //  ROCKS — throw one to make a loud noise somewhere else
  // ------------------------------------------------------------
  const rockGeo = new THREE.DodecahedronGeometry(0.14);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x77736c });
  Player.prototype.throwRock = function () {
    if (LO.ver && !LO.ver().rocks) return;
    if (!this.enabled || this.hidden) return;
    if (this.rocks <= 0) { this.hint && this.hint('No rocks. Look for them on the ground.'); return; }
    this.rocks--;
    const dir = new V3();
    this.camera.getWorldDirection(dir);
    const mesh = new THREE.Mesh(rockGeo, rockMat);
    mesh.position.copy(this.camera.position).addScaledVector(dir, 0.6);
    this.scene.add(mesh);
    const vel = dir.multiplyScalar(17); vel.y += 4.5;
    this.projectiles.push({ mesh, vel, spin: new V3(Math.random() * 9, Math.random() * 9, 0) });
    this.spike = Math.max(this.spike, 3);   // the throw itself is quiet
    LO.audio.jumpGrunt();
  };
  Player.prototype.updateRocks = function (dt) {
    const W = this.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const r = this.projectiles[i], p = r.mesh.position;
      r.vel.y -= 13 * dt;
      const nx = p.x + r.vel.x * dt, nz = p.z + r.vel.z * dt;
      // hit a wall: drop straight down
      const hit = W.colliders.concat(W.evColliders).some(c => !c.disabled && p.y < c.maxY && p.y > (c.minY || 0) && nx > c.minX && nx < c.maxX && nz > c.minZ && nz < c.maxZ);
      if (hit) { r.vel.x *= -0.15; r.vel.z *= -0.15; } else { p.x = nx; p.z = nz; }
      p.y += r.vel.y * dt;
      r.mesh.rotation.x += r.spin.x * dt; r.mesh.rotation.y += r.spin.y * dt;
      if (p.y <= 0.12) {
        p.y = 0.12;
        this.projectiles.splice(i, 1);
        LO.audio.rockClack(p);
        this.onRockLand && this.onRockLand(p.clone());
        // the rock stays where it lands and can be picked up again
        W.pickups.push({ type: 'rock', mesh: r.mesh, pos: r.mesh.position, baseY: 0.12, taken: false });
      }
    }
  };

  Player.prototype.damage = function (amount, cause) {
    if (this.health <= 0) return;
    const hasHealth = !LO.ver || LO.ver().health;
    this.health = hasHealth ? Math.max(0, this.health - amount) : 0;
    this.shake = Math.max(this.shake, 0.3);
    this.onDamage && this.onDamage(amount, cause);
    if (this.health <= 0) this.onDeath && this.onDeath(cause);
  };

  Player.prototype.nearestHideSpot = function () {
    let best = null, bd = 1.7;
    const fwd = new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.world.hideSpots.forEach(s => {
      if (s.disabled) return;
      const dx = s.interact.x - this.pos.x, dz = s.interact.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const tx = s.pos.x - this.pos.x, tz = s.pos.z - this.pos.z;
      const facing = (tx * fwd.x + tz * fwd.z) / (Math.hypot(tx, tz) || 1);
      if (d < bd && facing > 0.3) { bd = d; best = s; }
    });
    return best;
  };

  // ---------- climbing in and out: the door/lid swings open, you move, it closes ----------
  const HIDE_ANIM = 1.0;
  const smooth = t => t * t * (3 - 2 * t);
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  Player.prototype.startHideAnim = function (spot, dir) {
    const eyeOut = 1.62;
    this.hideAnim = {
      spot, dir, t: 0,
      fromPos: dir === 'in' ? new V3(this.pos.x, eyeOut, this.pos.z) : spot.pos.clone(),
      toPos: dir === 'in' ? spot.pos.clone() : new V3(spot.exit.x, eyeOut, spot.exit.z),
      fromYaw: this.yaw, toYaw: spot.yaw + Math.PI,
      fromPitch: this.pitch,
    };
    LO.audio.hideDoor();
  };
  Player.prototype.updateHideAnim = function (dt) {
    const A = this.hideAnim, sp = A.spot;
    A.t = Math.min(1, A.t + dt / HIDE_ANIM);
    const t = A.t;
    // open (0-35%), hold while you move (35-65%), close (65-100%)
    const open = t < 0.35 ? smooth(t / 0.35) : t < 0.65 ? 1 : 1 - smooth((t - 0.65) / 0.35);
    sp.setOpen && sp.setOpen(open);
    const m = smooth(Math.max(0, Math.min(1, (t - 0.2) / 0.55)));
    const cam = this.camera;
    cam.position.lerpVectors(A.fromPos, A.toPos, m);
    this.yaw = A.fromYaw + angDiff(A.fromYaw, A.toYaw) * m;
    this.pitch = A.fromPitch * (1 - m);
    cam.rotation.order = 'YXZ'; cam.rotation.set(this.pitch, this.yaw, 0);
    this.hideView = A.dir === 'in' ? t > 0.82 : t < 0.18;
    if (t >= 1) {
      this.hideAnim = null;
      sp.setOpen && sp.setOpen(0);
      LO.audio.click(false);
      if (A.dir === 'in') {
        this.flashOn = false;
        this.hidden = sp;
        this.onHide && this.onHide();
      } else {
        this.pos.set(sp.exit.x, 0, sp.exit.z);
        this.yaw = sp.yaw + Math.PI;
        this.spike = Math.max(this.spike, NOISE.hide);
      }
    }
  };

  Player.prototype.interact = function () {
    if (this.hideAnim) return;
    if (this.hidden) {
      const s = this.hidden;
      this.hidden = null;
      this.startHideAnim(s, 'out');
      return;
    }
    const s = this.nearestHideSpot();
    if (s && s.lockedUntil && s.lockedUntil > performance.now() / 1000) {
      LO.audio.knock && LO.audio.knock();
      this.hint && this.hint('It won\'t let you in.');
      return;
    }
    if (s) {
      this.cameraUp = false;
      this.startHideAnim(s, 'in');
    }
  };

  // ------------------------------------------------------------
  //  PHOTOGRAPHY
  // ------------------------------------------------------------
  const _dir = new V3(), _fwd = new V3();
  Player.prototype.findEvidence = function () {
    const cam = this.camera;
    cam.getWorldDirection(_fwd);
    let best = null, bestScore = -1, tooFar = null;
    this.world.evidence.forEach(ev => {
      if (ev.found) return;
      _dir.copy(ev.pos).sub(cam.position);
      const dist = _dir.length();
      _dir.normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, _dir.dot(_fwd))));
      const maxAng = THREE.MathUtils.degToRad(ev.ground ? 20 : 16);
      if (ang > maxAng) return;
      if (dist > ev.maxDist) { if (dist < ev.maxDist * 2.2) tooFar = ev; return; }
      // line of sight
      this.raycaster.set(cam.position, _dir);
      this.raycaster.far = dist;
      const hits = this.raycaster.intersectObjects(this.world.occluders.concat(this.world.evOccluders), false);
      const margin = ev.margin || (ev.id === 'police' ? 3 : ev.id === 'tower' ? 2 : 1.2);
      if (hits.length && hits[0].distance < dist - margin) return;
      const score = 1 - ang / maxAng;
      if (score > bestScore) { bestScore = score; best = ev; }
    });
    if (best) return { ev: best, ok: true };
    if (tooFar) return { ev: tooFar, ok: false };
    return null;
  };

  Player.prototype.takePhoto = function () {
    if (this.photoCooldown > 0) return;
    this.photoCooldown = 1.2;
    LO.audio.shutter();
    this.burst.intensity = 14;
    this.spike = Math.max(this.spike, NOISE.shutter);
    const res = this.findEvidence();
    const ev = res && res.ok ? res.ev : null;
    const Vp = LO.ver ? LO.ver() : { exposure: true };
    if (Vp.exposure && !this.calm && this.exposure >= EXPO.SHOW) {
      // photographing the Exposure banishes it — but the flash burns you
      this.exposure = 0;
      this.damage(EXPO.BANISH_DMG, 'exposure');
      if (this.health > 0) this.onExposure && this.onExposure('banish');
    } else if (Vp.exposure && !ev && !this.calm) {
      // wasted flashes (using the camera as a light) draw it in faster
      this.exposure += EXPO.WASTED;
    }
    this.onPhoto && this.onPhoto(ev);
  };
})();
