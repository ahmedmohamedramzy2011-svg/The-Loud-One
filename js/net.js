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

  // Compact short-key JSON protocol & DataChannel coalescing threshold
  const POS_BUFFER_HIGH_WATER = 8192;

  function wrapAngle(a) {
    let w = (Number(a) || 0) % (Math.PI * 2);
    if (w > Math.PI) w -= Math.PI * 2;
    if (w < -Math.PI) w += Math.PI * 2;
    return w;
  }

  function getConnBufferedAmount(conn) {
    if (!conn) return 0;
    if (conn.dataChannel && typeof conn.dataChannel.bufferedAmount === 'number') {
      return conn.dataChannel.bufferedAmount;
    }
    if (typeof conn.bufferSize === 'number') return conn.bufferSize;
    return 0;
  }

  function clearConnQueues(conn) {
    if (!conn) return;
    if (conn._posTimer) { clearTimeout(conn._posTimer); conn._posTimer = null; }
    if (conn._snapTimer) { clearTimeout(conn._snapTimer); conn._snapTimer = null; }
    conn._pendingPos = null;
    conn._posFlushScheduled = false;
    conn._pendingSnap = null;
    conn._snapFlushScheduled = false;
  }

  function buildCompactPlayerPacket(st, slot) {
    if (!st) return null;
    const hp = typeof st.health === 'number' && isFinite(st.health)
      ? Math.max(0, Math.min(100, Math.round(st.health)))
      : 100;
    return {
      t: 'p',
      s: typeof slot === 'number' ? slot : 0,
      x: Math.round((Number(st.x) || 0) * 100) / 100,
      y: Math.round((Number(st.y) || 0) * 100) / 100,
      z: Math.round((Number(st.z) || 0) * 100) / 100,
      r: Math.round(wrapAngle(st.yaw) * 1000) / 1000,
      p: Math.round((Number(st.pitch) || 0) * 100) / 100,
      c: (st.crouch || 0) > 0.5 ? 1 : 0,
      fl: st.flashOn ? 1 : 0,
      cam: st.cameraUp ? 1 : 0,
      h: st.hidden ? 1 : 0,
      hs: (st.hidden && typeof st.hideSpotIdx === 'number') ? st.hideSpotIdx : -1,
      a: st.alive !== false ? 1 : 0,
      m: st.moving ? 1 : 0,
      sp: st.sprinting ? 1 : 0,
      hp,
    };
  }

  function expandCompactPlayerPacket(pkt, prev) {
    if (!pkt || typeof pkt !== 'object' || pkt.t !== 'p') return null;
    const x = Number(pkt.x), y = Number(pkt.y), z = Number(pkt.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
    const yaw = Number(pkt.r);
    const pitch = Number(pkt.p);
    const hidden = !!pkt.h;
    const moving = !!pkt.m;
    const sprinting = !!pkt.sp;
    const crouch = pkt.c ? 1 : 0;
    const hp = (typeof pkt.hp === 'number' && isFinite(pkt.hp))
      ? Math.max(0, Math.min(100, Math.round(pkt.hp)))
      : ((prev && typeof prev.health === 'number') ? prev.health : 100);
    return {
      type: 'p_state',
      id: typeof pkt.id === 'string' ? pkt.id : undefined,
      slot: typeof pkt.s === 'number' ? pkt.s : null,
      x,
      y,
      z,
      yaw: isFinite(yaw) ? yaw : ((prev && typeof prev.yaw === 'number') ? prev.yaw : 0),
      pitch: isFinite(pitch) ? pitch : ((prev && typeof prev.pitch === 'number') ? prev.pitch : 0),
      crouch,
      flashOn: !!pkt.fl,
      cameraUp: !!pkt.cam,
      hidden,
      hideSpotIdx: hidden ? (typeof pkt.hs === 'number' ? pkt.hs : ((prev && prev.hideSpotIdx !== undefined) ? prev.hideSpotIdx : -1)) : -1,
      alive: pkt.a !== 0,
      moving,
      sprinting,
      noiseRadius: moving ? (sprinting ? 35 : (crouch > 0.5 ? 4 : 15)) : 0,
      health: hp,
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
    micMuted: !!(LO.settings && LO.settings.micMutedPref),
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
    _lastHeartbeatAt: 0,
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
    buildCompactPlayerPacket,
    expandCompactPlayerPacket,
    POS_BUFFER_HIGH_WATER,
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

    enableVoice(opts) {
      const preserveMute = !!(opts && opts.preserveMute);
      if (this.voiceEnabled && this.localStream) {
        if (!preserveMute) this.setMicMuted(false);
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
        const startMuted = preserveMute
          ? !!(this.micMuted || (LO.settings && LO.settings.micMutedPref))
          : !!(LO.settings && LO.settings.micMutedPref);
        this.micMuted = startMuted;
        if (LO.Settings && LO.Settings.set) {
          LO.Settings.set('voiceAutoJoin', true);
          LO.Settings.set('micMutedPref', this.micMuted);
        }
        stream.getAudioTracks().forEach(t => { t.enabled = !this.micMuted; });
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

    disableVoice(preservePrefs) {
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
      if (!preservePrefs && LO.Settings && LO.Settings.set) {
        LO.Settings.set('voiceAutoJoin', false);
      }
      this.micMuted = !!(LO.settings && LO.settings.micMutedPref);
      this._broadcastVoiceState();
      this._emitVoiceChange();
    },

    setMicMuted(muted) {
      this.micMuted = !!muted;
      if (LO.Settings && LO.Settings.set) {
        LO.Settings.set('micMutedPref', this.micMuted);
      }
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.micMuted; });
      }
      if (this.micMuted) this.localSpeaking = false;
      if (this.isCoop()) this._broadcastVoiceState();
      this._emitVoiceChange();
    },

    toggleMicMute() {
      if (!this.isCoop()) {
        this.setMicMuted(!this.micMuted);
        return Promise.resolve(!this.micMuted);
      }
      if (!this.voiceEnabled || !this.localStream) {
        if (this.micMuted) {
          this.setMicMuted(false);
        }
        return this.enableVoice({ preserveMute: true });
      }
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
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this._lastPingSentAt = now;
      try {
        this.hostConn.send({ t: 'ping', ts: Math.round(now) });
        return true;
      } catch (e) {
        return false;
      }
    },

    sendTransformPacket(state, slot) {
      if (!state) return false;
      const useSlot = typeof slot === 'number' ? slot : this.localSlot;
      const pkt = buildCompactPlayerPacket(state, useSlot);
      if (!pkt) return false;
      if (this.mode === 'client') {
        return this._sendCoalescedPos(this.hostConn, pkt);
      }
      if (this.mode === 'host') {
        pkt.id = 'host';
        this.conns.forEach(conn => {
          if (conn && conn.open) this._sendCoalescedPos(conn, pkt);
        });
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
      this._lastHeartbeatAt = Date.now();
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
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), 4000) : null;
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
          signal: ac ? ac.signal : undefined,
        });
        if (!res || !res.ok) return;
        const json = await res.json();
        if (json && json.shutdown && this.mode === 'host' && !this._closing) {
          this.shutdownByAdmin(json.shutdownReason || 'Match shut down by Admin');
        }
      } catch (e) {} finally {
        if (timer) clearTimeout(timer);
      }
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
      }, 5000);
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
      if (useBeacon && !isAdmin && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify({ action: 'leave', roomId: code, hostToken: token })], { type: 'application/json' });
          navigator.sendBeacon('/api/rooms', blob);
          return;
        } catch (e) {}
      }
      if (typeof fetch === 'function') {
        const qs = new URLSearchParams({ roomId: code });
        if (token) qs.set('token', token);
        const headers = {};
        if (isAdmin) {
          qs.set('admin', '1');
          const adminSecret = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
          if (adminSecret) {
            headers['X-Admin-Secret'] = adminSecret;
            headers['Authorization'] = `Bearer ${adminSecret}`;
          }
        }
        fetch(`/api/rooms?${qs.toString()}`, {
          method: 'DELETE',
          headers,
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
          iceCandidatePoolSize: 4,
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
            if (LO.audio && LO.audio.syncMix) LO.audio.syncMix();
            if (LO.settings && LO.settings.voiceAutoJoin && this.isVoiceSupported()) {
              this.enableVoice({ preserveMute: true }).catch(() => {});
            }
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
      let verifyingAdmin = false;
      let closed = false;
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
                  conn.peerConnection.setConfiguration({ iceServers: cfg.iceServers, iceCandidatePoolSize: 4, iceTransportPolicy: 'all' });
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

      const admitClient = (msg, isAdminJoin, isAdminHidden, nowTs) => {
        if (closed || accepted) return;
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
        conn._lastSeen = nowTs || Date.now();
        this.conns.set(peerId, conn);
        const p = this._makePlayer(peerId, slot, msg.name, { hiddenAdmin: isAdminHidden });
        p.lastSeen = conn._lastSeen;
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
      };

      const drop = () => {
        closed = true;
        clearConnQueues(conn);
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
        try {
          if (!msg || typeof msg !== 'object') return;
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
            if (msg.type !== 'hello' || verifyingAdmin) return;
            const isAdminJoin = !!msg.adminJoin;
            const isAdminHidden = isAdminJoin && !!msg.adminHidden;
            if (!isAdminJoin) {
              admitClient(msg, false, false, now);
              return;
            }
            if (!msg.adminJoinToken || typeof fetch !== 'function') {
              rejectAndClose('Admin authorization required.');
              return;
            }
            verifyingAdmin = true;
            fetch('/api/rooms', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verify_admin_join',
                roomId: this.roomCode,
                hostToken: this._hostToken || '',
                adminJoinToken: msg.adminJoinToken,
              }),
              cache: 'no-store',
            }).then(res => (res && res.ok ? res.json() : null)).then(json => {
              verifyingAdmin = false;
              if (closed || accepted) return;
              if (json && json.authorized) {
                admitClient(msg, true, !!json.adminHidden && isAdminHidden, Date.now());
              } else {
                rejectAndClose('Admin authorization failed.');
              }
            }).catch(() => {
              verifyingAdmin = false;
              if (!closed && !accepted) rejectAndClose('Admin authorization failed.');
            });
            return;
          }

          if (msg.t === 'ping') {
            this.sendTo(peerId, { t: 'pong', ts: msg.ts });
            return;
          }

          if (msg.t === 'p') {
            if (seenPlayer && seenPlayer.hiddenAdmin) return;
            const prev = this.remoteStates.get(peerId);
            const st = expandCompactPlayerPacket(msg, prev);
            if (!st) return;
            st.id = peerId;
            if (seenPlayer && typeof seenPlayer.slot === 'number') st.slot = seenPlayer.slot;
            this.remoteStates.set(peerId, st);
            if (seenPlayer) {
              if (seenPlayer.alive !== false && !seenPlayer.left) {
                seenPlayer.alive = st.alive !== false;
              }
              seenPlayer.hidden = !!st.hidden;
              seenPlayer.hideSpotIdx = st.hidden ? st.hideSpotIdx : -1;
              if (typeof st.health === 'number') seenPlayer.health = st.health;
            }
            const fwd = Object.assign({}, msg, {
              id: peerId,
              s: (seenPlayer && typeof seenPlayer.slot === 'number') ? seenPlayer.slot : (typeof msg.s === 'number' ? msg.s : 1),
            });
            this.conns.forEach((otherConn, id) => {
              if (id !== peerId && otherConn && otherConn.open) {
                this._sendCoalescedPos(otherConn, fwd);
              }
            });
            if (this.onMessage) this.onMessage(peerId, st);
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
              this.broadcast({ type: 'lobby_sync', players: this.players.filter(pl => !pl.hiddenAdmin), version: this.hostVersion });
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
            if (typeof msg.health === 'number' && isFinite(msg.health)) prev.health = Math.max(0, Math.min(100, Math.round(msg.health)));
            if (msg.hideSpotIdx !== undefined) prev.hideSpotIdx = msg.hideSpotIdx;
            if (typeof msg.pitch === 'number' && isFinite(msg.pitch)) prev.pitch = msg.pitch;
            if (msg.hidden !== undefined) prev.hidden = !!msg.hidden;
            this.remoteStates.set(peerId, prev);
            if (p) {
              if (typeof msg.health === 'number' && isFinite(msg.health)) p.health = prev.health;
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
              if (typeof msg.health === 'number' && isFinite(msg.health)) p.health = msg.health;
            }
          }

          if (this.onMessage) this.onMessage(peerId, msg);
        } catch (err) {
          console.warn('[net] Host packet error:', err);
        }
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
                          conn.peerConnection.setConfiguration({ iceServers: cfg.iceServers, iceCandidatePoolSize: 4, iceTransportPolicy: 'all' });
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
                  adminJoinToken: joinOpts.adminJoinToken || '',
                });
              } catch (e) {}
            });

            conn.on('data', msg => {
              try {
                if (this.hostConn !== conn || !msg || typeof msg !== 'object') return;
                if (msg.type === 'reject') {
                  fail(msg.reason || 'Host rejected connection.');
                  return;
                }
                if (msg.type === 'ROOM_CLOSED' || msg.type === 'ADMIN_SHUTDOWN') {
                  clearTimeout(timer);
                  const reason = msg.reason || (msg.type === 'ADMIN_SHUTDOWN' ? 'Match shut down by Admin' : 'Room closed by host.');
                  const kind = msg.type === 'ADMIN_SHUTDOWN' ? 'admin' : 'closed';
                  this.hostConn = null;
                  clearConnQueues(conn);
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

                if (msg.t === 'pong') {
                  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                  const sent = (typeof msg.ts === 'number' && isFinite(msg.ts)) ? msg.ts : (this._lastPingSentAt || now);
                  const raw = Math.max(1, Math.round(now - sent));
                  this.pingMs = this.pingMs === null ? raw : Math.round(this.pingMs * 0.45 + raw * 0.55);
                  const me = this.getPlayer(this.localId);
                  if (me) me.ping = this.pingMs;
                  this._emitPing();
                  const deltaThreshold = this.inGame ? 12 : 6;
                  if (this._lastSyncedPing === null || Math.abs(this.pingMs - this._lastSyncedPing) >= deltaThreshold) {
                    this._lastSyncedPing = this.pingMs;
                    this.sendToHost({ type: 'ping_r', r: this.pingMs });
                  }
                  return;
                }

                if (msg.t === 'p') {
                  const slot = typeof msg.s === 'number' ? msg.s : 0;
                  const target = (typeof msg.id === 'string' && this.getPlayer(msg.id))
                    || this.players.find(pl => pl && pl.slot === slot && !pl.hiddenAdmin);
                  if (!target || target.id === this.localId) return;
                  const prev = this.remoteStates.get(target.id);
                  const st = expandCompactPlayerPacket(msg, prev);
                  if (!st) return;
                  st.id = target.id;
                  this.remoteStates.set(target.id, st);
                  if (!target.left) {
                    if (target.alive !== false) target.alive = st.alive !== false;
                    target.hidden = !!st.hidden;
                    target.hideSpotIdx = st.hidden ? st.hideSpotIdx : -1;
                    if (typeof st.health === 'number') target.health = st.health;
                  }
                  if (this.onMessage) this.onMessage(target.id, st);
                  return;
                }

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
                  if (LO.audio && LO.audio.syncMix) LO.audio.syncMix();
                  if (this.voiceEnabled) this._broadcastVoiceState();
                  else if (LO.settings && LO.settings.voiceAutoJoin && !this.localHiddenAdmin && this.isVoiceSupported()) {
                    this.enableVoice({ preserveMute: true }).catch(() => {});
                  }
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
                  if (typeof msg.health === 'number' && isFinite(msg.health)) prev.health = Math.max(0, Math.min(100, Math.round(msg.health)));
                  if (msg.hideSpotIdx !== undefined) prev.hideSpotIdx = msg.hideSpotIdx;
                  if (typeof msg.pitch === 'number' && isFinite(msg.pitch)) prev.pitch = msg.pitch;
                  if (msg.hidden !== undefined) prev.hidden = !!msg.hidden;
                  this.remoteStates.set(msg.id, prev);
                  const lp = this.getPlayer(msg.id);
                  if (lp && !lp.left) {
                    if (typeof msg.health === 'number' && isFinite(msg.health)) lp.health = prev.health;
                    if (msg.hideSpotIdx !== undefined) lp.hideSpotIdx = msg.hideSpotIdx;
                    if (msg.hidden !== undefined) lp.hidden = !!msg.hidden;
                  }
                  if (this.onMessage) this.onMessage(msg.id, Object.assign({}, prev, { type: 'p_meta' }));
                  return;
                }
                if (msg.type === 'world_snap' && Array.isArray(msg.players)) {
                  for (let i = 0; i < msg.players.length; i++) {
                    const ps = msg.players[i];
                    if (!ps || !ps.id || ps.id === this.localId) continue;
                    const hp = typeof ps.hp === 'number' ? ps.hp : (typeof ps.health === 'number' ? ps.health : undefined);
                    const alive = ps.a !== undefined ? !!ps.a : (ps.alive !== undefined ? ps.alive !== false : undefined);
                    const hidden = ps.h !== undefined ? !!ps.h : (ps.hidden !== undefined ? !!ps.hidden : undefined);
                    const hideSpotIdx = ps.hs !== undefined ? ps.hs : ps.hideSpotIdx;
                    const prev = this.remoteStates.get(ps.id) || { type: 'p_state', id: ps.id };
                    if (typeof hp === 'number' && isFinite(hp)) prev.health = Math.max(0, Math.min(100, Math.round(hp)));
                    if (alive !== undefined) prev.alive = alive;
                    if (hidden !== undefined) prev.hidden = hidden;
                    if (hideSpotIdx !== undefined) prev.hideSpotIdx = hidden === false ? -1 : hideSpotIdx;
                    if (typeof ps.x === 'number' && isFinite(ps.x)) prev.x = ps.x;
                    if (typeof ps.y === 'number' && isFinite(ps.y)) prev.y = ps.y;
                    if (typeof ps.z === 'number' && isFinite(ps.z)) prev.z = ps.z;
                    this.remoteStates.set(ps.id, prev);
                    const lp = this.getPlayer(ps.id);
                    if (lp && !lp.left) {
                      if (alive !== undefined && lp.alive !== false) lp.alive = alive;
                      if (hidden !== undefined) lp.hidden = hidden;
                      if (hideSpotIdx !== undefined) lp.hideSpotIdx = hidden === false ? -1 : hideSpotIdx;
                      if (typeof prev.health === 'number') lp.health = prev.health;
                    }
                  }
                }
                if (this.onMessage) this.onMessage('host', msg);
              } catch (err) {
                console.warn('[net] Client packet error:', err);
              }
            });

            conn.on('close', () => {
              clearConnQueues(conn);
              if (this.hostConn === conn) fail('Disconnected from host.');
            });
            conn.on('error', () => {
              clearConnQueues(conn);
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

    _flushCoalescedPos(conn) {
      if (!conn) return;
      conn._posFlushScheduled = false;
      if (conn._posTimer) { clearTimeout(conn._posTimer); conn._posTimer = null; }
      const pkt = conn._pendingPos;
      if (!pkt || !conn.open) { conn._pendingPos = null; return; }
      if (getConnBufferedAmount(conn) > POS_BUFFER_HIGH_WATER) {
        conn._posFlushScheduled = true;
        const dc = conn.dataChannel;
        if (dc && typeof dc.bufferedAmountLowThreshold === 'number' && !conn._hasBufLowHook && dc.addEventListener) {
          conn._hasBufLowHook = true;
          try {
            dc.bufferedAmountLowThreshold = 2048;
            dc.addEventListener('bufferedamountlow', () => {
              if (conn._pendingPos && conn.open) this._flushCoalescedPos(conn);
              if (conn._pendingSnap && conn.open) this._flushCoalescedSnap(conn);
            });
          } catch (e) {}
        }
        conn._posTimer = setTimeout(() => { this._flushCoalescedPos(conn); }, 35);
        return;
      }
      conn._pendingPos = null;
      try { conn.send(pkt); } catch (e) {}
    },

    _sendCoalescedPos(conn, pkt) {
      if (!conn || !conn.open || !pkt) return false;
      conn._pendingPos = pkt;
      if (conn._posFlushScheduled) return true;
      conn._posFlushScheduled = true;
      conn._posTimer = setTimeout(() => { this._flushCoalescedPos(conn); }, 0);
      return true;
    },

    _flushCoalescedSnap(conn) {
      if (!conn) return;
      conn._snapFlushScheduled = false;
      if (conn._snapTimer) { clearTimeout(conn._snapTimer); conn._snapTimer = null; }
      const pkt = conn._pendingSnap;
      if (!pkt || !conn.open) { conn._pendingSnap = null; return; }
      if (getConnBufferedAmount(conn) > POS_BUFFER_HIGH_WATER) {
        conn._snapFlushScheduled = true;
        conn._snapTimer = setTimeout(() => { this._flushCoalescedSnap(conn); }, 35);
        return;
      }
      conn._pendingSnap = null;
      try { conn.send(pkt); } catch (e) {}
    },

    _sendCoalescedSnap(conn, pkt) {
      if (!conn || !conn.open || !pkt) return false;
      conn._pendingSnap = pkt;
      if (conn._snapFlushScheduled) return true;
      conn._snapFlushScheduled = true;
      conn._snapTimer = setTimeout(() => { this._flushCoalescedSnap(conn); }, 0);
      return true;
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
      const isPos = !!(msg && msg.t === 'p');
      const isSnap = !!(msg && msg.type === 'world_snap');
      this.conns.forEach((conn, id) => {
        if (id === excludePeerId) return;
        if (conn && conn.open) {
          if (isPos) this._sendCoalescedPos(conn, msg);
          else if (isSnap) this._sendCoalescedSnap(conn, msg);
          else {
            try { conn.send(msg); } catch (e) {}
          }
        }
      });
    },

    sendToHost(msg) {
      if (this.mode !== 'client') return;
      if (this.hostConn && this.hostConn.open) {
        if (msg && msg.t === 'p') {
          this._sendCoalescedPos(this.hostConn, msg);
          return;
        }
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
      this.disableVoice(true);
      Array.from(this.voiceCalls.keys()).forEach(id => this._disposeVoiceEntry(id));
      this.voiceCalls.clear();
      this.voiceError = '';
      this.conns.forEach(conn => {
        clearConnQueues(conn);
        try { conn.close(); } catch (e) {}
      });
      this.conns.clear();
      if (this.hostConn) {
        clearConnQueues(this.hostConn);
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
      if (LO.audio && LO.audio.syncMix) LO.audio.syncMix();
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
      this.disableVoice(true);
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
      this.disableVoice(true);
      this._deleteRoomRegistry(false, true);
      this.broadcast({ type: 'ADMIN_SHUTDOWN', reason: msg });
      setTimeout(() => {
        this._teardownTransport();
        if (this.onForceExit) this.onForceExit(msg, 'admin');
      }, 120);
    },

    async authorizeAdminJoin(rawCode, adminHidden) {
      const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) throw new Error('Invalid room ID.');
      const adminSecret = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
      if (!adminSecret) throw new Error('Admin authorization required.');
      if (typeof fetch !== 'function') throw new Error('Network unavailable.');
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret,
          'Authorization': `Bearer ${adminSecret}`,
        },
        body: JSON.stringify({
          action: 'admin_join',
          roomId: code,
          adminHidden: !!adminHidden,
        }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res && res.status === 401) {
        if (LO.AdminAuth && LO.AdminAuth.clear) LO.AdminAuth.clear();
        throw new Error((json && json.error) || 'Admin authorization required.');
      }
      if (!res || !res.ok || !json || !json.adminJoinToken) {
        throw new Error((json && json.error) || 'Failed to authorize admin join.');
      }
      return json.adminJoinToken;
    },

    async adminRemoteShutdown(rawCode, reason) {
      const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return { ok: false, error: 'Invalid room ID.' };
      const adminSecret = (LO.AdminAuth && LO.AdminAuth.getToken) ? LO.AdminAuth.getToken() : '';
      if (!adminSecret) {
        return { ok: false, status: 401, error: 'Admin authorization required.' };
      }
      const msg = reason || 'Match shut down by Admin';
      let ok = false;
      let status = 0;
      let errMsg = '';
      if (typeof fetch === 'function') {
        try {
          const res = await fetch('/api/rooms', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Secret': adminSecret,
              'Authorization': `Bearer ${adminSecret}`,
            },
            body: JSON.stringify({ action: 'shutdown', roomId: code, reason: msg }),
            cache: 'no-store',
          });
          status = res ? res.status : 0;
          ok = !!(res && res.ok);
          if (!ok && res) {
            try {
              const j = await res.json();
              if (j && j.error) errMsg = j.error;
            } catch (e) {}
          }
        } catch (e) {
          errMsg = 'Network error reaching /api/rooms.';
        }
      }
      if (!ok) {
        if (status === 401 && LO.AdminAuth && LO.AdminAuth.clear) {
          LO.AdminAuth.clear();
        }
        return { ok: false, status, error: errMsg || 'Failed to shut down match.' };
      }
      if (this.mode === 'host' && this.roomCode === code) {
        this.shutdownByAdmin(msg);
        return { ok: true };
      }
      if (this.mode === 'client' && this.roomCode === code) {
        this.sendToHost({ type: 'ADMIN_SHUTDOWN', reason: msg });
        return { ok: true };
      }
      // Best-effort instant signaling nudge so host sees shutdown right away instead of waiting 5s
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
      return { ok: true };
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
    const syncHostHeartbeatOnResume = () => {
      if (Net.mode === 'host' && Net.roomCode && !Net._closing) {
        if ((Date.now() - (Net._lastHeartbeatAt || 0)) >= 4500) {
          Net._sendRoomHeartbeat(false);
        }
      }
    };
    window.addEventListener('focus', syncHostHeartbeatOnResume);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncHostHeartbeatOnResume();
      });
    }
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
