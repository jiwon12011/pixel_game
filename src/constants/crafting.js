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
    ability: '2번째 적 관통 ×0.5'
  }
};

// 합성 탭 무기 슬롯 표시 순서(근접 트리). 다음 라운드에 원거리/설치/특수 트리가 이어짐.
export const WEAPON_ORDER = ['pipe_wrench', 'electric_shock_wrench', 'plasma_shredder'];

// 파츠 표시 메타 — 색칩 + 라벨 (designer 스펙).
export const PART_META = {
  SCRAP: { label: 'SCRAP', color: 0x8a6a3a }, // 녹슨 철 칩(가독성 위해 베이스보다 밝게)
  ELEC: { label: 'ELEC', color: 0x20ff9a }, // 청록
  POWDER: { label: 'POWDER', color: 0xff6020 } // 주황
};
