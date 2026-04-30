import { SPAWNS, PX } from '../core/Constants.js';
import { Events } from '../core/EventBus.js';

const MAX_CORNERS = SPAWNS.length;

export class SpawnSystem {
  constructor({ eventBus, gameState }) {
    this.eventBus = eventBus;
    this.gameState = gameState;
    this.assignments = [];
    this.localCornerIndex = 0;
    this._handlers = {};
    this._knownIds = new Set();

    this._wireEvents();
    this._recompute();
  }

  destroy() {
    this.eventBus.off(Events.NETWORK_CONNECTED, this._handlers.connected);
    this.eventBus.off(Events.NETWORK_PLAYER_JOINED, this._handlers.joined);
    this.eventBus.off(Events.NETWORK_PLAYER_LEFT, this._handlers.left);
    this.eventBus.off(Events.NETWORK_DISCONNECTED, this._handlers.disconnected);
    this.eventBus.off(Events.NETWORK_STATE_RECEIVED, this._handlers.state);
  }

  _wireEvents() {
    this._handlers.connected = () => this._recompute();
    this._handlers.joined = () => this._recompute();
    this._handlers.left = () => this._recompute();
    this._handlers.disconnected = () => this._recompute();
    // After a prune-then-restate, the registry may re-add a player without
    // firing NETWORK_PLAYER_JOINED. Trigger recompute on state too — but only
    // when assignments would actually change (the dedupe in _recompute makes
    // this safe).
    this._handlers.state = ({ playerId }) => {
      if (!this._knownIds.has(playerId)) this._recompute();
    };

    this.eventBus.on(Events.NETWORK_CONNECTED, this._handlers.connected);
    this.eventBus.on(Events.NETWORK_PLAYER_JOINED, this._handlers.joined);
    this.eventBus.on(Events.NETWORK_PLAYER_LEFT, this._handlers.left);
    this.eventBus.on(Events.NETWORK_DISCONNECTED, this._handlers.disconnected);
    this.eventBus.on(Events.NETWORK_STATE_RECEIVED, this._handlers.state);
  }

  _recompute() {
    const mp = this.gameState.multiplayer;
    const localId = mp?.playerId ?? null;
    const localJoinedAt = mp?.joinedAt ?? null;

    const participants = [];
    if (localId && localJoinedAt != null) {
      participants.push({ playerId: localId, joinedAt: localJoinedAt, isLocal: true });
    }
    if (mp?.remotePlayers) {
      for (const [id, p] of Object.entries(mp.remotePlayers)) {
        if (id === localId) continue;
        const joinedAt = typeof p.joinedAt === 'number'
          ? p.joinedAt
          : Number.MAX_SAFE_INTEGER;
        participants.push({ playerId: id, joinedAt, isLocal: false });
      }
    }

    participants.sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
      return a.playerId < b.playerId ? -1 : 1;
    });

    const next = [];
    for (let i = 0; i < MAX_CORNERS; i++) {
      const spawn = SPAWNS[i];
      const occupant = participants[i];
      next.push({
        index: i,
        cornerId: `p${i + 1}`,
        color: spawn.color,
        x: spawn.x * PX,
        y: spawn.y * PX,
        rotation: spawn.facing,
        playerId: occupant ? occupant.playerId : null,
        isLocal: occupant ? occupant.isLocal : false,
      });
    }

    let localIdx = 0;
    for (const a of next) {
      if (a.isLocal) { localIdx = a.index; break; }
    }

    const changed = !this._sameAssignments(this.assignments, next);
    this.assignments = next;
    this.localCornerIndex = localIdx;
    this._knownIds = new Set(participants.map(p => p.playerId));

    if (changed) {
      this.eventBus.emit('spawn:assignments-changed', { assignments: next.slice() });
    }
  }

  _sameAssignments(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].playerId !== b[i].playerId) return false;
      if (a[i].isLocal !== b[i].isLocal) return false;
    }
    return true;
  }

  getAssignments() {
    return this.assignments.slice();
  }

  getCornerForPlayerId(playerId) {
    if (!playerId) return null;
    return this.assignments.find(a => a.playerId === playerId) ?? null;
  }

  getCornerByIndex(index) {
    return this.assignments[index] ?? null;
  }

  getLocalCornerIndex() {
    return this.localCornerIndex;
  }
}
