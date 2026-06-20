import Phaser from 'phaser';
import { ENEMY_TYPES, COMBAT_COLORS, MOTION, ELITE } from '../constants/combat.js';
import { ENEMY_BEHAVIORS } from '../constants/enemyBehaviors.js';

// 의사난수 sin-hash O(1) — 감전 명멸/위성 배치/화염 엠버 공용.
const _shockHash = (n) => { const v = Math.sin(n + 1.0) * 43758.5453; return v - Math.floor(v); };

// 적 VFX 공유 소프트 글로우 텍스처 키 — CombatScene.create()에서 1회 생성, 재생성 금지.
const GFX_GLOW_KEY = 'fx-glow';

// 적 1마리 = 스프라이트 + 그림자 + 머리 위 HP바를 묶은 Container.
// 이동/피격/사망을 자체 메서드로 캡슐화하고, motion-engineer가 얹을 훅을
// 명확한 메서드(flashHit / lungeAttack / die)로 남긴다.
//
// 좌표 모델: worldX(논리 x) + shakeX 를 매 프레임 syncPosition()에서 container에 반영.
//   → 셰이크는 cameras.shake()가 아니라 적 개별 offset(perf 지시). 이동과 충돌 안 함.
export default class Enemy {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} cfg { typeKey, x, groundY, depth, motionOk, onDeath }
   */
  constructor(scene, { typeKey, x, groundY, depth, motionOk, onDeath, hpMult = 1, def = null, maxHP = null, isBoss = false, elite = false }) {
    this.scene = scene;
    this.typeKey = typeKey;
    // 보스는 ENEMY_TYPES에 없으므로 cfg.def로 스탯을 주입받는다(잡몹은 룩업 그대로).
    this.def = def || ENEMY_TYPES[typeKey];
    this.isBoss = isBoss;
    // 엘리트 — 별도 클래스 없이 플래그만. 스케일↑/구분 tint/HP↑(hpMult는 director가 이미 곱함).
    this.isElite = elite;
    this.motionOk = motionOk;
    this.onDeath = onDeath;

    // 웨이브 에스컬레이션 — 최대 HP만 배율(데미지/속도는 그대로 둬 체감 난이도 통제).
    // 보스는 깊이 스케일이 이미 반영된 maxHP를 직접 주입받는다(hpMult 미적용).
    this.maxHP = maxHP != null ? maxHP : Math.max(1, Math.round(this.def.maxHP * hpMult));
    this.hp = this.maxHP;
    this.speed = this.def.speed;

    // 행동 패턴(데이터 주도) — def.behavior.type로 테이블 룩업. 없으면 null=현행 직진/피격(비파괴적).
    // 훅(move/onDamage/onDeath)은 seam에서 옵셔널 체이닝으로만 호출 → 미선언 행동은 자동으로 기본 동작.
    this.behavior = ENEMY_BEHAVIORS[this.def.behavior?.type] || null;
    this.guarding = this.def.behavior?.type === 'guard'; // 정면방어 — 상시(restoreTint 우선순위 chain에서 tint)
    this.director = null; // CombatDirector.spawn/spawnBoss가 주입(ctx 배선용)

    this.dead = false; // HP 0 → 사망 연출 진행 중
    this.removed = false; // 연출 끝 → 풀에서 제거 대상
    this._timers = []; // flashHit 등이 만든 delayedCall TimerEvent — teardown 시 일괄 정리
    this.inRange = false; // 주인공 접근 사거리 진입
    this.attackTimer = this.def.attackCooldown; // 첫 접촉 직후 바로 안 때리게 풀쿨로 시작

    this.worldX = x;
    this.groundY = groundY;
    this.shakeX = 0;
    this.shakeY = 0;
    this.bobY = 0;     // 이동 중 상하 bob offset — syncPosition에서 합산

    // 피격 셰이크/플래시 — TimerEvent 없이 update의 상태기반 클럭으로 진행(perf: 타격당 delayedCall 0).
    this.shakeActive = false; // 셰이크 계단 진행 중 → _tickShake가 매 프레임 shakeX 갱신
    this.shakeClock = 0;      // 셰이크 누적 시간(ms)
    this.flashActive = false; // tint 플래시(white→red→restore) 진행 중 → _tickFlash가 처리
    this.flashClock = 0;      // 플래시 누적 시간(ms)
    this._flashRedApplied = false; // 45ms 시점 붉은 tint 1회 적용 가드

    // 감전(전기충격 렌치 메카닉) 상태 — speed/attackCooldown 일시 디버프.
    this.speedMult = 1;       // update 이동에 곱해짐
    this.shockCdMult = 1;     // getAttackCooldown에 곱해짐
    this.shockUntil = 0;      // scene.time.now 기준 만료 타임스탬프(ms)
    this.shocked = false;

    // DoT(화염 burn / 독 toxic) 상태 — applyShock과 동일하게 "상태 필드만" 세팅한다.
    // Phaser 타이머는 만들지 않는다(per-enemy 타이머 금지, perf). 틱/만료는 director가
    // 단일 update 루프에서 scene.time.now와 비교해 처리. destroy 시 객체째 소멸 → 누수 0.
    this.dotType = null;      // null | 'burn' | 'toxic' (한 슬롯 — 새 적용은 refresh/덮어쓰기)
    this.dotDmgPerTick = 0;
    this.dotTickMs = 0;
    this.dotNextTickAt = 0;   // 다음 틱 타임스탬프(ms)
    this.dotExpiresAt = 0;    // 만료 타임스탬프(ms)
    this.dotNoSpread = false; // 독 전파로 걸린 경우 true → 재전파 차단

    // DoT 연출 전용 필드 — setDotTint/clearDot/die/destroy에서 일괄 정리.
    this._dotPulseTween = null;  // repeat:-1 tween 참조 → .stop()으로 누수 없이 제거
    this._dotTintLocked = false; // flashHit 진행 중 true → dot onUpdate가 tint 건드리지 않음
    this._dotTintSteps = null;   // 사전계산 보간색 배열(onUpdate에서 Math 연산 없이 룩업)
    this._dotStepIdx = -1;       // 마지막 적용 색 인덱스 — 동일 인덱스면 setTint 생략. -1=강제 재적용

    // VFX — 사전렌더 소프트 글로우 텍스처 기반(절차 Graphics 폐기).
    // 'fx-glow' 64×64(CombatScene.create 1회 생성) → tint/scale/alpha/ADD 블렌드 조합.
    // 감전(shock)·DoT 스프라이트셋을 독립 운용 → 두 상태 동시 활성 가능.
    this._shockSprites = null;   // { core, halo, sats[], list[], lastFlash, _staticSet }
    this._dotSprites   = null;   // { type, [fog|pool], [bubbles[]|tongues[]], ember?, list[] }
    this._puffSprite   = null;   // DoT 틱 퍼프 전용 스프라이트 (dotSprites 생성 시 함께 할당)
    this._shockAlpha   = 0;      // 감전 글로우 페이드 진행값 (0→1 진입, 1→0 퇴장)
    this._dotPuffUntil = 0;      // (하위호환 유지 — 직접 사용 안 함)
    this._dotPuffColor = 0;      // (하위호환 유지)
    // 30fps 스로틀 기준 타임스탬프 — 스폰 위상 분산으로 동시 다수 스폰 시 첫 틱 몰림 방지.
    this._vfxLastDraw  = scene.time.now + Math.random() * 33;
    this._vfxSeed      = Math.floor(Math.random() * 997); // 적별 독립 난수 시드(명멸/엠버)
    this._shockSatEpoch = -1; // 위성 재배치 기준 에포크

    // 엘리트는 살짝 큰 실루엣 — 스케일·표시높이를 함께 키워 HP바/VFX 앵커가 같이 따라간다.
    const eliteScale = elite ? ELITE.scale : 1;
    const src = scene.textures.get(typeKey).getSourceImage();
    const scale = (this.def.displayHeight / src.height) * eliteScale;
    this.baseScale = scale;
    this.displayHeight = this.def.displayHeight * eliteScale;

    this.container = scene.add.container(x, groundY).setDepth(depth);

    // 접지 그림자
    this.shadow = scene.add.ellipse(0, 4, this.def.displayHeight * 0.4, 9, 0x000000, 0.3);

    // 스프라이트 — origin 하단중앙 → 발끝이 container 원점(groundY)에 안착.
    // 적은 우측에서 좌측으로 진군하므로 좌측 주인공을 바라봐야 한다(←).
    // 원본 스프라이트가 이미 좌향이라 flipX 불필요(뒤집으면 등을 보임).
    this.sprite = scene.add
      .image(0, 0, typeKey)
      .setOrigin(0.5, 1)
      .setScale(scale);

    // 머리 위 작은 HP바 — 엘리트로 커진 displayHeight를 따라가 스프라이트 위에 정확히 안착.
    this.barW = this.displayHeight * 0.46;
    const barY = -this.displayHeight - 6;
    this.hpBg = scene.add
      .rectangle(0, barY, this.barW + 2, 5, 0x000000, 0.65)
      .setOrigin(0.5);
    this.hpFill = scene.add
      .rectangle(-this.barW / 2, barY, this.barW, 3, COMBAT_COLORS.toxic)
      .setOrigin(0, 0.5);

    // 상태 표식 핍 — HP바 우측에 작은 4px 색점(감전 청록·독 녹·화염 주황). tint만으론
    // 작은 화면(360×640)에서 잘 안 읽혀 보완. 상태가 바뀔 때만 _updateStatusPip로 갱신(매 프레임 X).
    // 검은 외곽선으로 밝은 배경에서도 또렷. 항상 렌더(모션 아님) — reduced-motion에도 노출.
    this.statusPip = scene.add
      .rectangle(this.barW / 2 + 5, barY, 4, 4, 0xffffff, 1)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0x000000, 0.6)
      .setVisible(false);

    this.container.add([this.shadow, this.sprite, this.hpBg, this.hpFill, this.statusPip]);

    // 보스는 머리 위 작은 HP바를 숨긴다 — 화면 상단의 큰 보스 HP바(scene)가 대신한다.
    if (isBoss) {
      this.hpBg.setVisible(false);
      this.hpFill.setVisible(false);
      this.statusPip.setVisible(false);
    }

    // 정면방어 적 / 엘리트 — 등장 시점부터 구분 tint를 깔아 즉시 읽히게(상시 상태).
    if (this.guarding || this.isElite) this.restoreTint();

    // ── 스폰 페이드인 ─────────────────────────────────────────────────
    if (motionOk) {
      this.container.setAlpha(0).setScale(0.8);
      scene.tweens.add({
        targets: this.container,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: MOTION.spawnFadeMs,
        ease: 'Back.out'
      });
    }

    // ── 이동 중 bob (정지컷 보완) ────────────────────────────────────
    this.bobTween = null;
    if (motionOk) {
      this.bobTween = scene.tweens.add({
        targets: this,
        bobY: -MOTION.bobAmplitude,
        duration: MOTION.bobPeriodMs / 2,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }

  /** 매 프레임. @param {number} dt 초 단위 델타 @param {number} playerX 주인공 논리 x */
  update(dt, playerX) {
    if (this.dead) return; // 사망 연출 중엔 위치 고정(트윈이 잡음)
    // 감전 만료 체크
    if (this.shocked && this.scene.time.now >= this.shockUntil) this.clearShock();

    // [seam A] 이동 — 행동 패턴이 move 훅을 가지면 직진을 대체(flank 대시 등). 없으면 기본 직진.
    const dist = this.worldX - playerX;
    if (!this.behavior?.move?.(this, dt, playerX, dist)) {
      if (dist > this.def.contactRange) {
        this.worldX -= this.speed * this.speedMult * dt; // 감전 시 speedMult로 감속
        this.inRange = false;
      } else {
        this.inRange = true; // 사거리 진입 → director가 근접 공격 처리
      }
    }
    // 피격 셰이크/플래시 — 상태기반 진행(TimerEvent 0). 매 프레임 cheap한 분기뿐.
    if (this.shakeActive || this.flashActive) {
      const dtMs = dt * 1000;
      if (this.shakeActive) this._tickShake(dtMs);
      if (this.flashActive) this._tickFlash(dtMs);
    }
    // VFX 갱신 — container 자식이라 syncPosition 전후 무관(좌표는 container가 소유)
    // reduced-motion 포함: 정적 글로우도 최초 1회 setAlpha가 필요하므로 motionOk 가드 제거
    if (this._hasAnyVfx()) this._tickVfx(this.scene.time.now);
    this.syncPosition();
  }

  // 셰이크 계단 진행 — 누적 시간으로 shakeOffsets 단계를 직접 인덱싱(프레임 드랍에도 정확).
  // 마지막 단계 통과 시 shakeX=0으로 정착하고 비활성화. delayedCall 루프 대체(perf).
  _tickShake(dtMs) {
    this.shakeClock += dtMs;
    const step = Math.floor(this.shakeClock / MOTION.shakeStepMs);
    if (step >= MOTION.shakeOffsets.length) {
      this.shakeActive = false;
      this.shakeX = 0;
      return;
    }
    this.shakeX = MOTION.shakeOffsets[step];
  }

  // tint 플래시 진행 — white(즉시) → 45ms 붉은 잔상 → 155ms 상태복원. delayedCall 2개 대체.
  _tickFlash(dtMs) {
    this.flashClock += dtMs;
    if (this.flashClock >= 155) {
      this.flashActive = false;
      this._dotTintLocked = false; // 잠금 해제 → dot 맥동 트윈이 다음 프레임 재개
      this.restoreTint();          // 감전·DoT 상태 반영해 복원
    } else if (this.flashClock >= 45 && !this._flashRedApplied) {
      this._flashRedApplied = true;
      this.sprite.setTint(COMBAT_COLORS.hitTint);
    }
  }

  /** 근접 공격 주기(ms) — 감전 중이면 늘어나 더 느리게 때린다. */
  getAttackCooldown() {
    return this.def.attackCooldown * this.shockCdMult;
  }

  // [메카닉] 감전 — 이동/공격 둔화 + 청록 틴트로 시각화. 갱신(refresh) 가능.
  applyShock(slowMult, cdMult, durationMs) {
    if (this.dead) return;
    this.speedMult = slowMult;
    this.shockCdMult = cdMult;
    this.shockUntil = this.scene.time.now + durationMs;
    this.shocked = true;
    this._ensureShockSprites(); // 글로우 스프라이트 준비(reduced-motion도 정적 글로우 제공)
    this.restoreTint();
    this._updateStatusPip();
  }

  clearShock() {
    this.shocked = false;
    this.speedMult = 1;
    this.shockCdMult = 1;
    this.restoreTint();
    this._updateStatusPip();
  }

  // [메카닉] 화염 DoT — 상태 필드만 세팅(타이머 X). 갱신(refresh) 가능.
  applyBurn(dmgPerTick, tickMs, durationMs) {
    this._applyDot('burn', dmgPerTick, tickMs, durationMs, false);
  }

  // [메카닉] 독 DoT — burn과 동형. noSpread=true면 전파로 걸린 것(재전파 차단).
  applyToxic(dmgPerTick, tickMs, durationMs, noSpread = false) {
    this._applyDot('toxic', dmgPerTick, tickMs, durationMs, noSpread);
  }

  _applyDot(type, dmgPerTick, tickMs, durationMs, noSpread) {
    if (this.dead) return;
    const now = this.scene.time.now;
    this.dotType = type;
    this.dotDmgPerTick = dmgPerTick;
    this.dotTickMs = tickMs;
    this.dotNextTickAt = now + tickMs; // 첫 틱은 한 주기 뒤(즉발 0)
    this.dotExpiresAt = now + durationMs;
    this.dotNoSpread = noSpread;
    this._ensureDotSprites(type); // 글로우 스프라이트 준비(reduced-motion도 정적 글로우 제공)
    this.setDotTint();
    this._updateStatusPip();
  }

  clearDot() {
    this.dotType = null;
    this.dotDmgPerTick = 0;
    this._dotPulseTween?.stop(); // 맥동 트윈 정리 — dotType=null 후에 stop해야 onUpdate 가드 불필요
    this._dotPulseTween = null;
    this.restoreTint();
    this._updateStatusPip();
  }

  // [모션 훅] DoT tint 맥동 — 화상: 주황-적(0xff5500), 독: 형광녹(0x33ff77).
  // 헬퍼 { v:0→1 } 보간 tween의 onUpdate에서 sprite.setTint 갱신.
  // delayedCall 0, repeat:-1 tween은 _dotPulseTween에 저장 → clearDot/die/destroy에서 .stop().
  // 우선순위: flashHit(_dotTintLocked) > 감전(shocked) > DoT > clear.
  // reduced-motion: 정적 tint만, 맥동 없음.
  setDotTint() {
    // 이전 맥동 트윈 정리(refresh/덮어쓰기 / applyBurn→applyToxic 전환 대응)
    this._dotPulseTween?.stop();
    this._dotPulseTween = null;

    if (!this.dotType) return;

    const isBurn = this.dotType === 'burn';
    const baseColor = isBurn ? COMBAT_COLORS.burnGlow : COMBAT_COLORS.toxicGlow;
    const duration = isBurn ? MOTION.dotBurnPulseMs : MOTION.dotToxicPulseMs;

    // reduced-motion: 정적 tint — 감전 중이면 감전 우선(shock tint 유지)
    if (!this.motionOk) {
      if (!this.shocked) this.sprite.setTint(baseColor);
      return;
    }

    // [perf] 사전계산 보간색 — 0xffffff(변화없음)→baseColor를 STEPS+1단계로 한 번만 구워둔다.
    // onUpdate는 Math 연산 없이 인덱스 룩업 + (인덱스가 바뀔 때만) setTint → 여러 마리 동시에도 가볍다.
    const STEPS = 8;
    const tr = (baseColor >> 16) & 0xff;
    const tg = (baseColor >> 8) & 0xff;
    const tb = baseColor & 0xff;
    const palette = new Array(STEPS + 1);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const r = Math.round(255 + (tr - 255) * t);
      const g = Math.round(255 + (tg - 255) * t);
      const b = Math.round(255 + (tb - 255) * t);
      palette[i] = (r << 16) | (g << 8) | b;
    }
    this._dotTintSteps = palette;
    this._dotStepIdx = -1; // 새 맥동 — 첫 onUpdate에서 강제 적용

    const helper = { v: 0 };
    this._dotPulseTween = this.scene.tweens.add({
      targets: helper,
      v: 1,
      duration,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        // 사망·피격플래시·감전 구간엔 건너뜀 — 각 상태가 tint를 소유함
        if (this.dead || this._dotTintLocked || this.shocked) return;
        const idx = Math.round(helper.v * STEPS);
        if (idx === this._dotStepIdx) return; // 같은 보간색 — setTint 생략
        this._dotStepIdx = idx;
        this.sprite.setTint(palette[idx]);
      }
    });
  }

  // 상태 표식 핍 갱신 — 상태 변경점(applyShock/clearShock/_applyDot/clearDot/die)에서만 호출.
  // 색 우선순위는 tint와 동일(감전 > 독 > 화염)로 시각 일관. 활성 상태 없으면 숨김.
  _updateStatusPip() {
    if (this.isBoss || !this.statusPip) return;
    let color = null;
    if (this.shocked) color = COMBAT_COLORS.shock;
    else if (this.dotType === 'toxic') color = COMBAT_COLORS.toxicGlow;
    else if (this.dotType === 'burn') color = COMBAT_COLORS.burnGlow;
    if (color == null) {
      this.statusPip.setVisible(false);
      return;
    }
    this.statusPip.setFillStyle(color, 1).setVisible(true);
  }

  // 현재 상태에 맞는 기본 tint 복원 — 우선순위: 감전 > DoT 맥동 > 클리어.
  // flashHit 종료(155ms) / clearShock / clearDot 모두 이 경로를 통한다.
  restoreTint() {
    if (this.dead) return;
    if (this.shocked) {
      // 감전: 청록 tint — DoT 맥동보다 우선
      this.sprite.setTint(COMBAT_COLORS.shock);
    } else if (this.dotType) {
      if (this._dotPulseTween) {
        // motionOk: 맥동 tween이 tint를 담당. 단 플래시/감전 구간엔 색이 멈춰 있었으므로
        // 인덱스를 무효화해 다음 onUpdate가 반드시 현재 보간색을 재적용하게 한다(index-skip 보정).
        this._dotStepIdx = -1;
      } else {
        // reduced-motion: flashHit/clearShock 이후 정적 tint 재적용
        const c = this.dotType === 'burn' ? COMBAT_COLORS.burnGlow : COMBAT_COLORS.toxicGlow;
        this.sprite.setTint(c);
      }
    } else if (this.guarding) {
      // 정면방어: 강철빛 tint — 감전·DoT 다음 우선순위(상태 없을 때 상시 노출).
      this.sprite.setTint(COMBAT_COLORS.guard);
    } else if (this.isElite) {
      // 엘리트: 앰버 골드 tint — guard보다 낮은 우선순위(엘리트 guard면 guard색이 이김). 평상시 노출.
      this.sprite.setTint(COMBAT_COLORS.elite);
    } else {
      this.sprite.clearTint();
    }
  }

  syncPosition() {
    this.container.x = this.worldX + this.shakeX;
    this.container.y = this.groundY + this.shakeY + this.bobY;
  }

  /**
   * 피해를 받음. @returns {boolean} 이 타격으로 사망했는가
   * @param {number} amount
   * @param {{ fromDot?: boolean }} [opts]
   *   fromDot=true → flashHit(셰이크+9 delayedCall) 생략 — DoT 경량 경로.
   */
  takeDamage(amount, { fromDot = false } = {}) {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hpFill.width = this.barW * (this.hp / this.maxHP);
    if (!fromDot) this.flashHit();
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  // [모션 훅] 피격 플래시 — white→red 두 단계 tint (텍스처 스왑/blend 금지).
  // 셰이크: shakeX 계단식 감쇠 오실레이션 + shakeY 짧은 반동.
  //
  // [perf] tint 2단계 + 셰이크 7단계를 모두 delayedCall(타격당 9개)이 아니라
  // update의 상태기반 클럭(_tickFlash/_tickShake)으로 처리한다 → TimerEvent 할당 0.
  // shakeY만 단일 트윈(Phaser 내부 풀 재사용). 빠른 연타 시 클럭이 리셋돼 자연 재플래시.
  flashHit() {
    // tint 플래시 시작 — white 즉시 적용 후 _tickFlash가 45ms 붉은 잔상 → 155ms 복원.
    this._dotTintLocked = true; // DoT 맥동 onUpdate를 일시 잠금 — 피격 플래시가 우선
    this._dotStepIdx = -1;      // 잠금 해제 후 dot 맥동이 색을 강제 재적용하도록
    this.flashActive = true;
    this.flashClock = 0;
    this._flashRedApplied = false;
    this.sprite.setTint(0xffffff);

    if (!this.motionOk) return;

    // 계단식 감쇠 오실레이션 shakeX — _tickShake가 누적 시간으로 단계를 밟는다.
    this.shakeActive = true;
    this.shakeClock = 0;
    this.shakeX = MOTION.shakeOffsets[0];

    // shakeY 위로 살짝 튕겼다 복귀 (단일 트윈)
    this.shakeY = -MOTION.shakeYAmplitude;
    this.scene.tweens.add({
      targets: this,
      shakeY: 0,
      duration: MOTION.shakeStepMs * MOTION.shakeOffsets.length,
      ease: 'Quad.out'
    });
  }

  // [모션 훅] 근접 공격 모션 — 주인공 쪽으로 짧게 잽. inRange 상태라 update가 worldX를
  //           건드리지 않으므로 트윈해도 안전.
  lungeAttack() {
    if (!this.motionOk || this.dead) return;
    const base = this.worldX;
    this.scene.tweens.add({
      targets: this,
      worldX: base - 12,
      duration: 110,
      yoyo: true,
      ease: 'Quad.out'
    });
  }

  // [모션 훅] 사망 — 포물선 넉백(위로 떴다 추락) + 회전 + 페이드.
  // reduced-motion 시 즉시 제거.
  die() {
    if (this.dead) return;
    this.dead = true;
    this._clearTimers(); // 대기 중인 flashHit 타이머 정리(이미 dead 가드라 무해하지만 유령 제거)
    this._dotPulseTween?.stop(); // DoT 맥동 트윈 정리 — helper가 별도 객체라 killTweensOf(this) 불충분
    this._dotPulseTween = null;
    this._destroyAllVfx();        // 감전·DoT 글로우 스프라이트 즉시 회수
    this.hpBg.setVisible(false);
    this.hpFill.setVisible(false);
    this.statusPip.setVisible(false);
    this.sprite.clearTint();
    this.bobTween?.stop();  // bob 정지 (container.y는 이후 트윈이 소유)
    this.onDeath?.(this);

    if (!this.motionOk) {
      this.removed = true;
      this.container.destroy();
      return;
    }

    // 사망 시점의 실제 컨테이너 좌표 고정 (shakeX/bobY 누적값 포함)
    const cx = this.container.x;
    const cy = this.container.y;

    // 가로 넉백 + 회전 — 단일 트윈으로 전체 duration 커버
    this.scene.tweens.add({
      targets: this.container,
      x: cx + MOTION.deathRightX,
      angle: MOTION.deathAngle,
      duration: MOTION.deathUpMs + MOTION.deathDownMs,
      ease: 'Quad.out'
    });

    // 세로 포물선: 1단계(떠오름) → 2단계(추락+페이드)
    this.scene.tweens.add({
      targets: this.container,
      y: cy - MOTION.deathUpY,
      duration: MOTION.deathUpMs,
      ease: 'Quad.out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.container,
          y: cy + MOTION.deathDownY,
          alpha: 0,
          duration: MOTION.deathDownMs,
          ease: 'Quad.in',
          onComplete: () => {
            this.removed = true;
            this.container.destroy();
          }
        });
      }
    });
  }

  // 대기 중인 delayedCall TimerEvent를 TimeManager에서 제거(remove(false): 콜백 미실행).
  // 완료된 타이머 remove는 무해. die()와 destroy() 양쪽에서 호출해 유령 타이머 0 보장.
  _clearTimers() {
    for (const t of this._timers) t.remove(false);
    this._timers.length = 0;
  }

  destroy() {
    // dead=true로 둬서 비동기 delayedCall(flashHit/restoreTint)이 파괴된 sprite를 건드리지 않게.
    this.dead = true;
    this._clearTimers();
    this._dotPulseTween?.stop(); // DoT 맥동 트윈 — helper 기반이라 killTweensOf(this) 불충분
    this._dotPulseTween = null;
    this._destroyAllVfx();        // VFX 글로우 스프라이트 회수 — container.destroy() 전에 명시 정리
    this.bobTween?.stop();
    this.scene.tweens.killTweensOf(this);
    if (this.container && !this.removed) {
      this.scene.tweens.killTweensOf(this.container);
      this.removed = true;
      this.container.destroy();
    }
  }

  // ── VFX 내부 유틸 ─────────────────────────────────────────────────────────
  // 사전렌더 소프트 글로우 텍스처('fx-glow') 기반 스프라이트 세트.
  // 감전/DoT 독립 운용 → 동시 활성 가능. per-enemy TimerEvent 0, 매 프레임 Graphics redraw 0.
  // ADD 블렌드 + tint + scale 조합으로 3종 효과 — 텍스처 1벌 공유.

  /** 활성 VFX 스프라이트 있으면 true — update에서 _tickVfx 호출 여부 판단. */
  _hasAnyVfx() {
    return this._shockSprites !== null || this._dotSprites !== null;
  }

  /** 감전 글로우 스프라이트셋 생성 (이미 있으면 재사용). reduced-motion도 정적 글로우 제공. */
  _ensureShockSprites() {
    if (this._shockSprites) return;
    if (!this.scene.textures.exists(GFX_GLOW_KEY)) return;
    const h    = this.displayHeight;
    const list = [];
    const make = (x, y, tint, sx, sy, a) => {
      const s = this.scene.add.image(x, y, GFX_GLOW_KEY)
        .setOrigin(0.5).setTint(tint).setScale(sx, sy)
        .setAlpha(a).setBlendMode(Phaser.BlendModes.ADD);
      this.container.add(s);
      list.push(s);
      return s;
    };
    // 헤일로: 몸폭(h*0.15)+24px, 최대 50px (몸엣지+24px 하드캡)
    const haloR = Math.min(h * 0.15 + 24, 50);
    const core  = make(0, -h * 0.5, 0xFFFFFF, 0.5,         0.5,         0);
    const halo  = make(0, -h * 0.5, 0x00FFEE, haloR / 32,  haloR / 32,  0);
    // 위성 스파크 — 보라/인디고(0x6644FF). 청록 헤일로와 색상환에서 분리돼 작은 화면서 또렷,
    // 감전+화염 동시 ADD에도 하얗게 안 뜸(designer 게이트).
    const sats  = [
      make(0, -h * 0.5, 0x6644FF, 0.27, 0.27, 0),
      make(0, -h * 0.5, 0x6644FF, 0.27, 0.27, 0),
      make(0, -h * 0.5, 0x6644FF, 0.27, 0.27, 0),
    ];
    this.container.bringToTop(this.hpBg);
    this.container.bringToTop(this.hpFill);
    this.container.bringToTop(this.statusPip);
    this._shockSprites  = { core, halo, sats, list, lastFlash: false, _staticSet: false };
    this._shockAlpha    = 0;
    this._shockSatEpoch = -1;
  }

  /** 감전 글로우 스프라이트셋 즉시 회수. */
  _destroyShockSprites() {
    if (!this._shockSprites) return;
    for (const s of this._shockSprites.list) { if (s?.active) s.destroy(); }
    this._shockSprites = null;
    this._shockAlpha   = 0;
  }

  /** DoT(독/화염) 글로우 스프라이트셋 생성. 타입 변경 시 기존 파괴 후 재생성. */
  _ensureDotSprites(type) {
    if (this._dotSprites?.type === type) return;
    this._destroyDotSprites();
    if (!this.scene.textures.exists(GFX_GLOW_KEY)) return;
    const h    = this.displayHeight;
    const list = [];
    const make = (x, y, tint, sx, sy, a) => {
      const s = this.scene.add.image(x, y, GFX_GLOW_KEY)
        .setOrigin(0.5).setTint(tint).setScale(sx, sy)
        .setAlpha(a).setBlendMode(Phaser.BlendModes.ADD);
      this.container.add(s);
      list.push(s);
      return s;
    };
    let sprites;
    if (type === 'toxic') {
      sprites = {
        type,
        fog:     make(0, -10,       0x33FF55, 1.1,  0.35, 0.18),
        bubbles: [
          make(-5, -h * 0.3, 0xAAFF00, 0.1, 0.1, 0),
          make( 5, -h * 0.3, 0xAAFF00, 0.1, 0.1, 0),
        ]
      };
    } else { // burn
      sprites = {
        type,
        pool:    make(0,  -10,       0xFF5500, 1.1,  0.45, 0.5),
        tongues: [
          make(-9, -h * 0.25, 0xFFAA00, 0.14, 0.35, 0),
          make( 0, -h * 0.25, 0xFFAA00, 0.14, 0.40, 0),
          make( 9, -h * 0.25, 0xFFAA00, 0.14, 0.35, 0),
        ],
        ember: make(0, -h * 0.5, 0xFFEE88, 0.07, 0.07, 0),
      };
    }
    const puff   = make(0, -h * 0.5, 0xFFFFFF, 0.22, 0.22, 0);
    this._puffSprite = puff;
    this.container.bringToTop(this.hpBg);
    this.container.bringToTop(this.hpFill);
    this.container.bringToTop(this.statusPip);
    this._dotSprites = { ...sprites, list };
  }

  /** DoT 글로우 스프라이트셋 즉시 회수. */
  _destroyDotSprites() {
    if (!this._dotSprites) return;
    if (this._puffSprite?.active) this.scene?.tweens?.killTweensOf(this._puffSprite);
    for (const s of this._dotSprites.list) { if (s?.active) s.destroy(); }
    this._dotSprites   = null;
    this._puffSprite   = null;
    this._dotPuffUntil = 0;
  }

  /** 감전+DoT 스프라이트 양쪽 일괄 회수 — die/destroy 전용. */
  _destroyAllVfx() {
    this._destroyShockSprites();
    this._destroyDotSprites();
  }

  // DoT 틱 퍼프 발화 — CombatScene.applyDotTick 시점에 호출. 200ms 스케일업+페이드 글로우 팝.
  // _puffSprite는 _ensureDotSprites 시점에 사전 할당 — 매 틱 create/destroy 없이 위치/alpha만 갱신.
  spawnDotPuff() {
    if (this.dead || !this.motionOk) return;
    if (!this._puffSprite?.active) return;
    const color = this.dotType === 'burn' ? 0xFF6600 : 0x44FF88;
    const h = this.displayHeight;
    this._puffSprite
      .setTint(color)
      .setPosition(0, -h * 0.5)
      .setScale(0.2, 0.2)
      .setAlpha(0.85);
    this.scene.tweens.killTweensOf(this._puffSprite);
    this.scene.tweens.add({
      targets: this._puffSprite,
      scaleX: 0.65,
      scaleY: 0.65,
      alpha: 0,
      duration: 200,
      ease: 'Quad.out'
    });
  }

  // VFX 갱신 — 30fps 스로틀(~33ms 간격). 스프라이트 alpha/위치 갱신만(Graphics redraw 0).
  // per-enemy TimerEvent 0 — scene.time.now 기반 의사난수 진행.
  _tickVfx(now) {
    if (!this._hasAnyVfx()) return;
    if (now - this._vfxLastDraw < 33) return; // 30fps 스로틀
    this._vfxLastDraw = now;

    // ── 감전 VFX ──────────────────────────────────────────────────────────
    if (this._shockSprites) {
      if (this.shocked) {
        this._shockAlpha = Math.min(1, this._shockAlpha + 0.4);
        this._tickShockVfx(now);
      } else {
        // 페이드아웃 → 0 도달 시 스프라이트 자동 회수
        this._shockAlpha = Math.max(0, this._shockAlpha - 0.25);
        const sp = this._shockSprites;
        sp.core.setAlpha(this._shockAlpha * 0.9);
        sp.halo.setAlpha(this._shockAlpha * 0.5);
        for (const s of sp.sats) s.setAlpha(this._shockAlpha * 0.7);
        if (this._shockAlpha <= 0) this._destroyShockSprites();
      }
    }

    // ── DoT VFX ───────────────────────────────────────────────────────────
    if (this._dotSprites) {
      if (!this.dotType) {
        this._destroyDotSprites(); // clearDot 후 지연 회수
      } else if (this.dotType === 'toxic') {
        this._tickToxicVfx(now);
      } else if (this.dotType === 'burn') {
        this._tickBurnVfx(now);
      }
    }
  }

  // 감전 명멸 — 40ms 에포크 단위 의사난수(~28% ON) → 죽어가는 형광등 리듬.
  // ON 전환 시 위성 위치 재배치(매 플래시마다 랜덤). reduced-motion: 정적 은은한 글로우.
  _tickShockVfx(now) {
    const sp = this._shockSprites;
    if (!sp) return;
    const h  = this.displayHeight;

    // prefers-reduced-motion: 정적 글로우(최초 1회 세팅)
    if (!this.motionOk) {
      if (!sp._staticSet) {
        sp.core.setAlpha(0.35);
        sp.halo.setAlpha(0.12);
        for (const s of sp.sats) s.setAlpha(0);
        sp._staticSet = true;
      }
      return;
    }

    // 불규칙 명멸: 40ms 에포크, hash>0.72 → ON(~28% 확률), 적별 _vfxSeed로 독립 위상
    const epochN  = Math.floor(now / 40);
    const flashOn = _shockHash(epochN * 7 + 13 + this._vfxSeed) > 0.72;
    const a       = this._shockAlpha;

    // ON 전환 시(이전 OFF→이번 ON): 위성 위치 즉각 랜덤 재배치
    if (flashOn && !sp.lastFlash) {
      const satEpochN = Math.floor(now / 120); // 120ms 단위(너무 빠른 춤 방지)
      if (satEpochN !== this._shockSatEpoch) {
        this._shockSatEpoch = satEpochN;
        const rx = h * 0.18;  // 몸폭 추정 반경
        const ry = h * 0.44;  // 세로 분산 범위
        for (let i = 0; i < sp.sats.length; i++) {
          const ang = _shockHash(satEpochN * 31 + i * 7 + this._vfxSeed) * Math.PI * 2;
          sp.sats[i].setPosition(
            Math.cos(ang) * rx,
            -h * 0.5 + Math.sin(ang) * ry
          );
        }
      }
    }
    sp.lastFlash = flashOn;

    // 즉각 컷(사이 완전 꺼짐 — 죽어가는 형광등)
    sp.core.setAlpha(flashOn ? a * 0.95 : 0);
    sp.halo.setAlpha(flashOn ? a * 0.45 : 0);
    for (const s of sp.sats) s.setAlpha(flashOn ? a * 0.70 : 0);
  }

  // 독 VFX: 발밑 안개(2.5s 사인 호흡) + 기포 2개 상승-팝. prefers-reduced-motion: 안개 정적.
  _tickToxicVfx(now) {
    const sp = this._dotSprites;
    if (!sp) return;
    const h = this.displayHeight;

    if (!this.motionOk) {
      sp.fog.setAlpha(0.18);
      for (const b of sp.bubbles) b.setAlpha(0);
      return;
    }

    // 안개 호흡: alpha 0.12↔0.28, 주기 2.5s
    const fogAlpha = 0.12 + (Math.sin((now / 2500) * Math.PI * 2) + 1) * 0.5 * 0.16;
    sp.fog.setAlpha(fogAlpha);

    // 기포 상승 → 가슴 이상 금지(maxRise ≤ 35px)
    const maxRise = Math.min(h * 0.55, 35);
    for (let i = 0; i < sp.bubbles.length; i++) {
      const bub   = sp.bubbles[i];
      const phase = ((now / 1800 + i * 0.5) % 1.0);
      if (phase > 0.85) {
        bub.setAlpha(Math.max(0, (1 - phase) / 0.15 * 0.35));
      } else {
        const py = -10 - phase * maxRise;
        const px = (i === 0 ? -3 : 3) + Math.sin(now / 300 + i * 1.5) * 3;
        const sc = 0.07 + Math.sin(phase * Math.PI) * 0.05;
        bub.setPosition(px, py).setScale(sc, sc).setAlpha(Math.sin(phase * Math.PI) * 0.55);
      }
    }
  }

  // 화염 VFX: 발밑 풀 맥동 + 혀 3개 상승(120° 오프셋) + 엠버 간헐 점멸.
  // prefers-reduced-motion: 풀 글로우만 정적.
  _tickBurnVfx(now) {
    const sp = this._dotSprites;
    if (!sp) return;
    const h = this.displayHeight;

    if (!this.motionOk) {
      sp.pool.setScale(1.1, 0.45).setAlpha(0.45);
      for (const t of sp.tongues) t.setAlpha(0);
      sp.ember.setAlpha(0);
      return;
    }

    // 풀 글로우 맥동: scaleX 1.0↔1.15, ~200ms
    const poolPhase = Math.sin((now / 200) * Math.PI * 2);
    sp.pool
      .setScale(1.1 * (1.0 + poolPhase * 0.075), 0.45 * (1.0 + poolPhase * 0.04))
      .setAlpha(0.5 + poolPhase * 0.15);

    // 불꽃 혀: 3개, 120° 위상 오프셋, 0.28~0.34s 주기 상승-리셋
    const maxRise = h * 0.55; // 몸 높이 60% 이하 하드캡
    for (let i = 0; i < sp.tongues.length; i++) {
      const period = 280 + i * 30;
      const phase  = ((now + i * (period / 3)) % period) / period;
      const ta     = Math.sin(phase * Math.PI);
      sp.tongues[i]
        .setPosition((i - 1) * 9, -16 - phase * maxRise)
        .setScale(0.13, 0.28 + ta * 0.15)
        .setAlpha(ta * 0.65)
        .setTint(phase > 0.65 ? 0xFF2200 : 0xFFAA00);
    }

    // 엠버 간헐 점멸 — 150ms 에포크, ~45% 확률 ON
    const ee  = Math.floor(now / 150);
    const eOn = _shockHash(ee * 11 + 3 + this._vfxSeed) > 0.55;
    if (eOn) {
      sp.ember
        .setPosition(
          (_shockHash(ee * 7 + this._vfxSeed) - 0.5) * 18,
          -h * (0.3 + _shockHash(ee * 5 + this._vfxSeed) * 0.35)
        )
        .setScale(0.06, 0.06)
        .setAlpha(0.75);
    } else {
      sp.ember.setAlpha(0);
    }
  }
}
