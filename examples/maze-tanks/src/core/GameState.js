const WINS_DEFAULT = { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0 };

class GameState {
  constructor() {
    this.isMuted = localStorage.getItem('muted') === 'true';
    this.wins = { ...WINS_DEFAULT };
    this.roundNumber = 1;

    // === Multiplayer ===
    // Persistent across reset() — preserved so a round restart rejoins the same room.
    // Transient (connected, remotePlayers) cleared by reset().
    this.multiplayer = {
      roomId: 'lobby',
      playerId: null,
      joinedAt: null,
      connected: false,
      remotePlayers: {},
    };

    this.reset();
  }

  reset() {
    this.roundState = 'countdown';
    this.countdownEndsAt = 0;
    this.restartAt = 0;
    this.lastWinnerColor = null;

    // === Multiplayer (transient only) ===
    if (this.multiplayer) {
      this.multiplayer.connected = false;
      this.multiplayer.remotePlayers = {};
      // roomId and playerId persist intentionally.
    }
  }

  recordWin(color) {
    if (color && this.wins[color] !== undefined) {
      this.wins[color] += 1;
    }
    this.lastWinnerColor = color;
  }

  resetWins() {
    this.wins = { ...WINS_DEFAULT };
    this.roundNumber = 1;
  }
}

export const gameState = new GameState();
