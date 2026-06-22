// 지역(Phase 2) — 웨이브 진행에 따라 파생되는 폐허 구역. 상태로 저장하지 않고
// waveIndex에서 매번 파생한다(getRegion). 지역마다 재료 드롭 배율이 달라(REGION_DROP_MULT)
// "어디서 싸우느냐"에 따라 같은 적이라도 나오는 자원이 달라진다(수집 동선/지역색).
//
// 데이터는 ideator 확정표. 배율은 drops.js rollDrop에서 각 재료 chance에 곱해진다(coins 제외).

// 지역 정의 — id, 표시명, 시작 웨이브(startWave 오름차순). getRegion이 이 순서를 역순회.
//
// combatBonus(선택) — 지역 테마에 맞는 무기 속성 데미지 배율. 무기 attrTag(FIRE/TOXIC/SHOCK…)와
// 매칭되는 채널만 곱연산으로 적용(사투 ×1.4·강화 배율과 자연 합산). 테마 분명한 지역에만 부여하고
// 나머지는 필드 자체를 생략(getRegionCombatBonus가 1.0 폴백). 과하지 않게 1.25~1.45 범위.
//   · 연료/고온 잔해 → FIRE   · 오염/약품 지대 → TOXIC   · 전기 설비 → SHOCK
export const REGIONS = [
  { id: 'downtown', name: '도심 폐허', startWave: 0 },
  // 고속도로 — 버려진 차량/연료통이 즐비. 화염 무기가 인화물을 잘 터뜨린다.
  { id: 'highway', name: '고속도로 잔해', startWave: 5, combatBonus: { FIRE: 1.25 } },
  // 공장지대 — 노출된 배선/금속 골조. 감전이 잘 먹힌다.
  { id: 'factory', name: '공장지대', startWave: 10, combatBonus: { SHOCK: 1.3 } },
  // 하수도 — 고인 오수. 독이 퍼지기 좋다.
  // groundOffsetY: 이 지역 배경의 통로(바닥선)가 공통 groundY보다 낮아, 캐릭터/적을
  // 살짝 아래로 내려(+down) 통로 위에 서게 보정한다(다른 지역은 0 = 보정 없음).
  { id: 'sewer', name: '하수도', startWave: 15, combatBonus: { TOXIC: 1.3 }, groundOffsetY: 14 },
  // 심층 지역 — wave 20+. 깊이질수록 희귀 재료 비중↑(REGION_DROP_MULT 참고).
  { id: 'bunker', name: '지하 벙커', startWave: 20 },
  // 폐병원 — 약품/체액 잔류. 독성 강화.
  { id: 'hospital', name: '폐병원 안뜰', startWave: 25, combatBonus: { TOXIC: 1.28 } },
  // 손상된 발전소 — 누전·고압. 감전 최고 효율.
  { id: 'powerplant', name: '손상된 발전소', startWave: 30, combatBonus: { SHOCK: 1.45 } },
  // 독성 늪 — 전역 오염. 독 최고 효율.
  { id: 'swamp', name: '독성 늪 외곽', startWave: 35, combatBonus: { TOXIC: 1.4 } },
  // 매립지 — 메탄/인화성 폐기물. 화염 강화.
  { id: 'landfill', name: '매립지 분화구', startWave: 40, combatBonus: { FIRE: 1.35 } },
  { id: 'checkpoint', name: '격리 검문소 폐허', startWave: 45 }
];

// 빠른 id→지역 룩업(표시명 등).
export const REGION_BY_ID = REGIONS.reduce((m, r) => {
  m[r.id] = r;
  return m;
}, {});

// 지역×무기속성 전투 배율. 매칭 없으면 1.0(보너스 없는 지역/속성). 핫패스에서 호출되니 가볍게.
//   regionId — getRegion(...).id   attrTag — 무기/DoT 속성('FIRE'|'TOXIC'|'SHOCK'|...).
export function getRegionCombatBonus(regionId, attrTag) {
  if (!attrTag) return 1;
  const b = REGION_BY_ID[regionId]?.combatBonus;
  return (b && b[attrTag]) || 1;
}

// waveIndex → 지역 객체. startWave 내림차순으로 첫 충족 구간을 고른다(상태 저장 없음).
// 핫패스 아님(웨이브 전환·처치당 1회) — 단순 선형 탐색으로 충분.
export function getRegion(waveIndex) {
  for (let i = REGIONS.length - 1; i >= 0; i--) {
    if (waveIndex >= REGIONS[i].startWave) return REGIONS[i];
  }
  return REGIONS[0];
}

