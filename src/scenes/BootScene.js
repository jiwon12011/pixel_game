import Phaser from 'phaser';

// 부팅: 렌더러/스케일 초기 점검만 하고 바로 Preload로. (무거운 로드는 Preload에서)
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.scene.start('PreloadScene');
  }
}
