import Phaser from 'phaser';
import { LOGICAL, RENDER_SCALE, COMBAT_H, HUB_H } from '../constants/layout.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import { ANIM_MANIFEST, TEX } from '../assets/manifest.js';
import GameState from '../state/GameState.js';

// 첫 실행 인트로 — 풀스크린 전용 씬. Combat/Hub 위에 얹혀(launch 순서상 최상단)
//   ① 세계관: 시네마틱(레터박스 + 캐릭터 등장 + 텍스트 순차 페이드)으로 전체 화면을 덮는다.
//   ② 튜토리얼: 시네마틱을 걷어내고, 뒤에서 살아 움직이는 "실제 게임 화면" 위에
//      코치마크(전투 영역/작업대 영역 하이라이트 + 설명)를 얹어 직접 가리킨다.
// 닫으면 meta.introSeen=true로 영속(다신 안 뜸). 인트로 동안엔 아래 두 씬의 입력을 꺼
// 게임은 계속 보이되(영상처럼) 오조작은 막는다.
export default class IntroScene extends Phaser.Scene {
  constructor() {
    super('IntroScene');
  }

  create() {
    this.scene.bringToTop(); // Combat/Hub 위로
    installCrispText(this);  // 한글 2배 해상도(다른 씬과 동일 규약)
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0); // 360 월드 → 720 백버퍼

    this.motionOk = !this._prefersReducedMotion();
    this._finished = false;

    // 뒤의 실제 게임(Combat/Hub) 입력 차단 — 화면은 계속 렌더(영상처럼)되지만 오조작은 막힌다.
    this._setBelowInput(false);
    this.events.once('shutdown', () => this._setBelowInput(true)); // 방어적 복구

