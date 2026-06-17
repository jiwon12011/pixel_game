// 터치 줍기(Phase 1) 튜닝 상수 — 한 곳에서 줍기 윈도우/경고/드리프트/탭 크기를 만진다.
// 재료는 자동 가산이 아니라 화면에 떨어진 PickupItem을 탭해야 획득(코인은 여전히 자동).
// 단위: ms(시간), px(거리·논리픽셀). PickupItem/CombatScene이 이 값만 읽는다.
export const PICKUPS = {
  // ── 수명/경고 ──────────────────────────────────────────────────────────
  windowMs: 5000,        // 스폰 후 이 시간 지나면 만료 소멸(획득 실패)
  warnAtMs: 1200,        // 만료 이 시간 전부터 경고(빨간 깜빡임) 시작

  // ── 경고 2단계 가속 깜빡임 (warnAtMs 내 정합) ──────────────────────────
  // 느린 단계: warnSlowBlinks × warnSlowPeriod = 2 × 300 = 600ms
  // 빠른 단계: warnFastBlinks × warnFastPeriod = 3 × 180 = 540ms
  // 페이드:   warnFadeMs = 60ms  →  합계 1200ms = warnAtMs ✓
  warnSlowBlinks: 2,         // 1단계(보통) 깜빡임 횟수
  warnSlowPeriod: 300,       // 1단계 1사이클 ms
  warnFastBlinks: 3,         // 2단계(빠른) 깜빡임 횟수 — 다급함 점증
  warnFastPeriod: 180,       // 2단계 1사이클 ms
  warnFadeMs: 60,            // 최종 소멸 페이드 duration ms

  // ── 세계에 얹힌 좌측 드리프트 ────────────────────────────────────────────
  // 배경 L4(노면) 속도와 동기 — layout.js PARALLAX.baseSpeed*factor.l4 = 80px/sec.
  // 같은 속도로 좌로 흘러 "땅에 떨어진 물건이 같이 지나간다" 체감을 준다.
  driftSpeed: 80,        // px/sec, 좌측(x 감소)
  despawnX: -20,         // 이 논리 x 미만이면 화면 이탈 소멸(손실)

  // ── 배치 ────────────────────────────────────────────────────────────────
  groundOffsetY: -8,     // groundY 기준 세로 보정(+아래) — 살짝 위에 안착
  spreadX: 20,           // 복수 동시 드롭 가로 흩뿌림(±)
  popUpY: 10,            // 스폰 시 살짝 튀어오르는 높이 px

  // ── 탭/표시 ──────────────────────────────────────────────────────────────
  tapRadius: 26,         // setInteractive 원형 히트 반경(손가락 친화)
  iconSize: 24,          // 아이콘 표시 높이 px

  // ── 화면 과밀 방지 ────────────────────────────────────────────────────────
  maxOnScreen: 6,        // 이 수 초과로 새로 떨어지면 초과분은 자동 수집(탭 불필요)

  // ── 스폰 바운스/스쿼시 착지 (motion-engineer) ─────────────────────────────
  // 낙하(Quad.in 중력감) → 착지 스쿼시 스냅 → 탄성 복귀(Back.out) 체인.
  // 총 spawnFallMs + spawnSettleMs ≈ 220ms. 여러 개 동시 드롭은 spawnStaggerMs로 산포.
  spawnFallMs: 110,          // 낙하 duration ms (Quad.in)
  spawnSquashX: 1.2,         // 착지 스쿼시: 가로 펼침 배율
  spawnSquashY: 0.75,        // 착지 스쿼시: 세로 찌그러짐 배율
  spawnSettleMs: 110,        // 탄성 복귀 duration ms (Back.out)
  spawnStaggerMs: 70,        // 다수 동시 드롭 스태거 간격 ms

  // ── 유휴 어포던스: 탭 기다리는 동안 살아있는 느낌 ───────────────────────────
  // 스폰 안착 후 시작되는 은은한 y bob — "주울 수 있다" 신호. 과하지 않게(2px).
  idleBobY: 2,               // bob 진폭 px
  idleBobMs: 880,            // bob 반사이클 ms (Sine.inOut yoyo, repeat:-1)

  // ── 탭 획득 스케일 펀치 ───────────────────────────────────────────────────
  // 탭 순간 scale 팽창 → 0 수렴 → destroy. 총 93ms. 게임 로직은 즉시 실행.
  collectPunchScale: 1.4,    // 펀치 최대 배율
  collectPunchOutMs: 28,     // 팽창 duration ms (Quad.out)
  collectPunchInMs: 65,      // 수축+페이드 duration ms (Quad.in)
};
