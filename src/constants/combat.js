// 전투 밸런싱 상수 — 한 곳에서 스폰/HP/데미지/속도를 튜닝(밸런싱 쉽게).
// 거리/속도 단위는 논리 픽셀(layout.js LOGICAL 기준). 속도는 px/sec.

// 세로 슬라이스 스폰 적 — 일반 2종 + 속박(grabber) + 화염내성(tank) + 독내성(putrifier) 5종.
export const SLICE_SPAWN_LIST = ['sludge_zombie', 'flanker_zombie', 'grabber', 'tank_mutant', 'putrifier'];

// 스폰 가중치 — 균등 대신 이 비율로 뽑아 tank/grabber를 희소화(CombatDirector.pickSpawnType).
// spawnList에 있지만 여기 없는 타입은 1로 간주.
export const SPAWN_WEIGHTS = {
  sludge_zombie: 3,
  flanker_zombie: 3,
  putrifier: 2,
  grabber: 2,
  tank_mutant: 1
};

// ── 엘리트 적 (Phase 2) ────────────────────────────────────────────────
// 일반 스폰에서 낮은 확률로 "엘리트"를 주입한다 — 별도 클래스 없이 Enemy에 elite 플래그만.
// HP 대폭↑ + 구분 tint(amber) + 살짝 큰 스케일 + 처치 코인 보너스. behavior는 적 native 유지.
export const ELITE = {
  minWave: 4,      // 이 웨이브부터 엘리트 등장(초반 난이도 보호)
  chance: 0.1,     // 일반 스폰당 엘리트 승격 확률
  hpMult: 2.2,     // 엘리트 추가 HP 배율(웨이브 hpMult에 곱연산)
  scale: 1.18,     // 스프라이트/표시높이 배율(작은 화면에서 한눈에 큰 적)
  coinMult: 1.5,   // 처치 코인 배율
  coinBonus: 10    // 처치 코인 가산(배율 후)
};

// 주인공 — 능력치(maxHP/atk/def)와 장착 무기(공격력/쿨다운/메카닉)는 이제
// GameState가 소유한다. 여기 남은 값은 무기·스탯과 무관한 "전투장 규칙" 상수.
//   maxHP/attackDamage/attackCooldown은 GameState.stats / 장착 무기에서 읽으므로 제거.
export const PLAYER = {
  attackRange: 92, // 적이 이 거리(주인공 x 기준) 안에 들면 자동 공격
  dangerThreshold: 0.25 // HP 비율 이하 → 위험 펄스
};

// ── 무기 손표시 (R7 #6) ─────────────────────────────────────────────────
// stage_01은 맨손이라 장착 무기 아이콘을 손 근처에 오버레이한다. 헤드리스라 정확한
// 손 픽셀 위치는 모르므로 추정값 — 육안 튜닝 전제로 여기 상수만 만지면 된다.
//   offsetX     — 캐릭터 몸 중심(playerX≈108) 기준 가로(+ = 전방/오른쪽). 늘어뜨린 오른팔 손 위치.
//                 28은 옆구리에 내린 손에 맞춰 몸쪽으로 붙인다(42는 손에서 떨어져 들려 보였음).
//   heightRatio — groundY(발끝)에서 위로 charDisplayH*ratio 지점이 손 높이. 0=발, 1=머리끝.
//                 idle 포즈는 팔을 내려 손이 허리~허벅지 높이라 0.40. (0.58은 어깨라 등에 뜬 듯 보였음)
//   offsetY     — 손 높이 미세 보정 px(+아래).
//   displaySize — 화면상 무기 표시 높이 px(원본 128 webp에서 스케일 산출). 48은 내린 손에 쥔 톤.
//   angle       — 무기 기울기(°). -16은 휘두름이 아니라 손에 쥐고 비스듬히 내린 자세 각도.
//   depthOffset — parallax.topDepth 기준 깊이 가산(캐릭터=+1보다 확실히 위, HUD=50+보단 아래).
export const WEAPON_HAND = {
  offsetX: 28,
  heightRatio: 0.40,
  offsetY: 2,
  displaySize: 64,
  angle: -16,
  depthOffset: 5
};

