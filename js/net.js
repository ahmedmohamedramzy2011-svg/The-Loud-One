// ============================================================
//  THE LOUD ONE — PeerJS (WebRTC) Co-op Networking Layer
// ============================================================
window.LO = window.LO || {};

(function () {
  const PREFIX = 'loudone-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_PLAYERS = 4;
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const SLOT_COLORS = ['#4a78a8', '#5c8a52', '#a86544', '#856094'];
  const JACKET_COLORS = [0x365270, 0x455e3d, 0x73442d, 0x563f61];

  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }

  function sanitizeName(raw, slot) {
    const clean = String(raw || '').replace(/[^\w \-\.]/g, '').trim().slice(0, 16);
    return clean || `Investigator ${(slot || 0) + 1}`;
  }

  const Net = {
    mode: 'solo',        // 'solo' | 'host' | 'client'
    roomCode: '',
    localId: 'host',
    localSlot: 0,
    localName: 'Investigator 1',
    hostVersion: null,
    inGame: false,
    peer: null,
    hostConn: null,
    conns: new Map(),    // peerId -> DataConnection (host only)
    players: [],         // [{ id, slot, name, color, jacketHex, alive, hidden, hideSpotIdx }]
    remoteStates: new Map(),

    // Callbacks wired by main.js
    onLobbyUpdate: null,
    onStatus: null,
    onMessage: null,
    onPlayerJoin: null,
    onPlayerLeave: null,
    onDisconnect: null,

    SLOT_COLORS,
    JACKET_COLORS,
    MAX_PLAYERS,

    isCoop() { return this.mode !== 'solo'; },
    isHost() { return this.mode === 'host'; },
    isClient() { return this.mode === 'client'; },
    isSolo() { return this.mode === 'solo'; },

    getPlayer(id) {
      return this.players.find(p => p.id === id) || null;
    },
    getAlivePlayers() {
      return this.players.filter(p => p.alive);
    },

    _emitStatus(msg, isError) {
      if (this.onStatus) this.onStatus(msg, !!isError);
    },

    _emitLobby() {
      if (this.onLobbyUpdate) this.onLobbyUpdate(this.players.slice(), this.roomCode);
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
        ready: false,
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

    host(name, gameVersion) {
      this.leave();
      if (typeof Peer === 'undefined') {
        this._emitStatus('PeerJS library failed to load.', true);
        return Promise.reject(new Error('PeerJS missing'));
      }
      this.mode = 'host';
      this.localId = 'host';
      this.localSlot = 0;
      this.localName = sanitizeName(name, 0);
      this.hostVersion = gameVersion || (LO.settings && LO.settings.gameVersion) || '2.8.2';
      this.inGame = false;
      this.players = [this._makePlayer('host', 0, this.localName)];
      this.remoteStates.clear();

      return new Promise((resolve, reject) => {
        let attempts = 0;
        const tryCreate = () => {
          if (this.mode !== 'host') return;
          attempts++;
          const code = genCode();
          this.roomCode = code;
          this._emitStatus('Creating co-op room...');
          let settled = false;
          const peer = new Peer(PREFIX + code, {
            config: { iceServers: ICE_SERVERS },
          });
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
        tryCreate();
      });
    },

    _handleIncomingClient(conn) {
      const peerId = conn.peer;
      let accepted = false;

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

        if (msg.type === 'rename') {
          const p = this.getPlayer(peerId);
          if (p) {
            p.name = sanitizeName(msg.name, p.slot);
            this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
            this._emitLobby();
          }
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
        }
      }

      if (this.onMessage) this.onMessage(peerId, msg);
    });

    const drop = () => {
      if (!accepted) return;
      accepted = false;
      this.conns.delete(peerId);
      this.remoteStates.delete(peerId);
      const idx = this.players.findIndex(p => p.id === peerId);
      if (idx >= 0) {
        const removed = this.players[idx];
        if (this.inGame) {
          removed.left = true;
          removed.alive = false;
          this._emitLobby();
          if (this.onMessage) this.onMessage(peerId, { type: 'player_left', id: peerId });
        } else {
          this.players.splice(idx, 1);
          this.broadcast({ type: 'lobby_sync', players: this.players, version: this.hostVersion });
          this._emitLobby();
        }
        if (this.onPlayerLeave) this.onPlayerLeave(removed);
      }
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

      this.mode = 'client';
      this.roomCode = code;
      this.localName = sanitizeName(name, 1);
      this.inGame = false;
      this.players = [];
      this.remoteStates.clear();

      return new Promise((resolve, reject) => {
        let settled = false;
        this._emitStatus(`Connecting to ${code}...`);
        const peer = new Peer(undefined, {
          config: { iceServers: ICE_SERVERS },
        });
        this.peer = peer;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            this._emitStatus('Connection timed out. Check the room code and try again.', true);
            this.leave();
            reject(new Error('Connection timeout'));
          }
        }, 14000);

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

        peer.on('open', () => {
          if (this.peer !== peer) return;
          const conn = peer.connect(PREFIX + code, { reliable: true });
          this.hostConn = conn;

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
              if (!settled) {
                settled = true;
                resolve(this.roomCode);
              }
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
                  if (this.onPlayerLeave) this.onPlayerLeave({ id });
                }
              });
              this._emitLobby();
              return;
            }
            if (msg.type === 'world_snap' && Array.isArray(msg.players)) {
              for (let i = 0; i < msg.players.length; i++) {
                const ps = msg.players[i];
                if (!ps || ps.id === this.localId) continue;
                this.remoteStates.set(ps.id, ps);
                const lp = this.getPlayer(ps.id);
                if (lp) {
                  lp.alive = ps.alive !== false;
                  lp.hidden = !!ps.hidden;
                  lp.hideSpotIdx = ps.hideSpotIdx !== undefined ? ps.hideSpotIdx : -1;
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
    this._notifyLeaving();
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
  }
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
