import Phaser from 'phaser';
import { registerSprites } from '../sprites/registerSprites.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    registerSprites(this);
    this.scene.start('GameScene');
  }
}
