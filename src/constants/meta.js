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
  // 첫 플레이 온보딩 완료 플래그 — 자동공격이라 "탭=공격 가속"이 전달 안 됨.
  // false면 첫 전투에서 탭 힌트 노출, 첫 탭 성공 시 true로 영속(다신 안 뜸).
  onboarded: false,
  // R8 — 잔해 포인트(SP): 런 종료마다 적립되는 영구 화폐. 강화 보드(영구 업글)에서 소비.
  salvagePoints: 0,
  // 사망 시 적립 대기 중인 SP — 런 커밋(startNewRun) 시점에 salvagePoints로 1회 확정.
  // 적립을 사망 즉시가 아니라 다음 런 시작으로 미뤄, 사망 화면 새로고침으로 인한 SP 무한증식을 차단한다.
  pendingSp: 0,
  // 사망으로 닫힌 런 플래그 — true면 부팅 시 죽은 런을 풀피로 부활시키지 않고 base로 시작(load에서 처리).
  runClosed: false,
  // 역대 최고 도달 단계(1~8) — 사망 요약(recordRunSummary)에서 갱신, 사망 오버레이가 "역대 M" 표시.
  bestStage: 1,
  // R8 — 영구 업그레이드 보유 상태(레벨/플래그). 강화 보드가 읽고 buyPermanentUpgrade가 갱신.
  // R10 — 10종으로 확장(강화형 8 + 해금형 2). 신규 키는 loadMeta 병합으로 구 세이브에도 자동 주입.
  permanentUpgrades: {
    starting_coins: 0,
    scrap_magnet: 0,
    codex_preview: false,
    memory_flush: false,
    iron_bones: 0,
    battle_instinct: 0,
    salvage_rate: 0,
    scavenger_start: 0,
    coin_rush: 0,
    first_forge: 0
  },
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
  lastRunSummary: {
    kills: 0,
    maxWave: 0,
    coins: 0,
    stage: 1, // 직전 런 최고 도달 단계(사망 오버레이 "이번 N")
    attrKills: { PHYSICAL: 0, SHOCK: 0, PIERCE: 0, FIRE: 0, TOXIC: 0 },
    lastCraftedWeapon: null,
    spEarned: 0 // R8 — 직전 런에서 적립한 잔해 포인트(사망 오버레이 표시용)
  }
};

