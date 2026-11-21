// ============================================================
//  THE LOUD ONE — procedural canvas textures
// ============================================================
(function () {
  const cache = {};
  LO.tex = {};

  function rnd(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }
  function canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')];
  }
  function speckle(g, size, r, count, alpha, light) {
    const v = light ? 255 : 0;
    const cap = LO.settings && LO.settings.textures === 'low' ? Math.min(count, size * 10) : count;
    const step = Math.max(1, size / 128);
    let lastBucket = -1;
    for (let i = 0; i < cap; i++) {
      const b = (r() * 8) | 0;
      if (b !== lastBucket) {
        lastBucket = b;
        g.fillStyle = `rgba(${v},${v},${v},${((alpha * (b + 0.5)) / 8).toFixed(3)})`;
      }
      const s = 1 + r() * step;
      g.fillRect(r() * size, r() * size, s, s);
    }
  }
  function grime(g, size, r, n) {
    for (let i = 0; i < n; i++) {
      const x = r() * size, y = r() * size, rad = size * (0.05 + r() * 0.2);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(0,0,0,${0.15 + r() * 0.2})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  const MAKERS = {
    asphalt(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#2a2a2c'; g.fillRect(0, 0, size, size);
      speckle(g, size, r, size * 30, 0.35, true);
      speckle(g, size, r, size * 30, 0.5, false);
      grime(g, size, r, 10);
      // cracks
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = Math.max(1, size / 256);
      for (let i = 0; i < 6; i++) {
        g.beginPath(); let x = r() * size, y = r() * size; g.moveTo(x, y);
        for (let k = 0; k < 8; k++) { x += (r() - 0.5) * size / 6; y += (r() - 0.5) * size / 6; g.lineTo(x, y); }
        g.stroke();
      }
      return c;
    },
    sidewalk(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#5c5a56'; g.fillRect(0, 0, size, size);
      speckle(g, size, r, size * 20, 0.25, true);
      speckle(g, size, r, size * 20, 0.3, false);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = Math.max(1, size / 128);
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(0, i * size / 4); g.lineTo(size, i * size / 4); g.stroke();
        g.beginPath(); g.moveTo(i * size / 4, 0); g.lineTo(i * size / 4, size); g.stroke();
      }
      grime(g, size, r, 8);
      return c;
    },
    grass(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#1f2a17'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < size * 25; i++) {
        const v = r();
        g.fillStyle = v < 0.5 ? 'rgba(60,80,35,0.5)' : 'rgba(20,25,12,0.6)';
        g.fillRect(r() * size, r() * size, 1, 2 + r() * 3);
      }
      grime(g, size, r, 12);
      return c;
    },
    trail(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#2a2219'; g.fillRect(0, 0, size, size);
      // worn center dirt & subtle damp wheel/boot tracks
      g.fillStyle = 'rgba(20,15,10,0.28)';
      g.fillRect(size * 0.16, 0, size * 0.22, size);
      g.fillRect(size * 0.62, 0, size * 0.22, size);
      speckle(g, size, r, size * 18, 0.22, true);
      speckle(g, size, r, size * 24, 0.35, false);
      // scattered dry pine needles & small stones
      for (let i = 0; i < size * 4; i++) {
        g.strokeStyle = r() < 0.5 ? 'rgba(90,64,34,0.55)' : 'rgba(54,42,26,0.6)';
        g.lineWidth = Math.max(1, size / 256);
        const x = r() * size, y = r() * size, a = r() * Math.PI * 2, len = 3 + r() * (size / 42);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
      for (let i = 0; i < size * 0.6; i++) {
        g.fillStyle = `rgba(${85 + r() * 45},${78 + r() * 40},${68 + r() * 35},0.55)`;
        const ps = 1.5 + r() * (size / 90);
        g.fillRect(r() * size, r() * size, ps, ps * 0.8);
      }
      grime(g, size, r, 10);
      return c;
    },
    brick(size, r, opt) {
      const [c, g] = canvas(size);
      const base = opt.color || '#6b3426';
      g.fillStyle = '#3a3330'; g.fillRect(0, 0, size, size);
      const rows = 16, bh = size / rows, bw = size / 8;
      for (let y = 0; y < rows; y++) {
        for (let x = -1; x < 9; x++) {
          const ox = (y % 2) * bw / 2;
          const shade = 0.75 + r() * 0.4;
          g.fillStyle = base; g.globalAlpha = 1;
          g.fillRect(x * bw + ox + 1, y * bh + 1, bw - 2, bh - 2);
          g.fillStyle = `rgba(0,0,0,${1 - shade})`;
          if (shade < 1) g.fillRect(x * bw + ox + 1, y * bh + 1, bw - 2, bh - 2);
          else { g.fillStyle = `rgba(255,255,255,${(shade - 1) * 0.6})`; g.fillRect(x * bw + ox + 1, y * bh + 1, bw - 2, bh - 2); }
        }
      }
      speckle(g, size, r, size * 10, 0.3, false);
      grime(g, size, r, 14);
      return c;
    },
    concrete(size, r, opt) {
      const [c, g] = canvas(size);
      g.fillStyle = opt.color || '#77746c'; g.fillRect(0, 0, size, size);
      speckle(g, size, r, size * 25, 0.2, true);
      speckle(g, size, r, size * 25, 0.25, false);
      grime(g, size, r, 18);
      // drip stains
      for (let i = 0; i < 10; i++) {
        const x = r() * size, w = 2 + r() * size / 40, h = size * (0.2 + r() * 0.6);
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(20,15,10,0.35)'); gr.addColorStop(1, 'rgba(20,15,10,0)');
        g.fillStyle = gr; g.fillRect(x, 0, w, h);
      }
      return c;
    },
    plaster(size, r, opt) {
      const [c, g] = canvas(size);
      g.fillStyle = opt.color || '#8c8573'; g.fillRect(0, 0, size, size);
      speckle(g, size, r, size * 15, 0.12, false);
      grime(g, size, r, 10);
      // peeling patches
      for (let i = 0; i < 5; i++) {
        g.fillStyle = 'rgba(60,50,40,0.35)';
        g.beginPath();
        const x = r() * size, y = r() * size;
        g.ellipse(x, y, size * 0.05 * (1 + r()), size * 0.03 * (1 + r()), r() * 3, 0, 7);
        g.fill();
      }
      // wainscot line
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, size * 0.72, size, size * 0.02);
      return c;
    },
    wood(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#4a3322'; g.fillRect(0, 0, size, size);
      const planks = 6, ph = size / planks;
      for (let i = 0; i < planks; i++) {
        g.fillStyle = `rgba(${90 + r() * 30},${60 + r() * 20},${35 + r() * 15},0.8)`;
        g.fillRect(0, i * ph + 1, size, ph - 2);
        g.strokeStyle = 'rgba(30,18,10,0.35)';
        for (let k = 0; k < 6; k++) {
          g.beginPath(); const y = i * ph + r() * ph;
          g.moveTo(0, y); g.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 6, size * 0.6, y + (r() - 0.5) * 6, size, y); g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(r() * size, i * ph, 2, ph);
      }
      grime(g, size, r, 8);
      return c;
    },
    tile(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#3d3d38'; g.fillRect(0, 0, size, size);
      const n = 8, t = size / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 ? '#a8a294' : '#5a5650';
        g.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
      }
      grime(g, size, r, 16);
      speckle(g, size, r, size * 10, 0.3, false);
      return c;
    },
    facade(size, r, opt) {
      // building wall with a clean grid of dark / broken / boarded windows
      const [c, g] = canvas(size);
      const base = MAKERS[opt.wall || 'brick'](size, r, opt);
      g.drawImage(base, 0, 0);
      const cols = 4, rows = 4;
      const cw = size / cols, rh = size / rows;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const wx = x * cw + cw * 0.22, wy = y * rh + rh * 0.2, ww = cw * 0.56, wh = rh * 0.54;
        // outer lintel / trim frame
        g.fillStyle = '#171718'; g.fillRect(wx - 4, wy - 5, ww + 8, wh + 9);
        const lit = r();
        g.fillStyle = lit < 0.03 ? '#4f3e1e' : `rgb(${6 + lit * 8},${9 + lit * 10},${13 + lit * 14})`;
        g.fillRect(wx, wy, ww, wh);
        // subtle glass sheen
        g.fillStyle = 'rgba(130,150,180,0.09)';
        g.beginPath(); g.moveTo(wx, wy + wh); g.lineTo(wx + ww * 0.55, wy); g.lineTo(wx + ww * 0.75, wy); g.lineTo(wx + ww * 0.2, wy + wh); g.fill();
        // clean window mullions (2x2 sash)
        g.fillStyle = '#1e1e20';
        g.fillRect(wx + ww * 0.47, wy, Math.max(2, ww * 0.06), wh);
        g.fillRect(wx, wy + wh * 0.47, ww, Math.max(2, wh * 0.06));
        // broken glass shards (contained inside pane)
        if (r() < 0.4) {
          g.strokeStyle = 'rgba(200,210,220,0.32)'; g.lineWidth = 1;
          const cx = wx + (0.2 + r() * 0.6) * ww, cy = wy + (0.2 + r() * 0.6) * wh;
          for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(wx + r() * ww, wy + r() * wh); g.stroke(); }
        }
        // neatly boarded-up inside the frame
        if (r() < 0.14) {
          g.fillStyle = '#473625';
          for (let k = 0; k < 2; k++) {
            const by = wy + wh * (0.25 + k * 0.4);
            g.fillRect(wx - 2, by, ww + 4, Math.max(3, wh * 0.16));
          }
        }
        // crisp sill
        g.fillStyle = 'rgba(155,148,138,0.65)'; g.fillRect(wx - 6, wy + wh + 3, ww + 12, Math.max(3, rh * 0.05));
      }
      return c;
    },
    roof(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#2b2a28'; g.fillRect(0, 0, size, size);
      speckle(g, size, r, size * 20, 0.3, true);
      grime(g, size, r, 12);
      return c;
    },
    metal(size, r, opt) {
      const [c, g] = canvas(size);
      g.fillStyle = opt.color || '#3b4a3c'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < 18; i++) {
        g.fillStyle = `rgba(110,50,20,${0.2 + r() * 0.4})`;
        g.beginPath(); g.ellipse(r() * size, r() * size, size * 0.06 * r() + 3, size * 0.04 * r() + 2, r() * 3, 0, 7); g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(i * size / 8, 0); g.lineTo(i * size / 8, size); g.stroke(); }
      speckle(g, size, r, size * 8, 0.4, false);
      return c;
    },
    skin(size, r) {
      // the creature's dried, leathery hide
      const [c, g] = canvas(size);
      g.fillStyle = '#5e5248'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < size * 2; i++) {
        g.strokeStyle = `rgba(${30 + r() * 30},${20 + r() * 20},${15 + r() * 15},${0.2 + r() * 0.3})`;
        g.beginPath(); const x = r() * size, y = r() * size;
        g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + r() * size / 8); g.stroke();
      }
      grime(g, size, r, 20);
      speckle(g, size, r, size * 10, 0.4, false);
      return c;
    },
    road(size, r) {
      // asphalt with center dashed line
      const [c, g] = canvas(size);
      g.drawImage(MAKERS.asphalt(size, r, {}), 0, 0);
      g.fillStyle = 'rgba(210,180,60,0.55)';
      for (let i = 0; i < 4; i++) g.fillRect(size * 0.49, i * size / 4 + size / 16, size * 0.02, size / 8);
      return c;
    },
    sign(size, r) {
      const c = document.createElement('canvas');
      c.width = size * 2;
      c.height = size;
      const g = c.getContext('2d');
      const W = c.width, H = c.height;

      // weathered reflective highway green background
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1f4f2f');
      bg.addColorStop(1, '#14361f');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      speckle(g, Math.min(W, H), r, Math.min(W, H) * 8, 0.14, false);
      // vertical rain grime streaks
      for (let i = 0; i < 18; i++) {
        const x = r() * W, rw = 2 + r() * 6, rh = H * (0.2 + r() * 0.5);
        const sg = g.createLinearGradient(0, 0, 0, rh);
        sg.addColorStop(0, 'rgba(10,14,10,0.32)');
        sg.addColorStop(1, 'rgba(10,14,10,0)');
        g.fillStyle = sg;
        g.fillRect(x, 0, rw, rh);
      }

      // reflective white highway border + subtle corner rivets
      const pad = Math.round(H * 0.055);
      g.strokeStyle = '#d8ddd2';
      g.lineWidth = Math.max(4, H * 0.032);
      g.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
      g.fillStyle = '#8b9288';
      [[pad * 1.6, pad * 1.6], [W - pad * 1.6, pad * 1.6], [pad * 1.6, H - pad * 1.6], [W - pad * 1.6, H - pad * 1.6]].forEach(([bx, by]) => {
        g.beginPath(); g.arc(bx, by, Math.max(3, H * 0.015), 0, Math.PI * 2); g.fill();
      });

      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = Math.max(2, H * 0.015);
      g.shadowOffsetY = Math.max(2, H * 0.01);

      // crisp hierarchy comfortably inside border margins
      g.fillStyle = '#e6eae0';
      g.font = `bold ${Math.round(H * 0.135)}px Arial, sans-serif`;
      g.fillText('WELCOME TO', W * 0.5, H * 0.24, W * 0.78);

      g.fillStyle = '#f2f5ec';
      g.font = `bold ${Math.round(H * 0.245)}px Arial, sans-serif`;
      g.fillText('HOLLOW CREEK', W * 0.5, H * 0.51, W * 0.82);

      // divider bar
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(220,226,214,0.45)';
      g.fillRect(W * 0.14, H * 0.67, W * 0.72, Math.max(2, H * 0.008));

      // population line + clean red slash & replacement "0"
      g.fillStyle = '#d8ded2';
      g.font = `bold ${Math.round(H * 0.125)}px Arial, sans-serif`;
      g.fillText('POP. 2,140', W * 0.43, H * 0.81, W * 0.52);

      g.strokeStyle = '#c8241e';
      g.lineWidth = Math.max(4, H * 0.028);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(W * 0.42, H * 0.835);
      g.lineTo(W * 0.57, H * 0.785);
      g.stroke();

      g.fillStyle = '#d92820';
      g.font = `bold ${Math.round(H * 0.165)}px "Special Elite", Courier, monospace`;
      g.save();
      g.translate(W * 0.65, H * 0.815);
      g.rotate(-0.08);
      g.fillText('0', 0, 0);
      g.restore();

      return c;
    },
    barricade(size, r) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = Math.max(64, Math.round(size * 0.25));
      const g = c.getContext('2d');
      const W = c.width, H = c.height;
      g.fillStyle = '#dad4c4';
      g.fillRect(0, 0, W, H);
      // 45-degree orange highway chevron stripes
      g.fillStyle = '#cf5c18';
      const step = H * 1.15;
      for (let x = -H * 2; x < W + H * 2; x += step) {
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + step * 0.5, H);
        g.lineTo(x + step * 0.5 + H, 0);
        g.lineTo(x + H, 0);
        g.closePath();
        g.fill();
      }
      // top/bottom dark metal rail trim & mud splatter
      g.fillStyle = 'rgba(25,22,18,0.65)';
      g.fillRect(0, 0, W, Math.max(2, H * 0.07));
      g.fillRect(0, H - Math.max(2, H * 0.07), W, Math.max(2, H * 0.07));
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `rgba(38,30,22,${0.18 + r() * 0.3})`;
        g.beginPath();
        g.ellipse(r() * W, r() * H, 4 + r() * (H * 0.22), 2 + r() * (H * 0.12), r() * 3, 0, 7);
        g.fill();
      }
      return c;
    },
    roadClosed(size, r) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = Math.max(64, Math.round(size * 0.35));
      const g = c.getContext('2d');
      const W = c.width, H = c.height;
      g.fillStyle = '#e2dcd0';
      g.fillRect(0, 0, W, H);
      const b = Math.max(3, Math.round(H * 0.08));
      g.strokeStyle = '#1d1c1a';
      g.lineWidth = b;
      g.strokeRect(b, b, W - b * 2, H - b * 2);
      g.fillStyle = '#b4221a';
      g.fillRect(b * 2, b * 2, W - b * 4, H * 0.42);
      g.fillStyle = '#f2eee6';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(H * 0.24)}px Arial, sans-serif`;
      g.fillText('ROAD CLOSED', W * 0.5, b * 2 + H * 0.21, W * 0.84);
      g.fillStyle = '#1b1a18';
      g.font = `bold ${Math.round(H * 0.19)}px Arial, sans-serif`;
      g.fillText('LOCAL TRAFFIC ONLY', W * 0.5, H * 0.77, W * 0.84);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = `rgba(30,26,20,${0.12 + r() * 0.2})`;
        g.fillRect(r() * W, r() * H, 4 + r() * 14, 2 + r() * 8);
      }
      return c;
    },
    cctv(size, r) {
      // CCTV still showing the creature's silhouette
      const [c, g] = canvas(size);
      g.fillStyle = '#0d1a10'; g.fillRect(0, 0, size, size);
      // street + buildings
      g.fillStyle = '#1e3322';
      g.fillRect(0, size * 0.55, size * 0.25, size * 0.45);
      g.fillRect(size * 0.75, size * 0.45, size * 0.25, size * 0.55);
      g.fillStyle = '#16281a'; g.fillRect(0, size * 0.85, size, size * 0.15);
      // the figure
      g.fillStyle = '#020502';
      const cx = size * 0.52;
      g.fillRect(cx - size * 0.012, size * 0.18, size * 0.024, size * 0.36);   // neck pole
      g.fillRect(cx - size * 0.04, size * 0.5, size * 0.08, size * 0.18);      // torso
      g.fillRect(cx - size * 0.04, size * 0.66, size * 0.02, size * 0.22);     // legs
      g.fillRect(cx + size * 0.02, size * 0.66, size * 0.02, size * 0.22);
      g.fillRect(cx - size * 0.07, size * 0.52, size * 0.015, size * 0.28);    // arms
      g.fillRect(cx + size * 0.055, size * 0.52, size * 0.015, size * 0.28);
      // sirens
      g.beginPath(); g.moveTo(cx, size * 0.2); g.lineTo(cx - size * 0.11, size * 0.13); g.lineTo(cx - size * 0.11, size * 0.24); g.fill();
      g.beginPath(); g.moveTo(cx, size * 0.2); g.lineTo(cx + size * 0.11, size * 0.12); g.lineTo(cx + size * 0.11, size * 0.23); g.fill();
      // scanlines + noise
      for (let y = 0; y < size; y += 3) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, size, 1); }
      speckle(g, size, r, size * 30, 0.25, true);
      g.fillStyle = '#7f7'; g.font = `${size / 18}px Courier, monospace`;
      g.fillText('CAM 03  MAIN ST', size * 0.04, size * 0.08);
      g.fillText('10/23  02:13:47', size * 0.04, size * 0.95);
      g.fillStyle = '#f44'; g.fillText('● REC', size * 0.78, size * 0.08);
      return c;
    },
    warning(size, r) {
      // survivor's scrawled warning on a wall
      const [c, g] = canvas(size);
      g.drawImage(MAKERS.plaster(size, r, { color: '#7c766a' }), 0, 0);
      g.fillStyle = 'rgba(120,10,10,0.9)';
      g.font = `bold ${size / 8}px "Special Elite", Courier, monospace`;
      g.textAlign = 'center';
      const lines = ['DONT MAKE', 'A SOUND', 'IT HEARS', 'EVERYTHING'];
      lines.forEach((l, i) => {
        g.save(); g.translate(size / 2 + (r() - 0.5) * 20, size * (0.2 + i * 0.17)); g.rotate((r() - 0.5) * 0.12);
        g.fillText(l, 0, 0); g.restore();
      });
      // crude drawing of the tall thing
      g.strokeStyle = 'rgba(30,20,20,0.9)'; g.lineWidth = size / 90;
      const x = size * 0.85, y = size * 0.9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - size * 0.3); g.stroke();
      g.beginPath(); g.moveTo(x - 10, y - size * 0.32); g.lineTo(x + 10, y - size * 0.28); g.stroke();
      // drips
      for (let i = 0; i < 25; i++) {
        g.fillStyle = 'rgba(110,8,8,0.7)';
        g.fillRect(size * 0.15 + r() * size * 0.7, size * (0.2 + r() * 0.6), 2, 6 + r() * 30);
      }
      return c;
    },
    footprint(size) {
      const [c, g] = canvas(size);
      g.clearRect(0, 0, size, size);
      // pulverized light-grey concrete/asphalt dust halo so dark print contrasts sharply against black roads
      const halo = g.createRadialGradient(size * 0.5, size * 0.52, size * 0.12, size * 0.5, size * 0.52, size * 0.44);
      halo.addColorStop(0, 'rgba(155,148,136,0.58)');
      halo.addColorStop(0.68, 'rgba(130,124,114,0.34)');
      halo.addColorStop(1, 'rgba(90,86,80,0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, size, size);
      // outer displaced rubble rim highlight around heel/sole
      g.strokeStyle = 'rgba(175,168,154,0.72)';
      g.lineWidth = Math.max(2, size * 0.016);
      g.beginPath();
      g.ellipse(size * 0.5, size * 0.62, size * 0.145, size * 0.315, 0, 0, 7);
      g.stroke();
      // pale fracture cracks radiating outward
      g.strokeStyle = 'rgba(165,158,145,0.65)';
      g.lineWidth = Math.max(1.5, size * 0.009);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + (i % 2) * 0.11;
        g.beginPath();
        g.moveTo(size * 0.5 + Math.cos(a) * size * 0.14, size * 0.54 + Math.sin(a) * size * 0.28);
        g.lineTo(size * 0.5 + Math.cos(a + 0.06) * size * 0.34, size * 0.54 + Math.sin(a + 0.06) * size * 0.45);
        g.stroke();
      }
      // deep crushed-in charcoal footprint (sole + 4 clawed toes)
      g.fillStyle = 'rgba(6,5,5,0.96)';
      g.beginPath(); g.ellipse(size * 0.5, size * 0.62, size * 0.13, size * 0.295, 0, 0, 7); g.fill();
      for (let i = 0; i < 4; i++) {
        const tx = size * (0.35 + i * 0.1), ty = size * (0.21 - Math.abs(i - 1.5) * 0.032);
        const ang = (i - 1.5) * 0.16;
        g.strokeStyle = 'rgba(175,168,154,0.68)';
        g.lineWidth = Math.max(1.5, size * 0.012);
        g.beginPath(); g.ellipse(tx, ty, size * 0.044, size * 0.108, ang, 0, 7); g.stroke();
        g.fillStyle = 'rgba(6,5,5,0.96)';
        g.beginPath(); g.ellipse(tx, ty, size * 0.038, size * 0.10, ang, 0, 7); g.fill();
      }
      // dark inner stress fractures
      g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = Math.max(1.5, size * 0.008);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        g.beginPath(); g.moveTo(size * 0.5 + Math.cos(a) * size * 0.14, size * 0.55 + Math.sin(a) * size * 0.28);
        g.lineTo(size * 0.5 + Math.cos(a) * size * 0.30, size * 0.55 + Math.sin(a) * size * 0.42); g.stroke();
      }
      return c;
    },
    poster(size, r) {
      const [c, g] = canvas(size);
      g.fillStyle = '#d8d0b8'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#111'; g.textAlign = 'center';
      g.font = `bold ${size / 7}px Arial, sans-serif`; g.fillText('MISSING', size / 2, size * 0.2);
      g.fillStyle = '#555'; g.fillRect(size * 0.25, size * 0.28, size * 0.5, size * 0.4);
      g.fillStyle = '#111'; g.font = `${size / 16}px Arial, sans-serif`;
      g.fillText('HAVE YOU SEEN', size / 2, size * 0.8); g.fillText('THE MILLER FAMILY?', size / 2, size * 0.88);
      grime(g, size, r, 8);
      return c;
    },
    grainOverlay() {
      const [c, g] = canvas(256);
      const id = g.createImageData(256, 256);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = Math.random() * 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      return c;
    },
  };

  LO.tex.canvas = function (name, opt) {
    opt = opt || {};
    const lowQ = LO.settings.textures === 'low';
    const size = lowQ
      ? (opt.size ? Math.max(64, Math.min(256, opt.size >> 1)) : 128)
      : (opt.size || 512);
    return MAKERS[name](size, rnd(opt.seed || name.length * 7919 + 13), opt);
  };

  // returns a THREE.Texture (cached by name+opts)
  LO.tex.get = function (name, opt) {
    opt = opt || {};
    const key = name + JSON.stringify(opt) + LO.settings.textures;
    if (cache[key]) return cache[key];
    const c = LO.tex.canvas(name, opt);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = LO.settings.textures === 'low' ? 1 : 4;
    if (opt.repeat) t.repeat.set(opt.repeat[0], opt.repeat[1]);
    t.encoding = THREE.sRGBEncoding;
    cache[key] = t;
    return t;
  };
})();
