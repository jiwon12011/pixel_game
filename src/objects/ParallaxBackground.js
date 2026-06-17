import Phaser from 'phaser';
import { COMBAT_H, LOGICAL, PARALLAX } from '../constants/layout.js';
import { TEX } from '../assets/manifest.js';

// 4레이어 패럴랙스 무한 가로 스크롤.
// 레이어들은 동일 캔버스(web 사본 720x371)의 오버레이라, 같은 사각형에 겹쳐 깔고
// tilePositionX만 레이어별 속도로 흘려보내면 정확히 정렬된 패럴랙스가 된다.
export default class ParallaxBackground {
  /**
   * @param {Phaser.Scene} scene
   * @param {boolean} animate  reduced-motion이면 false → 정적
   */
  constructor(scene, animate = true) {
    this.animate = animate;
    this.layers = [];

    // 높이를 전투 뷰에 맞추는 균일 스케일 (가로는 자동 타일링)
    const tileScale = COMBAT_H / PARALLAX.sourceHeight;

    const defs = [
      { key: TEX.BG_L1, factor: PARALLAX.factors.l1 },
      { key: TEX.BG_L2, factor: PARALLAX.factors.l2 },
      { key: TEX.BG_L3, factor: PARALLAX.factors.l3 },
      { key: TEX.BG_L4, factor: PARALLAX.factors.l4 }
    ];

    // 먼 레이어(하늘/공장)는 LINEAR로 부드럽게 — 천천히 흘러 픽셀 또렷함보다 시머 완화가 이득.
    // 가까운 L3/L4는 NEAREST 유지(지면/잔해 픽셀 디테일 보존). tileScale=1.0이라 NEAREST도 시머 없음.
    const linearKeys = [TEX.BG_L1, TEX.BG_L2];
    linearKeys.forEach((key) => {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    });

    defs.forEach(({ key, factor }, i) => {
      const ts = scene.add
        .tileSprite(0, 0, LOGICAL.width, COMBAT_H, key)
        .setOrigin(0, 0)
        .setDepth(i); // L1 뒤 → L4 앞
      ts.tileScaleX = tileScale;
      ts.tileScaleY = tileScale;
      this.layers.push({ ts, factor });
    });
  }

  /** @param {number} dtMs 프레임 델타(ms) */
  update(dtMs) {
    if (!this.animate) return;
    const dt = dtMs / 1000;
    for (const { ts, factor } of this.layers) {
      // 텍스처 좌표 이동 → 화면 이동량은 tileScale이 곱해짐. 배경이 좌로 흐른다.
      ts.tilePositionX += PARALLAX.baseSpeed * factor * dt;
    }
  }

  /** 깊이 정렬 기준 — 캐릭터/적은 이 값보다 위에 둔다 (L4 = 3) */
  get topDepth() {
    return this.layers.length - 1;
  }
}
