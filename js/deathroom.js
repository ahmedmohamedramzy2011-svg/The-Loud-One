// ============================================================
//  THE LOUD ONE — death screen
//  A dark room: an old CRT television plays a tape showing how to
//  survive whatever killed you, and a notebook beside it opens on
//  a pencil sketch of the entity and four handwritten tips.
// ============================================================
(function () {
  const HAND = '"Caveat", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

  // 1 appearance · 2 what it does / where it lurks · 3 core mechanic · 4 how to avoid it
  const ENTRIES = {
    siren: { name: 'SIREN HEAD', label: 'THE LOUD ONE', tips: [
      'Tall humanoid with a siren as a head',
      'Uses echolocation to find you',
      'Attracted to loud sounds',
      'Stay absolutely silent when it spots you',
    ] },
    tenant: { name: 'THE TENANT', label: 'PHENOMENON-225', tips: [
      'Appears as a single red eye',
      'He loves the darkness',
      'Creeps closer the longer you hide',
      "Don't overstay your welcome",
    ] },
    silent: { name: 'THE SILENT ONE', label: 'PHENOMENON-249', tips: [
      'Tall slender humanoid',
      'Loves absolute silence',
      'Gives visual indicators before attacking',
      "Don't go completely silent for too long",
    ] },
    moth: { name: 'THE MOTHS', label: 'PHENOMENON-250', tips: [
      'Pale, furry moth-people with big black eyes',
      'Stand still in dark corners, only seen in flashlight',
      'Shriek if your light rests on them too long',
      'Keep your beam moving, never stare',
    ] },
    sneaky: { name: 'THE SNEAKY ONE', label: 'PHENOMENON-241', tips: [
      'Two glowing eyes and a really wide smile',
      'Creeps up right behind you when you least expect it',
      'Your flashlight flickers and you hear breathing',
      'Turn around before it gets you',
    ] },
    exposure: { name: 'THE EXPOSURE', label: 'PHENOMENON-237', tips: [
      'A blurred figure only seen through a lens',
      "Lurks inside your camera's viewfinder",
      'Creeps closer the longer your camera is up',
      'Lower your camera, use your flashlight to see',
    ] },
    fastone: { name: 'THE FAST ONE', label: 'PHENOMENON-242', tips: [
      'A gaunt, low hound that leaves red afterimages',
      'Smashes through the farthest perimeter fence',
      'If safety is far away, adrenaline lets you sprint twice as fast',
      'Reach the blue-lit locker or dumpster within 6 seconds',
    ] },
  };
  LO.DEATH_ENTRIES = ENTRIES;

  // ---------------- pencil sketching helpers ----------------
  function pencil(g, pts, passes, jitter, closed) {
    for (let p = 0; p < (passes || 2); p++) {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const jx = x + (Math.random() - 0.5) * (jitter || 3), jy = y + (Math.random() - 0.5) * (jitter || 3);
        if (i) g.lineTo(jx, jy); else g.moveTo(jx, jy);
      });
      if (closed) g.closePath();
      g.stroke();
    }
  }
  function ellipse(g, cx, cy, rx, ry, passes) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    pencil(g, pts, passes || 2, 2.5);
  }
  function hatch(g, x0, y0, x1, y1, n, ang) {
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      pencil(g, [[x, y], [x + Math.cos(ang) * 14, y + Math.sin(ang) * 14]], 1, 1.5);
    }
  }

  const SKETCH = {
    siren(g, w, h) {
      const cx = w / 2;
      pencil(g, [[cx, h * 0.22], [cx, h * 0.4]], 3);                                // pole neck
      // two horns
      pencil(g, [[cx - 6, h * 0.2], [cx - 70, h * 0.12], [cx - 70, h * 0.27], [cx - 6, h * 0.23]], 3, 3, true);
      pencil(g, [[cx + 6, h * 0.2], [cx + 70, h * 0.12], [cx + 70, h * 0.27], [cx + 6, h * 0.23]], 3, 3, true);
      ellipse(g, cx - 70, h * 0.195, 10, 38); ellipse(g, cx + 70, h * 0.195, 10, 38);
      // body
      pencil(g, [[cx - 34, h * 0.4], [cx + 34, h * 0.4], [cx + 18, h * 0.58], [cx - 18, h * 0.58]], 3, 3, true);
      for (let i = 0; i < 4; i++) pencil(g, [[cx - 26, h * (0.43 + i * 0.035)], [cx + 26, h * (0.43 + i * 0.035)]], 1, 2);
      // long arms to the knees and legs
      pencil(g, [[cx - 34, h * 0.41], [cx - 52, h * 0.62], [cx - 56, h * 0.8]], 3);
      pencil(g, [[cx + 34, h * 0.41], [cx + 52, h * 0.62], [cx + 56, h * 0.8]], 3);
      pencil(g, [[cx - 14, h * 0.58], [cx - 22, h * 0.76], [cx - 20, h * 0.95]], 3);
      pencil(g, [[cx + 14, h * 0.58], [cx + 22, h * 0.76], [cx + 20, h * 0.95]], 3);
      // sound lines & echolocation / hearing mechanic note
      for (let i = 0; i < 3; i++) { pencil(g, [[cx - 92 - i * 12, h * 0.15], [cx - 98 - i * 12, h * 0.2], [cx - 92 - i * 12, h * 0.25]], 1, 1.5); }
      for (let i = 0; i < 3; i++) { pencil(g, [[cx + 92 + i * 12, h * 0.15], [cx + 98 + i * 12, h * 0.2], [cx + 92 + i * 12, h * 0.25]], 1, 1.5); }
      // tiny crossed-out footstep note
      ellipse(g, w * 0.15, h * 0.82, 10, 14, 2);
      pencil(g, [[w * 0.1, h * 0.77], [w * 0.2, h * 0.87]], 2, 1.5);
      g.save();
      g.fillStyle = '#2d2924'; g.font = `26px ${HAND}`;
      g.fillText('he hears', w * 0.06, h * 0.08);
      g.fillText('everything...', w * 0.06, h * 0.13);
      g.fillStyle = '#9e1c16'; g.font = `24px ${HAND}`;
      g.fillText('crouch!', w * 0.06, h * 0.93);
      g.restore();
    },
    tenant(g, w, h) {
      // a locker with slats and a single red eye inside
      pencil(g, [[w * 0.3, h * 0.12], [w * 0.7, h * 0.12], [w * 0.7, h * 0.92], [w * 0.3, h * 0.92]], 3, 3, true);
      for (let i = 0; i < 9; i++) pencil(g, [[w * 0.36, h * (0.2 + i * 0.07)], [w * 0.64, h * (0.2 + i * 0.07)]], 1, 2);
      hatch(g, w * 0.32, h * 0.14, w * 0.68, h * 0.9, 120, 0.9);
      g.save(); g.fillStyle = '#f4f0e0'; g.beginPath(); g.ellipse(w * 0.5, h * 0.42, 46, 20, 0, 0, 7); g.fill();
      g.fillStyle = '#a31515'; g.beginPath(); g.ellipse(w * 0.5, h * 0.42, 22, 18, 0, 0, 7); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.ellipse(w * 0.5, h * 0.42, 5, 15, 0, 0, 7); g.fill(); g.restore();
      ellipse(g, w * 0.5, h * 0.42, 47, 21, 3);
      // mechanic notes: 14s limit & [F] flashlight blind
      pencil(g, [[w * 0.72, h * 0.42], [w * 0.78, h * 0.42]], 2, 1.5);
      pencil(g, [[w * 0.77, h * 0.37], [w * 0.85, h * 0.34]], 1, 1);
      pencil(g, [[w * 0.77, h * 0.42], [w * 0.86, h * 0.42]], 1, 1);
      pencil(g, [[w * 0.77, h * 0.47], [w * 0.85, h * 0.50]], 1, 1);
      g.save();
      g.fillStyle = '#9e1c16'; g.font = `28px ${HAND}`; g.fillText('14s...', w * 0.06, h * 0.22);
      g.fillStyle = '#333'; g.font = `24px ${HAND}`;
      g.fillText('get out!', w * 0.05, h * 0.30);
      g.fillText('F = blind', w * 0.73, h * 0.60);
      g.fillText('(-90% bat)', w * 0.72, h * 0.66);
      g.restore();
    },
    silent(g, w, h) {
      const cx = w / 2;
      ellipse(g, cx, h * 0.14, 16, 24, 3);                                       // faceless head
      pencil(g, [[cx, h * 0.22], [cx, h * 0.27]], 2);
      pencil(g, [[cx - 22, h * 0.27], [cx + 22, h * 0.27], [cx + 14, h * 0.58], [cx - 14, h * 0.58]], 3, 3, true);
      pencil(g, [[cx - 22, h * 0.28], [cx - 34, h * 0.55], [cx - 38, h * 0.76]], 3);
      pencil(g, [[cx + 22, h * 0.28], [cx + 34, h * 0.55], [cx + 38, h * 0.76]], 3);
      pencil(g, [[cx - 9, h * 0.58], [cx - 13, h * 0.95]], 3); pencil(g, [[cx + 9, h * 0.58], [cx + 13, h * 0.95]], 3);
      // "shh..." + crossed speaker + wind mechanic clue
      pencil(g, [[w * 0.74, h * 0.18], [w * 0.80, h * 0.18], [w * 0.86, h * 0.13], [w * 0.86, h * 0.27], [w * 0.80, h * 0.22], [w * 0.74, h * 0.22]], 2, 1.5, true);
      pencil(g, [[w * 0.72, h * 0.12], [w * 0.90, h * 0.29]], 2, 1.5);
      g.save();
      g.fillStyle = '#333'; g.font = `28px ${HAND}`; g.fillText('shh...', w * 0.08, h * 0.2);
      g.font = `23px ${HAND}`; g.fillText('wind stops?', w * 0.66, h * 0.37);
      g.fillStyle = '#9e1c16'; g.fillText('make noise!', w * 0.64, h * 0.43);
      g.fillStyle = '#444'; g.fillText('30s...', w * 0.08, h * 0.28);
      g.restore();
    },
    moth(g, w, h) {
      const cx = w / 2;
      // four wings with veins and eyespots
      [-1, 1].forEach(sd => {
        pencil(g, [[cx, h * 0.27], [cx + sd * 70, h * 0.12], [cx + sd * 175, h * 0.15], [cx + sd * 205, h * 0.3], [cx + sd * 150, h * 0.42], [cx, h * 0.36]], 2, 4, true);
        pencil(g, [[cx, h * 0.37], [cx + sd * 120, h * 0.42], [cx + sd * 150, h * 0.56], [cx + sd * 85, h * 0.64], [cx, h * 0.47]], 2, 4, true);
        for (let i = 0; i < 4; i++) pencil(g, [[cx + sd * 10, h * 0.3], [cx + sd * (60 + i * 40), h * (0.16 + i * 0.06)]], 1, 2);
        ellipse(g, cx + sd * 140, h * 0.27, 18, 16, 2); ellipse(g, cx + sd * 140, h * 0.27, 7, 6, 2);
        ellipse(g, cx + sd * 95, h * 0.52, 12, 11, 2);
        hatch(g, cx + (sd > 0 ? 60 : -190), h * 0.17, cx + (sd > 0 ? 190 : -60), h * 0.4, 35, sd > 0 ? 0.9 : 2.2);
      });
      // furry body and abdomen
      pencil(g, [[cx - 22, h * 0.25], [cx + 22, h * 0.25], [cx + 18, h * 0.45], [cx - 18, h * 0.45]], 3, 3, true);
      for (let i = 0; i < 26; i++) { const x = cx + (Math.random() - 0.5) * 44, y = h * (0.24 + Math.random() * 0.03); pencil(g, [[x, y], [x + (Math.random() - 0.5) * 8, y - 10]], 1, 1.5); }
      ellipse(g, cx, h * 0.53, 15, 34, 3);
      [0.5, 0.55, 0.6].forEach(y => pencil(g, [[cx - 13, h * y], [cx + 13, h * y]], 1, 1.5));
      // long thin legs and arms
      pencil(g, [[cx - 8, h * 0.62], [cx - 12, h * 0.8], [cx - 10, h * 0.97]], 3); pencil(g, [[cx + 8, h * 0.62], [cx + 12, h * 0.8], [cx + 10, h * 0.97]], 3);
      pencil(g, [[cx - 22, h * 0.27], [cx - 34, h * 0.48], [cx - 30, h * 0.66]], 2); pencil(g, [[cx + 22, h * 0.27], [cx + 34, h * 0.48], [cx + 30, h * 0.66]], 2);
      // head: big black compound eyes, feathery antennae
      ellipse(g, cx, h * 0.2, 20, 22, 3);
      g.save(); g.fillStyle = '#151515';
      [-1, 1].forEach(sd => { g.beginPath(); g.ellipse(cx + sd * 11, h * 0.195, 9, 12, 0, 0, 7); g.fill(); });
      g.restore();
      [-1, 1].forEach(sd => {
        pencil(g, [[cx + sd * 6, h * 0.165], [cx + sd * 25, h * 0.09], [cx + sd * 55, h * 0.06]], 2, 1.5);
        for (let i = 1; i < 7; i++) { const x = cx + sd * (6 + i * 7), y = h * (0.165 - i * 0.015); pencil(g, [[x, y], [x + sd * 4, y - 9]], 1, 1); }
      });
      // tiny flashlight beam doodle + mechanic warning
      pencil(g, [[w * 0.08, h * 0.88], [w * 0.14, h * 0.84], [w * 0.16, h * 0.88], [w * 0.10, h * 0.92]], 2, 1, true);
      pencil(g, [[w * 0.15, h * 0.85], [w * 0.34, h * 0.72]], 1, 1.5);
      pencil(g, [[w * 0.16, h * 0.88], [w * 0.36, h * 0.86]], 1, 1.5);
      g.save();
      g.fillStyle = '#9e1c16'; g.font = `24px ${HAND}`; g.fillText("don't stare!", w * 0.06, h * 0.73);
      g.fillStyle = '#333'; g.font = `22px ${HAND}`; g.fillText('keep moving', w * 0.62, h * 0.82);
      g.fillText('dark only...', w * 0.64, h * 0.88);
      g.restore();
    },
    exposure(g, w, h) {
      // a viewfinder with a blurred figure inside
      const c = (x, y, dx, dy) => pencil(g, [[x + dx * 40, y], [x, y], [x, y + dy * 40]], 3);
      c(w * 0.12, h * 0.1, 1, 1); c(w * 0.88, h * 0.1, -1, 1); c(w * 0.12, h * 0.9, 1, -1); c(w * 0.88, h * 0.9, -1, -1);
      g.save(); g.filter = 'blur(3px)';
      g.fillStyle = 'rgba(40,40,40,0.75)';
      g.beginPath(); g.ellipse(w / 2, h * 0.3, 26, 34, 0, 0, 7); g.fill();
      g.fillRect(w / 2 - 30, h * 0.36, 60, h * 0.42);
      g.restore();
      for (let i = 0; i < 5; i++) ellipse(g, w / 2, h * 0.3, 26 + i * 3, 34 + i * 3, 1);
      // downward arrow + camera mechanic note
      pencil(g, [[w * 0.77, h * 0.66], [w * 0.77, h * 0.79]], 2, 1.5);
      pencil(g, [[w * 0.73, h * 0.74], [w * 0.77, h * 0.80], [w * 0.81, h * 0.74]], 2, 1.5);
      g.save();
      g.fillStyle = '#b22'; g.font = `24px ${HAND}`; g.fillText('REC', w * 0.16, h * 0.18);
      g.fillText('10s!', w * 0.70, h * 0.22);
      g.fillStyle = '#333'; g.font = `23px ${HAND}`;
      g.fillText('lower cam!', w * 0.61, h * 0.62);
      g.fillText('use light', w * 0.15, h * 0.84);
      g.restore();
    },
    sneaky(g, w, h) {
      const cx = w / 2, cy = h * 0.48;
      // dark hatching cloud around the floating eyes and smile
      hatch(g, w * 0.14, h * 0.18, w * 0.86, h * 0.78, 180, 0.7);
      hatch(g, w * 0.2, h * 0.24, w * 0.8, h * 0.72, 140, 2.3);
      // two narrow pale glowing eyes
      g.save();
      g.fillStyle = '#faf6e8';
      [-1, 1].forEach(d => {
        g.beginPath(); g.ellipse(cx + d * 64, cy - 52, 32, 13, d * -0.06, 0, 7); g.fill();
      });
      // wide grin from cheek to cheek with jagged teeth
      g.beginPath();
      g.moveTo(cx - 135, cy + 12);
      g.quadraticCurveTo(cx, cy + 135, cx + 135, cy + 12);
      g.quadraticCurveTo(cx, cy + 64, cx - 135, cy + 12);
      g.fill();
      g.restore();
      [-1, 1].forEach(d => ellipse(g, cx + d * 64, cy - 52, 33, 14, 2));
      for (let i = -5; i <= 5; i++) {
        const tx = cx + i * 22, ty = cy + 44 + (1 - (i * i) / 36) * 28;
        pencil(g, [[tx, ty - 16], [tx, ty + 14]], 2, 1.5);
      }
      // curved turn-around arrow & light-flicker note
      pencil(g, [[w * 0.76, h * 0.14], [w * 0.85, h * 0.12], [w * 0.88, h * 0.20], [w * 0.80, h * 0.23]], 2, 1.5);
      pencil(g, [[w * 0.84, h * 0.19], [w * 0.79, h * 0.24], [w * 0.85, h * 0.26]], 2, 1.5);
      g.save();
      g.fillStyle = '#333'; g.font = `24px ${HAND}`; g.fillText('light flickers...', w * 0.07, h * 0.14);
      g.fillStyle = '#9e1c16'; g.font = `26px ${HAND}`; g.fillText('turn around!', w * 0.45, h * 0.89);
      g.fillStyle = '#333'; g.font = `22px ${HAND}`; g.fillText('2.5s...', w * 0.10, h * 0.89);
      g.restore();
    },
    fastone(g, w, h) {
      // faint afterimage echo outline trailing behind the hound
      g.save();
      g.strokeStyle = 'rgba(155, 35, 30, 0.35)'; g.lineWidth = 2.5;
      pencil(g, [[w * 0.13, h * 0.49], [w * 0.42, h * 0.43], [w * 0.47, h * 0.53], [w * 0.15, h * 0.56]], 1, 2, true);
      pencil(g, [[w * 0.42, h * 0.43], [w * 0.54, h * 0.36], [w * 0.67, h * 0.39], [w * 0.53, h * 0.46]], 1, 2, true);
      g.restore();
      // speed streaks
      for (let i = 0; i < 6; i++) {
        const y = h * (0.36 + i * 0.055);
        pencil(g, [[w * 0.04, y], [w * 0.22, y]], 2, 2);
      }
      // body & waist
      pencil(g, [[w * 0.24, h * 0.48], [w * 0.56, h * 0.42], [w * 0.62, h * 0.53], [w * 0.26, h * 0.56]], 3, 3, true);
      hatch(g, w * 0.26, h * 0.45, w * 0.58, h * 0.55, 65, 0.8);
      // spine spikes
      for (let i = 0; i < 5; i++) {
        const sx = w * (0.29 + i * 0.06), sy = h * (0.47 - i * 0.01);
        pencil(g, [[sx - 8, sy], [sx - 12, sy - 22], [sx + 6, sy - 2]], 2, 2);
      }
      // canine skull, ears, open fanged jaws
      pencil(g, [[w * 0.56, h * 0.42], [w * 0.68, h * 0.34], [w * 0.88, h * 0.37], [w * 0.72, h * 0.44]], 3, 2, true);
      pencil(g, [[w * 0.62, h * 0.46], [w * 0.84, h * 0.54], [w * 0.65, h * 0.52]], 3, 2, true);
      pencil(g, [[w * 0.58, h * 0.39], [w * 0.50, h * 0.26], [w * 0.65, h * 0.35]], 3, 2);
      for (let i = 0; i < 4; i++) {
        const fx = w * (0.72 + i * 0.036);
        pencil(g, [[fx, h * 0.42], [fx + 2, h * 0.46]], 2, 1);
        pencil(g, [[fx - 2, h * 0.50], [fx, h * 0.47]], 2, 1);
      }
      g.save(); g.fillStyle = '#b41b15'; g.beginPath(); g.ellipse(w * 0.70, h * 0.38, 9, 5, -0.2, 0, 7); g.fill(); g.restore();
      // 4 legs & whip tail
      pencil(g, [[w * 0.58, h * 0.52], [w * 0.68, h * 0.66], [w * 0.78, h * 0.78]], 3);
      pencil(g, [[w * 0.52, h * 0.52], [w * 0.48, h * 0.68], [w * 0.54, h * 0.80]], 3);
      pencil(g, [[w * 0.28, h * 0.54], [w * 0.18, h * 0.68], [w * 0.12, h * 0.80]], 3);
      pencil(g, [[w * 0.34, h * 0.54], [w * 0.32, h * 0.69], [w * 0.26, h * 0.80]], 3);
      pencil(g, [[w * 0.24, h * 0.49], [w * 0.12, h * 0.42], [w * 0.06, h * 0.32]], 3);
      // tiny blue locker doodle + broken fence plank + mechanic annotations
      g.save();
      g.strokeStyle = '#1f5b99'; g.lineWidth = 3;
      pencil(g, [[w * 0.74, h * 0.12], [w * 0.88, h * 0.12], [w * 0.88, h * 0.28], [w * 0.74, h * 0.28]], 2, 1.5, true);
      pencil(g, [[w * 0.77, h * 0.16], [w * 0.85, h * 0.16]], 1, 1);
      pencil(g, [[w * 0.77, h * 0.19], [w * 0.85, h * 0.19]], 1, 1);
      g.fillStyle = '#1f5b99'; g.font = `26px ${HAND}`; g.fillText('6s!', w * 0.08, h * 0.16);
      g.font = `23px ${HAND}`; g.fillText('hide!', w * 0.61, h * 0.22);
      g.fillStyle = '#333'; g.fillText('broken fence...', w * 0.07, h * 0.24);
      g.fillStyle = '#9e1c16'; g.fillText('adrenaline x2', w * 0.50, h * 0.91);
      g.restore();
    },
  };

  // ---------------- the tape that plays on the TV ----------------
  function fig(g, x, y, s, col) {              // little stick person
    g.strokeStyle = col || '#ddd'; g.lineWidth = 2 * s;
    g.beginPath(); g.arc(x, y - 30 * s, 5 * s, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(x, y - 25 * s); g.lineTo(x, y - 10 * s);
    g.moveTo(x, y - 10 * s); g.lineTo(x - 5 * s, y); g.moveTo(x, y - 10 * s); g.lineTo(x + 5 * s, y);
    g.moveTo(x, y - 21 * s); g.lineTo(x - 6 * s, y - 14 * s); g.moveTo(x, y - 21 * s); g.lineTo(x + 6 * s, y - 14 * s); g.stroke();
  }
  function caption(g, W, H, text) {
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, H - 30, W, 30);
    g.fillStyle = '#f2f2e6'; g.font = 'bold 15px Courier New, monospace'; g.textAlign = 'center';
    g.fillText(text, W / 2, H - 10); g.textAlign = 'left';
  }
  const TAPES = {
    siren(g, W, H, T) {
      g.fillStyle = '#20251f'; g.fillRect(0, H * 0.72, W, H);
      // car to hide behind
      g.fillStyle = '#3a3f3a'; g.fillRect(W * 0.18, H * 0.6, 70, 26);
      const moving = T < 2.2;
      fig(g, W * 0.12 + (moving ? T * 22 : 48), H * 0.72, 1);
      if (moving) { g.strokeStyle = '#ff6'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W * 0.12 + T * 22, H * 0.62, 10 + i * 8 + (T * 30) % 8, -0.7, 0.7); g.stroke(); } }
      // the giant walks past
      const sx = W * 1.15 - Math.max(0, T - 1) * W * 0.16;
      g.strokeStyle = '#0a0a0a'; g.lineWidth = 4; g.fillStyle = '#0a0a0a';
      g.fillRect(sx - 2, H * 0.12, 4, H * 0.25);
      g.beginPath(); g.moveTo(sx, H * 0.12); g.lineTo(sx - 26, H * 0.06); g.lineTo(sx - 26, H * 0.18); g.fill();
      g.beginPath(); g.moveTo(sx, H * 0.12); g.lineTo(sx + 26, H * 0.06); g.lineTo(sx + 26, H * 0.18); g.fill();
      g.fillRect(sx - 12, H * 0.36, 24, H * 0.16);
      const st = Math.sin(T * 4) * 10;
      g.beginPath(); g.moveTo(sx - 6, H * 0.52); g.lineTo(sx - 8 + st, H * 0.73); g.moveTo(sx + 6, H * 0.52); g.lineTo(sx + 8 - st, H * 0.73); g.stroke();
      caption(g, W, H, moving ? 'HE HEARS EVERY STEP...' : 'STAY ABSOLUTELY SILENT');
    },
    tenant(g, W, H, T) {
      g.fillStyle = '#2a2d30'; g.fillRect(W * 0.36, H * 0.12, W * 0.28, H * 0.6);
      g.fillStyle = '#111'; for (let i = 0; i < 7; i++) g.fillRect(W * 0.39, H * (0.2 + i * 0.06), W * 0.22, 4);
      const k = Math.min(1, T / 4.5);
      g.save(); g.translate(W * 0.5, H * 0.38); g.scale(0.4 + k * 1.1, 0.4 + k * 1.1);
      g.globalAlpha = 0.3 + k * 0.7;
      g.fillStyle = '#c21b12'; g.beginPath(); g.ellipse(0, 0, 18, 8, 0, 0, 7); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, 0, 2.5, 7, 0, 0, 7); g.fill();
      g.restore();
      if (T > 3.6) fig(g, W * 0.72 + (T - 3.6) * 25, H * 0.74, 1);
      caption(g, W, H, T > 3.6 ? 'GET OUT BEFORE IT REACHES YOU' : 'IT IS ALREADY IN THERE');
    },
    silent(g, W, H, T) {
      g.fillStyle = '#1d2020'; g.fillRect(0, H * 0.74, W, H);
      fig(g, W * 0.3, H * 0.74, 1);
      if (T < 3) { g.strokeStyle = 'rgba(200,200,190,0.5)'; for (let i = 0; i < 6; i++) { const x = (T * 120 + i * 60) % W; g.beginPath(); g.moveTo(x, H * (0.2 + i * 0.08)); g.lineTo(x + 30, H * (0.2 + i * 0.08)); g.stroke(); } }
      if (T > 3 && T < 6) {
        const k = (T - 3) / 2.5;
        g.globalAlpha = Math.min(1, k);
        g.fillStyle = '#cfcac0';
        const fx = W * 0.85 - k * W * 0.35;
        g.beginPath(); g.ellipse(fx, H * 0.3, 8, 11, 0, 0, 7); g.fill();
        g.fillRect(fx - 7, H * 0.36, 14, H * 0.38);
        g.globalAlpha = 1;
      }
      if (T > 5.5 && T < 6.4) { g.fillStyle = 'rgba(255,250,200,0.35)'; g.beginPath(); g.moveTo(W * 0.32, H * 0.6); g.lineTo(W, H * 0.35); g.lineTo(W, H * 0.8); g.fill(); }
      caption(g, W, H, T < 3 ? 'THE WIND STOPS...' : T < 5.5 ? 'IT LOVES THE SILENCE' : 'MAKE A SMALL SOUND');
    },
    moth(g, W, H, T) {
      g.fillStyle = '#121414'; g.fillRect(0, 0, W, H);
      const mx = W * 0.62;
      const sweep = Math.sin(T * 1.6) * 0.9;
      const ang = sweep * 0.6 - 0.15;
      g.save(); g.translate(W * 0.08, H * 0.82);
      g.fillStyle = 'rgba(255,245,210,0.28)';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(ang - 0.12) * W, Math.sin(ang - 0.12) * W - H * 0.35); g.lineTo(Math.cos(ang + 0.12) * W, Math.sin(ang + 0.12) * W - H * 0.35); g.fill();
      g.restore();
      const lit = Math.abs(sweep) < 0.25;
      if (lit) {
        // patterned wings with eyespots
        [-1, 1].forEach(sd => {
          g.fillStyle = 'rgba(160,145,120,0.9)';
          g.beginPath(); g.moveTo(mx, H * 0.36); g.lineTo(mx + sd * 34, H * 0.26); g.lineTo(mx + sd * 40, H * 0.4); g.lineTo(mx + sd * 22, H * 0.56); g.fill();
          g.fillStyle = '#2a1c14'; g.beginPath(); g.arc(mx + sd * 26, H * 0.36, 4, 0, 7); g.fill();
        });
        g.fillStyle = '#d8d0c0';
        g.fillRect(mx - 6, H * 0.35, 12, H * 0.38);
        g.beginPath(); g.ellipse(mx, H * 0.3, 7, 9, 0, 0, 7); g.fill();
        g.fillStyle = '#0c0808'; [-1, 1].forEach(sd => { g.beginPath(); g.ellipse(mx + sd * 3.5, H * 0.3, 3, 4, 0, 0, 7); g.fill(); });
        g.strokeStyle = '#d8d0c0'; g.lineWidth = 1.5;
        [-1, 1].forEach(sd => { g.beginPath(); g.moveTo(mx + sd * 2, H * 0.27); g.quadraticCurveTo(mx + sd * 8, H * 0.19, mx + sd * 16, H * 0.18); g.stroke(); });
      }
      caption(g, W, H, 'KEEP THE BEAM MOVING — NEVER STARE');
    },
    sneaky(g, W, H, T) {
      g.fillStyle = '#121414'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1d2020'; g.fillRect(0, H * 0.74, W, H);
      const turned = T > 3.2;
      fig(g, W * 0.45, H * 0.74, 1);
      // flickering torch beam ahead of the player
      if (!turned && Math.random() > 0.3) { g.fillStyle = 'rgba(255,245,210,0.25)'; g.beginPath(); g.moveTo(W * 0.47, H * 0.6); g.lineTo(W, H * 0.45); g.lineTo(W, H * 0.75); g.fill(); }
      // the eyes and grin behind them
      const a = Math.min(1, T / 1.5) * (turned ? Math.max(0, 1 - (T - 3.2) * 3) : 1);
      g.globalAlpha = a; g.fillStyle = '#f4f0dc';
      g.beginPath(); g.ellipse(W * 0.27, H * 0.33, 5, 2.5, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(W * 0.33, H * 0.33, 5, 2.5, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(W * 0.24, H * 0.39); g.quadraticCurveTo(W * 0.3, H * 0.47, W * 0.36, H * 0.39); g.quadraticCurveTo(W * 0.3, H * 0.43, W * 0.24, H * 0.39); g.fill();
      g.globalAlpha = 1;
      caption(g, W, H, turned ? 'TURN AROUND IN TIME' : 'THE LIGHT FLICKERS... BREATHING');
    },
    exposure(g, W, H, T) {
      g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
      const up = T < 4;
      if (up) {
        g.strokeStyle = '#eee'; g.lineWidth = 3;
        [[0.12, 0.12, 1, 1], [0.88, 0.12, -1, 1], [0.12, 0.82, 1, -1], [0.88, 0.82, -1, -1]].forEach(([x, y, dx, dy]) => {
          g.beginPath(); g.moveTo(W * x + dx * 24, H * y); g.lineTo(W * x, H * y); g.lineTo(W * x, H * y + dy * 24); g.stroke();
        });
        g.fillStyle = '#f33'; g.font = '13px Courier New'; g.fillText('● REC', W * 0.15, H * 0.2);
        const k = T / 4;
        g.save(); g.filter = `blur(${4 - k * 2}px)`; g.fillStyle = `rgba(200,195,185,${0.3 + k * 0.5})`;
        g.beginPath(); g.ellipse(W / 2, H * (0.4 - k * 0.05), 10 + k * 18, 13 + k * 22, 0, 0, 7); g.fill();
        g.fillRect(W / 2 - (9 + k * 16), H * (0.46 - k * 0.04), 18 + k * 32, H * 0.3 + k * 40);
        g.restore();
      } else {
        g.fillStyle = 'rgba(255,245,210,0.3)';
        g.beginPath(); g.moveTo(W * 0.1, H * 0.85); g.lineTo(W * 0.9, H * 0.2); g.lineTo(W * 0.95, H * 0.6); g.fill();
        fig(g, W * 0.1, H * 0.85, 1);
      }
      caption(g, W, H, up ? 'IT CREEPS CLOSER IN THE LENS...' : 'LOWER IT. USE YOUR FLASHLIGHT');
    },
    fastone(g, W, H, T) {
      // screen shake during the locker slam impact
      const slamming = T >= 4.15 && T < 5.15;
      const slamK = slamming ? Math.max(0, 1 - (T - 4.15) / 1.0) : 0;
      const shx = slamming ? Math.sin(T * 75) * 4 * slamK : 0;
      const shy = slamming ? Math.cos(T * 62) * 3 * slamK : 0;
      g.save();
      g.translate(shx, shy);
      g.fillStyle = '#141616'; g.fillRect(-6, -6, W + 12, H + 12);
      g.fillStyle = '#1d2020'; g.fillRect(-6, H * 0.74, W + 12, H);

      // perimeter fence on far left (breaks when T > 0.35)
      const fx = W * 0.08;
      if (T < 0.35 || T > 6.4) {
        g.fillStyle = '#3e3932';
        g.fillRect(fx, H * 0.48, 5, H * 0.26);
        g.fillRect(fx + 10, H * 0.49, 5, H * 0.25);
        g.fillRect(fx - 4, H * 0.54, 24, 3);
        g.fillRect(fx - 4, H * 0.65, 24, 3);
      } else if (T < 1.3 || (T > 5.75 && T < 6.4)) {
        // flying splinters on breach / exit breach
        const spT = T < 1.3 ? T - 0.35 : T - 5.75;
        g.fillStyle = '#5a5044';
        for (let i = 0; i < 6; i++) {
          const sx = fx + (T < 1.3 ? 1 : -1) * spT * (40 + i * 18);
          const sy = H * 0.56 - Math.sin(Math.min(1, spT) * Math.PI) * (14 + (i % 3) * 10) + spT * 28;
          g.fillRect(sx, sy, 8, 3);
        }
      }

      // blue-highlighted locker on the right (tilts & rattles on impact)
      const lx = W * 0.74, ly = H * 0.35, lw = W * 0.14, lh = H * 0.39;
      const lockTilt = slamming ? Math.sin((T - 4.15) * 32) * 0.09 * slamK : 0;
      g.save();
      g.translate(lx + lw / 2, ly + lh);
      g.rotate(lockTilt);
      g.translate(-(lx + lw / 2), -(ly + lh));
      const pulse = 0.6 + 0.4 * Math.sin(T * 8);
      g.fillStyle = '#2c3135'; g.fillRect(lx, ly, lw, lh);
      // locker slats
      g.fillStyle = '#141719';
      for (let i = 0; i < 5; i++) g.fillRect(lx + 6, ly + 10 + i * 8, lw - 12, 3);
      // swinging door open slightly as player dives in (T 2.7..3.45)
      if (T >= 2.7 && T < 3.45) {
        const op = T < 3.1 ? (T - 2.7) / 0.4 : 1 - (T - 3.1) / 0.35;
        g.fillStyle = '#121518'; g.fillRect(lx + 2, ly + 4, lw - 4, lh - 6);
        g.fillStyle = '#383e44'; g.fillRect(lx - op * 14, ly + 2, 10, lh - 4);
      }
      g.strokeStyle = `rgba(56, 170, 255, ${T < 5.5 ? 0.55 + pulse * 0.45 : 0.25})`;
      g.lineWidth = 3;
      g.strokeRect(lx - 3, ly - 3, lw + 6, lh + 6);
      g.restore();

      // stick figure sprinting into the locker
      if (T < 3.35) {
        const k = Math.min(1, T / 3.15);
        const px = W * 0.26 + k * (W * 0.48);
        // bobbing sprint stride + adrenaline speed streaks
        const bob = Math.abs(Math.sin(T * 18)) * 3;
        fig(g, px, H * 0.74 - bob, 1);
        g.strokeStyle = 'rgba(140,220,255,0.65)'; g.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(px - 12 - i * 8, H * (0.56 + i * 0.05));
          g.lineTo(px - 26 - i * 8, H * (0.56 + i * 0.05));
          g.stroke();
        }
      }

      // fast hound silhouette helper (supports facing, crouch/rear-up angle, fanged jaw)
      const drawHound = (cx, cy, dir, pitch, jawOpen, alpha, redTint) => {
        g.save();
        g.translate(cx, cy);
        g.scale(dir, 1);
        g.rotate(pitch);
        g.globalAlpha = alpha;
        g.fillStyle = redTint ? '#8c1919' : '#0f0e0e';
        // low torso + spine spikes
        g.fillRect(-18, -7, 32, 11);
        for (let i = 0; i < 4; i++) {
          g.beginPath(); g.moveTo(-14 + i * 7, -7); g.lineTo(-16 + i * 7, -13); g.lineTo(-10 + i * 7, -7); g.fill();
        }
        // head & open jaw
        g.fillRect(10, -10, 14, 7);
        g.beginPath(); g.moveTo(14, -3); g.lineTo(25, -2 + jawOpen * 6); g.lineTo(14, 1 + jawOpen * 3); g.fill();
        // ears & legs
        g.beginPath(); g.moveTo(11, -10); g.lineTo(7, -16); g.lineTo(15, -10); g.fill();
        g.strokeStyle = redTint ? '#8c1919' : '#0f0e0e'; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(10, 3); g.lineTo(16, 13);
        g.moveTo(-14, 3); g.lineTo(-20, 13);
        g.stroke();
        // glowing red eye
        g.fillStyle = '#ff3b22';
        g.fillRect(16, -8, 4, 2.5);
        g.restore();
      };

      // hound timeline: breach/chase (0..3.6) -> rear-up & locker slam (3.6..5.35) -> exit dash (5.35..8)
      if (T >= 0.35 && T < 3.6) {
        const k = (T - 0.35) / 3.25;
        const hx = W * 0.04 + k * (W * 0.60);
        for (let i = 3; i >= 1; i--) {
          drawHound(hx - i * 16, H * 0.67, 1, 0, 0.4, 0.14 * (4 - i), true);
        }
        drawHound(hx, H * 0.67, 1, Math.sin(T * 22) * 0.08, 0.6, 1, false);
      } else if (T >= 3.6 && T < 5.35) {
        const hx = W * 0.67;
        let hy = H * 0.67, pitch = 0, jaw = 0.7;
        if (T < 4.08) {
          // rear up high against the locker!
          const rk = (T - 3.6) / 0.48;
          const e = rk * rk * (3 - 2 * rk);
          pitch = -0.92 * e;
          hy = H * 0.67 - e * 12;
          jaw = 0.4 + e * 0.6;
        } else if (T < 4.26) {
          // slam violently down into the door!
          const sk = (T - 4.08) / 0.18;
          const e = sk * sk;
          pitch = -0.92 + e * 1.12;
          hy = H * 0.67 - 12 + e * 11;
          jaw = 1.0 - e * 0.6;
        } else if (T < 5.05) {
          // rattle impact recoil
          const rk = (T - 4.26) / 0.79;
          pitch = 0.2 * (1 - rk);
          hy = H * 0.67;
          jaw = 0.3 + Math.abs(Math.sin(T * 26)) * 0.3;
        }
        drawHound(hx, hy, 1, pitch, jaw, 1, false);
        // impact sparks & SLAM! burst at the moment of collision
        if (T >= 4.18 && T < 4.65) {
          const ik = 1 - (T - 4.18) / 0.47;
          g.strokeStyle = `rgba(255,210,120,${ik})`;
          g.lineWidth = 2;
          for (let i = 0; i < 7; i++) {
            const a = -Math.PI * 0.65 + (i / 6) * Math.PI * 1.3;
            g.beginPath();
            g.moveTo(lx + Math.cos(a) * 6, H * 0.56 + Math.sin(a) * 6);
            g.lineTo(lx + Math.cos(a) * (18 + (1 - ik) * 14), H * 0.56 + Math.sin(a) * (18 + (1 - ik) * 14));
            g.stroke();
          }
          g.fillStyle = `rgba(255,95,70,${ik})`;
          g.font = 'bold 13px Courier New, monospace';
          g.fillText('SLAM!', lx - 36, H * 0.38 - (1 - ik) * 8);
        }
      } else if (T >= 5.35 && T < 6.7) {
        // dashes back out left and breaks out of the fence
        const k = (T - 5.35) / 1.35;
        const hx = W * 0.64 - k * (W * 0.76);
        for (let i = 3; i >= 1; i--) {
          drawHound(hx + i * 16, H * 0.67, -1, 0, 0.4, 0.14 * (4 - i), true);
        }
        drawHound(hx, H * 0.67, -1, Math.sin(T * 22) * 0.08, 0.5, 1, false);
      }

      g.restore();
      caption(g, W, H, T < 3.45 ? 'RUN FOR THE BLUE LOCKER!' : T < 5.35 ? 'WAIT OUT THE SLAM...' : 'IT BREAKS BACK OUT');
    },
  };

  // ============================================================
  function DeathRoom() {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    scene.fog = new THREE.Fog(0x020202, 3, 9);
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 30);

    const concrete = new THREE.MeshLambertMaterial({ map: LO.tex.get('concrete', { color: '#3a3836' }) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), concrete);
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshLambertMaterial({ map: LO.tex.get('concrete', { color: '#2c2b2a' }) }));
    wall.position.set(0, 3, -1.6); scene.add(wall);

    // table
    const wood = new THREE.MeshLambertMaterial({ map: LO.tex.get('wood') });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.3), wood);
    top.position.set(0, 0.78, -0.3); scene.add(top);
    [[-1.2, -0.85], [1.2, -0.85], [-1.2, 0.25], [1.2, 0.25]].forEach(([x, z]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), wood); l.position.set(x, 0.39, z); scene.add(l);
    });

    // CRT television
    const tv = this.tv = new THREE.Group();
    const plastic = new THREE.MeshLambertMaterial({ color: 0x1d1d1b });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.82, 0.8), plastic); body.position.z = -0.1; tv.add(body);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.86, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a3a37 }));
    bezel.position.z = 0.3; tv.add(bezel);
    this.tapeCanvas = document.createElement('canvas'); this.tapeCanvas.width = 320; this.tapeCanvas.height = 240;
    this.tapeTex = new THREE.CanvasTexture(this.tapeCanvas);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.58), new THREE.MeshBasicMaterial({ map: this.tapeTex }));
    screen.position.set(-0.08, 0.02, 0.335); tv.add(screen);
    // control panel + knobs
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.02), new THREE.MeshLambertMaterial({ color: 0x1c1c1a })); panel.position.set(0.42, 0, 0.335); tv.add(panel);
    [0.2, 0.05, -0.1].forEach(y => { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12), plastic); k.rotation.x = Math.PI / 2; k.position.set(0.42, y, 0.35); tv.add(k); });
    // name plate on top
    this.labelCanvas = document.createElement('canvas'); this.labelCanvas.width = 512; this.labelCanvas.height = 96;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    const plateBox = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.25), plastic); plateBox.position.set(0, 0.5, 0.05); tv.add(plateBox);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.11), new THREE.MeshBasicMaterial({ map: this.labelTex }));
    plate.position.set(0, 0.5, 0.181); tv.add(plate);
    tv.position.set(0.8, 1.22, -0.58); tv.rotation.y = -0.26;
    scene.add(tv);

    // notebook: the cover flips open to reveal a sketch (inside of cover) and tips (right page)
    const book = this.book = new THREE.Group();
    const BW = 0.62, BD = 0.82;
    this.sketchCanvas = document.createElement('canvas'); this.sketchCanvas.width = 512; this.sketchCanvas.height = 680;
    this.tipsCanvas = document.createElement('canvas'); this.tipsCanvas.width = 512; this.tipsCanvas.height = 680;
    this.sketchTex = new THREE.CanvasTexture(this.sketchCanvas);
    this.tipsTex = new THREE.CanvasTexture(this.tipsCanvas);
    const pageGeo = new THREE.PlaneGeometry(BW, BD);
    const right = new THREE.Mesh(pageGeo, new THREE.MeshBasicMaterial({ map: this.tipsTex, color: 0xf2ece0 }));
    right.rotation.x = -Math.PI / 2; right.position.set(BW / 2, 0.02, 0); book.add(right);
    const block = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.02, BD), new THREE.MeshBasicMaterial({ color: 0x9c9482 }));
    block.position.set(BW / 2, 0.009, 0); book.add(block);
    const pivot = this.coverPivot = new THREE.Group(); pivot.position.y = 0.03; book.add(pivot);
    const leather = new THREE.MeshBasicMaterial({ color: 0x2e1c12 });
    const front = new THREE.Mesh(pageGeo, leather); front.rotation.x = -Math.PI / 2; front.position.set(BW / 2, 0.002, 0); pivot.add(front);
    const back = new THREE.Mesh(pageGeo, new THREE.MeshBasicMaterial({ map: this.sketchTex, color: 0xf2ece0 }));
    back.rotation.x = Math.PI / 2; back.rotation.z = Math.PI; back.position.set(BW / 2, -0.002, 0); pivot.add(back);
    // held up in front of you, like someone is reading it to you
    scene.add(this.camera);
    this.camera.add(book);
    book.rotation.set(Math.PI / 2 - 0.12, 0.16, 0.04);

    // lights: weak overhead lamp and the TV's glow
    scene.add(new THREE.AmbientLight(0x404040, 0.25));
    const lamp = this.lamp = new THREE.SpotLight(0xffe2b0, 0.9, 7, 0.75, 0.6, 1.5);
    lamp.position.set(-0.6, 3.2, 0.6); lamp.target.position.set(-0.3, 0.8, -0.2);
    scene.add(lamp, lamp.target);
    const glow = this.glow = new THREE.PointLight(0x9fb6ff, 1.2, 4, 2);
    glow.position.set(0.45, 1.25, 0.2); scene.add(glow);
    this.t = 0;
  }
  LO.DeathRoom = DeathRoom;

  DeathRoom.prototype.show = function (cause) {
    this.cause = ENTRIES[cause] ? cause : 'siren';
    const E = ENTRIES[this.cause];
    this.t = 0;
    this.coverPivot.rotation.z = 0;
    // name plate
    let g = this.labelCanvas.getContext('2d');
    g.fillStyle = '#e8e6de'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#111'; g.textAlign = 'center';
    let fs = 54; g.font = `bold ${fs}px Arial`;
    while (g.measureText(E.label).width > 470 && fs > 20) { fs -= 2; g.font = `bold ${fs}px Arial`; }
    g.fillText(E.label, 256, 48 + fs * 0.36);
    this.labelTex.needsUpdate = true;
    // sketch page (inside the cover)
    g = this.sketchCanvas.getContext('2d');
    paper(g, 512, 680);
    g.strokeStyle = 'rgba(25,25,25,0.95)'; g.lineWidth = 4; g.lineCap = 'round';
    g.save(); g.translate(26, 60); (SKETCH[this.cause] || SKETCH.siren)(g, 460, 560); g.restore();
    g.fillStyle = '#333'; g.font = `34px ${HAND}`; g.fillText('fig. 1', 30, 650);
    this.sketchTex.needsUpdate = true;
    // tips page
    g = this.tipsCanvas.getContext('2d');
    paper(g, 512, 680);
    g.fillStyle = '#1b1b1b'; g.font = `bold 58px ${HAND}`; g.fillText(E.name, 34, 92);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, 104); g.lineTo(34 + g.measureText(E.name).width, 106); g.stroke();
    g.font = `bold 44px ${HAND}`;
    let y = 175;
    E.tips.forEach(t => {
      const lines = wrap(g, '- ' + t, 440);
      lines.forEach((l, i) => { g.fillText(l, i ? 58 : 34, y); y += 44; });
      y += 18;
    });
    this.tipsTex.needsUpdate = true;
  };

  function paper(g, w, h) {
    g.fillStyle = '#d9d1bc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = 'rgba(80,110,160,0.25)'; g.lineWidth = 1;
    for (let y = 130; y < h; y += 44) { g.beginPath(); g.moveTo(0, y + 10); g.lineTo(w, y + 10); g.stroke(); }
    const gr = g.createLinearGradient(0, 0, 30, 0); gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 30, h);
  }
  function wrap(g, text, maxW) {
    const words = text.split(' '), out = []; let line = '';
    words.forEach(w => { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; });
    if (line) out.push(line);
    return out;
  }

  // tExt: seconds into the death music, so the TV switches on exactly with the recorded click
  DeathRoom.prototype.update = function (dt, aspect, tExt) {
    if (tExt !== null && tExt !== undefined) this.t = tExt; else this.t += dt;
    const t = this.t;
    const TV_ON = LO.audio.DEATH_TV_ON || 2.31, TAPE = LO.audio.DEATH_TAPE || 3.3;
    // camera: a slow push-in toward the TV and notebook
    const k = Math.min(1, t / 6);
    const ease = 1 - Math.pow(1 - k, 3);
    this.camera.aspect = aspect; this.camera.fov = aspect < 1 ? 70 : 50; this.camera.updateProjectionMatrix();
    this.camera.position.set(-0.12 + Math.sin(t * 0.3) * 0.03, 1.85 - ease * 0.2, 2.0 - ease * 0.5);
    this.camera.lookAt(0.05, 1.1, -0.5);
    // the held notebook: big and to the left on wide screens, lower and centred on phones
    const portrait = aspect < 1;
    const bob = Math.sin(t * 1.3) * 0.006, sway = Math.sin(t * 0.8) * 0.012;
    if (portrait) { this.book.position.set(-0.02, -0.2 + bob, -0.9); this.book.scale.setScalar(0.62); }
    else { this.book.position.set(-0.32 + sway, 0.03 + bob, -0.92); this.book.scale.setScalar(0.62); }
    this.book.rotation.z = 0.04 + Math.sin(t * 0.9) * 0.01;
    // the notebook opens
    const o = Math.max(0, Math.min(1, (t - 1.2) / 1.3));
    this.coverPivot.rotation.z = (1 - Math.pow(1 - o, 3)) * Math.PI * 0.995;
    // TV picture: static, then the tape (with VHS wear)
    const g = this.tapeCanvas.getContext('2d'), W = 320, H = 240;
    if (t < TV_ON) {
      // the set is still off: a dead black screen with a faint reflection
      g.fillStyle = '#050606'; g.fillRect(0, 0, W, H);
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      this.glow.intensity = 0;
    } else if (t < TAPE || Math.random() < 0.012) {
      // switched on: a white flash that settles into static
      const flash = Math.max(0, 1 - (t - TV_ON) / 0.25);
      const id = g.createImageData(W, H);
      for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0);
      if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash})`; g.fillRect(0, 0, W, H); }
      this.glow.color.set(0xb0b8c8); this.glow.intensity = 0.9 + Math.random() * 0.6 + flash * 2;
    } else {
      const T = Math.max(0, t - TAPE) % 8;
      g.fillStyle = '#181a1c'; g.fillRect(0, 0, W, H);
      try { TAPES[this.cause](g, W, H, T); } catch (e) { /* drawing errors shouldn't break the menu */ }
      // VHS overlay
      for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, W, 1); }
      const band = ((t * 40) % (H + 40)) - 20;
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, band, W, 10);
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.18})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 1); }
      g.fillStyle = '#e8e8e8'; g.font = 'bold 14px Courier New, monospace';
      g.fillText('PLAY ▶', 10, 20);
      g.fillText('SP  0:0' + Math.floor(T) + ':' + String(Math.floor((T % 1) * 60)).padStart(2, '0'), W - 120, 20);
      this.glow.color.set(0x9fb6ff); this.glow.intensity = 1 + Math.sin(t * 13) * 0.08;
    }
    this.tapeTex.needsUpdate = true;
    this.lamp.intensity = 0.9 * (Math.random() < 0.01 ? 0.3 : 1);
  };

  DeathRoom.prototype.render = function (renderer) {
    renderer.render(this.scene, this.camera);
  };
})();
