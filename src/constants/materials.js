// 실제 재료 7종 (R7 — 추상 파츠 SCRAP/ELEC/POWDER를 대체).
// ideator 데이터: 드롭(drops.js)·레시피(crafting.js)·유산(meta.js)이 모두 이 키를 쓴다.
//   key      — GameState.materials 의 키(= 드롭/레시피 식별자, 파일명과 동일)
//   name     — 한글 표시명(라벨/토스트/인벤)
//   iconKey  — Phaser 텍스처 키. assets/ai-generated/items/materials/web/<key>.webp
//   grade    — 희소도(1 흔함 ~ 3 희귀). 토스트 스팸 억제·표시 톤에 사용.
export const MATERIAL_META = {
  // 페트병 — 도심 폐허 주력 흔한 재료(지역별 차등 드롭의 진입 재료). grade 1.
  plastic_bottle: { key: 'plastic_bottle', name: '페트병', iconKey: 'mat-plastic-bottle', grade: 1 },
  rusty_screws: { key: 'rusty_screws', name: '녹슨 나사', iconKey: 'mat-rusty-screws', grade: 1 },
  copper_wire_coil: { key: 'copper_wire_coil', name: '구리선 코일', iconKey: 'mat-copper-wire-coil', grade: 1 },
  small_fuel_canister: { key: 'small_fuel_canister', name: '소형 연료통', iconKey: 'mat-small-fuel-canister', grade: 2 },
  scrap_metal_plate: { key: 'scrap_metal_plate', name: '고철판', iconKey: 'mat-scrap-metal-plate', grade: 1 },
  old_battery_cell: { key: 'old_battery_cell', name: '낡은 배터리', iconKey: 'mat-old-battery-cell', grade: 2 },
  chemical_vial: { key: 'chemical_vial', name: '화학 약품병', iconKey: 'mat-chemical-vial', grade: 3 },
  broken_circuit_board: { key: 'broken_circuit_board', name: '파손 회로기판', iconKey: 'mat-broken-circuit-board', grade: 3 }
};

// 표시/순회 순서 — 인벤 리스트·재료 dict 순회의 단일 기준.
export const MATERIAL_ORDER = [
  'plastic_bottle',
  'rusty_screws',
  'copper_wire_coil',
  'small_fuel_canister',
  'scrap_metal_plate',
  'old_battery_cell',
  'chemical_vial',
  'broken_circuit_board'
];

// 텍스처 없을 때(아이콘 로드 전) 폴백 색칩용 — 등급별 톤.
export const GRADE_COLOR = { 1: 0x8a6a3a, 2: 0x4f9ad6, 3: 0xb766e0 };

// 0으로 채운 재료 dict(공유 참조 사고 방지 위해 매번 새 객체).
export function freshMaterials() {
  const m = {};
  for (const k of MATERIAL_ORDER) m[k] = 0;
  return m;
}
