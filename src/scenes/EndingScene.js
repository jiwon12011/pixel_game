import Phaser from 'phaser';
import { LOGICAL, RENDER_SCALE } from '../constants/layout.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import { ANIM_MANIFEST } from '../assets/manifest.js';

// 탈출 엔딩 — 최종 보스(게이트키퍼) 처치 시 CombatScene이 launch하는 풀스크린 시네마틱.
// 새벽빛 배경 + 우측 "열린 문(빛의 게이트)"으로 걸어가는 스크래퍼 + 클리어 요약/NG+ 안내.
// "계속"을 누르면 CombatScene.beginNgPlusRun()으로 New Game+ 런을 시작한다.
export default class EndingScene extends Phaser.Scene {
  constructor() {
    super('EndingScene');
  }

  init(data) {
    this.summary = data || {}; // { kills, wave, coins, ngPlus, clearCount }
  }

  create() {
    this.scene.bringToTop();
    installCrispText(this);
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);
    this.motionOk = !this._prefersReducedMotion();
    this._done = false;

    this._setBelowInput(false); // 엔딩 동안 게임 입력 차단
    this.events.once('shutdown', () => this._setBelowInput(true));

    this.build();
  }

  build() {
    const W = LOGICAL.width;
    const H = LOGICAL.height;
    const groundY = 540;
    const cx = W / 2;
    const layer = this.add.container(0, 0);
    this.layer = layer;

    // 새벽빛 그라데이션(인트로의 암흑과 대비 — 탈출/희망 톤).
    const grad = this.add.graphics();
    grad.fillGradientStyle(0x1a1206, 0x1a1206, 0x7a4520, 0xc98a3a, 1, 1, 1, 1);
    grad.fillRect(0, 0, W, H);
    layer.add(grad);

    // 우측 "열린 문" — 빛의 게이트(골드→투명). 캐릭터가 이쪽으로 걸어 나간다.
    const gate = this.add.graphics();
    gate.fillGradientStyle(0xffe9b0, 0xffe9b0, 0xffe9b0, 0xffe9b0, 0, 0.9, 0, 0.9);
    gate.fillRect(W - 92, 0, 92, H);
    layer.add(gate);
    if (this.motionOk) {
      gate.setAlpha(0.7);
      this.tweens.add({ targets: gate, alpha: 1, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // 노면.
    const ground = this.add.rectangle(0, groundY, W, H - groundY, 0x140d07, 0.92).setOrigin(0, 0);
    layer.add(ground);

    // 스크래퍼 — 우측(빛) 쪽으로 걸어 나간다.
    this.buildHero(layer, cx - 20, groundY);

    // 레터박스.
    const barH = 40;
    const topBar = this.add.rectangle(0, 0, W, barH, 0x000000).setOrigin(0, 0);
    const botBar = this.add.rectangle(0, H - barH, W, barH, 0x000000).setOrigin(0, 0);
    layer.add([topBar, botBar]);

    // 텍스트.
    const kicker = this.add
      .text(cx, 86, 'LAST SALVAGE', { fontFamily: PIXEL_FONT, fontSize: '13px', color: '#f0c040' })
      .setOrigin(0.5);
    const title = this.add
      .text(cx, 116, '탈출 성공', { fontFamily: BODY_FONT, fontSize: '24px', color: '#ffd24a' })
      .setOrigin(0.5);
    title.setShadow(1, 1, '#000000', 3, false, true);
    const divider = this.add.rectangle(cx, 142, 160, 1, 0xf0c040, 0.5).setOrigin(0.5);
    layer.add([kicker, title, divider]);

    const lines = [
      '검문소의 문지기가 무너졌다.',
      '굳게 닫혔던 문이 열리고,',
      '잿빛 너머로 빛이 새어든다.',
      '스크래퍼는 마침내 폐허를 벗어났다.'
    ];
    const startY = 176;
    const stepY = 24;
    const lineTexts = lines.map((line, i) => {
      const t = this.add
        .text(cx, startY + i * stepY, line, { fontFamily: BODY_FONT, fontSize: '13px', color: '#e8dcc8', align: 'center' })
        .setOrigin(0.5);
      t.setShadow(1, 1, '#000000', 0, false, true);
      layer.add(t);
      return t;
    });

    // 클리어 요약 + New Game+ 안내 패널.
    const ng = this.summary.ngPlus || 1;
    const cc = this.summary.clearCount || 1;
    const panelY = 300;
    const panel = this.add
      .rectangle(cx, panelY, W - 56, 70, 0x140d07, 0.85)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xf0c040, 0.45);
    const statLine = this.add
      .text(cx, panelY - 16, `이번 런 · 킬 ${this.summary.kills ?? 0} · 웨이브 ${this.summary.wave ?? 0}  (탈출 ${cc}회)`, {
        fontFamily: BODY_FONT,
        fontSize: '12px',
        color: '#cbb89a',
        align: 'center'
      })
      .setOrigin(0.5);
    const ngTitle = this.add
      .text(cx, panelY + 4, `NEW GAME +${ng}`, { fontFamily: PIXEL_FONT, fontSize: '15px', color: '#20ff9a' })
      .setOrigin(0.5);
    const ngDesc = this.add
      .text(cx, panelY + 22, '메타 성장은 유지 · 적이 더 강해진 폐허로 다시.', {
        fontFamily: BODY_FONT,
        fontSize: '11px',
        color: '#9a8b78',
        align: 'center'
      })
      .setOrigin(0.5);
    layer.add([panel, statLine, ngTitle, ngDesc]);

    // CTA.
    const btn = this.makeButton(layer, cx, H - 64, `New Game+${ng} 시작`, () => this.continueNgPlus());

    // 등장 연출.
    if (this.motionOk) {
      topBar.y = -barH;
      botBar.y = H;
      this.tweens.add({ targets: topBar, y: 0, duration: 500, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: botBar, y: H - barH, duration: 500, ease: 'Cubic.easeOut' });

      [kicker, title, divider].forEach((o, i) => {
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, delay: 200 + i * 120, duration: 400 });
      });
      lineTexts.forEach((t, i) => {
        const baseY = t.y;
        t.setAlpha(0);
        t.y = baseY + 8;
        this.tweens.add({ targets: t, alpha: 1, y: baseY, delay: 600 + i * 420, duration: 500, ease: 'Sine.easeOut' });
      });
      const after = 600 + lines.length * 420 + 200;
      [panel, statLine, ngTitle, ngDesc, btn.bg, btn.label].forEach((o) => {
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, delay: after, duration: 350 });
      });
    }
  }

  // 스크래퍼 — walk 루프로 우측(빛)으로 천천히 이동.
  buildHero(layer, x, groundY) {
    const atlasKey = ANIM_MANIFEST[1]?.key;
    if (!atlasKey || !this.textures.exists(atlasKey)) return;
    const frame = this.textures.get(atlasKey).frames['walk_1'];
    const canvasH = frame?.realHeight || 512;
    const scale = 170 / (0.75 * canvasH);

    const shadow = this.add.ellipse(x, groundY + 2, 94, 13, 0x000000, 0.4);
    const hero = this.add.sprite(x, groundY, atlasKey, 'walk_1').setOrigin(0.5, 0.9531).setScale(scale);
    layer.add([shadow, hero]);

    if (!this.motionOk) return;
    if (!this.anims.exists('ending-walk')) {
      this.anims.create({
        key: 'ending-walk',
        frames: ['walk_0', 'walk_1', 'walk_2', 'walk_3'].map((f) => ({ key: atlasKey, frame: f })),
        frameRate: 8,
        repeat: -1
      });
    }
    hero.play('ending-walk');
    // 빛을 향해 천천히 우측으로(살짝) 전진 — "걸어 나간다".
    this.tweens.add({ targets: [hero, shadow], x: x + 40, duration: 6000, ease: 'Sine.easeInOut' });
  }

  continueNgPlus() {
    if (this._done) return;
    this._done = true;
    const proceed = () => {
      this._setBelowInput(true);
      const cs = this.scene.get('CombatScene');
      cs?.beginNgPlusRun(); // 유산 없이 새 런 + NG+ 난이도 반영
      this.scene.stop();
    };
    if (this.motionOk && this.layer) {
      this.tweens.add({ targets: this.layer, alpha: 0, duration: 280, onComplete: proceed });
    } else {
      proceed();
    }
  }

  // ── 헬퍼(IntroScene과 동일 규약) ─────────────────────────────────────
  makeButton(layer, x, y, label, onClick) {
    const bg = this.add.rectangle(x, y, 168, 34, 0xff6020).setStrokeStyle(1, 0x000000, 0.45);
    const txt = this.add
      .text(x, y, label, { fontFamily: BODY_FONT, fontSize: '14px', color: '#1a1008' })
      .setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => bg.setFillStyle(0xff7a3a))
      .on('pointerout', () => bg.setFillStyle(0xff6020))
      .on('pointerdown', onClick);
    layer.add([bg, txt]);
    return { bg, label: txt };
  }

  _setBelowInput(enabled) {
    ['CombatScene', 'HubScene'].forEach((key) => {
      const s = this.scene.get(key);
      if (s && s.input) s.input.enabled = enabled;
    });
  }

  _prefersReducedMotion() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }
}
