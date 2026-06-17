import Phaser from 'phaser';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import CombatDirector from '../objects/CombatDirector.js';
import { TEX, ENEMY_MANIFEST } from '../assets/manifest.js';
import {
  CHARACTER,
  COMBAT_H,
  COMBAT_VIEW,
  GROUND_LINE_RATIO,
  LOGICAL
} from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import {
  PLAYER,
  SLICE_SPAWN_LIST,
  COMBAT_COLORS,
  COMBAT_CSS,
  MOTION,
  WAVE,
  waveParams
} from '../constants/combat.js';
import { PIXEL_FONT, BODY_FONT } from '../constants/fonts.js';
import { prefersReducedMotion } from '../utils/motion.js';
import GameState from '../state/GameState.js';
import { rollDrop } from '../constants/drops.js';
import { WEAPON_RECIPES, STAT_UPGRADES, defenseMultiplier } from '../constants/crafting.js';
import { legacyOptions } from '../constants/meta.js';

// 전투 뷰(상단 58%): 4레이어 패럴랙스 + 주인공 + 자동 진행 전투.
// 적 스폰/이동/공격 타이밍은 CombatDirector가, 적 단위 연출은 Enemy가 담당.
// 주인공 연출(자동 공격 런지·피격 플래시·위험 펄스)은 이 씬이 소유한다.
export default class CombatScene extends Phaser.Scene {
  constructor() {
    super('CombatScene');
  }

  create() {
    this.motionOk = !prefersReducedMotion();
    this.combatReady = false;
    this.dangerOn = false;
    this.hitStopUntil = 0;   // 히트스톱 종료 타임스탬프 (ms)

    this.cameras.main.setViewport(
      COMBAT_VIEW.x,
      COMBAT_VIEW.y,
      COMBAT_VIEW.width,
      COMBAT_VIEW.height
    );
    this.cameras.main.setBackgroundColor(PALETTE.bgSky);

    this.parallax = new ParallaxBackground(this, this.motionOk);

    this.groundY = COMBAT_H * GROUND_LINE_RATIO;
    this.playerX = LOGICAL.width * CHARACTER.xRatio;
    // maxHP는 GameState가 소유 — 전투 시작 시 풀피로.
    this.maxHP = GameState.stats.maxHP;
    this.playerHP = this.maxHP;

    this.createCharacter();
    this.createVignette();
    this.createHud();
    this.createWaveHud();
    this.createResourceHud();
    this.createToast();

    this.bindGameState();

    // 적은 일괄 선행로드하지 않는다 — 이 전투의 스폰 목록만 지연 로드 후 시작.
    this.loadEncounterEnemies(SLICE_SPAWN_LIST, () => this.startEncounter());
  }

  // GameState 구독 — 허브에서 일어난 변경(업그레이드/합성)을 전투에 즉시 반영.
  // 씬 종료 시 누수 방지를 위해 unbinder를 모아 shutdown에서 해제.
  bindGameState() {
    const offChange = GameState.on('change', () => this.syncResourceHud());
    const offStats = GameState.on('stats', ({ stat }) => {
      if (stat !== 'maxHP') return;
      // maxHP 증가분만큼 현재 전투 HP도 즉시 회복(체감되는 보상).
      const delta = GameState.stats.maxHP - this.maxHP;
      this.maxHP = GameState.stats.maxHP;
      this.playerHP = Math.min(this.maxHP, this.playerHP + Math.max(0, delta));
      this.updateHpBar();
    });
    const offDrop = GameState.on('drop', (info) => this.onDropToast(info));
    this.events.once('shutdown', () => {
      offChange();
      offStats();
      offDrop();
    });
  }

  // 현재 장착 무기 정의(공격력 보너스/쿨다운/메카닉).
  currentWeapon() {
    return WEAPON_RECIPES[GameState.equippedWeapon] || WEAPON_RECIPES.pipe_wrench;
  }

  // ── 에셋 ────────────────────────────────────────────────────────────
  loadEncounterEnemies(spawnList, onReady) {
    const toLoad = spawnList.filter(
      (key) => !this.textures.exists(key) && ENEMY_MANIFEST[key]
    );
    if (toLoad.length === 0) {
      onReady();
      return;
    }
    toLoad.forEach((key) => this.load.image(key, ENEMY_MANIFEST[key]));
    this.load.once('complete', onReady);
    this.load.start();
  }

  startEncounter() {
    this.director = new CombatDirector(this, {
      spawnList: SLICE_SPAWN_LIST,
      groundY: this.groundY,
      depth: this.parallax.topDepth + 1,
      motionOk: this.motionOk,
      getWaveParams: () => waveParams(GameState.waveIndex),
      player: {
        getX: () => this.playerX,
        getAttackCooldown: () => this.currentWeapon().cooldown,
        attack: (enemy) => this.playerAttack(enemy),
        takeDamage: (amount) => this.takePlayerDamage(amount)
      }
    });
    this.director.start();
    this.combatReady = true;
    this.refreshWaveHud();
  }

  // 진행 중인 전투를 깔끔히 내린다 — 적/트윈/타이머 누수 없이(재시작/사망 공용).
  teardownEncounter() {
    this.combatReady = false;
    this.director?.stop();
    this.director?.clearAll(); // Enemy.destroy가 트윈·컨테이너까지 정리
    this.director = null;
    this.hitStopUntil = 0;

    // 주인공 트윈 정리 — 사망이 playerAttack 런지 중간에 나면 3단계 체인/onComplete
    // (idleBobTween.resume 등)이 teardown 후에도 발화해 새 런 bob 상태가 꼬인다.
    // idle bob도 character/shadow 대상이라 함께 죽으므로 restartRun에서 startIdleBob으로 재생성.
    this.tweens.killTweensOf(this.character);
    this.tweens.killTweensOf(this.shadow);
    this.idleBobTween = null;
    this.shadowBobTween = null;
  }

