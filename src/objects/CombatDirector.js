import Phaser from 'phaser';
import Enemy from './Enemy.js';
import { LOGICAL } from '../constants/layout.js';
import { PLAYER, SPAWN, SPAWN_WEIGHTS, SPAWN_MIN_WAVE, ENEMY_TYPES, ELITE, waveParams } from '../constants/combat.js';

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
    // 현재 웨이브 번호 공급원(엘리트 등장 임계 판정). 없으면 0 고정.
    this.getWaveIndex = cfg.getWaveIndex || (() => 0);
    // DoT 1틱 콜백(enemy, dmg) — 데미지숫자/처치 처리는 scene이 소유. 없으면 무시.
    this.onDotTick = cfg.onDotTick || null;
    // 위험 적 스폰 콜백(enemy, {elite, grab}) — 엘리트/그래버 등장 경고는 scene이 표시(throttle도 scene 책임).
    this.onThreatSpawn = cfg.onThreatSpawn || null;

    // [seam B] 근접 타격 ctx — 매 접촉마다 객체 생성하지 않게 1회만 만든다(부작용은 player 콜백 경유).
    // grab 등 onContact 행동이 ctx.bindPlayer(ms, x)로 scene 상태를 건드린다.
    this._contactCtx = { bindPlayer: (ms, x) => this.player.bindPlayer?.(ms, x) };

    this.enemies = [];
    this.running = false;
    this.spawnAccum = 0;
    this.nextSpawnIn = SPAWN.firstDelay;
    this.playerAtkCd = 0;
    // 보스전 동안 true — 일반 적 스폰을 멈춰 보스에 집중하게 한다(scene이 토글).
    this.suppressSpawn = false;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** 진행 중인 적 전부 즉시 제거(주인공 사망/리셋 시). 보스 상태 플래그도 초기화. */
  clearAll() {
    this.enemies.forEach((e) => e.destroy());
    this.enemies = [];
    this.suppressSpawn = false;
  }

  // 보스 1체 스폰 — 잡몹과 같은 Enemy 인프라를 쓰되 def/maxHP를 주입하고 isBoss로 표시한다.
  // 우측 밖에서 등장(일반 적과 동선 동일). 잡몹보다 살짝 앞 깊이로 렌더. 반환값으로 scene이 HP바를 묶는다.
  spawnBoss({ typeKey, def, maxHP, onDeath }) {
    const boss = new Enemy(this.scene, {
      typeKey,
      def,
      maxHP,
      isBoss: true,
      x: LOGICAL.width + SPAWN.offRightX,
      groundY: this.groundY,
      depth: this.depth + 0.2,
      motionOk: this.motionOk,
      onDeath
    });
    boss.director = this; // ctx 배선 — 행동 패턴이 director를 참조할 수 있게(scene 부작용은 콜백 주입)
    this.enemies.push(boss);
    return boss;
  }

  aliveCount() {
    // [perf] 매 프레임 스폰 게이트에서 호출 — filter 임시배열 없이 단순 카운터.
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  // 가중 스폰 선택 — SPAWN_WEIGHTS 비율로 뽑아 tank를 희소화. 가중치 없는 타입은 1.
  pickSpawnType() {
    const list = this.spawnList;
    let total = 0;
    for (const k of list) total += SPAWN_WEIGHTS[k] ?? 1;
    let r = Math.random() * total;
    for (const k of list) {
      r -= SPAWN_WEIGHTS[k] ?? 1;
      if (r < 0) return k;
    }
    return list[list.length - 1]; // 부동소수 보정 폴백
  }

  spawn() {
    const w = this.getWaveIndex();
    let typeKey = this.pickSpawnType();
    // 타입 minWave 게이트 — 초반 메카닉 과부하 방지. 미달이면 기본 압박형(sludge/flanker)으로 대체.
    const minW = SPAWN_MIN_WAVE[typeKey];
    if (minW != null && w < minW) {
      typeKey = Math.random() < 0.5 ? 'sludge_zombie' : 'flanker_zombie';
    }
    // 엘리트 승격 — minWave 이상에서 낮은 확률. native behavior는 유지하고 HP/스케일/tint만 강화.
    const elite = w >= ELITE.minWave && Math.random() < ELITE.chance;
    const enemy = new Enemy(this.scene, {
      typeKey,
      elite,
      x: LOGICAL.width + SPAWN.offRightX,
      groundY: this.groundY,
      depth: this.depth,
      motionOk: this.motionOk,
      // 웨이브 hpMult에 엘리트 배율을 곱연산(엘리트는 확연히 단단하게).
      hpMult: this.getWaveParams().hpMult * (elite ? ELITE.hpMult : 1),
      onDeath: () => {
        // 사망 → 다음 스폰을 살짝 앞당겨 텀이 비지 않게
        this.nextSpawnIn = Math.min(this.nextSpawnIn, SPAWN.respawnDelay);
        this.spawnAccum = 0;
      }
    });
    enemy.director = this; // ctx 배선 — 행동 패턴이 director 참조 가능(seam D 등)
    this.enemies.push(enemy);

    // 위험 패턴 등장 경고 — 엘리트(승격) 또는 그래버(속박형). 표시/쿨다운은 scene이 판단.
    const isGrab = ENEMY_TYPES[typeKey]?.behavior?.type === 'grab';
    if ((elite || isGrab) && this.onThreatSpawn) this.onThreatSpawn(enemy, { elite, grab: isGrab });
  }

  // 보스 페이즈 소환용 — 지정 타입 1체를 즉시 스폰(suppressSpawn 무시). alive 캡은 호출부가 책임.
  // 텍스처는 인카운터 시작 시 로드된 SLICE_SPAWN_LIST에 있어야 한다(미로드 타입 호출 금지).
  spawnAdd(typeKey) {
    if (!ENEMY_TYPES[typeKey] || !this.scene.textures.exists(typeKey)) return null;
    const enemy = new Enemy(this.scene, {
      typeKey,
      x: LOGICAL.width + SPAWN.offRightX,
      groundY: this.groundY,
      depth: this.depth,
      motionOk: this.motionOk,
      hpMult: this.getWaveParams().hpMult
    });
    enemy.director = this;
    this.enemies.push(enemy);
    return enemy;
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
    const now = this.scene.time.now;

    // 스폰 타이밍 — 동시 생존 상한은 현재 웨이브가 결정. 보스전(suppressSpawn) 중엔 잡몹 스폰 중단.
    this.spawnAccum += dtMs;
    if (!this.suppressSpawn && this.spawnAccum >= this.nextSpawnIn && this.aliveCount() < this.getWaveParams().maxAlive) {
      this.spawn();
      this.scheduleNextSpawn();
    }

    // 적 이동 + 근접 공격 + DoT 틱(per-enemy 타이머 없이 이 단일 루프에서 처리)
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.update(dt, px);
      if (e.inRange) {
        e.attackTimer -= dtMs;
        if (e.attackTimer <= 0) {
          e.attackTimer = e.getAttackCooldown(); // 감전 시 쿨다운 늘어남
          e.lungeAttack();
          this.player.takeDamage(e.def.damage);
          // [seam B] 근접 타격 성립 — grab(속박) 등 onContact 행동 발동(부작용은 ctx 콜백 경유).
          e.behavior?.onContact?.(e, this._contactCtx);
        }
      }
      // DoT — 만료 우선 해제, 아니면 누적 주기마다 1틱. 틱 데미지는 적기억 tally/내성 제외.
      if (e.dotType) {
        if (now >= e.dotExpiresAt) {
          e.clearDot();
        } else if (now >= e.dotNextTickAt) {
          e.dotNextTickAt += e.dotTickMs;
          this.onDotTick?.(e, e.dotDmgPerTick); // 사망 시 scene이 onEnemyKilled 처리
        }
      }
    }

    // 주인공 자동 공격 — 사거리 내 가장 가까운 적. 쿨다운은 장착 무기가 결정.
    // 속박(grab) 중이면 쿨다운은 흘려보내되 타격은 skip — 풀리는 즉시 다시 때린다.
    this.playerAtkCd -= dtMs;
    if (this.playerAtkCd <= 0 && !this.player.isBound?.()) {
      const target = this.nearestInRange(px, PLAYER.attackRange);
      if (target) {
        this.playerAtkCd = this.player.getAttackCooldown();
        this.player.attack(target);
      }
    }

    // 연출 끝난 적 청소 — [perf] some+filter 이중순회/임시배열 대신 역순 splice 한 번에.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) this.enemies.splice(i, 1);
    }
  }

  nearestInRange(px, range) {
    let best = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dist = e.worldX - px;
      // 사거리 안이거나, 이미 정지해 근접공격 중(inRange)이면 대상. 후자는 보스처럼
      // contactRange > attackRange라 사거리 밖에 멈추는 적을 반격 못 하던 버그를 막는다.
      if ((dist <= range || e.inRange) && dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  // 사거리 내(또는 근접공격 중) 살아있는 적을 가까운 순으로(관통 2번째 타깃·탭공격용).
  enemiesInRange(px, range) {
    return this.enemies
      .filter((e) => !e.dead && (e.worldX - px <= range || e.inRange))
      .sort((a, b) => a.worldX - b.worldX);
  }

  // 독 전파용 — 기준 적(from) 외 가장 가까운 살아있는 적 1체(worldX 거리). 없으면 null.
  nearestOtherEnemy(from) {
    let best = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e === from) continue;
      const d = Math.abs(e.worldX - from.worldX);
      if (d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return best;
  }
}
