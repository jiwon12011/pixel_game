// 지역(Phase 2) — 웨이브 진행에 따라 파생되는 폐허 구역. 상태로 저장하지 않고
// waveIndex에서 매번 파생한다(getRegion). 지역마다 재료 드롭 배율이 달라(REGION_DROP_MULT)
// "어디서 싸우느냐"에 따라 같은 적이라도 나오는 자원이 달라진다(수집 동선/지역색).
//
// 데이터는 ideator 확정표. 배율은 drops.js rollDrop에서 각 재료 chance에 곱해진다(coins 제외).

// 지역 정의 — id, 표시명, 시작 웨이브(startWave 오름차순). getRegion이 이 순서를 역순회.
export const REGIONS = [
  { id: 'downtown', name: '도심 폐허', startWave: 0 },
  { id: 'highway', name: '고속도로 잔해', startWave: 5 },
  { id: 'factory', name: '공장지대', startWave: 10 },
  { id: 'sewer', name: '하수도', startWave: 15 }
];

// 빠른 id→지역 룩업(표시명 등).
export const REGION_BY_ID = REGIONS.reduce((m, r) => {
  m[r.id] = r;
  return m;
}, {});

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
  }
};