  // ── 주인공 ──────────────────────────────────────────────────────────
  createCharacter() {
    const tex = this.textures.get(TEX.SCRAPPER_STAGE_01).getSourceImage();
    this.charScale = CHARACTER.displayHeight / tex.height;
    this.charDisplayH = CHARACTER.displayHeight;

    this.shadow = this.add
      .ellipse(
        this.playerX,
        this.groundY + 4,
        CHARACTER.displayHeight * 0.42,
        12,
        0x000000,
        0.35
      )
      .setDepth(this.parallax.topDepth + 0.5);

    this.character = this.add
      .image(this.playerX, this.groundY, TEX.SCRAPPER_STAGE_01)
      // originX는 프레임 중심이 아니라 실측한 "몸 중심"(무기 패딩 보정) → playerX에 정확히 안착
      .setOrigin(CHARACTER.originX, CHARACTER.footOriginY)
      .setScale(this.charScale)
      .setDepth(this.parallax.topDepth + 1);

    this.startIdleBob();
  }

  // idle bob(주인공 + 그림자) 생성. teardown이 character/shadow 트윈을 통째로 killTweensOf
  // 하므로 새 런 시작 시 여기서 재생성해야 bob이 되살아난다(idleBobTween 상태 정상화).
  startIdleBob() {
    if (!this.motionOk) return;
    // idle bob 저장 — 공격 시 pause/resume해 x/scale 트윈과 간섭 방지
    this.idleBobTween = this.tweens.add({
      targets: this.character,
      y: this.groundY - 4,
      duration: 1100,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
    this.shadowBobTween = this.tweens.add({
      targets: this.shadow,
      scaleX: 0.92,
      alpha: 0.28,
      duration: 1100,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
  }

  // 한 적에게 데미지 적용 + 데미지숫자 + 처치 처리. isPierce면 메카닉(감전) 트리거 제외.
  dealDamage(enemy, amount, isPierce = false) {
    if (!enemy || enemy.dead) return;
    const dmg = Math.max(1, Math.round(amount));
    const killed = enemy.takeDamage(dmg);
    this.spawnDamageNumber(
      enemy.container.x,
      enemy.container.y - enemy.displayHeight - 10,
      dmg,
      isPierce ? COMBAT_CSS.pierce : COMBAT_CSS.damage
    );
    // 감전 메카닉 — 관통타는 제외(스펙).
    if (!isPierce && !killed) {
      const mech = this.currentWeapon().mechanic;
      if (mech?.type === 'shock' && Math.random() < mech.chance) {
        enemy.applyShock(mech.slowMult, mech.cdMult, mech.durationMs);
      }
    }
    if (killed) this.onEnemyKilled(enemy);
  }

  // [모션 훅] 자동 공격 3단계: anticipation → lunge(임팩트) → recovery.
  // 데미지는 lunge 완료(풀 익스텐션) 시 적용. 히트스톱은 임팩트 직후.
  playerAttack(enemy) {
    const apply = () => {
      if (!enemy || enemy.dead) return;
      const weapon = this.currentWeapon();
      const base = GameState.stats.atk + (weapon.atkBonus || 0);
      this.dealDamage(enemy, base);

      // 관통 메카닉 — 사거리 내 2번째 적에게 falloff 추가타(감전 트리거 제외).
      if (weapon.mechanic?.type === 'pierce' && this.director) {
        const inRange = this.director.enemiesInRange(this.playerX, PLAYER.attackRange);
        const second = inRange.find((e) => e !== enemy && !e.dead);
        if (second) this.dealDamage(second, base * weapon.mechanic.falloff, true);
      }

      // 히트스톱 — director.update를 잠깐 중단해 임팩트 정지감
      if (this.motionOk) {
        this.hitStopUntil = this.time.now + MOTION.hitStopMs;
      }
    };

    if (!this.motionOk) {
      apply();
      return;
    }

    // idle bob을 일시 중지해 x/scale 트윈과 y 트윈 간섭 차단
    this.idleBobTween?.pause();

    // 1단계: anticipation — 살짝 뒤로 당기며 쪼그라들기
    this.tweens.add({
      targets: this.character,
      x: this.playerX + MOTION.anticipationX,
      scaleX: this.charScale * MOTION.anticipationScaleX,
      scaleY: this.charScale * MOTION.anticipationScaleY,
      duration: MOTION.anticipationMs,
      ease: 'Quad.out',
      onComplete: () => {
        // 2단계: 런지 — 빠르고 강하게 앞으로 (스트레치)
        this.tweens.add({
          targets: this.character,
          x: this.playerX + MOTION.lungeX,
          scaleX: this.charScale * MOTION.lungeScaleX,
          scaleY: this.charScale * MOTION.lungeScaleY,
          duration: MOTION.lungeMs,
          ease: 'Expo.out',
          onComplete: () => {
            apply(); // 풀 익스텐션 시점에 데미지 + 히트스톱
            // 3단계: 복귀 — 탄성 있게 원위치
            this.tweens.add({
              targets: this.character,
              x: this.playerX,
              scaleX: this.charScale,
              scaleY: this.charScale,
              duration: MOTION.recoveryMs,
              ease: 'Back.out',
              onComplete: () => {
                this.idleBobTween?.resume();
              }
            });
          }
        });
      }
    });
  }

  // 적 처치 → 웨이브 진행 → 드롭 롤(웨이브 배율) → GameState 가산 → 줍기 연출.
  onEnemyKilled(enemy) {
    // 1) 처치 누적 → 웨이브 진행. 넘어가면 HUD 갱신 + 배너.
    const { waveChanged, waveIndex } = GameState.addKill();
    this.refreshWaveHud();
    if (waveChanged) this.showWaveBanner(waveIndex);

    // 2) 드롭 — 코인은 round, 파츠는 floor로 dropMult 반영(희귀 파츠 과인플레 방지).
    const drop = rollDrop(enemy.typeKey);
    const mult = waveParams(GameState.waveIndex).dropMult;
    if (mult !== 1) {
      drop.coins = Math.round(drop.coins * mult);
      drop.SCRAP = Math.floor(drop.SCRAP * mult);
      drop.ELEC = Math.floor(drop.ELEC * mult);
      drop.POWDER = Math.floor(drop.POWDER * mult);
    }
    const hasAny = drop.coins || drop.SCRAP || drop.ELEC || drop.POWDER;
    if (!hasAny) return;
    const x = enemy.container.x;
    const y = enemy.container.y - enemy.displayHeight * 0.5;
    GameState.applyDrop(drop, x, y); // 상태 가산 + 'drop'/'change' 발행
    this.spawnPickup(drop, x, y); // 사망 위치 → HUD 카운터로 튐
  }

  takePlayerDamage(amount) {
    if (this.playerHP <= 0) return;
    // 방어력 피해감소 적용(적→플레이어). def*4%, 캡 20%.
    const dmg = Math.max(1, Math.round(amount * defenseMultiplier(GameState.stats.def)));
    this.playerHP = Math.max(0, this.playerHP - dmg);
    this.updateHpBar();
    this.flashPlayer();
    this.spawnDamageNumber(
      this.character.x,
      this.groundY - this.charDisplayH * 0.7,
      dmg,
      COMBAT_CSS.playerHurt
    );

    const ratio = this.playerHP / this.maxHP;
    this.triggerDangerPulse(ratio <= PLAYER.dangerThreshold && this.playerHP > 0, ratio);

    if (this.playerHP <= 0) this._triggerDeathFlash(() => this.onPlayerDeath());
  }

  // [모션 훅] 피격 플래시 — tint 후 타이머 clearTint (텍스처 스왑 금지).
  flashPlayer() {
    this.character.setTint(0xff5050);
    this.time.delayedCall(120, () => this.character.clearTint());
    if (!this.motionOk) return;
    this.character.x = this.playerX - 6;
    this.tweens.add({
      targets: this.character,
      x: this.playerX,
      duration: 180,
      ease: 'Back.out'
    });
  }

  // [모션 훅] 사망 확정 순간 붉은 화면 플래시 — "당했다" 강조. 과하지 않게 짧고 강하게.
  // reduced-motion 시 즉시 after() 호출.
  _triggerDeathFlash(after) {
    if (!this.motionOk) {
      after();
      return;
    }
    const flash = this.add
      .rectangle(0, 0, LOGICAL.width, COMBAT_H, 0xcc1800, 0)
      .setOrigin(0, 0)
      .setDepth(80);

    this.tweens.add({
      targets: flash,
      alpha: MOTION.deathFlashAlpha,
      duration: MOTION.deathFlashMs,
      ease: 'Quad.out',
      onComplete: () => {
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: MOTION.deathFlashOutMs,
          ease: 'Quad.in',
          onComplete: () => {
            flash.destroy();
            after();
          }
        });
      }
    });
  }

  // 주인공 사망 → 런 종료. 전투를 내리고 사망 오버레이(요약 + 유산 선택)를 띄운다.
  onPlayerDeath() {
    this.teardownEncounter();
    this.triggerDangerPulse(false);
    this.character.clearTint();
    this.showDeathOverlay();
  }

  // ── 사망 오버레이: 런 요약 + 유산 4선택 + "들고 시작" ───────────────────
  // [모션 훅] showDeathOverlay / hideDeathOverlay / playRunResetTransition —
  //           전환 정교화는 motion-engineer가 이 훅 위에 얹는다.
  showDeathOverlay() {
    const W = LOGICAL.width;
    const H = COMBAT_H;
    this.selectedLegacy = null;

    const layer = this.add.container(0, 0).setDepth(90);
    this.deathLayer = layer;

    // ── 풀커버 암막 ────────────────────────────────────────────────────
    const scrim = this.add.rectangle(0, 0, W, H, 0x0a0805, 0.88).setOrigin(0, 0);
    layer.add(scrim);

    // ── 타이틀 ─────────────────────────────────────────────────────────
    const titleText = this.add
      .text(W / 2, 70, '런 종료', {
        fontFamily: PIXEL_FONT,
        fontSize: '22px',
        color: '#ff6020',
        stroke: '#3a1000',
        strokeThickness: 4
      })
      .setOrigin(0.5);
    layer.add(titleText);

    // ── 런 요약 — 도달 웨이브 / 처치 수 / 모은 코인 ─────────────────────
    const summaryLines = [
      `도달 웨이브  ${GameState.waveIndex}`,
      `처치  ${GameState.runKills}`,
      `모은 코인  ${GameState.coins}`
    ];
    const summaryTexts = summaryLines.map((line, i) => {
      const t = this.add
        .text(W / 2, 104 + i * 16, line, {
          fontFamily: PIXEL_FONT,
          fontSize: '11px',
          color: '#cbb89a'
        })
        .setOrigin(0.5);
      layer.add(t);
      return t;
    });

    const subtitleText = this.add
      .text(W / 2, 162, '유산 1개를 들고 새 런 시작', {
        fontFamily: BODY_FONT,
        fontSize: '10px',
        color: '#9a8b78'
      })
      .setOrigin(0.5);
    layer.add(subtitleText);

    // ── 유산 카드 2×2 (buildLegacyCard 내부에서 container 생성) ─────────
    const opts = legacyOptions(GameState);
    this.legacyCards = [];
    const slotW = 86;
    const slotH = 46;
    const gapX = 16;
    const gapY = 14;
    const gridW = slotW * 2 + gapX;
    const startX = (W - gridW) / 2;
    const startY = 178;

    opts.forEach((opt, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = startX + col * (slotW + gapX) + slotW / 2;
      const cy = startY + row * (slotH + gapY) + slotH / 2;
      this.legacyCards.push(this.buildLegacyCard(layer, opt, cx, cy, slotW, slotH));
    });

    const anyEnabled = opts.some((o) => o.enabled);

    // ── 확정 버튼 ──────────────────────────────────────────────────────
    const btnBg = this.add
      .rectangle(W / 2, 322, 132, 30, 0xff6020)
      .setStrokeStyle(1, 0x000000, 0.45);
    const btnLabel = this.add
      .text(W / 2, 322, anyEnabled ? '들고 시작' : '새 런 시작', {
        fontFamily: PIXEL_FONT,
        fontSize: '12px',
        color: '#1a1008'
      })
      .setOrigin(0.5);
    layer.add(btnBg);
    layer.add(btnLabel);
    this.confirmBtn = { bg: btnBg, label: btnLabel };

    btnBg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (!btnBg.getData('enabled')) return;
      this.confirmLegacy();
    });

    // 첫 런(유산 없음) 또는 들고 갈 게 전혀 없으면 → 즉시 활성.
    this.setConfirmEnabled(!anyEnabled);

    // ── 연출 분기 ──────────────────────────────────────────────────────
    if (!this.motionOk) {
      // reduced-motion: 즉시 전체 표시, 상태 변경 없음
      return;
    }

    // motionOk: 각 요소를 개별 숨김 → 순차 트윈 등장
    // (layer 자체는 항상 visible — 자식을 개별 제어)
    const origSummaryY = summaryTexts.map((t) => t.y);
    const origSubtitleY = subtitleText.y;
    const origCardY = this.legacyCards.map((c) => c.cardContainer.y);

    scrim.setAlpha(0);
    titleText.setAlpha(0).setScale(0.55);
    summaryTexts.forEach((t, i) => t.setAlpha(0).setY(origSummaryY[i] + 8));
    subtitleText.setAlpha(0).setY(origSubtitleY + 6);
    this.legacyCards.forEach((c, i) =>
      c.cardContainer.setAlpha(0).setY(origCardY[i] + MOTION.deathCardSlideY)
    );
    btnBg.setAlpha(0);
    btnLabel.setAlpha(0);

    // 1. 암막 페이드인 (600ms)
    this.tweens.add({
      targets: scrim,
      alpha: 0.88,
      duration: MOTION.deathScrimMs,
      ease: 'Quad.out'
    });

    // 2. 타이틀 스케일인 + 주황 글로우 흔들림
    this.time.delayedCall(MOTION.deathTitleDelay, () => {
      if (!this.deathLayer) return;
      this.tweens.add({
        targets: titleText,
        alpha: 1,
        scale: 1,
        duration: MOTION.deathTitleInMs,
        ease: 'Back.out',
        onComplete: () => {
          if (!titleText.active) return;
          // 계단식 4단계 흔들림 — 레트로 임팩트
          const amp = MOTION.deathTitleShakeAmp;
          [amp, -amp * 0.55, amp * 0.28, 0].forEach((dx, idx) => {
            this.time.delayedCall(idx * 55, () => {
              if (titleText.active) titleText.x = W / 2 + dx;
            });
          });
        }
      });
    });

    // 3. 요약 항목 슬라이드인 (스태거)
    summaryTexts.forEach((t, i) => {
      this.time.delayedCall(
        MOTION.deathSummaryDelay + i * MOTION.deathSummaryStagger,
        () => {
          if (!this.deathLayer || !t.active) return;
          this.tweens.add({
            targets: t,
            alpha: 1,
            y: origSummaryY[i],
            duration: 150,
            ease: 'Quad.out'
          });
        }
      );
    });

    // subtitle
    this.time.delayedCall(
      MOTION.deathSummaryDelay + summaryTexts.length * MOTION.deathSummaryStagger,
      () => {
        if (!this.deathLayer || !subtitleText.active) return;
        this.tweens.add({
          targets: subtitleText,
          alpha: 1,
          y: origSubtitleY,
          duration: 150,
          ease: 'Quad.out'
        });
      }
    );

    // 4. 유산 카드 스태거 (아래서 올라오며 등장)
    this.legacyCards.forEach((c, i) => {
      this.time.delayedCall(
        MOTION.deathCardDelay + i * MOTION.deathCardStagger,
        () => {
          if (!this.deathLayer || !c.cardContainer.active) return;
          this.tweens.add({
            targets: c.cardContainer,
            alpha: 1,
            y: origCardY[i],
            duration: 180,
            ease: 'Quad.out'
          });
        }
      );
    });

    // 5. 확정 버튼 (카드 완료 후)
    const btnDelay =
      MOTION.deathCardDelay + this.legacyCards.length * MOTION.deathCardStagger + 60;
    this.time.delayedCall(btnDelay, () => {
      if (!this.deathLayer) return;
      this.tweens.add({
        targets: [btnBg, btnLabel],
        alpha: 1,
        duration: 180,
        ease: 'Quad.out'
      });
    });
  }

