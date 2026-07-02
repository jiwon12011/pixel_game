// 에셋 매니페스트 — Vite URL import로 끌어와 빌드 시 해시/복사를 vite가 보장.
// (문자열 경로 로드는 빌드 dist에 안 따라오는 함정이 있어 URL import로 통일)

// 패럴랙스는 web 다운스케일 사본(720x371 webp). 원본 PNG는 보존됨.
// 재생성: npm run optimize:bg (scripts/optimize-bg.mjs)
import skyUrl from '../../assets/ai-generated/backgrounds/web/parallax_l1_sky.webp';
import factoryUrl from '../../assets/ai-generated/backgrounds/web/parallax_l2_factory.webp';
import wreckageUrl from '../../assets/ai-generated/backgrounds/web/parallax_l3_wreckage.webp';
import groundUrl from '../../assets/ai-generated/backgrounds/web/parallax_l4_ground.webp';

// 지역 변형 배경 3종 — downtown은 위 4레이어 패럴랙스, 그 외 지역은 풀커버 단일 이미지.
// 선행로드 금지(IMAGE_MANIFEST에 안 넣음) — 지역 진입 시 REGION_BG_MANIFEST로 지연 로드.
// 재생성: npm run optimize:variants (scripts/optimize-variants.mjs, height 371 비율유지 q82)
import bgHighwayUrl from '../../assets/ai-generated/backgrounds/variants/web/ruined_elevated_highway.webp';
import bgFactoryUrl from '../../assets/ai-generated/backgrounds/variants/web/ruined_factory_exterior.webp';
import bgSewerUrl from '../../assets/ai-generated/backgrounds/variants/web/flooded_sewer_channel.webp';
// 심층 지역 변형 6종(wave 20+) — 위와 동일하게 지역 진입 시 지연 로드.
import bgBunkerUrl from '../../assets/ai-generated/backgrounds/variants/web/underground_bunker_corridor.webp';
import bgHospitalUrl from '../../assets/ai-generated/backgrounds/variants/web/abandoned_hospital_courtyard.webp';
import bgPowerplantUrl from '../../assets/ai-generated/backgrounds/variants/web/damaged_power_plant_interior.webp';
import bgSwampUrl from '../../assets/ai-generated/backgrounds/variants/web/toxic_swamp_outskirts.webp';
import bgLandfillUrl from '../../assets/ai-generated/backgrounds/variants/web/landfill_crater.webp';
import bgCheckpointUrl from '../../assets/ai-generated/backgrounds/variants/web/quarantine_checkpoint_ruins.webp';

// 주인공 — 진행도 stage_01(누더기 시작 버전). 무손실 webp 사본(원본 226x478 그대로, 종횡비 유지).
// 히어로 스프라이트라 무손실로 선명도 보존. footOriginY/originX는 같은 비율이라 영향 없음.
// 재생성: npm run optimize:assets (characters 카테고리, 종횡비 유지·512px 상한·lossless)
import scrapperStage01Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_01.webp';
// 진행 2~8단계 — 선행로드 금지(IMAGE_MANIFEST엔 stage_01만). 단계 상승 시 STAGE_MANIFEST로 지연 로드.
import scrapperStage02Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_02.webp';
import scrapperStage03Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_03.webp';
import scrapperStage04Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_04.webp';
import scrapperStage05Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_05.webp';
import scrapperStage06Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_06.webp';
import scrapperStage07Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_07.webp';
import scrapperStage08Url from '../../assets/ai-generated/characters/progression/web/scrapper_stage_08.webp';

// 주인공 프레임 애니 아틀라스 8단계 — 단계당 webp 시트 1장 + Phaser JSON Hash 1장.
// 재생성: node scripts/pack-anim-atlas.mjs  (정규화된 12프레임/단계를 trimmed 아틀라스로 패킹).
// json은 ?url로 import해 load.atlas(key, pngUrl, jsonUrl)에 그대로 넘긴다(파싱 객체 아님).
// stage_01만 PreloadScene이 선행로드, 2~8은 단계 상승 시 CombatScene이 지연 로드(현재/다음만 유지).
import animStage01Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_01.webp';
import animStage01Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_01.json?url';
import animStage02Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_02.webp';
import animStage02Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_02.json?url';
import animStage03Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_03.webp';
import animStage03Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_03.json?url';
import animStage04Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_04.webp';
import animStage04Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_04.json?url';
import animStage05Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_05.webp';
import animStage05Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_05.json?url';
import animStage06Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_06.webp';
import animStage06Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_06.json?url';
import animStage07Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_07.webp';
import animStage07Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_07.json?url';
import animStage08Png from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_08.webp';
import animStage08Json from '../../assets/ai-generated/characters/animation/atlas/scrapper_stage_08.json?url';

