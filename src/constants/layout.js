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
  factors: { l1: 0.1, l2: 0.3, l3: 0.6, l4: 1.0 },
  // 노면(L3/L4 등)을 아래로 내리는 양(px). 위 빈 영역은 뒤 하늘(L1)이 채움.
  // groundY도 같은 양 내려 캐릭터가 노면에 그대로 붙어있게.
  // 값을 올리면 노면이 더 아래로 — 상단 주황 하늘이 더 넓게 보인다. 튜닝 포인트.
  groundDropY: 40
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

// 진행 단계는 더 이상 고정값이 아니다 — 런 스코프 멀티신호 powerScore로 파생.
// 부팅/맨손 시작 기준값만 1단계로 둔다(아래 CHARACTER 초기 origin). 런타임은 deriveStage가 결정.
const BASE_STAGE = 1;

// 8단계 진입 최소 powerScore. 사망 시 런 스냅샷 전부 0/1로 리셋 → stage1로 복귀.
// 기존 statPower 단일신호는 stat 합 ~3에서 천장이 막혀 후반 단계가 죽은 콘텐츠였다.
// → 웨이브/킬/무기/보스까지 합산하는 멀티신호로 8단계까지 자연 도달하게 곡선을 올린다.
export const STAGE_THRESHOLDS = [0, 4, 7, 11, 15, 20, 26, 34]; // stage1~8 진입 최소 powerScore

// 멀티신호 전투력 — 단순 stat 합을 넘어 런 진행도 전반을 점수화.
//   statPower : maxHP+atk+def 업그레이드 레벨 합(투자량)
//   waveBonus : 2웨이브당 +1(생존 깊이)
//   killBonus : 20킬당 +1(누적 전과)
//   weaponBonus: 보유 무기 수-1, 최대 +4(다양성)
//   bossBonus : 보스 처치당 +3(이정표)
export function computePowerScore({ statLevels, waveIndex, runKills, ownedWeapons, runBossKills }) {
  const statPower = (statLevels?.maxHP || 0) + (statLevels?.atk || 0) + (statLevels?.def || 0);
  const waveBonus = Math.floor((waveIndex || 0) / 2);
  const killBonus = Math.floor((runKills || 0) / 20);
  const weaponBonus = Math.min(4, Math.max(0, (ownedWeapons?.size ?? 1) - 1));
  const bossBonus = (runBossKills || 0) * 3;
  return statPower + waveBonus + killBonus + weaponBonus + bossBonus;
}

// 런 스냅샷({statLevels,waveIndex,runKills,ownedWeapons,runBossKills}) → 진행 단계(1~8).
// GameState를 그대로 넘기면 필드가 일치해 바로 동작한다. 임계값을 낮은 쪽부터 넘는 만큼 단계 상승.
export function deriveStage(runSnapshot) {
  const power = computePowerScore(runSnapshot || {});
  let stage = 1;
  for (let i = 1; i < STAGE_THRESHOLDS.length; i++) {
    if (power >= STAGE_THRESHOLDS[i]) stage = i + 1; else break;
  }
  return stage; // 1~8
}

// 캐릭터 공통 배치/스케일 + 1단계(맨손 시작) 실측 origin을 합친다.
// 단계 교체 시 CombatScene이 해당 단계의 origin/scale을 런타임에 다시 적용한다.
export const CHARACTER = {
  displayHeight: 175, // 화면상 텍스처 표시 높이(px). 패딩 포함이라 실제 캐릭은 더 작게 보임
  xRatio: 0.3, // 사이드스크롤 주인공 정석: 좌측 1/3
  ...CHARACTER_STAGES[BASE_STAGE]
};