  buildLegacyCard(layer, opt, cx, cy, w, h) {
    const enabled = opt.enabled;

    // container로 묶어 hover/select 트윈을 한 번에 적용
    const cardContainer = this.add.container(cx, cy);
    cardContainer.setSize(w, h);

    const bg = this.add
      .rectangle(0, 0, w, h, enabled ? 0x1c1712 : 0x141210, 1)
      .setStrokeStyle(2, enabled ? 0x3d2b1a : 0x241c14, 1);
    const title = this.add
      .text(0, -12, this.legacyTitle(opt), {
        fontFamily: PIXEL_FONT,
        fontSize: '11px',
        color: enabled ? '#f0c040' : '#5a4f3e'
      })
      .setOrigin(0.5);
    const detail = this.add
      .text(0, 8, this.legacyDetail(opt), {
        fontFamily: BODY_FONT,
        fontSize: '9px',
        color: enabled ? '#cbb89a' : '#4f463a',
        align: 'center'
      })
      .setOrigin(0.5);
    detail.setShadow(1, 1, '#000000', 0, false, true);

    cardContainer.add([bg, title, detail]);
    layer.add(cardContainer);

    const card = { opt, bg, cardContainer, enabled };

    if (enabled) {
      // interactive는 container에 걸어 hover/select를 한 번에 처리
      cardContainer
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.selectLegacy(card));

      if (this.motionOk) {
        cardContainer
          .on('pointerover', () => {
            this.tweens.add({
              targets: cardContainer,
              scaleX: MOTION.legacyHoverScale,
              scaleY: MOTION.legacyHoverScale,
              duration: 100,
              ease: 'Quad.out'
            });
          })
          .on('pointerout', () => {
            this.tweens.add({
              targets: cardContainer,
              scaleX: 1,
              scaleY: 1,
              duration: 120,
              ease: 'Quad.in'
            });
          });
      }
    }
    return card;
  }

  legacyTitle(opt) {
    switch (opt.type) {
      case 'weapon':
        return '무기';
      case 'parts':
        return '파츠';
      case 'coins':
        return '코인';
      case 'stat':
        return '스탯';
      default:
        return '';
    }
  }

  legacyDetail(opt) {
    switch (opt.type) {
      case 'weapon':
        return opt.enabled ? (WEAPON_RECIPES[opt.weapon]?.name || opt.weapon) : '기본 무기뿐';
      case 'parts': {
        if (!opt.enabled) return '보유 없음';
        const p = opt.parts;
        const bits = [];
        if (p.SCRAP) bits.push(`S+${p.SCRAP}`);
        if (p.ELEC) bits.push(`E+${p.ELEC}`);
        if (p.POWDER) bits.push(`P+${p.POWDER}`);
        return bits.join(' ');
      }
      case 'coins':
        return opt.enabled ? `+${opt.coins} 코인` : '보유 없음';
      case 'stat':
        return opt.enabled ? `${STAT_UPGRADES[opt.stat]?.label || opt.stat} Lv1` : '투자 없음';
      default:
        return '';
    }
  }

  selectLegacy(card) {
    this.selectedLegacy = card.opt;
    // 금 테두리 강조 + 나머지 기본 테두리 복귀
    this.legacyCards.forEach((c) => {
      if (!c.enabled) return;
      c.bg.setStrokeStyle(2, c === card ? 0xf0c040 : 0x3d2b1a, 1);
    });
    // 선택 카드 펄스 (scale 1 → 1.06 → 1, yoyo×repeat×2 ≈ 400ms)
    if (this.motionOk && card.cardContainer.active) {
      this.tweens.killTweensOf(card.cardContainer);
      this.tweens.add({
        targets: card.cardContainer,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: MOTION.legacyPulseMs,
        ease: 'Quad.out',
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          if (card.cardContainer.active) card.cardContainer.setScale(1);
        }
      });
    }
    this.setConfirmEnabled(true);
  }

  setConfirmEnabled(on) {
    const { bg, label } = this.confirmBtn;
    bg.setData('enabled', on);
    bg.setFillStyle(on ? 0xff6020 : 0x2a2a2a);
    label.setColor(on ? '#1a1008' : '#6a5a50');

    // 기존 펄스 트윈 정리 후 재설정
    if (this._confirmPulseTween) {
      this._confirmPulseTween.stop();
      this._confirmPulseTween = null;
    }
    bg.setAlpha(1);

    if (on && this.motionOk) {
      // 활성화 시 alpha 반복 펄스 — 주목 유도, 선택 대기감
      this._confirmPulseTween = this.tweens.add({
        targets: bg,
        alpha: 0.72,
        duration: MOTION.confirmPulseMs,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }

  confirmLegacy() {
    // 선택된 옵션 → 유산 payload(없으면 빈손).
    const opt = this.selectedLegacy;
    let legacy = null;
    if (opt) {
      if (opt.type === 'weapon') legacy = { type: 'weapon', weapon: opt.weapon };
      else if (opt.type === 'parts') legacy = { type: 'parts', parts: opt.parts };
      else if (opt.type === 'coins') legacy = { type: 'coins', coins: opt.coins };
      else if (opt.type === 'stat') legacy = { type: 'stat', stat: opt.stat };
    }
    GameState.setLegacy(legacy); // meta.legacy 저장
    GameState.startNewRun(); // 유산 소비 + run 리셋 + runCount++
    this.playRunResetTransition(() => this.restartRun());
  }

  // [모션 훅] 확정 후 오렌지 플래시 → 전투뷰 복귀. 짧고 경쾌한 런 리셋 전환.
  // 오렌지 플래시 정점에서 deathLayer를 즉시 숨기고 after()로 전투 복귀 준비 →
  // 암막색 rect가 페이드아웃되며 전투뷰가 자연스럽게 드러남.
  playRunResetTransition(after) {
    if (!this.motionOk || !this.deathLayer) {
      after();
      return;
    }

    // 확정 버튼 펄스 먼저 정리
    if (this._confirmPulseTween) {
      this._confirmPulseTween.stop();
      this._confirmPulseTween = null;
      this.confirmBtn?.bg.setAlpha(1);
    }

    const W = LOGICAL.width;
    const H = COMBAT_H;
    // deathLayer(depth 90) 위에 플래시 레이어
    const flash = this.add
      .rectangle(0, 0, W, H, 0xff7010, 0)
      .setOrigin(0, 0)
      .setDepth(95);

    // 1단계: 오렌지 플래시 인
    this.tweens.add({
      targets: flash,
      alpha: 0.82,
      duration: MOTION.resetFlashMs,
      ease: 'Quad.out',
      onComplete: () => {
        // 플래시 정점: deathLayer 즉시 숨김 + 전투 복귀 콜백
        if (this.deathLayer) this.deathLayer.setAlpha(0);
        after();
        // 2단계: 암막색으로 교체 후 페이드아웃 → 전투뷰 서서히 드러남
        flash.setFillStyle(0x0a0805);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: MOTION.resetFadeInMs,
          ease: 'Quad.out',
          onComplete: () => flash.destroy()
        });
      }
    });
  }

  hideDeathOverlay() {
    this.deathLayer?.destroy();
    this.deathLayer = null;
    this.legacyCards = null;
    this.confirmBtn = null;
    this.selectedLegacy = null;
  }

  // 새 런으로 전투 재시작 — HP 풀피, 웨이브/자원 HUD 갱신, 새 director.
  restartRun() {
    this.hideDeathOverlay();
    this.maxHP = GameState.stats.maxHP;
    this.playerHP = this.maxHP;
    this.updateHpBar();
    this.character.clearTint();
    // teardown이 런지/idle 트윈을 죽여 x/y/scale이 중간값으로 멈췄을 수 있으니 기준값 복원
    this.character.setPosition(this.playerX, this.groundY).setScale(this.charScale);
    this.shadow.setScale(1).setAlpha(0.35); // 그림자 bob 기준값 복원
    this.startIdleBob(); // bob 재생성 — 이후 playerAttack의 pause/resume가 정상 동작
    this.syncResourceHud();
    this.startEncounter(); // 새 director 구성 + refreshWaveHud
  }

  // ── HUD: 주인공 HP바 (전투뷰 상단) ──────────────────────────────────
  createHud() {
    const x = 10;
    const y = 10;
    const w = 124;
    const h = 9;
    this.hpBarW = w;

    this.add
      .rectangle(x, y, w + 2, h + 2, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(60);
    this.add
      .rectangle(x + 1, y + 1, w, h, PALETTE.hubSecondary)
      .setOrigin(0, 0)
      .setDepth(60);
    this.hpFill = this.add
      .rectangle(x + 1, y + 1, w, h, COMBAT_COLORS.gold)
      .setOrigin(0, 0)
      .setDepth(61);

    this.add
      .text(x, y + h + 4, 'SCRAPPER', {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
        color: '#cbb89a'
      })
      .setOrigin(0, 0)
      .setDepth(61);
  }

  updateHpBar() {
    const ratio = Phaser.Math.Clamp(this.playerHP / this.maxHP, 0, 1);
    this.hpFill.width = this.hpBarW * ratio;
    // 위험 구간이면 바 색도 주황으로
    this.hpFill.fillColor =
      ratio <= PLAYER.dangerThreshold ? COMBAT_COLORS.electric : COMBAT_COLORS.gold;
  }

  // ── 웨이브 HUD (HP바/라벨 아래, 좌상단) ──────────────────────────────
  createWaveHud() {
    const x = 10;
    this.waveText = this.add
      .text(x, 34, 'WAVE 0', {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: '#ff6020'
      })
      .setOrigin(0, 0)
      .setDepth(61);
    this.waveText.setShadow(1, 1, '#000000', 0, false, true);

    const barY = 46;
    this.waveBarW = 64;
    this.add
      .rectangle(x, barY, this.waveBarW + 2, 5, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarTrack = this.add
      .rectangle(x + 1, barY + 1, this.waveBarW, 3, PALETTE.hubSecondary)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarFill = this.add
      .rectangle(x + 1, barY + 1, 0, 3, COMBAT_COLORS.toxic)
      .setOrigin(0, 0)
      .setDepth(61);

    this.refreshWaveHud();
  }

  refreshWaveHud() {
    if (!this.waveText) return;
    this.waveText.setText(`WAVE ${GameState.waveIndex}`);
    const inWave = GameState.runKills % WAVE.killsPerWave;
    this.waveBarFill.width = this.waveBarW * (inWave / WAVE.killsPerWave);
  }

  // [모션 훅] 웨이브 진입 배너 — 스케일인 → 유지 → 스케일업+페이드. 전투 흐름 최소 간섭.
  showWaveBanner(n) {
    const t = this.add
      .text(LOGICAL.width / 2, COMBAT_H * 0.3, `WAVE ${n}`, {
        fontFamily: PIXEL_FONT,
        fontSize: '20px',
        color: '#ff6020',
        stroke: '#1a1008',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(75);

    if (!this.motionOk) {
      this.time.delayedCall(700, () => t.destroy());
      return;
    }

    t.setScale(0.6).setAlpha(0);
    this.tweens.add({
      targets: t,
      scale: 1,
      alpha: 1,
      duration: MOTION.waveBannerInMs,
      ease: 'Back.out',
      onComplete: () => {
        this.time.delayedCall(MOTION.waveBannerStayMs, () => {
          if (!t.active) return;
          // 아웃: 스케일 업 + 페이드 — 터지듯 사라져 전투에 다시 집중
          this.tweens.add({
            targets: t,
            scale: 1.22,
            alpha: 0,
            duration: MOTION.waveBannerOutMs,
            ease: 'Quad.in',
            onComplete: () => t.destroy()
          });
        });
      }
    });
  }

  // ── 자원 HUD (전투뷰 우상단): 코인/스크랩/ELEC/POWDER 카운터 ──────────
  // 줍기 연출이 빨려드는 목적지이기도 하다(좌표를 resHud에 저장).
  createResourceHud() {
    const y = 14;
    const items = [
      { key: 'coins', tex: TEX.COIN_REWARD, color: COMBAT_COLORS.gold },
      { key: 'SCRAP', tex: TEX.SCRAP_PARTS, color: COMBAT_COLORS.scrap },
      { key: 'ELEC', color: PALETTE.accentToxic },
      { key: 'POWDER', color: PALETTE.accentElectric }
    ];
    const slotW = 50;
    const startX = LOGICAL.width - items.length * slotW + 8;
    this.resHud = {};

    items.forEach((it, i) => {
      const x = startX + i * slotW;
      if (it.tex && this.textures.exists(it.tex)) {
        const src = this.textures.get(it.tex).getSourceImage();
        this.add
          .image(x, y, it.tex)
          .setOrigin(0, 0.5)
          .setScale(16 / src.height)
          .setDepth(61);
      } else {
        // ELEC/POWDER는 전용 아이콘이 없어 색칩으로 표기
        this.add
          .rectangle(x + 1, y, 9, 9, it.color)
          .setOrigin(0, 0.5)
          .setStrokeStyle(1, 0x000000, 0.5)
          .setDepth(61);
      }
      const txt = this.add
        .text(x + 15, y, '0', {
          fontFamily: PIXEL_FONT,
          fontSize: '10px',
          color: '#f4ead2'
        })
        .setOrigin(0, 0.5)
        .setDepth(61);
      txt.setShadow(1, 1, '#000000', 0, false, true);
      this.resHud[it.key] = { txt, x, y };
    });

    this.syncResourceHud();
  }

  syncResourceHud() {
    if (!this.resHud) return;
    this.resHud.coins.txt.setText(String(GameState.coins));
    this.resHud.SCRAP.txt.setText(String(GameState.parts.SCRAP));
    this.resHud.ELEC.txt.setText(String(GameState.parts.ELEC));
    this.resHud.POWDER.txt.setText(String(GameState.parts.POWDER));
  }

  // ── 드롭 줍기 연출 — 사망 위치에서 HUD 카운터로 튐 ─────────────────────
  spawnPickup(drop, x, y) {
    const types = [
      { key: 'coins', tex: TEX.COIN_REWARD, color: COMBAT_COLORS.gold },
      { key: 'SCRAP', tex: TEX.SCRAP_PARTS, color: COMBAT_COLORS.scrap },
      { key: 'ELEC', color: PALETTE.accentToxic },
      { key: 'POWDER', color: PALETTE.accentElectric }
    ];
    types.forEach((t, i) => {
      if (!drop[t.key]) return;
      this.flyPickup(t, x, y, this.resHud[t.key], i);
    });
  }

  flyPickup(type, x, y, target, idx) {
    if (!target) return;
    const pulse = () => this.pulseCounter(target.txt);
    if (!this.motionOk) {
      pulse();
      return;
    }

    const sx = x + Phaser.Math.Between(-MOTION.pickupSpreadX, MOTION.pickupSpreadX);
    let obj;
    if (type.tex && this.textures.exists(type.tex)) {
      const src = this.textures.get(type.tex).getSourceImage();
      obj = this.add.image(sx, y, type.tex).setScale(18 / src.height);
    } else {
      obj = this.add.rectangle(sx, y, 10, 10, type.color).setStrokeStyle(1, 0x000000, 0.5);
    }
    obj.setDepth(66);
    const s0 = obj.scaleX;

    // 1) 살짝 튀어오름 → 2) HUD 카운터로 빨려가며 회전·축소
    this.tweens.add({
      targets: obj,
      y: y - MOTION.pickupPopUpY,
      duration: MOTION.pickupPopMs,
      ease: 'Quad.out',
      onComplete: () => {
        this.tweens.add({
          targets: obj,
          x: target.x,
          y: target.y,
          angle: MOTION.pickupSpinDeg,
          scaleX: s0 * 0.55,
          scaleY: s0 * 0.55,
          delay: idx * 40,
          duration: MOTION.pickupFlyMs,
          ease: 'Back.in',
          onComplete: () => {
            obj.destroy();
            pulse();
          }
        });
      }
    });
  }

  pulseCounter(txt) {
    if (!this.motionOk) return;
    this.tweens.add({
      targets: txt,
      scaleX: 1.35,
      scaleY: 1.35,
      duration: 90,
      yoyo: true,
      ease: 'Quad.out'
    });
  }

  // ── 드롭 토스트 (희귀 파츠 획득 시 중앙상단 배너) ──────────────────────
  // 코인/스크랩은 매 처치라 줍기 연출로 충분 — 토스트는 ELEC/POWDER 같은
  // 의미 있는 드롭에만 띄워 스팸/오버드로우를 막는다(designer 박스 스펙 유지).
  createToast() {
    this.toast = this.add
      .container(LOGICAL.width / 2, 40)
      .setDepth(78)
      .setAlpha(0)
      .setVisible(false);
    this.toastBg = this.add
      .rectangle(0, 0, 160, 36, 0x12100c, 0.9)
      .setStrokeStyle(1, PALETTE.accentGold, 0.85);
    this.toastChip = this.add.rectangle(-62, 0, 12, 12, PALETTE.accentToxic);
    this.toastText = this.add
      .text(-46, 0, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '11px',
        color: '#ffffff'
      })
      .setOrigin(0, 0.5);
    this.toast.add([this.toastBg, this.toastChip, this.toastText]);
  }

  onDropToast(info) {
    const parts = [];
    if (info.ELEC) parts.push(`ELEC +${info.ELEC}`);
    if (info.POWDER) parts.push(`POWDER +${info.POWDER}`);
    if (parts.length === 0) return;
    const accent = info.ELEC ? PALETTE.accentToxic : PALETTE.accentElectric;
    this.showToast(parts.join('   '), accent);
  }

  showToast(text, accent) {
    this.toastText.setText(text);
    this.toastChip.setFillStyle(accent);
    this.toastBg.setStrokeStyle(1, accent, 0.9);
    this.toast.setVisible(true);
    this.tweens.killTweensOf(this.toast);
    this.toastTimer?.remove();

    if (!this.motionOk) {
      this.toast.setAlpha(1);
      this.toastTimer = this.time.delayedCall(MOTION.toastStayMs, () =>
        this.toast.setAlpha(0).setVisible(false)
      );
      return;
    }

    this.toast.setAlpha(0).setY(34);
    this.tweens.add({
      targets: this.toast,
      alpha: 1,
      y: 40,
      duration: MOTION.toastInMs,
      ease: 'Back.out',
      onComplete: () => {
        this.toastTimer = this.time.delayedCall(MOTION.toastStayMs, () => {
          this.tweens.add({
            targets: this.toast,
            alpha: 0,
            y: 34,
            duration: MOTION.toastOutMs,
            ease: 'Quad.in',
            onComplete: () => this.toast.setVisible(false)
          });
        });
      }
    });
  }

  // ── 데미지 숫자 팝업 ─────────────────────────────────────────────────
  spawnDamageNumber(x, y, amount, color) {
    // 가로 흩뿌림: 같은 위치에 숫자가 겹치는 것 방지 + 레트로 튐 감성
    const driftX = Phaser.Math.Between(-MOTION.dmgDriftX, MOTION.dmgDriftX);
    const t = this.add
      .text(x + driftX, y, String(amount), {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color,
        stroke: '#1a1008',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(70)
      .setScale(MOTION.dmgScaleFrom); // 팝 시작 스케일

    if (!this.motionOk) {
      t.setScale(1);
      this.time.delayedCall(400, () => t.destroy());
      return;
    }

    // 스케일 팝 — 임팩트 순간 크게 터졌다 정상으로
    this.tweens.add({
      targets: t,
      scale: 1,
      duration: MOTION.dmgPopMs,
      ease: 'Back.out'
    });

    // 상승 + 페이드 — 팝 직후 시작해 자연스럽게 이어짐
    this.tweens.add({
      targets: t,
      y: y - MOTION.dmgRiseY,
      alpha: 0,
      delay: MOTION.dmgFadeDelay,
      duration: MOTION.dmgFadeMs,
      ease: 'Quad.out',
      onComplete: () => t.destroy()
    });
  }

  // ── 비네트 + 위험 펄스 ──────────────────────────────────────────────
  createVignette() {
    // 은은한 상시 비네트
    const g = this.add.graphics().setDepth(50);
    g.lineStyle(3, 0x000000, 0.35);
    g.strokeRect(1.5, 1.5, LOGICAL.width - 3, COMBAT_H - 3);

    // [모션 훅] 위험 펄스용 붉은 비네트 — 평소 alpha 0, HP 위험 시 펄스.
    this.dangerVignette = this.add.graphics().setDepth(51).setAlpha(0);
    this.dangerVignette.lineStyle(6, COMBAT_COLORS.danger, 1);
    this.dangerVignette.strokeRect(3, 3, LOGICAL.width - 6, COMBAT_H - 6);
  }

  // [모션 훅] HP 위험 시 가장자리 붉은 펄스 on/off.
  // hpRatio: 현재 HP 비율(0~1) — 낮을수록 심장박동이 빠름.
  triggerDangerPulse(on, hpRatio = PLAYER.dangerThreshold) {
    if (on === this.dangerOn) return;
    this.dangerOn = on;

    if (on) {
      if (!this.motionOk) {
        this.dangerVignette.setAlpha(0.5);
        return;
      }
      this._startHeartbeatPulse(hpRatio);
    } else {
      this.dangerTween?.stop();
      this.dangerTween = null;
      this.tweens.add({
        targets: this.dangerVignette,
        alpha: 0,
        duration: 260
      });
    }
  }

  // 심장박동 리듬: 빠른 수축(in) → 느린 이완(out) → 재귀 반복.
  // HP가 낮을수록 speedMult가 커져(분모 작아짐) 빠르게 박동.
  _startHeartbeatPulse(hpRatio) {
    // 위험 구간(0~dangerThreshold)에서 hpRatio가 낮을수록 빠름
    const t = Phaser.Math.Clamp(
      (PLAYER.dangerThreshold - hpRatio) / PLAYER.dangerThreshold,
      0,
      1
    );
    const speedMult = Phaser.Math.Linear(1.0, MOTION.dangerPulseMinSpeedMult, t);
    const inMs = MOTION.dangerPulseInMs * speedMult;
    const outMs = MOTION.dangerPulseOutMs * speedMult;

    // 이전 심박 트윈 정리
    this.dangerTween?.stop();

    const beat = () => {
      if (!this.dangerOn) return; // 위험 해제되면 자동 종료
      this.dangerTween = this.tweens.add({
        targets: this.dangerVignette,
        alpha: MOTION.dangerPulseAlphaMax,
        duration: inMs,
        ease: 'Quad.in',
        onComplete: () => {
          if (!this.dangerOn) return;
          this.dangerTween = this.tweens.add({
            targets: this.dangerVignette,
            alpha: MOTION.dangerPulseAlphaMin,
            duration: outMs,
            ease: 'Quad.out',
            onComplete: beat  // 재귀 — 다음 박동
          });
        }
      });
    };
    beat();
  }

  update(time, delta) {
    this.parallax.update(delta);
    // 히트스톱 구간엔 director(이동/공격 타이밍)만 중단 — 트윈 연출은 계속 진행
    if (this.combatReady && time >= this.hitStopUntil) {
      this.director.update(delta);
    }
  }
}
