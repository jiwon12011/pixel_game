import Phaser from 'phaser';
import { LOGICAL, RENDER_SCALE } from '../constants/layout.js';
import { PALETTE, toCss } from '../constants/palette.js';
import BootScene from '../scenes/BootScene.js';
import PreloadScene from '../scenes/PreloadScene.js';
import CombatScene from '../scenes/CombatScene.js';
import HubScene from '../scenes/HubScene.js';
import SettingsScene from '../scenes/SettingsScene.js';
import IntroScene from '../scenes/IntroScene.js';
import EndingScene from '../scenes/EndingScene.js';

// antialias:true(LINEAR 필터) — 텍스트 가독성 우선.
// 이 게임 에셋(캐릭터·배경)은 저해상 픽셀 아트가 아니라 고해상 webp 일러스트라
// LINEAR로 그려도 선명하다. 반대로 antialias:false(NEAREST)는 텍스트를 resolution 3으로
// 렌더한 고해상 텍스처를 NEAREST로 축소해 한글 획을 뭉갠다 → 가독성 저하.
// pixelArt:true도 금지: 캔버스 CSS에 image-rendering:pixelated를 박아 텍스트까지 깨진다.
//
// 백버퍼 2배(720×1280): gameSize를 LOGICAL×RENDER_SCALE로 잡아 GL 드로잉 버퍼를 키운다.
// 핵심 — FIT은 360×640 백버퍼로 렌더한 뒤 화면 크기로 업스케일하는데, 이 360px 백버퍼가
// 병목이라 11~13px 한글이 업스케일에서 뭉갰다. Phaser 3.90 ScaleManager는 config의 zoom을
// baseSize(=캔버스 백버퍼)가 아니라 displaySize(CSS)에만 곱하므로 zoom으로는 버퍼가 안 커진다
// → gameSize 자체를 720×1280으로 키워야 한다. 게임 좌표계는 360×640 그대로 유지하고,
// 각 씬 카메라가 setZoom(RENDER_SCALE).setOrigin(0,0)으로 360 월드를 이 버퍼에 꽉 채운다.
// 좌표계/입력/오프셋 뷰포트는 게임좌표 기반이라 zoom과 무관(카메라가 역변환).
// 비용: fill rate 4배 — 단순 2D 게임이라 현대 기기엔 무해(저사양만 추후 측정).

export const gameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: toCss(PALETTE.bgBase),
  antialias: true,
  roundPixels: true,
  callbacks: {
    postBoot: (game) => {
      // Phaser가 남긴 image-rendering 인라인 스타일 제거 — 브라우저 기본(bilinear)으로 복구
      game.canvas.style.imageRendering = '';
    }
  },
  scale: {
    mode: Phaser.Scale.FIT, // 세로 비율 유지하며 화면에 맞춤
    // 센터링은 #game-root의 CSS grid(place-items:center)가 전담한다.
    // 여기서 CENTER_BOTH를 켜면 CSS 중앙정렬 위에 margin이 또 더해져
    // 캔버스가 절반만큼 우하단으로 밀린다(이중 센터링). NO_CENTER로 끈다.
    autoCenter: Phaser.Scale.NO_CENTER,
    // gameSize = 백버퍼 = 720×1280. FIT이 이 720을 화면 비율에 맞춰 업/다운스케일한다.
    width: LOGICAL.width * RENDER_SCALE,
    height: LOGICAL.height * RENDER_SCALE
  },
  // 전투 뷰(Combat)와 합성 허브(Hub)를 독립 씬으로 — 제스처/카메라 분리, 다음 단계 확장 용이.
  // IntroScene은 첫 실행 시에만 Combat/Hub 위로 launch되는 풀스크린 인트로(세계관→튜토리얼).
  scene: [BootScene, PreloadScene, CombatScene, HubScene, SettingsScene, IntroScene, EndingScene]
};
