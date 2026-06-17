import Phaser from 'phaser';
import { PICKUPS } from '../constants/pickups.js';
import { MATERIAL_META, GRADE_COLOR } from '../constants/materials.js';
import { PIXEL_FONT } from '../constants/fonts.js';

// 땅에 떨어진 재료 1덩이 = 아이콘(+수량 라벨)을 묶은 Container. 탭해야 획득.
// 좌표 모델: container.x를 매 프레임 좌측 드리프트(배경 L4 80px/sec 동기)로 줄여
//   "세계에 얹힌" 물건처럼 같이 흘러간다. 화면 이탈/수명 만료 시 소멸(획득 실패).
//
// 수명: bornAt 기준 누적 age로 phase 판정(alive→warn→expire). 경고 깜빡임은 cosmetic
//   트윈, 실제 소멸(despawn)은 CombatScene.update가 isExpired()로 단일 판정 → race 없음.
//
// [모션 훅] _playSpawnPop / _startIdleBob / _collect(펀치) / _enterWarn
export default class PickupItem {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} cfg { matKey, count, x, y, windowMs, motionOk, depth, spawnDelay, onTap }
   *   spawnDelay(ms) — 다수 동시 스폰 시 스태거 cosmetic 딜레이. 수명 카운트엔 영향 없음.
   *   onTap(matKey, count) — 탭 성공 콜백(자기 소멸 전에 1회).
   */
  constructor(scene, { matKey, count, x, y, windowMs = PICKUPS.windowMs, motionOk, depth = 64, spawnDelay = 0, onTap }) {
    this.scene = scene;
    this.matKey = matKey;
    this.count = count;
    this.motionOk = motionOk;
    this.onTap = onTap;
    this.windowMs = windowMs;

    this.removed = false;   // destroy 1회 보장
    this.taken = false;     // 탭 성공 후 중복 입력 차단
    this.age = 0;           // 누적 수명 ms(update에서 delta 합산)
    this._warned = false;   // 경고 phase 진입 1회
    this._tweens = [];      // cosmetic 트윈 — destroy에서 일괄 정리(누수 0)
    this._spawnDelay = spawnDelay; // 스태거 딜레이 ms

    this.container = scene.add.container(x, y).setDepth(depth);

    // 아이콘 — 텍스처 있으면 이미지, 없으면 등급색 칩 폴백(popMaterial과 동일 톤).
    const meta = MATERIAL_META[matKey];
    if (meta && scene.textures.exists(meta.iconKey)) {
      const src = scene.textures.get(meta.iconKey).getSourceImage();
      this.icon = scene.add.image(0, 0, meta.iconKey).setScale(PICKUPS.iconSize / src.height);
      this._iconIsImage = true;
    } else {
      this.icon = scene.add
        .rectangle(0, 0, PICKUPS.iconSize * 0.6, PICKUPS.iconSize * 0.6, GRADE_COLOR[meta?.grade] || 0x8a6a3a)
        .setStrokeStyle(1, 0x000000, 0.5);
      this._iconIsImage = false;
    }
    this._baseScale = this.icon.scaleX || 1;
    this.container.add(this.icon);

    // 수량 라벨 — 2개 이상일 때만(클러터 억제). 경고 시 아이콘과 함께 깜빡임.
    if (count > 1) {
      this.label = scene.add
        .text(PICKUPS.iconSize * 0.45, -PICKUPS.iconSize * 0.4, `×${count}`, {
          fontFamily: PIXEL_FONT,
          fontSize: '8px',
          color: '#f4ead2'
        })
        .setOrigin(0, 0.5);
      this.label.setShadow(1, 1, '#000000', 0, false, true);
      this.container.add(this.label);
    }

    // 탭 — 원형 히트(손가락 친화 반경). 컨테이너 로컬 (0,0) 중심.
    this.container
      .setInteractive(new Phaser.Geom.Circle(0, 0, PICKUPS.tapRadius), Phaser.Geom.Circle.Contains)
      .on('pointerdown', (pointer, lx, ly, event) => {
        // 배경 스와이프 제스처와 분리 — 이 탭은 줍기로 소비.
        event?.stopPropagation();
        this._collect();
      });

    this._playSpawnPop();
  }

  // [모션] 스폰 3단계: 낙하(Quad.in 중력감) → 착지 스쿼시 → 탄성 복귀(Back.out) + idle bob.
  // container.x는 안 건드림(드리프트 전용). spawnDelay로 다수 픽업 스태거.
  // reduced-motion: 즉시 최종 상태(y=0, scale=1) → idle bob 없음.
  _playSpawnPop() {
    if (!this.motionOk) return;
    const s = this._baseScale;
    // 시작: 작은 스케일로 위에서 대기
    this.icon.setScale(s * 0.4).setY(-PICKUPS.popUpY);

    // 1단계: 낙하 — Quad.in으로 중력 가속감. 착지 순간 스쿼시 스케일로 수렴.
    const fall = this.scene.tweens.add({
      targets: this.icon,
      y: 0,
      scaleX: s * PICKUPS.spawnSquashX,
      scaleY: s * PICKUPS.spawnSquashY,
      delay: this._spawnDelay,
      duration: PICKUPS.spawnFallMs,
      ease: 'Quad.in',
      onComplete: () => {
        if (this.removed) return;
        // 2단계: 탄성 복귀 — Back.out 살짝 과슈트로 "퉁" 안착감
        const settle = this.scene.tweens.add({
          targets: this.icon,
          scaleX: s,
          scaleY: s,
          duration: PICKUPS.spawnSettleMs,
          ease: 'Back.out',
          onComplete: () => {
            if (!this.removed) this._startIdleBob();
          }
        });
        this._tweens.push(settle);
      }
    });
    this._tweens.push(fall);
  }

  // [모션] 안착 후 유휴 어포던스 — 은은한 y bob으로 "주울 수 있다" 신호.
  // icon.y만 건드림(container.x=드리프트, alpha=경고용). _tweens에 push → destroy에서 정리.
  _startIdleBob() {
    if (!this.motionOk || this.removed) return;
    const bob = this.scene.tweens.add({
      targets: this.icon,
      y: -PICKUPS.idleBobY,
      duration: PICKUPS.idleBobMs,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
    this._tweens.push(bob);
  }

  // CombatScene.update에서 매 프레임 호출 — 좌측 드리프트 + 수명 진행 + 경고 진입.
  // @returns {boolean} true면 소멸 대상(이탈/만료) → 씬이 destroy 후 배열에서 제거.
  update(delta) {
    if (this.removed) return true;
    // 좌측 드리프트(배경 L4 동기). delta는 ms.
    this.container.x -= PICKUPS.driftSpeed * (delta / 1000);
    if (this.container.x < PICKUPS.despawnX) return true; // 화면 이탈(손실)

    this.age += delta;
    if (this.age >= this.windowMs) return true; // 수명 만료(손실)
    if (!this._warned && this.age >= this.windowMs - PICKUPS.warnAtMs) this._enterWarn();
    return false;
  }

  // [모션] 만료 경고 — 2단계 가속 깜빡임으로 "사라지기 직전 다급함" 연출.
  // Phase 1(보통): warnSlowBlinks × warnSlowPeriod = 600ms
  // Phase 2(빠른): warnFastBlinks × warnFastPeriod = 540ms
  // 최종 페이드: warnFadeMs = 60ms  →  합계 1200ms = warnAtMs 정합.
  // 실제 소멸(despawn)은 update()가 단일 판정 — 여기선 cosmetic만.
  // reduced-motion: 정적 빨간 강조(깜빡임 없음).
  _enterWarn() {
    this._warned = true;
    const targets = this.label ? [this.icon, this.label] : [this.icon];

    if (this._iconIsImage) this.icon.setTint(0xff4040);
    else this.icon.setFillStyle(0xff4040);

    if (!this.motionOk) return; // 정적 경고

    // 1단계: 보통 속도 깜빡임
    const phase1 = this.scene.tweens.add({
      targets,
      alpha: 0.2,
      duration: PICKUPS.warnSlowPeriod / 2,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: PICKUPS.warnSlowBlinks - 1,
      onComplete: () => {
        if (this.removed) return;
        // 2단계: 빠른 깜빡임 — 다급함 점증
        const phase2 = this.scene.tweens.add({
          targets,
          alpha: 0.1,
          duration: PICKUPS.warnFastPeriod / 2,
          ease: 'Sine.inOut',
          yoyo: true,
          repeat: PICKUPS.warnFastBlinks - 1,
          onComplete: () => {
            if (this.removed) return;
            const fade = this.scene.tweens.add({
              targets,
              alpha: 0,
              duration: PICKUPS.warnFadeMs,
              ease: 'Quad.in'
            });
            this._tweens.push(fade);
          }
        });
        this._tweens.push(phase2);
      }
    });
    this._tweens.push(phase1);
  }

  // 탭 성공 — 게임 로직 즉시 실행 후 scale 펀치 연출 → destroy.
  // 기존 spawn/bob/warn 트윈을 먼저 정리해 scale 충돌 방지.
  // 93ms 지연 destroy 동안 update()는 계속 drift를 처리하나 7px 이내라 무시 가능.
  _collect() {
    if (this.taken || this.removed) return;
    this.taken = true;
    this.onTap?.(this.matKey, this.count); // 게임 로직 즉시 실행

    if (!this.motionOk) {
      this.destroy();
      return;
    }

    // 기존 spawn/bob/warn 트윈 중단 → 깔끔한 상태에서 punch 시작
    for (const t of this._tweens) t?.stop();
    this._tweens.length = 0;
    this.scene.tweens.killTweensOf(this.icon);
    if (this.label) this.scene.tweens.killTweensOf(this.label);

    // 라벨은 punch 전 구간에 걸쳐 페이드
    if (this.label) {
      this._tweens.push(
        this.scene.tweens.add({
          targets: this.label,
          alpha: 0,
          duration: PICKUPS.collectPunchOutMs + PICKUPS.collectPunchInMs,
          ease: 'Quad.in'
        })
      );
    }

    const s = this._baseScale;
    // 팽창 → 수축+페이드 → destroy 체인 (총 93ms)
    const punchOut = this.scene.tweens.add({
      targets: this.icon,
      scaleX: s * PICKUPS.collectPunchScale,
      scaleY: s * PICKUPS.collectPunchScale,
      duration: PICKUPS.collectPunchOutMs, // 28ms
      ease: 'Quad.out',
      onComplete: () => {
        if (this.removed) return;
        const punchIn = this.scene.tweens.add({
          targets: this.icon,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: PICKUPS.collectPunchInMs, // 65ms
          ease: 'Quad.in',
          onComplete: () => this.destroy()
        });
        this._tweens.push(punchIn);
      }
    });
    this._tweens.push(punchOut);
  }

  // 정리 — 트윈 일괄 정리 + 컨테이너 파괴(자식 아이콘/라벨 함께). 누수 0, 멱등.
  destroy() {
    if (this.removed) return;
    this.removed = true;
    for (const t of this._tweens) t?.stop();
    this._tweens.length = 0;
    this.scene.tweens.killTweensOf(this.icon);
    if (this.label) this.scene.tweens.killTweensOf(this.label);
    this.container.destroy(); // removeInteractive 포함 — 입력 리스너까지 정리
  }
}
