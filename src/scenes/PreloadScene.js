import Phaser from 'phaser';
import { IMAGE_MANIFEST } from '../assets/manifest.js';
import { LOGICAL } from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import { PIXEL_FONT, PRELOAD_FONTS } from '../constants/fonts.js';
import GameState from '../state/GameState.js';

// 에셋 프리로드 + 폰트 준비 → 준비되면 Combat/Hub 두 씬을 동시에 가동.
export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    this.drawLoadingUI();

    IMAGE_MANIFEST.forEach(({ key, url }) => this.load.image(key, url));

    this.load.on('progress', (p) => {
      this.barFill.width = Math.floor((LOGICAL.width * 0.6) * p);
    });
  }

  async create() {
    // 텍스트가 폰트 로드 전에 그려져 폴백으로 굳는 걸 방지 — 폰트 준비를 기다린 뒤 씬 전환.
    await this.waitForFonts();

    // 저장된 진행도(코인/파츠/스탯/장비) 복원 — 없으면 기본값.
    GameState.load();

    // Combat을 메인으로 start, Hub를 병렬 launch (전투는 허브 조작 중에도 멈추지 않음 — 기획서)
    this.scene.start('CombatScene');
    this.scene.launch('HubScene');
  }

  async waitForFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all(PRELOAD_FONTS.map((f) => document.fonts.load(f)));
    } catch {
      /* 폰트 CDN 실패 시 시스템 폰트로 폴백 — 진행은 계속 */
    }
    try {
      await document.fonts.ready;
    } catch {
      /* noop */
    }
  }

  drawLoadingUI() {
    const cx = LOGICAL.width / 2;
    const cy = LOGICAL.height / 2;
    const barW = LOGICAL.width * 0.6;

    this.add
      .text(cx, cy - 40, 'LAST SALVAGE', {
        fontFamily: PIXEL_FONT,
        fontSize: '20px',
        color: '#f0c040'
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 14, '폐품을 끌어모으는 중…', {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: '#9a8b78'
      })
      .setOrigin(0.5);

    // 바 트랙 + 채움
    this.add
      .rectangle(cx, cy + 14, barW, 8, PALETTE.hubSecondary)
      .setOrigin(0.5)
      .setStrokeStyle(1, PALETTE.accentGold, 0.5);
    this.barFill = this.add
      .rectangle(cx - barW / 2, cy + 14, 0, 8, PALETTE.accentGold)
      .setOrigin(0, 0.5);
  }
}