// 적 타입별 스탯. 키는 텍스처 키(=파일명)와 1:1.
// contactRange: 주인공에게 이 거리까지 접근하면 멈추고 근접 공격 시작.
export const ENEMY_TYPES = {
  sludge_zombie: {
    maxHP: 60,
    speed: 34,
    damage: 8,
    attackCooldown: 1000,
    displayHeight: 122,
    contactRange: 74,
    // 사망폭발 — 죽을 때 가까이(<90px) 있으면 점액 파열로 피해(takePlayerDamage가 방어력 감산 처리).
    behavior: { type: 'explode', blastR: 90, blastDmg: 14 }
  },
  flanker_zombie: {
    maxHP: 38,
    speed: 56,
    damage: 6,
    attackCooldown: 820,
    displayHeight: 108,
    contactRange: 66,
    // 측면포위 — 접촉 직전(66~150px)에서 단독 대시로 파고든다. lungeAttack inRange와 안 겹치게 하한=contactRange.
    behavior: { type: 'flank', dashRange: 150, dashMult: 2.2 }
  },
  grabber: {
    maxHP: 72,
    speed: 30,
    damage: 11,
    attackCooldown: 1150,
    displayHeight: 132,
    contactRange: 80,
    // 속박 — 근접 타격이 닿으면 bindMs 동안 플레이어 자동공격 봉쇄(seam B). 느리고 단단해 압박형.
    behavior: { type: 'grab', bindMs: 700 }
  },
  // 탱크 뮤턴트 — 느리고 단단한 화염내성 학습체(FIRE 채널). 스폰 가중치 최소.
  tank_mutant: {
    maxHP: 180,
    speed: 22,
    damage: 14,
    attackCooldown: 1400,
    displayHeight: 145,
    contactRange: 85,
    // 정면방어 — 관통 외 피해를 0.6배로 경감(상시, guard tint로 시각화). 화염내성과 별개의 물리 경감.
    behavior: { type: 'guard', reduce: 0.6 }
  },
  // 부패체 — 독내성 학습체(TOXIC 채널). 빠른 편, 무리지어 전파 시너지.
  // 사망 시 독웅덩이를 남긴다(poolOnDeath) — 멜리에서 잡으면 발밑에 지속 피해 존이 깔리므로
  // "접근 전에 처치"가 정답이 되는 압박형. 존 시스템은 scene이 소유(draw-once + 동시 3개 캡).
  putrifier: {
    maxHP: 90,
    speed: 28,
    damage: 10,
    attackCooldown: 950,
    displayHeight: 128,
    contactRange: 78,
    behavior: { type: 'poolOnDeath', radius: 80, dmg: 5, durationMs: 3500 }
  }
};

// 스폰 운영 — interval/maxAlive는 이제 웨이브(waveParams)가 결정한다.
// 여기 남은 값은 웨이브와 무관한 스폰장 규칙 + waveIndex 0 기본 폴백.
export const SPAWN = {
  firstDelay: 600, // 전투 시작 후 첫 스폰까지
  intervalMin: 1400, // 폴백(waveParams가 우선)
  intervalMax: 2600, // 폴백
  maxAlive: 3, // 폴백
  offRightX: 40, // 화면 우측 밖 스폰 여유 거리
  respawnDelay: 500 // 사망 후 다음 스폰 보너스 텀(웨이브 텀 외 추가 여유)
};

// ── 웨이브 에스컬레이션 (ideator 곡선) ──────────────────────────────────
// runKills가 killsPerWave마다 1씩 waveIndex를 올린다. 진행할수록 적이
// 더 단단(hpMult)·더 자주(interval↓)·더 많이(maxAlive↑) 나오고 보상도 늘어남(dropMult).
export const WAVE = {
  killsPerWave: 10
};

// 드롭 연출 — 한 처치에서 복수 재료가 동시에 떨어질 때 팝 좌표를 가로로 흩뿌리는 폭(±px).
// 자동획득 전환 후 남은 유일한 줍기 상수(구 PICKUPS에서 이관, 나머지 줍기 값은 폐기).
export const DROP = {
  spreadX: 20
};