// UI 탭 아이콘 4종 — 128px q85 webp 사본(탭바 28px 렌더라 충분). PNG 대비 ~95% 경량(초기 로드 -30%).
// 재생성: npm run optimize:assets (ui 카테고리)
import tabCraftUrl from '../../assets/ai-generated/ui/individual/web/tab_crafting.webp';
import tabSkillUrl from '../../assets/ai-generated/ui/individual/web/tab_skill.webp';
import tabStatsUrl from '../../assets/ai-generated/ui/individual/web/tab_stats.webp';
import tabInventoryUrl from '../../assets/ai-generated/ui/individual/web/tab_inventory.webp';

// 드롭 보상 아이콘 — 처치 즉시 줍기 연출에 필요하므로 선행 로드(IMAGE_MANIFEST).
// 재생성: npm run optimize:assets (items 카테고리, 128px webp)
import coinRewardUrl from '../../assets/ai-generated/items/individual/web/coin_reward.webp';
import scrapPartsUrl from '../../assets/ai-generated/items/individual/web/scrap_parts.webp';
// 허브 아이콘 — 스킬/알림. 합성·스킬 탭에서만 쓰니 지연 로드(HUB_ITEM_MANIFEST).
import skillPointUrl from '../../assets/ai-generated/items/individual/web/skill_point.webp';
import notificationBadgeUrl from '../../assets/ai-generated/items/individual/web/notification_badge.webp';

// 재료 아이콘 8종 — 전투 줍기/인벤/합성에서 모두 쓰여 선행 로드(소형 5~6KB).
// 재생성: npm run optimize:assets (materials 카테고리, 128px webp q85)
import matPlasticBottleUrl from '../../assets/ai-generated/items/materials/web/plastic_bottle.webp';
import matRustyScrewsUrl from '../../assets/ai-generated/items/materials/web/rusty_screws.webp';
import matCopperWireCoilUrl from '../../assets/ai-generated/items/materials/web/copper_wire_coil.webp';
import matSmallFuelCanisterUrl from '../../assets/ai-generated/items/materials/web/small_fuel_canister.webp';
import matScrapMetalPlateUrl from '../../assets/ai-generated/items/materials/web/scrap_metal_plate.webp';
import matOldBatteryCellUrl from '../../assets/ai-generated/items/materials/web/old_battery_cell.webp';
import matChemicalVialUrl from '../../assets/ai-generated/items/materials/web/chemical_vial.webp';
import matBrokenCircuitBoardUrl from '../../assets/ai-generated/items/materials/web/broken_circuit_board.webp';
// 설정 버튼 아이콘 — 재료 아트와 동일 파이프라인의 녹슨 톱니(재료로는 미사용, UI 전용 재활용).
import gearFragmentUrl from '../../assets/ai-generated/items/materials/web/gear_fragment.webp';

// 무기 아이콘 18종 — 합성 탭 첫 진입 시 지연 로드(WEAPON_MANIFEST). 키 = 무기 id(파일명).
// 재생성: npm run optimize:assets (weapons 카테고리, 128px webp, lossless:false q85)
import pipeWrenchUrl from '../../assets/ai-generated/weapons/individual/web/pipe_wrench.webp';
import sawBladeStickUrl from '../../assets/ai-generated/weapons/individual/web/saw_blade_stick.webp';
import electricShockWrenchUrl from '../../assets/ai-generated/weapons/individual/web/electric_shock_wrench.webp';
import rotarySawShieldUrl from '../../assets/ai-generated/weapons/individual/web/rotary_saw_shield.webp';
import plasmaShredderUrl from '../../assets/ai-generated/weapons/individual/web/plasma_shredder.webp';
import deathWindmillUrl from '../../assets/ai-generated/weapons/individual/web/death_windmill.webp';
import pipeBomberUrl from '../../assets/ai-generated/weapons/individual/web/pipe_bomber.webp';
import molotovUrl from '../../assets/ai-generated/weapons/individual/web/molotov.webp';
import nailgunUrl from '../../assets/ai-generated/weapons/individual/web/nailgun.webp';
import poisonGasCanisterUrl from '../../assets/ai-generated/weapons/individual/web/poison_gas_canister.webp';
import empRailgunUrl from '../../assets/ai-generated/weapons/individual/web/emp_railgun.webp';
import bioBombUrl from '../../assets/ai-generated/weapons/individual/web/bio_bomb.webp';
import barbedWireTrapUrl from '../../assets/ai-generated/weapons/individual/web/barbed_wire_trap.webp';
import trashCanTurretUrl from '../../assets/ai-generated/weapons/individual/web/trash_can_turret.webp';
import scrapMortarUrl from '../../assets/ai-generated/weapons/individual/web/scrap_mortar.webp';
import shockCableUrl from '../../assets/ai-generated/weapons/individual/web/shock_cable.webp';
import grapplingGunUrl from '../../assets/ai-generated/weapons/individual/web/grappling_gun.webp';
import gravityDisassemblerUrl from '../../assets/ai-generated/weapons/individual/web/gravity_disassembler.webp';

