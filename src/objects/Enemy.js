import { ENEMY_TYPES, COMBAT_COLORS, MOTION } from '../constants/combat.js';

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
  constructor(scene, { typeKey, x, groundY, depth, motionOk, onDeath, hpMult = 1 }) {
    this.scene = scene;
    this.typeKey = typeKey;
    this.def = ENEMY_TYPES[typeKey];
    this.motionOk = motionOk;
    this.onDeath = onDeath;

    // 웨이브 에스컬레이션 — 최대 HP만 배율(데미지/속도는 그대로 둬 체감 난이도 통제).
    this.maxHP = Math.max(1, Math.round(this.def.maxHP * hpMult));
    this.hp = this.maxHP;
    this.speed = this.def.speed;

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

    const src = scene.textures.get(typeKey).getSourceImage();
    const scale = this.def.displayHeight / src.height;
    this.baseScale = scale;
    this.displayHeight = this.def.displayHeight;

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

    // 머리 위 작은 HP바
    this.barW = this.def.displayHeight * 0.46;
    const barY = -this.def.displayHeight - 6;
    this.hpBg = scene.add
      .rectangle(0, barY, this.barW + 2, 5, 0x000000, 0.65)
      .setOrigin(0.5);
    this.hpFill = scene.add
      .rectangle(-this.barW / 2, barY, this.barW, 3, COMBAT_COLORS.toxic)
      .setOrigin(0, 0.5);

    this.container.add([this.shadow, this.sprite, this.hpBg, this.hpFill]);

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

    const dist = this.worldX - playerX;
    if (dist > this.def.contactRange) {
      this.worldX -= this.speed * this.speedMult * dt; // 감전 시 speedMult로 감속
      this.inRange = false;
    } else {
      this.inRange = true; // 사거리 진입 → director가 근접 공격 처리
    }
    this.syncPosition();
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
    this.restoreTint();
  }

  clearShock() {
    this.shocked = false;
    this.speedMult = 1;
    this.shockCdMult = 1;
    this.restoreTint();
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
    this.setDotTint();
  }

  clearDot() {
    this.dotType = null;
    this.dotDmgPerTick = 0;
    this._dotPulseTween?.stop(); // 맥동 트윈 정리 — dotType=null 후에 stop해야 onUpdate 가드 불필요
    this._dotPulseTween = null;
    this.restoreTint();
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

    // RGB 채널 분해 — onUpdate에서 매 프레임 재계산 안 하려고 미리 뽑아둠
    const tr = (baseColor >> 16) & 0xff;
    const tg = (baseColor >> 8) & 0xff;
    const tb = baseColor & 0xff;

    // 헬퍼 0→1 보간 tween (setTint는 정수 4개 세팅 수준 — 매 프레임 호출해도 cheap)
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
        const t = helper.v;
        // 0xffffff(변화없음) → baseColor 선형 보간
        const r = Math.round(255 + (tr - 255) * t);
        const g = Math.round(255 + (tg - 255) * t);
        const b = Math.round(255 + (tb - 255) * t);
        this.sprite.setTint((r << 16) | (g << 8) | b);
      }
    });
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
        // motionOk: 맥동 tween이 매 프레임 tint를 담당 → 별도 조치 불필요
      } else {
        // reduced-motion: flashHit/clearShock 이후 정적 tint 재적용
        const c = this.dotType === 'burn' ? COMBAT_COLORS.burnGlow : COMBAT_COLORS.toxicGlow;
        this.sprite.setTint(c);
      }
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
  flashHit() {
    // 임팩트 순간 흰색 플래시, 이후 붉은 잔상, 마지막 클리어
    // (모든 delayedCall 반환값을 _timers에 저장 → destroy/die에서 유령 타이머 정리)
    this._dotTintLocked = true; // DoT 맥동 onUpdate를 일시 잠금 — 피격 플래시가 우선
    this.sprite.setTint(0xffffff);
    this._timers.push(
      this.scene.time.delayedCall(45, () => {
        if (!this.dead) this.sprite.setTint(COMBAT_COLORS.hitTint);
      })
    );
    this._timers.push(
      this.scene.time.delayedCall(155, () => {
        this._dotTintLocked = false; // 잠금 해제 → dot 맥동 트윈이 다음 프레임에 재개
        if (!this.dead) this.restoreTint(); // 감전·DoT 상태 반영해 복원
      })
    );

    if (!this.motionOk) return;

    // 계단식 감쇠 오실레이션 shakeX — 각 step마다 즉시 적용해 레트로 계단 감성
    MOTION.shakeOffsets.forEach((offset, i) => {
      this._timers.push(
        this.scene.time.delayedCall(i * MOTION.shakeStepMs, () => {
          if (!this.dead) {
            this.shakeX = offset;
            this.syncPosition();
          }
        })
      );
    });

    // shakeY 위로 살짝 튕겼다 복귀
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
    this.hpBg.setVisible(false);
    this.hpFill.setVisible(false);
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
    this.bobTween?.stop();
    this.scene.tweens.killTweensOf(this);
    if (this.container && !this.removed) {
      this.scene.tweens.killTweensOf(this.container);
      this.removed = true;
      this.container.destroy();
    }
  }
}
