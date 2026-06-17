// 공유 게임 상태 — 전투 씬과 허브 씬이 같은 단일 객체를 본다.
// Phaser는 Combat/Hub를 병렬 씬으로 돌리므로(씬 간 직접 참조 X) 이 싱글톤이 둘의 다리.
// 의존성 0의 plain JS 객체 + 아주 얇은 이벤트(emit/on) 한 겹. Redux류 금지(스펙).
//
// 2레이어 구조 (로그라이크):
//   · run  — 현재 회차. 사망하면 리셋된다. 최상위 필드로 둬 기존 콜사이트 불변.
//            (coins, materials, stats, statLevels, ownedWeapons, equippedWeapon, waveIndex, runKills)
//   · meta — 여러 런을 가로지르는 영구 데이터. GameState.meta 네임스페이스.
//            (runCount, legacy, codex, enemyMemory)
//   저장도 두 키로 분리: 'last-salvage:run:v1' / 'last-salvage:meta:v1'.
//
// 이벤트:
//   'change' — 자원/스탯/장비/웨이브 무엇이든 바뀌면 발행. HUD·허브가 구독해 표시 갱신.
//   'drop'   — 전투 드롭이 들어올 때만. payload = { coins, <재료키>:n, x, y }.
//   'stats'  — 능력치가 업그레이드됐을 때. CombatScene이 maxHP 증가분을 현재 전투에 반영.

import { WAVE } from '../constants/combat.js';
import { STAT_UPGRADES } from '../constants/crafting.js';
import { MATERIAL_ORDER, freshMaterials } from '../constants/materials.js';
import {
  freshMeta,
  freshLegacy,
  MEMORY_DECAY,
  MEMORY_TIERS,
  MEMORY_ATTRS
} from '../constants/meta.js';

// R5 적기억 스냅샷 — tally(누적 학습)에서 속성별 데미지 배율을 파생한다.
// 런 시작 시 1회만 호출해 runResistance에 고정(스냅샷). 런 중엔 tally가 자라도
// 이 값은 안 바뀐다 → "이전 런에 많이 쓴 속성 = 이번 런 그 적이 내성"을 보장.
// MEMORY_TIERS는 threshold 오름차순 — 충족하는 가장 높은 tier의 mult가 최종값.
function deriveResistance(tally) {
  const res = {};
  for (const attr of MEMORY_ATTRS) {
    const t = tally[attr] || 0;
    let mult = 1.0;
    for (const tier of MEMORY_TIERS) {
      if (t >= tier.threshold) mult = tier.mult;
    }
    res[attr] = mult;
  }
  return res;
}

// R7 — 재료 시스템 도입으로 run 세이브 스키마가 바뀌어(parts→materials) 키를 v2로 bump.
// 구 v1 런(parts 기반)은 1:1 환산 없이 조용히 폐기(load에서 제거). meta(runCount/도감)는 보존.
const RUN_KEY = 'last-salvage:run:v2';
const RUN_KEY_V1 = 'last-salvage:run:v1'; // 폐기 대상(R7 마이그레이션)
const META_KEY = 'last-salvage:meta:v1';
const OLD_KEY = 'last-salvage:save:v1'; // 구 단일키(전부 영구) — 마이그레이션 대상

// run 최상위 필드의 base 초기값. resetRun이 이걸로 되돌린 뒤 유산을 주입한다.
function baseRun() {
  return {
    coins: 0,
    materials: freshMaterials(), // R7 — 실제 재료 7종 dict(전부 0)
    stats: { maxHP: 100, atk: 20, def: 0 },
    statLevels: { maxHP: 0, atk: 0, def: 0 },
    ownedWeapons: new Set(['pipe_wrench']),
    equippedWeapon: 'pipe_wrench',
    waveIndex: 0,
    runKills: 0,
    lastCraftedWeapon: null // 이번 런에 마지막으로 제작한 무기(사망 요약용)
  };
}

const listeners = new Map(); // event -> Set<fn>

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // 복사 후 순회 — 콜백이 off()를 불러도 안전
  for (const fn of [...set]) fn(payload);
}

