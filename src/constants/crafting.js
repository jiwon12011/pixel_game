// 능력치 업그레이드 곡선 + 무기 합성 레시피 (ideator 스펙).
// 테이블만 여기 두고, 적용/소비는 GameState가, UI는 HubScene이 담당.

// ── 능력치 업그레이드 ───────────────────────────────────────────────────
// 비용 곡선: cost[n] = round(base * 1.6^(n-1) / 5) * 5   (n = 구매할 레벨, 1-indexed)
//   maxHP: 비용 base 20, 레벨당 +15
//   atk  : 비용 base 25, 레벨당 +5
//   def  : 비용 base 30, 레벨당 +1 (피해감소 def*4%, 5레벨 캡 = 20%)
export const STAT_UPGRADES = {
  maxHP: { key: 'maxHP', label: '체력', base: 20, increment: 15, maxLevel: null },
  atk: { key: 'atk', label: '공격력', base: 25, increment: 5, maxLevel: null },
  def: { key: 'def', label: '방어력', base: 30, increment: 1, maxLevel: 5 }
};

// 능력치 탭 표시 순서
export const STAT_ORDER = ['maxHP', 'atk', 'def'];

// 다음 레벨 비용. nextLevel = 현재 statLevels[stat] + 1.
export function upgradeCost(stat, nextLevel) {
  const base = STAT_UPGRADES[stat].base;
  return Math.round((base * Math.pow(1.6, nextLevel - 1)) / 5) * 5;
}

// 방어력 → 피해감소 배율(0~1). def*4%, 캡 20%.
export function defenseMultiplier(def) {
  return 1 - Math.min(def * 0.04, 0.2);
}

// ── 무기 합성 레시피 (근접 수직 슬라이스) ──────────────────────────────
//   atkBonus  — 플레이어 atk에 더해지는 무기 보너스
//   cooldown  — 자동 공격 주기(ms). 낮을수록 빠름.
//   requires  — 선행으로 보유해야 하는 무기 id(없으면 null)
//   cost      — 합성 재료 { SCRAP, ELEC, POWDER }
//   mechanic  — 전투 특수효과(없으면 null)
//     · shock : 히트 시 chance 확률로 대상 감전 → speed*slowMult, attackCooldown*cdMult, durationMs
//     · pierce: 사거리 내 2번째 적에게 falloff 배율 추가타(관통타는 메카닉 트리거 제외)
//     · burn  : chance 확률로 화염 DoT → dmgPerTick씩 tickMs 주기로 durationMs 동안(투척 화염병)
//     · toxic : chance 확률로 독 DoT(burn과 동일 파라미터) + spreadChance로 가장 가까운 다른 적 1체 전파
//               DoT 틱은 per-enemy 타이머 없이 director 단일 update에서 처리(perf). 직접타만 적기억 대상.
//   attrTag   — 무기 속성 태그(R5 적기억 tally 키). FIRE/TOXIC로 적기억 4채널 가동.
export const WEAPON_RECIPES = {
  pipe_wrench: {
    id: 'pipe_wrench',
    name: '파이프 렌치',
    tier: '근접 · 기본',
    atkBonus: 0,
    cooldown: 700,
    requires: null,
    cost: {},
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '균형 잡힌 기본 근접'
  },
  electric_shock_wrench: {
    id: 'electric_shock_wrench',
    name: '전기충격 렌치',
    tier: '근접 · 합성',
    atkBonus: 8,
    cooldown: 630,
    requires: 'pipe_wrench',
    cost: { SCRAP: 8, ELEC: 3 },
    mechanic: { type: 'shock', chance: 0.3, slowMult: 0.5, cdMult: 1.67, durationMs: 600 },
    attrTag: 'SHOCK',
    ability: '히트 30% 감전(감속)'
  },
  plasma_shredder: {
    id: 'plasma_shredder',
    name: '플라즈마 파쇄기',
    tier: '근접 · 최상위',
    atkBonus: 20,
    cooldown: 750,
    requires: 'electric_shock_wrench',
    cost: { SCRAP: 15, ELEC: 6 },
    mechanic: { type: 'pierce', falloff: 0.5 },
    attrTag: 'PIERCE',
    ability: '2번째 적 관통 ×0.5'
  },

  // ── 투척 트리 (화염/독 DoT) — 근접과 독립 라인. molotov가 시작점. ──────
  molotov: {
    id: 'molotov',
    name: '화염병',
    tier: '투척 · 시작',
    atkBonus: 5,
    cooldown: 850,
    requires: null, // 투척 라인 독립 시작(근접 선행 불필요)
    cost: { SCRAP: 5, POWDER: 5 },
    mechanic: { type: 'burn', chance: 0.5, dmgPerTick: 4, tickMs: 500, durationMs: 2000 },
    attrTag: 'FIRE',
    ability: '히트 50% 화상 도트'
  },
  poison_gas_canister: {
    id: 'poison_gas_canister',
    name: '독가스통',
    tier: '투척 · 상위',
    atkBonus: 12,
    cooldown: 1100,
    requires: 'molotov',
    cost: { SCRAP: 10, POWDER: 8, ELEC: 2 },
    mechanic: {
      type: 'toxic',
      chance: 0.35,
      dmgPerTick: 3,
      tickMs: 600,
      durationMs: 2400,
      spreadChance: 0.4
    },
    attrTag: 'TOXIC',
    ability: '35% 중독 · 전파'
  }
};

// 합성 탭 무기 슬롯 표시 순서 — 근접 3종 + 투척 2종(5칸). 다음 라운드에 원거리/설치 트리가 이어짐.
export const WEAPON_ORDER = [
  'pipe_wrench',
  'electric_shock_wrench',
  'plasma_shredder',
  'molotov',
  'poison_gas_canister'
];

// 파츠 표시 메타 — 색칩 + 라벨 (designer 스펙).
export const PART_META = {
  SCRAP: { label: 'SCRAP', color: 0x8a6a3a }, // 녹슨 철 칩(가독성 위해 베이스보다 밝게)
  ELEC: { label: 'ELEC', color: 0x20ff9a }, // 청록
  POWDER: { label: 'POWDER', color: 0xff6020 } // 주황
};
