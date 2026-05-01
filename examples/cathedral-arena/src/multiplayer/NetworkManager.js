import PartySocket from 'partysocket';
import { MULTIPLAYER } from '../core/Constants.js';

/**
 * NetworkManager — thin partysocket wrapper for cathedral-arena.
 *
 * Pattern follows skills/add-multiplayer/client-integration.md but slimmed
 * down for one-shot demo use: callbacks instead of EventBus events, no
 * room-switch handoff (you reload the page to change rooms).
 *
 * Wire format (matches multiplayer-server/src/server.ts):
 *   client → server:
 *     { type: "state",  state: { x, y, z, yaw, hp, alive } }
 *     { type: "attack", attack: { origin, facing, reach, hits[], damage } }
 *   server → client:
 *     { type: "welcome",       playerId, peers: [{playerId, state?}] }
 *     { type: "player-joined", playerId }
 *     { type: "player-left",   playerId }
 *     { type: "state",         playerId, state }
 *     { type: "attack",        playerId, attack }
 *
 * Single-player fallback: if the server is unreachable, callbacks fire on
 * onDisconnected and the rest of the game continues to work locally.
 */
export class NetworkManager {
  constructor({
    url, room,
    onConnected, onDisconnected,
    onPlayerJoined, onPlayerLeft,
    onState, onAttack, onDamage,
  }) {
    this.url = url;
    this.room = room;
    this.onConnected    = onConnected    ?? (() => {});
    this.onDisconnected = onDisconnected ?? (() => {});
    this.onPlayerJoined = onPlayerJoined ?? (() => {});
    this.onPlayerLeft   = onPlayerLeft   ?? (() => {});
    this.onState        = onState        ?? (() => {});
    this.onAttack       = onAttack       ?? (() => {});
    this.onDamage       = onDamage       ?? (() => {});

    this.socket = null;
    this.connected = false;
    this.playerId = null;
  }

  connect() {
    let host;
    try {
      host = new URL(this.url).host;
    } catch {
      console.warn('[NetworkManager] invalid SERVER_URL:', this.url);
      this.onDisconnected();
      return;
    }
    try {
      this.socket = new PartySocket({ host, room: this.room });
    } catch (err) {
      console.warn('[NetworkManager] PartySocket constructor threw:', err);
      this.onDisconnected();
      return;
    }
    this.socket.addEventListener('open',    () => { /* await welcome */ });
    this.socket.addEventListener('close',   () => this._onClose());
    this.socket.addEventListener('error',   () => { /* close will follow */ });
    this.socket.addEventListener('message', (ev) => this._onMessage(ev));
  }

  disconnect() {
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.connected = false;
  }

  sendState(state) {
    if (!this.connected) return;
    try { this.socket.send(JSON.stringify({ type: 'state', state })); } catch {}
  }

  sendAttack(attack) {
    if (!this.connected) return;
    try { this.socket.send(JSON.stringify({ type: 'attack', attack })); } catch {}
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId;
        this.connected = true;
        this.onConnected(this.playerId);
        // Spawn placeholders for every peer the server already knows about
        for (const p of (msg.peers ?? [])) {
          this.onPlayerJoined({ playerId: p.playerId, state: p.state });
        }
        return;
      }
      case 'player-joined': return this.onPlayerJoined({ playerId: msg.playerId });
      case 'player-left':   return this.onPlayerLeft(msg.playerId);
      case 'state':         return this.onState(msg.playerId, msg.state);
      case 'attack':        return this.onAttack(msg.playerId, msg.attack);
      case 'damage':        return this.onDamage(msg.playerId, msg.hp);
      default:              return;
    }
  }

  _onClose() {
    this.connected = false;
    this.playerId = null;
    this.onDisconnected();
  }
}
