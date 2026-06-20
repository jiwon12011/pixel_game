// 적 행동 패턴 테이블 — 데이터 주도 적 AI. 각 행동은 자기가 구현하는 훅만 선언한다.
//   · move(enemy, dt, playerX, dist)     → 이동(seam A). truthy 반환 시 기본 직진을 대체.
//   · onDamage(enemy, amount, ctx)       → 피격 데미지 가공(seam C). 가공된 amount 반환.
//   · onContact(enemy, ctx)              → 근접 타격 성립 시(seam B). 부작용은 ctx 콜백으로만.
//   · onDeath(enemy, ctx)                → 사망 트리거(seam D). 부작용은 ctx 콜백으로만.
// 파라미터는 enemy.def.behavior에서 읽는다(combat.js ENEMY_TYPES). scene/Phaser 직접참조 없음 —
// 부작용(데미지/VFX)은 전부 ctx로 주입받아 Enemy/behaviors가 순수 데이터 계층으로 남는다.
//
// [perf] 새 TimerEvent 0. guard 토글 등 주기 상태는 호출 시점 계산만(여기선 guard 상시).

import { COMBAT_COLORS } from './combat.js';

export const ENEMY_BEHAVIORS = {
  // 정면방어 — 관통이 아닌 피해를 reduce배로 경감. 상시 방어(guard tint로 시각화, 새 타이머 0).
  guard: {
    onDamage(enemy, amount, ctx) {
      if (ctx.isPierce) return amount; // 관통타는 방어를 무시(파고듦)
      return amount * (enemy.def.behavior.reduce ?? 1);
    }
  },

  // 사망폭발 — 죽는 순간 플레이어가 blastR 안이면 1회 피해. 링 VFX + 스파크(ctx 경유, motionOk는 ctx가 게이트).
  explode: {
    onDeath(enemy, ctx) {
      const b = enemy.def.behavior;
      if (Math.abs(enemy.worldX - ctx.playerX) < b.blastR) ctx.takePlayerDamage(b.blastDmg);
      ctx.spawnRing(
        enemy.container.x,
        enemy.container.y - (enemy.displayHeight ?? 28) * 0.5,
        b.blastR,
        COMBAT_COLORS.burnGlow
      );
      ctx.spawnSparks(enemy, COMBAT_COLORS.burnGlow);
    }
  },

  // 속박(grab) — 근접 타격이 성립하면 플레이어 자동공격을 bindMs 동안 봉쇄한다(seam B).
  // 시각 신호(테더)/게이트(playerBindUntil)는 전부 ctx/scene 소유. enemy.container.x는
  // 숫자 읽기뿐(explode와 동일 패턴) — 테더 앵커 좌표로만 넘긴다.
  grab: {
    onContact(enemy, ctx) {
      const b = enemy.def.behavior;
      ctx.bindPlayer(b.bindMs ?? 700, enemy.container.x);
    }
  },

  // 사망 독웅덩이(poolOnDeath) — 죽은 자리에 지속 피해 존을 남긴다(seam D).
  // 존 생성/틱/회수는 전부 ctx.spawnHazard(scene 소유, draw-once 프리미티브)로 위임.
  // (현재 미사용 — putrifier는 poisonThrow로 전환. 향후 적용 적이 있으면 재사용.)
  poolOnDeath: {
    onDeath(enemy, ctx) {
      const b = enemy.def.behavior;
      ctx.spawnHazard(enemy.container.x, b.radius, b.dmg, b.durationMs);
    }
  },

  // 독 투척(poisonThrow) — 죽으며 독 글롭을 플레이어에게 던진다(seam D). 착탄 시 ticks회 독 DoT 후 종료.
  // 고정 위치 게임이라 바닥 웅덩이(회피 불가)보다 경계 있는 투척 피해가 공정. 투사체/DoT는 scene이 소유.
  poisonThrow: {
    onDeath(enemy, ctx) {
      const b = enemy.def.behavior;
      const fromY = enemy.container.y - (enemy.displayHeight ?? 100) * 0.55; // 몸 상단에서 던짐
      ctx.throwPoison(enemy.container.x, fromY, b.dmg, b.ticks);
    }
  },

  // 측면포위 대시 — contactRange 밖 dashRange 구간(접촉 직전)에서 단독 가속해 파고든다(협공 X).
  // 기본 직진을 대체(return true). speedMult(감전 등)는 그대로 곱해 상태효과와 공존.
  flank: {
    move(enemy, dt, playerX, dist) {
      const b = enemy.def.behavior;
      const stopRange = b.stopRange ?? enemy.def.contactRange;
      if (dist > stopRange) {
        // 대시 트리거 — contactRange와 dashRange 사이(접촉 사거리 밖)일 때만 가속.
        // lungeAttack inRange 구간(contactRange 안)과 안 겹치게 하한을 contactRange로 둔다.
        const dashing = dist <= b.dashRange && dist > enemy.def.contactRange;
        const mult = dashing ? (b.dashMult ?? 1) : 1;
        enemy.worldX -= enemy.speed * enemy.speedMult * mult * dt;
        enemy.inRange = false;
      } else {
        enemy.inRange = true;
      }
      return true; // 이동을 직접 처리함 — 기본 직진 스킵
    }
  }
};
