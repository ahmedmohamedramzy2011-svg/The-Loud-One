// ============================================================
//  THE LOUD ONE — death transition
//  The screen floods red, red static eats the picture, then it
//  switches off like an old television (collapsing to a line and
//  a dot) before flicking back on into the death screen.
// ============================================================
(function () {
  const cv = document.createElement('canvas');
  cv.id = 'tvfx';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  // static is drawn at low resolution and scaled up (cheap and suitably grainy)
  const noise = document.createElement('canvas');
  const ng = noise.getContext('2d');
  let nImg = null;

  let phase = 'none', t = 0, onBlack = null, onDone = null;
  const OFF = 0.16, ON = 0.65;
  let BLACK = 1.9;
  // when each stage happens (seconds after death). fast = the sped-up version, slow = the long recording
  const PROFILES = {
    fast: { silIn: 0.15, silFade: 1.3, silGone: 1.9, statIn: 1.2, statFull: 1.9, grey: 1.9, end: 2.25, roomAt: 4.31 },
    slow: { silIn: 0.2, silFade: 2.9, silGone: 3.8, statIn: 2.6, statFull: 3.8, grey: 4.2, end: 5.02, roomAt: 8.78 },
  };


  function size() {
    cv.width = Math.max(320, Math.round(window.innerWidth));
    cv.height = Math.max(180, Math.round(window.innerHeight));
    noise.width = Math.max(160, Math.round(cv.width / 4));
    noise.height = Math.max(90, Math.round(cv.height / 4));
    nImg = ng.createImageData(noise.width, noise.height);
  }
  size();
  window.addEventListener('resize', size);

  // red: 0..1 how red the static is (1 = deep red, 0 = grey)
  function makeNoise(red) {
    const d = nImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v * (1 - red * 0.85); d[i + 2] = v * (1 - red * 0.85); d[i + 3] = 255;
    }
    ng.putImageData(nImg, 0, 0);
  }

  // dark silhouettes drawn into the red (sc = size in px, centred at 0,0)
  const SIL = {
    siren(g, s, k) {
      g.fillStyle = 'rgba(10,0,0,0.92)'; g.strokeStyle = 'rgba(10,0,0,0.92)'; g.lineCap = 'round';
      g.lineWidth = s * 0.025; g.beginPath(); g.moveTo(0, -s * 0.2); g.lineTo(0, s * 0.6); g.stroke();
      [-1, 1].forEach(d => {
        g.beginPath(); g.moveTo(d * s * 0.03, -s * 0.24); g.lineTo(d * s * 0.36, -s * 0.42); g.lineTo(d * s * 0.36, -s * 0.06); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,40,20,0.55)'; g.beginPath(); g.ellipse(d * s * 0.36, -s * 0.24, s * 0.04, s * 0.17, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(10,0,0,0.92)';
      });
      g.lineWidth = s * 0.012;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(-s * 0.15, s * 0.05 + i * s * 0.05); g.lineTo(s * 0.15, s * 0.05 + i * s * 0.05 + (Math.random() - 0.5) * s * 0.02); g.stroke(); }
    },
    tenant(g, s, k) {
      g.fillStyle = 'rgba(10,0,0,0.92)';
      g.beginPath(); g.moveTo(-s * 0.55, 0); g.quadraticCurveTo(0, -s * 0.42, s * 0.55, 0); g.quadraticCurveTo(0, s * 0.42, -s * 0.55, 0); g.fill();
      g.fillStyle = 'rgba(255,50,30,0.8)'; g.beginPath(); g.ellipse(0, 0, s * 0.17, s * 0.17, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.95)'; g.beginPath(); g.ellipse(0, 0, s * 0.035, s * 0.14 + Math.random() * s * 0.01, 0, 0, 7); g.fill();
    },
    silent(g, s, k) {
      g.fillStyle = 'rgba(10,0,0,0.9)';
      g.beginPath(); g.ellipse(0, -s * 0.38, s * 0.06, s * 0.09, 0, 0, 7); g.fill();
      g.fillRect(-s * 0.07, -s * 0.28, s * 0.14, s * 0.45);
      g.fillRect(-s * 0.06, s * 0.17, s * 0.04, s * 0.45); g.fillRect(s * 0.02, s * 0.17, s * 0.04, s * 0.45);
      g.fillRect(-s * 0.11, -s * 0.26, s * 0.03, s * 0.5); g.fillRect(s * 0.08, -s * 0.26, s * 0.03, s * 0.5);
    },
    moth(g, s, k) {
      g.fillStyle = 'rgba(10,0,0,0.9)';
      const f = Math.sin(k * 60) * 0.05;
      [-1, 1].forEach(d => {
        g.beginPath(); g.moveTo(0, -s * 0.15); g.lineTo(d * s * (0.3 + f), -s * 0.42); g.lineTo(d * s * (0.55 + f), -s * 0.32); g.lineTo(d * s * (0.5 + f), -s * 0.02); g.lineTo(0, -s * 0.05); g.fill();
        g.beginPath(); g.moveTo(0, -s * 0.02); g.lineTo(d * s * 0.42, s * 0.05); g.lineTo(d * s * 0.3, s * 0.28); g.lineTo(0, s * 0.12); g.fill();
      });
      g.fillRect(-s * 0.05, -s * 0.2, s * 0.1, s * 0.75);
      g.beginPath(); g.ellipse(0, -s * 0.28, s * 0.07, s * 0.08, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(10,0,0,0.9)'; g.lineWidth = s * 0.01;
      [-1, 1].forEach(d => { g.beginPath(); g.moveTo(d * s * 0.02, -s * 0.34); g.quadraticCurveTo(d * s * 0.08, -s * 0.48, d * s * 0.2, -s * 0.52); g.stroke(); });
      // glinting compound eyes and pale eyespots
      g.fillStyle = 'rgba(255,60,40,0.6)';
      [-1, 1].forEach(d => { g.beginPath(); g.ellipse(d * s * 0.035, -s * 0.28, s * 0.03, s * 0.04, 0, 0, 7); g.fill(); g.beginPath(); g.arc(d * s * 0.36, -s * 0.24, s * 0.04, 0, 7); g.fill(); });
    },
    sneaky(g, s, k) {
      g.fillStyle = 'rgba(255,245,215,0.95)'; g.shadowColor = 'rgba(255,240,200,0.9)'; g.shadowBlur = s * 0.04;
      [-1, 1].forEach(d => { g.beginPath(); g.ellipse(d * s * 0.12, -s * 0.13, s * 0.06, s * 0.026, 0, 0, 7); g.fill(); });
      g.beginPath(); g.moveTo(-s * 0.27, s * 0.02); g.quadraticCurveTo(0, s * 0.3, s * 0.27, s * 0.02); g.quadraticCurveTo(0, s * 0.16, -s * 0.27, s * 0.02); g.fill();
      g.shadowBlur = 0;
    },
    exposure(g, s, k) {
      g.filter = 'blur(' + Math.round(s * 0.01) + 'px)';
      g.fillStyle = 'rgba(10,0,0,0.9)';
      g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.22, s * 0.3, 0, 0, 7); g.fill();
      g.filter = 'none';
      g.fillStyle = 'rgba(255,60,40,0.6)';
      [-1, 1].forEach(d => { g.beginPath(); g.ellipse(d * s * 0.08, -s * 0.1, s * 0.035, s * 0.06, 0, 0, 7); g.fill(); });
      g.beginPath(); g.ellipse(0, s * 0.12, s * 0.06, s * 0.035, 0, 0, 7); g.fill();
    },
    fastone(g, s, k) {
      // speed afterimage streaks behind a low lunging hound
      g.strokeStyle = 'rgba(20,0,0,0.55)'; g.lineWidth = s * 0.014; g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const y = -s * 0.18 + i * s * 0.08;
        g.beginPath(); g.moveTo(-s * 0.6, y); g.lineTo(-s * 0.15 - (i % 2) * s * 0.1, y); g.stroke();
      }
      g.fillStyle = 'rgba(10,0,0,0.93)'; g.strokeStyle = 'rgba(10,0,0,0.93)';
      // gaunt crouching torso & spine spikes
      g.beginPath();
      g.moveTo(-s * 0.32, s * 0.05);
      g.lineTo(s * 0.12, -s * 0.08);
      g.lineTo(s * 0.22, s * 0.08);
      g.lineTo(-s * 0.26, s * 0.16);
      g.closePath(); g.fill();
      for (let i = 0; i < 4; i++) {
        const bx = -s * 0.2 + i * s * 0.09;
        const by = 0.02 * s - i * s * 0.02;
        g.beginPath(); g.moveTo(bx - s * 0.02, by); g.lineTo(bx - s * 0.04, by - s * 0.08); g.lineTo(bx + s * 0.02, by - s * 0.01); g.fill();
      }
      // canine skull and wide open fanged jaws lunging right
      g.beginPath();
      g.moveTo(s * 0.08, -s * 0.09); g.lineTo(s * 0.42, -s * 0.06); g.lineTo(s * 0.22, s * 0.03); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(s * 0.14, s * 0.02); g.lineTo(s * 0.39, s * 0.13); g.lineTo(s * 0.18, s * 0.1); g.closePath(); g.fill();
      // ears swept back
      g.beginPath(); g.moveTo(s * 0.08, -s * 0.08); g.lineTo(-s * 0.03, -s * 0.2); g.lineTo(s * 0.15, -s * 0.09); g.fill();
      // lunging forelegs & hind legs
      g.lineWidth = s * 0.03;
      g.beginPath(); g.moveTo(s * 0.14, s * 0.07); g.lineTo(s * 0.34, s * 0.24); g.lineTo(s * 0.46, s * 0.34); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.26, s * 0.12); g.lineTo(-s * 0.44, s * 0.28); g.lineTo(-s * 0.52, s * 0.38); g.stroke();
      // glowing red eye
      g.fillStyle = 'rgba(255,45,20,0.85)';
      g.beginPath(); g.ellipse(s * 0.21, -s * 0.035, s * 0.032, s * 0.018, -0.2, 0, 7); g.fill();
    },
    powerline(g, s, k) {
      // snapped utility cable + crackling high-voltage lightning forks
      g.strokeStyle = 'rgba(10,0,0,0.92)'; g.lineWidth = s * 0.035; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-s * 0.48, -s * 0.42); g.quadraticCurveTo(-s * 0.1, -s * 0.1, 0, s * 0.16); g.stroke();
      g.strokeStyle = 'rgba(255,215,90,0.88)'; g.lineWidth = s * 0.022;
      for (let i = 0; i < 4; i++) {
        const dx = Math.cos(i * 1.6 + k * 25) * s * 0.28, dy = Math.sin(i * 1.9) * s * 0.22;
        g.beginPath();
        g.moveTo(0, s * 0.12);
        g.lineTo(dx * 0.5 + (Math.random() - 0.5) * s * 0.08, s * 0.12 + dy * 0.5);
        g.lineTo(dx, s * 0.12 + dy);
        g.stroke();
      }
    },
    beartrap(g, s, k) {
      // serrated steel jaws snapping shut
      g.fillStyle = 'rgba(10,0,0,0.93)'; g.strokeStyle = 'rgba(10,0,0,0.93)';
      g.lineWidth = s * 0.04;
      g.beginPath(); g.arc(0, s * 0.05, s * 0.34, Math.PI, 0); g.stroke();
      g.beginPath(); g.arc(0, s * 0.05, s * 0.34, 0, Math.PI); g.stroke();
      for (let i = -3; i <= 3; i++) {
        const tx = i * s * 0.085;
        g.beginPath(); g.moveTo(tx - s * 0.03, -s * 0.05); g.lineTo(tx, s * 0.07); g.lineTo(tx + s * 0.03, -s * 0.05); g.fill();
        g.beginPath(); g.moveTo(tx - s * 0.03, s * 0.15); g.lineTo(tx, s * 0.03); g.lineTo(tx + s * 0.03, s * 0.15); g.fill();
      }
    },
    steam(g, s, k) {
      // ruptured pipe + scalding jet cone
      g.fillStyle = 'rgba(10,0,0,0.92)';
      g.fillRect(-s * 0.42, s * 0.06, s * 0.28, s * 0.12);
      g.fillStyle = 'rgba(255,140,95,0.55)';
      g.beginPath();
      g.moveTo(-s * 0.14, s * 0.12);
      g.lineTo(s * 0.48, -s * 0.26);
      g.lineTo(s * 0.48, s * 0.36);
      g.closePath(); g.fill();
    },
  };

  const FX = {
    // called every frame while the player is dying (k: seconds since death)
    profile(fast) { return fast ? PROFILES.fast : PROFILES.slow; },
    dying(k, cause, P) {
      P = P || PROFILES.fast;
      phase = 'dying';
      const W = cv.width, H = cv.height;
      g.clearRect(0, 0, W, H);
      // 1) instant red flood
      const red = Math.min(1, k / 0.12);
      g.fillStyle = `rgba(150,0,0,${0.78 * red})`; g.fillRect(0, 0, W, H);
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(200,20,10,0.15)'); gr.addColorStop(1, `rgba(40,0,0,${0.7 * red})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // 2) the thing that got you, burned into the red
      if (k > P.silIn && k < P.silGone) {
        const a = Math.min(1, (k - P.silIn) / 0.12) * (k > P.silFade ? Math.max(0, 1 - (k - P.silFade) / (P.silGone - P.silFade)) : 1);
        const jx = (Math.random() - 0.5) * W * 0.012, jy = (Math.random() - 0.5) * H * 0.012;
        const sc = Math.min(W, H) * (0.9 + (k - P.silIn) / (P.silGone - P.silIn) * 0.25);
        const draw = SIL[cause] || SIL.siren;
        // a smeared ghost image behind it, for that distorted, burned-in look
        g.save(); g.globalAlpha = a * 0.35; g.translate(W / 2 - jx * 4 + W * 0.012, H / 2 + jy * 3); g.scale(1.06, 1.06); draw(g, sc, k); g.restore();
        g.save(); g.globalAlpha = a; g.translate(W / 2 + jx, H / 2 + jy); draw(g, sc, k);
        // scratches across the figure
        g.strokeStyle = 'rgba(15,0,0,0.6)'; g.lineWidth = Math.max(1, sc * 0.004);
        for (let i = 0; i < 26; i++) {
          const x = (Math.random() - 0.5) * sc * 0.9, y = (Math.random() - 0.5) * sc * 1.1;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * sc * 0.25, y + (Math.random() - 0.5) * sc * 0.25); g.stroke();
        }
        g.restore();
      }
      // 3) red static creeps in, then 4) it turns grey
      const stat = Math.max(0, Math.min(1, (k - P.statIn) / (P.statFull - P.statIn)));
      if (stat > 0) {
        makeNoise(k < P.grey ? 1 : 0);
        g.globalAlpha = stat;
        g.imageSmoothingEnabled = false;
        g.drawImage(noise, 0, 0, W, H);
        g.globalAlpha = 1;
      }
    },
    // switch off → black → (callback swaps to the death room) → flick back on
    off(blackCb, doneCb, blackDur) {
      phase = 'off'; t = 0; onBlack = blackCb; onDone = doneCb;
      BLACK = blackDur === undefined ? 1.9 : Math.max(0.2, blackDur);
    },
    update(dt) {
      if (phase === 'none' || phase === 'dying') return;
      t += dt;
      const W = cv.width, H = cv.height;
      g.clearRect(0, 0, W, H);
      if (phase === 'off') {
        const p = Math.min(1, t / OFF);
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        const rh = Math.max(2, H * Math.pow(1 - p, 2.5) * 0.55);
        makeNoise(0);
        g.drawImage(noise, 0, (H - rh) / 2, W, rh);
        if (p > 0.6) { g.fillStyle = `rgba(200,200,200,${(p - 0.6) * 1.5})`; g.fillRect(0, (H - rh) / 2, W, rh); }
        if (t >= OFF) { phase = 'black'; t = 0; }
      } else if (phase === 'black') {
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        if (t >= BLACK) { phase = 'on'; t = 0; onBlack && onBlack(); }
      } else if (phase === 'on') {
        const p = Math.min(1, t / ON);
        // a bright line splits open into the new picture, with a couple of flickers
        const open = p < 0.15 ? 0.004 : Math.min(1, Math.pow((p - 0.15) / 0.55, 0.7));
        const rh = Math.max(3, H * open);
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, (H - rh) / 2);
        g.fillRect(0, (H + rh) / 2, W, H);
        const flicker = (p > 0.3 && p < 0.36) || (p > 0.5 && p < 0.53);
        if (flicker) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, (H - rh) / 2, W, rh); }
        const flash = Math.max(0, 1 - p * 2.2);
        if (flash > 0) { g.fillStyle = `rgba(235,240,255,${flash})`; g.fillRect(0, (H - rh) / 2, W, rh); }
        if (p >= 1) { phase = 'none'; g.clearRect(0, 0, W, H); onDone && onDone(); }
      }
    },
    clear() { phase = 'none'; g.clearRect(0, 0, cv.width, cv.height); },
    get active() { return phase !== 'none'; },
  };
  LO.TVFX = FX;
})();
