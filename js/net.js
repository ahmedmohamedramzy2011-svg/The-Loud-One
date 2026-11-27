// ============================================================
//  THE LOUD ONE — PeerJS (WebRTC) Co-op Networking Layer
// ============================================================
window.LO = window.LO || {};

(function () {
  const PREFIX = 'loudone-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_PLAYERS = 4;
  const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const SLOT_COLORS = ['#4a78a8', '#5c8a52', '#a86544', '#856094'];
  const JACKET_COLORS = [0x365270, 0x455e3d, 0x73442d, 0x563f61];
  const VOICE_REF_DIST = 3.0;
  const VOICE_MAX_DIST = 34.0;

  // Binary packet protocol constants (compact WebRTC bandwidth optimization)
  const PKT_TRANSFORM = 0x01;
  const PKT_KEEPALIVE_PING = 0x02;
  const PKT_KEEPALIVE_PONG = 0x03;
  const PKT_TRANSFORM_BASE = 0x10; // 0x10 | (slot & 0x0f) -> 1-byte type carrying slot 0..3
  const TRANSFORM_BYTE_LENGTH = 16;

  function wrapAngle(a) {
    let w = (Number(a) || 0) % (Math.PI * 2);
    if (w > Math.PI) w -= Math.PI * 2;
    if (w < -Math.PI) w += Math.PI * 2;
    return w;
  }

  function computeTransformFlags(st) {
    if (!st) return 0;
    let flags = 0;
    if (st.alive !== false) flags |= 1;
    if ((st.crouch || 0) > 0.5) flags |= 2;
    if (st.flashOn) flags |= 4;
    if (st.cameraUp) flags |= 8;
    if (st.hidden) flags |= 16;
    if (st.moving) flags |= 32;
    if (st.sprinting) flags |= 64;
    return flags;
  }

  function encodeTransformPacket(st, slot) {
    const buf = new ArrayBuffer(TRANSFORM_BYTE_LENGTH);
    const dv = new DataView(buf);
    const hasSlot = typeof slot === 'number' && slot >= 0 && slot <= 15;
    dv.setUint8(0, hasSlot ? (PKT_TRANSFORM_BASE | (slot & 0x0f)) : PKT_TRANSFORM);
    dv.setFloat32(1, Number(st && st.x) || 0, true);
    dv.setFloat32(5, Number(st && st.y) || 0, true);
    dv.setFloat32(9, Number(st && st.z) || 0, true);
    const qYaw = Math.max(-32767, Math.min(32767, Math.round((wrapAngle(st && st.yaw) / Math.PI) * 32767)));
    dv.setInt16(13, qYaw, true);
    dv.setUint8(15, computeTransformFlags(st));
    return buf;
  }

  function toUint8View(msg) {
    if (!msg) return null;
    if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
    if (ArrayBuffer.isView(msg)) return new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    return null;
  }

  function decodeTransformPacket(raw, prev) {
    const bytes = toUint8View(raw);
    if (!bytes || bytes.byteLength !== TRANSFORM_BYTE_LENGTH) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const b0 = dv.getUint8(0);
    const isSlotted = (b0 & 0xf0) === PKT_TRANSFORM_BASE;
    if (!isSlotted && b0 !== PKT_TRANSFORM) return null;
    const x = dv.getFloat32(1, true);
    const y = dv.getFloat32(5, true);
    const z = dv.getFloat32(9, true);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
    const yaw = (dv.getInt16(13, true) / 32767) * Math.PI;
    const flags = dv.getUint8(15);
    const hidden = !!(flags & 16);
    const moving = !!(flags & 32);
    const sprinting = !!(flags & 64);
    const crouch = (flags & 2) ? 1 : 0;
    return {
      type: 'p_state',
      slot: isSlotted ? (b0 & 0x0f) : null,
      x,
      y,
      z,
      yaw,
      pitch: (prev && typeof prev.pitch === 'number') ? prev.pitch : 0,
      crouch,
      flashOn: !!(flags & 4),
      cameraUp: !!(flags & 8),
      hidden,
      hideSpotIdx: hidden ? ((prev && prev.hideSpotIdx !== undefined) ? prev.hideSpotIdx : -1) : -1,
      alive: !!(flags & 1),
      moving,
      sprinting,
      noiseRadius: moving ? (sprinting ? 35 : (crouch > 0.5 ? 4 : 15)) : 0,
      health: (prev && typeof prev.health === 'number') ? prev.health : 100,
    };
  }

  function optimizeOpusSdp(sdp) {
    if (!sdp || typeof sdp !== 'string') return sdp;
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const opusPts = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(lines[i]);
      if (m) opusPts.add(m[1]);
    }
    if (!opusPts.size) return sdp;
    const updatedPts = new Set();
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fmtpMatch = /^a=fmtp:(\d+)\s*(.*)$/i.exec(line);
      if (fmtpMatch && opusPts.has(fmtpMatch[1])) {
        const pt = fmtpMatch[1];
        const parts = fmtpMatch[2]
          .split(';')
          .map(s => s.trim())
          .filter(s => s && !/^(maxaveragebitrate|usedtx|stereo)=/i.test(s));
        parts.push('maxaveragebitrate=20000', 'usedtx=1', 'stereo=0');
        out.push(`a=fmtp:${pt} ${parts.join(';')}`);
        updatedPts.add(pt);
      } else {
        out.push(line);
      }
    }
    for (let i = out.length - 1; i >= 0; i--) {
      const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(out[i]);
      if (m && opusPts.has(m[1]) && !updatedPts.has(m[1])) {
        out.splice(i + 1, 0, `a=fmtp:${m[1]} minptime=10;useinbandfec=1;maxaveragebitrate=20000;usedtx=1;stereo=0`);
        updatedPts.add(m[1]);
      }
    }
    return out.join(eol);
  }

  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }

  function sanitizeName(raw, slot) {
    const clean = String(raw || '').replace(/[^\w \-\.]/g, '').trim().slice(0, 16);
    return clean || `Investigator ${(slot || 0) + 1}`;
  }

  function sanitizeChat(raw) {
    return String(raw || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160);
  }

  const Net = {
    mode: 'solo',        // 'solo' | 'host' | 'client'
    roomCode: '',
    localId: 'host',
    localSlot: 0,
    localName: 'Investigator 1',
    hostVersion: null,
    hasTurn: false,
    _iceCache: null,
    _connectSeq: 0,
    inGame: false,
    peer: null,
    hostConn: null,
    conns: new Map(),    // peerId -> DataConnection (host only)
    players: [],         // [{ id, slot, name, color, jacketHex, alive, hidden, hideSpotIdx, health, left, hasMic, muted }]
    remoteStates: new Map(),

    // Voice & Chat runtime state
    voiceEnabled: false,
    micMuted: false,
    voiceError: '',
    localStream: null,
    voiceCalls: new Map(), // peerId -> { outgoing, incoming, stream, audioEl, source, gain, flatGain, panner, analyser, buf, volume, distance, speaking, holdUntil }
    localAnalyser: null,
    localAnalyserBuf: null,
    localSpeaking: false,
    localHoldUntil: 0,
    _voiceMasterGain: null,

    // Latency & Session Registry tracking state
    pingMs: null,
    _lastPingSentAt: 0,
    _lastSyncedPing: null,
    _pingTimer: null,
    _hostWatchdogTimer: null,
    startedAt: 0,
    _hostToken: '',
    _heartbeatTimer: null,
    _closing: false,
    localHiddenAdmin: false,
    _iceProviders: null,

    // Callbacks wired by main.js
    onLobbyUpdate: null,
    onStatus: null,
    onMessage: null,
    onPlayerJoin: null,
    onPlayerLeave: null,
    onDisconnect: null,
    onForceExit: null,
    onChat: null,
    onVoiceChange: null,
    onPingUpdate: null,
    onDataTick: null,
    getSessionSnapshot: null,
    getRunSyncState: null,

    sanitizeName,
    sanitizeChat,
    optimizeOpusSdp,
    computeTransformFlags,
    encodeTransformPacket,
    decodeTransformPacket,
    PKT_TRANSFORM,
    PKT_TRANSFORM_BASE,
    PKT_KEEPALIVE_PING,
    PKT_KEEPALIVE_PONG,
    TRANSFORM_BYTE_LENGTH,
    SLOT_COLORS,
    JACKET_COLORS,
    MAX_PLAYERS,
    VOICE_MAX_DIST,

    isCoop() { return this.mode !== 'solo'; },
    isHost() { return this.mode === 'host'; },
    isClient() { return this.mode === 'client'; },
    isSolo() { return this.mode === 'solo'; },
    isVoiceSupported() {
      return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    getPlayer(id) {
      return this.players.find(p => p.id === id) || null;
    },
    getConnectedPlayers() {
      return this.players.filter(p => p && !p.left && !p.hiddenAdmin && (p.id === this.localId || this.mode !== 'host' || this.conns.has(p.id)));
    },
    getLivingConnectedPlayers() {
      return this.getConnectedPlayers().filter(p => p.alive !== false);
    },
    getAlivePlayers() {
      return this.getLivingConnectedPlayers();
    },

    _peerSignalId(id) {
      return id === 'host' ? (PREFIX + this.roomCode) : id;
    },
    _logicalIdFromPeer(peerId) {
      return peerId === (PREFIX + this.roomCode) ? 'host' : peerId;
    },

    _emitStatus(msg, isError) {
      if (this.onStatus) this.onStatus(msg, !!isError);
    },

    _emitLobby() {
      this._syncVoiceCalls();
      if (this.onLobbyUpdate) this.onLobbyUpdate(this.players.slice(), this.roomCode);
    },

    _emitVoiceChange() {
      if (this.onVoiceChange) this.onVoiceChange();
    },

    _emitPing() {
      if (this.onPingUpdate) this.onPingUpdate(this.pingMs, this.players);
    },

    _nextFreeSlot() {
      for (let s = 1; s < MAX_PLAYERS; s++) {
        if (!this.players.some(p => p.slot === s)) return s;
      }
      return -1;
    },

    _makePlayer(id, slot, name, opts) {
      const o = opts || {};
      return {
        id,
        slot,
        name: sanitizeName(name, slot),
        color: SLOT_COLORS[slot % SLOT_COLORS.length],
        jacketHex: JACKET_COLORS[slot % JACKET_COLORS.length],
        alive: !o.hiddenAdmin,
        hidden: false,
        hideSpotIdx: -1,
        health: 100,
        left: false,
        ready: false,
        hasMic: false,
        muted: false,
        ping: id === 'host' ? 0 : null,
        lastSeen: Date.now(),
        hiddenAdmin: !!o.hiddenAdmin,
      };
    },

    setLocalName(name) {
      this.localName = sanitizeName(name, this.localSlot);
      if (this.mode === 'host') {
        const me = this.getPlayer('host');
        if (me) me.name = this.localName;
        this.broadcast({ type: 'lobby_sync', players: this.players.filter(pl => !pl.hiddenAdmin), version: this.hostVersion });
        this._emitLobby();
        this.pushRoomHeartbeat();
      } else if (this.mode === 'client' && this.hostConn && this.hostConn.open && !this.localHiddenAdmin) {
        this.sendToHost({ type: 'rename', name: this.localName });
      }
    },

    setHostVersion(ver) {
      if (!ver || this.mode !== 'host') return;
      this.hostVersion = ver;
      this.broadcast({ type: 'lobby_sync', players: this.players.filter(pl => !pl.hiddenAdmin), version: this.hostVersion });
      this._emitLobby();
    },

    // ============================================================
    //  TEXT CHAT
    // ============================================================
    sendChat(rawText) {
      if (!this.isCoop()) return false;
      const text = sanitizeChat(rawText);
      if (!text) return false;
      const me = this.getPlayer(this.localId);
      if (this.mode === 'host') {
        const pkt = {
          type: 'chat',
          id: 'host',
          slot: 0,
          name: me ? me.name : this.localName,
          color: (me && me.color) || SLOT_COLORS[0],
          dead: !!(me && me.alive === false),
          text,
          ts: Date.now(),
        };
        this.broadcast(pkt);
        if (this.onChat) this.onChat(pkt);
        return true;
      }
      if (this.mode === 'client' && this.hostConn && this.hostConn.open) {
        this.sendToHost({ type: 'chat', text });
        return true;
      }
      return false;
    },

    // ============================================================
    //  WEBRTC PROXIMITY VOICE CHAT
    // ============================================================
    _ensureAudioCtx() {
      const A = LO.audio;
      if (!A) return null;
      if (!A.ctx && A.init) {
        try { A.init(); } catch (e) {}
      }
      const ctx = A.ctx;
      if (!ctx) return null;
      if (ctx.state === 'suspended' && ctx.resume) {
        try { ctx.resume(); } catch (e) {}
      }
      if (!this._voiceMasterGain || this._voiceMasterGain.context !== ctx) {
        this._voiceMasterGain = ctx.createGain();
        this._voiceMasterGain.gain.value = 1;
        this._voiceMasterGain.connect(ctx.destination);
      }
      return ctx;
    },

    _getOrCreateVoiceEntry(id) {
      let entry = this.voiceCalls.get(id);
      if (!entry) {
        entry = {
          id,
          outgoing: null,
          incoming: null,
          stream: null,
          audioEl: null,
          source: null,
          gain: null,
          flatGain: null,
          panner: null,
          analyser: null,
          buf: null,
          volume: 0,
          distance: Infinity,
          speaking: false,
          holdUntil: 0,
        };
        this.voiceCalls.set(id, entry);
      }
      return entry;
    },

    _cleanupVoiceAudio(entry) {
      if (!entry) return;
      if (entry.source) { try { entry.source.disconnect(); } catch (e) {} entry.source = null; }
      if (entry.analyser) { try { entry.analyser.disconnect(); } catch (e) {} entry.analyser = null; }
      if (entry.gain) { try { entry.gain.disconnect(); } catch (e) {} entry.gain = null; }
      if (entry.flatGain) { try { entry.flatGain.disconnect(); } catch (e) {} entry.flatGain = null; }
      if (entry.panner) { try { entry.panner.disconnect(); } catch (e) {} entry.panner = null; }
      if (entry.audioEl) {
        try { entry.audioEl.pause(); } catch (e) {}
        try { entry.audioEl.srcObject = null; } catch (e) {}
        if (entry.audioEl.parentNode) entry.audioEl.parentNode.removeChild(entry.audioEl);
        entry.audioEl = null;
      }
      entry.stream = null;
      entry.buf = null;
      entry.speaking = false;
      entry.volume = 0;
    },

    _disposeVoiceEntry(id) {
      const entry = this.voiceCalls.get(id);
      if (!entry) return;
      if (entry.outgoing) { try { entry.outgoing.close(); } catch (e) {} entry.outgoing = null; }
      if (entry.incoming) { try { entry.incoming.close(); } catch (e) {} entry.incoming = null; }
      this._cleanupVoiceAudio(entry);
      this.voiceCalls.delete(id);
    },

    _wireRemoteWebAudio(entry) {
      if (!entry || !entry.stream || entry.source) return false;
      const ctx = this._ensureAudioCtx();
      if (!ctx || !ctx.createMediaStreamSource) return false;
      try {
        const dest = this._voiceMasterGain || ctx.destination;
        const source = ctx.createMediaStreamSource(entry.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.45;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const flatGain = ctx.createGain();
        flatGain.gain.value = this.inGame ? 0 : 1;

        source.connect(analyser);
        source.connect(flatGain);
        flatGain.connect(dest);

        if (ctx.createPanner) {
          const panner = ctx.createPanner();
          panner.panningModel = 'HRTF';
          panner.distanceModel = 'linear';
          panner.refDistance = 1;
          panner.maxDistance = 1000;
          panner.rolloffFactor = 0;
          source.connect(gain);
          gain.connect(panner);
          panner.connect(dest);
          entry.panner = panner;
        } else {
          source.connect(gain);
          gain.connect(dest);
        }
        entry.source = source;
        entry.analyser = analyser;
        entry.buf = new Uint8Array(analyser.fftSize);
        entry.gain = gain;
        entry.flatGain = flatGain;
        if (entry.audioEl) {
          entry.audioEl.muted = true;
          entry.audioEl.volume = 0;
        }
        return true;
      } catch (err) {
        return false;
      }
    },

    _attachRemoteVoiceStream(fromId, remoteStream) {
      if (!fromId || !remoteStream || fromId === this.localId) return;
      const p = this.getPlayer(fromId);
      if (!p || p.left) return;
      const entry = this._getOrCreateVoiceEntry(fromId);
      if (entry.stream === remoteStream) return;
      this._cleanupVoiceAudio(entry);
      entry.stream = remoteStream;

      // Chrome requires an active <audio> element bound to the WebRTC stream so
      // incoming RTP audio frames pump continuously into Web Audio API nodes.
      let el = null;
      if (typeof document !== 'undefined') {
        el = document.createElement('audio');
        el.autoplay = true;
        el.playsInline = true;
        el.muted = true;
        el.volume = 0;
        el.style.display = 'none';
        el.srcObject = remoteStream;
        if (document.body) document.body.appendChild(el);
        try {
          const pr = el.play && el.play();
          if (pr && pr.catch) pr.catch(() => {});
        } catch (e) {}
        entry.audioEl = el;
      }

      if (!this._wireRemoteWebAudio(entry) && el) {
        el.muted = false;
      }
      this._emitVoiceChange();
    },

    _handleIncomingCall(call) {
      if (!call) return;
      const fromId = (call.metadata && call.metadata.fromId) || this._logicalIdFromPeer(call.peer);
      const p = this.getPlayer(fromId);
      const waitingWelcomeHost = (this.mode === 'client' && fromId === 'host' && this.players.length === 0);
      if ((!p && !waitingWelcomeHost) || (p && p.left) || fromId === this.localId) {
        try { call.close(); } catch (e) {}
        return;
      }
      const entry = this._getOrCreateVoiceEntry(fromId);
      if (entry.incoming && entry.incoming !== call) {
        try { entry.incoming.close(); } catch (e) {}
      }
      entry.incoming = call;
      try {
        call.answer(undefined, { sdpTransform: optimizeOpusSdp });
      } catch (e) {
        return;
      }
      call.on('stream', remoteStream => {
        if (entry.incoming !== call) return;
        this._attachRemoteVoiceStream(fromId, remoteStream);
      });
      const onClose = () => {
        if (entry.incoming === call) {
          entry.incoming = null;
          this._cleanupVoiceAudio(entry);
          this._emitVoiceChange();
        }
      };
      call.on('close', onClose);
      call.on('error', onClose);
    },

    _syncVoiceCalls() {
      const validIds = new Set();
      this.players.forEach(p => {
        if (p && p.id !== this.localId && !p.left && !p.hiddenAdmin) validIds.add(p.id);
      });
      this.voiceCalls.forEach((_, id) => {
        if (!validIds.has(id)) this._disposeVoiceEntry(id);
      });

      if (!this.voiceEnabled || !this.localStream || !this.peer || this.peer.destroyed || !this.peer.call) return;
      validIds.forEach(id => {
        const entry = this._getOrCreateVoiceEntry(id);
        if (entry.outgoing) {
          const pc = entry.outgoing.peerConnection;
          const deadPc = pc && (pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'failed');
          if (!deadPc) return;
          try { entry.outgoing.close(); } catch (e) {}
          entry.outgoing = null;
        }
        try {
          const call = this.peer.call(this._peerSignalId(id), this.localStream, {
            metadata: { fromId: this.localId },
            sdpTransform: optimizeOpusSdp,
          });
          if (!call) return;
          entry.outgoing = call;
          const clearOut = () => {
            if (entry.outgoing === call) entry.outgoing = null;
          };
          call.on('close', clearOut);
          call.on('error', clearOut);
        } catch (e) {}
      });
    },

    _broadcastVoiceState() {
      const me = this.getPlayer(this.localId);
      if (me) {
        me.hasMic = !!this.voiceEnabled;
        me.muted = !!this.micMuted;
      }
      const pkt = {
        type: 'voice_state',
        id: this.localId,
        hasMic: !!this.voiceEnabled,
        muted: !!this.micMuted,
      };
      if (this.mode === 'host') this.broadcast(pkt);
      else if (this.mode === 'client') this.sendToHost(pkt);
    },

    enableVoice() {
      if (this.voiceEnabled && this.localStream) {
        this.setMicMuted(false);
        return Promise.resolve(true);
      }
      if (!this.isVoiceSupported()) {
        this.voiceError = 'Microphone not supported in this browser.';
        this._emitVoiceChange();
        return Promise.reject(new Error(this.voiceError));
      }
      this.voiceError = '';
      this._ensureAudioCtx();
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }).then(stream => {
        if (!this.isCoop()) {
          stream.getTracks().forEach(t => t.stop());
          return false;
        }
        this.localStream = stream;
        this.voiceEnabled = true;
        this.micMuted = false;
        stream.getAudioTracks().forEach(t => { t.enabled = true; });
        const ctx = this._ensureAudioCtx();
        if (ctx && ctx.createMediaStreamSource) {
          try {
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            an.fftSize = 64;
            an.smoothingTimeConstant = 0.45;
            src.connect(an);
            this._localVoiceSource = src;
            this.localAnalyser = an;
            this.localAnalyserBuf = new Uint8Array(an.fftSize);
          } catch (e) {}
        }
        this._broadcastVoiceState();
        this._syncVoiceCalls();
        this._emitVoiceChange();
        return true;
      }).catch(err => {
        this.voiceEnabled = false;
        this.voiceError = (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'))
          ? 'Microphone permission denied.'
          : ((err && err.message) || 'Could not access microphone.');
        this._emitVoiceChange();
        return false;
      });
    },

    disableVoice() {
      if (this._localVoiceSource) {
        try { this._localVoiceSource.disconnect(); } catch (e) {}
        this._localVoiceSource = null;
      }
      if (this.localAnalyser) {
        try { this.localAnalyser.disconnect(); } catch (e) {}
        this.localAnalyser = null;
      }
      this.localAnalyserBuf = null;
      this.localSpeaking = false;
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        this.localStream = null;
      }
      this.voiceCalls.forEach(entry => {
        if (entry.outgoing) { try { entry.outgoing.close(); } catch (e) {} entry.outgoing = null; }
      });
      this.voiceEnabled = false;
      this.micMuted = false;
      this._broadcastVoiceState();
      this._emitVoiceChange();
    },

    setMicMuted(muted) {
      this.micMuted = !!muted;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.micMuted; });
      }
      if (this.micMuted) this.localSpeaking = false;
      this._broadcastVoiceState();
      this._emitVoiceChange();
    },

    toggleMicMute() {
      if (!this.voiceEnabled || !this.localStream) return this.enableVoice();
      this.setMicMuted(!this.micMuted);
      return Promise.resolve(!this.micMuted);
    },

    getVoiceState(id) {
      if (!id || id === this.localId) {
        return {
          hasMic: !!this.voiceEnabled,
          muted: !!this.micMuted,
          speaking: !!(this.voiceEnabled && !this.micMuted && this.localSpeaking),
          volume: 1,
          distance: 0,
        };
      }
      const p = this.getPlayer(id);
      const entry = this.voiceCalls.get(id);
      return {
        hasMic: !!(p && p.hasMic) || !!(entry && entry.stream),
        muted: !!(p && p.muted),
        speaking: !!(entry && entry.speaking),
        volume: entry ? entry.volume : 0,
        distance: entry ? entry.distance : Infinity,
      };
    },

    _readSpeaking(analyser, buf) {
      if (!analyser || !buf) return false;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const d = (buf[i] - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      return rms > 0.022;
    },

    updateVoiceProximity(listenerPos, getRemotePos, inWorld, inCutscene) {
      if (!this.isCoop()) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
      const s = LO.settings || {};
      const userVol = Math.max(0, Math.min(1, (s.master !== undefined ? s.master : 0.8) * (s.voice !== undefined ? s.voice : 1.0)));
      const ctx = LO.audio && LO.audio.ctx;
      if (ctx && ctx.state === 'suspended' && ctx.resume) {
        try { ctx.resume(); } catch (e) {}
      }
      const ctxNow = ctx ? ctx.currentTime : 0;

      if (this._voiceMasterGain && ctx) {
        this._voiceMasterGain.gain.setTargetAtTime(userVol, ctxNow, 0.04);
      }

      if (this.voiceEnabled && !this.micMuted && this.localAnalyser) {
        if (this._readSpeaking(this.localAnalyser, this.localAnalyserBuf)) {
          this.localHoldUntil = now + 0.28;
        }
        this.localSpeaking = now < this.localHoldUntil;
      } else {
        this.localSpeaking = false;
      }

      const me = this.getPlayer(this.localId);
      const localAlive = !me || me.alive !== false;
      const noAtten = !!(s.disableVoiceAttenuation);
      const spatialActive = !!(inWorld && !inCutscene && !noAtten && listenerPos && getRemotePos);

      this.voiceCalls.forEach((entry, id) => {
        if (entry.stream && !entry.source && ctx) {
          this._wireRemoteWebAudio(entry);
        }
        if (entry.audioEl && entry.audioEl.paused && entry.audioEl.srcObject) {
          try {
            const pr = entry.audioEl.play && entry.audioEl.play();
            if (pr && pr.catch) pr.catch(() => {});
          } catch (e) {}
        }

        const p = this.getPlayer(id);
        if (!p || p.left) {
          entry.volume = 0;
          entry.speaking = false;
          if (entry.gain && ctx) entry.gain.gain.setTargetAtTime(0, ctxNow, 0.04);
          if (entry.flatGain && ctx) entry.flatGain.gain.setTargetAtTime(0, ctxNow, 0.04);
          if (entry.audioEl && !entry.audioEl.muted) entry.audioEl.volume = 0;
          return;
        }

        let att = 1;
        let dist = 0;
        if (spatialActive) {
          const rpos = getRemotePos(id);
          if (!rpos) {
            att = 0;
            dist = Infinity;
          } else {
            const dx = rpos.x - listenerPos.x;
            const dy = (rpos.y + 1.55) - listenerPos.y;
            const dz = rpos.z - listenerPos.z;
            dist = Math.hypot(dx, dy, dz);
            if (dist <= VOICE_REF_DIST) att = 1;
            else if (dist < VOICE_MAX_DIST) {
              const u = (dist - VOICE_REF_DIST) / (VOICE_MAX_DIST - VOICE_REF_DIST);
              att = Math.pow(1 - u, 1.65);
            } else {
              att = 0;
            }
            if (p.alive === false) {
              // Dead teammates stay quiet to living players, audible at soft radio level to other spectators
              att = localAlive ? 0 : 0.45;
            }
            if (entry.panner && ctx) {
              const px = rpos.x, py = rpos.y + 1.55, pz = rpos.z;
              if (entry.panner.positionX) {
                entry.panner.positionX.setTargetAtTime(px, ctxNow, 0.04);
                entry.panner.positionY.setTargetAtTime(py, ctxNow, 0.04);
                entry.panner.positionZ.setTargetAtTime(pz, ctxNow, 0.04);
              } else if (entry.panner.setPosition) {
                entry.panner.setPosition(px, py, pz);
              }
            }
          }
        } else {
          if (inWorld && !inCutscene && p.alive === false) {
            att = localAlive ? 0 : 0.45;
          }
          if (entry.panner && ctx && listenerPos) {
            if (entry.panner.positionX) {
              entry.panner.positionX.setValueAtTime(listenerPos.x, ctxNow);
              entry.panner.positionY.setValueAtTime(listenerPos.y, ctxNow);
              entry.panner.positionZ.setValueAtTime(listenerPos.z, ctxNow);
            } else if (entry.panner.setPosition) {
              entry.panner.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
            }
          }
        }

        if (p.muted) att = 0;
        entry.distance = dist;
        entry.volume = att;

        if (ctx) {
          if (entry.flatGain) {
            // In cutscenes, lobby, credits, death screens, or when 3D attenuation is disabled,
            // route through flatGain so voice volume remains constant regardless of distance.
            entry.flatGain.gain.setTargetAtTime(spatialActive ? 0 : att, ctxNow, 0.04);
            if (entry.gain) entry.gain.gain.setTargetAtTime(spatialActive ? att : 0, ctxNow, 0.04);
          } else if (entry.gain) {
            entry.gain.gain.setTargetAtTime(att, ctxNow, 0.05);
          }
        }
        if (entry.audioEl && !entry.audioEl.muted) {
          entry.audioEl.volume = Math.max(0, Math.min(1, att * userVol));
        }

        if (entry.stream && !p.muted && att > 0.02 && entry.analyser) {
          if (this._readSpeaking(entry.analyser, entry.buf)) {
            entry.holdUntil = now + 0.28;
          }
          entry.speaking = now < entry.holdUntil;
        } else {
          entry.speaking = false;
        }
      });
    },

    getPingInfo() {
      if (!this.isCoop()) return { isHost: false, pingMs: null, maxClientPing: null, quality: 'none' };
      const isHost = this.mode === 'host';
      if (isHost) {
        const pings = this.players
          .filter(p => p && p.id !== 'host' && !p.left && typeof p.ping === 'number' && isFinite(p.ping))
          .map(p => p.ping);
        const maxClientPing = pings.length ? Math.max.apply(null, pings) : null;
        const quality = maxClientPing === null ? 'host' : (maxClientPing < 80 ? 'good' : maxClientPing <= 160 ? 'mid' : 'poor');
        return { isHost: true, pingMs: 0, maxClientPing, quality };
      }
      const ms = (typeof this.pingMs === 'number' && isFinite(this.pingMs)) ? Math.round(this.pingMs) : null;
      const quality = ms === null ? 'wait' : (ms < 80 ? 'good' : ms <= 160 ? 'mid' : 'poor');
      return { isHost: false, pingMs: ms, maxClientPing: null, quality };
    },

    _broadcastPings() {
      if (this.mode !== 'host') return;
      const pings = {};
      this.players.forEach(p => {
        if (p && !p.left && typeof p.ping === 'number' && isFinite(p.ping)) pings[p.id] = p.ping;
      });
      this.broadcast({ type: 'ping_sync', pings });
    },

    sendKeepalivePing() {
      if (this.mode !== 'client' || !this.hostConn || !this.hostConn.open) return false;
      this._lastPingSentAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      try {
        const pingBuf = new Uint8Array([PKT_KEEPALIVE_PING]);
        this.hostConn.send(pingBuf.buffer);
        return true;
      } catch (e) {
        return false;
      }
    },

    sendTransformPacket(state, slot) {
      if (!state) return false;
      const useSlot = typeof slot === 'number' ? slot : this.localSlot;
      const buf = encodeTransformPacket(state, useSlot);
      if (this.mode === 'client') {
        if (!this.hostConn || !this.hostConn.open) return false;
        try { this.hostConn.send(buf); return true; } catch (e) { return false; }
      }
      if (this.mode === 'host') {
        this.broadcast(buf);
        return true;
      }
      return false;
    },

    _startPingLoop() {
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      if (this.mode !== 'client') return;
      const sendPing = () => {
        this.sendKeepalivePing();
      };
      sendPing();
      this._pingTimer = setInterval(sendPing, 1000);
    },

    _startHostWatchdog() {
      this._stopHostWatchdog();
      if (this.mode !== 'host') return;
      this._hostWatchdogTimer = setInterval(() => {
        if (this.mode !== 'host' || this._closing) return;
        const now = Date.now();
        Array.from(this.conns.entries()).forEach(([peerId, conn]) => {
          const lp = this.getPlayer(peerId);
          const last = Math.max(
            (conn && typeof conn._lastSeen === 'number') ? conn._lastSeen : 0,
            (lp && typeof lp.lastSeen === 'number') ? lp.lastSeen : 0
          );
          if (last > 0 && (now - last) > 3000) {
            try { if (conn && conn.close) conn.close(); } catch (e) {}
            if (conn && typeof conn._dropPeer === 'function') {
              conn._dropPeer();
            }
          }
        });
      }, 500);
    },

    _stopHostWatchdog() {
      if (this._hostWatchdogTimer) {
        clearInterval(this._hostWatchdogTimer);
        this._hostWatchdogTimer = null;
      }
    },

    // ============================================================
    //  LIVE SESSION REGISTRY HEARTBEAT (/api/rooms)
    // ============================================================
    _makeHostToken() {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let out = '';
      for (let i = 0; i < 24; i++) out += chars[(Math.random() * chars.length) | 0];
      return out;
    },

    async _sendRoomHeartbeat(forceCheck) {
      if (this.mode !== 'host' || !this.roomCode || (this._closing && !forceCheck)) return;
      if (typeof fetch !== 'function' || typeof window === 'undefined') return;
      const snap = this.getSessionSnapshot ? this.getSessionSnapshot() : null;
      const activeCount = this.players.filter(p => p && !p.left && !p.hiddenAdmin).length || 1;
      const payload = {
        roomId: this.roomCode,
        hostCallsign: this.localName || 'Investigator 1',
        playerCount: Math.max(1, Math.min(MAX_PLAYERS, activeCount)),
        maxPlayers: MAX_PLAYERS,
        wave: (snap && snap.wave) || (this.inGame ? 'In Progress' : 'Lobby'),
        startedAt: this.startedAt || Date.now(),
        status: (snap && snap.status) || (this.inGame ? 'playing' : 'lobby'),
        hostToken: this._hostToken || '',
      };
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
        if (!res || !res.ok) return;
        const json = await res.json();
        if (json && json.shutdown && this.mode === 'host' && !this._closing) {
          this.shutdownByAdmin(json.shutdownReason || 'Match shut down by Admin');
        }
      } catch (e) {}
    },

    pushRoomHeartbeat() {
      if (this.mode === 'host' && this.roomCode && !this._closing) {
        this._sendRoomHeartbeat(false);
      }
    },

    _startRoomHeartbeat() {
      this._stopRoomHeartbeat();
      if (this.mode !== 'host' || !this.roomCode) return;
      this._sendRoomHeartbeat(false);
      this._heartbeatTimer = setInterval(() => {
        this._sendRoomHeartbeat(false);
      }, 15000);
    },

    _stopRoomHeartbeat() {
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    },

    _deleteRoomRegistry(useBeacon, isAdmin) {
      const code = this.roomCode;
      if (!code || typeof window === 'undefined') return;
      const token = this._hostToken || '';
      if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify({ action: 'leave', roomId: code, hostToken: token })], { type: 'application/json' });
          navigator.sendBeacon('/api/rooms', blob);
          return;
        } catch (e) {}
      }
      if (typeof fetch === 'function') {
        const qs = new URLSearchParams({ roomId: code });
        if (token) qs.set('token', token);
        if (isAdmin) qs.set('admin', '1');
        fetch(`/api/rooms?${qs.toString()}`, {
          method: 'DELETE',
          keepalive: true,
          cache: 'no-store',
        }).catch(() => {});
      }
    },

    // ============================================================
    //  HOST / JOIN
    // ============================================================
    async _loadIceConfig(preferCloudflare) {
      const now = Date.now();
      if (!preferCloudflare && this._iceCache && now < this._iceCache.expiresAt) {
        return this._iceCache.data;
      }
      const fallback = { iceServers: DEFAULT_ICE_SERVERS, hasTurn: false, peerOpts: null, providers: null };
      if (typeof fetch !== 'function' || typeof window === 'undefined') {
        this.hasTurn = false;
        return fallback;
      }
      try {
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ac ? setTimeout(() => ac.abort(), 3000) : null;
        const url = preferCloudflare ? '/api/ice?prefer=cloudflare' : '/api/ice';
        const res = await fetch(url, Object.assign({ cache: 'no-store' }, ac ? { signal: ac.signal } : {}));
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) throw new Error('ice endpoint unavailable');
        const json = await res.json();
        const servers = (json && Array.isArray(json.iceServers) && json.iceServers.length)
          ? json.iceServers
          : DEFAULT_ICE_SERVERS;
        const data = {
          iceServers: servers,
          hasTurn: !!(json && json.hasTurn),
          providers: (json && json.providers) ? json.providers : null,
          peerOpts: (json && json.peerOpts && typeof json.peerOpts === 'object') ? json.peerOpts : null,
        };
        this.hasTurn = data.hasTurn;
        this._iceProviders = data.providers;
        this._iceCache = {
          data,
          expiresAt: now + (data.hasTurn ? 600000 : 30000),
        };
        return data;
      } catch (e) {
        this.hasTurn = false;
        this._iceCache = { data: fallback, expiresAt: now + 15000 };
        return fallback;
      }
    },

    _buildPeerOptions(netCfg) {
      const opts = {
        config: {
          iceServers: (netCfg && Array.isArray(netCfg.iceServers) && netCfg.iceServers.length)
            ? netCfg.iceServers
            : DEFAULT_ICE_SERVERS,
          iceCandidatePoolSize: 6,
          iceTransportPolicy: 'all',
        },
      };
      if (netCfg && netCfg.peerOpts) Object.assign(opts, netCfg.peerOpts);
      return opts;
    },

    host(name, gameVersion) {
      this.leave();
      if (typeof Peer === 'undefined') {
        this._emitStatus('PeerJS library failed to load.', true);
        return Promise.reject(new Error('PeerJS missing'));
      }
      const seq = ++this._connectSeq;
      this.mode = 'host';
      this.localId = 'host';
      this.localSlot = 0;
      this.localName = sanitizeName(name, 0);
      this.localHiddenAdmin = false;
      this.hostVersion = gameVersion || (LO.settings && LO.settings.gameVersion) || '2.8.3';
      this.inGame = false;
      this.startedAt = Date.now();
      this._hostToken = this._makeHostToken();
      this._closing = false;
      this.players = [this._makePlayer('host', 0, this.localName)];
      this.remoteStates.clear();
      this._emitStatus('Preparing co-op room...');

      return new Promise((resolve, reject) => {
        let attempts = 0;
        let peerOpts = null;
        const tryCreate = () => {
          if (this.mode !== 'host' || this._connectSeq !== seq) return;
          attempts++;
          const code = genCode();
          this.roomCode = code;
          this._emitStatus('Creating co-op room...');
          let settled = false;
          const peer = new Peer(PREFIX + code, peerOpts || this._buildPeerOptions(null));
          this.peer = peer;

          peer.on('open', () => {
            if (this.peer !== peer) return;
            settled = true;
            this._emitStatus(`Room ready: ${code}`);
            this._emitLobby();
            this._startRoomHeartbeat();
            this._startHostWatchdog();
            resolve(code);
          });

          peer.on('connection', conn => {
            if (this.peer !== peer) return;
            this._handleIncomingClient(conn);
          });

          peer.on('call', call => {
            if (this.peer !== peer) return;
            this._handleIncomingCall(call);
          });

          peer.on('error', err => {
            if (this.peer !== peer) return;
            if (!settled && err && err.type === 'unavailable-id' && attempts < 6) {
              try { peer.destroy(); } catch (e) {}
              this.peer = null;
              tryCreate();
              return;
            }
            const msg = (err && err.message) ? err.message : 'Connection error';
            this._emitStatus(msg, true);
            if (!settled) {
              settled = true;
              this.leave();
              reject(err);
            }
          });

          peer.on('disconnected', () => {
            if (this.peer === peer && !peer.destroyed) {
              try { peer.reconnect(); } catch (e) {}
            }
          });
        };

        this._loadIceConfig().then(netCfg => {
          if (this.mode !== 'host' || this._connectSeq !== seq) return;
          peerOpts = this._buildPeerOptions(netCfg);
          tryCreate();
        });
      });
    },

    _handleIncomingClient(conn) {
      const peerId = conn.peer;
      let accepted = false;
      let restartedIce = false;
      conn._lastSeen = Date.now();

      if (conn && conn.on) {
        conn.on('iceStateChanged', st => {
          if (st === 'failed' && !restartedIce && conn.peerConnection) {
            restartedIce = true;
            this._loadIceConfig(true).then(cfg => {
              if (!conn.peerConnection) return;
              try {
                if (conn.peerConnection.setConfiguration && cfg && cfg.iceServers) {
                  conn.peerConnection.setConfiguration({ iceServers: cfg.iceServers, iceCandidatePoolSize: 6, iceTransportPolicy: 'all' });
                }
                if (conn.peerConnection.restartIce) conn.peerConnection.restartIce();
              } catch (e) {}
            });
          }
        });
      }

      const rejectAndClose = reason => {
        try { conn.send({ type: 'reject', reason }); } catch (e) {}
        setTimeout(() => { try { conn.close(); } catch (e) {} }, 150);
      };

      const drop = () => {
        if (!accepted) return;
        accepted = false;
        this.conns.delete(peerId);
        this.remoteStates.delete(peerId);
        this._disposeVoiceEntry(peerId);
        const idx = this.players.findIndex(p => p.id === peerId);
        if (idx >= 0) {
          const removed = this.players[idx];
          if (removed.hiddenAdmin) {
            this.players.splice(idx, 1);
            this._emitVoiceChange();
            return;
          }
          if (this.inGame) {
            removed.left = true;
            removed.alive = false;
            removed.hidden = false;
            removed.hideSpotIdx = -1;
            this._emitLobby();
            if (this.onMessage) this.onMessage(peerId, { type: 'player_left', id: peerId });
          } else {
            this.players.splice(idx, 1);
            this.broadcast({ type: 'lobby_sync', players: this.players.filter(pl => !pl.hiddenAdmin), version: this.hostVersion });
            this._emitLobby();
          }
          if (this.onPlayerLeave) this.onPlayerLeave(removed);
          this.pushRoomHeartbeat();
        }
        this._emitVoiceChange();
      };
      conn._dropPeer = drop;

      conn.on('data', msg => {
        if (!msg) return;
        const bin = toUint8View(msg);
        if (bin) {
          const now = Date.now();
          conn._lastSeen = now;
          const seenPlayer = this.getPlayer(peerId);
          if (seenPlayer) seenPlayer.lastSeen = now;

          if (this.onDataTick && this.onDataTick(msg, peerId) === true) return;
          if (!accepted) return;

          if (bin.byteLength === 1 && bin[0] === PKT_KEEPALIVE_PING) {
            try {
              const pongBuf = new Uint8Array([PKT_KEEPALIVE_PONG]);
              this.sendTo(peerId, pongBuf.buffer);
            } catch (e) {}
            return;
          }

          if (bin.byteLength === TRANSFORM_BYTE_LENGTH) {
            if (seenPlayer && seenPlayer.hiddenAdmin) return;
            const prev = this.remoteStates.get(peerId);
            const st = decodeTransformPacket(bin, prev);
            if (!st) return;
            this.remoteStates.set(peerId, st);
            if (seenPlayer) {
              if (seenPlayer.alive !== false && !seenPlayer.left) {
                seenPlayer.alive = st.alive !== false;
              }
              seenPlayer.hidden = !!st.hidden;
              if (!st.hidden) seenPlayer.hideSpotIdx = -1;
            }
            const slotNum = (seenPlayer && typeof seenPlayer.slot === 'number') ? seenPlayer.slot : (st.slot !== null ? st.slot : 1);
            const fwd = new Uint8Array(TRANSFORM_BYTE_LENGTH);
            fwd.set(bin);
            fwd[0] = PKT_TRANSFORM_BASE | (slotNum & 0x0f);
            this.broadcast(fwd.buffer, peerId);
            if (this.onMessage) this.onMessage(peerId, st);
            return;
          }
          return;
        }

        if (typeof msg !== 'object') return;
        if (msg.type === 'ADMIN_SHUTDOWN') {
          this._sendRoomHeartbeat(true);
          return;
        }
        const now = Date.now();
        conn._lastSeen = now;
        const seenPlayer = this.getPlayer(peerId);
        if (seenPlayer) seenPlayer.lastSeen = now;

        if (this.onDataTick && this.onDataTick(msg, peerId) === true) return;
        if (!accepted) {
          if (msg.type !== 'hello') return;
          const isAdminJoin = !!msg.adminJoin;
          const isAdminHidden = isAdminJoin && !!msg.adminHidden;
          if (this.inGame && !isAdminJoin) {
            rejectAndClose('Run already in progress.');
            return;
          }
          let slot = this._nextFreeSlot();
          if ((slot < 0 || this.players.filter(pl => !pl.hiddenAdmin).length >= MAX_PLAYERS) && !isAdminHidden) {
            rejectAndClose('Room is full (max 4 players).');
            return;
          }
          if (slot < 0) slot = MAX_PLAYERS - 1;
          accepted = true;
          conn._lastSeen = now;
          this.conns.set(peerId, conn);
          const p = this._makePlayer(peerId, slot, msg.name, { hiddenAdmin: isAdminHidden });
          p.lastSeen = now;
          this.players.push(p);
          try {
            conn.send({
              type: 'welcome',
              localId: peerId,
              slot,
              roomCode: this.roomCode,
              version: this.hostVersion,
              players: isAdminHidden ? this.players : this.players.filter(pl => !pl.hiddenAdmin),
              inGame: !!this.inGame,
              adminHidden: isAdminHidden,
              runState: (this.inGame && this.getRunSyncState) ? this.getRunSyncState() : null,
            });
          } catch (e) {}
          if (!isAdminHidden) {
            this.broadcast({ type: 'lobby_sync', players: this.players.filter(pl => !pl.hiddenAdmin), version: this.hostVersion }, peerId);
            this._emitLobby();
            this.pushRoomHeartbeat();
            if (this.onPlayerJoin) this.onPlayerJoin(p);
          }
          return;
        }

        if (msg.type === 'player_left' || msg.type === 'PLAYER_LEFT') {
          try { conn.close(); } catch (e) {}
          drop();
          return;
        }

        if (msg.type === 'PING' || msg.type === 'net_ping') {
          this.sendTo(peerId, { type: 'net_pong', t: msg.t });
          if (typeof msg.r === 'number' && isFinite(msg.r)) {
            const p = this.getPlayer(peerId);
            if (p) {
              p.ping = Math.max(0, Math.round(msg.r));
              this._broadcastPings();
              this._emitPing();
            }
          }
          return;
        }

        if (msg.type === 'ping_r') {
          if (typeof msg.r === 'number' && isFinite(msg.r)) {
            const p = this.getPlayer(peerId);
            if (p) {
              p.ping = Math.max(0, Math.round(msg.r));
              this._broadcastPings();
              this._emitPing();
            }
          }
          return;
        }

        if (msg.type === 'rename') {
          const p = this.getPlayer(peerId);
          if (p) {
            p.name = sanitizeName(msg.name, p.slot);
            this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
            this._emitLobby();
          }
          return;
        }

        if (msg.type === 'voice_state') {
          const p = this.getPlayer(peerId);
          if (p) {
            p.hasMic = !!msg.hasMic;
            p.muted = !!msg.muted;
            this.broadcast({ type: 'voice_state', id: peerId, hasMic: p.hasMic, muted: p.muted }, peerId);
            this._syncVoiceCalls();
            this._emitVoiceChange();
          }
          return;
        }

        if (msg.type === 'chat') {
          const p = this.getPlayer(peerId);
          const text = sanitizeChat(msg.text);
          if (!text) return;
          const pkt = {
            type: 'chat',
            id: peerId,
            slot: p ? p.slot : 1,
            name: p ? p.name : 'Investigator',
            color: (p && p.color) || SLOT_COLORS[1],
            dead: !!(p && p.alive === false),
            text,
            ts: Date.now(),
          };
          this.broadcast(pkt);
          if (this.onChat) this.onChat(pkt);
          return;
        }

        if (msg.type === 'p_meta') {
          const p = this.getPlayer(peerId);
          if (p && p.hiddenAdmin) return;
          const prev = this.remoteStates.get(peerId) || { type: 'p_state' };
          if (typeof msg.health === 'number') prev.health = msg.health;
          if (msg.hideSpotIdx !== undefined) prev.hideSpotIdx = msg.hideSpotIdx;
          if (typeof msg.pitch === 'number') prev.pitch = msg.pitch;
          if (msg.hidden !== undefined) prev.hidden = !!msg.hidden;
          this.remoteStates.set(peerId, prev);
          if (p) {
            if (typeof msg.health === 'number') p.health = msg.health;
            if (msg.hideSpotIdx !== undefined) p.hideSpotIdx = msg.hideSpotIdx;
            if (msg.hidden !== undefined) p.hidden = !!msg.hidden;
          }
          this.broadcast(Object.assign({}, msg, { id: peerId }), peerId);
          if (this.onMessage) this.onMessage(peerId, Object.assign({ type: 'p_meta' }, prev));
          return;
        }

        if (msg.type === 'p_state') {
          const p = this.getPlayer(peerId);
          if (p && p.hiddenAdmin) return;
          this.remoteStates.set(peerId, msg);
          if (p) {
            if (p.alive !== false && !p.left) {
              p.alive = msg.alive !== false;
            }
            p.hidden = !!msg.hidden;
            p.hideSpotIdx = msg.hideSpotIdx !== undefined ? msg.hideSpotIdx : -1;
            if (typeof msg.health === 'number') p.health = msg.health;
          }
        }

        if (this.onMessage) this.onMessage(peerId, msg);
      });

      conn.on('close', drop);
      conn.on('error', drop);
    },

    join(rawCode, name, opts) {
      this.leave();
      if (typeof Peer === 'undefined') {
        this._emitStatus('PeerJS library failed to load.', true);
        return Promise.reject(new Error('PeerJS missing'));
      }
      const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (code.length !== 5) {
        this._emitStatus('Enter a valid 5-character room code.', true);
        return Promise.reject(new Error('Invalid room code'));
      }

      const joinOpts = opts || {};
      const seq = ++this._connectSeq;
      this.mode = 'client';
      this.roomCode = code;
      this.localName = sanitizeName(name, 1);
      this.localHiddenAdmin = !!(joinOpts.adminJoin && joinOpts.adminHidden);
      this.inGame = false;
      this._closing = false;
      this.players = [];
      this.remoteStates.clear();

      return new Promise((resolve, reject) => {
        let settled = false;
        this._emitStatus(`Connecting to ${code}...`);

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            const timeoutMsg = this.hasTurn
              ? 'Connection timed out. Check the room code or firewall and try again.'
              : 'Connection timed out — direct P2P may be blocked between networks without a TURN relay server.';
            this._emitStatus(timeoutMsg, true);
            this.leave();
            reject(new Error('Connection timeout'));
          }
        }, 22000);

        const fail = (errMsg, errObj) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            this._emitStatus(errMsg, true);
            this.leave();
            reject(errObj || new Error(errMsg));
          } else {
            this.leave();
            if (this.onDisconnect) this.onDisconnect(errMsg);
          }
        };

        this._loadIceConfig().then(netCfg => {
          if (this.mode !== 'client' || this._connectSeq !== seq || settled) return;
          const peer = new Peer(undefined, this._buildPeerOptions(netCfg));
          this.peer = peer;

          peer.on('call', call => {
            if (this.peer !== peer) return;
            this._handleIncomingCall(call);
          });

          peer.on('open', () => {
            if (this.peer !== peer) return;
            this._emitStatus(`Signaling connected — reaching room ${code}...`);
            const conn = peer.connect(PREFIX + code, { reliable: true });
            this.hostConn = conn;
            let restartedIce = false;

            if (conn && conn.on) {
              conn.on('iceStateChanged', st => {
                if (this.hostConn !== conn || settled) return;
                if (st === 'checking') {
                  this._emitStatus(`Negotiating internet route to ${code}...`);
                } else if (st === 'failed') {
                  if (!restartedIce && conn.peerConnection) {
                    restartedIce = true;
                    this._loadIceConfig(true).then(cfg => {
                      if (this.hostConn !== conn || settled || !conn.peerConnection) return;
                      try {
                        if (conn.peerConnection.setConfiguration && cfg && cfg.iceServers) {
                          conn.peerConnection.setConfiguration({ iceServers: cfg.iceServers, iceCandidatePoolSize: 6, iceTransportPolicy: 'all' });
                        }
                        if (conn.peerConnection.restartIce) { conn.peerConnection.restartIce(); return; }
                      } catch (e) {}
                    });
                    return;
                  }
                  const natMsg = this.hasTurn
                    ? 'Firewall/router blocked peer connection even with TURN relay.'
                    : 'Direct P2P blocked by router/NAT. Configure a TURN server on /api/ice to connect across networks.';
                  fail(natMsg);
                }
              });
            }

            conn.on('open', () => {
              if (this.hostConn !== conn) return;
              try {
                conn.send({
                  type: 'hello',
                  name: this.localName,
                  adminJoin: !!joinOpts.adminJoin,
                  adminHidden: !!this.localHiddenAdmin,
                });
              } catch (e) {}
            });

            conn.on('data', msg => {
              if (this.hostConn !== conn || !msg) return;
              const bin = toUint8View(msg);
              if (bin) {
                if (this.onDataTick && this.onDataTick(msg, 'host') === true) return;
                if (bin.byteLength === 1 && bin[0] === PKT_KEEPALIVE_PONG) {
                  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                  const sent = this._lastPingSentAt || now;
                  const raw = Math.max(1, Math.round(now - sent));
                  this.pingMs = this.pingMs === null ? raw : Math.round(this.pingMs * 0.45 + raw * 0.55);
                  const me = this.getPlayer(this.localId);
                  if (me) me.ping = this.pingMs;
                  this._emitPing();
                  if (!this.inGame && (this._lastSyncedPing === null || Math.abs(this.pingMs - this._lastSyncedPing) >= 6)) {
                    this._lastSyncedPing = this.pingMs;
                    this.sendToHost({ type: 'ping_r', r: this.pingMs });
                  }
                  return;
                }
                if (bin.byteLength === TRANSFORM_BYTE_LENGTH) {
                  const b0 = bin[0];
                  const slot = (b0 & 0xf0) === PKT_TRANSFORM_BASE ? (b0 & 0x0f) : 0;
                  const target = this.players.find(pl => pl && pl.slot === slot && !pl.hiddenAdmin);
                  if (!target || target.id === this.localId) return;
                  const prev = this.remoteStates.get(target.id);
                  const st = decodeTransformPacket(bin, prev);
                  if (!st) return;
                  this.remoteStates.set(target.id, st);
                  if (!target.left) {
                    if (target.alive !== false) target.alive = st.alive !== false;
                    target.hidden = !!st.hidden;
                    if (!st.hidden) target.hideSpotIdx = -1;
                  }
                  if (this.onMessage) this.onMessage(target.id, st);
                  return;
                }
                return;
              }

              if (typeof msg !== 'object') return;
              if (msg.type === 'reject') {
                fail(msg.reason || 'Host rejected connection.');
                return;
              }
              if (msg.type === 'ROOM_CLOSED' || msg.type === 'ADMIN_SHUTDOWN') {
                clearTimeout(timer);
                const reason = msg.reason || (msg.type === 'ADMIN_SHUTDOWN' ? 'Match shut down by Admin' : 'Room closed by host.');
                const kind = msg.type === 'ADMIN_SHUTDOWN' ? 'admin' : 'closed';
                this.hostConn = null;
                try { conn.close(); } catch (e) {}
                this.leave();
                if (!settled) {
                  settled = true;
                  this._emitStatus(reason, true);
                  reject(new Error(reason));
                }
                if (this.onForceExit) this.onForceExit(reason, kind);
                else if (this.onDisconnect) this.onDisconnect(reason);
                return;
              }
              if (this.onDataTick && this.onDataTick(msg, 'host') === true) return;
              if (msg.type === 'welcome') {
                clearTimeout(timer);
                this.localId = msg.localId;
                this.localSlot = msg.slot;
                this.roomCode = msg.roomCode || code;
                this.hostVersion = msg.version || null;
                this.inGame = !!msg.inGame;
                this.localHiddenAdmin = !!msg.adminHidden;
                this.players = Array.isArray(msg.players) ? msg.players : [];
                this._emitStatus(`Connected to room ${this.roomCode}`);
                this._emitLobby();
                this._startPingLoop();
                if (this.voiceEnabled) this._broadcastVoiceState();
                if (!settled) {
                  settled = true;
                  resolve({
                    roomCode: this.roomCode,
                    inGame: this.inGame,
                    adminHidden: this.localHiddenAdmin,
                    runState: msg.runState || null,
                  });
                }
                if (this.inGame && this.onMessage) {
                  this.onMessage('host', {
                    type: 'admin_midjoin',
                    adminHidden: this.localHiddenAdmin,
                    runState: msg.runState || null,
                  });
                }
                return;
              }
              if (msg.type === 'net_pong') {
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                const raw = Math.max(1, Math.round(now - (msg.t || now)));
                this.pingMs = this.pingMs === null ? raw : Math.round(this.pingMs * 0.45 + raw * 0.55);
                const me = this.getPlayer(this.localId);
                if (me) me.ping = this.pingMs;
                this._emitPing();
                return;
              }
              if (msg.type === 'ping_sync' && msg.pings && typeof msg.pings === 'object') {
                this.players.forEach(p => {
                  if (p && p.id !== this.localId && typeof msg.pings[p.id] === 'number') {
                    p.ping = msg.pings[p.id];
                  }
                });
                this._emitPing();
                return;
              }
              if (msg.type === 'lobby_sync') {
                this.hostVersion = msg.version || this.hostVersion;
                const prevIds = new Set(this.players.map(p => p.id));
                this.players = Array.isArray(msg.players) ? msg.players : [];
                const nextIds = new Set(this.players.map(p => p.id));
                prevIds.forEach(id => {
                  if (!nextIds.has(id) && id !== this.localId) {
                    this.remoteStates.delete(id);
                    this._disposeVoiceEntry(id);
                    if (this.onPlayerLeave) this.onPlayerLeave({ id });
                  }
                });
                this._emitLobby();
                return;
              }
              if (msg.type === 'voice_state') {
                const p = this.getPlayer(msg.id);
                if (p) {
                  p.hasMic = !!msg.hasMic;
                  p.muted = !!msg.muted;
                  this._emitVoiceChange();
                }
                return;
              }
              if (msg.type === 'chat') {
                if (this.onChat) this.onChat(msg);
                return;
              }
              if (msg.type === 'p_meta' && msg.id && msg.id !== this.localId) {
                const prev = this.remoteStates.get(msg.id) || { type: 'p_state' };
                if (typeof msg.health === 'number') prev.health = msg.health;
                if (msg.hideSpotIdx !== undefined) prev.hideSpotIdx = msg.hideSpotIdx;
                if (typeof msg.pitch === 'number') prev.pitch = msg.pitch;
                if (msg.hidden !== undefined) prev.hidden = !!msg.hidden;
                this.remoteStates.set(msg.id, prev);
                const lp = this.getPlayer(msg.id);
                if (lp && !lp.left) {
                  if (typeof msg.health === 'number') lp.health = msg.health;
                  if (msg.hideSpotIdx !== undefined) lp.hideSpotIdx = msg.hideSpotIdx;
                  if (msg.hidden !== undefined) lp.hidden = !!msg.hidden;
                }
                if (this.onMessage) this.onMessage(msg.id, Object.assign({}, prev, { type: 'p_meta' }));
                return;
              }
              if (msg.type === 'world_snap' && Array.isArray(msg.players)) {
                for (let i = 0; i < msg.players.length; i++) {
                  const ps = msg.players[i];
                  if (!ps || ps.id === this.localId) continue;
                  this.remoteStates.set(ps.id, ps);
                  const lp = this.getPlayer(ps.id);
                  if (lp && !lp.left) {
                    if (lp.alive !== false) lp.alive = ps.alive !== false;
                    lp.hidden = !!ps.hidden;
                    lp.hideSpotIdx = ps.hideSpotIdx !== undefined ? ps.hideSpotIdx : -1;
                    if (typeof ps.health === 'number') lp.health = ps.health;
                  }
                }
              }
              if (this.onMessage) this.onMessage('host', msg);
            });

            conn.on('close', () => {
              if (this.hostConn === conn) fail('Disconnected from host.');
            });
            conn.on('error', () => {
              if (this.hostConn === conn) fail('Connection to host failed.');
            });
          });

          peer.on('error', err => {
            if (this.peer !== peer) return;
            let msg = 'Network error.';
            if (err && err.type === 'peer-unavailable') msg = `Room "${code}" not found.`;
            else if (err && err.message) msg = err.message;
            fail(msg, err);
          });

          peer.on('disconnected', () => {
            if (this.peer === peer && !peer.destroyed) {
              try { peer.reconnect(); } catch (e) {}
            }
          });
        });
      });
    },

    sendTo(peerId, msg) {
      if (this.mode !== 'host') return;
      const conn = this.conns.get(peerId);
      if (conn && conn.open) {
        try { conn.send(msg); } catch (e) {}
      }
    },

    broadcast(msg, excludePeerId) {
      if (this.mode !== 'host') return;
      this.conns.forEach((conn, id) => {
        if (id === excludePeerId) return;
        if (conn && conn.open) {
          try { conn.send(msg); } catch (e) {}
        }
      });
    },

    sendToHost(msg) {
      if (this.mode !== 'client') return;
      if (this.hostConn && this.hostConn.open) {
        try { this.hostConn.send(msg); } catch (e) {}
      }
    },

    // Let the other players know we are gone instead of waiting for an ICE timeout.
    _notifyLeaving() {
      if (!this.inGame) return;
      if (this.mode === 'host') {
        this.broadcast({ type: 'player_left', id: this.localId });
      } else if (this.mode === 'client') {
        this.sendToHost({ type: 'player_left', id: this.localId });
      }
    },

    _teardownTransport() {
      this._connectSeq++;
      this._stopRoomHeartbeat();
      this._stopHostWatchdog();
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      this.pingMs = null;
      this._lastPingSentAt = 0;
      this._lastSyncedPing = null;
      this.disableVoice();
      Array.from(this.voiceCalls.keys()).forEach(id => this._disposeVoiceEntry(id));
      this.voiceCalls.clear();
      this.voiceError = '';
      this.conns.forEach(conn => { try { conn.close(); } catch (e) {} });
      this.conns.clear();
      if (this.hostConn) {
        try { this.hostConn.close(); } catch (e) {}
        this.hostConn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.mode = 'solo';
      this.roomCode = '';
      this.localId = 'host';
      this.localSlot = 0;
      this.hostVersion = null;
      this.inGame = false;
      this.startedAt = 0;
      this._hostToken = '';
      this._closing = false;
      this.localHiddenAdmin = false;
      this.players = [];
      this.remoteStates.clear();
      this._emitPing();
    },

    closeRoom(clientReason, selfReason) {
      if (this.mode !== 'host') {
        this.leave();
        return;
      }
      if (this._closing) return;
      this._closing = true;
      const reasonForClients = clientReason || 'Host closed the room.';
      const reasonForSelf = selfReason || reasonForClients;
      this._stopRoomHeartbeat();
      this._stopHostWatchdog();
      this.disableVoice();
      this._deleteRoomRegistry(false, false);
      this.broadcast({ type: 'ROOM_CLOSED', reason: reasonForClients });
      setTimeout(() => {
        this._teardownTransport();
        if (this.onForceExit) this.onForceExit(reasonForSelf, 'closed');
      }, 120);
    },

    shutdownByAdmin(reason) {
      const msg = reason || 'Match shut down by Admin';
      if (this.mode !== 'host') {
        this.leave();
        if (this.onForceExit) this.onForceExit(msg, 'admin');
        return;
      }
      if (this._closing) return;
      this._closing = true;
      this._stopRoomHeartbeat();
      this._stopHostWatchdog();
      this.disableVoice();
      this._deleteRoomRegistry(false, true);
      this.broadcast({ type: 'ADMIN_SHUTDOWN', reason: msg });
      setTimeout(() => {
        this._teardownTransport();
        if (this.onForceExit) this.onForceExit(msg, 'admin');
      }, 120);
    },

    async adminRemoteShutdown(rawCode, reason) {
      const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return { ok: false, error: 'Invalid room ID.' };
      const msg = reason || 'Match shut down by Admin';
      let ok = false;
      if (typeof fetch === 'function') {
        try {
          const res = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'shutdown', roomId: code, reason: msg }),
            cache: 'no-store',
          });
          ok = !!(res && res.ok);
        } catch (e) {}
      }
      if (this.mode === 'host' && this.roomCode === code) {
        this.shutdownByAdmin(msg);
        return { ok: true };
      }
      if (this.mode === 'client' && this.roomCode === code) {
        this.sendToHost({ type: 'ADMIN_SHUTDOWN', reason: msg });
        return { ok: true };
      }
      // Best-effort instant signaling nudge so host sees shutdown right away instead of waiting 15s
      if (typeof Peer !== 'undefined') {
        this._loadIceConfig(false).then(cfg => {
          try {
            const p = new Peer(undefined, this._buildPeerOptions(cfg));
            let done = false;
            const cleanup = () => {
              if (done) return;
              done = true;
              try { p.destroy(); } catch (e) {}
            };
            const t = setTimeout(cleanup, 2500);
            p.on('open', () => {
              try {
                const c = p.connect(PREFIX + code, { reliable: true });
                c.on('open', () => {
                  try { c.send({ type: 'ADMIN_SHUTDOWN', reason: msg }); } catch (e) {}
                  setTimeout(() => { clearTimeout(t); cleanup(); }, 250);
                });
                c.on('error', () => { clearTimeout(t); cleanup(); });
              } catch (e) { clearTimeout(t); cleanup(); }
            });
            p.on('error', () => { clearTimeout(t); cleanup(); });
          } catch (e) {}
        });
      }
      return { ok };
    },

    leave() {
      const wasHost = this.mode === 'host';
      if (wasHost && !this._closing) {
        this._stopRoomHeartbeat();
        this._deleteRoomRegistry(false, false);
        this.broadcast({ type: 'ROOM_CLOSED', reason: 'Host left the match.' });
      } else {
        this._notifyLeaving();
      }
      this._teardownTransport();
    },
  };

  LO.Net = Net;

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      if (Net.mode === 'host') {
        Net._deleteRoomRegistry(true, false);
        Net.broadcast({ type: 'ROOM_CLOSED', reason: 'Host disconnected.' });
      } else if (Net.inGame && Net.mode === 'client') {
        Net.sendToHost({ type: 'player_left', id: Net.localId });
      }
    });
  }
})();