// waveIndex(w) → 그 웨이브의 스폰/체력/보상 파라미터.
// 공식은 ideator 확정값. cap으로 후반 난이도가 발산하지 않게 묶는다.
export function waveParams(w) {
  return {
    hpMult: Math.min(2.8, 1.0 + 0.12 * Math.max(0, w - 2)),
    intervalMin: Math.max(700, 1400 - w * 40),
    intervalMax: Math.max(1100, 2600 - w * 80),
    maxAlive: Math.min(6, 3 + Math.floor(w / 4)),
    dropMult: Math.min(1.8, 1.0 + w * 0.04)
  };
}

// ── 보스 (첫 보스 wave 5, 이후 7웨이브마다 — isBossWave/BOSS_INTERVAL_WAVES) ──
// 일반 적과 같은 Enemy 인프라를 재사용한다(typeKey=보스키 + cfg.def/maxHP 주입).
// HP가 매우 높고·느리고·크다(스케일은 displayHeight로 산출 — 일반 적 108~145의 ~1.7배).
// 등장 순서: 회차 0=colossus, 1=herald, 2=colossus … (bossKeyForWave가 회차 홀짝으로 번갈아 반환).
//   reward — 처치 보상. 희귀 재료(grade≥2) 2~3종 확정 + 코인. 코인은 보스 깊이로 가산(scene).
export const BOSS_TYPES = {
  // 콜로서스 — 느리지만 압도적으로 단단·묵직한 일격. 첫 보스(웨이브 5, 회차 0).
  colossus_boss: {
    maxHP: 760,
    speed: 15,
    damage: 24,
    attackCooldown: 1700,
    displayHeight: 232, // 일반 적의 ~1.7배 — 화면을 채우는 실루엣
    contactRange: 118,
    name: '콜로서스',
    // 페이즈 — HP가 임계 아래로 떨어지면 1회씩 발동(updateBossHpBar의 _phaseIdx 가드).
    // 0.66: 방어 자세(guard) + 가속. 0.5 분노(_enrageBoss)와 공존(분노가 더 깊은 임계).
    phases: [{ atRatio: 0.66, action: 'guardUp' }],
    reward: { coins: 140, materials: { scrap_metal_plate: 3, old_battery_cell: 2, broken_circuit_board: 1 } }
  },
  // 헤럴드 — 콜로서스보다 빠르고 덜 단단하지만 잦은 타격. 두 번째 보스(웨이브 12, 회차 1).
  the_herald_boss: {
    maxHP: 600,
    speed: 23,
    damage: 19,
    attackCooldown: 1250,
    displayHeight: 216,
    contactRange: 110,
    name: '헤럴드',
    // 페이즈 — 0.66에서 일반 좀비 소환(스태거, 보스 포함 alive≤5 캡). 0.5 분노와 공존.
    phases: [{ atRatio: 0.66, action: 'summonAdds' }],
    reward: { coins: 160, materials: { chemical_vial: 2, broken_circuit_board: 2, old_battery_cell: 2 } }
  }
};

// ── 보스 등장 주기 (단일 출처) ─────────────────────────────────────────────
// 첫 보스 wave 5, 이후 7웨이브마다 → 5, 12, 19, 26, 33 …
// 보스 종류/티어는 "웨이브 번호"가 아니라 "몇 번째 보스인가"(occurrence index)로 파생한다.
export const FIRST_BOSS_WAVE = 5;
export const BOSS_INTERVAL_WAVES = 7;

// w가 보스 웨이브인가.
export function isBossWave(w) {
  return w === FIRST_BOSS_WAVE || (w > FIRST_BOSS_WAVE && (w - FIRST_BOSS_WAVE) % BOSS_INTERVAL_WAVES === 0);
}

// 0-based 보스 회차(첫 보스=0, 다음=1 …). 첫 보스 이전 웨이브엔 -1.
// 비보스 웨이브에선 "가장 최근에 등장했거나 등장할 보스" 기준으로 floor 처리.
export function bossOccurrenceIndex(w) {
  if (w < FIRST_BOSS_WAVE) return -1;
  return Math.floor((w - FIRST_BOSS_WAVE) / BOSS_INTERVAL_WAVES);
}

// 보스 등장 웨이브 → 보스 키. 회차 0=colossus, 1=herald, 2=colossus … (회차 홀짝으로 번갈아).
export function bossKeyForWave(w) {
  const i = bossOccurrenceIndex(w);
  return i % 2 === 0 ? 'colossus_boss' : 'the_herald_boss';
}