const GameState = {
  // ── run: 자원/스탯/장비/진행 (최상위 — 기존 콜사이트 호환) ──────────────
  ...baseRun(),

  // ── meta: 런 간 영구 (유산/도감/적기억) ─────────────────────────────────
  meta: freshMeta(),

  // ── R5 적기억: 현재 런 고정 내성 스냅샷 { PHYSICAL:mult, ... } ──────────
  // resetRun(새 런)·load(부팅 resume)에서 (감쇠된) tally로 파생해 런 내내 불변.
  runResistance: deriveResistance(freshMeta().enemyMemory.tally),

  // ── 이벤트 ──────────────────────────────────────────────────────────
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  emit, // 외부에서 직접 발행할 일은 거의 없지만 노출

  // ── 드롭 가산 (전투에서 호출) ────────────────────────────────────────
  // delta = { coins, <재료키>:n } 중 들어온 것만. x,y는 줍기 연출용 좌표.
  applyDrop(delta, x, y) {
    if (delta.coins) this.coins += delta.coins;
    for (const k of MATERIAL_ORDER) if (delta[k]) this.materials[k] += delta[k];
    this._markRunDirty();
    emit('drop', { ...delta, x, y });
    emit('change');
  },

  // ── 적 처치 누적 → 웨이브 진행 ──────────────────────────────────────
  // killsPerWave마다 waveIndex+1. @returns { waveChanged, waveIndex }.
  addKill() {
    this.runKills += 1;
    const newWave = Math.floor(this.runKills / WAVE.killsPerWave);
    const waveChanged = newWave !== this.waveIndex;
    this.waveIndex = newWave;
    this._markRunDirty();
    emit('change');
    return { waveChanged, waveIndex: this.waveIndex };
  },

  // ── 능력치 업그레이드 ────────────────────────────────────────────────
  // 성공 시 코인 차감 + 스탯 적용 + 레벨++ → true. 실패(코인부족/캡) → false.
  buyStatUpgrade(stat, cost, increment, maxLevel) {
    if (maxLevel != null && this.statLevels[stat] >= maxLevel) return false;
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.statLevels[stat] += 1;
    this.stats[stat] += increment;
    this._markRunDirty();
    emit('stats', { stat, increment });
    emit('change');
    return true;
  },

  // ── 합성 ─────────────────────────────────────────────────────────────
  // cost = { <재료키>: 수량 }. 보유 재료로 충족 가능한지.
  canAfford(cost) {
    for (const k of Object.keys(cost || {})) {
      if ((cost[k] || 0) > (this.materials[k] || 0)) return false;
    }
    return true;
  },
  craftWeapon(weaponId, cost) {
    if (this.ownedWeapons.has(weaponId)) return false;
    if (!this.canAfford(cost)) return false;
    for (const k of Object.keys(cost || {})) if (cost[k]) this.materials[k] -= cost[k];
    this.ownedWeapons.add(weaponId);
    this.lastCraftedWeapon = weaponId; // 사망 요약(lastRunSummary)용
    this._markRunDirty();
    this.recordCodex(weaponId); // 발견 레시피 영구 기록(meta) — R5 도감 보드용
    emit('change');
    return true;
  },
  equipWeapon(weaponId) {
    if (!this.ownedWeapons.has(weaponId)) return false;
    if (this.equippedWeapon === weaponId) return false;
    this.equippedWeapon = weaponId;
    this._markRunDirty();
    emit('change');
    return true;
  },

  // ── 도감 (meta) ──────────────────────────────────────────────────────
  recordCodex(weaponId) {
    const list = this.meta.codex.discoveredRecipes;
    if (list.includes(weaponId)) return;
    list.push(weaponId);
    this.saveMeta();
  },

  // ── 직전 런 요약 (사망 확정 시 1회 — meta 영속) ───────────────────────
  // 사망 오버레이가 RUN #N과 함께 표시한다. run 리셋 전에 호출해야 값이 살아있다.
  recordRunSummary() {
    this.meta.lastRunSummary = {
      kills: this.runKills,
      maxWave: this.waveIndex,
      coins: this.coins,
      lastCraftedWeapon: this.lastCraftedWeapon
    };
    this.saveMeta();
  },

  // ── 유산/런 사이클 ───────────────────────────────────────────────────
  // 사망 화면에서 고른 유산을 meta에 저장(다음 startNewRun이 소비).
  setLegacy(legacy) {
    this.meta.legacy = legacy ? { ...freshLegacy(), ...legacy } : freshLegacy();
    this.saveMeta();
  },

  // 최상위 run 필드를 base로 되돌린 뒤 legacy(있으면) 주입. saveRun까지.
  resetRun(legacy) {
    Object.assign(this, baseRun());
    if (legacy && legacy.type) this.applyLegacy(legacy);
    // R5 내성 스냅샷 — 이 시점의 (startNewRun에서 이미 감쇠된) tally로 고정.
    this.runResistance = deriveResistance(this.meta.enemyMemory.tally);
    this._markRunDirty();
  },

  // 유산 1개를 새 런 시작값에 반영. (carry는 base 위에 가산/대체)
  applyLegacy(legacy) {
    switch (legacy.type) {
      case 'weapon':
        if (legacy.weapon) {
          this.ownedWeapons.add(legacy.weapon);
          this.equippedWeapon = legacy.weapon; // 직접 장착(검증은 ownedWeapons로 충족)
        }
        break;
      case 'materials':
        for (const k of MATERIAL_ORDER) this.materials[k] += legacy.materials?.[k] || 0;
        break;
      case 'coins':
        this.coins += legacy.coins || 0;
        break;
      case 'stat': {
        const def = STAT_UPGRADES[legacy.stat];
        if (def) {
          this.statLevels[legacy.stat] = 1;
          this.stats[legacy.stat] += def.increment; // statLevel 1 상당치로 시작
        }
        break;
      }
      default:
        break;
    }
  },

  // 새 런 시작: meta.legacy 소비 → resetRun → runCount++. 적기억 tally 감쇠도 여기서.
  startNewRun() {
    this.decayEnemyMemory(); // R5 내성 계산 전, 과거 학습을 절반 감쇠해두기(적용만)
    const legacy = this.meta.legacy;
    this.resetRun(legacy && legacy.type ? legacy : null);
    this.meta.legacy = freshLegacy(); // 유산 소비(type=null)
    this.meta.runCount += 1;
    this.saveMeta();
    this.flushRun(); // 새 런 시작은 손실 민감 경계 — 디바운스 대기 없이 즉시 기록
    emit('change');
  },

  // 적기억 tally floor(*0.5) 감쇠 — R5 내성 계산용 누적치 관리.
  decayEnemyMemory() {
    const t = this.meta.enemyMemory.tally;
    for (const k of Object.keys(t)) t[k] = Math.floor(t[k] * MEMORY_DECAY);
  },

  // ── run 저장 디바운스 ────────────────────────────────────────────────
  // 한 처치당 addKill+applyDrop이 saveRun을 2번 부르고, 고웨이브 처치 폭주 시
  // 초당 수회 JSON.stringify+setItem(동기)이 메인스레드를 막았다(perf P1-1).
  // → 런 변경은 _markRunDirty()로 플래그만 세우고, 실제 write는 setTimeout(0)으로
  //   다음 매크로태스크에 1회로 합친다(같은 틱의 N회 변경 → write 1회).
  //   로그라이크라 처치 단위 즉시저장 손실은 허용. 단 손실 민감 경계
  //   (새 런 시작 / 탭 숨김·종료)에서는 flushRun()으로 즉시 동기 기록한다.
  _runDirty: false,
  _runFlushHandle: null,
  _autoFlushInstalled: false,

  _markRunDirty() {
    this._runDirty = true;
    if (this._runFlushHandle != null) return; // 이미 예약됨 — 1틱당 1회
    this._runFlushHandle = setTimeout(() => {
      this._runFlushHandle = null;
      this.flushRun();
    }, 0);
  },

  // 더티면 즉시 동기 기록 + 예약 취소(중복 write 방지). 안전하게 여러 번 호출 가능.
  flushRun() {
    if (this._runFlushHandle != null) {
      clearTimeout(this._runFlushHandle);
      this._runFlushHandle = null;
    }
    if (!this._runDirty) return;
    this._runDirty = false;
    this.saveRun();
  },

  // 탭 숨김(모바일 백그라운드 전환)·페이지 종료 시 더티 런을 잃지 않게 즉시 flush.
  // pagehide는 beforeunload보다 모바일에서 신뢰도가 높고, visibilitychange(hidden)는
  // 백그라운드 전환(앱 전환/탭 숨김)을 잡는다. load()에서 1회만 설치.
  installAutoFlush() {
    if (this._autoFlushInstalled) return;
    this._autoFlushInstalled = true;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const flush = () => this.flushRun();
    window.addEventListener('visibilitychange', () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  },

  // ── localStorage: run / meta 두 키로 분리 ────────────────────────────
  saveRun() {
    try {
      localStorage.setItem(
        RUN_KEY,
        JSON.stringify({
          coins: this.coins,
          materials: this.materials,
          stats: this.stats,
          statLevels: this.statLevels,
          ownedWeapons: [...this.ownedWeapons],
          equippedWeapon: this.equippedWeapon,
          waveIndex: this.waveIndex,
          runKills: this.runKills,
          lastCraftedWeapon: this.lastCraftedWeapon
        })
      );
    } catch {
      /* 비공개 모드/용량초과 — 저장 실패해도 게임 진행은 계속 */
    }
  },
  saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch {
      /* noop — 저장 실패해도 진행 계속 */
    }
  },

  load() {
    this.installAutoFlush(); // 탭 숨김/종료 시 더티 런 즉시 flush 보장
    this.loadMeta(); // 영구 메타 먼저
    this.migrateOldSave(); // 구 단일키 → 도감 씨앗 이관(메타 비었을 때만) + 구키 제거
    this.dropV1Run(); // R7 — parts 기반 v1 런 폐기(meta는 보존, 1:1 환산 안 함)
    this.loadRun(); // 진행 중이던 런(없으면 base 유지)
    // 부팅 resume 경로는 startNewRun/resetRun을 안 거친다 → 여기서 스냅샷을 잡아야
    // 이어하는 런에도 유효한 내성이 적용된다(로드된 tally 기준).
    this.runResistance = deriveResistance(this.meta.enemyMemory.tally);
  },

  loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      const m = freshMeta();
      m.runCount = d.runCount ?? m.runCount;
      if (d.legacy) m.legacy = { ...m.legacy, ...d.legacy };
      if (Array.isArray(d.codex?.discoveredRecipes)) {
        m.codex.discoveredRecipes = [...new Set(d.codex.discoveredRecipes)];
      }
      if (d.enemyMemory?.tally) m.enemyMemory.tally = { ...m.enemyMemory.tally, ...d.enemyMemory.tally };
      if (d.lastRunSummary) m.lastRunSummary = { ...m.lastRunSummary, ...d.lastRunSummary };
      this.meta = m;
    } catch {
      /* 손상 메타 — 기본값 유지 */
    }
  },

  loadRun() {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.coins = d.coins ?? this.coins;
      this.materials = { ...freshMaterials(), ...(d.materials || {}) };
      this.stats = { ...this.stats, ...(d.stats || {}) };
      this.statLevels = { ...this.statLevels, ...(d.statLevels || {}) };
      if (Array.isArray(d.ownedWeapons)) this.ownedWeapons = new Set(d.ownedWeapons);
      this.ownedWeapons.add('pipe_wrench'); // 기본 무기는 항상 보유
      this.equippedWeapon = d.equippedWeapon ?? this.equippedWeapon;
      this.waveIndex = d.waveIndex ?? 0;
      this.runKills = d.runKills ?? 0;
      this.lastCraftedWeapon = d.lastCraftedWeapon ?? null;
    } catch {
      /* 손상된 런 세이브 — base로 진행 */
    }
  },

  // R7 마이그레이션: parts(SCRAP/ELEC/POWDER) 기반 v1 런은 재료 스키마와 호환되지 않아
  // 1:1 환산 없이 조용히 폐기한다. meta(runCount/도감/적기억)는 별도 키라 그대로 보존된다.
  dropV1Run() {
    try {
      localStorage.removeItem(RUN_KEY_V1);
    } catch {
      /* noop — 제거 실패해도 v2 로드엔 영향 없음 */
    }
  },

  // 마이그레이션: 구 v1은 전부 영구 저장 구조였다. 로그라이크(런/메타 분리)로 모델이
  // 바뀌어 구 "런 진행도"는 더 이상 의미가 없으므로 폐기한다. 단, 그동안 발견한 무기는
  // 도감 씨앗으로 살려 수집 진행을 보존한다. 처리 후 구 키는 제거(레거시 잔존 방지).
  migrateOldSave() {
    let raw;
    try {
      raw = localStorage.getItem(OLD_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      // 메타가 비어 있을 때만 씨앗 이관(이미 새 메타가 있으면 그게 진실).
      if (this.meta.codex.discoveredRecipes.length === 0 && Array.isArray(d.ownedWeapons)) {
        const seeds = [...new Set(d.ownedWeapons.filter((w) => w && w !== 'pipe_wrench'))];
        if (seeds.length) {
          this.meta.codex.discoveredRecipes = seeds;
          this.saveMeta();
        }
      }
    } catch {
      /* 손상된 구 세이브 — 무시하고 폐기 */
    } finally {
      try {
        localStorage.removeItem(OLD_KEY);
      } catch {
        /* noop */
      }
    }
  }
};

export default GameState;
