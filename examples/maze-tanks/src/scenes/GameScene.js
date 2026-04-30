import Phaser from 'phaser';
import { GAME, MAZE, COLORS, UI, PX, SPAWNS } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { Tank } from '../entities/Tank.js';
import { Bullet } from '../entities/Bullet.js';
import { MazeSystem } from '../systems/MazeSystem.js';
import { RoundSystem } from '../systems/RoundSystem.js';
import { PolishSystem } from '../systems/PolishSystem.js';
import { SpawnSystem } from '../systems/SpawnSystem.js';
import { BulletNetSync } from '../systems/BulletNetSync.js';
import { RoundSync } from '../systems/RoundSync.js';

const REMOTE_INTERPOLATE_MS = 100;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.BG);

    const mazeW = MAZE.COLS * MAZE.TILE_SIZE * PX;
    const mazeH = MAZE.ROWS * MAZE.TILE_SIZE * PX;
    this.mazeOffsetX = (GAME.WIDTH - mazeW) / 2;
    this.mazeOffsetY = (GAME.HEIGHT - mazeH) / 2;

    this.world = this.add.container(this.mazeOffsetX, this.mazeOffsetY);
    this.mazeSystem = new MazeSystem(this, this.world);

    this.tanks = [];
    this.bullets = [];
    this.tanksByCorner = new Array(SPAWNS.length).fill(null);
    this._remoteTargets = new Map();
    this._remoteLabels = new Map();

    this.spawnSystem = new SpawnSystem({ eventBus, gameState });

    this.spawnTanks();
    this.setupInput();

    this.roundSystem = new RoundSystem(this);
    this.polishSystem = new PolishSystem(this);
    this.roundSystem.startCountdown();

    this.bulletNetSync = new BulletNetSync({
      scene: this,
      eventBus,
      networkManager: window.__NETWORK_MANAGER__ ?? null,
      gameState,
    });
    this.roundSync = new RoundSync({
      scene: this,
      eventBus,
      networkManager: window.__NETWORK_MANAGER__ ?? null,
    });

    this._onTankFired = (data) => {
      const bullet = new Bullet(this, {
        shooterId: data.shooterId,
        shooterColor: data.shooterColor,
        x: data.x,
        y: data.y,
        vx: data.vx,
        vy: data.vy,
        mazeSystem: this.mazeSystem,
      });
      bullet.sprite.setPosition(data.x, data.y);
      this.world.add(bullet.sprite);
      this.bullets.push(bullet);
    };
    eventBus.on(Events.TANK_FIRED, this._onTankFired);

    this._onAssignmentsChanged = ({ assignments }) => this._applyAssignments(assignments);
    eventBus.on('spawn:assignments-changed', this._onAssignmentsChanged);
    // Re-sync after listener is registered: covers the race where the network
    // welcome arrived between spawnTanks() and listener registration. Also
    // safe to call repeatedly — _applyAssignments only acts on diffs.
    this._applyAssignments(this.spawnSystem.getAssignments());

    this._onNetworkState = ({ playerId, state }) => this._onRemoteState(playerId, state);
    eventBus.on(Events.NETWORK_STATE_RECEIVED, this._onNetworkState);

    this.hud = this.add.text(GAME.WIDTH / 2, 8 * PX, '', {
      fontSize: Math.round(GAME.HEIGHT * UI.SMALL_RATIO) + 'px',
      fontFamily: UI.FONT,
      color: COLORS.UI_TEXT,
      stroke: '#000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(500);
    this.updateHud();

    // Stable refs so SHUTDOWN can `off()` them. Without this, scene restart
    // leaks listeners that retain the old GameScene and call updateHud()
    // after this.hud is gone.
    this._onTankDiedHud = () => this.updateHud();
    this._onRoundEndedHud = () => this.updateHud();
    eventBus.on(Events.TANK_DIED, this._onTankDiedHud);
    eventBus.on(Events.ROUND_ENDED, this._onRoundEndedHud);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      eventBus.off(Events.TANK_FIRED, this._onTankFired);
      eventBus.off('spawn:assignments-changed', this._onAssignmentsChanged);
      eventBus.off(Events.NETWORK_STATE_RECEIVED, this._onNetworkState);
      eventBus.off(Events.TANK_DIED, this._onTankDiedHud);
      eventBus.off(Events.ROUND_ENDED, this._onRoundEndedHud);
      this.bulletNetSync?.destroy();
      this.roundSync?.destroy();
      this.spawnSystem?.destroy();
    });

    this._createMuteButton();
  }

  _createMuteButton() {
    const ICON_DESIGN_SIZE = 28;
    const MARGIN_DESIGN = 12;
    const size = ICON_DESIGN_SIZE * PX;
    const margin = MARGIN_DESIGN * PX;
    const x = GAME.WIDTH - margin - size / 2;
    const y = margin + size / 2;

    this._muteBg = this.add.circle(x, y, size * 0.65, 0x000000, 0.35)
      .setStrokeStyle(1, 0xffffff, 0.3)
      .setInteractive({ useHandCursor: true })
      .setDepth(2000);

    this._muteIcon = this.add.image(x, y, gameState.isMuted ? 'speaker_off' : 'speaker_on')
      .setDisplaySize(size, size)
      .setDepth(2001);

    const refresh = () => {
      this._muteIcon.setTexture(gameState.isMuted ? 'speaker_off' : 'speaker_on');
    };

    this._muteBg.on('pointerdown', () => {
      eventBus.emit(Events.AUDIO_INIT);
      eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
      refresh();
    });

    this._mKeyHandler = (e) => {
      if (e.key === 'm' || e.key === 'M') {
        eventBus.emit(Events.AUDIO_INIT);
        eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
        refresh();
      }
    };
    window.addEventListener('keydown', this._mKeyHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this._mKeyHandler);
    });
  }

  spawnTanks() {
    this.tanks.forEach(t => t.destroy());
    this._destroyAllRemoteLabels();
    this.tanks = [];
    this.tanksByCorner = new Array(SPAWNS.length).fill(null);
    this._remoteTargets.clear();
    this.player = null;

    const assignments = this.spawnSystem.getAssignments();
    for (const a of assignments) {
      this._spawnAtCorner(a);
    }
  }

  // Live-players-only: corners with no human are left empty, no NPCs.
  _resolveRole(assignment) {
    const connected = !!gameState.multiplayer?.connected;
    if (!connected) {
      return assignment.index === 0 ? 'local' : 'empty';
    }
    if (assignment.isLocal) return 'local';
    if (assignment.playerId) return 'remote';
    return 'empty';
  }

  _spawnAtCorner(assignment) {
    const role = this._resolveRole(assignment);
    if (role === 'empty') return;
    const id = assignment.cornerId;
    const tank = new Tank(this, {
      id,
      color: assignment.color,
      x: assignment.x,
      y: assignment.y,
      rotation: assignment.rotation,
      mazeSystem: this.mazeSystem,
    });
    tank.role = role;
    tank.cornerIndex = assignment.index;
    tank.remotePlayerId = role === 'remote' ? assignment.playerId : null;
    this.world.add(tank.container);
    this.tanks.push(tank);
    this.tanksByCorner[assignment.index] = tank;

    if (role === 'local') {
      this.player = tank;
    } else if (role === 'remote') {
      this._remoteTargets.set(tank.remotePlayerId, {
        x: assignment.x,
        y: assignment.y,
        rotation: assignment.rotation,
        receivedAt: performance.now(),
      });
      this._createRemoteLabel(tank, assignment.index);
    }
  }

  _applyAssignments(assignments) {
    if (gameState.roundState !== 'playing' && gameState.roundState !== 'countdown') return;
    for (const a of assignments) {
      const existing = this.tanksByCorner[a.index];
      const desiredRole = this._resolveRole(a);
      const currentRole = existing?.role ?? 'empty';
      const sameRemote = currentRole === 'remote' && desiredRole === 'remote'
        && existing.remotePlayerId === a.playerId;
      if (currentRole === desiredRole && (desiredRole !== 'remote' || sameRemote)) continue;
      if (existing) this._despawnAtCorner(a.index);
      this._spawnAtCorner(a);
    }
  }

  _despawnAtCorner(index) {
    const tank = this.tanksByCorner[index];
    if (!tank) return;
    if (tank.role === 'remote') {
      if (tank.remotePlayerId) this._remoteTargets.delete(tank.remotePlayerId);
      this._destroyRemoteLabel(tank.cornerIndex);
    }
    const ti = this.tanks.indexOf(tank);
    if (ti >= 0) this.tanks.splice(ti, 1);
    if (this.player === tank) this.player = null;
    tank.destroy();
    this.tanksByCorner[index] = null;
  }

  _createRemoteLabel(tank, cornerIndex) {
    const label = this.add.text(0, 0, `P${cornerIndex + 1}`, {
      fontSize: Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.7) + 'px',
      fontFamily: UI.FONT,
      color: COLORS.UI_TEXT,
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(15);
    this.world.add(label);
    label.setPosition(tank.x, tank.y - 18 * PX);
    this._remoteLabels.set(cornerIndex, label);
  }

  _destroyRemoteLabel(cornerIndex) {
    const label = this._remoteLabels.get(cornerIndex);
    if (label) {
      label.destroy();
      this._remoteLabels.delete(cornerIndex);
    }
  }

  _destroyAllRemoteLabels() {
    for (const label of this._remoteLabels.values()) label.destroy();
    this._remoteLabels.clear();
  }

  _onRemoteState(playerId, state) {
    if (!state) return;
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return;
    if (this._remoteTargets.has(playerId)) {
      // Wire format is design pixels (PX-independent). Convert back to canvas
      // pixels using THIS client's PX so the remote tank lands at the correct
      // proportional position regardless of any PX mismatch between clients.
      this._remoteTargets.set(playerId, {
        x: state.x * PX,
        y: state.y * PX,
        rotation: typeof state.rotation === 'number' ? state.rotation : 0,
        alive: state.alive,
        receivedAt: performance.now(),
      });
    }
  }

  beginNewRound() {
    this.bullets.forEach(b => b.destroy());
    this.bullets = [];
    this.spawnTanks();
    this.roundSystem.startCountdown();
    this.updateHud();
  }

  setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    const wakeAudio = () => eventBus.emit(Events.AUDIO_INIT);
    this.input.keyboard.once('keydown', wakeAudio);
    this.input.once('pointerdown', wakeAudio);
  }

  getPlayerInput() {
    if (!this.player || !this.player.alive) return null;
    if (gameState.roundState !== 'playing') return null;

    const turnLeft = this.wasd.left.isDown || this.cursors.left.isDown;
    const turnRight = this.wasd.right.isDown || this.cursors.right.isDown;
    const thrustForward = this.wasd.up.isDown || this.cursors.up.isDown;
    const thrustBack = this.wasd.down.isDown || this.cursors.down.isDown;
    const fire = this.spaceKey.isDown;
    return { turnLeft, turnRight, thrustForward, thrustBack, fire };
  }

  _updateRemoteTanks(dt) {
    for (const tank of this.tanks) {
      if (tank.role !== 'remote' || !tank.alive) continue;
      const target = this._remoteTargets.get(tank.remotePlayerId);
      if (!target) continue;
      const lerp = Math.min(1, dt * 1000 / REMOTE_INTERPOLATE_MS);
      tank.x += (target.x - tank.x) * lerp;
      tank.y += (target.y - tank.y) * lerp;
      let dr = target.rotation - tank.rotation;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      tank.rotation += dr * lerp;
      tank.container.setPosition(tank.x, tank.y);
      tank.container.setRotation(tank.rotation);

      const label = this._remoteLabels.get(tank.cornerIndex);
      if (label) label.setPosition(tank.x, tank.y - 18 * PX);
    }
  }

  update(_time, delta) {
    const dt = delta / 1000;
    const now = performance.now();

    this.roundSystem.update(now);

    if (gameState.roundState === 'playing') {
      if (this.player && this.player.alive) {
        this.player.update(dt, this.getPlayerInput());
      }

      this._updateRemoteTanks(dt);

      for (const bullet of this.bullets) bullet.update(dt);

      for (const bullet of this.bullets) {
        if (!bullet.alive) continue;
        if (bullet.nonAuthoritative) continue;
        for (const tank of this.tanks) {
          if (bullet.canHit(tank)) {
            tank.kill(bullet.shooterId);
            bullet.hit();
            break;
          }
        }
      }

      this.bullets = this.bullets.filter(b => b.alive);

      // Round ends when only one tank remains alive (or none, in a draw).
      // Requires at least 2 participants to ever fire — otherwise a solo
      // player would round_over immediately on boot.
      const aliveCandidates = this.tanks.filter(t => t.alive);
      if (this.tanks.length >= 2 && aliveCandidates.length <= 1) {
        const winner = aliveCandidates.length === 1 ? aliveCandidates[0].colorName : null;
        this.roundSystem.endRound(winner);
      }
    }

    if (this.polishSystem) this.polishSystem.update(_time, delta);
  }

  updateHud() {
    const w = gameState.wins;
    this.hud.setText(
      `R${gameState.roundNumber}   RED ${w.RED}   BLUE ${w.BLUE}   GREEN ${w.GREEN}   YELLOW ${w.YELLOW}`
    );
  }
}
