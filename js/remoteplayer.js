// ============================================================
//  THE LOUD ONE — Procedural 3D Investigator Model for Co-op
// ============================================================
window.LO = window.LO || {};

(function () {
  const V3 = THREE.Vector3;

  function makeTagSprite(name, accentHex) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(8, 8, 10, 0.72)';
    g.fillRect(18, 14, 220, 36);
    g.strokeStyle = accentHex || '#4a78a8';
    g.lineWidth = 3;
    g.strokeRect(18, 14, 220, 36);
    g.fillStyle = accentHex || '#4a78a8';
    g.fillRect(24, 20, 8, 24);
    g.fillStyle = '#e8e2d4';
    g.font = 'bold 21px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(name || 'INVESTIGATOR').slice(0, 14), 134, 33);

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.35, 0.34, 1);
    return { sprite: sp, tex, mat };
  }

  function RemotePlayer(scene, world, info) {
    this.scene = scene;
    this.world = world;
    this.id = info.id;
    this.slot = info.slot || 0;
    this.name = info.name || `Investigator ${this.slot + 1}`;
    this.color = info.color || '#4a78a8';
    this.jacketHex = info.jacketHex !== undefined ? info.jacketHex : 0x365270;

    this._geos = [];
    this._mats = [];
    this._texs = [];

    this.root = new THREE.Group();
    scene.add(this.root);

    this.pos = new V3(0, 0, -104);
    this.targetPos = new V3(0, 0, -104);
    this.yaw = Math.PI;
    this.targetYaw = Math.PI;
    this.pitch = 0;
    this.targetPitch = 0;
    this.crouch = 0;
    this.targetCrouch = 0;
    this.flashOn = false;
    this.cameraUp = false;
    this.hidden = false;
    this.hideSpotIdx = -1;
    this.alive = true;
    this.moving = false;
    this.sprinting = false;
    this.noiseRadius = 0;
    this.health = 100;
    this.walkPhase = 0;
    this.lastStepSign = 1;
    this.burstPower = 0;
    this.firstPersonHidden = false;

    this.buildModel();
  }
  LO.RemotePlayer = RemotePlayer;

  RemotePlayer.prototype._trackGeo = function (g) { this._geos.push(g); return g; };
  RemotePlayer.prototype._trackMat = function (m) { this._mats.push(m); return m; };

  RemotePlayer.prototype.buildModel = function () {
    const simple = LO.settings && LO.settings.lighting === 'simple';
    const M = o => this._trackMat(
      simple ? new THREE.MeshLambertMaterial(o)
             : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.82, metalness: 0.05 }, o))
    );

    const jacketMat = M({ color: this.jacketHex });
    const trimMat = M({ color: 0x1b1d21 });
    const pantsMat = M({ color: 0x202328 });
    const skinMat = M({ color: 0xc2ab93 });
    const packMat = M({ color: 0x2a2722 });
    const metalMat = M({ color: 0x484d54, metalness: 0.55, roughness: 0.45 });
    const tagMat = this._trackMat(new THREE.MeshBasicMaterial({ color: this.color }));
    const headlampLensMat = this._trackMat(new THREE.MeshBasicMaterial({ color: 0x333333 }));
    this.headlampLensMat = headlampLensMat;

    // Hip pivot (controls crouch drop)
    const hip = this.hip = new THREE.Group();
    hip.position.set(0, 0.88, 0);
    this.root.add(hip);

    // Pelvis
    const pelvisG = this._trackGeo(new THREE.BoxGeometry(0.42, 0.16, 0.24));
    const pelvis = new THREE.Mesh(pelvisG, pantsMat);
    pelvis.position.y = 0.02;
    hip.add(pelvis);

    // Articulated legs
    const thighG = this._trackGeo(new THREE.BoxGeometry(0.16, 0.42, 0.17));
    const shinG = this._trackGeo(new THREE.BoxGeometry(0.13, 0.40, 0.14));
    const bootG = this._trackGeo(new THREE.BoxGeometry(0.14, 0.10, 0.23));
    this.legs = [-1, 1].map(side => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.125, -0.02, 0);
      hip.add(thigh);
      const tMesh = new THREE.Mesh(thighG, pantsMat);
      tMesh.position.y = -0.20;
      thigh.add(tMesh);

      const knee = new THREE.Group();
      knee.position.y = -0.41;
      thigh.add(knee);
      const sMesh = new THREE.Mesh(shinG, pantsMat);
      sMesh.position.y = -0.19;
      knee.add(sMesh);

      const bMesh = new THREE.Mesh(bootG, trimMat);
      bMesh.position.set(0, -0.40, -0.04);
      knee.add(bMesh);
      return { thigh, knee, side };
    });

    // Upper torso + jacket + backpack + slot color tag
    const torso = this.torso = new THREE.Group();
    torso.position.y = 0.10;
    hip.add(torso);

    const chestG = this._trackGeo(new THREE.BoxGeometry(0.46, 0.56, 0.26));
    const chest = new THREE.Mesh(chestG, jacketMat);
    chest.position.y = 0.28;
    torso.add(chest);

    const collarG = this._trackGeo(new THREE.BoxGeometry(0.32, 0.08, 0.22));
    const collar = new THREE.Mesh(collarG, trimMat);
    collar.position.set(0, 0.57, 0);
    torso.add(collar);

    // Subtle colored shoulder/collar tag so teammates stand out gently in dim light
    const badgeG = this._trackGeo(new THREE.BoxGeometry(0.48, 0.06, 0.27));
    const badge = new THREE.Mesh(badgeG, tagMat);
    badge.position.set(0, 0.47, 0);
    torso.add(badge);

    // Backpack (note: forward is -Z in player space when yaw=0)
    const packG = this._trackGeo(new THREE.BoxGeometry(0.34, 0.40, 0.15));
    const pack = new THREE.Mesh(packG, packMat);
    pack.position.set(0, 0.30, 0.18);
    torso.add(pack);

    // Head + beanie + headlamp + camera-strap detail
    const headPivot = this.headPivot = new THREE.Group();
    headPivot.position.set(0, 0.62, 0);
    torso.add(headPivot);

    const headG = this._trackGeo(new THREE.BoxGeometry(0.25, 0.27, 0.25));
    const headMesh = new THREE.Mesh(headG, skinMat);
    headMesh.position.y = 0.14;
    headPivot.add(headMesh);

    const capG = this._trackGeo(new THREE.BoxGeometry(0.265, 0.11, 0.265));
    const cap = new THREE.Mesh(capG, trimMat);
    cap.position.y = 0.24;
    headPivot.add(cap);

    const strapG = this._trackGeo(new THREE.BoxGeometry(0.27, 0.04, 0.27));
    const strap = new THREE.Mesh(strapG, packMat);
    strap.position.y = 0.21;
    headPivot.add(strap);

    const lampHousingG = this._trackGeo(new THREE.BoxGeometry(0.08, 0.055, 0.05));
    const lampHousing = new THREE.Mesh(lampHousingG, metalMat);
    lampHousing.position.set(0, 0.21, -0.14);
    headPivot.add(lampHousing);

    const lensG = this._trackGeo(new THREE.CircleGeometry(0.022, 8));
    const lens = new THREE.Mesh(lensG, headlampLensMat);
    lens.position.set(0, 0.21, -0.168);
    lens.rotation.y = Math.PI;
    headPivot.add(lens);

    // Articulated arms (left relaxed, right holds flashlight or camera)
    const armG = this._trackGeo(new THREE.BoxGeometry(0.12, 0.48, 0.12));
    const armL = this.armL = new THREE.Group();
    armL.position.set(-0.30, 0.50, 0);
    torso.add(armL);
    const armLMesh = new THREE.Mesh(armG, jacketMat);
    armLMesh.position.y = -0.21;
    armL.add(armLMesh);

    const armR = this.armR = new THREE.Group();
    armR.position.set(0.30, 0.50, 0);
    torso.add(armR);
    const armRMesh = new THREE.Mesh(armG, jacketMat);
    armRMesh.position.y = -0.21;
    armR.add(armRMesh);

    // Handheld flashlight prop on right hand
    const torchGroup = this.torchGroup = new THREE.Group();
    torchGroup.position.set(0, -0.44, -0.10);
    armR.add(torchGroup);
    const torchBodyG = this._trackGeo(new THREE.CylinderGeometry(0.032, 0.026, 0.22, 8));
    torchBodyG.rotateX(Math.PI / 2);
    torchGroup.add(new THREE.Mesh(torchBodyG, metalMat));

    // Handheld camera prop on right hand (visible when cameraUp)
    const camGroup = this.camGroup = new THREE.Group();
    camGroup.position.set(-0.18, -0.36, -0.14);
    camGroup.visible = false;
    armR.add(camGroup);
    const camBodyG = this._trackGeo(new THREE.BoxGeometry(0.18, 0.12, 0.09));
    camGroup.add(new THREE.Mesh(camBodyG, trimMat));
    const camLensG = this._trackGeo(new THREE.CylinderGeometry(0.038, 0.042, 0.06, 10));
    camLensG.rotateX(Math.PI / 2);
    const camLens = new THREE.Mesh(camLensG, metalMat);
    camLens.position.set(0, 0, -0.06);
    camGroup.add(camLens);

    // Teammate 3D SpotLight + Volumetric Flashlight Cone (attached to headPivot so pitch/yaw follow look)
    const spot = this.spot = new THREE.SpotLight(0xfff1d6, 0, 38, 0.48, 0.5, 1.4);
    spot.position.set(0.12, 0.16, -0.20);
    const spotTarget = this.spotTarget = new THREE.Object3D();
    spotTarget.position.set(0.08, 0.12, -10);
    headPivot.add(spot);
    headPivot.add(spotTarget);
    spot.target = spotTarget;

    const coneLen = 11.5;
    const coneGeo = this._trackGeo(new THREE.ConeGeometry(2.5, coneLen, 14, 1, true));
    // Tip at origin, opening forward along -Z
    coneGeo.translate(0, -coneLen * 0.5, 0);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0xffe8be,
      transparent: true,
      opacity: 0.085,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    }));
    const cone = this.cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0.12, 0.16, -0.22);
    cone.visible = false;
    headPivot.add(cone);

    // Camera shutter flash burst light
    const burst = this.burst = new THREE.PointLight(0xffffff, 0, 20, 1.5);
    burst.position.set(0, 0.22, -0.30);
    headPivot.add(burst);

    // Subtle floating nametag
    const tag = makeTagSprite(this.name, this.color);
    this.tagSprite = tag.sprite;
    this._texs.push(tag.tex);
    this._mats.push(tag.mat);
    this.tagSprite.position.set(0, 2.02, 0);
    this.root.add(this.tagSprite);
  };

  RemotePlayer.prototype.setName = function (name) {
    if (!name || name === this.name) return;
    this.name = name;
    if (this.tagSprite) {
      const oldMat = this.tagSprite.material;
      const oldTex = oldMat && oldMat.map;
      this.root.remove(this.tagSprite);
      if (oldTex) oldTex.dispose();
      if (oldMat) oldMat.dispose();
    }
    const tag = makeTagSprite(this.name, this.color);
    this.tagSprite = tag.sprite;
    this._texs.push(tag.tex);
    this._mats.push(tag.mat);
    this.tagSprite.position.set(0, 2.02, 0);
    this.root.add(this.tagSprite);
  };

  RemotePlayer.prototype.applyNetState = function (st) {
    if (!st) return;
    if (st.x !== undefined) this.targetPos.set(st.x, st.y || 0, st.z);
    if (st.yaw !== undefined) this.targetYaw = st.yaw;
    if (st.pitch !== undefined) this.targetPitch = st.pitch;
    if (st.crouch !== undefined) this.targetCrouch = st.crouch;
    this.flashOn = !!st.flashOn;
    this.cameraUp = !!st.cameraUp;
    this.hidden = !!st.hidden;
    this.hideSpotIdx = st.hideSpotIdx !== undefined ? st.hideSpotIdx : -1;
    if (this.alive !== false) {
  this.alive = st.alive !== false;
}
    this.moving = !!st.moving;
    this.sprinting = !!st.sprinting;
    this.noiseRadius = st.noiseRadius || 0;
    if (st.health !== undefined) this.health = st.health;
  };

  RemotePlayer.prototype.triggerPhotoFlash = function () {
    this.burstPower = 14;
  };

  function angDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  RemotePlayer.prototype.update = function (dt, camPos) {
    if (this.alive === false || this.firstPersonHidden) {
  if (this.root) this.root.visible = false;
  return;
}
    const k = Math.min(1, 1 - Math.exp(-16 * (dt || 0.016)));
    this.pos.lerp(this.targetPos, k);
    this.yaw += angDiff(this.yaw, this.targetYaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.crouch += (this.targetCrouch - this.crouch) * k;

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    const visible = this.alive && !this.hidden && !this.firstPersonHidden;
    this.root.visible = visible;

    const lightOn = this.alive && !this.hidden && this.flashOn;
    const baseInt = (LO.settings && LO.settings.lighting === 'simple') ? 2.2 : 4.8;
    this.spot.intensity = lightOn ? baseInt : 0;
    this.cone.visible = visible && lightOn;
    this.headlampLensMat.color.setHex(lightOn ? 0xfff4cf : 0x2a2a2a);

    if (this.burstPower > 0.05) {
      this.burstPower *= Math.exp(-dt * 24);
      this.burst.intensity = this.burstPower;
    } else {
      this.burstPower = 0;
      this.burst.intensity = 0;
    }

    if (!visible) return;

    // Crouch posture
    const ck = this.crouch;
    this.hip.position.y = 0.88 - ck * 0.34;
    this.torso.rotation.x = ck * 0.24;

    // Head look pitch
    this.headPivot.rotation.x = this.pitch * 0.85;

    // Leg & arm gait animation
    if (this.moving) {
      const rate = this.sprinting ? 13.0 : (ck > 0.5 ? 5.2 : 8.2);
      this.walkPhase += dt * rate;
      const s = Math.sin(this.walkPhase);
      const amp = this.sprinting ? 0.68 : (ck > 0.5 ? 0.30 : 0.46);
      this.legs.forEach(L => {
        const lp = this.walkPhase + (L.side > 0 ? Math.PI : 0);
        const sw = Math.sin(lp) * amp;
        L.thigh.rotation.x = sw + ck * 0.35;
        L.knee.rotation.x = Math.max(0, -Math.cos(lp)) * (this.sprinting ? 0.75 : 0.42) + ck * 0.55;
      });
      this.hip.position.y += Math.abs(Math.cos(this.walkPhase)) * 0.035;
      this.armL.rotation.x = -s * amp * 0.8;

      // Spatialized teammate footsteps
      const sgn = Math.sign(s) || 1;
      if (sgn !== this.lastStepSign) {
        this.lastStepSign = sgn;
        if (camPos && LO.audio && LO.audio.footstepAt) {
          const d = Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z);
          if (d < 36) {
            const indoor = this.world && this.world.isIndoor ? this.world.isIndoor(this.pos) : false;
            const inForest = this.world && this.world.isForest ? this.world.isForest(this.pos) : false;
            LO.audio.footstepAt(this.pos, this.sprinting ? 'run' : ck > 0.5 ? 'crouch' : 'walk', indoor, inForest);
          }
        }
      }
    } else {
      this.legs.forEach(L => {
        L.thigh.rotation.x += (ck * 0.35 - L.thigh.rotation.x) * k;
        L.knee.rotation.x += (ck * 0.55 - L.knee.rotation.x) * k;
      });
      this.armL.rotation.x += (0 - this.armL.rotation.x) * k;
    }

    // Right arm pose (flashlight aim vs camera raised to eye)
    this.torchGroup.visible = !this.cameraUp;
    this.camGroup.visible = this.cameraUp;
    const targetArmRx = this.cameraUp ? (1.42 + this.pitch * 0.75) : (this.flashOn ? (1.18 + this.pitch * 0.7) : -this.armL.rotation.x);
    this.armR.rotation.x += (targetArmRx - this.armR.rotation.x) * k;
    this.armR.rotation.z += ((this.cameraUp ? -0.25 : 0) - this.armR.rotation.z) * k;

    // Nametag visibility fades beyond 20m
    if (this.tagSprite && camPos) {
      const dist = Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z);
      this.tagSprite.visible = dist < 24;
      this.tagSprite.material.opacity = Math.max(0, Math.min(0.9, (24 - dist) / 8));
      this.tagSprite.position.y = 2.02 - ck * 0.42;
    }
  };

  RemotePlayer.prototype.dispose = function () {
    if (this.spot) {
      if (this.spot.shadow && this.spot.shadow.map) {
        this.spot.shadow.map.dispose();
        this.spot.shadow.map = null;
      }
      if (this.spot.dispose) this.spot.dispose();
    }
    if (this.burst && this.burst.dispose) this.burst.dispose();
    for (let i = 0; i < this._geos.length; i++) {
      if (this._geos[i] && this._geos[i].dispose) this._geos[i].dispose();
    }
    for (let i = 0; i < this._mats.length; i++) {
      if (this._mats[i] && this._mats[i].dispose) this._mats[i].dispose();
    }
    for (let i = 0; i < this._texs.length; i++) {
      if (this._texs[i] && this._texs[i].dispose) this._texs[i].dispose();
    }
    this._geos.length = 0;
    this._mats.length = 0;
    this._texs.length = 0;
    if (this.root && this.root.parent) {
      this.root.parent.remove(this.root);
    }
  };
})();
