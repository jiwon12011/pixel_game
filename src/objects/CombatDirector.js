import Phaser from 'phaser';
import Enemy from './Enemy.js';
import { LOGICAL } from '../constants/layout.js';
import { PLAYER, SPAWN, waveParams } from '../constants/combat.js';

// 전투 운영자 — 자동 진행 사이드스크롤 전투의 두뇌.
//   · 웨이브 스폰(우측 밖 → 좌측 접근)
//   · 적 이동/근접 공격 타이밍
//   · 주인공 자동 공격(사거리 내 가장 가까운 적)
// 연출은 Enemy/CombatScene 쪽 훅에 위임하고, 여기선 "언제 무엇을"만 결정한다.
export default class CombatDirector {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} cfg {
   *   spawnList: string[],            // 스폰 가능한 적 타입 키
   *   groundY: number,                // 적 발 위치
   *   depth: number,                  // 적 렌더 깊이
   *   motionOk: boolean,
   *   player: {                       // 주인공 인터페이스(연출은 scene이 소유)
   *     getX(): number,
   *     attack(enemy): void,          // 자동 공격(런지+스쿼시, 데미지 적용 포함)
   *     takeDamage(amount): void
   *   }
   * }
   */
  constructor(scene, cfg) {
    this.scene = scene;
    this.spawnList = cfg.spawnList;
    this.groundY = cfg.groundY;
    this.depth = cfg.depth;
    this.motionOk = cfg.motionOk;
    this.player = cfg.player;
    // 현재 웨이브 파라미터 공급원(스폰 간격/동시상한/HP·드롭 배율). 없으면 웨이브0 고정.
    this.getWaveParams = cfg.getWaveParams || (() => waveParams(0));

    this.enemies = [];
    this.running = false;
    this.spawnAccum = 0;
    this.nextSpawnIn = SPAWN.firstDelay;
    this.playerAtkCd = 0;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** 진행 중인 적 전부 즉시 제거(주인공 사망/리셋 시). */
  clearAll() {
    this.enemies.forEach((e) => e.destroy());
    this.enemies = [];
  }

  aliveCount() {
    return this.enemies.filter((e) => !e.dead).length;
  }

  spawn() {
    const typeKey = Phaser.Utils.Array.GetRandom(this.spawnList);
    const enemy = new Enemy(this.scene, {
      typeKey,
      x: LOGICAL.width + SPAWN.offRightX,
      groundY: this.groundY,
      depth: this.depth,
      motionOk: this.motionOk,
      hpMult: this.getWaveParams().hpMult, // 웨이브가 깊을수록 더 단단하게
      onDeath: () => {
        // 사망 → 다음 스폰을 살짝 앞당겨 텀이 비지 않게
        this.nextSpawnIn = Math.min(this.nextSpawnIn, SPAWN.respawnDelay);
        this.spawnAccum = 0;
      }
    });
    this.enemies.push(enemy);
  }

  scheduleNextSpawn() {
    const p = this.getWaveParams();
    this.nextSpawnIn = Phaser.Math.Between(p.intervalMin, p.intervalMax);
    this.spawnAccum = 0;
  }

  /** @param {number} dtMs 프레임 델타(ms) */
  update(dtMs) {
    if (!this.running) return;
    const dt = dtMs / 1000;
    const px = this.player.getX();

    // 스폰 타이밍 — 동시 생존 상한은 현재 웨이브가 결정
    this.spawnAccum += dtMs;
    if (this.spawnAccum >= this.nextSpawnIn && this.aliveCount() < this.getWaveParams().maxAlive) {
      this.spawn();
      this.scheduleNextSpawn();
    }

    // 적 이동 + 근접 공격
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.update(dt, px);
      if (e.inRange) {
        e.attackTimer -= dtMs;
        if (e.attackTimer <= 0) {
          e.attackTimer = e.getAttackCooldown(); // 감전 시 쿨다운 늘어남
          e.lungeAttack();
          this.player.takeDamage(e.def.damage);
        }
      }
    }

    // 주인공 자동 공격 — 사거리 내 가장 가까운 적. 쿨다운은 장착 무기가 결정.
    this.playerAtkCd -= dtMs;
    if (this.playerAtkCd <= 0) {
      const target = this.nearestInRange(px, PLAYER.attackRange);
      if (target) {
        this.playerAtkCd = this.player.getAttackCooldown();
        this.player.attack(target);
      }
    }

    // 연출 끝난 적 청소
    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed);
    }
  }

  nearestInRange(px, range) {
    let best = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dist = e.worldX - px;
      if (dist <= range && dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  // 사거리 내 살아있는 적을 가까운 순으로(관통 메카닉의 2번째 타깃 선택용).
  enemiesInRange(px, range) {
    return this.enemies
      .filter((e) => !e.dead && e.worldX - px <= range)
      .sort((a, b) => a.worldX - b.worldX);
  }
}