// 보스 등장 웨이브 → { key, def, tier, maxHP, damage }.
// HP는 보스 베이스에 (waveParams.hpMult + 0.6·tier)를 곱해 잡몹 강화 곡선과 결을 맞추되,
// hpMult가 캡(2.8)에 닿은 뒤에도 깊은 보스가 계속 단단해지도록 tier 가산항을 더한다.
// damage는 tier마다 +12%로 완만히(즉사 방지). tier = 보스 회차(첫 보스=0).
// ※ 첫 보스가 wave 5라 waveParams(5).hpMult가 낮아 자연히 약함(과한 HP벽 방지).
export function bossStatsForWave(w) {
  const key = bossKeyForWave(w);
  const base = BOSS_TYPES[key];
  const tier = Math.max(0, bossOccurrenceIndex(w));
  const hpMult = waveParams(w).hpMult + 0.6 * tier;
  return {
    key,
    def: base,
    tier,
    maxHP: Math.round(base.maxHP * hpMult),
    damage: Math.round(base.damage * (1 + 0.12 * tier))
  };
}

// ── 적 → 대표 속성 맵 (R5 적기억용) ─────────────────────────────────────
// 적이 어떤 속성에 내성을 학습하는지의 기준. R4선 미사용(자리만 확보).
// 현재 적 + 기획서 예정 적까지 full map으로 둬 R5에서 바로 연결.
export const ENEMY_MEMORY_MAP = {
  sludge_zombie: 'SHOCK',
  flanker_zombie: 'PHYSICAL',
  grabber: 'PHYSICAL',
  putrifier: 'TOXIC',
  tank_mutant: 'FIRE',
  drone_zombie: 'SHOCK',
  brute: 'FIRE'
};

// 전투 전용 색 (기획서 팔레트). flashHit/danger는 perf 지시대로 tint/alpha만 사용.
export const COMBAT_COLORS = {
  gold: 0xf0c040, // 코인/보상
  electric: 0xff6020, // 주황 — 데미지 숫자
  toxic: 0x20ff9a, // 독 청록 — 적 HP바
  hitTint: 0xff0000, // 피격 틴트
  danger: 0xff2a2a, // 위험 비네트 펄스
  shock: 0x66ddff, // 감전된 적 청록빛 틴트
  guard: 0x7d97c4, // 정면방어 적 강철빛 틴트 (감전 청록·DoT 색과 구분되는 푸른 금속톤)
  elite: 0xffb030, // 엘리트 적 구분 틴트 (앰버 골드 — guard 푸른톤·shock 청록과 확실히 분리)
  hazard: 0x33ff77, // 독웅덩이 존 색 (toxicGlow와 동일 형광 녹 — 청록 펄스로 읽힘)
  scrap: 0x8a6a3a,  // 스크랩 칩/토스트 배경(녹슨 철, 가독성 보정)
  burnGlow: 0xff5500,  // 화상 DoT tint 목표색 (주황-적) — setDotTint 보간 종점
  toxicGlow: 0x33ff77  // 독 DoT tint 목표색 (형광 녹) — setDotTint 보간 종점
};

// CSS 문자열 색 (텍스트용)
export const COMBAT_CSS = {
  damage: '#ff6020',
  pierce: '#66ddff', // 관통 추가타 — 감전빛 청록으로 구분
  playerHurt: '#ffd0d0',
  resisted: '#8a8a8a', // R5 적기억 내성 히트 — 무채색 회색으로 "안 통함" 신호
  burnDot: '#ff8a3a', // 화염 DoT 틱 — 직접타보다 옅은 주황(작게 표기)
  toxicDot: '#20ff9a' // 독 DoT 틱 — 청록
};

