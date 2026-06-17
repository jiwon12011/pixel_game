import Phaser from 'phaser';
import { PALETTE } from '../constants/palette.js';
import { PIXEL_FONT } from '../constants/fonts.js';

// 합성 허브 하단 4탭 바. 탭 터치(+ 키보드 좌우)로 활성 전환.
// 실제 탭 기능 로직은 다음 단계 — 여기선 활성 인덱스만 onChange로 통지.
export default class TabBar extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} cfg { x, y, width, height, tabs:[{key,label,icon}], onChange }
   */
  constructor(scene, cfg) {
    super(scene, 0, 0);
    scene.add.existing(this);

    this.cfg = cfg;
    this.active = 0;
    this.cells = [];

    const cellW = cfg.width / cfg.tabs.length;

    // 바 배경 (어두운 철판 + 윗선 강조)
    scene.add
      .rectangle(cfg.x, cfg.y, cfg.width, cfg.height, PALETTE.hubBase)
      .setOrigin(0, 0);
    scene.add
      .rectangle(cfg.x, cfg.y, cfg.width, 2, PALETTE.hubSecondary)
      .setOrigin(0, 0);

    cfg.tabs.forEach((tab, i) => {
      const cx = cfg.x + cellW * i + cellW / 2;
      const cy = cfg.y + cfg.height / 2;

      // 활성 표시: 셀 배경 하이라이트
      const hl = scene.add
        .rectangle(cx, cy, cellW - 4, cfg.height - 4, PALETTE.hubSecondary, 0.55)
        .setOrigin(0.5);

      // 아이콘: 에셋 있으면 이미지, 없으면 라벨만
      let icon = null;
      if (tab.icon && scene.textures.exists(tab.icon)) {
        const src = scene.textures.get(tab.icon).getSourceImage();
        const iconH = cfg.height * 0.5;
        icon = scene.add
          .image(cx, cy - 8, tab.icon)
          .setOrigin(0.5)
          .setScale(iconH / src.height);
      }

      const label = scene.add
        .text(cx, cy + (icon ? cfg.height * 0.3 : 0), tab.label, {
          fontFamily: PIXEL_FONT,
          fontSize: '10px',
          color: '#cbb89a'
        })
        .setOrigin(0.5);

      // 활성 밑줄 (골드)
      const underline = scene.add
        .rectangle(cx, cfg.y + cfg.height - 2, cellW - 12, 2, PALETTE.accentGold)
        .setOrigin(0.5);

      // 터치 영역
      const hit = scene.add
        .rectangle(cx, cy, cellW, cfg.height, 0xffffff, 0.001)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.setActive(i));

      this.cells.push({ hl, icon, label, underline, hit });
    });

    // 키보드 접근성: 좌우로 탭 이동
    scene.input.keyboard?.on('keydown-LEFT', () =>
      this.setActive((this.active - 1 + this.cells.length) % this.cells.length)
    );
    scene.input.keyboard?.on('keydown-RIGHT', () =>
      this.setActive((this.active + 1) % this.cells.length)
    );

    this.refresh();
  }

  setActive(i) {
    if (i === this.active) return;
    this.active = i;
    this.refresh();
    this.cfg.onChange?.(i, this.cfg.tabs[i]);
  }

  refresh() {
    this.cells.forEach((c, i) => {
      const on = i === this.active;
      c.hl.setVisible(on);
      c.underline.setVisible(on);
      c.label.setColor(on ? '#f0c040' : '#cbb89a');
      if (c.icon) c.icon.setAlpha(on ? 1 : 0.55);
    });
  }
}
