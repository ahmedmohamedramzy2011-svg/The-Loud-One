// ============================================================
//  THE LOUD ONE — the player: movement, noise, stamina,
//  flashlight, photo camera and hiding
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const RADIUS = 0.35;

  // noise radii in metres: how far away Siren Head can hear each thing
  const NOISE = {
    flashlight: 9, crouch: 4, walk: 16, sprint: 46,
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
    LO.audio && LO.audio.setBreathing && LO.audio.setBreathing(0);
    this.battery = 100;
    this.flashOn = false;
    this.cameraUp = false;
    this.hidden = null;
    this.hideAnim = null;
    this.hideView = false;
    this.hideSpotType = 'locker';
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
    this.envShake = 0;
    this.envProx = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.swayVelX = 0;
    this.swayVelY = 0;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prompt = '';
    this.alive = true;
    this.zoom = 0;
    this.adrenaline = 0;
    this.adrenalineCooldown = 0;
    this.adrenalineArmed = false;
    this.adrenalineSprintTime = 0;
    this.windedTimer = 0;
    this.dizzy = 0;
    this.dizzyT = 0;
    this.trapSlowTimer = 0;
    this.hasMap = false;
    this.mapOpen = false;
  };

  Player.prototype.addNoise = function (radius) {
    if (LO.admin && LO.admin.zeroNoise) return;
    this.spike = Math.max(this.spike || 0, radius || 0);
    this.noiseRadius = Math.max(this.noiseRadius || 0, this.spike);
  };

  Player.prototype.triggerAdrenaline = function (duration) {
    if ((this.adrenalineCooldown || 0) > 0) return false;
    this.adrenaline = duration || 8.5;
    this.adrenalineCooldown = 75;
    this.adrenalineArmed = true;
    this.adrenalineSprintTime = 0;
    this.windedTimer = 0;
    this.stamina = 100;
    this.exhausted = false;
    return true;
  };

  Player.prototype.startWinded = function () {
    if (!this.adrenalineArmed) return;
    this.adrenalineArmed = false;
    this.adrenalineSprintTime = 0;
    this.adrenaline = 0;
    this.windedTimer = 5.0; // 3s paused stamina regen (>2.0), then 2s at 50% speed
    this.exhausted = true;
    this.panting = 1;
  };

  Player.prototype.bindInput = function () {
    const self = this;
    window.addEventListener('keydown', e => {
      self.keys[e.code] = true;
      if (!self.enabled) return;
      if (e.code === 'KeyF') self.toggleFlash();
      if (e.code === 'KeyE') self.interact();
      if (e.code === 'KeyQ' && !self.mapOpen) self.cameraUp = !self.cameraUp;
      if (e.code === 'KeyG') self.throwRock();
      if (e.code === 'KeyM' || e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat && (!LO.ver || LO.ver().townMap)) self.toggleMap();
      }
      if (e.code === 'Space') e.preventDefault();
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
      if (e.button === 2 && !self.mapOpen) self.cameraUp = true;
      if (e.button === 0) {
        if (self.mapOpen) { self.toggleMap(false); return; }
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
    const infBat = LO.admin && LO.admin.infBattery;
    if (!infBat && this.battery < cost) {
      LO.audio.click(false);
      this.hint && this.hint(`Not enough battery (needs ${cost}%).`);
      return;
    }
    if (!infBat) this.battery -= cost;
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
    this.adrenalineCooldown = Math.max(0, (this.adrenalineCooldown || 0) - dt);
    this.windedTimer = Math.max(0, (this.windedTimer || 0) - dt);
    this.trapSlowTimer = Math.max(0, (this.trapSlowTimer || 0) - dt);
    const windedMult = this.windedTimer > 2.0 ? 0 : (this.windedTimer > 0 ? 0.5 : 1);
    if (this.dizzy > 0) {
      this.dizzy = Math.max(0, this.dizzy - dt * 0.22);
      this.dizzyT = (this.dizzyT || 0) + dt;
    }
    this.spike *= Math.exp(-dt * 3.2);
    if (this.spike < 0.5) this.spike = 0;

    let moving = false, sprinting = false;
    const indoor = W.isIndoor(this.pos);
    this.indoor = indoor;
    const inForest = !!(W.isForest && W.isForest(this.pos) && !indoor && this.pos.y < 0.8);
    this.inForest = inForest;

    // mid-way into or out of a hiding spot: no control until the door shuts
    if (this.hideAnim) {
      this.vel.set(0, 0, 0);
      this.updateHideAnim(dt);
      this.noiseRadius = this.spike + (this.flashOn ? NOISE.flashlight : 0);
      // the light stays on until you're fully inside (it goes off as the door shuts)
      this.flash.intensity = this.flashOn ? (LO.settings.lighting === 'simple' ? 3 : 8) * Math.min(1, 0.4 + this.battery / 40) : 0;
      LO.audio.setFlashlightBuzz(this.flashOn);
      if (this.windedTimer > 0) {
        this.panting = Math.max(this.panting, this.windedTimer > 2.0 ? 1.0 : 0.7);
      }
      const VpH = LO.ver ? LO.ver() : { panting: true };
      LO.audio.setBreathing && LO.audio.setBreathing((VpH.panting && this.enabled && this.alive && !this.calm) ? this.panting : 0);
      this.zoom = 0;
      return;
    }
    this.hideView = !!this.hidden;

    if (this.hidden) {
      if (this.adrenalineArmed) this.startWinded();
      // locked in place, can only look around a bit
      const sp = this.hidden;
      this.pos.set(sp.pos.x, sp.baseY || 0, sp.pos.z);
      this.vel.set(0, 0, 0);
      let d = this.yaw - (sp.yaw + Math.PI);
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      d = Math.max(-0.9, Math.min(0.9, d));
      this.yaw = sp.yaw + Math.PI + d;
      this.pitch = Math.max(-0.5, Math.min(0.4, this.pitch));
      this.flashOn = false;
      this.cameraUp = false;
      if (LO.admin && LO.admin.infStamina) {
        this.stamina = 100;
        this.exhausted = false;
        this.windedTimer = 0;
        this.panting = 0;
      } else {
        this.stamina = Math.min(100, this.stamina + 18 * windedMult * dt);
        if (this.windedTimer > 0) {
          this.exhausted = true;
          this.panting = Math.max(this.panting, this.windedTimer > 2.0 ? 1.0 : 0.7);
        } else {
          if (this.exhausted && this.stamina > 35) this.exhausted = false;
          this.panting = Math.max(0, this.panting - dt * 0.5);
        }
      }
      // THE TENANT: something already lives in every hiding spot (v1.4+).
      // Stay too long and it throws you out.
      const Vh = LO.ver ? LO.ver() : { tenant: true };
      const adm = LO.admin || {};
      if (!Vh.tenant || adm.noTenant) {
        this.hideTime = 0;
        this.tenantTick = 0;
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
      if (this.windedTimer > 0) this.exhausted = true;
      else if (this.exhausted && this.stamina > 35) this.exhausted = false;
      sprinting = wantSprint && !this.exhausted && this.stamina > 0;
      if (this.adrenalineArmed) {
        if (sprinting && this.adrenaline > 0) this.adrenalineSprintTime += dt;
        if (this.adrenaline <= 0 || (this.adrenalineSprintTime > 0.25 && !sprinting)) {
          this.startWinded();
          sprinting = false;
        }
      }
      const adm = LO.admin || {};
      const speedMult = adm.speedMult || 1;
      const sprintSpeed = this.adrenaline > 0 ? 13.8 : 6.9;
      let speed = (wantCrouch ? 1.6 : sprinting ? sprintSpeed : 3.3) * (sprinting ? 1 : Math.max(0.5, analog)) * speedMult;
      if (this.cameraUp) speed *= 0.6;
      if (this.trapSlowTimer > 0) speed *= 0.28;
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      let mx = -sinY * fwd + cosY * str, mz = -cosY * fwd - sinY * str;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;

      if (adm.noclip) {
        const flySpeed = Math.max(8, speed * 2.2);
        const up = (k.Space ? 1 : 0) - (wantCrouch ? 1 : 0);
        this.vel.set(mx * flySpeed * (moving ? 1 : 0), up * flySpeed * 0.75, mz * flySpeed * (moving ? 1 : 0));
        this.pos.addScaledVector(this.vel, dt);
        if (this.pos.y < 0.1) this.pos.y = 0.1;
        this.onGround = this.pos.y <= 0.11;
      } else {
        const accel = this.onGround ? 12 : 3;
        this.vel.x += (mx * speed * (moving ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
        this.vel.z += (mz * speed * (moving ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);

        // jump
        if (k.Space && this.onGround && (adm.infStamina || this.stamina > 12) && !wantCrouch) {
          this.vel.y = 4.6; this.onGround = false;
          if (!adm.infStamina) this.stamina -= 12;
          this.spike = Math.max(this.spike, NOISE.jump);
          LO.audio.jumpGrunt();
          k.Space = false;
        }
        const prevY = this.pos.y, wasOnGround = this.onGround;
        this.vel.y -= 13 * dt;
        this.pos.addScaledVector(this.vel, dt);
        const floorY = W.floorHeightAt ? W.floorHeightAt(this.pos.x, this.pos.z, prevY) : 0;
        const stepDown = wasOnGround && this.vel.y <= 0.01 && (this.pos.y - floorY) <= 0.45 && this.pos.y >= floorY;
        if (this.pos.y <= floorY || stepDown) {
          if (!wasOnGround && this.pos.y <= floorY) {
            const hard = this.vel.y < -4;
            LO.audio.land(hard);
            this.spike = Math.max(this.spike, NOISE.land * (hard ? 1 : 0.6));
            this.shake = Math.max(this.shake, 0.15);
          }
          this.pos.y = floorY; this.vel.y = 0; this.onGround = true;
        } else {
          this.onGround = false;
        }
        this.collide();
      }

      // stamina
      if (adm.infStamina) {
        this.stamina = 100;
        this.exhausted = false;
        this.windedTimer = 0;
        this.panting = 0;
      } else if (sprinting) {
        const Vst = LO.ver ? LO.ver() : { staminaBuff: true };
        const baseDrain = Vst.staminaBuff ? 10.5 : 21;
        this.stamina -= (this.adrenaline > 0 ? 4.5 : baseDrain) * dt;
        if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; this.panting = 1; }
      } else {
        this.stamina = Math.min(100, this.stamina + (moving ? 9 : 15) * windedMult * dt);
      }
      if (!adm.infStamina) {
        if (this.windedTimer > 0) this.panting = Math.max(this.panting, this.windedTimer > 2.0 ? 1.0 : 0.7);
        if (sprinting && this.stamina < 40) this.panting = Math.max(this.panting, 0.6);
        if (!sprinting && this.windedTimer <= 0) this.panting = Math.max(0, this.panting - dt * (this.crouch > 0.5 ? 0.25 : 0.12));
      }
      const VpB = LO.ver ? LO.ver() : { panting: true };
      LO.audio.setBreathing && LO.audio.setBreathing((VpB.panting && this.enabled && this.alive && !this.calm) ? this.panting : 0);

      // footsteps
      const hspeed = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hspeed > 0.5) {
        this.stepPhase += dt * hspeed * (sprinting ? 0.42 : 0.55);
        if (Math.floor(this.stepPhase) !== this.lastStep) {
          this.lastStep = Math.floor(this.stepPhase);
          LO.audio.footstep(sprinting ? 'run' : this.crouch > 0.5 ? 'crouch' : 'walk', indoor, inForest);
        }
      }
      this.bob = this.onGround ? Math.sin(this.stepPhase * Math.PI) * Math.min(1, hspeed / 4) : 0;
      this.moving = hspeed > 0.5;
      this.sprinting = sprinting && hspeed > 3;
    }

    // ---------- battery ----------
    const admB = LO.admin || {};
    if (admB.infBattery) {
      this.battery = 100;
    } else if (this.flashOn) {
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
    const Vn = LO.ver ? LO.ver() : { forestRing: true };
    let n = 0;
    if (this.flashOn) n += NOISE.flashlight;
    if (this.moving && !this.hidden) {
      n += this.sprinting ? NOISE.sprint : this.crouch > 0.5 ? NOISE.crouch : NOISE.walk;
      if (Vn.forestRing && inForest) n += this.sprinting ? 8 : this.crouch > 0.5 ? 2.5 : 5;
    }
    n += this.spike;
    if (indoor) n *= 0.6;
    if (this.hidden) n = this.spike > 0 ? this.spike * 0.5 : 0;
    if (admB.zeroNoise) n = 0;
    this.noiseRadius = n;

    // ---------- THE SILENT ONE ----------
    // any sound at all resets it; total silence (including hiding) feeds it
    const Vs = LO.ver ? LO.ver() : { silent: true, silentDamage: SILENT_DAMAGE, rocks: true, exposure: true };
    if (!Vs.silent || n > 0 || this.noSilent || admB.noSilent || this.calm) { this.silentTime = 0; this.silentTick = 0; }
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

    // ---------- pickups ----------
    const pickups = W.pickups;
    for (let pi = 0; pi < pickups.length; pi++) {
      const p = pickups[pi];
      if (p.taken) continue;
      if (p.type === 'rock' && !Vs.rocks) continue;
      const pdx = p.pos.x - this.pos.x, pdz = p.pos.z - this.pos.z;
      if (pdx * pdx + pdz * pdz < 1.96 &&
          Math.abs((p.baseY !== undefined ? p.baseY : (p.pos.y || 0)) - (this.pos.y + 0.5)) < 1.9) {
        if (p.type === 'rock') {
          if (this.hidden) continue;
          if (this.rocks >= MAX_ROCKS) {
            if (!p.fullWarned) { p.fullWarned = true; this.hint && this.hint(`You can only carry ${MAX_ROCKS} rocks.`); }
            continue;
          }
          p.taken = true; p.mesh.visible = false;
          this.rocks++;
          LO.audio.click(false);
          this.hint && this.hint(`Rock picked up (${this.rocks}/${MAX_ROCKS}). ${LO.isTouch ? 'Tap THROW' : 'Press G'} to throw and distract it.`);
          continue;
        }
        p.taken = true; p.mesh.visible = false;
        this.battery = Math.min(100, this.battery + 45);
        LO.audio.pickup();
        this.hint && this.hint('Battery found (+45%)');
      }
    }

    // ---------- thrown rocks ----------
    this.updateRocks(dt);

    // ---------- interaction prompt ----------
    this.prompt = '';
    if (this.hidden) this.prompt = '<kbd>E</kbd>Leave hiding spot';
    else if (!this.mapOpen) {
      const wm = this.nearestWallMap();
      const sp = this.nearestHideSpot();
      if (wm) this.prompt = '<kbd>E</kbd>Take Town Map';
      else if (sp) this.prompt = sp.lockedUntil > performance.now() / 1000 ? 'Something is moving inside...' : `<kbd>E</kbd>Hide in ${sp.type}`;
    }

    // ---------- camera zoom & viewfinder ----------
    this.zoom += ((this.cameraUp ? 1 : 0) - this.zoom) * Math.min(1, dt * 8);

    // ---------- THE EXPOSURE ----------
    // it lives in the lens: the longer the camera is up, the closer it gets
    if (!Vs.exposure || admB.noExposure || this.calm) this.exposure = 0;
    else if (this.zoom > 0.5) this.exposure += dt;
    else this.exposure = Math.max(0, this.exposure - dt * EXPO.DECAY);
    if (Vs.exposure && !admB.noExposure && this.exposure >= EXPO.LUNGE) {
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
      this.pos.set(s.exit.x, s.baseY || 0, s.exit.z);
    } else {
      this.pos.y = 0;
    }
    this.onGround = true;
  };

  Player.prototype.applyCamera = function (dt, time) {
    const cam = this.camera;
    const eye = this.hidden ? (this.hidden.pos.y - (this.hidden.baseY || 0)) : (1.62 - this.crouch * 0.67);
    const bobAmt = LO.settings.headBob ? 1 : 0;
    this.shake = Math.max(0, this.shake - dt * 0.8);
    const sh = this.shake;
    const dz = Math.min(1, this.dizzy || 0);
    const dtz = this.dizzyT || 0;
    const Ve = LO.ver ? LO.ver() : { envShake: true };
    let envProx = 0;
    if (Ve.envShake && !this.hidden && this.world && this.world.noisyObjects) {
      const py = this.pos.y + 0.9;
      const list = this.world.noisyObjects;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (Math.abs(py - o.y) >= 3.2) continue;
        const d = Math.hypot(this.pos.x - o.x, this.pos.z - o.z);
        if (d < o.radius) {
          const p = Math.pow(1 - d / o.radius, 1.35) * (o.strength || 1);
          if (p > envProx) envProx = p;
        }
      }
      if (envProx > 1) envProx = 1;
    }
    this.envProx = envProx;
    const targetEnvShake = (Ve.envShake && !this.hidden && this.moving)
      ? envProx * (this.sprinting ? 1.0 : this.crouch > 0.5 ? 0.25 : 0.65)
      : 0;
    this.envShake = (this.envShake || 0) + (targetEnvShake - (this.envShake || 0)) * Math.min(1, (dt || 0.016) * 8);
    const esh = this.envShake;
    const tt = time || 0;
    const ex = esh > 0.002 ? esh * (Math.sin(tt * 31.3) * 0.011 + Math.sin(tt * 47.7) * 0.006) : 0;
    const ey = esh > 0.002 ? esh * (Math.cos(tt * 37.9) * 0.013 + Math.sin(tt * 53.1) * 0.005) : 0;
    const ez = esh > 0.002 ? esh * (Math.sin(tt * 29.1) * 0.011 + Math.cos(tt * 43.3) * 0.006) : 0;
    const eroll = esh > 0.002 ? esh * (Math.sin(tt * 34.7) * 0.0038 + Math.cos(tt * 51.9) * 0.0018) : 0;
    cam.position.set(
      this.pos.x + (Math.random() - 0.5) * sh + ex,
      this.pos.y + eye + this.bob * 0.05 * bobAmt + (Math.random() - 0.5) * sh + ey,
      this.pos.z + (Math.random() - 0.5) * sh + ez,
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + dz * Math.cos(dtz * 2.1) * 0.055;
    cam.rotation.x = this.pitch + dz * Math.sin(dtz * 3.1) * 0.045;
    cam.rotation.z = Math.sin(this.stepPhase * Math.PI * 0.5) * 0.006 * bobAmt * (this.moving ? 1 : 0)
      + dz * (Math.sin(dtz * 2.5) * 0.14 + Math.sin(dtz * 5.2) * 0.045) + eroll;
    const fov = LO.settings.fov * (1 - this.zoom * 0.35) + dz * Math.sin(dtz * 3.7) * 5.5;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // dynamic handheld flashlight sway (gait figure-8 + turn inertia + idle breathing)
    const Vf = LO.ver ? LO.ver() : { flashSway: true };
    if (Vf.flashSway && !this.hidden) {
      let dYaw = this.yaw - (this.prevYaw || 0);
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      let dPitch = this.pitch - (this.prevPitch || 0);
      this.prevYaw = this.yaw;
      this.prevPitch = this.pitch;
      if (Math.abs(dYaw) > 0.6) dYaw = 0;
      if (Math.abs(dPitch) > 0.6) dPitch = 0;

      const t = time || 0;
      const hspeed = Math.hypot(this.vel.x, this.vel.z);
      const moveFactor = this.onGround ? Math.min(1.35, hspeed / 5.2) : 0.25;
      const crouchMul = 1 - this.crouch * 0.4;
      const pace = this.stepPhase * Math.PI;
      const walkX = Math.cos(pace) * 0.44 * moveFactor * crouchMul;
      const walkY = (Math.abs(Math.sin(pace)) * -0.26 + (this.sprinting ? 0.10 : 0)) * moveFactor * crouchMul;
      const breathAmp = 1 + (this.panting || 0) * 1.6 + (this.windedTimer > 0 ? 0.9 : 0);
      const idleX = Math.sin(t * 1.45) * 0.11 * breathAmp;
      const idleY = Math.cos(t * 1.05) * 0.08 * breathAmp;
      const airY = this.onGround ? 0 : Math.max(-0.4, Math.min(0.4, -this.vel.y * 0.06));
      const camDropY = -this.zoom * 0.22;
      const targetX = walkX + idleX + dz * Math.sin(dtz * 3.1) * 0.35;
      const targetY = walkY + idleY + airY + camDropY + dz * Math.cos(dtz * 2.4) * 0.25;

      // rotational lag when sweeping your view left/right/up/down
      this.swayVelX += dYaw * 9.5;
      this.swayVelY += -dPitch * 7.5;

      const stepDt = Math.min(0.05, dt || 0.016);
      const spring = 38, damp = 9.5;
      this.swayVelX += ((targetX - this.swayX) * spring - this.swayVelX * damp) * stepDt;
      this.swayVelY += ((targetY - this.swayY) * spring - this.swayVelY * damp) * stepDt;
      this.swayX = Math.max(-1.55, Math.min(1.55, this.swayX + this.swayVelX * stepDt));
      this.swayY = Math.max(-1.15, Math.min(1.15, this.swayY + this.swayVelY * stepDt));

      this.flash.position.set(0.28 + this.swayX * 0.038, -0.22 + this.swayY * 0.03, 0);
      this.flashTarget.position.set(0.08 + this.swayX * 0.85, -0.10 + this.swayY * 0.72, -10);
    } else {
      this.prevYaw = this.yaw;
      this.prevPitch = this.pitch;
      this.swayX = 0; this.swayY = 0; this.swayVelX = 0; this.swayVelY = 0;
      this.flash.position.set(0.28, -0.22, 0);
      this.flashTarget.position.set(0.1, -0.1, -10);
    }
  };

  function collideList(p, list) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
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
        const dL = Math.abs(c.minX - RADIUS - p.x), dR = Math.abs(c.maxX + RADIUS - p.x);
        const dB = Math.abs(c.minZ - RADIUS - p.z), dF = Math.abs(c.maxZ + RADIUS - p.z);
        const m = Math.min(dL, dR, dB, dF);
        if (m === dL) p.x = c.minX - RADIUS;
        else if (m === dR) p.x = c.maxX + RADIUS;
        else if (m === dB) p.z = c.minZ - RADIUS;
        else p.z = c.maxZ + RADIUS;
      }
    }
  }

  Player.prototype.collide = function () {
    const p = this.pos;
    const list = this.world.queryColliders ? this.world.queryColliders(p.x, p.z, 1.0) : this.world.colliders;
    collideList(p, list);
    if (this.world.evColliders.length) collideList(p, this.world.evColliders);
  };

  Player.prototype.kickOut = function () {
    const s = this.hidden;
    if (!s) return;
    this.hidden = null;
    s.lockedUntil = performance.now() / 1000 + 45;   // it keeps that spot for a while
    this.pos.set(s.exit.x, s.baseY || 0, s.exit.z);
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
  function hitCollider(list, py, nx, nz) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.disabled && py < c.maxY && py > (c.minY || 0) && nx > c.minX && nx < c.maxX && nz > c.minZ && nz < c.maxZ) return true;
    }
    return false;
  }
  Player.prototype.updateRocks = function (dt) {
    const W = this.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const r = this.projectiles[i], p = r.mesh.position;
      r.vel.y -= 13 * dt;
      const nx = p.x + r.vel.x * dt, nz = p.z + r.vel.z * dt;
      // hit a wall: drop straight down
      const cols = W.queryColliders ? W.queryColliders(nx, nz, 0.5) : W.colliders;
      const hit = hitCollider(cols, p.y, nx, nz) || (W.evColliders.length && hitCollider(W.evColliders, p.y, nx, nz));
      if (hit) { r.vel.x *= -0.15; r.vel.z *= -0.15; } else { p.x = nx; p.z = nz; }
      p.y += r.vel.y * dt;
      r.mesh.rotation.x += r.spin.x * dt; r.mesh.rotation.y += r.spin.y * dt;
      const rockFloor = (W.floorHeightAt ? W.floorHeightAt(p.x, p.z, p.y) : 0) + 0.12;
      if (p.y <= rockFloor) {
        p.y = rockFloor;
        this.projectiles.splice(i, 1);
        LO.audio.rockClack(p);
        this.onRockLand && this.onRockLand(p.clone());
        // the rock stays where it lands and can be picked up again
        W.pickups.push({ type: 'rock', mesh: r.mesh, pos: r.mesh.position, baseY: rockFloor, taken: false });
      }
    }
  };

  Player.prototype.damage = function (amount, cause) {
    if (this.health <= 0) return;
    if (LO.admin && LO.admin.god) return;
    const hasHealth = !LO.ver || LO.ver().health;
    this.health = hasHealth ? Math.max(0, this.health - amount) : 0;
    this.shake = Math.max(this.shake, 0.3);
    this.onDamage && this.onDamage(amount, cause);
    if (this.health <= 0) this.onDeath && this.onDeath(cause);
  };

  const _fwdTmp = new V3();
  Player.prototype.nearestHideSpot = function () {
    let best = null, bd = 1.7;
    _fwdTmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const list = this.world.hideSpots;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.disabled) continue;
      if (Math.abs((s.baseY || 0) - this.pos.y) > 1.5) continue;
      const dx = s.interact.x - this.pos.x, dz = s.interact.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bd) continue;
      const tx = s.pos.x - this.pos.x, tz = s.pos.z - this.pos.z;
      const facing = (tx * _fwdTmp.x + tz * _fwdTmp.z) / (Math.hypot(tx, tz) || 1);
      if (facing > 0.3) { bd = d; best = s; }
    }
    return best;
  };

  Player.prototype.nearestWallMap = function () {
    if (LO.ver && !LO.ver().townMap) return null;
    const wm = this.world && this.world.wallMap;
    if (!wm || wm.disabled || wm.taken || this.hidden) return null;
    if (Math.abs((wm.baseY !== undefined ? wm.baseY : 0.14) - this.pos.y) > 1.7) return null;
    const dx = wm.pos.x - this.pos.x, dz = wm.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.1) return null;
    _fwdTmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const facing = (dx * _fwdTmp.x + dz * _fwdTmp.z) / (d || 1);
    return facing > 0.35 ? wm : null;
  };

  Player.prototype.toggleMap = function (force) {
    if (LO.ver && !LO.ver().townMap) return;
    if (!this.hasMap) {
      if (force !== false) this.hint && this.hint('Find the town map on a building wall first.');
      return;
    }
    const next = force !== undefined ? !!force : !this.mapOpen;
    if (next === this.mapOpen) return;
    this.mapOpen = next;
    if (this.mapOpen) this.cameraUp = false;
    LO.audio.click(this.mapOpen);
  };

  // ---------- climbing in and out: the door/lid swings open, you move, it closes ----------
  const HIDE_ANIM = 1.0;
  const smooth = t => t * t * (3 - 2 * t);
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  Player.prototype.startHideAnim = function (spot, dir) {
    if (dir === 'in' && this.adrenalineArmed) this.startWinded();
    this.hideSpotType = spot.type || 'locker';
    const baseY = spot.baseY || 0;
    this.hideAnim = {
      spot, dir, t: 0,
      fromPos: dir === 'in' ? new V3(this.pos.x, this.pos.y + 1.62, this.pos.z) : spot.pos.clone(),
      toPos: dir === 'in' ? spot.pos.clone() : new V3(spot.exit.x, baseY + 1.62, spot.exit.z),
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
        this.pos.set(sp.exit.x, sp.baseY || 0, sp.exit.z);
        this.yaw = sp.yaw + Math.PI;
        this.spike = Math.max(this.spike, NOISE.hide);
      }
    }
  };

  Player.prototype.interact = function () {
    if (this.hideAnim) return;
    if (this.mapOpen) {
      this.mapOpen = false;
      LO.audio.click(false);
      return;
    }
    if (this.hidden) {
      const s = this.hidden;
      this.hidden = null;
      this.startHideAnim(s, 'out');
      return;
    }
    const wm = this.nearestWallMap();
    if (wm) {
      wm.taken = true;
      if (wm.mesh) wm.mesh.visible = false;
      if (wm.building) wm.building.hasMap = false;
      this.hasMap = true;
      this.cameraUp = false;
      this.mapOpen = true;
      LO.audio.pickup();
      this.hint && this.hint(`Town Map collected! Press ${LO.isTouch ? 'MAP' : 'M or Tab'} anytime to view.`, 5500);
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
    const evList = this.world.evidence;
    for (let i = 0; i < evList.length; i++) {
      const ev = evList[i];
      if (ev.found) continue;
      _dir.copy(ev.pos).sub(cam.position);
      const dist = _dir.length();
      _dir.divideScalar(dist || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, _dir.dot(_fwd))));
      const maxAng = THREE.MathUtils.degToRad(ev.ground ? 20 : 16);
      if (ang > maxAng) continue;
      if (dist > ev.maxDist) { if (dist < ev.maxDist * 2.2) tooFar = ev; continue; }
      if (this.world.segmentHitsTree && this.world.segmentHitsTree(cam.position.x, cam.position.z, ev.pos.x, ev.pos.z)) continue;
      // line of sight via spatial occluder grid
      this.raycaster.set(cam.position, _dir);
      this.raycaster.far = dist;
      const margin = ev.margin || (ev.id === 'police' ? 3 : ev.id === 'tower' ? 2 : 1.2);
      const occl = this.world.queryOccluders
        ? this.world.queryOccluders(cam.position.x, cam.position.z, ev.pos.x, ev.pos.z)
        : this.world.occluders;
      const hits = this.raycaster.intersectObjects(occl, false);
      if (hits.length && hits[0].distance < dist - margin) continue;
      if (this.world.evOccluders.length) {
        const hits2 = this.raycaster.intersectObjects(this.world.evOccluders, false);
        if (hits2.length && hits2[0].distance < dist - margin) continue;
      }
      const score = 1 - ang / maxAng;
      if (score > bestScore) { bestScore = score; best = ev; }
    }
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
