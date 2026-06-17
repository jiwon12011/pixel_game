// 메타(런 간 영구) 상수 + 유산/적기억 밸런스 (ideator 스펙).
// 런(현재 회차) 데이터와 분리되는 "여러 런을 가로지르는" 값만 여기.
//   · META_DEFAULTS  — GameState.meta 초기 형태(런카운트/유산/도감/적기억)
//   · LEGACY_CAPS     — 사망 유산으로 다음 런에 들고 갈 수 있는 상한
//   · MEMORY_*        — R5 적기억(이전 런 속성 학습 → 내성) 데이터. R4선 tally 적재/감쇠만.

import { MATERIAL_ORDER, freshMaterials } from './materials.js';

// 적기억 tally 키 = 무기 attrTag (crafting.js). 적이 "당한" 속성을 누적.
export const MEMORY_ATTRS = ['PHYSICAL', 'SHOCK', 'PIERCE', 'FIRE', 'TOXIC'];

// meta 초기값 — freshMeta()로 깊은 복사해 쓴다(공유 참조 사고 방지).
export const META_DEFAULTS = {
  runCount: 0,
  // legacy.type 이 null 이면 "유산 없음" — startNewRun에서 carry 스킵.
  legacy: {
    type: null, // 'weapon' | 'materials' | 'coins' | 'stat' | null
    weapon: null,
    materials: freshMaterials(), // 재료 dict carry(R7)
    coins: 0,
    stat: null
  },
  codex: { discoveredRecipes: [] }, // 발견(제작)한 무기 id — R5 도감 보드가 읽음
  enemyMemory: { tally: { PHYSICAL: 0, SHOCK: 0, PIERCE: 0, FIRE: 0, TOXIC: 0 } },
  // R7 — 직전 런 요약(사망 확정 시 기록, 사망 오버레이가 RUN #N과 함께 표시).
  lastRunSummary: { kills: 0, maxWave: 0, coins: 0, lastCraftedWeapon: null }
};

// 유산 carry 상한 (ideator). 재료는 ×0.5 floor로만 carry하므로 코인만 cap.
export const LEGACY_CAPS = { coins: 40 };

// R5 적기억: tally가 threshold 넘으면 해당 속성 데미지 mult 적용(내성). 높은 tier 우선.
export const MEMORY_TIERS = [
  { threshold: 25, mult: 0.8 },
  { threshold: 50, mult: 0.6 }
];

// 런 시작 시 적기억 tally 감쇠 비율(floor 적용). 과거 학습이 영원히 누적되지 않게.
export const MEMORY_DECAY = 0.5;

// META_DEFAULTS의 깊은 복사본. 메타는 전부 plain data라 JSON 복제로 충분.
export function freshMeta() {
  return JSON.parse(JSON.stringify(META_DEFAULTS));
}

// 빈 유산 객체(type=null).
export function freshLegacy() {
  return JSON.parse(JSON.stringify(META_DEFAULTS.legacy));
}

// ── 사망 유산 4선택지 계산 (ideator 밸런스) ──────────────────────────────
// run = GameState 스냅샷(coins, materials, statLevels, ownedWeapons:Set, equippedWeapon).
// 각 항목: { type, enabled, ...payload }. enabled=false면 카드 비활성(보유 부족).
// payload는 그대로 GameState.setLegacy로 넘긴다.
export function legacyOptions(run) {
  // 무기 — 현재 장착 무기를 그대로 carry(재료/코인은 리셋). 기본 무기면 의미 없어 비활성.
  const weapon = {
    type: 'weapon',
    weapon: run.equippedWeapon,
    enabled: run.equippedWeapon !== 'pipe_wrench'
  };

  // 재료 — 보유한 각 재료 ×0.5 floor(>0만) carry. 다음 런 시작값에 주입.
  const carry = {};
  let materialsTotal = 0;
  let kinds = 0;
  for (const k of MATERIAL_ORDER) {
    const n = Math.floor((run.materials?.[k] || 0) * 0.5);
    if (n > 0) {
      carry[k] = n;
      materialsTotal += n;
      kinds += 1;
    }
  }
  const materials = {
    type: 'materials',
    materials: carry,
    total: materialsTotal,
    kinds,
    enabled: materialsTotal > 0
  };

  // 코인 — coins×0.3(cap40), floor.
  const coinsCarry = Math.min(LEGACY_CAPS.coins, Math.floor(run.coins * 0.3));
  const coins = { type: 'coins', coins: coinsCarry, enabled: coinsCarry > 0 };

  // 스탯 — 가장 많이 투자한 스탯 1개를 다음 런 statLevel 1로 시작.
  let bestStat = null;
  let bestLvl = 0;
  for (const [stat, lvl] of Object.entries(run.statLevels)) {
    if (lvl > bestLvl) {
      bestLvl = lvl;
      bestStat = stat;
    }
  }
  const stat = { type: 'stat', stat: bestStat, enabled: bestLvl > 0 };

  return [weapon, materials, coins, stat];
}
