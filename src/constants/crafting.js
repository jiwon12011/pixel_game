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
//   cost      — 합성 재료 { <재료키>: 수량 } (R7 — 실제 재료. materials.js MATERIAL_ORDER 키)
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
    cost: { rusty_screws: 6, copper_wire_coil: 3 },
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
    cost: { scrap_metal_plate: 3, copper_wire_coil: 5, broken_circuit_board: 1 },
    mechanic: { type: 'pierce', falloff: 0.5 },
    attrTag: 'PIERCE',
    ability: '2번째 적 관통 ×0.5'
  },
  // ── 근접 확장(R8) — pipe_wrench/plasma_shredder에서 갈라지는 관통·물리 라인. ──
  // 신규 전투 메카닉은 이번 라운드 미구현 → pierce(관통타)/null(물리 고화력)로만 매핑.
  saw_blade_stick: {
    id: 'saw_blade_stick',
    name: '톱날 봉',
    tier: '근접 · T2',
    atkBonus: 7,
    cooldown: 680,
    requires: 'pipe_wrench',
    cost: { scrap_metal_plate: 3, rusty_screws: 5 },
    mechanic: { type: 'pierce', falloff: 0.45 },
    attrTag: 'PIERCE',
    ability: '톱날 관통타 ×0.45'
  },
  rotary_saw_shield: {
    id: 'rotary_saw_shield',
    name: '회전 톱날 방패',
    tier: '근접 · T3',
    atkBonus: 16,
    cooldown: 720,
    requires: 'saw_blade_stick',
    cost: { scrap_metal_plate: 4, old_battery_cell: 2, broken_circuit_board: 1 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '회전 방패 · 묵직한 광역 근접'
  },
  death_windmill: {
    id: 'death_windmill',
    name: '죽음의 풍차',
    tier: '근접 · T4',
    atkBonus: 28,
    cooldown: 760,
    requires: 'plasma_shredder',
    cost: { scrap_metal_plate: 5, old_battery_cell: 3, chemical_vial: 2 },
    mechanic: { type: 'pierce', falloff: 0.65 },
    attrTag: 'PIERCE',
    ability: '강관통 ×0.65 · 다수 절단'
  },

  // ── 투척 트리 (화염/독 DoT) — 근접과 독립 라인. molotov가 시작점. ──────
  molotov: {
    id: 'molotov',
    name: '화염병',
    tier: '투척 · 시작',
    atkBonus: 5,
    cooldown: 850,
    requires: null, // 투척 라인 독립 시작(근접 선행 불필요)
    cost: { rusty_screws: 3, small_fuel_canister: 2 },
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
    cost: { scrap_metal_plate: 2, small_fuel_canister: 3, chemical_vial: 4 },
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
  },
  // pipe_bomber — 투척 라인의 두 번째 독립 시작점(근접/molotov 선행 불필요). 물리 직격.
  pipe_bomber: {
    id: 'pipe_bomber',
    name: '파이프 폭탄',
    tier: '투척 · T1',
    atkBonus: 7,
    cooldown: 900,
    requires: null,
    cost: { rusty_screws: 4, scrap_metal_plate: 2 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '파편 직격 투척'
  },
  bio_bomb: {
    id: 'bio_bomb',
    name: '생체 폭탄',
    tier: '투척 · T2',
    atkBonus: 13,
    cooldown: 1100,
    requires: 'pipe_bomber',
    cost: { scrap_metal_plate: 2, small_fuel_canister: 2, chemical_vial: 3 },
    mechanic: {
      type: 'toxic',
      chance: 0.4,
      dmgPerTick: 3,
      tickMs: 600,
      durationMs: 2400,
      spreadChance: 0.45
    },
    attrTag: 'TOXIC',
    ability: '40% 중독 · 전파'
  },

  // ── 원거리 트리(R8) — nailgun 시작. 관통·감전·고화력으로 분기. ───────────
  nailgun: {
    id: 'nailgun',
    name: '네일건',
    tier: '원거리 · T1',
    atkBonus: 5,
    cooldown: 600,
    requires: null,
    cost: { rusty_screws: 4, scrap_metal_plate: 2 },
    mechanic: { type: 'pierce', falloff: 0.45 },
    attrTag: 'PIERCE',
    ability: '연사 못 관통 ×0.45'
  },
  emp_railgun: {
    id: 'emp_railgun',
    name: 'EMP 레일건',
    tier: '원거리 · T2',
    atkBonus: 15,
    cooldown: 900,
    requires: 'nailgun',
    cost: { copper_wire_coil: 4, old_battery_cell: 2, broken_circuit_board: 1 },
    mechanic: { type: 'shock', chance: 0.35, slowMult: 0.5, cdMult: 1.67, durationMs: 700 },
    attrTag: 'SHOCK',
    ability: '히트 35% 감전(감속)'
  },
  scrap_mortar: {
    id: 'scrap_mortar',
    name: '고철 박격포',
    tier: '원거리 · T2',
    atkBonus: 22,
    cooldown: 1300,
    requires: 'nailgun',
    cost: { scrap_metal_plate: 4, small_fuel_canister: 3, old_battery_cell: 2 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '고철 박격 · 고화력 직격'
  },

  // ── 설치 트리(R8) — barbed_wire_trap 시작. 감전·물리 포탑으로 분기. ───────
  barbed_wire_trap: {
    id: 'barbed_wire_trap',
    name: '가시철망',
    tier: '설치 · T1',
    atkBonus: 4,
    cooldown: 1000,
    requires: null,
    cost: { rusty_screws: 5, scrap_metal_plate: 2 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '가시철망 · 근접 견제'
  },
  shock_cable: {
    id: 'shock_cable',
    name: '감전 케이블',
    tier: '설치 · T2',
    atkBonus: 11,
    cooldown: 950,
    requires: 'barbed_wire_trap',
    cost: { copper_wire_coil: 5, old_battery_cell: 2 },
    mechanic: { type: 'shock', chance: 0.3, slowMult: 0.5, cdMult: 1.67, durationMs: 650 },
    attrTag: 'SHOCK',
    ability: '히트 30% 감전(감속)'
  },
  trash_can_turret: {
    id: 'trash_can_turret',
    name: '고철 포탑',
    tier: '설치 · T2',
    atkBonus: 14,
    cooldown: 700,
    requires: 'barbed_wire_trap',
    cost: { scrap_metal_plate: 4, copper_wire_coil: 3, broken_circuit_board: 1 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '고철 포탑 · 연속 화력'
  },

  // ── 특수 트리(R8) — grappling_gun 시작. 물리 견제·고화력. ─────────────────
  grappling_gun: {
    id: 'grappling_gun',
    name: '갈고리 사출기',
    tier: '특수 · T1',
    atkBonus: 5,
    cooldown: 850,
    requires: null,
    cost: { rusty_screws: 4, copper_wire_coil: 3 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '갈고리 사출 · 견제'
  },
  gravity_disassembler: {
    id: 'gravity_disassembler',
    name: '중력 분해기',
    tier: '특수 · T2',
    atkBonus: 18,
    cooldown: 1050,
    requires: 'grappling_gun',
    cost: { old_battery_cell: 2, broken_circuit_board: 2, chemical_vial: 2 },
    mechanic: null,
    attrTag: 'PHYSICAL',
    ability: '중력 분해 · 고화력'
  }
};

// 합성 탭 무기 슬롯 표시 순서 — 18종 전체(라인별 그룹핑). HubScene이 스크롤 리스트로 그림.
//   L1 근접 6 · L2 투척 4 · L3 원거리 3 · L4 설치 3 · L5 특수 2.
export const WEAPON_ORDER = [
  // L1 근접
  'pipe_wrench',
  'saw_blade_stick',
  'electric_shock_wrench',
  'rotary_saw_shield',
  'plasma_shredder',
  'death_windmill',
  // L2 투척
  'molotov',
  'poison_gas_canister',
  'pipe_bomber',
  'bio_bomb',
  // L3 원거리
  'nailgun',
  'emp_railgun',
  'scrap_mortar',
  // L4 설치
  'barbed_wire_trap',
  'shock_cable',
  'trash_can_turret',
  // L5 특수
  'grappling_gun',
  'gravity_disassembler'
];

// ── 무기 강화 (런 스코프) ──────────────────────────────────────────────
// 제작=해금 이후, 같은 레시피 재료를 점점 많이 써서 Lv1~5까지 강화. 레벨당 +6 atk(체감 의미화).
// 강화 레벨은 GameState.weaponLevels(런 한정)에 저장 → 사망 시 리셋.
//   ENHANCE_BASE_COST — cost가 빈 무기(pipe_wrench 등)의 강화 비용 폴백 재료.
export const ENHANCE_MAX_LEVEL = 5;
// 비용 곡선: 선형(×레벨×0.5)은 후반이 너무 싸 의미가 없었다 → 지수 곡선으로 교체.
//   mult = BASE_MULT × EXP^(targetLevel-1) → Lv1=원가×1.0, Lv5=원가×~6.5.
export const ENHANCE_COST_BASE_MULT = 1.0;
export const ENHANCE_COST_EXP = 1.6;
export const ENHANCE_ATK_PER_LEVEL = 6;
export const ENHANCE_BASE_COST = { pipe_wrench: { rusty_screws: 3 } }; // cost 빈 무기 폴백

// 강화 비용 — targetLevel = 도달할 레벨(Lv0→1이면 1). 레시피 cost(없으면 폴백)에 지수 배율을 곱해 올림.
export function enhanceCost(weaponId, targetLevel) {
  const recipe = WEAPON_RECIPES[weaponId];
  const base = Object.keys(recipe.cost || {}).length > 0 ? recipe.cost : (ENHANCE_BASE_COST[weaponId] || {});
  const mult = ENHANCE_COST_BASE_MULT * Math.pow(ENHANCE_COST_EXP, targetLevel - 1);
  const out = {};
  for (const [mat, qty] of Object.entries(base)) out[mat] = Math.ceil(qty * mult);
  return out;
}

// 무기 DPS — "뭐가 센지" 한눈에 보여주기 위한 단일 출처(합성 탭/HUD 공용).
//   total = 플레이어 atk + 무기 atkBonus + 강화레벨×ATK_PER_LEVEL. 쿨다운(ms)으로 초당 환산.
//   weaponLevel/playerAtk는 호출부가 상황에 맞게 넘긴다(미보유=Lv0, 보유=현재 레벨).
export function getWeaponDPS(weaponId, weaponLevel, playerAtk) {
  const recipe = WEAPON_RECIPES[weaponId];
  if (!recipe) return 0;
  const total = (playerAtk || 0) + (recipe.atkBonus || 0) + (weaponLevel || 0) * ENHANCE_ATK_PER_LEVEL;
  return Math.round((total / (recipe.cooldown / 1000)) * 10) / 10;
}
