import Phaser from 'phaser';
import { LOGICAL } from '../constants/layout.js';
import { PALETTE, toCss } from '../constants/palette.js';
import BootScene from '../scenes/BootScene.js';
import PreloadScene from '../scenes/PreloadScene.js';
import CombatScene from '../scenes/CombatScene.js';
import HubScene from '../scenes/HubScene.js';

// 픽셀 아트 필수 세팅: pixelArt:true가 antialias=false + roundPixels를 켜준다.
export const gameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: toCss(PALETTE.bgBase),
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT, // 세로 비율 유지하며 화면에 맞춤
    // 센터링은 #game-root의 CSS grid(place-items:center)가 전담한다.
    // 여기서 CENTER_BOTH를 켜면 CSS 중앙정렬 위에 margin이 또 더해져
    // 캔버스가 절반만큼 우하단으로 밀린다(이중 센터링). NO_CENTER로 끈다.
    autoCenter: Phaser.Scale.NO_CENTER,
    width: LOGICAL.width,
    height: LOGICAL.height
  },
  // 전투 뷰(Combat)와 합성 허브(Hub)를 독립 씬으로 — 제스처/카메라 분리, 다음 단계 확장 용이
  scene: [BootScene, PreloadScene, CombatScene, HubScene]
};