// ── R8 영구 업그레이드 보드 (강화 탭) ────────────────────────────────────
// 잔해 포인트(SP)로 사는 런 간 영구 강화. GameState.buyPermanentUpgrade가 이 테이블을 읽는다.
//   · costs   — 레벨별 비용 배열. 길이 = maxLevel. flag형(해금)은 길이 1.
//   · flag    — true면 boolean 해금(레벨 대신 true/false). false면 정수 레벨업.
//   · perLevel — 효과 수치 요약(UI 표시용). label/desc는 보드 행에 그대로 노출.
export const PERMANENT_UPGRADES = {
  starting_coins: {
    key: 'starting_coins',
    label: '시작 코인',
    flag: false,
    costs: [15, 35, 60, 90, 130],
    maxLevel: 5,
    chip: 0xf0c040,
    desc: (lvl) => `런 시작 코인 +${lvl * 8}` // 레벨당 +8 (최대 +40)
  },
  scrap_magnet: {
    key: 'scrap_magnet',
    label: '잔해 수집기',
    flag: false,
    costs: [20, 45, 75, 110],
    maxLevel: 4,
    chip: 0x66ddff,
    // 자동 획득 전환으로 줍기 반경이 무의미 → "재료 추가 드롭 확률"로 재해석.
    desc: (lvl) => `재료 추가 드롭 +${lvl * 25}% 확률` // 레벨당 +25% (최대 +100%)
  },
  iron_bones: {
    key: 'iron_bones',
    label: '강화 골격',
    flag: false,
    costs: [20, 45, 80, 125],
    maxLevel: 4,
    chip: 0xff4848,
    desc: (lvl) => `시작 최대 HP +${lvl * 15}` // 레벨당 +15 (최대 +60)
  },
  battle_instinct: {
    key: 'battle_instinct',
    label: '전투 본능',
    flag: false,
    costs: [30, 65, 110],
    maxLevel: 3,
    chip: 0xffa030,
    desc: (lvl) => `시작 공격력 +${lvl * 4}` // 레벨당 +4 (최대 +12)
  },
  coin_rush: {
    key: 'coin_rush',
    label: '코인 폭풍',
    flag: false,
    costs: [20, 45, 75],
    maxLevel: 3,
    chip: 0xf0d860,
    desc: (lvl) => `코인 드롭 +${lvl * 20}%` // 레벨당 +20% (최대 +60%)
  },
  scavenger_start: {
    key: 'scavenger_start',
    label: '선발굴',
    flag: false,
    costs: [25, 55, 90],
    maxLevel: 3,
    chip: 0xb766e0,
    // 레벨별 시작 랜덤 재료 개수(0,2,4,6). resetRun에서 MATERIAL_ORDER 랜덤 추첨.
    desc: (lvl) => `시작 랜덤 재료 +${[0, 2, 4, 6][lvl]}개`
  },
  salvage_rate: {
    key: 'salvage_rate',
    label: '잔해 가속',
    flag: false,
    costs: [50, 100, 160],
    maxLevel: 3,
    chip: 0x20ff9a,
    desc: (lvl) => `런 종료 SP 적립 +${lvl * 15}%` // 레벨당 +15% (최대 +45%)
  },
  first_forge: {
    key: 'first_forge',
    label: '첫 합성 할인',
    flag: false,
    costs: [35, 70],
    maxLevel: 2,
    chip: 0x4f9ad6,
    // 런 첫 합성의 재료 비용 할인(0,-30%,-50%). FIRST_FORGE_MULT와 동일 인덱스.
    desc: (lvl) => `런 첫 합성 비용 −${[0, 30, 50][lvl]}%`
  },
  codex_preview: {
    key: 'codex_preview',
    label: '도감 미리보기',
    flag: true,
    costs: [20],
    maxLevel: 1,
    chip: 0x20ff9a,
    desc: (on) => (on ? '미발견 무기 재료 힌트 ON' : '미발견 무기 재료 힌트')
  },
  memory_flush: {
    key: 'memory_flush',
    label: '기억 소거',
    flag: true,
    costs: [30],
    maxLevel: 1,
    chip: 0xff6020,
    desc: (on) => (on ? '적기억 감쇠 0.7 (강화)' : '적기억 감쇠 0.5→0.7')
  }
};

// 보드 행 순서(능력치 탭 STAT_ORDER와 같은 패턴) — 강화형 먼저, 해금형(flag) 나중.
export const PERMANENT_ORDER = [
  'starting_coins',
  'scrap_magnet',
  'iron_bones',
  'battle_instinct',
  'coin_rush',
  'scavenger_start',
  'salvage_rate',
  'first_forge',
  'codex_preview',
  'memory_flush'
];

// 레벨별 효과 수치 — 보드 desc와 GameState 적용부가 같은 테이블을 본다(불일치 방지).
//   first_forge: 런 첫 합성 재료 비용 배율(레벨 0=할인없음, 1=-30%, 2=-50%).
export const FIRST_FORGE_MULT = [1, 0.7, 0.5];
//   scavenger_start: 런 시작 시 랜덤 추첨할 재료 개수.
export const SCAVENGER_COUNT = [0, 2, 4, 6];

// memory_flush 해금 시 적용되는 감쇠 비율(기본 MEMORY_DECAY=0.5보다 약하게 = 더 잘 잊음).
export const MEMORY_DECAY_FLUSH = 0.7;

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
  // 초반 폴백(ideator): 첫 런은 무기=기본·재료/코인=0·스탯 미투자라 4장이 전부 비활성 →
  // 메타 훅이 한 번도 안 돌아 "유산을 들고 시작한다"는 핵심이 전달 안 됨.
  // → 투자 0이어도 스탯 유산은 항상 활성(폴백 maxHP Lv1). 늘 최소 1개는 들고 시작하게 보장한다.
  let bestStat = null;
  let bestLvl = 0;
  for (const [stat, lvl] of Object.entries(run.statLevels)) {
    if (lvl > bestLvl) {
      bestLvl = lvl;
      bestStat = stat;
    }
  }
  const stat = { type: 'stat', stat: bestStat || 'maxHP', enabled: true };

  return [weapon, materials, coins, stat];
}
