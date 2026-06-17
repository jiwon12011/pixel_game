// 적 처치 드롭 테이블 (ideator 스펙). 한 곳에서 밸런싱.
// 각 항목: { res, min, max, chance }
//   res    — 'coins' | 'SCRAP' | 'ELEC' | 'POWDER'
//   chance — 0~1, 이 항목이 드롭될 확률. 통과 시 min~max 균등 정수.
// 텍스처 키(=적 타입 키)로 인덱싱 → constants/combat.js ENEMY_TYPES와 1:1.

export const DROP_TABLES = {
  sludge_zombie: [
    { res: 'coins', min: 4, max: 7, chance: 1 },
    { res: 'SCRAP', min: 1, max: 3, chance: 1 },
    { res: 'ELEC', min: 1, max: 1, chance: 0.25 }
    // POWDER 0
  ],
  flanker_zombie: [
    { res: 'coins', min: 2, max: 4, chance: 1 },
    { res: 'SCRAP', min: 0, max: 1, chance: 0.6 },
    { res: 'ELEC', min: 1, max: 1, chance: 0.08 },
    { res: 'POWDER', min: 1, max: 1, chance: 0.18 }
  ]

  // ── 확장 자리(다음 라운드 적 추가 시 채움) ──────────────────────────
  // grabber:      [{ res:'ELEC',   min:2, max:2, chance:0.30 }, ...]
  // putrifier:    [{ res:'POWDER', min:2, max:2, chance:0.35 }, ...]
  // drone_zombie: [{ res:'ELEC',   min:3, max:3, chance:0.60 }, ...]
};

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// 한 마리 처치 드롭을 굴려 합산 결과 반환. 0인 자원은 키만 없거나 0.
export function rollDrop(typeKey) {
  const table = DROP_TABLES[typeKey];
  const out = { coins: 0, SCRAP: 0, ELEC: 0, POWDER: 0 };
  if (!table) return out;
  for (const { res, min, max, chance } of table) {
    if (Math.random() > chance) continue;
    const n = randInt(min, max);
    if (n > 0) out[res] += n;
  }
  return out;
}
