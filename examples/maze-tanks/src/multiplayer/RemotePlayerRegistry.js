export class RemotePlayerRegistry {
  constructor(gameState) {
    this.gameState = gameState;
  }

  upsert(playerId, partial) {
    const existing = this.gameState.multiplayer.remotePlayers[playerId] ?? {};
    this.gameState.multiplayer.remotePlayers[playerId] = {
      ...existing,
      ...partial,
      lastSeenTs: Date.now(),
    };
  }

  remove(playerId) {
    delete this.gameState.multiplayer.remotePlayers[playerId];
  }

  has(playerId) {
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