// 모션 연출 타이밍/수치 상수 — motion-engineer 전담 튜닝 영역.
// 단위: ms(시간), px(거리), 비율(0~1).
export const MOTION = {
  // ── 주인공 공격 3단계 (레트로 계단식 느낌 위해 duration을 짧게 끊음) ──
  anticipationMs: 90,       // 뒤로 당기는 예비동작 (70→90: 더 길게 당겨 와인드업 대비 강화)
  anticipationX: -9,        // 뒤로 이동 px (-2→-9: 확실히 당겨 일격 대비 만들기)
  anticipationScaleX: 0.88, // 가로 쪼그라들기 (0.90→0.88: 더 강한 스쿼시)
  anticipationScaleY: 1.10, // 세로 늘어나기 (1.07→1.10)
  lungeMs: 45,              // 돌진 — 짧고 빠를수록 임팩트↑ (55→45: 더 빠른 스냅)
  lungeX: 16,               // 앞으로 이동 px (3→16: 전진 부활, 이전 22보다 절제)
  lungeScaleX: 1.18,        // 가로 늘어나기 (스트레치 유지)
  lungeScaleY: 0.87,        // 세로 쪼그라들기
  leanAngle: 7,             // 런지 순간 캐릭터 앞으로 기울임 ° (Phaser CW=양수, 발 기준 pivot)
  recoveryMs: 120,          // 캐릭터 원위치 복귀 — chopRecoveryMs(150)보다 30ms 짧아 캐릭터가 먼저 제자리에 안착

  // ── 히트스톱 ─────────────────────────────────────────────────────────
  // director.update를 일시 중단해 이동/공격 타이밍만 순간 정지(트윈 연출은 계속 진행).
  hitStopMs: 50,            // ms. reduced-motion 시 생략.

  // ── 피격 셰이크 (계단식 감쇠 오실레이션) ──────────────────────────────
  // 각 step마다 shakeX를 직접 변경 → 레트로 8~10fps 체감.
  shakeOffsets: [8, -6, 5, -3, 2, -1, 0], // shakeX 단계 (px)
  shakeStepMs: 30,          // 각 단계 간격 ms
  shakeYAmplitude: 4,       // 피격 순간 shakeY 진폭 px

  // ── 사망 포물선 넉백 ──────────────────────────────────────────────────
  deathRightX: 50,          // 넉백 가로 거리 px
  deathAngle: 26,           // 쓰러지는 회전 각도 °
  deathUpY: 18,             // 1단계: 위로 떠오르는 높이 px
  deathUpMs: 130,           // 1단계 duration
  deathDownY: 30,           // 2단계: 아래로 추락 높이 px (startY 기준 상대)
  deathDownMs: 290,         // 2단계 duration

  // ── 스폰 페이드인 ─────────────────────────────────────────────────────
  spawnFadeMs: 240,         // alpha 0→1, containerScale 0.8→1

  // ── 이동 중 bob ───────────────────────────────────────────────────────
  bobAmplitude: 3,          // px
  bobPeriodMs: 640,         // 왕복 한 사이클 ms

  // ── 데미지 숫자 팝 ────────────────────────────────────────────────────
  dmgScaleFrom: 1.5,        // 팝 시작 스케일
  dmgPopMs: 75,             // 스케일 팝 duration
  dmgDriftX: 10,            // 최대 가로 흩뿌림 px (±)
  dmgRiseY: 30,             // 상승 높이 px
  dmgFadeDelay: 55,         // 상승 시작 딜레이 ms (팝 뒤)
  dmgFadeMs: 540,           // 상승+페이드 duration

  // ── 위험 펄스 심장박동 (빠른 수축 → 느린 이완) ───────────────────────
  dangerPulseAlphaMin: 0.07,
  dangerPulseAlphaMax: 0.62,
  dangerPulseInMs: 185,     // 수축(밝아짐) duration
  dangerPulseOutMs: 600,    // 이완(어두워짐) duration
  dangerPulseMinSpeedMult: 0.4, // HP 위기 시 최고 속도 배율 (낮을수록 빠름)

  // ── 드롭 줍기 연출 (사망 위치 → HUD 코인/스크랩 카운터로 튐) ──────────
  pickupPopMs: 160,         // 사망 위치에서 살짝 튀어오르는 단계
  pickupPopUpY: 16,         // 튀어오르는 높이 px
  pickupFlyMs: 380,         // HUD까지 빨려가는 단계
  pickupSpinDeg: 220,       // 비행 중 회전 각도(코인 감성)
  pickupSpreadX: 14,        // 동시 드롭 아이콘 가로 흩뿌림(±)

  // ── 드롭 토스트 (희귀 파츠 획득 시 중앙상단 배너) ──────────────────────
  toastInMs: 180,           // fade-in
  toastStayMs: 1400,        // 유지
  toastOutMs: 420,          // fade-out

  // ── 사망 오버레이 순차 등장 ──────────────────────────────────────────────
  deathScrimMs: 600,          // 암막 페이드인 duration
  deathTitleDelay: 400,       // 암막 기준 타이틀 등장 delay ms
  deathTitleInMs: 220,        // 타이틀 스케일인 duration
  deathTitleShakeAmp: 4,      // 타이틀 등장 후 흔들림 진폭 px
  deathSummaryDelay: 680,     // 첫 요약 항목 delay ms
  deathSummaryStagger: 90,    // 요약 항목 간 스태거 ms
  deathCardDelay: 980,        // 유산 카드 스태거 시작 delay ms
  deathCardStagger: 70,       // 카드 간 스태거 ms
  deathCardSlideY: 10,        // 카드 아래서 올라오는 초기 오프셋 px

  // ── 유산 카드 인터랙션 ─────────────────────────────────────────────────
  legacyHoverScale: 1.04,     // hover 시 container scale 목표
  legacyPulseMs: 100,         // 선택 펄스 반 사이클 ms (yoyo×repeat×2 ≈ 400ms)
  confirmPulseMs: 700,        // 확정 버튼 활성 후 alpha 펄스 half-period ms

  // ── 새 런 전환 ─────────────────────────────────────────────────────────
  resetFlashMs: 90,           // 오렌지 플래시 인 duration ms
  resetFadeInMs: 260,         // 암막색 → 전투뷰 복귀 페이드 duration ms

  // ── 사망 직전 임팩트 플래시 ────────────────────────────────────────────
  deathFlashAlpha: 0.55,      // 붉은 플래시 최대 alpha
  deathFlashMs: 100,          // 플래시 인 duration ms
  deathFlashOutMs: 180,       // 플래시 아웃 duration ms

  // ── 웨이브 배너 ────────────────────────────────────────────────────────
  waveBannerInMs: 160,        // 스케일+페이드 인 duration ms
  waveBannerStayMs: 520,      // 유지 duration ms
  waveBannerOutMs: 240,       // 스케일업+페이드 아웃 duration ms

  // ── DoT tint 맥동 (화상·독 경량 경로) ──────────────────────────────────────
  // flashHit(셰이크+9 delayedCall)과 완전 분리. tween repeat:-1 만 사용, delayedCall 0.
  // setDotTint에서 헬퍼 객체 { v:0→1 } 보간 → sprite.setTint 갱신. 누수 없음.
  dotBurnPulseMs: 380,        // 화상 tint half-period ms (Sine.inOut yoyo)
  dotToxicPulseMs: 560,       // 독 tint half-period ms

  // ── 무기 장착 플러리시 (R7 motion) ────────────────────────────────────────
  // "새 무기를 쥐었다" 체감 — 스케일 팝 + 각도 정착. reduced-motion 시 생략.
  equipScaleFrom: 0.68,       // 장착 순간 시작 스케일 (→ 1로 Back.out)
  equipAngleDelta: -14,       // 장착 순간 추가 기울기 ° (WEAPON_HAND.angle 기준 오프셋, 복귀)
  equipFlourishMs: 200,       // 스케일 팝 + 각도 복귀 duration ms

  // ── 오버헤드 찹 무기 연출 ────────────────────────────────────────────────────
  // 각도 기준: Phaser CCW=음수, CW=양수. WEAPON_HAND.angle(-16°) 는 헤드가 살짝 올라간 정지 포즈.
  //   chopWindupAngle(-108°): CCW로 크게 돌려 헤드를 머리 위-뒤로 치켜든다.
  //   chopImpactAngle(+52°):  CW로 빠르게 돌려 헤드를 아래-앞으로 내려찍는다.
  //   호(arc) = -108 → +52 = 160° 큰 스윙으로 "오버헤드" 체감.
  // chopWindupMs는 anticipationMs(70)와, chopImpactMs는 lungeMs(55)와 동기화 —
  //   캐릭터 예비동작과 무기 치켜들기가, 런지와 내려찍기가 같은 타이밍에 끝난다.
  chopWindupAngle: -108,       // 치켜든 각도 ° (CCW, 절대값; 헤드 상향)
  chopWindupOffsetY: -24,      // 치켜드는 동안 y 오프셋 px — 음수=위(손 올라감 강조)
  chopWindupMs: 90,            // windup duration ms (= anticipationMs 90, 동기)
  chopImpactAngle: 52,         // 내려찍기 각도 ° (CW, 절대값; 헤드 하향)
  chopImpactOffsetY: 5,        // 임팩트 y 오프셋 px — 살짝 아래로(충격 진동감)
  chopImpactMs: 45,            // 내려찍기 duration ms (= lungeMs 45, 동기) / Expo.in 가속
  chopRecoveryMs: 150,         // 무기 각도/offsetY 복귀 — recoveryMs(120)보다 30ms 더 길어 캐릭터가 먼저 안착하고 무기가 살짝 뒤따라 내려오는 "여운" 의도(동기화 원하면 120으로 통일)
  // ── 임팩트 보강 ──────────────────────────────────────────────────────────
  chopShakeIntensity: 0.0045,  // cameras.main.shake 강도 (0.0035→0.0045: 임팩트 강화)
  chopShakeMs: 70,             // 셰이크 duration ms

  // ── 임팩트 VFX — 슬래시(검격 호)·스파크·적 넉백 ────────────────────────────
  // motionOk=true 전용. 무기 내려찍기(chopImpactAngle) 완료와 동시 발생 — 데미지 apply 직후.
  // depth: parallax.topDepth+3 (캐릭터+1 · 적+1 위, 무기+5 아래).
  slashOuterR: 32,      // 슬래시 외호 반지름 px (22→32: 더 크고 또렷하게 — 공격 초점을 슬래시로)
  slashInnerR: 18,      // 슬래시 내호(색 선) 반지름 px (12→18)
  slashStartDeg: -100,  // 슬래시 호 시작 각도 ° — chopWindupAngle 방향과 정렬(위-뒤)
  slashEndDeg: 48,      // 슬래시 호 끝 각도 ° — chopImpactAngle 방향(아래-앞)
  slashDurationMs: 190, // 슬래시 페이드아웃 duration ms (150→190: 잔상 여유 확보)
  slashScaleTo: 2.1,    // 슬래시 스케일업 목표 (1.75→2.1: 더 크게 확산)
  sparkCount: 7,        // 방사형 스파크 선 개수 (5→7: 밀도 강화)
  sparkDurationMs: 110, // 스파크 페이드아웃 duration ms
  knockbackPx: 8,       // 피격 적 넉백 거리 px (플레이어 반대 방향 = 우측)
  knockbackMs: 80,      // 넉백 1방향 duration ms (yoyo=true로 왕복 후 원위치)
  weaponThrustPx: 9,    // 임팩트 순간 무기를 적 방향으로 내지르는 X 오프셋 px
  // 내지르기 복귀 duration은 별도 상수 없이 chopRecoveryMs를 공유한다(무기 angle/offsetY 복귀와 동기).

  // ── 재료 줍기 팝 강화 (R7 motion) ───────────────────────────────────────
  // 기존 상승+페이드에 스케일 팝 + 포물선 X 드리프트 추가.
  matPopScaleFrom: 0.4,       // 팝 시작 스케일 ({ from, to }로 delay 후 점프)
  matPopScaleMs: 130,         // 스케일 팝 duration ms (상승과 오버랩 의도)
  matPopArcX: 10,             // 상승 중 포물선 X 드리프트 px (± 랜덤)

  // ── 재료 탭 획득 → 인벤(하단 허브) 빨려가기 ──────────────────────────────
  // fromTap=true 경로: 팝 → COMBAT_H 하단 방향으로 축소+페이드. 코인의 flyPickup과
  // 톤 통일(Back/Quad.in), 목적지만 우상단 대신 하단(허브) 방향으로 차별화.
  matCollectPopMs: 80,        // 탭 위치에서 스케일 팝 duration ms (Back.out)
  matCollectFlyMs: 320,       // 인벤 방향 빨려가는 duration ms (Quad.in)

  // ── 웨이브 배너 신규 지역 입장 스케일 펄스 ─────────────────────────────────
  // 일반 웨이브 배너에서 한 단계 더 — 지역이 바뀌는 순간 임팩트 강조.
  // Back.out 착지 직후 yoyo scale 펄스. 가볍게 1회(yoyo=true, 2회 이상 X).
  waveBannerNewPulseMs: 90,   // 신규 지역 배너 착지 후 scale 펄스 반사이클 ms
};
