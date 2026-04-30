import { ROUND, COLORS, UI, GAME } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

export class RoundSystem {
  constructor(scene) {
    this.scene = scene;
    this.banner = null;
    this.subBanner = null;
    this.lastCountdownSecond = -1;
  }

  startCountdown() {
    gameState.roundState = 'countdown';
    gameState.countdownEndsAt = performance.now() + ROUND.COUNTDOWN_MS;
    this.lastCountdownSecond = -1;
    this.showBanner('GET READY', '');
    eventBus.emit(Events.ROUND_COUNTDOWN, {
      secondsLeft: Math.ceil(ROUND.COUNTDOWN_MS / 1000),
    });
  }

  startPlaying() {
    gameState.roundState = 'playing';
    this.hideBanner();
    eventBus.emit(Events.ROUND_STARTED, { roundNumber: gameState.roundNumber });
    eventBus.emit(Events.MUSIC_GAMEPLAY);
  }

  endRound(winnerColor) {
    if (gameState.roundState === 'round_over') return;
    gameState.roundState = 'round_over';
    gameState.recordWin(winnerColor);
    gameState.restartAt = performance.now() + ROUND.RESTART_DELAY_MS;

    const label = winnerColor ? `${winnerColor} WINS` : 'DRAW';
    this.showBanner(label, 'next round in 3...');
    eventBus.emit(Events.ROUND_ENDED, { winnerColor });
    eventBus.emit(Events.SPECTACLE_STREAK, { winnerColor });
    eventBus.emit(Events.MUSIC_STOP);
  }

  update(now) {
    if (gameState.roundState === 'countdown') {
      const remainingMs = gameState.countdownEndsAt - now;
      if (remainingMs <= 0) {
        this.startPlaying();
      } else {
        const sec = Math.ceil(remainingMs / 1000);
        if (sec !== this.lastCountdownSecond) {
          this.lastCountdownSecond = sec;
          this.showBanner('GET READY', String(sec));
          eventBus.emit(Events.ROUND_COUNTDOWN, { secondsLeft: sec });
        }
      }
    } else if (gameState.roundState === 'round_over') {
      const remainingMs = gameState.restartAt - now;
      if (remainingMs <= 0) {
        gameState.roundNumber += 1;
        this.scene.beginNewRound();
      } else {
        const sec = Math.max(1, Math.ceil(remainingMs / 1000));
        const winner = gameState.lastWinnerColor;
        const label = winner ? `${winner} WINS` : 'DRAW';
        this.showBanner(label, `next round in ${sec}...`);
      }
    }
  }

  showBanner(title, subtitle) {
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;
    const titleSize = Math.round(GAME.HEIGHT * UI.TITLE_RATIO);
    const subSize = Math.round(GAME.HEIGHT * UI.BODY_RATIO);

    if (!this.banner) {
      this.banner = this.scene.add.text(cx, cy - titleSize, title, {
        fontSize: titleSize + 'px',
        fontFamily: UI.FONT,
        color: COLORS.UI_TEXT,
        fontStyle: 'bold',
        stroke: '#000',
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 4, color: 'rgba(0,0,0,0.6)', blur: 12, fill: true },
      }).setOrigin(0.5).setDepth(1000);
      this.subBanner = this.scene.add.text(cx, cy + titleSize * 0.4, subtitle, {
        fontSize: subSize + 'px',
        fontFamily: UI.FONT,
        color: COLORS.UI_TEXT,
        stroke: '#000',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(1000);
    } else {
      this.banner.setText(title);
      this.subBanner.setText(subtitle);
      this.banner.setVisible(true);
      this.subBanner.setVisible(true);
    }
  }

  hideBanner() {
    if (this.banner) this.banner.setVisible(false);
    if (this.subBanner) this.subBanner.setVisible(false);
  }
}
