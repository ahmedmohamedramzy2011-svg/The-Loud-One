// ============================================================
//  THE LOUD ONE — the Sneaky One (Phenomenon-241)
//  Two ominous glowing eyes and a far too wide smile. On a random
//  timer (30s - 3min) it creeps up right behind you: your flashlight
//  flickers and you hear breathing. Turn around within ~2.5 seconds
//  or it kills you. The timer pauses while Siren Head is close enough
//  to hear your flashlight (it won't risk him).
// ============================================================
(function () {
  const V3 = THREE.Vector3;
  const MIN_T = 30, MAX_T = 180, WINDOW = 2.5;
  const FACE_COS = Math.cos(THREE.MathUtils.degToRad(55));   // how directly you must face it
  LO.SNEAKY = { WINDOW };
  const nextTime = () => MIN_T + Math.random() * (MAX_T - MIN_T);

  function Sneaky(scene, world) {
    this.scene = scene; this.world = world;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.build();
    this.reset();
  }
  LO.Sneaky = Sneaky;

  Sneaky.prototype.build = function () {
    const R = this.root;
    // nothing but two glowing eyes and a far too wide smile, floating in the dark
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
    this.eyes = [-1, 1].map(s => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glow);
      e.scale.set(1.5, 0.7, 0.5); e.position.set(s * 0.1, 2.03, 0.235); R.add(e);
      return e;
    });
    // the smile: a very wide arc of glowing teeth from cheek to cheek
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 6, 28, Math.PI * 0.95),
      new THREE.MeshBasicMaterial({ color: 0xf2ecd8 }));
    smile.rotation.z = Math.PI + Math.PI * 0.025; smile.position.set(0, 1.93, 0.215); smile.scale.set(1.25, 0.75, 1);
    R.add(smile);
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + Math.PI * 0.08 + i / 13 * Math.PI * 0.84;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 4), new THREE.MeshBasicMaterial({ color: 0xf5f0de }));
      tooth.position.set(Math.cos(a) * 0.19 * 1.25, 1.93 + Math.sin(a) * 0.19 * 0.75 + 0.02, 0.24);
      tooth.rotation.z = Math.PI;
      R.add(tooth);
    }
    // bigger, and the grin stretched extra wide
    R.children.forEach(o => {
      const wide = o.geometry && o.geometry.type !== 'SphereGeometry' ? 1.35 : 1;
      o.position.x *= 1.7 * wide; o.position.y = 1.95 + (o.position.y - 1.95) * 1.7;
      o.scale.multiplyScalar(1.7); o.scale.x *= wide;
    });
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world.glowTex('rgba(255,240,190,0.35)'), depthWrite: false, transparent: true }));
    halo.scale.set(1.8, 1.0, 1); halo.position.set(0, 1.97, 0.3); R.add(halo);
  };

  LO.ambush = LO.ambush || { active: null, gapUntil: 0, now: 0 };
  const _fwd = new V3(), _back = new V3(), _toIt = new V3(), _f2 = new V3();

  Sneaky.prototype.reset = function () {
    this.lastReal = performance.now();
    this.timer = nextTime();
    this.attacking = false;
    this.t = 0;
    this.root.visible = false;
    if (this.breath) { this.breath.stop(); this.breath = null; }
    if (LO.ambush.active === 'sneaky') LO.ambush.active = null;
  };

  Sneaky.prototype.pause = function () {
    if (this.breath) { this.breath.stop(); this.breath = null; }
  };

  // returns 'kill' when it gets you
  // counts in real seconds (the game's own clock slows down on low frame rates)
  Sneaky.prototype.realDt = function (dt) {
    const n = performance.now();
    const raw = (n - (this.lastReal || n)) / 1000;
    this.lastReal = n;
    const step = raw > 0.25 ? Math.min(0.1, dt || 0.016) : Math.min(0.1, raw);
    if (LO.admin) {
      if (LO.admin.open && LO.admin.freezeWhenOpen) return 0;
      if (typeof LO.admin.timeScale === 'number') return step * LO.admin.timeScale;
    }
    return step;
  };

  Sneaky.prototype.forceSpawn = function (player, camera) {
    if (!player || !camera) return false;
    if (player.hidden || player.hideAnim) player.ejectFromHide && player.ejectFromHide();
    if (LO.ambush) { LO.ambush.active = null; LO.ambush.gapUntil = 0; }
    camera.getWorldDirection(_fwd);
    this.attacking = true; this.t = 0;
    LO.ambush.active = 'sneaky';
    _back.set(-_fwd.x, 0, -_fwd.z);
    if (_back.lengthSq() < 1e-4) _back.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    _back.normalize();
    this.root.position.set(player.pos.x + _back.x * 1.5, 0, player.pos.z + _back.z * 1.5);
    this.root.lookAt(player.pos.x, 0, player.pos.z);
    this.root.visible = true;
    player.flickerForce = true;
    this.lightWasOff = !player.flashOn;
    this.window = this.lightWasOff ? WINDOW + 1 : WINDOW;
    if (this.breath) { this.breath.stop(); this.breath = null; }
    this.breath = LO.audio.sneakyBreath(this.root.position);
    this.onAttack && this.onAttack(this.lightWasOff);
    return true;
  };

  Sneaky.prototype.update = function (dt, player, camera, siren) {
    dt = this.realDt(dt);
    if (dt <= 0) return;
    if ((LO.ver && !LO.ver().sneaky) || (LO.admin && LO.admin.noSneaky) || player.calm || !player.alive) {
      if (this.attacking) this.vanish(player, false);
      return;
    }
    camera.getWorldDirection(_fwd);
    if (!this.attacking) {
      // it won't come while Siren Head is close enough to hear the flashlight
      const hearFlash = LO.NOISE.flashlight * 1.3 * (player.indoor ? 0.6 : 1);
      const sirenNear = siren && siren.distToPlayer !== undefined && siren.distToPlayer < hearFlash + 4;
      if (sirenNear || player.hidden || player.hideAnim) return;
      this.timer -= dt;
      if (this.timer > 0) return;
      // mandatory 10-20s minimum gap from The Fast One (and never overlap)
      if (LO.ambush.active || LO.ambush.now < LO.ambush.gapUntil) {
        this.timer = 0;
        return;
      }
      // creep up right behind you
      this.attacking = true; this.t = 0;
      LO.ambush.active = 'sneaky';
      _back.set(-_fwd.x, 0, -_fwd.z);
      if (_back.lengthSq() < 1e-4) _back.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      _back.normalize();
      this.root.position.set(player.pos.x + _back.x * 1.5, 0, player.pos.z + _back.z * 1.5);
      this.root.lookAt(player.pos.x, 0, player.pos.z);
      this.root.visible = true;
      player.flickerForce = true;
      // without the flashlight up you get an extra second to react
      this.lightWasOff = !player.flashOn;
      this.window = this.lightWasOff ? WINDOW + 1 : WINDOW;
      this.breath = LO.audio.sneakyBreath(this.root.position);
      this.onAttack && this.onAttack(this.lightWasOff);
      return;
    }
    if (!this.breath) this.breath = LO.audio.sneakyBreath(this.root.position);
    this.t += dt;
    // keep it pressed close behind you if you back away
    _toIt.set(this.root.position.x - camera.position.x, 0, this.root.position.z - camera.position.z);
    const dist = _toIt.length();
    if (dist > 2.2) {
      _toIt.normalize();
      this.root.position.x = camera.position.x + _toIt.x * 1.8;
      this.root.position.z = camera.position.z + _toIt.z * 1.8;
    }
    this.root.lookAt(player.pos.x, 0, player.pos.z);
    if (this.breath) this.breath.move(this.root.position);
    for (let i = 0; i < this.eyes.length; i++) { this.eyes[i].scale.y = 0.7 * (Math.random() < 0.03 ? 0.1 : 1); }
    // facing it in time makes it vanish
    _f2.set(_fwd.x, 0, _fwd.z);
    if (_f2.lengthSq() > 1e-4 && _toIt.lengthSq() > 1e-4) {
      _f2.normalize();
      _toIt.normalize();
      if (_f2.dot(_toIt) > FACE_COS) { this.vanish(player, true); return; }
    }
    if (this.t >= (this.window || WINDOW)) { this.vanish(player, false); return 'kill'; }
  };

  Sneaky.prototype.vanish = function (player, seen) {
    this.attacking = false;
    this.root.visible = false;
    player.flickerForce = false;
    if (this.breath) { this.breath.stop(); this.breath = null; }
    if (seen) LO.audio.staticBurst(null, 0.35, 0.35);
    if (LO.ambush.active === 'sneaky') {
      LO.ambush.active = null;
      LO.ambush.gapUntil = LO.ambush.now + 10 + Math.random() * 10;
    }
    this.timer = nextTime();
  };
})();