// 지역×재료 드롭 배율표(ideator 표 그대로). drops.js에서 chance에 곱함.
// 누락 조합은 rollDrop에서 ??1.0 폴백 → 새 재료/지역 추가 시 안전.
export const REGION_DROP_MULT = {
  downtown: {
    plastic_bottle: 1.6,
    rusty_screws: 1.3,
    copper_wire_coil: 0.7,
    small_fuel_canister: 0.6,
    scrap_metal_plate: 0.8,
    old_battery_cell: 0.5,
    chemical_vial: 0.2,
    broken_circuit_board: 0.15
  },
  highway: {
    plastic_bottle: 1.0,
    rusty_screws: 1.1,
    copper_wire_coil: 0.9,
    small_fuel_canister: 1.6,
    scrap_metal_plate: 1.5,
    old_battery_cell: 0.7,
    chemical_vial: 0.3,
    broken_circuit_board: 0.25
  },
  factory: {
    plastic_bottle: 0.6,
    rusty_screws: 0.8,
    copper_wire_coil: 1.5,
    small_fuel_canister: 1.1,
    scrap_metal_plate: 1.1,
    old_battery_cell: 1.5,
    chemical_vial: 0.6,
    broken_circuit_board: 1.4
  },
  sewer: {
    plastic_bottle: 0.3,
    rusty_screws: 0.6,
    copper_wire_coil: 1.1,
    small_fuel_canister: 0.5,
    scrap_metal_plate: 0.7,
    old_battery_cell: 1.2,
    chemical_vial: 2.2,
    broken_circuit_board: 1.6
  },
  // 지하 벙커(20) — 군용 잔해. 전자/배터리 위주, 흔한 재료 하락.
  bunker: {
    plastic_bottle: 0.4,
    rusty_screws: 0.7,
    copper_wire_coil: 1.2,
    small_fuel_canister: 0.7,
    scrap_metal_plate: 1.0,
    old_battery_cell: 1.6,
    chemical_vial: 1.4,
    broken_circuit_board: 1.9
  },
  // 폐병원 안뜰(25) — 의료 약품. 화학병 급등.
  hospital: {
    plastic_bottle: 0.4,
    rusty_screws: 0.6,
    copper_wire_coil: 1.0,
    small_fuel_canister: 0.5,
    scrap_metal_plate: 0.8,
    old_battery_cell: 1.3,
    chemical_vial: 2.6,
    broken_circuit_board: 1.8
  },
  // 손상된 발전소(30) — 전기 설비. 구리/배터리/회로 전반 상승.
  powerplant: {
    plastic_bottle: 0.3,
    rusty_screws: 0.6,
    copper_wire_coil: 1.8,
    small_fuel_canister: 1.2,
    scrap_metal_plate: 1.0,
    old_battery_cell: 2.0,
    chemical_vial: 1.8,
    broken_circuit_board: 2.2
  },
  // 독성 늪 외곽(35) — 오염 지대. 화학병 최고조, 흔한 재료 바닥.
  swamp: {
    plastic_bottle: 0.3,
    rusty_screws: 0.5,
    copper_wire_coil: 1.0,
    small_fuel_canister: 0.6,
    scrap_metal_plate: 0.7,
    old_battery_cell: 1.4,
    chemical_vial: 3.0,
    broken_circuit_board: 2.0
  },
  // 매립지 분화구(40) — 폐기물 더미. 희귀 재료가 골고루 높게 묻혀 있음.
  landfill: {
    plastic_bottle: 0.3,
    rusty_screws: 0.5,
    copper_wire_coil: 1.3,
    small_fuel_canister: 0.7,
    scrap_metal_plate: 0.9,
    old_battery_cell: 1.8,
    chemical_vial: 2.4,
    broken_circuit_board: 2.4
  },
  // 격리 검문소 폐허(45+) — 최심부 종착. 모든 희귀 재료 최대.
  checkpoint: {
    plastic_bottle: 0.2,
    rusty_screws: 0.4,
    copper_wire_coil: 1.4,
    small_fuel_canister: 0.6,
    scrap_metal_plate: 0.8,
    old_battery_cell: 2.0,
    chemical_vial: 3.2,
    broken_circuit_board: 2.8
  }
};
