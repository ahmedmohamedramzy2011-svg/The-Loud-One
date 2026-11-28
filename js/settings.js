// ============================================================
//  THE LOUD ONE — settings (graphics / audio / controls)
// ============================================================
window.LO = window.LO || {};

(function () {
  const KEY = 'theLoudOne.settings.v1';

  const PRESETS = {
    low:    { renderScale: 0.6,  shadows: 'off',  antialias: false, textures: 'low',  viewDistance: 'near',   lighting: 'simple' },
    medium: { renderScale: 0.85, shadows: 'off',  antialias: false, textures: 'high', viewDistance: 'medium', lighting: 'full' },
    high:   { renderScale: 1.0,  shadows: 'low',  antialias: true,  textures: 'high', viewDistance: 'far',    lighting: 'full' },
    ultra:  { renderScale: 1.25, shadows: 'high', antialias: true,  textures: 'high', viewDistance: 'far',    lighting: 'full' },
  };

  const DEFAULTS = Object.assign({
    quality: 'medium',
    fov: 75,
    brightness: 1.0,
    filmGrain: true,
    vignette: true,
    headBob: true,
    showFps: false,
    // audio
    master: 0.8, music: 0.6, sfx: 0.9, voice: 1.0, disableVoiceAttenuation: false, subtitles: true, tts: true,
    // controls
    sensitivity: 1.0, invertY: false,
    toggleVoiceKey: 'KeyX',
    micMutedPref: false,
    voiceAutoJoin: false,
    fastDeath: false,
    // playable version
    gameVersion: '2.8.3',
    autoLatest: '2.8.3',
  }, PRESETS.medium);

  const VERSIONS = [
    { id: '2.8.3', label: 'v2.8.3', era: 'Location reverb, unified Multiplayer, 3D proximity voice & text chat' },
    { id: '2.8.2', label: 'v2.8.2', era: 'Co-op disconnect/spectate fixes & synchronized Sneaky/Fast One waves' },
    { id: '2.8.1', label: 'v2.8.1', era: 'Rebalanced fall damage, falling HUD/camera telegraph & hazard death transition' },
    { id: '2.8',   label: 'v2.8',   era: 'Fall damage, open rooftops & clipping fixes' },
    { id: '2.7.7', label: 'v2.7.7', era: 'Bug fixes' },
    { id: '2.7.6', label: 'v2.7.6', era: '6 hazards, hazard death tapes, FPS optimization & Admin Panel' },
    { id: '2.7.5', label: 'v2.7.5', era: 'Camera strobe flash & 3 Town Map wall locations' },
    { id: '2.7.4', label: 'v2.7.4', era: 'Viewfinder lens flare, 12s panting audio & ending camera fix' },
    { id: '2.7.3', label: 'v2.7.3', era: 'Low-HP heartbeat pulse, Moth legs fix, Settings menu & Credits' },
    { id: '2.7.2', label: 'v2.7.2', era: 'Map POI labels, left-building map spawn, sealed seams & optimization' },
    { id: '2.7.1', label: 'v2.7.1', era: 'Collectible Town Survey Map with live tracking & breaches' },
    { id: '2.7',   label: 'v2.7',   era: 'Woodland Perimeter Ring, Lookout Tower & forest AI' },
    { id: '2.6.3', label: 'v2.6.3', era: '3D forest birds & reactive birdsong' },
    { id: '2.6.2', label: 'v2.6.2', era: 'Interior/camera bug fixes & machinery shake' },
    { id: '2.6.1', label: 'v2.6.1', era: '10 building presets, Sheriff HQ & stamina gradient' },
    { id: '2.6',   label: 'v2.6',   era: 'Multi-floor interiors, forest audio & performance pass' },
    { id: '2.5.1', label: 'v2.5.1', era: 'Flashlight sway, color-coded subtitles & title polish' },
    { id: '2.5',   label: 'v2.5',   era: 'Dispatcher audio, locker slits, 2x stamina & foliage' },
    { id: '2.4.5', label: 'v2.4.5', era: 'Roadblocks, intro barricade ramming & fence collisions' },
    { id: '2.4.4', label: 'v2.4.4', era: 'Clearer footprint, Fast One cooldown & random Sheriff HQ' },
    { id: '2.4.3', label: 'v2.4.3', era: 'Fast One breach telegraph, adrenaline & dumpsters' },
    { id: '2.4.2', label: 'v2.4.2', era: 'Version switcher, death room sketches & CRT upgrade' },
    { id: '2.4.1', label: 'v2.4.1', era: 'Siren Head building demolition & geometry pass' },
    { id: '2.4',   label: 'v2.4',   era: 'The Fast One (Phenomenon-242) & balance changes' },
    { id: '2.3',   label: 'v2.3',   era: 'Remodeled props, vehicles & hiding animations' },
    { id: '2.2',   label: 'v2.2',   era: 'The Sneaky One & 24 faster Moths' },
    { id: '2.1',   label: 'v2.1',   era: 'Death Room TV, voice lines & Tenant rework' },
    { id: '2.0',   label: 'v2.0',   era: 'The Exposure & 3D Death Room' },
    { id: '1.9',   label: 'v1.9',   era: 'The Moths' },
    { id: '1.8',   label: 'v1.8',   era: 'Echolocation, throwable rocks & wind stillness' },
    { id: '1.6',   label: 'v1.6',   era: 'Wind atmosphere' },
    { id: '1.5',   label: 'v1.5',   era: 'Health bar & The Silent One' },
    { id: '1.4',   label: 'v1.4',   era: 'The Tenant & faster Siren Head' },
    { id: '1.3',   label: 'v1.3',   era: 'Hint system & darker lighting' },
    { id: '1.0',   label: 'v1.0',   era: 'Original release (Siren Head only)' },
  ];

  function verNum(id) {
    const parts = String(id || '2.4.4').split('.').map(n => parseInt(n, 10) || 0);
    return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  }

  function versionFeatures(id) {
    const v = verNum(id || S.gameVersion);
    return {
      id: id || S.gameVersion || '2.4.4',
      hint: v >= 10300,
      darkLight: v >= 10300,
      tenant: v >= 10400,
      sirenFast: v >= 10400,
      health: v >= 10500,
      silent: v >= 10500,
      wind: v >= 10600,
      windStillness: v >= 10800,
      rocks: v >= 10800,
      echo: v >= 10800,
      moths: v >= 10900,
      exposure: v >= 20000,
      deathRoom: v >= 20000,
      tenantBlind: v >= 20100,
      fastDeathAllowed: v >= 20100,
      sneaky: v >= 20200,
      fastMoths: v >= 20200,
      mothCount: v >= 20200 ? 24 : 12,
      mothLimit: v >= 20200 ? 1.0 : 2.0,
      mothDamage: v >= 20200 ? 20 : 10,
      fastone: v >= 20400,
      silentDamage: v >= 20400 ? 10 : 5,
      tenantCost: v >= 20400 ? 90 : 95,
      sirenSmash: v >= 20401,
      fastoneV2: v >= 20403,
      fastoneCooldown: v >= 20404,
      randomSheriff: v >= 20404,
      clearFootprint: v >= 20404,
      staminaBuff: v >= 20500,
      flashSway: v >= 20501,
      dynamicSubs: v >= 20501,
      proximityAmbient: v >= 20600,
      richInteriors: v >= 20600,
      cleanSubs: v >= 20600,
      extBirdsong: v >= 20602,
      envShake: v >= 20602,
      forestBirds: v >= 20603,
      birdFade: v >= 20603,
      forestRing: v >= 20700,
      echoClosePause: v >= 20700,
      townMap: v >= 20701,
      leftBuildingMap: v >= 20702,
      viewfinderFlare: v >= 20704,
      panting: v >= 20704,
      photoStrobe: v >= 20705,
      mapThreeSpots: v >= 20705,
      hazards: v >= 20706,
      perfOpt276: v >= 20706,
      fallDamage: v >= 20800,
      reverb: v >= 20803,
    };
  }

  const LATEST_VER = VERSIONS[0].id;
  const S = Object.assign({}, DEFAULTS);
  let loadedAuto = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      loadedAuto = parsed.autoLatest;
      Object.assign(S, parsed);
    }
  } catch (e) { /* storage unavailable — defaults are fine */ }
  if (loadedAuto !== 'pinned' && (S.gameVersion === '2.4.3' || S.gameVersion === '2.4.4' || S.gameVersion === '2.4.5' || S.gameVersion === '2.5' || S.gameVersion === '2.5.1' || S.gameVersion === '2.6' || S.gameVersion === '2.6.1' || S.gameVersion === '2.6.2' || S.gameVersion === '2.6.3' || S.gameVersion === '2.7' || S.gameVersion === '2.7.1' || S.gameVersion === '2.7.2' || S.gameVersion === '2.7.3' || S.gameVersion === '2.7.4' || S.gameVersion === '2.7.5' || S.gameVersion === '2.7.6' || S.gameVersion === '2.7.7' || S.gameVersion === '2.8' || S.gameVersion === '2.8.1' || S.gameVersion === '2.8.2' || S.gameVersion === loadedAuto)) {
    S.gameVersion = LATEST_VER;
    S.autoLatest = LATEST_VER;
  }
  if (!VERSIONS.some(x => x.id === S.gameVersion)) S.gameVersion = LATEST_VER;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  // Option definitions drive the menu UI.
  // type: 'choice' (values/labels) or 'range' (min/max/step/format)
  const GRAPHICS_OPTIONS = [
    { section: 'PRESET' },
    { key: 'quality', label: 'Graphics Quality', desc: 'Sets everything below at once', type: 'choice',
      values: ['low', 'medium', 'high', 'ultra', 'custom'], labels: ['Low', 'Medium', 'High', 'Ultra', 'Custom'] },
    { section: 'DISPLAY' },
    { key: 'renderScale', label: 'Resolution Scale', type: 'choice', custom: true,
      values: [0.5, 0.6, 0.75, 0.85, 1.0, 1.25, 1.5], labels: ['50%', '60%', '75%', '85%', '100%', '125%', '150%'] },
    { key: 'antialias', label: 'Anti-Aliasing', type: 'choice', custom: true, values: [false, true], labels: ['Off', 'On'] },
    { key: 'fov', label: 'Field of View', type: 'range', min: 55, max: 105, step: 1, fmt: v => v + '°' },
    { key: 'brightness', label: 'Brightness', desc: 'Raise this if you cannot see anything', type: 'range', min: 0.5, max: 2.0, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { section: 'QUALITY' },
    { key: 'shadows', label: 'Shadows', type: 'choice', custom: true, values: ['off', 'low', 'high'], labels: ['Off', 'Low', 'High'] },
    { key: 'textures', label: 'Texture Detail', type: 'choice', custom: true, values: ['low', 'high'], labels: ['Low', 'High'] },
    { key: 'lighting', label: 'Lighting Model', desc: 'Simple is faster, Full is physically based', type: 'choice', custom: true, values: ['simple', 'full'], labels: ['Simple', 'Full'] },
    { key: 'viewDistance', label: 'View Distance', type: 'choice', custom: true, values: ['near', 'medium', 'far'], labels: ['Near', 'Medium', 'Far'] },
    { section: 'EFFECTS' },
    { key: 'filmGrain', label: 'Film Grain', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'vignette', label: 'Vignette', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'headBob', label: 'Head Bob', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'showFps', label: 'Show FPS', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
  ];

  function formatKeyCode(code) {
    const c = String(code || 'KeyX');
    if (c.startsWith('Key') && c.length === 4) return c.slice(3);
    if (c.startsWith('Digit') && c.length === 6) return c.slice(5);
    if (c.startsWith('Numpad')) return 'Num ' + c.slice(6);
    const map = {
      Space: 'Space', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Backspace',
      ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
      AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    };
    return map[c] || c;
  }

  const AUDIO_OPTIONS = [
    { section: 'VOLUME' },
    { key: 'master', label: 'Master', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'music', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'sfx', label: 'Sound Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'voice', label: 'Voices', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'disableVoiceAttenuation', label: 'Disable 3D Voice Attenuation', desc: 'Keep voice chat volume constant regardless of distance', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'tts', label: 'Spoken Voice Lines', desc: 'Off shows subtitles only', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'subtitles', label: 'Subtitles', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { section: 'GAMEPLAY' },
    { key: 'fastDeath', label: 'Fast Death', desc: 'Shorter death sequence before the death screen', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { section: 'CONTROLS' },
    { key: 'sensitivity', label: 'Mouse Sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) + 'x' },
    { key: 'invertY', label: 'Invert Y', type: 'choice', values: [false, true], labels: ['Off', 'On'] },
    { key: 'toggleVoiceKey', label: 'Toggle Voice', desc: 'Mute/unmute your microphone globally across matches', type: 'keybind' },
  ];

  function set(key, value) {
    S[key] = value;
    if (key === 'quality' && PRESETS[value]) Object.assign(S, PRESETS[value]);
    else {
      const def = GRAPHICS_OPTIONS.find(o => o.key === key);
      if (def && def.custom) {
        // if values no longer match a preset, mark custom
        const match = Object.keys(PRESETS).find(p =>
          Object.keys(PRESETS[p]).every(k => PRESETS[p][k] === S[k]));
        S.quality = match || 'custom';
      }
    }
    save();
    LO.events && LO.events.dispatchEvent(new CustomEvent('settings', { detail: { key, value } }));
  }

  const ADMIN_AUTH_KEY = 'theLoudOne.adminAuth.v1';

  function getAdminAuth() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(ADMIN_AUTH_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.authorized === true && typeof parsed.token === 'string' && parsed.token.length > 0) {
        return { authorized: true, token: parsed.token };
      }
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function setAdminAuth(token) {
    const clean = typeof token === 'string' ? token.trim() : '';
    if (!clean) return false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify({ authorized: true, token: clean }));
      }
    } catch (e) { /* ignore */ }
    LO.isTesting = true;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('testing-build');
    }
    return true;
  }

  function clearAdminAuth() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(ADMIN_AUTH_KEY);
      }
    } catch (e) { /* ignore */ }
    LO.isTesting = false;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('testing-build');
    }
  }

  const isTesting = !!getAdminAuth();
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('testing-build', isTesting);
  }

  LO.events = LO.events || new EventTarget();
  LO.isTesting = isTesting;
  LO.AdminAuth = {
    get: getAdminAuth,
    set: setAdminAuth,
    clear: clearAdminAuth,
    getToken: () => {
      const a = getAdminAuth();
      return a ? a.token : '';
    },
  };
  LO.settings = S;
  LO.VERSIONS = VERSIONS;
  LO.versionFeatures = versionFeatures;
  LO.ver = () => versionFeatures(S.gameVersion);
  LO.Settings = { set, save, formatKeyCode, PRESETS, DEFAULTS, GRAPHICS_OPTIONS, AUDIO_OPTIONS };
})();

// touch device detection (phones / tablets)
LO.isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
  (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : true);
