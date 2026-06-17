// 에셋 매니페스트 — Vite URL import로 끌어와 빌드 시 해시/복사를 vite가 보장.
// (문자열 경로 로드는 빌드 dist에 안 따라오는 함정이 있어 URL import로 통일)

// 패럴랙스는 web 다운스케일 사본(720x371 webp). 원본 PNG는 보존됨.
// 재생성: npm run optimize:bg (scripts/optimize-bg.mjs)
import skyUrl from '../../assets/ai-generated/backgrounds/web/parallax_l1_sky.webp';
import factoryUrl from '../../assets/ai-generated/backgrounds/web/parallax_l2_factory.webp';
import wreckageUrl from '../../assets/ai-generated/backgrounds/web/parallax_l3_wreckage.webp';
import groundUrl from '../../assets/ai-generated/backgrounds/web/parallax_l4_ground.webp';

// 주인공 — 진행도 stage_01(누더기 시작 버전). 원본 226x478 PNG(가벼움)라 직접 로드.
import scrapperStage01Url from '../../assets/ai-generated/characters/progression/scrapper_stage_01.png';

import tabCraftUrl from '../../assets/ai-generated/ui/individual/tab_crafting.png';
import tabSkillUrl from '../../assets/ai-generated/ui/individual/tab_skill.png';
import tabStatsUrl from '../../assets/ai-generated/ui/individual/tab_stats.png';
import tabInventoryUrl from '../../assets/ai-generated/ui/individual/tab_inventory.png';

// 드롭 보상 아이콘 — 처치 즉시 줍기 연출에 필요하므로 선행 로드(IMAGE_MANIFEST).
// 재생성: npm run optimize:assets (items 카테고리, 128px webp)
import coinRewardUrl from '../../assets/ai-generated/items/individual/web/coin_reward.webp';
import scrapPartsUrl from '../../assets/ai-generated/items/individual/web/scrap_parts.webp';
// 허브 아이콘 — 스킬/알림. 합성·스킬 탭에서만 쓰니 지연 로드(HUB_ITEM_MANIFEST).
import skillPointUrl from '../../assets/ai-generated/items/individual/web/skill_point.webp';
import notificationBadgeUrl from '../../assets/ai-generated/items/individual/web/notification_badge.webp';

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
  SCRAPPER_STAGE_01: 'scrapper-stage-01',
  TAB_CRAFT: 'tab-craft',
  TAB_SKILL: 'tab-skill',
  TAB_STATS: 'tab-stats',
  TAB_INVENTORY: 'tab-inventory',
  COIN_REWARD: 'coin-reward',
  SCRAP_PARTS: 'scrap-parts',
  SKILL_POINT: 'skill-point',
  NOTIFICATION_BADGE: 'notification-badge'
};

// PreloadScene이 순회하며 this.load.image(key, url) 하는 일괄 선행로드 목록.
// 적/보스는 여기 넣지 않는다 — 전투 인카운터 진입 시 ENEMY/BOSS_MANIFEST에서 지연 로드.
export const IMAGE_MANIFEST = [
  { key: TEX.BG_L1, url: skyUrl },
  { key: TEX.BG_L2, url: factoryUrl },
  { key: TEX.BG_L3, url: wreckageUrl },
  { key: TEX.BG_L4, url: groundUrl },
  { key: TEX.SCRAPPER_STAGE_01, url: scrapperStage01Url },
  { key: TEX.TAB_CRAFT, url: tabCraftUrl },
  { key: TEX.TAB_SKILL, url: tabSkillUrl },
  { key: TEX.TAB_STATS, url: tabStatsUrl },
  { key: TEX.TAB_INVENTORY, url: tabInventoryUrl },
  // 드롭 보상 아이콘 — 처치 즉시 줍기 연출에 필요해 선행 로드
  { key: TEX.COIN_REWARD, url: coinRewardUrl },
  { key: TEX.SCRAP_PARTS, url: scrapPartsUrl }
];

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
