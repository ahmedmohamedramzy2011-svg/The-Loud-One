// ============================================================
//  THE LOUD ONE — Hollow Creek Survey Map Renderer (v2.7.2)
// ============================================================
window.LO = window.LO || {};

(function () {
  const MAP_SIZE = 760;
  const MAP_PAD = 44;
  const MAP_INNER = MAP_SIZE - MAP_PAD * 2;
  let staticCache = null;
  let midCache = null;
  let lastDrawKey = '';
  let lastZoneText = '';
  let coneSprites = null;

  function makeConeSprite(radius, halfAng, c0, c1) {
    const size = radius * 2 + 4;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const cx = size * 0.5, cy = size * 0.5;
    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, radius);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, radius, -Math.PI / 2 - halfAng, -Math.PI / 2 + halfAng);
    g.closePath();
    g.fill();
    return c;
  }

  function ensureConeSprites() {
    if (coneSprites) return coneSprites;
    coneSprites = {
      localLit: makeConeSprite(34, 0.42, 'rgba(255, 224, 120, 0.55)', 'rgba(209, 26, 26, 0)'),
      localDim: makeConeSprite(34, 0.42, 'rgba(209, 26, 26, 0.34)', 'rgba(209, 26, 26, 0)'),
      remoteLit: makeConeSprite(28, 0.38, 'rgba(255, 232, 160, 0.40)', 'rgba(255, 232, 160, 0)'),
    };
    return coneSprites;
  }

  function drawOutlinedText(g, text, x, y, fill, stroke, lineW, maxW) {
    if (stroke) {
      g.save();
      g.lineJoin = 'round';
      g.miterLimit = 2;
      g.strokeStyle = stroke;
      g.lineWidth = lineW || 3;
      if (maxW) g.strokeText(text, x, y, maxW);
      else g.strokeText(text, x, y);
      g.restore();
    }
    g.fillStyle = fill;
    if (maxW) g.fillText(text, x, y, maxW);
    else g.fillText(text, x, y);
  }

  function buildStaticMapLayer(w, forestRing) {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE;
    const g = c.getContext('2d');
    const halfSpan = forestRing ? ((w.OUTER_E || (w.HALF + 42)) + 10) : (w.HALF + 16);
    const toX = wx => MAP_PAD + (wx + halfSpan) / (halfSpan * 2) * MAP_INNER;
    const toY = wz => MAP_PAD + (wz + halfSpan) / (halfSpan * 2) * MAP_INNER;
    const sc = MAP_INNER / (halfSpan * 2);

    // Aged surveyor paper base
    const bg = g.createLinearGradient(0, 0, MAP_SIZE, MAP_SIZE);
    bg.addColorStop(0, '#dfd2b1');
    bg.addColorStop(0.55, '#d5c49b');
    bg.addColorStop(1, '#c2ad80');
    g.fillStyle = bg;
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Deep forest perimeter outside playable boundary
    g.fillStyle = 'rgba(34, 52, 30, 0.25)';
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Playable woodland ring (clearer green-olive survey tint)
    const tx0 = toX(-w.HALF - 3), tx1 = toX(w.HALF + 3), ty0 = toY(-w.HALF - 3), ty1 = toY(w.HALF + 3);
    if (forestRing) {
      const oe = w.OUTER_E || (w.HALF + 42);
      const ox0 = toX(-oe), ox1 = toX(oe), oy0 = toY(-oe), oy1 = toY(oe);
      g.fillStyle = '#c5be96';
      g.fillRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
      g.strokeStyle = 'rgba(42, 62, 34, 0.55)';
      g.lineWidth = 2;
      g.setLineDash([7, 5]);
      g.strokeRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
      g.setLineDash([]);
    }

    // Hollow Creek town interior ground
    g.fillStyle = '#ddd1b2';
    g.fillRect(tx0, ty0, tx1 - tx0, ty1 - ty0);

    // Paper fold creases
    g.strokeStyle = 'rgba(90, 65, 32, 0.14)';
    g.lineWidth = 2;
    [MAP_SIZE / 3, (MAP_SIZE * 2) / 3].forEach(p => {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, MAP_SIZE); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(MAP_SIZE, p); g.stroke();
    });

    // Winding forest trails (v2.7+)
    if (forestRing && w.trails && w.trails.length) {
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(130, 102, 64, 0.58)';
      w.trails.forEach(tr => {
        if (!tr.pts || tr.pts.length < 2) return;
        g.lineWidth = Math.max(3.5, (tr.width || 4) * sc);
        g.beginPath();
        g.moveTo(toX(tr.pts[0][0]), toY(tr.pts[0][1]));
        for (let i = 1; i < tr.pts.length; i++) g.lineTo(toX(tr.pts[i][0]), toY(tr.pts[i][1]));
        g.stroke();
      });
      g.restore();
    }

    // Highway entrance road (top edge on map at -HALF)
    g.fillStyle = '#999282';
    g.fillRect(toX(-5.5), 0, 11 * sc, toY(-w.HALF) + 2);
    g.strokeStyle = '#d4be6a';
    g.lineWidth = 1.5;
    g.setLineDash([5, 5]);
    g.beginPath(); g.moveTo(toX(0), 0); g.lineTo(toX(0), toY(-w.HALF)); g.stroke();
    g.setLineDash([]);

    // Town streets (vertical & horizontal asphalt grid)
    const stW = 11 * sc;
    g.fillStyle = '#9b9484';
    w.STREETS.forEach(s => {
      g.fillRect(toX(s) - stW / 2, toY(-w.HALF), stW, toY(w.HALF) - toY(-w.HALF));
      g.fillRect(toX(-w.HALF), toY(s) - stW / 2, toX(w.HALF) - toX(-w.HALF), stW);
    });
    // Subtle street borders
    g.strokeStyle = 'rgba(52, 44, 34, 0.35)';
    g.lineWidth = 1;
    w.STREETS.forEach(s => {
      g.strokeRect(toX(s) - stW / 2, toY(-w.HALF), stW, toY(w.HALF) - toY(-w.HALF));
      g.strokeRect(toX(-w.HALF), toY(s) - stW / 2, toX(w.HALF) - toX(-w.HALF), stW);
    });

    // Open lots (parking / park / lot)
    (w.openLots || []).forEach(l => {
      const lx = toX(l.cx - 10), ly = toY(l.cz - 10), lw = 20 * sc;
      g.fillStyle = l.type === 'park' ? 'rgba(72, 104, 62, 0.32)' : 'rgba(130, 122, 108, 0.35)';
      g.fillRect(lx, ly, lw, lw);
    });

    // Outer frame border & grid coordinates
    g.strokeStyle = '#33281d';
    g.lineWidth = 3;
    g.strokeRect(10, 10, MAP_SIZE - 20, MAP_SIZE - 20);
    g.lineWidth = 1;
    g.strokeRect(15, 15, MAP_SIZE - 30, MAP_SIZE - 30);

    // Street coordinate labels along top margin
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    ['1ST AVE', '2ND AVE', 'MAIN ST', '4TH AVE', '5TH AVE'].forEach((lbl, idx) => {
      if (w.STREETS[idx] !== undefined) {
        drawOutlinedText(g, lbl, toX(w.STREETS[idx]), Math.max(30, toY(-w.HALF) - 10), 'rgba(42, 32, 22, 0.88)', 'rgba(235, 224, 194, 0.72)', 2.5);
      }
    });
    drawOutlinedText(g, 'HWY ENTRANCE', toX(0), 28, '#2d2116', 'rgba(240, 230, 200, 0.8)', 3);

    // Compass rose in top-right margin
    const rx = MAP_SIZE - 46, ry = 46;
    g.fillStyle = 'rgba(223, 210, 177, 0.92)';
    g.beginPath(); g.arc(rx, ry, 20, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7e1e18'; g.lineWidth = 2;
    g.beginPath(); g.arc(rx, ry, 20, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(rx, ry - 15); g.lineTo(rx - 5, ry + 5); g.lineTo(rx, ry + 1); g.lineTo(rx + 5, ry + 5); g.closePath();
    g.fillStyle = '#8b1f18'; g.fill();
    g.fillStyle = '#2d2116'; g.font = 'bold 11px serif'; g.textAlign = 'center';
    g.fillText('N', rx, ry - 23);

    return { canvas: c, world: w, forestRing, halfSpan, toX, toY, sc };
  }

  function buildMidMapLayer(baseLayer, w, forestRing, hazards) {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE;
    const g = c.getContext('2d');
    const { canvas: base, toX, toY, sc } = baseLayer;
    g.drawImage(base, 0, 0);

    // Enterable lookup by building id for doorway / floor / POI metadata
    const entById = new Map();
    (w.enterables || []).forEach(info => {
      if (info && info.building) entById.set(info.building.id, info);
    });

    const poiQueue = [];

    // Draw all buildings (closed, enterable, outskirt, Sheriff HQ, smashed state)
    (w.buildings || []).forEach(b => {
      const bx0 = toX(b.minX), bx1 = toX(b.maxX), bz0 = toY(b.minZ), bz1 = toY(b.maxZ);
      const bw = Math.max(4, bx1 - bx0), bh = Math.max(4, bz1 - bz0);
      if (b.smashed) {
        g.fillStyle = 'rgba(92, 74, 54, 0.45)';
        g.fillRect(bx0, bz0, bw, bh);
        g.strokeStyle = '#6d2e23';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(bx0, bz0); g.lineTo(bx1, bz1);
        g.moveTo(bx1, bz0); g.lineTo(bx0, bz1);
        g.stroke();
        return;
      }
      if (b.sheriff) {
        g.fillStyle = '#4f6484';
        g.strokeStyle = '#1b2942';
        g.lineWidth = 2.2;
      } else if (b.type === 'enter') {
        g.fillStyle = '#c59d5f';
        g.strokeStyle = '#4e371b';
        g.lineWidth = 1.6;
      } else {
        g.fillStyle = b.outskirt ? '#787166' : '#857d71';
        g.strokeStyle = '#38322b';
        g.lineWidth = 1.2;
      }
      g.fillRect(bx0, bz0, bw, bh);
      g.strokeRect(bx0, bz0, bw, bh);

      const info = entById.get(b.id);
      if (info && info.F) {
        const dp = info.F.point(0, b.D / 2);
        const dx = toX(dp.x), dy = toY(dp.z);
        g.fillStyle = b.sheriff ? '#e8f1ff' : '#fff4d8';
        g.fillRect(dx - 2.5, dy - 2.5, 5, 5);
        poiQueue.push({
          cx: (bx0 + bx1) * 0.5,
          cy: (bz0 + bz1) * 0.5,
          bottom: bz1,
          bw,
          bh,
          sheriff: !!b.sheriff,
          isLeftMapHouse: !!(w.spawnLeftBuilding && info === w.spawnLeftBuilding),
          label: info.poiShort || (b.sheriff ? 'SHERIFF HQ' : (info.kind ? info.kind.toUpperCase() : 'HOUSE')),
          sub: b.sheriff ? '2F+ROOF' : info.hasRoof ? 'ROOF' : (info.floors && info.floors > 1 ? '2F' : ''),
        });
      }
    });

    // Town perimeter fences + open gates + live Fast One breaches
    if (w.fences && w.fences.length) {
      w.fences.forEach(f => {
        const cx = toX(f.basePos.x), cy = toY(f.basePos.z);
        const span = 6.0 * sc;
        if (f.permanentGate) {
          g.fillStyle = '#6f8752';
          g.strokeStyle = '#28361b';
          g.lineWidth = 1;
          g.fillRect(cx - 3, cy - 3, 6, 6);
          g.strokeRect(cx - 3, cy - 3, 6, 6);
          return;
        }
        if (f.broken) {
          g.strokeStyle = '#c42b23';
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(cx - 4, cy - 4); g.lineTo(cx + 4, cy + 4);
          g.moveTo(cx + 4, cy - 4); g.lineTo(cx - 4, cy + 4);
          g.stroke();
          return;
        }
        g.strokeStyle = '#534332';
        g.lineWidth = 2.6;
        g.beginPath();
        if (f.axis === 'x') {
          g.moveTo(cx - span * 0.5, cy); g.lineTo(cx + span * 0.5, cy);
        } else {
          g.moveTo(cx, cy - span * 0.5); g.lineTo(cx, cy + span * 0.5);
        }
        g.stroke();
      });
    }

    // Active utility / environmental hazards (subtle surveyor marks)
    if (hazards && hazards.length) {
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (!h || !h.pos) continue;
        if (h.type === 'beartrap' && h.disarmed) continue;
        if (h.type === 'tindebris' && h.toppled) continue;
        const hx = toX(h.pos.x), hy = toY(h.pos.z);
        if (h.type === 'powerline' || h.type === 'steam' || h.type === 'beartrap') {
          g.fillStyle = h.type === 'powerline' ? '#f0a830' : (h.type === 'steam' ? '#d96f2e' : '#965c34');
          g.strokeStyle = '#261709';
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(hx, hy, 3.6, 0, Math.PI * 2);
          g.fill(); g.stroke();
        } else {
          g.fillStyle = 'rgba(200, 155, 70, 0.72)';
          g.fillRect(hx - 2, hy - 2, 4, 4);
        }
      }
    }

    // Photographed evidence markers (green check circles)
    (w.evidence || []).forEach(ev => {
      if (!ev.found || !ev.pos) return;
      const ex = toX(ev.pos.x), ey = toY(ev.pos.z);
      g.fillStyle = '#247539';
      g.strokeStyle = '#eaf7ec';
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(ex, ey, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(ex - 3, ey); g.lineTo(ex - 0.5, ey + 2.6); g.lineTo(ex + 3.4, ey - 2.6); g.stroke();
    });

    // Individual Enterable House / Building POI labels (drawn above buildings & fences for crisp legibility)
    g.textAlign = 'center';
    for (let i = 0; i < poiQueue.length; i++) {
      const p = poiQueue[i];
      if (p.sheriff) {
        g.font = 'bold 9.5px monospace';
        drawOutlinedText(g, '★ SHERIFF HQ', p.cx, p.cy - 1, '#f4f8ff', '#16243d', 3.2);
        g.font = 'bold 7.5px monospace';
        drawOutlinedText(g, p.sub, p.cx, p.cy + 9, '#d6e4ff', '#16243d', 2.6);
      } else {
        g.font = 'bold 9px monospace';
        const textY = p.sub ? p.cy - 1 : p.cy + 3;
        drawOutlinedText(g, p.label, p.cx, textY, '#1c1208', 'rgba(248, 240, 214, 0.92)', 3.0);
        if (p.sub) {
          g.font = 'bold 7.5px monospace';
          drawOutlinedText(g, p.sub, p.cx, p.cy + 8.5, '#5b2810', 'rgba(248, 240, 214, 0.9)', 2.4);
        }
      }
    }

    // Fire Lookout Tower POI marker & prominent orientation label (v2.7+)
    if (forestRing && w.lookout) {
      const lx = toX(w.lookout.x), ly = toY(w.lookout.z);
      g.fillStyle = '#a34d1f';
      g.strokeStyle = '#2d1609';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(lx, ly - 9);
      g.lineTo(lx + 8, ly + 6);
      g.lineTo(lx - 8, ly + 6);
      g.closePath();
      g.fill(); g.stroke();

      // Keep label well inside right canvas border
      const labelX = Math.min(lx, MAP_SIZE - 62);
      g.textAlign = 'center';
      g.font = 'bold 9.5px monospace';
      drawOutlinedText(g, 'LOOKOUT TOWER', labelX, ly + 17, '#3b1806', 'rgba(245, 236, 208, 0.95)', 3.2);
    }

    // Subtle woodland gate orientation callouts
    if (forestRing) {
      g.textAlign = 'center';
      g.font = 'bold 8px monospace';
      drawOutlinedText(g, 'E. GATE', toX(w.HALF + 3) + 2, toY(27) - 9, '#2b3d1e', 'rgba(236, 228, 200, 0.9)', 2.6);
      drawOutlinedText(g, 'N. GATE', toX(-27), toY(w.HALF + 3) + 14, '#2b3d1e', 'rgba(236, 228, 200, 0.9)', 2.6);
      drawOutlinedText(g, 'W. GATE', toX(-(w.HALF + 3)) - 2, toY(-27) - 9, '#2b3d1e', 'rgba(236, 228, 200, 0.9)', 2.6);
    }

    return c;
  }

  function resetCache() {
    staticCache = null;
    midCache = null;
    lastDrawKey = '';
    lastZoneText = '';
  }

  function computeMidKey(w, hazList) {
    let smashedCount = 0;
    const blds = w.buildings || [];
    for (let i = 0; i < blds.length; i++) if (blds[i].smashed) smashedCount++;
    let brokenFenceCount = 0;
    const fns = w.fences || [];
    for (let i = 0; i < fns.length; i++) if (fns[i].broken) brokenFenceCount++;
    let foundEvCount = 0;
    const evs = w.evidence || [];
    for (let i = 0; i < evs.length; i++) if (evs[i].found) foundEvCount++;

    let hazStateCount = 0;
    if (hazList) {
      for (let i = 0; i < hazList.length; i++) {
        const h = hazList[i];
        if (h && !h.disarmed && !h.toppled) hazStateCount++;
      }
    }
    return `${smashedCount}:${brokenFenceCount}:${foundEvCount}:${hazList ? hazList.length : 0}:${hazStateCount}`;
  }

  function prebuild(opts) {
    opts = opts || {};
    const w = opts.world;
    if (!w) return;
    const forestRing = !!opts.forestRing;
    const hazList = opts.hazards || null;
    ensureConeSprites();
    if (!staticCache || staticCache.world !== w || staticCache.forestRing !== forestRing) {
      staticCache = buildStaticMapLayer(w, forestRing);
      midCache = null;
    }
    const midKey = computeMidKey(w, hazList);
    if (!midCache || midCache.world !== w || midCache.forestRing !== forestRing || midCache.key !== midKey) {
      midCache = {
        world: w,
        forestRing,
        key: midKey,
        canvas: buildMidMapLayer(staticCache, w, forestRing, hazList),
      };
    }
    // Warm up the destination canvas surface so first map pickup doesn't stall on texture upload
    const canvas = document.getElementById('map-canvas');
    if (canvas) {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      g.drawImage(midCache.canvas, 0, 0);
      lastDrawKey = '';
    }
  }

  function drawTownMap(opts) {
    opts = opts || {};
    const canvas = document.getElementById('map-canvas');
    const w = opts.world;
    const player = opts.player;
    if (!canvas || !w || !player) return;
    const forestRing = !!opts.forestRing;
    if (!staticCache || staticCache.world !== w || staticCache.forestRing !== forestRing) {
      staticCache = buildStaticMapLayer(w, forestRing);
      midCache = null;
      lastDrawKey = '';
    }

    const hazList = opts.hazards || null;
    const midKey = computeMidKey(w, hazList);
    if (!midCache || midCache.world !== w || midCache.forestRing !== forestRing || midCache.key !== midKey) {
      midCache = {
        world: w,
        forestRing,
        key: midKey,
        canvas: buildMidMapLayer(staticCache, w, forestRing, hazList),
      };
      lastDrawKey = '';
    }

    const hintTarget = opts.hintTarget;
    const remotes = opts.remotePlayers || [];
    let remoteKey = '';
    for (let ri = 0; ri < remotes.length; ri++) {
      const rp = remotes[ri];
      if (!rp || !rp.pos) continue;
      remoteKey += `|${rp.id}:${rp.alive ? 1 : 0}:${rp.pos.x.toFixed(1)},${rp.pos.z.toFixed(1)},${(rp.yaw || 0).toFixed(2)},${rp.flashOn ? 1 : 0}`;
    }
    const drawKey = `${midKey}|${player.pos.x.toFixed(1)},${player.pos.z.toFixed(1)},${player.yaw.toFixed(2)},${player.flashOn ? 1 : 0}|${hintTarget && !hintTarget.found ? hintTarget.id : ''}${remoteKey}`;
    if (drawKey !== lastDrawKey) {
      lastDrawKey = drawKey;
      const cones = ensureConeSprites();
      const { toX, toY } = staticCache;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      g.drawImage(midCache.canvas, 0, 0);

      // Active Hint target marker (amber ring)
      if (hintTarget && !hintTarget.found && hintTarget.pos) {
        const hx = toX(hintTarget.pos.x), hy = toY(hintTarget.pos.z);
        g.strokeStyle = '#d48806';
        g.lineWidth = 2.2;
        g.beginPath(); g.arc(hx, hy, 10, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#ffbf2b';
        g.font = 'bold 12px monospace';
        g.textAlign = 'center';
        g.fillText('?', hx, hy + 4);
      }

      // Remote teammates on the survey map
      for (let ri = 0; ri < remotes.length; ri++) {
        const rp = remotes[ri];
        if (!rp || !rp.pos) continue;
        const rx = toX(rp.pos.x), ry = toY(rp.pos.z);
        if (!rp.alive) {
          g.strokeStyle = rp.color || '#888';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(rx - 4, ry - 4); g.lineTo(rx + 4, ry + 4);
          g.moveTo(rx + 4, ry - 4); g.lineTo(rx - 4, ry + 4);
          g.stroke();
          continue;
        }
        g.save();
        g.translate(rx, ry);
        g.rotate(-(rp.yaw || 0));
        if (rp.flashOn) {
          const hs = cones.remoteLit.width * 0.5;
          g.drawImage(cones.remoteLit, -hs, -hs);
        }
        g.fillStyle = rp.color || '#4a78a8';
        g.strokeStyle = '#fffaf0';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(0, -9);
        g.lineTo(6, 6);
        g.lineTo(0, 2.5);
        g.lineTo(-6, 6);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }

      // Player view cone + live directional chevron (at yaw=0, fwd=-Z => -Y on canvas; rotate by -player.yaw)
      const px = toX(player.pos.x), py = toY(player.pos.z);
      g.save();
      g.translate(px, py);
      g.rotate(-player.yaw);
      const localCone = player.flashOn ? cones.localLit : cones.localDim;
      const lhs = localCone.width * 0.5;
      g.drawImage(localCone, -lhs, -lhs);

      g.fillStyle = '#d11a1a';
      g.strokeStyle = '#fffaf0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(7.5, 7.5);
      g.lineTo(0, 3.5);
      g.lineTo(-7.5, 7.5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    // Zone text readout
    const zEl = document.getElementById('map-zone');
    if (zEl) {
      let zone = 'HOLLOW CREEK STREETS';
      if (player.hidden) zone = 'HIDING SPOT';
      else if (player.indoor) {
        let curBuildingName = null;
        for (let i = 0; i < (w.enterables || []).length; i++) {
          const ent = w.enterables[i];
          const b = ent && ent.building;
          if (!b || b.smashed) continue;
          if (player.pos.x > b.minX && player.pos.x < b.maxX && player.pos.z > b.minZ && player.pos.z < b.maxZ) {
            curBuildingName = ent.poiLabel || null;
            break;
          }
        }
        const levelTag = player.pos.y > 2.2 ? ' (UPPER / ROOF)' : '';
        zone = curBuildingName ? `${curBuildingName.toUpperCase()}${levelTag}` : (player.pos.y > 2.2 ? 'INDOORS (UPPER / ROOF)' : 'INSIDE BUILDING');
      } else if (w.lookout && Math.hypot(player.pos.x - w.lookout.x, player.pos.z - w.lookout.z) < 6) zone = 'FIRE LOOKOUT TOWER';
      else if (w.isForest && w.isForest(player.pos)) zone = 'WOODLAND PERIMETER';
      const nextZoneText = `${zone}  ·  ${opts.evidenceCount || 0}/${opts.evidenceNeeded || 5} EVIDENCE`;
      if (nextZoneText !== lastZoneText) {
        lastZoneText = nextZoneText;
        zEl.textContent = nextZoneText;
      }
    }
  }

  LO.Map = {
    prebuild,
    draw: drawTownMap,
    resetCache,
  };
})();