    this.buildStory();
  }

  // ── ① 세계관 시네마틱 ────────────────────────────────────────────────
  buildStory() {
    const W = LOGICAL.width;
    const H = LOGICAL.height;
    const groundY = 540;
    const cx = W / 2;
    const layer = this.add.container(0, 0);
    this.storyLayer = layer;

    // 황혼 → 암흑 세로 그라데이션(WebGL). 캔버스 폴백 시 상단색 단색으로 degrade.
    const grad = this.add.graphics();
    grad.fillGradientStyle(0x7a4520, 0x7a4520, 0x1a1206, 0x0a0805, 1, 1, 1, 1);
    grad.fillRect(0, 0, W, H);
    layer.add(grad);

    // 원경 폐허 실루엣(패럴랙스 L3 재사용) — 어둡게 틴트해 배경 깊이.
    if (this.textures.exists(TEX.BG_L3)) {
      const ruins = this.add.image(cx, groundY, TEX.BG_L3).setOrigin(0.5, 1);
      ruins.setScale(W / ruins.width).setTint(0x5a4632).setAlpha(0.55);
      layer.add(ruins);
      if (this.motionOk) {
        this.tweens.add({ targets: ruins, x: cx + 6, duration: 7000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    // 노면(패럴랙스 L4 재사용) — 화면 하단을 덮는 바닥.
    if (this.textures.exists(TEX.BG_L4)) {
      const ground = this.add.image(cx, H, TEX.BG_L4).setOrigin(0.5, 1);
      ground.setScale(W / ground.width);
      layer.add(ground);
    }

    // 주인공 등장 — stage_01 아틀라스(선행로드 보장) walk 루프로 "걸어 들어온다".
    this.buildHeroSprite(layer, cx, groundY);

    // ── 레터박스(시네마틱 바) ──
    const barH = 40;
    const topBar = this.add.rectangle(0, 0, W, barH, 0x000000).setOrigin(0, 0);
    const botBar = this.add.rectangle(0, H - barH, W, barH, 0x000000).setOrigin(0, 0);
    layer.add([topBar, botBar]);

    // ── 텍스트 ──
    const kicker = this.add
      .text(cx, 88, 'LAST SALVAGE', { fontFamily: PIXEL_FONT, fontSize: '14px', color: '#f0c040' })
      .setOrigin(0.5);
    const title = this.add
      .text(cx, 116, '폐허의 마지막 생존자', { fontFamily: BODY_FONT, fontSize: '20px', color: '#ff6020' })
      .setOrigin(0.5);
    title.setShadow(1, 1, '#000000', 2, false, true);
    const divider = this.add.rectangle(cx, 142, 150, 1, 0xf0c040, 0.45).setOrigin(0.5);
    layer.add([kicker, title, divider]);

    const lines = [
      '문명은 무너졌다.',
      '좀비와 변종이 들끓는 잿빛 폐허.',
      '당신은 홀로 살아남은 폐품 수집가 — 스크래퍼.',
      '고철을 긁어모아 무기를 만들고,',
      '끝없이 몰려오는 적을 베며 나아간다.',
      '쓰러져도, 유산 하나는 다음 생으로.'
    ];
    const startY = 174;
    const stepY = 24;
    const lineTexts = lines.map((line, i) => {
      const t = this.add
        .text(cx, startY + i * stepY, line, {
          fontFamily: BODY_FONT,
          fontSize: '13px',
          color: i === lines.length - 1 ? '#cbb89a' : '#b6a892',
          align: 'center'
        })
        .setOrigin(0.5);
      t.setShadow(1, 1, '#000000', 0, false, true);
      layer.add(t);
      return t;
    });

    // ── CTA "다음 ▶" + 건너뛰기 ──
    const btn = this.makeButton(layer, cx, 574, '다음 ▶', () => this.gotoTutorial());
    const skip = this.add
      .text(W - 12, 20, '건너뛰기', { fontFamily: BODY_FONT, fontSize: '12px', color: '#cbb89a' })
      .setOrigin(1, 0.5);
    skip.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.finish());
    layer.add(skip);

    // ── 등장 연출 ──
    if (this.motionOk) {
      // 레터박스 슬라이드 인
      topBar.y = -barH;
      botBar.y = H;
      this.tweens.add({ targets: topBar, y: 0, duration: 500, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: botBar, y: H - barH, duration: 500, ease: 'Cubic.easeOut' });

      // 타이틀 페이드
      [kicker, title, divider].forEach((o, i) => {
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, delay: 200 + i * 120, duration: 400 });
      });
      // 본문 순차 등장(아래에서 살짝 떠오름)
      lineTexts.forEach((t, i) => {
        const baseY = t.y;
        t.setAlpha(0);
        t.y = baseY + 8;
        this.tweens.add({ targets: t, alpha: 1, y: baseY, delay: 650 + i * 430, duration: 500, ease: 'Sine.easeOut' });
      });
      // 버튼은 본문이 다 뜬 뒤
      const btnDelay = 650 + lines.length * 430 + 250;
      [btn.bg, btn.label].forEach((o) => {
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, delay: btnDelay, duration: 350 });
      });
    }
  }

  // 주인공 스프라이트 — 아틀라스의 다양한 포즈(걷기/공격/피격)를 섞어 시네마틱하게.
  // 좌측에서 걸어 들어온 뒤 walk 루프를 돌다가 주기적으로 공격 휘두르기·피격 리액션을 1회씩 끼운다.
  buildHeroSprite(layer, cx, groundY) {
    const atlasKey = ANIM_MANIFEST[1]?.key;
    if (!atlasKey || !this.textures.exists(atlasKey)) return;

    const frame = this.textures.get(atlasKey).frames['walk_1'];
    const canvasH = frame?.realHeight || 512;
    const scale = 175 / (0.75 * canvasH); // 시네마틱 표시 키(≈175px 콘텐츠)

    const shadow = this.add.ellipse(cx, groundY + 2, 96, 14, 0x000000, 0.4);
    const hero = this.add.sprite(cx, groundY, atlasKey, 'walk_1').setOrigin(0.5, 0.9531).setScale(scale);
    layer.add([shadow, hero]);
    this.hero = hero;

    if (!this.motionOk) return; // 모션 OFF — 정적 포즈 1장(walk_1)만

    // 인트로용 4액션 애니 정의(씬 전역, 1회). 프레임은 CombatScene _ensureStageAnims와 동일 셋.
    const defs = [
      ['intro-walk', ['walk_0', 'walk_1', 'walk_2', 'walk_3'], 9, -1],
      ['intro-attack', ['attack_0', 'attack_1', 'attack_2'], 11, 0],
      ['intro-hit', ['hit_0', 'hit_1'], 12, 0],
      ['intro-death', ['death_0', 'death_1', 'death_2'], 9, 0] // 쓰러짐 → animationcomplete가 walk로 복귀(=다시 일어섬)
    ];
    for (const [key, frames, frameRate, repeat] of defs) {
      if (this.anims.exists(key)) continue;
      this.anims.create({ key, frames: frames.map((f) => ({ key: atlasKey, frame: f })), frameRate, repeat });
    }

    // 1회성 포즈가 끝나면 walk 복귀. death는 쓰러진 채 잠깐 멈췄다(700ms) 다시 일어선다.
    hero.on('animationcomplete', (anim) => {
      if (anim.key === 'intro-walk' || !hero.active) return;
      if (anim.key === 'intro-death') {
        this.time.delayedCall(700, () => { if (hero.active) hero.play('intro-walk'); });
      } else {
        hero.play('intro-walk');
      }
    });
    hero.play('intro-walk');

    // 좌측에서 걸어 들어옴(페이드 + 슬라이드) → 도착 후 포즈 사이클 시작.
    hero.setAlpha(0).setX(cx - 46);
    shadow.setAlpha(0).setX(cx - 46);
    this.tweens.add({
      targets: [hero, shadow],
      alpha: 1,
      x: cx,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => this.startPoseCycle()
    });
  }

  // 주기적으로 다양한 포즈를 끼워 "살아있는" 인트로. storyLayer 해제 시 타이머도 정리(누수/죽은 스프라이트 접근 방지).
  startPoseCycle() {
    // 모든 포즈 사용 — 공격 비중↑, 쓰러짐(death)은 가끔(다시 일어서는 연출).
    const POSES = ['intro-attack', 'intro-attack', 'intro-hit', 'intro-attack', 'intro-hit', 'intro-death'];
    this._poseTimer = this.time.addEvent({
      delay: 1700,
      loop: true,
      callback: () => {
        const hero = this.hero;
        if (!hero || !hero.active) return;
        // walk 루프 중일 때만 1회성 포즈 삽입(겹침 방지).
        if (hero.anims.currentAnim?.key !== 'intro-walk') return;
        const pose = POSES[Math.floor(Math.random() * POSES.length)];
        hero.play(pose);
      }
    });
  }

  _stopPoseCycle() {
    this._poseTimer?.remove();
    this._poseTimer = null;
  }

  // ── ② 튜토리얼: 실제 게임 화면 위 코치마크 ─────────────────────────────
  gotoTutorial() {
    this._stopPoseCycle(); // 포즈 타이머 정리(곧 hero가 파괴되므로)
    // 시네마틱 걷어내기 → 뒤의 살아있는 게임이 드러난다.
    const teardown = () => {
      this.storyLayer?.destroy(true);
      this.storyLayer = null;
      this.buildCoach();
    };
    if (this.motionOk && this.storyLayer) {
      this.tweens.add({ targets: this.storyLayer, alpha: 0, duration: 260, onComplete: teardown });
    } else {
      teardown();
    }
  }

  buildCoach() {
    const W = LOGICAL.width;
    const H = LOGICAL.height;

    // 코치 단계 — 실제 화면 영역(전투/작업대)을 직접 가리킨다.
    this._steps = [
      {
        chip: '① 전투',
        // 전투 뷰(상단)를 비추고 하단(작업대)을 어둡게.
        focus: { x: 0, y: 0, w: W, h: COMBAT_H },
        dim: { x: 0, y: COMBAT_H, w: W, h: HUB_H },
        arrow: 'up',
        text: '전투는 자동으로 진행돼요.\n화면을 탭하면 가장 가까운 적을 즉시 가격(공격 가속)!',
        textY: COMBAT_H - 86
      },
      {
        chip: '② 작업대',
        // 작업대(하단)를 비추고 상단(전투)을 어둡게.
        focus: { x: 0, y: COMBAT_H, w: W, h: HUB_H },
        dim: { x: 0, y: 0, w: W, h: COMBAT_H },
        arrow: 'down',
        text: '아래는 작업대.\n모은 재료로 무기를 합성·강화하고 능력치를 올려요.',
        textY: COMBAT_H + 30
      },
      {
        chip: '③ 로그라이크',
        // 전체를 살짝 덮고 마무리 안내.
        focus: null,
        dim: { x: 0, y: 0, w: W, h: H },
        dimAlpha: 0.62,
        arrow: null,
        text: '쓰러지면 유산 1개를 골라 다음 런으로.\n조금씩 더 멀리 — 행운을 빈다!',
        textY: H * 0.42
      }
    ];
    this._stepIndex = 0;
    this.coachLayer = this.add.container(0, 0);
    this.renderStep();
  }

  renderStep() {
    const W = LOGICAL.width;
    const layer = this.coachLayer;
    layer.removeAll(true);

    const step = this._steps[this._stepIndex];
    const last = this._stepIndex === this._steps.length - 1;

    // 비초점 영역 딤(초점 영역은 안 덮어 실제 게임이 또렷이 보인다).
    const d = step.dim;
    const dim = this.add
      .rectangle(d.x, d.y, d.w, d.h, 0x0a0805, step.dimAlpha ?? 0.72)
      .setOrigin(0, 0)
      .setInteractive(); // 탭 삼킴
    layer.add(dim);

    // 초점 영역 골드 외곽선 — 펄스로 시선 유도.
    if (step.focus) {
      const f = step.focus;
      const box = this.add
        .rectangle(f.x + 3, f.y + 3, f.w - 6, f.h - 6, 0x000000, 0)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0xf0c040, 0.9);
      layer.add(box);
      if (this.motionOk) {
        this.tweens.add({ targets: box, alpha: 0.35, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }

    // 단계 칩(픽셀 폰트).
    const chip = this.add
      .text(W / 2, 56, step.chip, { fontFamily: PIXEL_FONT, fontSize: '13px', color: '#f0c040' })
      .setOrigin(0.5);
    chip.setShadow(1, 1, '#000000', 3, false, true);
    layer.add(chip);

    // 큐 — 기본 이모지 대신 직접 그린 골드 픽셀 화살표(focus 방향 지시). 없으면 생략.
    const cue = step.arrow ? this.drawArrow(layer, W / 2, step.textY - 30, step.arrow) : null;
    const panel = this.add
      .rectangle(W / 2, step.textY + 14, W - 40, 50, 0x140d07, 0.82)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xf0c040, 0.4);
    const desc = this.add
      .text(W / 2, step.textY + 14, step.text, {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: '#e8dcc8',
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: W - 60, useAdvancedWrap: true }
      })
      .setOrigin(0.5);
    desc.setShadow(1, 1, '#000000', 0, false, true);
    layer.add([panel, desc]); // 화살표(cue)는 drawArrow가 이미 layer에 추가

    // 화살표는 초점 방향으로 살짝 까닥이며 시선 유도.
    if (this.motionOk && cue) {
      const dy = step.arrow === 'down' ? 6 : -6;
      this.tweens.add({ targets: cue, y: cue.y + dy, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // CTA + 진행 점 + 건너뛰기.
    const btn = this.makeButton(layer, W / 2, LOGICAL.height - 54, last ? '시작!' : '다음 ▶', () => this.advanceStep());

    this._steps.forEach((_, i) => {
      const dx = W / 2 - (this._steps.length - 1) * 7 + i * 14;
      const dot = this.add.circle(dx, LOGICAL.height - 84, 3, i === this._stepIndex ? 0xf0c040 : 0x6a5a44);
      layer.add(dot);
    });

    if (!last) {
      const skip = this.add
        .text(W - 12, 20, '건너뛰기', { fontFamily: BODY_FONT, fontSize: '12px', color: '#cbb89a' })
        .setOrigin(1, 0.5);
      skip.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.finish());
      layer.add(skip);
    }

    // 단계 등장 페이드(딤/외곽선 제외, 텍스트·버튼·화살표만).
    if (this.motionOk) {
      [chip, cue, panel, desc, btn.bg, btn.label].filter(Boolean).forEach((o) => {
        const target = o.alpha;
        o.alpha = 0;
        this.tweens.add({ targets: o, alpha: target, duration: 220 });
      });
    }
  }

  advanceStep() {
    if (this._stepIndex < this._steps.length - 1) {
      this._stepIndex += 1;
      this.renderStep();
    } else {
      this.finish();
    }
  }

  // ── 종료: 영속 + 입력 복구 + 씬 정지 ─────────────────────────────────
  finish() {
    if (this._finished) return;
    this._finished = true;
    this._stopPoseCycle(); // 스토리에서 바로 건너뛰기로 종료하는 경우의 타이머 정리
    GameState.markIntroSeen();
    GameState.markOnboarded(); // 튜토리얼이 탭 조작을 가르쳤으니 중복 힌트 토스트 억제

    const stop = () => {
      this._setBelowInput(true);
      this.scene.stop();
    };
    if (this.motionOk) {
      const targets = [this.coachLayer, this.storyLayer].filter(Boolean);
      if (targets.length) {
        this.tweens.add({ targets, alpha: 0, duration: 240, onComplete: stop });
        return;
      }
    }
    stop();
  }

  // 골드 픽셀 화살표(이모지 대신). dir: 'up' | 'down'. 로컬 좌표로 그려 y 트윈으로 까닥인다.
  drawArrow(layer, x, y, dir) {
    const g = this.add.graphics({ x, y });
    const up = dir !== 'down';
    const s = up ? 1 : -1; // 위로면 +, 아래면 부호 반전
    const stroke = (color, ox, oy) => {
      g.fillStyle(color, 1);
      g.fillTriangle(ox - 10, oy + s * 4, ox + 10, oy + s * 4, ox, oy - s * 9); // 화살촉
      g.fillRect(ox - 3, oy + (up ? 4 : -16), 6, 12); // 자루
    };
    stroke(0x000000, 1.5, 1.5); // 그림자(딤 위 대비)
    stroke(0xf0c040, 0, 0); // 골드 본체
    layer.add(g);
    return g;
  }

  // ── 공통 헬퍼 ────────────────────────────────────────────────────────
  makeButton(layer, x, y, label, onClick) {
    const bg = this.add.rectangle(x, y, 150, 34, 0xff6020).setStrokeStyle(1, 0x000000, 0.45);
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

  // Combat/Hub 입력 on/off — 인트로 동안 게임은 렌더되되 오조작은 막는다.
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
