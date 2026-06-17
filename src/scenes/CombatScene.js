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
  MOTION
} from '../constants/combat.js';
import { PIXEL_FONT } from '../constants/fonts.js';
import { prefersReducedMotion } from '../utils/motion.js';
import GameState from '../state/GameState.js';
import { rollDrop } from '../constants/drops.js';
import { WEAPON_RECIPES, defenseMultiplier } from '../constants/crafting.js';

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
      player: {
        getX: () => this.playerX,
        getAttackCooldown: () => this.currentWeapon().cooldown,
        attack: (enemy) => this.playerAttack(enemy),
        takeDamage: (amount) => this.takePlayerDamage(amount)
      }
    });
    this.director.start();
    this.combatReady = true;
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

    if (this.motionOk) {
      // idle bob 저장 — 공격 시 pause/resume해 x/scale 트윈과 간섭 방지
      this.idleBobTween = this.tweens.add({
        targets: this.character,
        y: this.groundY - 4,
        duration: 1100,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
      this.tweens.add({
        targets: this.shadow,
        scaleX: 0.92,
        alpha: 0.28,
        duration: 1100,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
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

  // 적 처치 → 드롭 롤 → GameState 가산(+토스트/체인지 이벤트) → 줍기 연출.
  onEnemyKilled(enemy) {
    const drop = rollDrop(enemy.typeKey);
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

    if (this.playerHP <= 0) this.onPlayerDeath();
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

  // 주인공 사망 — placeholder. 일단 잠시 후 HP 리셋 + 적 청소(로그라이크 런 구조는 다음 단계).
  onPlayerDeath() {
    this.director?.stop();
    this.director?.clearAll();
    this.triggerDangerPulse(false);

    const banner = this.add
      .text(LOGICAL.width / 2, COMBAT_H * 0.42, '런 종료 — 재구성 중…', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#ff6020'
      })
      .setOrigin(0.5)
      .setDepth(80);

    this.time.delayedCall(1400, () => {
      banner.destroy();
      // 사망 후 리셋 시점의 최신 maxHP로 풀피 복구(그동안 업그레이드했을 수 있음).
      this.maxHP = GameState.stats.maxHP;
      this.playerHP = this.maxHP;
      this.updateHpBar();
      this.character.clearTint();
      this.director?.start();
    });
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
