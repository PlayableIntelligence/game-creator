import { Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

export class RoundSync {
  constructor({ scene, eventBus, networkManager }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.networkManager = networkManager;
    this._handlers = {};
    this._lastBroadcastRound = -1;
    this._wire();
  }

  destroy() {
    this.eventBus.off(Events.ROUND_ENDED, this._handlers.ended);
    this.eventBus.off('network:round:over', this._handlers.netOver);
  }

  _wire() {
    this._handlers.ended = (data) => this._onLocalRoundEnded(data);
    this._handlers.netOver = (msg) => this._onNetworkRoundOver(msg);

    this.eventBus.on(Events.ROUND_ENDED, this._handlers.ended);
    this.eventBus.on('network:round:over', this._handlers.netOver);
  }

  _onLocalRoundEnded(data) {
    if (!this.networkManager?.isConnected?.()) return;
    if (this._lastBroadcastRound === gameState.roundNumber) return;
    this._lastBroadcastRound = gameState.roundNumber;
    this.networkManager.sendCustom('round:over', {
      roundNumber: gameState.roundNumber,
      winnerColor: data?.winnerColor ?? null,
      t: Date.now(),
    });
  }

  _onNetworkRoundOver({ payload }) {
    if (!payload) return;
    const { roundNumber, winnerColor } = payload;
    if (typeof roundNumber !== 'number') return;
    if (gameState.roundState === 'round_over') return;
    if (roundNumber !== gameState.roundNumber) return;
    this._lastBroadcastRound = roundNumber;
    if (this.scene.roundSystem) {
      this.scene.roundSystem.endRound(winnerColor ?? null);
    }
  }

}