// 적 webp 사본(320x320) — 일괄 선행로드 금지. CombatScene이 스폰 목록만 지연 로드한다.
// 재생성: npm run optimize:assets (scripts/optimize-assets.mjs)
import sludgeZombieUrl from '../../assets/ai-generated/enemies/web/sludge_zombie.webp';
import flankerZombieUrl from '../../assets/ai-generated/enemies/web/flanker_zombie.webp';
import grabberUrl from '../../assets/ai-generated/enemies/web/grabber.webp';
import putrifierUrl from '../../assets/ai-generated/enemies/web/putrifier.webp';
import armoredZombieUrl from '../../assets/ai-generated/enemies/web/armored_zombie.webp';
import droneZombieUrl from '../../assets/ai-generated/enemies/web/drone_zombie.webp';
import tankMutantUrl from '../../assets/ai-generated/enemies/web/tank_mutant.webp';
import sewerRaiderUrl from '../../assets/ai-generated/enemies/web/sewer_raider.webp';

// 보스 webp 사본(512x512) — 적과 동일하게 인카운터 진입 시 지연 로드 대상.
import colossusUrl from '../../assets/ai-generated/bosses/web/colossus_boss.webp';
import heraldUrl from '../../assets/ai-generated/bosses/web/the_herald_boss.webp';

// 텍스처 키 — 코드 어디서든 이 상수로 참조 (오타 방지)
export const TEX = {
  BG_L1: 'bg-l1-sky',
  BG_L2: 'bg-l2-factory',
  BG_L3: 'bg-l3-wreckage',
  BG_L4: 'bg-l4-ground',
  // 지역 변형 풀커버 배경(지연 로드)
  BG_REGION_HIGHWAY: 'bg-region-highway',
  BG_REGION_FACTORY: 'bg-region-factory',
  BG_REGION_SEWER: 'bg-region-sewer',
  BG_REGION_BUNKER: 'bg-region-bunker',
  BG_REGION_HOSPITAL: 'bg-region-hospital',
  BG_REGION_POWERPLANT: 'bg-region-powerplant',
  BG_REGION_SWAMP: 'bg-region-swamp',
  BG_REGION_LANDFILL: 'bg-region-landfill',
  BG_REGION_CHECKPOINT: 'bg-region-checkpoint',
  SCRAPPER_STAGE_01: 'scrapper-stage-01',
  SCRAPPER_STAGE_02: 'scrapper-stage-02',
  SCRAPPER_STAGE_03: 'scrapper-stage-03',
  SCRAPPER_STAGE_04: 'scrapper-stage-04',
  SCRAPPER_STAGE_05: 'scrapper-stage-05',
  SCRAPPER_STAGE_06: 'scrapper-stage-06',
  SCRAPPER_STAGE_07: 'scrapper-stage-07',
  SCRAPPER_STAGE_08: 'scrapper-stage-08',
  TAB_CRAFT: 'tab-craft',
  TAB_SKILL: 'tab-skill',
  TAB_STATS: 'tab-stats',
  TAB_INVENTORY: 'tab-inventory',
  COIN_REWARD: 'coin-reward',
  SCRAP_PARTS: 'scrap-parts',
  SKILL_POINT: 'skill-point',
  NOTIFICATION_BADGE: 'notification-badge',
  SETTINGS_GEAR: 'ui-settings-gear'
};

