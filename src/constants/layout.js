// 화면 구조 상수 — 한 곳에서 비율/좌표를 관리해 다음 단계(전투/합성)가 안전하게 얹히도록.

// 논리 해상도: 모바일 세로. Scale.FIT으로 실제 화면에 맞춰 확대/축소된다.
export const LOGICAL = { width: 360, height: 640 };

// 세로 2분할 — 전투 58% / 합성 허브 42% (기획서 "화면 구조")
export const SPLIT = { combat: 0.58, hub: 0.42 };

export const COMBAT_H = Math.round(LOGICAL.height * SPLIT.combat); // 371
export const HUB_H = LOGICAL.height - COMBAT_H; // 269

// 각 씬 카메라 뷰포트 (논리 픽셀 기준, Scale이 함께 확대)
export const COMBAT_VIEW = { x: 0, y: 0, width: LOGICAL.width, height: COMBAT_H };
export const HUB_VIEW = { x: 0, y: COMBAT_H, width: LOGICAL.width, height: HUB_H };

// 경계 픽셀 장식띠 높이
export const BORDER_H = 8;

// 패럴랙스 — web 다운스케일 사본은 720x371 동일 캔버스 오버레이.
// sourceHeight=371=COMBAT_H → tileScale=1.0 → NEAREST 1:1 샘플링으로 시머 제거.
// factor: 기획서 스크롤 속도 배율 (L1 0.1 ~ L4 1.0)
export const PARALLAX = {
  sourceWidth: 720,
  sourceHeight: 371,
  // L4(노면) 기준 텍스처 px/sec — tileScale=1.0이라 텍스처 이동량 = 화면 이동량.
  // 구 tileScale(0.42)이 사라져 체감 속도가 그대로 유지되도록 190→80으로 보정(190*0.42≈80).
  baseSpeed: 80,
  factors: { l1: 0.1, l2: 0.3, l3: 0.6, l4: 1.0 }
};

// 노면 위 캐릭터 발 위치 — 전투 뷰 높이에 대한 비율 (L4 노면 윗면). 튜닝값.
export const GROUND_LINE_RATIO = 0.72;

// 진행 단계별 스프라이트 배치 — origin을 알파 스캔으로 실측(scripts/measure-character-foot.mjs).
// 스프라이트마다 투명 패딩이 달라 발끝(originY)과 가로 중심(originX)이 제각각이라 단계별로 잡는다.
//  - footOriginY: 발끝이 프레임 세로 몇 % 지점인지 → 발끝이 groundLine·그림자·적 바닥선에 안착.
//    (이전 0.8은 발끝보다 한참 위라 발이 바닥선 아래로 28px 뚫고 내려가 "공중부양" 착시가 났음.)
//  - originX: 캐릭터 몸 중심이 프레임 가로 몇 % 지점인지 → 무기 등으로 한쪽에 패딩이 있어도
//    몸 중심이 playerX에 정확히 오게 함(stage 3·4·7·8은 0.46으로 좌측 치우침).
// 교체 시 해당 텍스처가 manifest에 로드돼 있어야 함(현재는 stage_01만 등록).
export const CHARACTER_STAGES = {
  1: { texKey: 'SCRAPPER_STAGE_01', footOriginY: 0.9582, originX: 0.4978 },
  2: { texKey: 'SCRAPPER_STAGE_02', footOriginY: 0.9603, originX: 0.498 },
  3: { texKey: 'SCRAPPER_STAGE_03', footOriginY: 0.9599, originX: 0.4615 },
  4: { texKey: 'SCRAPPER_STAGE_04', footOriginY: 0.9599, originX: 0.459 },
  5: { texKey: 'SCRAPPER_STAGE_05', footOriginY: 0.9637, originX: 0.4886 },
  6: { texKey: 'SCRAPPER_STAGE_06', footOriginY: 0.9616, originX: 0.4964 },
  7: { texKey: 'SCRAPPER_STAGE_07', footOriginY: 0.962, originX: 0.4644 },
  8: { texKey: 'SCRAPPER_STAGE_08', footOriginY: 0.9639, originX: 0.4695 }
};

// 현재 주인공 진행 단계. 시작은 "제일 구린 옷"인 1단계.
export const CURRENT_STAGE = 1;

// 캐릭터 공통 배치/스케일 + 현재 단계의 실측 origin을 합친다.
export const CHARACTER = {
  displayHeight: 175, // 화면상 텍스처 표시 높이(px). 패딩 포함이라 실제 캐릭은 더 작게 보임
  xRatio: 0.3, // 사이드스크롤 주인공 정석: 좌측 1/3
  ...CHARACTER_STAGES[CURRENT_STAGE]
};
