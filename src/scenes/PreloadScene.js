import Phaser from 'phaser';
import { IMAGE_MANIFEST, WEAPON_MANIFEST, ANIM_MANIFEST } from '../assets/manifest.js';
import { LOGICAL, RENDER_SCALE } from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import { PIXEL_FONT, BODY_FONT, PRELOAD_FONTS, installCrispText } from '../constants/fonts.js';
import GameState from '../state/GameState.js';

// 에셋 프리로드 + 폰트 준비 → 준비되면 Combat/Hub 두 씬을 동시에 가동.
export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    installCrispText(this); // 모든 텍스트 2배 해상도 + 정수좌표(한글 선명화)
    // 풀스크린 로딩 UI도 360 좌표 — 백버퍼 720에 맞춰 줌(다른 씬과 동일 규약).
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);
    this.drawLoadingUI();

    IMAGE_MANIFEST.forEach(({ key, url }) => this.load.image(key, url));

    // 주인공 프레임 애니 — stage_01 아틀라스만 선행로드(전투 첫 프레임부터 walk 루프 보장).
    // 2~8단계는 단계 상승 시 CombatScene이 지연 로드(현재/다음만 유지).
    const a1 = ANIM_MANIFEST[1];
    this.load.atlas(a1.key, a1.png, a1.json);

    this.load.on('progress', (p) => {
      this.barFill.width = Math.floor((LOGICAL.width * 0.6) * p);
    });
  }

  async create() {
    // 텍스트가 폰트 로드 전에 그려져 폴백으로 굳는 걸 방지 — 폰트 준비를 기다린 뒤 씬 전환.
    await this.waitForFonts();

    // 저장된 진행도(코인/파츠/스탯/장비) 복원 — 없으면 기본값.
    GameState.load();

    // 장착 무기 손표시(R7)를 전투 첫 프레임부터 보장하려면 그 텍스처가 이미 캐시에 있어야 한다.
    // 여기서 미리 로드해 두면 CombatScene.create()의 syncHandWeapon이 동기 경로로 weaponSprite를
    // 생성한다(전투 로더 + HubScene 병렬 로더와 경합하는 지연 로드 레이스를 원천 차단).
    await this.preloadEquippedWeapon();

    // Combat을 메인으로 start, Hub를 병렬 launch (전투는 허브 조작 중에도 멈추지 않음 — 기획서)
    this.scene.start('CombatScene');
    this.scene.launch('HubScene');

    // 첫 실행에만 — 세계관→튜토리얼 풀스크린 인트로를 Combat/Hub 위로 띄운다(닫으면 영속).
    if (!GameState.meta.introSeen) this.scene.launch('IntroScene');
  }

  // 현재 장착 무기 텍스처 선행 로드(이미 있거나 매니페스트에 없으면 즉시 통과).
  // 실패해도 전투 진입은 막지 않는다(resolve) — 손표시만 그 런에서 빠질 뿐 게임은 진행.
  preloadEquippedWeapon() {
    const id = GameState.equippedWeapon;
    const url = WEAPON_MANIFEST[id];
    if (!url || this.textures.exists(id)) return Promise.resolve();
    return new Promise((resolve) => {
      this.load.image(id, url);
      this.load.once('complete', resolve);
      this.load.once('loaderror', resolve);
      this.load.start();
    });
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
        fontFamily: BODY_FONT, // 한글 안내문 — 픽셀폰트 10px 자소 뭉갬, BODY 11px로 가독성 ↑
        fontSize: '11px',
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