// PreloadScene이 순회하며 this.load.image(key, url) 하는 일괄 선행로드 목록.
// 적/보스는 여기 넣지 않는다 — 전투 인카운터 진입 시 ENEMY/BOSS_MANIFEST에서 지연 로드.
export const IMAGE_MANIFEST = [
  { key: TEX.BG_L1, url: skyUrl },
  { key: TEX.BG_L2, url: factoryUrl },
  { key: TEX.BG_L3, url: wreckageUrl },
  { key: TEX.BG_L4, url: groundUrl },
  // 주인공은 프레임 애니 아틀라스(ANIM_MANIFEST)로 부팅 — 정적 progression stage_01은 더 이상 선행로드 안 함.
  { key: TEX.TAB_CRAFT, url: tabCraftUrl },
  { key: TEX.TAB_SKILL, url: tabSkillUrl },
  { key: TEX.TAB_STATS, url: tabStatsUrl },
  { key: TEX.TAB_INVENTORY, url: tabInventoryUrl },
  // 드롭 보상 아이콘 — 처치 즉시 줍기 연출에 필요해 선행 로드
  { key: TEX.COIN_REWARD, url: coinRewardUrl },
  { key: TEX.SCRAP_PARTS, url: scrapPartsUrl },
  // 재료 8종 — 전투 줍기 토스트/팝 + 인벤/합성 공용. 키는 materials.js MATERIAL_META.iconKey와 1:1.
  { key: 'mat-plastic-bottle', url: matPlasticBottleUrl },
  { key: 'mat-rusty-screws', url: matRustyScrewsUrl },
  { key: 'mat-copper-wire-coil', url: matCopperWireCoilUrl },
  { key: 'mat-small-fuel-canister', url: matSmallFuelCanisterUrl },
  { key: 'mat-scrap-metal-plate', url: matScrapMetalPlateUrl },
  { key: 'mat-old-battery-cell', url: matOldBatteryCellUrl },
  { key: 'mat-chemical-vial', url: matChemicalVialUrl },
  { key: 'mat-broken-circuit-board', url: matBrokenCircuitBoardUrl },
  // 설정 버튼 톱니 — HUD 상시 노출이라 선행 로드(4.9KB)
  { key: TEX.SETTINGS_GEAR, url: gearFragmentUrl }
];

// 진행 단계 텍스처 1~8 — stage 번호 → { key, url }. stage_01만 선행로드(IMAGE_MANIFEST),
// 2~8은 단계 상승 시 CombatScene이 지연 로드 + 다음 1단계 선행 캐시한다(메모리 최대 2~3장).
// key는 TEX 값과 1:1(=CHARACTER_STAGES[n].texKey가 가리키는 TEX 항목의 실제 텍스처 키).
export const STAGE_MANIFEST = {
  1: { key: TEX.SCRAPPER_STAGE_01, url: scrapperStage01Url },
  2: { key: TEX.SCRAPPER_STAGE_02, url: scrapperStage02Url },
  3: { key: TEX.SCRAPPER_STAGE_03, url: scrapperStage03Url },
  4: { key: TEX.SCRAPPER_STAGE_04, url: scrapperStage04Url },
  5: { key: TEX.SCRAPPER_STAGE_05, url: scrapperStage05Url },
  6: { key: TEX.SCRAPPER_STAGE_06, url: scrapperStage06Url },
  7: { key: TEX.SCRAPPER_STAGE_07, url: scrapperStage07Url },
  8: { key: TEX.SCRAPPER_STAGE_08, url: scrapperStage08Url }
};

// 진행 단계 프레임 애니 아틀라스 1~8 — stage 번호 → { key, png, json }.
// key는 STAGE_MANIFEST(정적 포즈)와 다른 별도 텍스처(아틀라스). 단계 상승 시 CombatScene이
// load.atlas로 지연 로드 + 다음 단계 선행 캐시(STAGE_MANIFEST와 동일 패턴).
export const ANIM_MANIFEST = {
  1: { key: 'scrapper-anim-01', png: animStage01Png, json: animStage01Json },
  2: { key: 'scrapper-anim-02', png: animStage02Png, json: animStage02Json },
  3: { key: 'scrapper-anim-03', png: animStage03Png, json: animStage03Json },
  4: { key: 'scrapper-anim-04', png: animStage04Png, json: animStage04Json },
  5: { key: 'scrapper-anim-05', png: animStage05Png, json: animStage05Json },
  6: { key: 'scrapper-anim-06', png: animStage06Png, json: animStage06Json },
  7: { key: 'scrapper-anim-07', png: animStage07Png, json: animStage07Json },
  8: { key: 'scrapper-anim-08', png: animStage08Png, json: animStage08Json }
};

