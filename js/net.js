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

    // Latency tracking state
    pingMs: null,
    _pingTimer: null,

    // Callbacks wired by main.js
    onLobbyUpdate: null,
    onStatus: null,
    onMessage: null,
    onPlayerJoin: null,
    onPlayerLeave: null,
    onDisconnect: null,
    onChat: null,
    onVoiceChange: null,
    onPingUpdate: null,

    sanitizeName,
    sanitizeChat,
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
    getAlivePlayers() {
      return this.players.filter(p => p.alive && !p.left);
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

    _makePlayer(id, slot, name) {
      return {
        id,
        slot,
        name: sanitizeName(name, slot),
        color: SLOT_COLORS[slot % SLOT_COLORS.length],
        jacketHex: JACKET_COLORS[slot % JACKET_COLORS.length],
        alive: true,
        hidden: false,
        hideSpotIdx: -1,
        health: 100,
        left: false,
        ready: false,
        hasMic: false,
        muted: false,
        ping: id === 'host' ? 0 : null,
      };
    },

    setLocalName(name) {
      this.localName = sanitizeName(name, this.localSlot);
      if (this.mode === 'host') {
        const me = this.getPlayer('host');
        if (me) me.name = this.localName;
        this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
        this._emitLobby();
      } else if (this.mode === 'client' && this.hostConn && this.hostConn.open) {
        this.sendToHost({ type: 'rename', name: this.localName });
      }
    },

    setHostVersion(ver) {
      if (!ver || this.mode !== 'host') return;
      this.hostVersion = ver;
      this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
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
        call.answer();
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
        if (p && p.id !== this.localId && !p.left) validIds.add(p.id);
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
      const spatialActive = !!(inWorld && !inCutscene && listenerPos && getRemotePos);

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
        } else if (entry.panner && ctx && listenerPos) {
          if (entry.panner.positionX) {
            entry.panner.positionX.setValueAtTime(listenerPos.x, ctxNow);
            entry.panner.positionY.setValueAtTime(listenerPos.y, ctxNow);
            entry.panner.positionZ.setValueAtTime(listenerPos.z, ctxNow);
          } else if (entry.panner.setPosition) {
            entry.panner.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
          }
        }

        if (p.muted) att = 0;
        entry.distance = dist;
        entry.volume = att;

        if (ctx) {
          if (entry.flatGain) {
            // In cutscenes, lobby, credits, and death screens, route through flatGain so
            // camera cuts and HRTF distance never pan or quiet teammates.
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

    _startPingLoop() {
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      if (this.mode !== 'client') return;
      const sendPing = () => {
        if (this.mode !== 'client' || !this.hostConn || !this.hostConn.open) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        try {
          this.hostConn.send({ type: 'net_ping', t: now, r: this.pingMs });
        } catch (e) {}
      };
      sendPing();
      this._pingTimer = setInterval(sendPing, 2000);
    },

    // ============================================================
    //  HOST / JOIN
    // ============================================================
    async _loadIceConfig() {
      const now = Date.now();
      if (this._iceCache && now < this._iceCache.expiresAt) {
        return this._iceCache.data;
      }
      const fallback = { iceServers: DEFAULT_ICE_SERVERS, hasTurn: false, peerOpts: null };
      if (typeof fetch !== 'function' || typeof window === 'undefined') {
        this.hasTurn = false;
        return fallback;
      }
      try {
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ac ? setTimeout(() => ac.abort(), 2500) : null;
        const res = await fetch('/api/ice', Object.assign({ cache: 'no-store' }, ac ? { signal: ac.signal } : {}));
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) throw new Error('ice endpoint unavailable');
        const json = await res.json();
        const servers = (json && Array.isArray(json.iceServers) && json.iceServers.length)
          ? json.iceServers
          : DEFAULT_ICE_SERVERS;
        const data = {
          iceServers: servers,
          hasTurn: !!(json && json.hasTurn),
          peerOpts: (json && json.peerOpts && typeof json.peerOpts === 'object') ? json.peerOpts : null,
        };
        this.hasTurn = data.hasTurn;
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
      this.hostVersion = gameVersion || (LO.settings && LO.settings.gameVersion) || '2.8.3';
      this.inGame = false;
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

      if (conn && conn.on) {
        conn.on('iceStateChanged', st => {
          if (st === 'failed' && !restartedIce && conn.peerConnection && conn.peerConnection.restartIce) {
            restartedIce = true;
            try { conn.peerConnection.restartIce(); } catch (e) {}
          }
        });
      }

      const rejectAndClose = reason => {
        try { conn.send({ type: 'reject', reason }); } catch (e) {}
        setTimeout(() => { try { conn.close(); } catch (e) {} }, 150);
      };

      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (!accepted) {
          if (msg.type !== 'hello') return;
          if (this.inGame) {
            rejectAndClose('Run already in progress.');
            return;
          }
          const slot = this._nextFreeSlot();
          if (slot < 0 || this.players.length >= MAX_PLAYERS) {
            rejectAndClose('Room is full (max 4 players).');
            return;
          }
          accepted = true;
          this.conns.set(peerId, conn);
          const p = this._makePlayer(peerId, slot, msg.name);
          this.players.push(p);
          try {
            conn.send({
              type: 'welcome',
              localId: peerId,
              slot,
              roomCode: this.roomCode,
              version: this.hostVersion,
              players: this.players,
            });
          } catch (e) {}
          this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion }, peerId);
          this._emitLobby();
          if (this.onPlayerJoin) this.onPlayerJoin(p);
          return;
        }

        if (msg.type === 'net_ping') {
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

        if (msg.type === 'p_state') {
          this.remoteStates.set(peerId, msg);
          const p = this.getPlayer(peerId);
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

      const drop = () => {
        if (!accepted) return;
        accepted = false;
        this.conns.delete(peerId);
        this.remoteStates.delete(peerId);
        this._disposeVoiceEntry(peerId);
        const idx = this.players.findIndex(p => p.id === peerId);
        if (idx >= 0) {
          const removed = this.players[idx];
          if (this.inGame) {
            removed.left = true;
            removed.alive = false;
            removed.hidden = false;
            removed.hideSpotIdx = -1;
            this._emitLobby();
            if (this.onMessage) this.onMessage(peerId, { type: 'player_left', id: peerId });
          } else {
            this.players.splice(idx, 1);
            this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
            this._emitLobby();
          }
          if (this.onPlayerLeave) this.onPlayerLeave(removed);
        }
        this._emitVoiceChange();
      };

      conn.on('close', drop);
      conn.on('error', drop);
    },

    join(rawCode, name) {
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

      const seq = ++this._connectSeq;
      this.mode = 'client';
      this.roomCode = code;
      this.localName = sanitizeName(name, 1);
      this.inGame = false;
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
                  if (!restartedIce && conn.peerConnection && conn.peerConnection.restartIce) {
                    restartedIce = true;
                    try { conn.peerConnection.restartIce(); return; } catch (e) {}
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
                conn.send({ type: 'hello', name: this.localName });
              } catch (e) {}
            });

            conn.on('data', msg => {
              if (this.hostConn !== conn || !msg || typeof msg !== 'object') return;
              if (msg.type === 'reject') {
                fail(msg.reason || 'Host rejected connection.');
                return;
              }
              if (msg.type === 'welcome') {
                clearTimeout(timer);
                this.localId = msg.localId;
                this.localSlot = msg.slot;
                this.roomCode = msg.roomCode || code;
                this.hostVersion = msg.version || null;
                this.players = Array.isArray(msg.players) ? msg.players : [];
                this._emitStatus(`Connected to room ${this.roomCode}`);
                this._emitLobby();
                this._startPingLoop();
                if (this.voiceEnabled) this._broadcastVoiceState();
                if (!settled) {
                  settled = true;
                  resolve(this.roomCode);
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

    leave() {
      this._connectSeq++;
      if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
      this.pingMs = null;
      this._notifyLeaving();
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
      this.players = [];
      this.remoteStates.clear();
      this._emitPing();
    },
  };

  LO.Net = Net;

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      if (!Net.inGame) return;
      if (Net.mode === 'host') Net.broadcast({ type: 'player_left', id: Net.localId });
      else if (Net.mode === 'client') Net.sendToHost({ type: 'player_left', id: Net.localId });
    });
  }
})();
