// 적 처치 드롭 테이블 (R7 — 실제 재료 + 코인, ideator 스펙). 한 곳에서 밸런싱.
// 각 항목: { res, min, max, chance }
//   res    — 'coins' | 재료 키(materials.js MATERIAL_ORDER 중 하나)
//   chance — 0~1, 이 항목이 드롭될 확률. 통과 시 min~max 균등 정수.
// 텍스처 키(=적 타입 키)로 인덱싱 → constants/combat.js ENEMY_TYPES와 1:1.
//
// Phase 2 — 지역별 차등 드롭: rollDrop(typeKey, regionId)이 각 재료 chance에
// REGION_DROP_MULT[region][res]를 곱한다(coins는 배율 제외, 항상 확정). 페트병 추가.

import { REGION_DROP_MULT } from './regions.js';

export const DROP_TABLES = {
  sludge_zombie: [
    { res: 'coins', min: 4, max: 7, chance: 1 },
    { res: 'plastic_bottle', min: 1, max: 2, chance: 0.6 },
    { res: 'rusty_screws', min: 1, max: 2, chance: 0.85 },
    { res: 'copper_wire_coil', min: 1, max: 1, chance: 0.55 },
    { res: 'old_battery_cell', min: 1, max: 1, chance: 0.15 }
  ],
  flanker_zombie: [
    { res: 'coins', min: 2, max: 4, chance: 1 },
    { res: 'plastic_bottle', min: 1, max: 1, chance: 0.45 },
    { res: 'rusty_screws', min: 1, max: 1, chance: 0.65 },
    { res: 'small_fuel_canister', min: 1, max: 1, chance: 0.3 },
    { res: 'copper_wire_coil', min: 1, max: 1, chance: 0.12 }
  ],
  // 탱크 뮤턴트 — 희소·단단한 만큼 보상 두둑(코인/고철판 확정 + 회로기판 후함).
  // 페트병은 추가 안 함(잡몹 흔한 재료라 탱크 보상 톤과 안 맞음 — ideator 스펙).
  tank_mutant: [
    { res: 'coins', min: 10, max: 16, chance: 1 },
    { res: 'scrap_metal_plate', min: 2, max: 3, chance: 1 },
    { res: 'rusty_screws', min: 2, max: 2, chance: 0.8 },
    { res: 'broken_circuit_board', min: 1, max: 1, chance: 0.4 },
    { res: 'old_battery_cell', min: 1, max: 1, chance: 0.2 }
  ],
  // 그래버 — 느리고 단단한 속박형(PHYSICAL). 보상은 잡몹 상위 톤(나사/구리선 후함 + 배터리 가끔).
  grabber: [
    { res: 'coins', min: 6, max: 10, chance: 1 },
    { res: 'rusty_screws', min: 1, max: 2, chance: 0.8 },
    { res: 'copper_wire_coil', min: 1, max: 1, chance: 0.5 },
    { res: 'scrap_metal_plate', min: 1, max: 1, chance: 0.35 },
    { res: 'old_battery_cell', min: 1, max: 1, chance: 0.18 }
  ],
  // 부패체 — 화학 약품병 주력 공급원(투척 트리 재료).
  putrifier: [
    { res: 'coins', min: 5, max: 9, chance: 1 },
    { res: 'plastic_bottle', min: 1, max: 1, chance: 0.3 },
    { res: 'chemical_vial', min: 1, max: 2, chance: 0.65 },
    { res: 'small_fuel_canister', min: 1, max: 1, chance: 0.55 },
    { res: 'scrap_metal_plate', min: 1, max: 1, chance: 0.3 },
    { res: 'rusty_screws', min: 1, max: 1, chance: 0.35 }
  ]

  // ── 확장 자리(다음 라운드 적 추가 시 채움) ──────────────────────────
};

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 한 마리 처치 드롭을 굴려 합산 결과 반환. coins는 항상 키 존재, 재료는 떨어진 것만 동적 누산.
// regionId — 지역별 배율 적용(REGION_DROP_MULT). coins는 배율 제외(항상 확정).
// 재료 chance는 배율 곱 후 [0, 0.95]로 clamp(완전 0/확정 방지로 밸런스 보호).
export function rollDrop(typeKey, regionId = 'downtown') {
  const table = DROP_TABLES[typeKey];
  const out = { coins: 0 };
  if (!table) return out;
  const mult = REGION_DROP_MULT[regionId] || null;
  for (const { res, min, max, chance } of table) {
    let p = chance;
    if (res !== 'coins' && mult) p = clamp(chance * (mult[res] ?? 1.0), 0, 0.95);
    if (Math.random() > p) continue;
    const n = randInt(min, max);
    if (n > 0) out[res] = (out[res] || 0) + n;
  }
  return out;
}