// 무기 아이콘 18종 — 합성 탭 첫 진입 시 1회 지연 로드 후 캐시(키 = 무기 id).
// 전투 활성 중 대량 로드가 60fps를 깨지 않게 HubScene이 탭 진입 시점에만 로드한다.
export const WEAPON_MANIFEST = {
  pipe_wrench: pipeWrenchUrl,
  saw_blade_stick: sawBladeStickUrl,
  electric_shock_wrench: electricShockWrenchUrl,
  rotary_saw_shield: rotarySawShieldUrl,
  plasma_shredder: plasmaShredderUrl,
  death_windmill: deathWindmillUrl,
  pipe_bomber: pipeBomberUrl,
  molotov: molotovUrl,
  nailgun: nailgunUrl,
  poison_gas_canister: poisonGasCanisterUrl,
  emp_railgun: empRailgunUrl,
  bio_bomb: bioBombUrl,
  barbed_wire_trap: barbedWireTrapUrl,
  trash_can_turret: trashCanTurretUrl,
  scrap_mortar: scrapMortarUrl,
  shock_cable: shockCableUrl,
  grappling_gun: grapplingGunUrl,
  gravity_disassembler: gravityDisassemblerUrl
};

// 허브 부가 아이콘(스킬 포인트/알림 뱃지) — 해당 탭 진입 시 지연 로드.
export const HUB_ITEM_MANIFEST = {
  [TEX.SKILL_POINT]: skillPointUrl,
  [TEX.NOTIFICATION_BADGE]: notificationBadgeUrl
};

// 적 텍스처 키(=파일명) → webp URL. 전투 진입 시 스폰 목록의 적만 동적 로드한다.
// 텍스처 키는 파일명을 그대로 써서 constants/combat.js ENEMY_TYPES와 1:1 매칭.
export const ENEMY_MANIFEST = {
  sludge_zombie: sludgeZombieUrl,
  flanker_zombie: flankerZombieUrl,
  grabber: grabberUrl,
  putrifier: putrifierUrl,
  armored_zombie: armoredZombieUrl,
  drone_zombie: droneZombieUrl,
  tank_mutant: tankMutantUrl,
  sewer_raider: sewerRaiderUrl
};

// 보스 키 → webp URL. 보스 인카운터 진입 시 동적 로드(적과 동일 패턴).
export const BOSS_MANIFEST = {
  colossus_boss: colossusUrl,
  the_herald_boss: heraldUrl
};

// 지역 id → 변형 배경 { key, url }. downtown은 매핑 없음(4레이어 패럴랙스 시그니처 룩 유지).
// 적/보스와 동일하게 지역 진입 시 1장만 지연 로드(선행로드 금지) — 배경 webp가 작아도(45~55KB)
// 안 보이는 지역까지 미리 받지 않는다. 키는 한 곳(여기)에서만 관리해 매핑 분산을 막는다.
export const REGION_BG_MANIFEST = {
  highway: { key: TEX.BG_REGION_HIGHWAY, url: bgHighwayUrl },
  factory: { key: TEX.BG_REGION_FACTORY, url: bgFactoryUrl },
  sewer: { key: TEX.BG_REGION_SEWER, url: bgSewerUrl },
  bunker: { key: TEX.BG_REGION_BUNKER, url: bgBunkerUrl },
  hospital: { key: TEX.BG_REGION_HOSPITAL, url: bgHospitalUrl },
  powerplant: { key: TEX.BG_REGION_POWERPLANT, url: bgPowerplantUrl },
  swamp: { key: TEX.BG_REGION_SWAMP, url: bgSwampUrl },
  landfill: { key: TEX.BG_REGION_LANDFILL, url: bgLandfillUrl },
  checkpoint: { key: TEX.BG_REGION_CHECKPOINT, url: bgCheckpointUrl }
};
