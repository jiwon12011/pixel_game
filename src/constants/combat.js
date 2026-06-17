// 전투 밸런싱 상수 — 한 곳에서 스폰/HP/데미지/속도를 튜닝(밸런싱 쉽게).
// 거리/속도 단위는 논리 픽셀(layout.js LOGICAL 기준). 속도는 px/sec.

// 세로 슬라이스 스폰 적 — 가벼운 일반 적 2종으로 시작.
export const SLICE_SPAWN_LIST = ['sludge_zombie', 'flanker_zombie'];

// 주인공 — 능력치(maxHP/atk/def)와 장착 무기(공격력/쿨다운/메카닉)는 이제
// GameState가 소유한다. 여기 남은 값은 무기·스탯과 무관한 "전투장 규칙" 상수.
//   maxHP/attackDamage/attackCooldown은 GameState.stats / 장착 무기에서 읽으므로 제거.
export const PLAYER = {
  attackRange: 92, // 적이 이 거리(주인공 x 기준) 안에 들면 자동 공격
  dangerThreshold: 0.25 // HP 비율 이하 → 위험 펄스
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
    contactRange: 74
  },
  flanker_zombie: {
    maxHP: 38,
    speed: 56,
    damage: 6,
    attackCooldown: 820,
    displayHeight: 108,
    contactRange: 66
  },
  grabber: {
    maxHP: 72,
    speed: 30,
    damage: 11,
    attackCooldown: 1150,
    displayHeight: 132,
    contactRange: 80
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

// ── 적 → 대표 속성 맵 (R5 적기억용) ─────────────────────────────────────
// 적이 어떤 속성에 내성을 학습하는지의 기준. R4선 미사용(자리만 확보).
// 현재 적 + 기획서 예정 적까지 full map으로 둬 R5에서 바로 연결.
export const ENEMY_MEMORY_MAP = {
  sludge_zombie: 'SHOCK',
  flanker_zombie: 'PHYSICAL',
  grabber: 'PHYSICAL',
  putrifier: 'TOXIC',
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
  scrap: 0x8a6a3a // 스크랩 칩/토스트 배경(녹슨 철, 가독성 보정)
};

// CSS 문자열 색 (텍스트용)
export const COMBAT_CSS = {
  damage: '#ff6020',
  pierce: '#66ddff', // 관통 추가타 — 감전빛 청록으로 구분
  playerHurt: '#ffd0d0',
  resisted: '#8a8a8a' // R5 적기억 내성 히트 — 무채색 회색으로 "안 통함" 신호
};

// 모션 연출 타이밍/수치 상수 — motion-engineer 전담 튜닝 영역.
// 단위: ms(시간), px(거리), 비율(0~1).
export const MOTION = {
  // ── 주인공 공격 3단계 (레트로 계단식 느낌 위해 duration을 짧게 끊음) ──
  anticipationMs: 70,       // 뒤로 당기는 예비동작
  anticipationX: -5,        // 뒤로 이동 px
  anticipationScaleX: 0.90, // 가로 쪼그라들기
  anticipationScaleY: 1.07, // 세로 늘어나기
  lungeMs: 55,              // 돌진 — 짧고 빠를수록 임팩트↑
  lungeX: 22,               // 앞으로 이동 px
  lungeScaleX: 1.14,        // 가로 늘어나기 (스트레치)
  lungeScaleY: 0.87,        // 세로 쪼그라들기
  recoveryMs: 120,          // 원위치 복귀

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
};
