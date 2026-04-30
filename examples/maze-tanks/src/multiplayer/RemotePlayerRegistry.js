export class RemotePlayerRegistry {
  constructor(gameState) {
    this.gameState = gameState;
  }

  upsert(playerId, partial) {
    // Defensive: a malformed network message could pass non-string ids
    // here (object, undefined, __proto__, etc.). Reject anything that
    // isn't a plain string with content.
    if (typeof playerId !== 'string' || !playerId) return;
    const existing = this.gameState.multiplayer.remotePlayers[playerId] ?? {};
    this.gameState.multiplayer.remotePlayers[playerId] = {
      ...existing,
      ...partial,
      lastSeenTs: Date.now(),
    };
  }

  remove(playerId) {
    if (typeof playerId !== 'string' || !playerId) return;
    delete this.gameState.multiplayer.remotePlayers[playerId];
  }

  has(playerId) {
    if (typeof playerId !== 'string' || !playerId) return false;
    return playerId in this.gameState.multiplayer.remotePlayers;
  }

  list() {
    return Object.entries(this.gameState.multiplayer.remotePlayers).map(([id, p]) => ({ id, ...p }));
  }

  prune(staleMs) {
    const now = Date.now();
    const pruned = [];
    for (const [id, p] of Object.entries(this.gameState.multiplayer.remotePlayers)) {
      if (now - (p.lastSeenTs ?? 0) > staleMs) {
        pruned.push(id);
        delete this.gameState.multiplayer.remotePlayers[id];
      }
    }
    return pruned;
  }

  clear() {
    this.gameState.multiplayer.remotePlayers = {};
  }
}
