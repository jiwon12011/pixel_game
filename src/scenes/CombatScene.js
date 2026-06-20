import Phaser from 'phaser';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import CombatDirector from '../objects/CombatDirector.js';
import { TEX, ENEMY_MANIFEST, BOSS_MANIFEST, WEAPON_MANIFEST, REGION_BG_MANIFEST, ANIM_MANIFEST } from '../assets/manifest.js';
import {
  CHARACTER,
  CHARACTER_ANIM,
  COMBAT_H,
  COMBAT_VIEW,
  GROUND_LINE_RATIO,
  LOGICAL,
  PARALLAX,
  RENDER_SCALE,
  deriveStage
} from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import {
  PLAYER,
  SLICE_SPAWN_LIST,
  COMBAT_COLORS,
  COMBAT_CSS,
  MOTION,
  WAVE,
  DROP,
  ELITE,
  WEAPON_HAND,
  waveParams,
  ENEMY_MEMORY_MAP,
  bossStatsForWave,
  isBossWave
} from '../constants/combat.js';
import { ENEMY_BEHAVIORS } from '../constants/enemyBehaviors.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import { prefersReducedMotion } from '../utils/motion.js';
import GameState from '../state/GameState.js';
import { rollDrop } from '../constants/drops.js';
import { getRegion, getRegionCombatBonus } from '../constants/regions.js';
import { WEAPON_RECIPES, STAT_UPGRADES, defenseMultiplier } from '../constants/crafting.js';
import { MATERIAL_META, MATERIAL_ORDER, GRADE_COLOR } from '../constants/materials.js';
import { legacyOptions } from '../constants/meta.js';
import { pickRunUpgrades, upgradeHex } from '../constants/runUpgrades.js';
import SFX from '../audio/sfx.js';

// 사망 요약 "주력 속성" 칩 색 — HubScene ATTR_COLOR 톤과 동일(0xRRGGBB 정수, 칩 fill/stroke/swatch 공용).
// 텍스트엔 toHexStr로 변환해 쓴다. FIRE 주황·TOXIC 청록·SHOCK/PIERCE 하늘·PHYSICAL 회색.
const ATTR_DEATH_COLOR = {
  FIRE: 0xff6020,
  TOXIC: 0x20ff9a,
  SHOCK: 0x66ddff,
  PIERCE: 0x66ddff,
  PHYSICAL: 0x9a8b78
};

// 0xRRGGBB 정수 → '#rrggbb' 문자열(텍스트 color용).
const toHexStr = (n) => '#' + n.toString(16).padStart(6, '0');

// 데미지 숫자 풀 상한 — 동시에 24개를 넘으면 새 숫자는 생략(밀집 전투에서도 그 정도면 시각적으로 충분).
const DMG_POOL_MAX = 24;

// ── 공격 프레임별 손 무기 앵커 오프셋 ────────────────────────────────────────
// 프레임 애니가 팔 스윙을 담당하고, 손에 쥔 무기(오버레이)는 이 오프셋으로 프레임을 따라간다.
// 트윈 thrust를 대체 — animationupdate에서 currentFrame을 읽어 _weaponSwingProxy에 세팅한다.
//   x: 손 기준 가로 px(+앞), y: 세로 px(-위/+아래), a: 무기 각도(°, Phaser CW=양수).
// 포즈는 8단계 공통(정규화 동일 골격)이라 단계 무관 단일 테이블.
// [튜닝 필요] 프레임을 눈으로 본 1차 추정값 — 실제 손 위치에 맞춰 미세조정.
// 손 무기 오버레이 표시 여부. 프레임이 맨주먹이라 떠 있는 무기가 손에서 떨어져 보여 끔(false).
// 무기 정체성은 HUD 장착표시 + 속성별 타격 VFX로 전달. 되살리려면 true.
const SHOW_HAND_WEAPON = false;

// 난이도 곡선 — 적 피해 배율을 웨이브에 따라 보간(초반 쉽게 → 후반 원래대로).
//   wave 0: EASY_START(0.60, 40%↓) → wave RAMP_WAVES(14)에서 1.0(기본)으로 선형 회복.
//   이후 웨이브는 1.0 고정(원래 난이도). takePlayerDamage 단일 통로에서 곱해진다(독 투척 포함).
const DIFFICULTY_EASY_START = 0.6;
const DIFFICULTY_RAMP_WAVES = 14;
function difficultyDmgMult(wave) {
  if (wave >= DIFFICULTY_RAMP_WAVES) return 1.0;
  const t = Math.max(0, wave) / DIFFICULTY_RAMP_WAVES; // 0→1
  return DIFFICULTY_EASY_START + (1.0 - DIFFICULTY_EASY_START) * t;
}

// 몸 프레임은 거의 정지(생성 결과)라 공격 "휘두름"은 이 오프셋 스윙이 carry한다. 작아진 캐릭터(118px)에 맞춘 값.
const ATTACK_HAND_OFFSETS = {
  attack_0: { x: -6, y: -24, a: -92 }, // 와인드업 — 무기 머리 위-뒤로 치켜듦
  attack_1: { x: 3, y: -9, a: -36 },   // 스윙 중간
  attack_2: { x: 16, y: 12, a: 36 }    // 임팩트 — 앞+아래로 내려찍기
};
// 데미지/히트스톱/셰이크/VFX를 동기화할 임팩트 프레임(내려찍는 접촉 포즈).
const ATTACK_IMPACT_FRAME = 'attack_2';

// ── 독웅덩이(hazard pool) 상수 (Phase 2) ────────────────────────────────
// 동시 존 상한 3개(초과 시 가장 오래된 것 회수). 틱 주기는 scene.time.now 비교(per-zone 타이머 0).
const HAZARD_MAX = 3;
const HAZARD_TICK_MS = 700;   // 존 안에 있을 때 피해 1틱 간격
const HAZARD_FIRST_TICK_MS = 350; // 첫 틱까지 유예(즉발 0)

// ── 킬 콤보(런/전투 한정) ──────────────────────────────────────────────
// 마지막 킬로부터 COMBO_WINDOW_MS 이내 연속 처치마다 카운터 +1(scene.time.now 비교, per-kill 타이머 0).
// COMBO_GRADE_STEP 배수 돌파마다 "다음 드롭 1개 grade +1" 보너스를 예약. 창 만료 시 update에서 리셋.
const COMBO_WINDOW_MS = 3000;   // 다음 킬까지 허용 간격(넘으면 콤보 소멸)
const COMBO_GRADE_STEP = 10;    // 이 배수(10·20…) 돌파 시 등급 상승 드롭 1회 부여
const COMBO_HUD_MIN = 2;        // 이 수치 이상부터 HUD 노출(1킬마다 깜빡이는 노이즈 방지)

// 전투 뷰(상단 58%): 4레이어 패럴랙스 + 주인공 + 자동 진행 전투.
// 적 스폰/이동/공격 타이밍은 CombatDirector가, 적 단위 연출은 Enemy가 담당.
// 주인공 연출(자동 공격 런지·피격 플래시·위험 펄스)은 이 씬이 소유한다.
export default class CombatScene extends Phaser.Scene {
  constructor() {
    super('CombatScene');
  }

  create() {
    installCrispText(this); // 모든 텍스트 2배 해상도 + 정수좌표(한글/HUD 숫자 선명화)
    this._ensureGlowTexture(); // 적 VFX 공유 소프트 글로우 텍스처 1회 생성(textures.exists 가드)
    this.motionOk = !prefersReducedMotion();
    this.combatReady = false;
    this.dangerOn = false;
    this.hitStopUntil = 0;   // 히트스톱 종료 타임스탬프 (ms)

    // 속박(grab) — 이 타임스탬프 전까지 플레이어 자동공격/탭 봉쇄. 새 per-enemy 타이머 0(scene 필드 1개).
    this.playerBindUntil = 0;
    this._bindTether = null;      // 속박 시각 신호(draw-once 테더 Graphics) — 만료/teardown 시 회수
    this._bindTetherTween = null; // 테더 alpha 펄스(repeat:-1) — 회수 시 .stop()

    // 독웅덩이 — scene 소유 배열. draw-once Shape + 단일 update 틱 + reverse-splice 청소(_dmgPool 패턴 동형).
    this._hazards = [];

    // 킬 콤보 — 런/전투 한정 상태. teardown/새 런에서 리셋(아래 teardownEncounter). 새 타이머 0.
    this.comboCount = 0;            // 현재 연속 처치 수
    this.comboExpireAt = 0;         // 이 시각(ms) 넘어가면 콤보 소멸(update가 감시)
    this._comboGradeBumpPending = false; // 콤보 보너스 — 다음 드롭 1개 grade +1 예약

    this.waveShield = 0;     // R9 first_hit_shield — 이번 웨이브 남은 피해무효 차지(웨이브마다 리필)
    this._attacking = false; // 공격 모션 진행 중 플래그 — 탭 연타가 모션을 리셋하지 않게 가드
    this._attackWatchdog = null; // 스윙 복귀 보장 워치독 타이머 — 복귀 onComplete 누락 시 강제 복구
    this._lastTapAttack = 0; // 마지막 탭 공격 타임스탬프(ms) — 최소 간격 가드

    // 온보딩(첫 플레이 한정) — 자동공격이라 "탭=공격 가속"이 전달 안 됨.
    //   _onboardPending: 이번 전투에서 첫 탭 성공 피드백을 기다리는 중(첫 런만 true).
    //   _onboardTimer:   전투 시작 ~2초 후 힌트 토스트 1회 예약 핸들(탭/teardown 시 취소).
    this._onboardPending = false;
    this._onboardTimer = null;

    // 진행 단계 텍스처 키 집합 — VRAM 회수 화이트리스트. stage1(부팅 선행로드)은 회수 로직에서 별도 보호.
    this._stageTexKeys = new Set(Object.values(ANIM_MANIFEST).map((e) => e.key));

    // 데미지 숫자 오브젝트 풀 — 매 타격/DoT마다 add.text 생성 시 Canvas→GPU 텍스처 업로드가 폭증.
    // 비활성 Text를 재사용(setVisible(false) 보관 → 갱신 후 재활성)해 GameObject/텍스처 churn을 줄인다.
    this._dmgPool = [];   // 반납된(유휴) Text 풀
    this._dmgLive = 0;    // 현재 애니메이션 중인 Text 수 — 상한 초과 시 생략

    // 보스 인카운터 상태 — 10웨이브마다 발동. teardown/사망/재시작에서 깔끔히 정리(누수 0).
    this._bossActive = false;  // 보스전 진행 중(스폰 억제 + 보스 처치 대기)
    this.boss = null;          // 현재 보스 Enemy(없으면 null)
    this.bossWaveIndex = 0;    // 이번 보스가 등장한 웨이브(보상/스케일 재계산용)
    this.bossHpBar = null;     // 화면 상단 큰 보스 HP바 핸들

    // 화면(전투 뷰) 탭 = 공격 가속. 씬레벨 단일 핸들러로 처리한다.
    // Combat/Hub 병렬 활성 씬 + 오프셋 뷰포트 카메라 환경이라 per-object 입력 대신
    // 카메라 뷰포트 히트테스트로 직접 판정해 입력 어긋남을 원천 회피한다.
    this.input.on('pointerdown', this.onCombatTap, this);

    // 뷰포트는 백버퍼(720) 픽셀 기준 — COMBAT_VIEW가 이미 RENDER_SCALE을 곱한 값.
    // setZoom(RENDER_SCALE)+setOrigin(0,0): 360 월드 좌표 (0,0)~(360,371)을 이 뷰포트에 1:1로 채운다.
    // origin(0,0)이라야 줌 피벗이 뷰포트 좌상단 → 월드(0,0)=뷰포트 좌상단(스크롤 0).
    this.cameras.main.setViewport(
      COMBAT_VIEW.x,
      COMBAT_VIEW.y,
      COMBAT_VIEW.width,
      COMBAT_VIEW.height
    );
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);
    this.cameras.main.setBackgroundColor(PALETTE.bgSky);

    this.parallax = new ParallaxBackground(this, this.motionOk);

    // groundDropY만큼 노면 레이어가 내려가므로 캐릭터 발도 같은 양 내려 노면에 붙게 동기화.
    this.groundY = COMBAT_H * GROUND_LINE_RATIO + PARALLAX.groundDropY;
    this.playerX = LOGICAL.width * CHARACTER.xRatio;
    // maxHP는 GameState가 소유 — 전투 시작 시 풀피로.
    this.maxHP = GameState.stats.maxHP;
    this.playerHP = this.maxHP;

    // 진행 단계 — 런 스코프 멀티신호 powerScore로 파생(GameState가 statLevels/waveIndex/runKills/
    // ownedWeapons/runBossKills를 다 가짐). 이어하기/유산으로 진행도가 있으면 stage>1로 시작.
    this.characterStage = deriveStage(GameState);

    this.createCharacter();
    this.syncHandWeapon(); // 장착 무기 손표시(맨손 stage_01 위 오버레이)
    this.createVignette();
    this.createHud();
    this.createWaveHud();
    this.createResourceHud();
    this.createComboHud();
    this.createSettingsButton();
    this.createToast();

    this.bindGameState();

    // 지역 배경 — 부팅/이어하기 시 현재 웨이브 지역에 맞춰 세팅. downtown이면 패럴랙스 그대로,
    // 그 외 지역이면 해당 변형을 지연 로드해 페이드 없이 즉시 깐다(이미 그 지역에서 이어함).
    this.currentRegionId = getRegion(GameState.waveIndex).id;
    this.loadRegionBg(this.currentRegionId, (key) => {
      if (key) this.parallax.showRegionImmediate(key);
    });

    // [DEBUG] 테스트용 — '.'(마침표) 키로 다음 웨이브 점프. 웨이브 5 지역전환/업그레이드를
    //         손쉽게 확인하기 위함. DEV 빌드(import.meta.env.DEV)에서만 등록 → 프로덕션 비활성.
    //         핸들러를 참조로 잡아 shutdown에서 off(누수 방지).
    if (import.meta.env.DEV) {
      this._onDebugJump = () => this._debugJumpWave();
      this.input.keyboard?.on('keydown-PERIOD', this._onDebugJump);
    }

    // 적은 일괄 선행로드하지 않는다 — 이 전투의 스폰 목록만 지연 로드 후 시작.
    this.loadEncounterEnemies(SLICE_SPAWN_LIST, () => this.startEncounter());
  }

  // [DEBUG] 실제 처치 없이 다음 웨이브로 점프 — onEnemyKilled의 waveChanged side-effect
  // (배너/지역전환/업그레이드)를 동일하게 다음 틱 defer로 태운다. throw 시 콘솔에 찍힌다. 배포 전 제거.
  _debugJumpWave() {
    if (!import.meta.env.DEV) return; // 프로덕션 안전망 — 키 등록 자체가 DEV 가드지만 본문도 이중 차단
    const target = GameState.waveIndex + 1;
    GameState.runKills = target * WAVE.killsPerWave;
    GameState.waveIndex = target;
    GameState._markRunDirty();
    this.refreshWaveHud();
    console.log('[debug] jump → WAVE', target, '/ region', getRegion(target).id);
    this.time.delayedCall(0, () => {
      try {
        this.maybeTransitionRegion(target);
        this.refillWaveShield();
        // 보스 웨이브(isBossWave)는 웨이브 배너 생략 — onEnemyKilled 경로와 동일 정책.
        // 보스 배너가 단독으로 등장해 과밀 없이 임팩트 집중.
        if (target > 0 && isBossWave(target)) {
          this.startBossEncounter(target);
        } else {
          this.showWaveBanner(target);
          if (target > 0 && target % 3 === 0) this.showUpgradeOverlay(target);
        }
      } catch (e) {
        console.error('[debug jump]', e);
      }
    });
  }

  // GameState 구독 — 허브에서 일어난 변경(업그레이드/합성)을 전투에 즉시 반영.
  // 씬 종료 시 누수 방지를 위해 unbinder를 모아 shutdown에서 해제.
  bindGameState() {
    const offChange = GameState.on('change', () => {
      this.syncResourceHud();
      this.syncHandWeapon(); // 합성 탭에서 장착 무기를 바꾸면 손 무기도 교체
      // 단계 갱신 — powerScore 신호(웨이브/킬/무기/보스/스탯)는 전부 'change'를 거치므로 여기서 통합 검사.
      // swapCharacterStage는 현재 단계와 다를 때만 동작(과호출 가드 내장).
      const ns = deriveStage(GameState);
      if (ns !== this.characterStage) this.swapCharacterStage(ns);
    });
    const offStats = GameState.on('stats', ({ stat }) => {
      if (stat !== 'maxHP') return;
      // maxHP 증가분만큼 현재 전투 HP도 즉시 회복(체감되는 보상).
      const delta = GameState.stats.maxHP - this.maxHP;
      this.maxHP = GameState.stats.maxHP;
      this.playerHP = Math.min(this.maxHP, this.playerHP + Math.max(0, delta));
      this.updateHpBar();
    });
    const offDrop = GameState.on('drop', (info) => this.onDropToast(info));
    this.events.once('shutdown', () => {
      offChange();
      offStats();
      offDrop();
      this.input.off('pointerdown', this.onCombatTap, this);
      // 주인공 프레임 애니 리스너 해제(누수 방지). 씬 종료가 sprite를 파괴하지만 명시적으로 떼어둔다.
      this.character?.off('animationupdate', this._onPlayerAnimUpdate, this);
      this.character?.off('animationcomplete', this._onPlayerAnimComplete, this);
      // 데미지 숫자 풀 정리 — 유휴 Text 파괴 후 비움(활성 Text는 씬 종료가 자동 파괴).
      this._dmgPool.forEach((t) => t.destroy());
      this._dmgPool.length = 0;
      this._dmgLive = 0;
      // [DEBUG] DEV에서만 등록된 점프키 해제(누수 방지). 미등록(프로덕션)이면 no-op.
      if (this._onDebugJump) this.input.keyboard?.off('keydown-PERIOD', this._onDebugJump);
    });
  }

  // 현재 장착 무기 정의(공격력 보너스/쿨다운/메카닉).
  currentWeapon() {
    return WEAPON_RECIPES[GameState.equippedWeapon] || WEAPON_RECIPES.pipe_wrench;
  }

  // ── 에셋 ────────────────────────────────────────────────────────────
  loadEncounterEnemies(spawnList, onReady) {
    const toLoad = spawnList.filter(
      (key) => !this.textures.exists(key) && ENEMY_MANIFEST[key]
    );
    if (toLoad.length === 0) {
      onReady();
      return;
    }
    toLoad.forEach((key) => this.load.image(key, ENEMY_MANIFEST[key]));
    this.load.once('complete', onReady);
    this.load.start();
  }

  // 보스 텍스처 1종 지연 로드(인카운터 진입 시점). 적 로더와 동일 패턴 — 선행로드 금지.
  // onReady(ok)로 텍스처 존재 여부를 넘겨 호출부가 실패 폴백(보스전 취소)을 할 수 있게 한다.
  loadEncounterBoss(bossKey, onReady) {
    if (this.textures.exists(bossKey) || !BOSS_MANIFEST[bossKey]) {
      onReady(this.textures.exists(bossKey));
      return;
    }
    this.load.image(bossKey, BOSS_MANIFEST[bossKey]);
    this.load.once('complete', () => onReady(this.textures.exists(bossKey)));
    this.load.start();
  }

  // 지역 변형 배경을 지연 로드한다(적 로더와 동일 패턴). downtown은 매핑이 없어 key 없이 콜백.
  // onReady(key)로 로드된 텍스처 키를 넘겨 — 호출부가 즉시/크로스페이드를 결정한다.
  loadRegionBg(regionId, onReady) {
    const entry = REGION_BG_MANIFEST[regionId];
    if (!entry) {
      onReady(null); // downtown — 변형 없음(패럴랙스)
      return;
    }
    if (this.textures.exists(entry.key)) {
      onReady(entry.key);
      return;
    }
    // 지연 로드 — 완료/실패를 명시 처리한다. 실패 시 onReady(null)로 폴백해
    // "없는 텍스처로 크로스페이드"(getSourceImage 예외/깨진 배경)를 원천 차단한다.
    // complete/loaderror는 서로를 해제해 onReady가 두 번 불리지 않게 한다.
    const onComplete = () => {
      this.load.off('loaderror', onError);
      onReady(this.textures.exists(entry.key) ? entry.key : null);
    };
    const onError = (file) => {
      if (file?.key !== entry.key) return;
      this.load.off('complete', onComplete);
      console.error('[region bg load]', entry.key, entry.url);
      onReady(null);
    };
    this.load.once('complete', onComplete);
    this.load.once('loaderror', onError);
    this.load.image(entry.key, entry.url);
    this.load.start();
  }

  // 웨이브가 지역 경계를 넘으면 배경을 전환한다(웨이브 변동 시에만 호출).
  // 변형은 로드 완료 콜백에서만 크로스페이드해 로드 중 히치를 막는다. downtown 복귀는
  // 한 런에서 발생하지 않지만(웨이브는 증가만) 방어적으로 패럴랙스 노출 처리.
  maybeTransitionRegion(waveIndex) {
    const regionId = getRegion(waveIndex).id;
    if (regionId === this.currentRegionId) return;
    this.currentRegionId = regionId;
    this.loadRegionBg(regionId, (key) => {
      if (key) this.parallax.crossfadeToRegion(key, this.motionOk ? 500 : 0);
      else this.parallax.hideRegion();
    });
  }

  startEncounter() {
    this.director = new CombatDirector(this, {
      spawnList: SLICE_SPAWN_LIST,
      groundY: this.groundY,
      depth: this.parallax.topDepth + 1,
      motionOk: this.motionOk,
      getWaveParams: () => waveParams(GameState.waveIndex),
      getWaveIndex: () => GameState.waveIndex, // 엘리트 등장 임계 판정
      onDotTick: (enemy, dmg) => this.applyDotTick(enemy, dmg),
      onThreatSpawn: (enemy, info) => this.onThreatSpawn(enemy, info),
      player: {
        getX: () => this.playerX,
        // R9 cooldown_down — 레벨당 쿨타임 ×0.88(곱연산). 미선택(lv0)이면 ×1.
        getAttackCooldown: () =>
          this.currentWeapon().cooldown * Math.pow(0.88, GameState.getModifier('cooldown_down')),
        attack: (enemy) => this.playerAttack(enemy),
        takeDamage: (amount) => this.takePlayerDamage(amount),
        // 속박(grab seam B) — 자동공격 봉쇄 + 시각 신호. isBound는 director 자동공격 게이트가 읽음.
        bindPlayer: (ms, x) => this.bindPlayer(ms, x),
        isBound: () => this.time.now < this.playerBindUntil
      }
    });
    this.director.start();
    this.combatReady = true;
    this.refillWaveShield(); // R9 — 전투 시작 시 방벽 차지 채움(미보유면 0)
    this.refreshWaveHud();
    this.maybeShowOnboardHint(); // 첫 플레이 한정 탭 힌트(meta.onboarded=false일 때만)
  }

  // 첫 플레이 온보딩 — 첫 런(meta.onboarded=false) 전투 시작 ~2초 후 "탭하면 공격 가속" 힌트 1회.
  // _onboardPending을 시작 시점에 세워, 2초 전에 탭해도 onCombatTap이 완료 피드백을 띄울 수 있게 한다.
  // reduced-motion은 showToast가 내부에서 페이드 대신 즉시 표시로 처리한다.
  maybeShowOnboardHint() {
    this._onboardTimer?.remove();
    this._onboardTimer = null;
    this._onboardPending = false;
    if (GameState.meta.onboarded) return;
    this._onboardPending = true;
    this._onboardTimer = this.time.delayedCall(2000, () => {
      this._onboardTimer = null;
      // 이미 탭해서 완료됐거나(또는 사망/전투 비활성) 힌트 생략.
      if (!this._onboardPending || GameState.meta.onboarded) return;
      if (!this.combatReady || this.deathLayer) return;
      this.showToast('탭하면 공격 가속', null, false);
    });
  }

  // 진행 중인 전투를 깔끔히 내린다 — 적/트윈/타이머 누수 없이(재시작/사망 공용).
  teardownEncounter() {
    this.combatReady = false;
    // 온보딩 힌트 예약 취소 — teardown(사망/재시작) 후 힌트가 떠 전투뷰를 건드리지 않게.
    this._onboardTimer?.remove();
    this._onboardTimer = null;
    this._onboardPending = false;
    this.director?.stop();
    this.director?.clearAll(); // Enemy.destroy가 트윈·컨테이너까지 정리(보스 Enemy 포함)
    this.director = null;
    this.hitStopUntil = 0;
    // 속박/독웅덩이 상태 정리 — 다음 전투/런으로 안 새게(테더 Graphics·존 Shape·펄스 트윈 회수).
    this.playerBindUntil = 0;
    this._clearBindTether();
    this._clearHazards();
    this._playerPoison = null; // 투척 독 DoT 리셋(다음 전투/런으로 안 새게)
    // 킬 콤보 리셋 — 콤보 상태/예약/HUD를 새 전투·런으로 안 넘김.
    this._resetCombo(true);
    this._comboGradeBumpPending = false; // 등급상승 예약도 다음 런으로 안 새게(콤보×10 직후 사망 케이스).
    // 위협 경고 라벨 회수 — 씬 전환 중 orphan 텍스트 남지 않게.
    this.tweens.killTweensOf(this._threatWarnText);
    this._threatWarnText?.destroy();
    this._threatWarnText = null;
    // 보스 상태 정리 — clearAll이 보스 Enemy를 파괴하므로 여기선 플래그/HP바만 즉시 회수.
    this._bossActive = false;
    this.boss = null;
    this.bossWaveIndex = 0;
    this.removeBossHpBar();
    // 무피해 클리어 플래그 리셋 — 새 전투/런이 직전 웨이브의 피격 이력을 물려받지 않게.
    // (분노=보스 Enemy 파괴로, guard=적 Enemy 파괴로, 사투=onPlayerDeath의 triggerDangerPulse(false)로 각각 정리됨.)
    GameState.waveHitFlag = false;
    // 사망이 공격 모션 중간에 나면 onComplete가 발화 안 해 플래그가 남는다 → 여기서 강제 해제.
    this._attacking = false;
    this._pendingAttackApply = null;   // 임팩트 미발화 콜백 잔류 방지
    this._attackImpactFired = false;
    this._attackWatchdog?.remove(false); // 스윙 워치독 취소 — teardown 후 발화해 캐릭터를 건드리지 않게
    this._attackWatchdog = null;

    // 주인공 트윈 정리 — 사망이 playerAttack 런지 중간에 나면 3단계 체인/onComplete
    // (idleBobTween.resume 등)이 teardown 후에도 발화해 새 런 bob 상태가 꼬인다.
    // idle bob도 character/shadow 대상이라 함께 죽으므로 restartRun에서 startIdleBob으로 재생성.
    this.tweens.killTweensOf(this.character);
    if (this.character?.active) this.character.setAngle(0); // lean 각도 잔류 방지
    this.tweens.killTweensOf(this.shadow);
    this.idleBobTween = null;
    this.shadowBobTween = null;
    this._stagePopTween = null; // 성장 pop도 character 대상이라 killTweensOf로 함께 죽음 — 참조만 정리

    // 무기 스윙 트윈 정리 — 사망이 스윙 중간에 나면 각도/offsetY가 중간값으로 남아
    // 새 런 초반 updateHandWeaponPos가 어긋난 위치로 무기를 그릴 수 있음.
    // killTweensOf + 즉시 스냅으로 idle 기준값으로 복귀한다.
    if (this.weaponSprite?.active) {
      this.tweens.killTweensOf(this.weaponSprite);
      this.weaponSprite.setAngle(WEAPON_HAND.angle);
    }
    if (this._weaponSwingProxy) {
      this.tweens.killTweensOf(this._weaponSwingProxy);
      this._weaponSwingProxy.offsetY = 0;
      this._weaponSwingProxy.offsetX = 0;
    }
  }

  // ── 주인공 (프레임 애니: walk/attack/hit/death) ───────────────────────────
  createCharacter() {
    // 부팅은 항상 캐시된 stage1 아틀라스로 캐릭터를 만든다(stage1만 선행로드 보장).
    // 이어하기로 현재 단계 아틀라스가 이미 있으면 그걸로 시작(없으면 stage1 → 아래 swap이 지연 적용).
    const bootStage = this.textures.exists(ANIM_MANIFEST[this.characterStage]?.key)
      ? this.characterStage
      : 1;
    const atlasKey = ANIM_MANIFEST[bootStage].key;
    this._applyCharScale(atlasKey); // charScale/charDisplayH 산출(정규화 캔버스 기준, 전 단계 공통)

    this.shadow = this.add
      .ellipse(this.playerX, this.groundY + 4, this.charDisplayH * 0.42, 12, 0x000000, 0.35)
      .setDepth(this.parallax.topDepth + 0.5);

    // Image → Sprite: 프레임 애니 재생이 가능하도록. origin은 정규화 발끝(전 단계 공통).
    this.character = this.add
      .sprite(this.playerX, this.groundY, atlasKey, CHARACTER_ANIM.idleFrame)
      .setOrigin(CHARACTER_ANIM.origin.x, CHARACTER_ANIM.origin.y)
      .setScale(this.charScale)
      .setDepth(this.parallax.topDepth + 1);

    // 공격 프레임별 손 오프셋을 담는 프록시(updateHandWeaponPos가 매 프레임 읽음). idle=0.
    this._weaponSwingProxy = { offsetX: 0, offsetY: 0 };
    this._playerDead = false;

    // 프레임 이벤트 리스너 1회 등록(누수 방지를 위해 shutdown에서 off).
    //  - animationupdate: 공격 중 손 무기 오프셋 + 임팩트(데미지/히트스톱/셰이크/VFX) 동기화
    //  - animationcomplete: attack/hit → walk 복귀, death → 마지막 프레임 정지
    this.character.on('animationupdate', this._onPlayerAnimUpdate, this);
    this.character.on('animationcomplete', this._onPlayerAnimComplete, this);

    this._ensureStageAnims(bootStage);
    if (this.motionOk) this.character.play(this._animKey(bootStage, 'walk')); // 자동전진 walk 루프

    this.startIdleBob();

    // 이어하기/유산으로 stage>1이면 해당 단계 아틀라스로 즉시 교체(연출 없이).
    if (this.characterStage > 1) this.swapCharacterStage(this.characterStage, { silent: true });
  }

  // 애니 키 — `scrap-<stage>-<action>`(walk/attack/hit/death). 씬 전역 유일.
  _animKey(stage, action) {
    return `scrap-${stage}-${action}`;
  }

  // 정규화 캔버스(아틀라스 sourceSize) 기준으로 표시 스케일 산출. 전 단계 동일 기하라 결과도 동일.
  //  charScale: 콘텐츠 키(=캔버스×contentFraction)가 displayContentH가 되도록.
  //  charDisplayH: 화면에 보이는 캐릭터 키(px) — 손 무기 높이비(WEAPON_HAND.heightRatio)의 기준.
  _applyCharScale(atlasKey) {
    const frame = this.textures.get(atlasKey).frames[CHARACTER_ANIM.idleFrame];
    const canvasH = frame?.realHeight || 512; // 트림 전 원캔버스 높이(sourceSize)
    this.charScale = CHARACTER_ANIM.displayContentH / (CHARACTER_ANIM.contentFraction * canvasH);
    this.charDisplayH = CHARACTER_ANIM.displayContentH;
  }

  // 단계 4액션 애니를 1회 정의(씬 전역, exists 가드 → 8단계×4=최대 32개, 각 1회).
  // 아틀라스가 캐시에 있어야 프레임 참조가 유효 — 로드 완료 후 호출한다.
  _ensureStageAnims(stage) {
    const atlasKey = ANIM_MANIFEST[stage]?.key;
    if (!atlasKey || !this.textures.exists(atlasKey)) return false;
    const fps = CHARACTER_ANIM.fps;
    const defs = [
      ['walk', ['walk_0', 'walk_1', 'walk_2', 'walk_3'], fps.walk, -1],
      ['attack', ['attack_0', 'attack_1', 'attack_2'], fps.attack, 0],
      ['hit', ['hit_0', 'hit_1'], fps.hit, 0],
      ['death', ['death_0', 'death_1', 'death_2'], fps.death, 0]
    ];
    for (const [action, frames, frameRate, repeat] of defs) {
      const key = this._animKey(stage, action);
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: frames.map((f) => ({ key: atlasKey, frame: f })),
        frameRate,
        repeat
      });
    }
    return true;
  }

  // walk 루프 재생(평상시 자동전진). reduced-motion/사망 시 호출 안 함.
  _playWalk() {
    const key = this._animKey(this.characterStage, 'walk');
    if (this.anims.exists(key)) this.character?.play(key);
  }

  // 매 프레임 콜백 — 공격 중에만 동작. 손 무기 오프셋을 프레임에 맞춰 갱신하고,
  // 임팩트 프레임 도달 시 데미지/히트스톱/셰이크/VFX를 1회 동기 발화(_pendingAttackApply).
  _onPlayerAnimUpdate(_anim, frame) {
    if (!this._attacking) return;
    const name = frame?.textureFrame;
    const off = ATTACK_HAND_OFFSETS[name];
    if (off && this._weaponSwingProxy) {
      this._weaponSwingProxy.offsetX = off.x;
      this._weaponSwingProxy.offsetY = off.y;
      if (off.a != null && this.weaponSprite?.active) this.weaponSprite.setAngle(off.a);
    }
    if (name === ATTACK_IMPACT_FRAME && !this._attackImpactFired) {
      this._attackImpactFired = true;
      // apply 예외가 onComplete 복귀를 막지 못하게 격리(_attacking stuck 방지).
      try {
        this._pendingAttackApply?.();
      } catch (e) {
        console.error('[attack apply]', e);
      }
    }
  }

  // 1회성 애니 종료 처리 — attack/hit는 walk로 복귀, death는 마지막 프레임에 정지(요구사항).
  _onPlayerAnimComplete(anim) {
    const key = anim?.key || '';
    if (key.endsWith('-attack')) {
      this._finishAttack();
    } else if (key.endsWith('-hit')) {
      if (!this._playerDead && !this._attacking && this.motionOk) this._playWalk();
    } else if (key.endsWith('-death')) {
      this.character?.anims?.stop(); // 마지막 프레임 고정
    }
  }

  // 공격 모션 종료 — 상태/워치독/손 오프셋 정리 후 walk 복귀. 정상 onComplete·강제복구 공용.
  _finishAttack() {
    this._attacking = false;
    this._pendingAttackApply = null;
    this._attackImpactFired = false;
    this._attackWatchdog?.remove(false);
    this._attackWatchdog = null;
    if (this._weaponSwingProxy) {
      this._weaponSwingProxy.offsetX = 0;
      this._weaponSwingProxy.offsetY = 0;
    }
    if (this.weaponSprite?.active) this.weaponSprite.setAngle(WEAPON_HAND.angle);
    if (!this._playerDead && this.motionOk) this._playWalk();
  }

  // ── 진행 단계 외형 교체 (8단계, 아틀라스) ───────────────────────────────────
  // 능력치 성장으로 단계가 오르면 해당 단계 아틀라스로 교체한다. 캐시에 있으면 즉시,
  // 없으면 지연 로드(load.atlas) 후 적용. 전환 히치 방지로 다음 단계를 같은 배치에 선행 캐시.
  // opts.silent: 성장 연출 없이 교체만(부팅/새 런 복구용).
  swapCharacterStage(newStage, opts = {}) {
    const entry = ANIM_MANIFEST[newStage];
    if (!entry) return;

    const next = ANIM_MANIFEST[newStage + 1]; // 다음 단계 선행 캐시 대상(있으면)
    const needNext = next && !this.textures.exists(next.key);

    if (this.textures.exists(entry.key)) {
      this._doSwap(newStage, opts.silent);
      if (needNext) {
        this.load.atlas(next.key, next.png, next.json);
        this.load.start();
      }
      return;
    }

    // 현재 단계 미캐시 — 지연 로드 후 적용. 다음 단계도 같은 배치에 실어 한 번에 받는다.
    this.load.atlas(entry.key, entry.png, entry.json);
    if (needNext) this.load.atlas(next.key, next.png, next.json);
    this.load.once('complete', () => {
      if (!this.scene.isActive()) return; // 로드 중 씬이 내려갔으면 무시
      this._doSwap(newStage, opts.silent);
    });
    this.load.start();
  }

  // 단계 아틀라스를 실제 적용(캐시 보장 후 호출). 정규화로 전 단계 origin/scale 동일 →
  // 트윈 kill(공격 복구) 완료 후 애니/프레임만 교체한다.
  _doSwap(newStage, silent = false) {
    const entry = ANIM_MANIFEST[newStage];
    if (!entry || !this.textures.exists(entry.key)) return;
    if (!this.character?.active) return;

    const prevKey = this.character.texture.key;

    // 공격 스윙 중이면 in-flight 손 오프셋/상태가 새 단계로 새지 않게 깔끔히 복구 후 교체.
    if (this._attacking) this._forceAttackRecover();

    this._ensureStageAnims(newStage); // 새 단계 애니 정의(1회)
    this._applyCharScale(entry.key);

    this.character.setScale(this.charScale).setOrigin(CHARACTER_ANIM.origin.x, CHARACTER_ANIM.origin.y);
    this.characterStage = newStage;

    // 상태 복원: 사망이면 손대지 않음, 그 외엔 walk 루프(reduced-motion은 idle 프레임 고정).
    if (this._playerDead) {
      /* 사망 프레임 유지 */
    } else if (this.motionOk) {
      this.character.play(this._animKey(newStage, 'walk'));
    } else {
      this.character.setTexture(entry.key, CHARACTER_ANIM.idleFrame);
    }

    this._releaseStageTexture(prevKey, newStage);

    if (!silent) {
      SFX.play('stage_up'); // 단계 변신 반짝 상승음
      this._playStageGrowthFx();
    }
  }

  // 직전 단계 텍스처 회수 — 잘못 지우면 캐릭터가 즉시 깨지므로 다음을 모두 통과할 때만 제거:
  // ① stage1(부팅 선행로드) 보호 ② 현재 적용 텍스처(curKey) 보호 ③ 방금 선행캐시한 다음 단계(nextKey) 보호
  // ④ STAGE 화이트리스트 ⑤ character가 더는 이 텍스처를 안 씀(연속 점프 가드) ⑥ exists.
  _releaseStageTexture(prevKey, newStage) {
    // [되돌림] 게임 진행 중 textures.remove()는 WebGL 텍스처 배치/유닛을 손상시켜
    // 화면 전체가 미싱 텍스처(초록)로 깨지는 사례 확인 → VRAM 회수 비활성(이전 정상 동작).
    // 텍스처 누적은 허용. 회수가 필요하면 씬 shutdown 등 렌더링 외 안전 시점에만.
    void prevKey;
    void newStage;
  }

  // [모션] 성장 피드백 — white tint 플래시 + scale pop(총 ≤220ms). reduced-motion: 교체만.
  // 보스전 중(this._bossActive)이면 가독성 위해 tint 생략하고 scale pop만.
  // idle bob은 y만, 공격 트윈은 _doSwap의 forceRecover로 정리돼 scale 충돌 없음.
  _playStageGrowthFx() {
    if (!this.motionOk || !this.character?.active) return;

    if (!this._bossActive) {
      this.character.setTint(0xffffff);
      this.time.delayedCall(120, () => {
        if (this.character?.active) this.character.clearTint();
      });
    }

    // 이전 pop 정리 + baseline 확정 → yoyo가 정확히 평상 scale로 복귀(부동소수 잔차 제거).
    if (this._stagePopTween) this._stagePopTween.stop();
    this.character.setScale(this.charScale);
    const peak = this.charScale * 1.1;
    this._stagePopTween = this.tweens.add({
      targets: this.character,
      scaleX: peak,
      scaleY: peak,
      duration: 90,
      ease: 'Quad.out',
      yoyo: true,
      onComplete: () => {
        this._stagePopTween = null;
        if (this.character?.active && !this._attacking) this.character.setScale(this.charScale);
      }
    });
  }

  // idle bob(주인공 + 그림자) 생성. teardown이 character/shadow 트윈을 통째로 killTweensOf
  // 하므로 새 런 시작 시 여기서 재생성해야 bob이 되살아난다(idleBobTween 상태 정상화).
  startIdleBob() {
    if (!this.motionOk) return;
    // idempotent — 기존 bob을 먼저 회수해 중복 생성/유령 트윈을 막는다(재생성 경로 공용).
    this.tweens.killTweensOf(this.character);
    this.tweens.killTweensOf(this.shadow);
    // idle bob 저장 — 공격 시 pause/resume해 x/scale 트윈과 간섭 방지
    this.idleBobTween = this.tweens.add({
      targets: this.character,
      y: this.groundY - 4,
      duration: 1100,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
    this.shadowBobTween = this.tweens.add({
      targets: this.shadow,
      scaleX: 0.92,
      alpha: 0.28,
      duration: 1100,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
  }

  // ── 무기 손표시 (R7 #6) ────────────────────────────────────────────────
  // 장착 무기 아이콘을 손 근처에 정적 오버레이. 텍스처는 1종만 지연 로드(전투 중 대량 X).
  // 위치는 update()에서 character를 따라가며 갱신(idle bob·런지에 함께 움직임).
  syncHandWeapon() {
    if (!SHOW_HAND_WEAPON) {
      if (this.weaponSprite) { this.weaponSprite.destroy(); this.weaponSprite = null; }
      return; // 손 무기 오버레이 비활성 — 떠 있는 무기 제거(맨주먹 프레임과 충돌 방지).
    }
    const id = GameState.equippedWeapon;
    if (id === this._handWeaponId) return;
    this._handWeaponId = id;
    this.ensureWeaponTexture(id, () => {
      if (this._handWeaponId !== id) return; // 로드 도중 또 바뀌면 마지막 것만 반영
      this.applyHandWeaponTexture(id);
    });
  }

  // 손 무기 텍스처 1종 지연 로드(이미 있으면 즉시 콜백). 전투 활성 중이라도 1장이라 가볍다.
  ensureWeaponTexture(id, cb) {
    if (this.textures.exists(id) || !WEAPON_MANIFEST[id]) {
      cb();
      return;
    }
    this.load.image(id, WEAPON_MANIFEST[id]);
    this.load.once('complete', cb);
    this.load.start();
  }

  applyHandWeaponTexture(id) {
    if (!this.textures.exists(id)) return;
    const src = this.textures.get(id).getSourceImage();
    const scale = WEAPON_HAND.displaySize / src.height;
    if (!this.weaponSprite) {
      this.weaponSprite = this.add
        .image(this.playerX, this.groundY, id)
        .setOrigin(0.5)
        .setAngle(WEAPON_HAND.angle)
        .setDepth(this.parallax.topDepth + WEAPON_HAND.depthOffset); // 캐릭터(+1)보다 확실히 위
    } else {
      this.weaponSprite.setTexture(id);
    }
    this.weaponSprite.setScale(scale);
    this.updateHandWeaponPos();
    this._playEquipFlourish(scale);
  }

  // 손 무기를 캐릭터 손 앵커로 이동. character.x/y(bob·런지)를 따라가 자연스럽게 붙는다.
  updateHandWeaponPos() {
    if (!this.weaponSprite) return;
    // _weaponSwingProxy.offsetY: 찹 스윙 중 y 오프셋(치켜들기=음수, 내려찍기=양수).
    // _weaponSwingProxy.offsetX: 임팩트 순간 무기를 적 방향으로 내지르는 x 오프셋.
    // idle/장착 시 둘 다 0이므로 기존 정적 포즈에 영향 없음.
    const swingOY = this._weaponSwingProxy?.offsetY ?? 0;
    const swingOX = this._weaponSwingProxy?.offsetX ?? 0;
    this.weaponSprite.setPosition(
      this.character.x + WEAPON_HAND.offsetX + swingOX,
      this.character.y - this.charDisplayH * WEAPON_HAND.heightRatio + WEAPON_HAND.offsetY + swingOY
    );
  }

  // [모션] 무기 장착 플러리시 — 스케일 팝 equipScaleFrom→1 + 각도 정착.
  // "새 무기를 쥐었다" 체감. weaponSprite.angle만 조작(position은 update()가 처리).
  // onComplete 없음 — weaponSprite는 씬 종료까지 살아있어 누수 위험 없음.
  // reduced-motion: 즉시 최종 상태(scale/angle은 applyHandWeaponTexture에서 이미 세팅).
  _playEquipFlourish(scale) {
    if (!this.weaponSprite || !this.motionOk) return;

    // 이전 플러리시·찹 스윙 트윈 정리 후 새 플러리시 시작.
    // 스윙 프록시도 함께 정리해 장착 중 offsetY/offsetX가 0으로 복귀되게 함.
    this.tweens.killTweensOf(this.weaponSprite);
    if (this._weaponSwingProxy) {
      this.tweens.killTweensOf(this._weaponSwingProxy);
      this._weaponSwingProxy.offsetY = 0;
      this._weaponSwingProxy.offsetX = 0;
    }
    this.weaponSprite
      .setScale(scale * MOTION.equipScaleFrom)
      .setAngle(WEAPON_HAND.angle + MOTION.equipAngleDelta);

    this.tweens.add({
      targets: this.weaponSprite,
      scaleX: scale,
      scaleY: scale,
      angle: WEAPON_HAND.angle,
      duration: MOTION.equipFlourishMs,
      ease: 'Back.out'
    });
  }

  // 한 적에게 데미지 적용 + 데미지숫자 + 처치 처리. isPierce면 메카닉(감전) 트리거 제외.
  dealDamage(enemy, amount, isPierce = false) {
    if (!enemy || enemy.dead) return;

    // ── R5 적기억 ── 무기 속성이 이 적의 학습 속성과 일치할 때만 개입.
    // 핫패스 — 객체 할당 없이 맵 룩업 + 분기, 내성은 미리 만든 스냅샷 읽기만.
    let resisted = false;
    const wpnAttr = this.currentWeapon().attrTag;
    if (wpnAttr && ENEMY_MEMORY_MAP[enemy.typeKey] === wpnAttr) {
      const mult = GameState.runResistance?.[wpnAttr] ?? 1.0; // 런 고정 스냅샷
      if (mult < 1.0) {
        amount = amount * mult;
        resisted = true;
      }
      // 다음 런용 누적(현재 런 스냅샷은 불변). 저장은 런 종료 시 1회.
      const tally = GameState.meta.enemyMemory.tally;
      tally[wpnAttr] = (tally[wpnAttr] || 0) + 1;
    }

    // R9 shock_dmg — 감전(shocked) 상태 적에게 주는 피해 +50%/레벨. 직접타·관통타 모두 적용.
    const shockLv = GameState.getModifier('shock_dmg');
    if (shockLv && enemy.shocked) amount *= 1 + 0.5 * shockLv;

    // [seam C] 행동 패턴 onDamage — guard(정면방어) 등이 들어오는 피해를 가공. 관통타(isPierce)는 방어 무시.
    if (enemy.behavior?.onDamage) amount = enemy.behavior.onDamage(enemy, amount, { isPierce });

    const dmg = Math.max(1, Math.round(amount));
    const killed = enemy.takeDamage(dmg);
    this.spawnDamageNumber(
      enemy.container.x,
      enemy.container.y - enemy.displayHeight - 10,
      dmg,
      resisted ? COMBAT_CSS.resisted : isPierce ? COMBAT_CSS.pierce : COMBAT_CSS.damage,
      resisted
    );
    // 메카닉 적용 — 관통 추가타(isPierce)·처치 시 제외(스펙). 헬퍼로 빼 핫패스 가독성 유지.
    if (!isPierce && !killed) this.applyWeaponMechanic(enemy, this.currentWeapon());
    if (killed) this.onEnemyKilled(enemy);
  }

  // 직접타 메카닉 분기 — shock(감전) / burn·toxic(DoT). pierce는 추가타라 호출부에서 차단.
  // DoT는 enemy 상태 필드만 세팅(타이머 X) → 틱은 director 단일 update가 처리.
  applyWeaponMechanic(enemy, weapon) {
    const mech = weapon.mechanic;
    if (!mech) return;
    switch (mech.type) {
      case 'shock':
        if (Math.random() < mech.chance) {
          enemy.applyShock(mech.slowMult, mech.cdMult, mech.durationMs);
        }
        break;
      case 'burn':
        if (Math.random() < mech.chance) {
          enemy.applyBurn(mech.dmgPerTick, mech.tickMs, mech.durationMs);
        }
        break;
      case 'toxic':
        if (Math.random() < mech.chance) {
          enemy.applyToxic(mech.dmgPerTick, mech.tickMs, mech.durationMs);
          // 전파 — 가장 가까운 다른 적 1체에 독 옮김(noSpread=true로 재전파 차단).
          if (Math.random() < mech.spreadChance && this.director) {
            const other = this.director.nearestOtherEnemy(enemy);
            if (other) other.applyToxic(mech.dmgPerTick, mech.tickMs, mech.durationMs, true);
          }
        }
        break;
      default:
        break;
    }
  }

  // DoT 1틱 — director가 타이밍을 결정해 호출. 직접타가 아니므로 적기억 tally/내성 제외(단순화):
  // 내성/학습은 dealDamage의 직접타에서만 처리되고, 여기선 순수 틱 데미지만 적용한다.
  // fromDot:true → takeDamage가 flashHit(셰이크+9 delayedCall) 생략 → 경량 DoT 경로.
  applyDotTick(enemy, dmg) {
    if (!enemy || enemy.dead) return;
    // R9 dot_speed — 단순화: 틱 주기 대신 틱 데미지 +30%/레벨(화염/독 공통). 시각/처치 모두 반영.
    const dotLv = GameState.getModifier('dot_speed');
    if (dotLv) dmg = Math.max(1, Math.round(dmg * (1 + 0.3 * dotLv)));
    // 지역 패시브 — DoT도 속성 매칭(burn→FIRE, toxic→TOXIC)이면 지역 배율 곱연산.
    const dotAttr = enemy.dotType === 'burn' ? 'FIRE' : enemy.dotType === 'toxic' ? 'TOXIC' : null;
    const regionDotMult = getRegionCombatBonus(this.currentRegionId, dotAttr);
    if (regionDotMult !== 1) dmg = Math.max(1, Math.round(dmg * regionDotMult));
    const killed = enemy.takeDamage(dmg, { fromDot: true });
    enemy.spawnDotPuff?.(); // DoT 틱 퍼프 — 숫자만 뚝뚝 뜨지 않고 연출의 일부로 보이게
    // DoT 숫자는 작게 + 색 구분(화염 주황 / 독 청록)으로 직접타와 시각 분리, 스팸 억제.
    this.spawnDamageNumber(
      enemy.container.x,
      enemy.container.y - enemy.displayHeight - 4,
      dmg,
      enemy.dotType === 'toxic' ? COMBAT_CSS.toxicDot : COMBAT_CSS.burnDot,
      false,
      true // small — DoT 표기
    );
    if (killed) this.onEnemyKilled(enemy);
  }

  // [프레임 애니] 오버헤드 찹 — attack 프레임(attack_0 와인드업 → 1 스윙 → 2 임팩트)이 모션을 담당.
  //   · 손 무기는 ATTACK_HAND_OFFSETS로 프레임을 따라간다(트윈 thrust 대체, _onPlayerAnimUpdate).
  //   · 데미지/히트스톱/카메라셰이크/슬래시·스파크 VFX/넉백은 임팩트 프레임(attack_2)에 1회 동기 발화.
  //   · 캐릭터 scale/x/angle을 흔들던 트윈은 프레임이 대신하므로 제거 — 카메라·이펙트·히트스톱만 보존.
  // 누수 0: 재진입 가드 + 워치독 + animationcomplete 복귀(_finishAttack).
  playerAttack(enemy) {
    // 임팩트 주스 — 임팩트 프레임에서 1회 호출. reduced-motion도 데미지는 적용(VFX/히트스톱만 생략).
    const apply = () => {
      if (!enemy || enemy.dead) return;
      const weapon = this.currentWeapon();
      // 무기 atk는 강화 레벨까지 반영(GameState.getWeaponAtk 단일 출처). 런모디파이어/적기억은 dealDamage 경로 그대로.
      // LAST SALVAGE 사투 모드 — HP 위험(dangerOn) 구간에선 공격 데미지 ×1.4(관통 추가타 base*falloff에도 전파).
      // 지역 패시브 — 현재 지역이 이 무기 속성을 강화하면 곱연산(사투 배율과 자연 합산, 관통 추가타에도 전파).
      const base =
        (GameState.stats.atk + GameState.getWeaponAtk(GameState.equippedWeapon)) *
        (this.dangerOn ? 1.4 : 1.0) *
        getRegionCombatBonus(this.currentRegionId, weapon.attrTag);
      this.dealDamage(enemy, base);
      SFX.play('tap_attack'); // 타격 임팩트(스윙당 1회 — 관통 추가타엔 중복 X)

      // 관통 메카닉 — 사거리 내 2번째 적에게 falloff 추가타(감전 트리거 제외).
      if (weapon.mechanic?.type === 'pierce' && this.director) {
        const inRange = this.director.enemiesInRange(this.playerX, PLAYER.attackRange);
        const second = inRange.find((e) => e !== enemy && !e.dead);
        if (second) {
          this.dealDamage(second, base * weapon.mechanic.falloff, true);
          // 관통 2차 타깃 — 슬래시+스파크(넉백은 연출 과밀 방지로 생략)
          if (this.motionOk) {
            const c = this._slashColorForWeapon();
            this._spawnPunchImpact(second, c);
            this._spawnImpactSparks(second, c);
          }
        }
      }

      // 히트스톱 + 카메라 셰이크 + 임팩트 VFX — 프레임 임팩트(attack_2)와 동기. reduced-motion 시 전체 생략.
      if (this.motionOk) {
        this.hitStopUntil = this.time.now + MOTION.hitStopMs;
        if (this.cameras?.main) this.cameras.main.shake(MOTION.chopShakeMs, MOTION.chopShakeIntensity);
        const slashColor = this._slashColorForWeapon();
        this._spawnPunchImpact(enemy, slashColor); // 맨손 펀치(슬래시 아크 대체)
        this._spawnImpactSparks(enemy, slashColor);
        this._applyEnemyKnockback(enemy);
      }
    };

    if (!this.motionOk) {
      // reduced-motion 경로 — 애니 없이 즉시 적용(apply 예외가 director 루프로 전파되지 않게 격리).
      try {
        apply();
      } catch (e) {
        console.error('[attack apply]', e);
      }
      return;
    }

    // 재진입 가드 — 이미 스윙 중/사망이면 새 공격 안 만든다(director는 다음 쿨다운에 재시도).
    if (this._attacking || this._playerDead) return;
    const attackKey = this._animKey(this.characterStage, 'attack');
    if (!this.anims.exists(attackKey)) {
      // 아틀라스 로드 전(예외적) — 모션 없이 데미지만이라도 적용.
      try { apply(); } catch (e) { console.error('[attack apply]', e); }
      return;
    }

    this._attacking = true;
    this._pendingAttackApply = apply;     // 임팩트 프레임에서 _onPlayerAnimUpdate가 호출
    this._attackImpactFired = false;

    // 워치독 — 공격 애니 길이+200ms까지 _attacking이 안 풀리면(complete 누락 등) 강제 복구.
    const swingTotalMs = (3 / CHARACTER_ANIM.fps.attack) * 1000; // 3프레임
    this._attackWatchdog?.remove(false);
    this._attackWatchdog = this.time.delayedCall(swingTotalMs + 200, () => {
      this._attackWatchdog = null;
      if (!this._attacking) return; // 정상 복귀됨
      console.warn('[attack watchdog] forced recovery');
      this._forceAttackRecover();
    });

    // 무기 잔상 — 와인드업 위치에 반투명 ghost(스피드감). onComplete destroy로 누수 0.
    if (this.weaponSprite?.active) {
      const trail = this.add
        .image(this.weaponSprite.x, this.weaponSprite.y, this.weaponSprite.texture.key)
        .setDisplaySize(this.weaponSprite.displayWidth, this.weaponSprite.displayHeight)
        .setAngle(this.weaponSprite.angle)
        .setOrigin(0.5)
        .setAlpha(0.42)
        .setDepth(this.weaponSprite.depth - 1);
      this.tweens.add({
        targets: trail,
        alpha: 0,
        duration: 110,
        ease: 'Quad.in',
        onComplete: () => { if (trail.active) trail.destroy(); }
      });
    }

    // 첫 프레임(attack_0) 손 오프셋은 play 시점에 직접 세팅(animationupdate는 2번째 프레임부터 발화).
    const o0 = ATTACK_HAND_OFFSETS.attack_0;
    if (this._weaponSwingProxy) {
      this._weaponSwingProxy.offsetX = o0.x;
      this._weaponSwingProxy.offsetY = o0.y;
    }
    if (o0.a != null && this.weaponSprite?.active) this.weaponSprite.setAngle(o0.a);

    this.character.play(attackKey); // 1회 재생 → animationcomplete에서 walk 복귀
  }

  // ── 임팩트 VFX 헬퍼 ─────────────────────────────────────────────────────────
  // motionOk=true 전용. apply() 안에서 호출. 누수 0: onComplete에서 Graphics.destroy().

  // 무기 속성 태그 → 슬래시/스파크 색 (COMBAT_COLORS + 인라인 리터럴 혼용)
  _slashColorForWeapon() {
    const tag = this.currentWeapon()?.attrTag ?? 'PHYSICAL';
    switch (tag) {
      case 'FIRE':   return COMBAT_COLORS.burnGlow;   // 0xff5500 주황-적
      case 'TOXIC':  return COMBAT_COLORS.toxicGlow;  // 0x33ff77 형광 녹
      case 'SHOCK':  return COMBAT_COLORS.shock;      // 0x66ddff 청록
      case 'PIERCE': return 0x88ccff;                 // 하늘청 (관통)
      default:       return 0xfff0d0;                 // PHYSICAL — 따뜻한 흰/금
    }
  }

  // 검격 호(슬래시) VFX — 임팩트 지점에 두꺼운 호 선(흰+속성 색)을 그려
  // 스케일업+페이드로 소멸. 무기 스윙 방향(-100°→+48°)과 정렬.
  _spawnSlashVfx(enemy, color) {
    if (!enemy?.container?.active) return;
    const depth = this.parallax.topDepth + 3;
    // 슬래시 중심: 적 상체(발에서 절반 높이 위)
    const cx = enemy.container.x - 5;
    const cy = enemy.container.y - (enemy.displayHeight ?? 28) * 0.55;
    const startRad = Phaser.Math.DegToRad(MOTION.slashStartDeg);
    const endRad   = Phaser.Math.DegToRad(MOTION.slashEndDeg);

    const g = this.add.graphics().setDepth(depth).setPosition(cx, cy);

    // 외선 — 흰색 굵게 (타격 에너지 질감). 4.5px로 더 또렷하게.
    g.lineStyle(4.5, 0xffffff, 0.94);
    g.strokeArc(0, 0, MOTION.slashOuterR, startRad, endRad, false);

    // 내선 — 속성 색 (무기 원소 질감). 2.5px로 강화.
    g.lineStyle(2.5, color, 0.88);
    g.strokeArc(0, 0, MOTION.slashInnerR, startRad + 0.18, endRad - 0.12, false);

    this.tweens.add({
      targets: g,
      scaleX: MOTION.slashScaleTo,
      scaleY: MOTION.slashScaleTo,
      alpha: 0,
      duration: MOTION.slashDurationMs,
      ease: 'Quad.out',
      onComplete: () => { if (g.active) g.destroy(); }
    });
  }

  // 방사형 스파크 VFX — 타격 지점 중심에서 짧은 선분들이 방사 후 페이드.
  // Graphics 선분 + 중심 점으로 픽셀 아트 타격감 강조.
  _spawnImpactSparks(enemy, color) {
    if (!enemy?.container?.active) return;
    const depth = this.parallax.topDepth + 3;
    const cx = enemy.container.x - 4;
    const cy = enemy.container.y - (enemy.displayHeight ?? 28) * 0.5;

    const g = this.add.graphics().setDepth(depth).setPosition(cx, cy);
    const count = MOTION.sparkCount;

    for (let i = 0; i < count; i++) {
      // 각도: 오버헤드 찹 방향(좌상→우하) 중심으로 부채꼴 분산
      const baseAngle = -Math.PI * 0.55; // 약 -100° (무기 내려찍기 방향)
      const angle = baseAngle + (Math.PI * 1.2 / (count - 1)) * i;
      const innerR = 2 + Math.random() * 2;
      const outerR = innerR + 6 + Math.random() * 7; // 4+5 → 6+7: 스파크 선 길게 강화
      // 홀짝으로 흰/속성 색 혼합 — 단색 모노톤 방지. 선 두께 1.5→2 밝기 강화.
      g.lineStyle(2, i % 2 === 0 ? 0xffffff : color, 0.95);
      g.beginPath();
      g.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
      g.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
      g.strokePath();
    }
    // 중심 점 — "충격 핵" 시각화. 2.5→3으로 약간 키워 존재감 강화.
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, 3);

    this.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: MOTION.sparkDurationMs,
      ease: 'Quad.out',
      onComplete: () => { if (g.active) g.destroy(); }
    });
  }

  // 맨손 펀치 임팩트 — 흰 충격 코어 팝 + 빠른 쇼크웨이브 링 + 전방(우) 스피드라인.
  // 무기 오버레이 제거 후 주먹 타격감을 책임진다. 전부 생성→tween→onComplete destroy(누수 0).
  // 호출부(playerAttack motionOk 블록)가 reduced-motion 게이트 담당.
  _spawnPunchImpact(enemy, color) {
    if (!enemy?.container?.active) return;
    const depth = this.parallax.topDepth + 4; // 스파크/슬래시보다 한 단계 위
    const h = enemy.displayHeight ?? 28;
    const cx = enemy.container.x - h * 0.18; // 적 근접면(좌)에서 주먹이 닿는 지점
    const cy = enemy.container.y - h * 0.5;

    // 1) 충격 코어 — 흰 원 팝(짧고 강하게)
    const core = this.add.graphics().setDepth(depth).setPosition(cx, cy).setScale(0.4);
    core.fillStyle(0xffffff, 1);
    core.fillCircle(0, 0, 5);
    this.tweens.add({
      targets: core, scaleX: 1.9, scaleY: 1.9, alpha: 0, duration: 150, ease: 'Quad.out',
      onComplete: () => { if (core.active) core.destroy(); }
    });

    // 2) 쇼크웨이브 링 — 빠르게 확산(흰 외륜 + 속성색 내륜)
    const ring = this.add.graphics().setDepth(depth).setPosition(cx, cy);
    ring.lineStyle(3, 0xffffff, 0.95);
    ring.strokeCircle(0, 0, 7);
    ring.lineStyle(2, color, 0.7);
    ring.strokeCircle(0, 0, 4);
    this.tweens.add({
      targets: ring, scaleX: 2.8, scaleY: 2.8, alpha: 0, duration: 230, ease: 'Quad.out',
      onComplete: () => { if (ring.active) ring.destroy(); }
    });

    // 3) 전방 스피드라인 — 주먹이 밀어내는 힘(우측으로 짧게 슬라이드+페이드)
    const streak = this.add.graphics().setDepth(depth).setPosition(cx, cy);
    streak.lineStyle(2.5, 0xffffff, 0.9);
    for (const dy of [-5, 0, 6]) {
      streak.beginPath();
      streak.moveTo(2, dy);
      streak.lineTo(16, dy * 0.6);
      streak.strokePath();
    }
    this.tweens.add({
      targets: streak, x: cx + 12, alpha: 0, duration: 170, ease: 'Quad.out',
      onComplete: () => { if (streak.active) streak.destroy(); }
    });
  }

  // 적 VFX 공유 소프트 글로우 텍스처 생성 — 씬 create() 1회 호출. textures.exists 가드.
  // 64×64 흰 원형 소프트 그라데이션 → Enemy가 tint/scale/ADD 블렌드로 감전/독/화염 표현.
  // 공유 텍스처라 적 destroy 시 지우지 말 것 — 씬 shutdown 시점에만 Phaser가 자동 해제.
  _ensureGlowTexture() {
    const KEY = 'fx-glow';
    if (this.textures.exists(KEY)) return;
    const SIZE = 64;
    const C    = SIZE / 2; // 32
    const g    = this.make.graphics({ x: 0, y: 0, add: false });
    // 다단 fillCircle: 외곽(옅음)→중심(불투명) 레이어로 소프트 그라데이션
    const layers = [
      [C,        0.04],
      [C * 0.80, 0.09],
      [C * 0.62, 0.18],
      [C * 0.44, 0.34],
      [C * 0.28, 0.58],
      [C * 0.14, 0.84],
    ];
    for (const [r, a] of layers) {
      g.fillStyle(0xffffff, a);
      g.fillCircle(C, C, r);
    }
    g.generateTexture(KEY, SIZE, SIZE);
    g.destroy();
  }

  // 사망폭발 링(explode 행동) — 단일 Graphics 원을 스케일업+페이드. onComplete destroy로 누수 0.
  // motionOk 게이트는 호출부(onEnemyKilled ctx.spawnRing)가 책임. depth는 스파크와 동일 레이어.
  _spawnBlastRing(x, y, radius, color) {
    const g = this.add.graphics().setDepth(this.parallax.topDepth + 3).setPosition(x, y);
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(0, 0, radius * 0.42); // 시작은 작게 → 트윈으로 blastR 체감 크기까지 확산
    this.tweens.add({
      targets: g,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 320,
      ease: 'Quad.out',
      onComplete: () => { if (g.active) g.destroy(); }
    });
  }

  // 적 넉백 — 피격 적을 플레이어 반대 방향(우측)으로 worldX 트윈.
  // yoyo=true로 되돌아와 위치 정확히 복구. 보스는 절반 거리.
  // Enemy.update가 매 프레임 syncPosition(worldX 기반)을 호출하므로 트윈이 즉시 시각 반영됨.
  _applyEnemyKnockback(enemy) {
    if (!enemy || enemy.dead) return;
    const dist = enemy.isBoss
      ? Math.max(1, Math.round(MOTION.knockbackPx * 0.35))
      : MOTION.knockbackPx;
    const origX = enemy.worldX;
    this.tweens.add({
      targets: enemy,
      worldX: origX + dist,
      duration: MOTION.knockbackMs,
      ease: 'Quad.out',
      yoyo: true,
      onComplete: () => {
        // yoyo 복귀 후 부동소수 오차 제거 — 생존 중일 때만(사망 중엔 worldX가 이미 의미 없음)
        if (!enemy.dead) enemy.worldX = origX;
      }
    });
  }

  // 스윙 강제 복구 — 복귀 트윈/onComplete가 어떤 이유로든 누락돼 _attacking이 stuck됐을 때
  // (워치독·teardown 등) 진행 중 트윈을 정리하고 캐릭터/무기를 평상값으로 스냅한다.
  _forceAttackRecover() {
    this._attacking = false;
    this._pendingAttackApply = null;
    this._attackImpactFired = false;
    this._attackWatchdog?.remove(false);
    this._attackWatchdog = null;
    if (this.weaponSprite?.active) {
      this.tweens.killTweensOf(this.weaponSprite);
      this.weaponSprite.setAngle(WEAPON_HAND.angle);
    }
    if (this._weaponSwingProxy) {
      this.tweens.killTweensOf(this._weaponSwingProxy);
      this._weaponSwingProxy.offsetY = 0;
      this._weaponSwingProxy.offsetX = 0;
    }
    if (this.character?.active) {
      this.tweens.killTweensOf(this.character);
      this.character.x = this.playerX;
      this.character.setScale(this.charScale);
      this.character.setAngle(0); // 잔류 각도 리셋
      // 공격 프레임에서 빠져나와 walk 루프로 복귀(사망 중엔 손대지 않음).
      if (this.motionOk && !this._playerDead) this._playWalk();
    }
    // bob 복구: 위 killTweensOf(character)로 idleBobTween이 죽었으므로 resume 불가 → 재생성.
    // (정상 공격 경로는 pause/resume을 쓰지만, 이 강제복구 경로는 kill 후라 재생성이 정답.)
    if (!this._playerDead) this.startIdleBob();
  }

  // 적 처치 → 웨이브 진행 → 지역별 드롭 롤(웨이브 배율) → 코인 자동/재료 터치 줍기.
  onEnemyKilled(enemy) {
    SFX.play('enemy_kill'); // 처치음(픽셀 크런치) — throttle로 폭주 처치 시 스팸 억제
    this._registerCombo(); // 킬 콤보 카운터 갱신(창 내 연속 처치 → +1, 임계 돌파 시 등급 상승 예약)

    // [seam D] 행동 패턴 onDeath — explode(사망폭발) 등. scene 부작용은 ctx 콜백으로만 주입(Enemy 비참조).
    // VFX는 ctx 안에서 motionOk 게이트(behaviors는 모션 분기 모름), 데미지는 reduced-motion에도 적용.
    if (enemy.behavior?.onDeath) {
      enemy.behavior.onDeath(enemy, {
        playerX: this.playerX,
        takePlayerDamage: (n) => this.takePlayerDamage(n),
        spawnSparks: (e, c) => { if (this.motionOk) this._spawnImpactSparks(e, c); },
        spawnRing: (x, y, r, c) => { if (this.motionOk) this._spawnBlastRing(x, y, r, c); },
        // 독웅덩이 — VFX가 아니라 게임플레이 존이라 reduced-motion에도 생성(펄스만 내부에서 분기).
        spawnHazard: (hx, r, dmg, dur) => this.spawnHazard(hx, r, dmg, dur),
        // 독 투척 — 적이 죽으며 독 글롭을 플레이어에게 던짐. 도달 시 플레이어 N틱 독 DoT(경계 있음).
        throwPoison: (fromX, fromY, dmg, ticks) => this.throwPoison(fromX, fromY, dmg, ticks)
      });
    }

    // 1) 처치 누적 → 웨이브 진행. 넘어가면 HUD 갱신 + 배너(지역명 포함).
    const { waveChanged, waveIndex } = GameState.addKill();
    this.refreshWaveHud();
    if (waveChanged) {
      // 무거운 웨이브 연출(배너 / 지역 배경 지연로드·크로스페이드 / 업글 오버레이)을
      // 데미지 콜스택에서 분리한다. 이 경로는 chop 임팩트 onComplete 안에서 동기 실행되므로,
      // 여기서 예외가 나면 그 뒤의 복귀 트윈(3a/3b/3c)이 안 깔려 플레이어가 영구히 굳는다.
      // delayedCall(0)로 다음 틱에 돌려 어떤 예외도 공격 트윈 체인으로 전파되지 않게 한다.
      // (자원 가산·HUD·방벽 같은 가벼운 건 아래에서 그대로 동기 처리.)
      const wi = waveIndex;
      this.time.delayedCall(0, () => {
        try {
          this.maybeTransitionRegion(wi); // 지역 경계 넘으면 배경 크로스페이드
          // 웨이브 사이드이펙트 조율:
          //   · 보스 웨이브(isBossWave: 5,12,19…) → 웨이브 배너 생략. 보스 배너/HP바가 더 강한 임팩트로 대체해
          //     0.3H(웨이브)+0.46H(보스) 동시 과밀을 방지하고 보스 등장에 화면을 집중시킨다.
          //     업그레이드 오버레이는 "보스 처치 보상"으로 미룬다.
          //   · 비보스 + %3 → 기존 R9 웨이브 업그레이드(런 한정 버프). 사망/오버레이와 겹침 가드는 내부에.
          //     (else 안이라 보스 웨이브와 자동으로 안 겹침.)
          //   · 나머지 → 웨이브 배너만.
          if (wi > 0 && isBossWave(wi)) {
            this.startBossEncounter(wi);
          } else {
            this.showWaveBanner(wi);
            if (wi > 0 && wi % 3 === 0) this.showUpgradeOverlay(wi);
          }
        } catch (e) {
          console.error('[wave side-effect]', e);
        }
      });
    }

    // R9 lifesteal_on_kill — 처치 시 HP +3/레벨 회복(maxHP 클램프).
    const lifeLv = GameState.getModifier('lifesteal_on_kill');
    if (lifeLv && this.playerHP > 0 && this.playerHP < this.maxHP) {
      this.playerHP = Math.min(this.maxHP, this.playerHP + 3 * lifeLv);
      this.updateHpBar();
    }

    // R9 first_hit_shield — 웨이브 진입마다 보유 레벨만큼 방벽 차지 리필.
    // + 무피해 클리어(CLEAN SWEEP): 직전 웨이브에서 피격이 없었으면 보너스 → 그 뒤 다음 웨이브용으로 플래그 리셋.
    if (waveChanged) {
      this.refillWaveShield();
      if (!GameState.waveHitFlag) this.grantCleanSweep(enemy);
      GameState.waveHitFlag = false;
    }

    // 2) 드롭 — 현재 웨이브의 지역 배율 반영. 코인은 round, 재료는 floor로 dropMult 반영.
    const regionId = getRegion(GameState.waveIndex).id;
    const drop = rollDrop(enemy.typeKey, regionId);
    const mult = waveParams(GameState.waveIndex).dropMult;
    if (mult !== 1) {
      drop.coins = Math.round((drop.coins || 0) * mult);
      for (const k of MATERIAL_ORDER) if (drop[k]) drop[k] = Math.floor(drop[k] * mult);
    }

    // 영구 업글 '잔해 수집기'(구 scrap_magnet 재해석) — 처치당 재료 종별 +1 추가 드롭 확률.
    const dropChance = GameState.getMaterialDropChance();
    if (dropChance > 0) {
      for (const k of MATERIAL_ORDER) if (drop[k] && Math.random() < dropChance) drop[k] += 1;
    }

    const x = enemy.container.x;
    const y = enemy.container.y - enemy.displayHeight * 0.5;

    // R9 coin_boost — 코인 드롭 +25%/레벨(레벨 0이면 무변화).
    const coinLv = GameState.getModifier('coin_boost');
    if (coinLv && drop.coins) drop.coins = Math.round(drop.coins * (1 + 0.25 * coinLv));

    // 엘리트 처치 보너스 — 코인 배율+가산 + 떨어진 재료 종별 +1(단단함에 대한 보상).
    if (enemy.isElite) {
      drop.coins = Math.round((drop.coins || 0) * ELITE.coinMult) + ELITE.coinBonus;
      for (const k of MATERIAL_ORDER) if (drop[k]) drop[k] += 1;
    }

    // 콤보 보너스 — 등급 상승 예약이 있으면 이번 드롭 1개를 grade +1로 치환(소비). 최종 drop dict에 적용.
    if (this._comboGradeBumpPending) {
      this._applyComboGradeBump(drop);
      this._comboGradeBumpPending = false;
    }

    // 3) 코인 — 즉시 자동 가산 + 우상단 HUD로 빨려가는 연출(기존 동작 유지).
    if (drop.coins) {
      GameState.applyDrop({ coins: drop.coins }, x, y);
      this.flyPickup(
        { key: 'coins', tex: TEX.COIN_REWARD, color: COMBAT_COLORS.gold },
        x,
        y,
        this.resHud.coins,
        0
      );
    }

    // 4) 재료 — 코인처럼 즉시 자동 가산 + 팝→인벤 빨려가기 연출. 땅 줍기(탭) 폐지.
    //    여러 종 동시 드롭은 matIdx로 살짝 스태거해 팝이 겹치지 않게 한다.
    let matIdx = 0;
    for (const key of MATERIAL_ORDER) {
      if (!drop[key]) continue;
      const sx = x + Phaser.Math.Between(-DROP.spreadX, DROP.spreadX);
      this.autoCollectMaterial(key, drop[key], sx, y, matIdx);
      matIdx++;
    }
    // 재료가 실제로 떨어졌을 때만 획득 blip(코인은 매 처치 잦아 제외 — 처치음과 겹쳐 시끄러움 방지).
    if (matIdx > 0) SFX.play('pickup');
  }

  // 무피해 클리어 보너스 — 직전 웨이브를 한 대도 안 맞고 넘겼을 때 1회. 희귀 재료(grade≥2) 1개 추가 드롭.
  // 드롭은 onEnemyKilled의 재료 경로를 재사용(applyDrop + popMaterial). 안내는 토스트(중앙 웨이브 배너와
  // 겹치지 않게 상단 토스트 슬롯 사용 — waveChanged가 showWaveBanner를 동시에 띄우므로 의도적 분리).
  grantCleanSweep(enemy) {
    const rares = MATERIAL_ORDER.filter((k) => MATERIAL_META[k].grade >= 2);
    if (rares.length && enemy?.container) {
      const key = rares[Math.floor(Math.random() * rares.length)];
      const x = enemy.container.x;
      const y = enemy.container.y - enemy.displayHeight * 0.5;
      GameState.applyDrop({ [key]: 1 }, x, y);
      this.popMaterial(key, 1, x, y, 0, true);
    }
    this.showToast('CLEAN SWEEP', null, true);
  }

  // ── 킬 콤보 ──────────────────────────────────────────────────────────
  // 처치마다 호출 — 창(COMBO_WINDOW_MS) 내 연속이면 +1, 아니면 1로 리셋. 임계 배수 돌파 시
  // 다음 드롭 등급 상승을 예약한다. 새 타이머 0(만료 감시는 update가 time.now 비교로 처리).
  _registerCombo() {
    const now = this.time.now;
    this.comboCount = now <= this.comboExpireAt ? this.comboCount + 1 : 1;
    this.comboExpireAt = now + COMBO_WINDOW_MS;
    // 10·20… 돌파 → 다음 드롭 1개 grade +1 예약(이미 예약돼 있으면 유지).
    if (this.comboCount >= COMBO_GRADE_STEP && this.comboCount % COMBO_GRADE_STEP === 0) {
      this._comboGradeBumpPending = true;
    }
    this._updateComboHud();
  }

  // 콤보 HUD 갱신 — 카운터 텍스트/색 티어 + 팝. COMBO_HUD_MIN 미만이면 숨김(1킬 노이즈 방지).
  _updateComboHud() {
    if (!this.comboText) return;
    if (this.comboCount < COMBO_HUD_MIN) {
      this.comboText.setVisible(false);
      return;
    }
    const isMilestone = this.comboCount >= COMBO_GRADE_STEP && this.comboCount % COMBO_GRADE_STEP === 0;
    const color = isMilestone
      ? '#ff6020'
      : this.comboCount >= COMBO_GRADE_STEP
        ? '#ff8a3a'
        : this.comboCount >= 5
          ? '#ffd24a'
          : '#cbb89a';
    this.comboText
      .setText(isMilestone ? `COMBO ×${this.comboCount}  등급↑` : `COMBO ×${this.comboCount}`)
      .setColor(color)
      .setPosition(Math.round(LOGICAL.width / 2), 31)
      .setVisible(true);

    if (!this.motionOk) {
      this.comboText.setScale(1).setAlpha(1);
      return;
    }
    // 팝 — 마일스톤은 더 크게 튕겨 "보너스" 체감.
    this.tweens.killTweensOf(this.comboText);
    this.comboText.setAlpha(1).setScale(isMilestone ? 1.5 : 1.22);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 160, ease: 'Back.out' });
  }

  // 콤보 소멸 — 카운터/만료시각 리셋 + HUD 슬라이드아웃. immediate=true(teardown)면 즉시 숨김.
  // 등급 상승 예약(_comboGradeBumpPending)은 여기서 건드리지 않는다 — 이미 획득한 보너스라 다음 드롭에서 소비.
  _resetCombo(immediate = false) {
    this.comboCount = 0;
    this.comboExpireAt = 0;
    if (!this.comboText) return;
    this.tweens.killTweensOf(this.comboText);
    if (immediate || !this.motionOk || !this.comboText.visible) {
      this.comboText.setVisible(false).setScale(1).setAlpha(1).setPosition(Math.round(LOGICAL.width / 2), 31);
      return;
    }
    this.tweens.add({
      targets: this.comboText,
      alpha: 0,
      y: 23,
      duration: 220,
      ease: 'Quad.in',
      onComplete: () => {
        if (this.comboText) {
          this.comboText.setVisible(false).setAlpha(1).setScale(1).setPosition(Math.round(LOGICAL.width / 2), 31);
        }
      }
    });
  }

  // 콤보 등급 상승 보너스 적용 — 떨어진 재료 중 최저 등급 1개를 grade+1 재료로 치환.
  // 재료가 안 떨어졌으면 grade2 재료 1개를 강제 추가(빈손 방지). 최고등급(3)만 떨어진 드문 경우엔 생략.
  _applyComboGradeBump(drop) {
    let lowKey = null;
    let lowGrade = 99;
    for (const k of MATERIAL_ORDER) {
      if (drop[k] && MATERIAL_META[k].grade < lowGrade) {
        lowGrade = MATERIAL_META[k].grade;
        lowKey = k;
      }
    }
    const targetGrade = (lowKey ? lowGrade : 1) + 1;
    const pool = MATERIAL_ORDER.filter((k) => MATERIAL_META[k].grade === targetGrade);
    if (!pool.length) return; // 이미 최고 등급만 떨어짐 — 보너스 생략(아주 드묾)
    const up = pool[Math.floor(Math.random() * pool.length)];
    if (lowKey) {
      drop[lowKey] -= 1;
      if (drop[lowKey] <= 0) delete drop[lowKey];
    }
    drop[up] = (drop[up] || 0) + 1;
  }

  // ── 위험 적 등장 경고 ───────────────────────────────────────────────────
  // director가 엘리트/그래버 스폰 시 호출. 2.5s 쿨다운으로 스팸 억제(스폰 빈도와 무관하게 절제).
  // 엘리트는 미세 카메라 셰이크까지(rare), 그래버는 라벨만. reduced-motion은 _showThreatWarning이 처리.
  onThreatSpawn(enemy, info) {
    if (!this.combatReady || this.deathLayer || this.upgradeLayer || this._bossActive) return;
    const now = this.time.now;
    if (now < (this._threatWarnUntil || 0)) return; // 쿨다운 중 — 연속 경고 생략
    this._threatWarnUntil = now + 2500;
    if (info.elite) {
      this._showThreatWarning('⚠ 엘리트 출현', '#ffb030');
      if (this.motionOk && this.cameras?.main) this.cameras.main.shake(90, 0.0035); // 미세 셰이크
    } else {
      this._showThreatWarning('⚠ 그래버 — 속박 주의', '#9ab4dc');
    }
  }

  // 위험 경고 라벨 — 적이 진입하는 우측 가장자리에서 슬라이드인 → 유지 → 페이드아웃.
  // 토스트 슬롯(드롭/웨이브)과 겹치지 않게 별도 우측 라벨로 분리. 누수 0(onComplete destroy).
  _showThreatWarning(text, color) {
    const x = LOGICAL.width - 8;
    const y = COMBAT_H * 0.22;
    const t = this.add
      .text(x, y, text, { fontFamily: BODY_FONT, fontSize: '12px', color })
      .setOrigin(1, 0.5)
      .setDepth(73);
    t.setShadow(1, 1, '#000000', 0, false, true);
    this._threatWarnText = t; // teardown이 회수할 수 있게 보관(쿨다운으로 동시 1개)

    if (!this.motionOk) {
      this.time.delayedCall(900, () => { if (t.active) t.destroy(); });
      return;
    }
    t.setAlpha(0).setX(x + 12);
    this.tweens.add({
      targets: t,
      alpha: 1,
      x,
      duration: 160,
      ease: 'Back.out',
      onComplete: () => {
        this.time.delayedCall(700, () => {
          if (!t.active) return;
          this.tweens.add({
            targets: t,
            alpha: 0,
            x: x - 8,
            duration: 220,
            ease: 'Quad.in',
            onComplete: () => { if (t.active) t.destroy(); }
          });
        });
      }
    });
  }

  // ── 보스 인카운터 (10웨이브마다) ───────────────────────────────────────
  // 진입 → 보스 텍스처 지연로드 → 잡몹 스폰 중단 + 보스 1체 스폰 + 큰 HP바 + 인트로 배너.
  // 처치 → 보상(코인/희귀재료 확정) + 설계도 해금 + 업그레이드 카드 → 일반 스폰 재개.
  // 모든 무거운 처리는 freeze 방어 패턴(다음 틱 defer, 가드, 폴백)을 따른다.
  startBossEncounter(waveIndex) {
    // 가드 — 이미 보스전/오버레이 중이거나 전투 미준비면 발동 안 함(중복 방지).
    if (this._bossActive || this.deathLayer || this.upgradeLayer) return;
    if (!this.combatReady || !this.director) return;

    this._bossActive = true;
    this.bossWaveIndex = waveIndex;
    this.director.suppressSpawn = true; // 잡몹 스폰 중단(화면의 기존 잡몹은 그대로 소진)

    const stats = bossStatsForWave(waveIndex);
    this.loadEncounterBoss(stats.key, (ok) => {
      // 로드 도중 사망/재시작으로 보스전이 무효화됐으면 중단(teardown이 플래그를 내림).
      if (!this._bossActive || !this.director) return;
      // 로드 실패 폴백 — 보스전 취소 후 일반 스폰 재개(전투 영구정지 방지).
      if (!ok) {
        console.error('[boss load]', stats.key);
        this._bossActive = false;
        this.director.suppressSpawn = false;
        return;
      }
      // 보스 등장 — 우측 밖에서 진입. def에 깊이 스케일된 damage를 합쳐 주입.
      this.boss = this.director.spawnBoss({
        typeKey: stats.key,
        def: { ...stats.def, damage: stats.damage },
        maxHP: stats.maxHP,
        onDeath: () => this.onBossDefeated()
      });
      this.boss._phaseIdx = 0; // 페이즈 전이 진행 인덱스(정수 가드) — 새 보스마다 0에서 시작(누수 0)
      this.createBossHpBar(stats);
      this.showBossBanner(stats);
    });
  }

  // 보스 처치(Enemy.die→onDeath) — director.update 콜스택 안에서 동기 호출되므로
  // 보상/오버레이는 다음 틱으로 defer(공격 트윈 체인 freeze 방어와 동일 패턴).
  onBossDefeated() {
    if (!this._bossActive) return;
    SFX.play('boss_down'); // 보스 처치 승리 스팅어
    this._bossActive = false;
    if (this.director) this.director.suppressSpawn = false; // 일반 웨이브 스폰 재개

    // 보스 처치 누적 — deriveStage powerScore bossBonus(+3/처치) 신호. 'change'로 단계 재파생 트리거.
    GameState.runBossKills += 1;
    GameState._markRunDirty();
    GameState.emit('change');

    const wi = this.bossWaveIndex;
    // 보상 연출 기준 좌표는 지금(보스 die 직후) 캡처 — 이후 사망 트윈으로 컨테이너가 사라짐.
    const ox = this.boss?.container?.x ?? this.character.x;
    const oy = (this.boss?.container?.y ?? this.groundY) - 40;
    this.boss = null;
    this.hideBossHpBar(); // 상단 보스바 페이드아웃

    this.time.delayedCall(0, () => {
      try {
        this.grantBossReward(ox, oy, wi);
        // 보스 처치 보상으로 업그레이드 카드 — %10/%5 이중발동을 여기로 일원화.
        this.showUpgradeOverlay(wi);
      } catch (e) {
        console.error('[boss defeat]', e);
      }
    });
  }

  // 보스 처치 보상 — 코인(깊이 가산) + 희귀 재료 확정 + 설계도 해금. 줍기 연출 재사용.
  grantBossReward(x, y, waveIndex) {
    const stats = bossStatsForWave(waveIndex);
    const reward = stats.def.reward || { coins: 0, materials: {} };

    // 코인 — 보스 깊이(tier)로 가산. 즉시 자동 가산 + 우상단 HUD로 빨려가기(잡몹 경로 재사용).
    const coins = Math.round((reward.coins || 0) * (1 + 0.25 * stats.tier));
    if (coins > 0) {
      GameState.applyDrop({ coins }, x, y);
      this.flyPickup(
        { key: 'coins', tex: TEX.COIN_REWARD, color: COMBAT_COLORS.gold },
        x,
        y,
        this.resHud.coins,
        0
      );
    }

    // 희귀 재료 확정 — 한 번에 가산(단일 'drop' 이벤트 → 토스트 1회, 스팸 억제) + 종별 팝.
    const matDelta = { ...(reward.materials || {}) };
    if (Object.keys(matDelta).length) {
      GameState.applyDrop(matDelta, x, y);
      let idx = 0;
      for (const key of MATERIAL_ORDER) {
        if (!matDelta[key]) continue;
        const sx = x + Phaser.Math.Between(-DROP.spreadX, DROP.spreadX);
        this.popMaterial(key, matDelta[key], sx, y, idx, true);
        idx++;
      }
    }

    // 미발견 무기 설계도 1종 해금(도감 기록만 — 무기 즉시 지급은 아님). 다 발견했으면 생략.
    this.unlockBossRecipe();
  }

  // 미발견 레시피 1종을 도감에 기록(recordCodex). pipe_wrench(기본) 제외, 이미 발견분 제외.
  unlockBossRecipe() {
    const discovered = GameState.meta.codex.discoveredRecipes;
    const undiscovered = Object.keys(WEAPON_RECIPES).filter(
      (id) => id !== 'pipe_wrench' && !discovered.includes(id)
    );
    if (undiscovered.length === 0) return;
    const pick = undiscovered[Math.floor(Math.random() * undiscovered.length)];
    GameState.recordCodex(pick);
    const rec = WEAPON_RECIPES[pick];
    this.showToast(`설계도 입수: ${rec?.name || pick}`, rec && this.textures.exists(pick) ? pick : null, true);
  }

  // ── 보스 HP바 (화면 상단 큰 바 — 머리 위 작은 바와 별개) ───────────────────
  // 좌상단 HP/웨이브 HUD 아래(y≈74)에 가로 풀폭으로 깔아 눈에 띄게. depth 74:
  // 일반 HUD(60~61)보다 위, 웨이브 배너(75)/보스 배너(76)보다 아래(배너가 잠깐 위를 덮음).
  // 사망/업그레이드 오버레이(88/90)보다는 당연히 아래.
  createBossHpBar(stats) {
    this.removeBossHpBar(); // 안전 — 이전 잔여 핸들 제거
    const W = LOGICAL.width;
    const barW = W - 32;
    const barH = 12;
    const x = 16;
    // 좌상단 웨이브 HUD(HP바~웨이브 진행바, y8~68)와 안 겹치게 그 아래로. (기존 52는 웨이브바와 충돌)
    const y = 74;

    const container = this.add.container(0, 0).setDepth(74);
    const frame = this.add
      .rectangle(W / 2, y + barH / 2, barW + 6, barH + 6, 0x000000, 0.6)
      .setStrokeStyle(1, COMBAT_COLORS.danger, 0.8);
    const track = this.add.rectangle(x, y, barW, barH, 0x2a1008).setOrigin(0, 0);
    const fill = this.add.rectangle(x, y, barW, barH, COMBAT_COLORS.danger).setOrigin(0, 0);
    const name = this.add
      // 이름 색을 HP바 테두리/채움(danger 빨강)과 같은 위험 톤으로 통일(기존 살구색 #ff8a6a는 따로 놀았음).
      // 10px 소형 텍스트라 순수 danger(#ff2a2a)보다 살짝 밝혀 가독 확보 + 검정 그림자.
      .text(W / 2, y + barH + 9, `⚠ BOSS · ${stats.def.name}`, {
        fontFamily: BODY_FONT, // 한글 보스명 — 픽셀 10px 자소 뭉갬, BODY 11px로
        fontSize: '13px',
        color: '#ff5a4a'
      })
      .setOrigin(0.5);
    name.setShadow(1, 1, '#000000', 0, false, true);

    container.add([frame, track, fill, name]);
    this.bossHpBar = { container, fill, barW };

    if (this.motionOk) {
      container.setAlpha(0);
      this.tweens.add({ targets: container, alpha: 1, duration: 220, ease: 'Quad.out' });
    }
  }

  // 매 프레임 보스 HP 비율로 바 폭 갱신(rectangle width 1회 — cheap). update()에서 호출.
  updateBossHpBar() {
    if (!this.bossHpBar || !this.boss) return;
    const boss = this.boss;
    const ratio = Phaser.Math.Clamp(boss.hp / boss.maxHP, 0, 1);
    this.bossHpBar.fill.width = this.bossHpBar.barW * ratio;
    // 보스 페이즈 — phases 배열을 임계 교차 시 순서대로 1회씩 발동(_phaseIdx 정수 가드).
    // 0.66 페이즈가 0.5 분노보다 먼저 걸린다(둘은 독립 — 분노는 아래 별도 가드).
    const phases = boss.def.phases;
    if (phases && boss._phaseIdx < phases.length && !boss.dead) {
      const next = phases[boss._phaseIdx];
      if (ratio <= next.atRatio) {
        boss._phaseIdx += 1;
        this._enterBossPhase(boss, next);
      }
    }
    // 분노 페이즈 — HP 50% 아래로 처음 떨어지면 1회 가속(_enraged 가드). boss는 teardown 시 파괴돼 누수 0.
    if (!boss._enraged && ratio < 0.5 && !boss.dead) this._enrageBoss(boss);
  }

  // 보스 분노 진입(1회) — 이동속도 ×1.9, 공격쿨 ×0.65(getAttackCooldown이 def.attackCooldown 읽음).
  // 진입 연출: white tint 플래시 + 카메라 셰이크(motionOk 게이트) + ENRAGED 토스트.
  _enrageBoss(boss) {
    boss._enraged = true;
    boss.speed *= 1.9;
    // def는 spawnBoss에서 만든 per-boss 복사본({...stats.def,damage})이라 직접 변형해도 원본 BOSS_TYPES 불변.
    boss.def.attackCooldown = Math.max(200, Math.round(boss.def.attackCooldown * 0.65));
    this.showToast('ENRAGED', null, true);
    SFX.play('boss_intro'); // 위협 강조 스팅어(보스 등장 톤 재사용)

    // tint 플래시는 모션이 아니므로 reduced-motion에도 유지(짧게 white → restoreTint로 복원). 단일 delayedCall.
    if (boss.sprite?.active) {
      boss.sprite.setTint(0xffffff);
      this.time.delayedCall(120, () => { if (!boss.dead && boss.sprite?.active) boss.restoreTint(); });
    }
    if (this.motionOk) this.cameras.main.shake(180, 0.006);
  }

  // 보스 페이즈 전이(1회) — 전이 플래시+셰이크(motionOk 게이트) 후 action별 효과.
  // action은 문자열 키(BOSS_TYPES.phases) — 데이터는 순수하게 두고 효과는 여기서 분기.
  _enterBossPhase(boss, phase) {
    // 전이 플래시 — 모션이 아니므로 reduced-motion에도 유지(짧은 white → restoreTint). 단일 delayedCall.
    if (boss.sprite?.active) {
      boss.sprite.setTint(0xffffff);
      this.time.delayedCall(110, () => { if (!boss.dead && boss.sprite?.active) boss.restoreTint(); });
    }
    if (this.motionOk) this.cameras.main.shake(160, 0.005);

    switch (phase.action) {
      case 'guardUp':
        // 콜로서스 — 방어 자세(guard 행동 스왑) + 가속. behavior 스왑은 def/Enemy 양쪽 동기화.
        boss.def.behavior = { type: 'guard', reduce: 0.65 };
        boss.behavior = ENEMY_BEHAVIORS.guard;
        boss.guarding = true;
        boss.speed *= 1.25;
        boss.restoreTint(); // guard 강철빛 tint 노출
        this.showToast('방어 태세', null, true);
        SFX.play('boss_intro');
        break;
      case 'summonAdds':
        // 헤럴드 — 일반 좀비 소환(스태거, 보스 포함 alive≤5 캡).
        this._bossSummonAdds(boss);
        this.showToast('증원 소환', null, true);
        SFX.play('boss_intro');
        break;
      default:
        break;
    }
  }

  // 헤럴드 페이즈 소환 — sludge_zombie 2체를 150~200ms 스태거로. 동시 다중 spawn 금지·alive≤5 캡.
  // delayedCall은 scene 타이머(per-enemy 아님)라 perf 안전. teardown/보스사망 가드로 유령 소환 차단.
  _bossSummonAdds(boss) {
    const adds = ['sludge_zombie', 'sludge_zombie'];
    adds.forEach((key, i) => {
      this.time.delayedCall(i * 170, () => {
        if (!this._bossActive || !this.director || boss.dead) return;
        if (this.director.aliveCount() >= 5) return; // 보스 포함 동시 ≤5
        this.director.spawnAdd(key);
      });
    });
  }

  // 보스 처치 시 — 페이드아웃 후 제거(정상 종료). reduced-motion/teardown은 즉시 제거.
  hideBossHpBar() {
    if (!this.bossHpBar) return;
    const handle = this.bossHpBar;
    this.bossHpBar = null; // 즉시 참조 끊어 update가 안 건드리게
    if (!this.motionOk || !handle.container.active) {
      handle.container.destroy();
      return;
    }
    this.tweens.add({
      targets: handle.container,
      alpha: 0,
      duration: 260,
      ease: 'Quad.in',
      onComplete: () => handle.container.destroy()
    });
  }

  // 즉시 제거(teardown/재시작) — 트윈 없이 핸들 회수.
  removeBossHpBar() {
    if (!this.bossHpBar) return;
    this.tweens.killTweensOf(this.bossHpBar.container);
    this.bossHpBar.container.destroy();
    this.bossHpBar = null;
  }

  // 보스 등장 인트로 배너 — 웨이브 배너 톤 재사용(스케일인→유지→스케일업+페이드). depth 76(배너 75 위).
  showBossBanner(stats) {
    SFX.play('boss_intro'); // 묵직한 보스 등장 톤
    // 웨이브 배너(0.3H)와 겹치지 않게 아래쪽(0.46H)에 — 같은 순간 둘 다 떠도 분리돼 읽힌다.
    const banner = this.add.container(LOGICAL.width / 2, COMBAT_H * 0.46).setDepth(76);
    const main = this.add
      .text(0, 0, 'BOSS', {
        fontFamily: PIXEL_FONT,
        fontSize: '30px',
        color: '#ff2a2a',
        stroke: '#1a0404',
        strokeThickness: 5
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(0, 24, stats.def.name, {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: '#ffd24a'
      })
      .setOrigin(0.5);
    sub.setShadow(1, 1, '#000000', 0, false, true);
    banner.add([main, sub]);

    if (!this.motionOk) {
      this.time.delayedCall(900, () => banner.destroy());
      return;
    }

    banner.setScale(0.5).setAlpha(0);
    this.tweens.add({
      targets: banner,
      scale: 1,
      alpha: 1,
      duration: MOTION.waveBannerInMs,
      ease: 'Back.out',
      onComplete: () => {
        // 위협 강조 — 착지 후 가벼운 펄스 1회(yoyo).
        this.tweens.add({
          targets: banner,
          scaleX: 1.08,
          scaleY: 1.08,
          duration: MOTION.waveBannerNewPulseMs,
          ease: 'Quad.out',
          yoyo: true
        });
        this.time.delayedCall(MOTION.waveBannerStayMs + 200, () => {
          if (!banner.active) return;
          this.tweens.add({
            targets: banner,
            scale: 1.25,
            alpha: 0,
            duration: MOTION.waveBannerOutMs,
            ease: 'Quad.in',
            onComplete: () => banner.destroy()
          });
        });
      }
    });
  }

  // 화면(전투 뷰) 탭 = 공격 가속 — 사거리 내 가장 가까운 적에게 즉시 추가 평타를 꽂는다.
  // 자동 평타 쿨다운과 독립: 탭은 쿨다운을 무시하고 바로 때려 DPS를 올린다.
  // 가드: 오버레이 중·전투 미준비·모션 진행 중·최소 간격 미만 연타는 무시(애니/성능 보호).
  onCombatTap(pointer) {
    const cam = this.cameras.main;
    // 환경설정 톱니 버튼 히트(오버레이 없을 때만 — 그때만 버튼이 보임) → 설정 씬을 열고 공격 안 함.
    // _settingsBounds는 월드(360) 좌표 — 포인터(백버퍼 720)를 카메라 역변환(getWorldPoint)해 비교한다.
    // 카메라 줌(RENDER_SCALE)/오프셋 뷰포트가 자동 반영돼 좌표계가 어긋나지 않는다.
    const sb = this._settingsBounds;
    if (sb && !this.deathLayer && !this.upgradeLayer) {
      const wp = cam.getWorldPoint(pointer.x, pointer.y);
      if (
        wp.x >= sb.x && wp.x <= sb.x + sb.w &&
        wp.y >= sb.y && wp.y <= sb.y + sb.h
      ) {
        if (!this.scene.isActive('SettingsScene')) this.scene.launch('SettingsScene');
        return;
      }
    }
    // 사망/업그레이드 오버레이가 떠 있으면 탭 공격 안 함(오버레이 입력과 충돌 방지).
    if (this.deathLayer || this.upgradeLayer) return;
    if (!this.combatReady || !this.director) return;
    // 이미 공격 모션 진행 중이면 큐잉하지 않고 무시 — 트윈 리셋 반복으로 모션이 깨지는 걸 방지.
    if (this._attacking) return;
    // 속박(grab) 중이면 탭 공격도 봉쇄 — 자동공격 게이트(director)와 일관.
    if (this.time.now < this.playerBindUntil) return;
    // 최소 간격 가드 — 140ms 미만 연타는 무시.
    const now = this.time.now;
    if (now - this._lastTapAttack < 140) return;

    // Combat 뷰포트(상단) 밖 터치(=Hub 영역)는 무시. 포인터·뷰포트 모두 백버퍼(720) 공간이라 직접 비교.
    if (
      pointer.x < cam.x || pointer.x > cam.x + cam.width ||
      pointer.y < cam.y || pointer.y > cam.y + cam.height
    ) {
      return;
    }

    // 사거리 내 가장 가까운(=worldX 최솟값) 살아있는 적 1체. 없으면 헛스윙 없이 무시.
    const inRange = this.director.enemiesInRange(this.playerX, PLAYER.attackRange);
    const target = inRange.find((e) => !e.dead);
    if (!target) return;

    this._lastTapAttack = now;
    this.playerAttack(target); // 쿨다운 무시 즉시타 — dealDamage 경로 그대로(런 모디파이어/적기억 유효)

    // 온보딩 — 첫 탭 성공(실제 공격 발동) 1회 피드백 + 영구 완료(다신 안 뜸).
    if (this._onboardPending && !GameState.meta.onboarded) {
      this._onboardPending = false;
      this._onboardTimer?.remove();
      this._onboardTimer = null;
      GameState.markOnboarded();
      this.showToast('공격 가속!', null, true);
    }
  }

  // 재료 자동 획득 — 코인처럼 즉시 가산 + 팝→인벤 빨려가기 연출(popMaterial fromTap).
  // 상시 자동이라 "자동수집" 태그는 띄우지 않는다(매번 띄우면 시끄러움) — 팝 모션만 유지.
  // idx: 같은 처치에서 나온 순번 → 팝 스태거(겹침 방지).
  autoCollectMaterial(matKey, count, x, y, idx = 0) {
    GameState.applyDrop({ [matKey]: count }, x, y);
    this.popMaterial(matKey, count, x, y, idx, true);
  }

  takePlayerDamage(amount) {
    if (this.playerHP <= 0) return;
    // R9 first_hit_shield — 방벽 차지가 남아있으면 이 피해를 통째로 무효화하고 1 소모.
    if (this.waveShield > 0) {
      this.waveShield -= 1;
      this.showShieldBlock();
      return;
    }
    // 방어력 피해감소 적용(적→플레이어). def*4%, 캡 20%. + 난이도 곡선(초반 쉽게→후반 원래대로).
    const dmg = Math.max(1, Math.round(amount * defenseMultiplier(GameState.stats.def) * difficultyDmgMult(GameState.waveIndex)));
    this.playerHP = Math.max(0, this.playerHP - dmg);
    GameState.waveHitFlag = true; // 무피해 클리어(CLEAN SWEEP) 무효화 — 실제 피해를 입은 웨이브로 기록
    this.updateHpBar();
    this.flashPlayer();
    SFX.play('player_hurt'); // 피격 buzz(throttle로 다단 히트 스팸 억제)
    this.spawnDamageNumber(
      this.character.x,
      this.groundY - this.charDisplayH * 0.7,
      dmg,
      COMBAT_CSS.playerHurt
    );

    const ratio = this.playerHP / this.maxHP;
    this.triggerDangerPulse(ratio <= PLAYER.dangerThreshold && this.playerHP > 0, ratio);

    if (this.playerHP <= 0) {
      this._startPlayerDeathAnim();             // death 프레임(1회 → 마지막 프레임 정지)
      this._triggerDeathFlash(() => this.onPlayerDeath());
    }
  }

  // [프레임 애니] 피격 — 붉은 tint 플래시(주스)는 보존, 몸 흔들림은 hit 프레임이 담당.
  // 공격/사망 중엔 모션을 가로채지 않고 tint만(공격 스윙·사망 포즈 보호).
  flashPlayer() {
    this.character.setTint(0xff5050);
    this.time.delayedCall(120, () => { if (this.character?.active) this.character.clearTint(); });
    if (!this.motionOk || this._attacking || this._playerDead) return;
    const key = this._animKey(this.characterStage, 'hit');
    if (this.anims.exists(key)) this.character.play(key); // onComplete → walk 복귀
  }

  // [프레임 애니] 사망 — death 프레임 1회 재생 후 마지막 프레임 정지(_onPlayerAnimComplete).
  // idle bob을 멈춰 사망 포즈가 흔들리지 않게. reduced-motion은 idle 프레임 고정.
  _startPlayerDeathAnim() {
    this._playerDead = true;
    this.idleBobTween?.pause();
    if (this._attacking) this._forceAttackRecover();
    const atlasKey = ANIM_MANIFEST[this.characterStage]?.key;
    if (!this.motionOk) {
      if (atlasKey && this.textures.exists(atlasKey)) {
        this.character.setTexture(atlasKey, CHARACTER_ANIM.idleFrame);
      }
      return;
    }
    const key = this._animKey(this.characterStage, 'death');
    if (this.anims.exists(key)) this.character.play(key);
  }

  // ── 속박(grab) ──────────────────────────────────────────────────────────
  // 근접 grab 적이 닿으면 ms 동안 자동공격/탭을 봉쇄한다(director.player.isBound로 게이트).
  // 시각 신호는 draw-once 테더(매 프레임 재그리기 없음) — grabberX↔player 라인 + 발목 마디.
  // grabberX는 접촉 시점 좌표(grabber는 contactRange에 멈춰 거의 정지라 정적 테더로 충분).
  bindPlayer(ms, grabberX = null) {
    this.playerBindUntil = Math.max(this.playerBindUntil, this.time.now + ms);
    this._showBindTether(grabberX);
  }

  _showBindTether(grabberX) {
    this._clearBindTether();
    // 속박 = 그래버가 플레이어를 당기는 "사슬". 납작한 직선이 레이저처럼 보이던 문제 →
    // 살짝 처진 곡선(2차 베지어) 위에 사슬 마디(작은 원)를 깔아 물리적 당김으로 읽히게.
    const py = this.groundY - this.charDisplayH * 0.5; // 몸 중앙 높이(바닥 직선 회피)
    const gx = grabberX != null ? grabberX : this.playerX + 70;
    const x0 = this.playerX, x2 = gx;
    const sag = 9; // 중앙 처짐(px) — 팽팽한 직선이 아니라 끌려가는 느낌
    const cx = (x0 + x2) / 2, cy = py + sag; // 베지어 제어점(아래로)
    const g = this.add.graphics().setDepth(this.parallax.topDepth + 2);
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x2;
      const y = mt * mt * py + 2 * mt * t * cy + t * t * py;
      // 마디 — 끝(앵커)은 크게, 중간 사슬은 작게. 홀짝으로 밝기 교차해 사슬 질감.
      const isAnchor = i === 0 || i === N;
      g.fillStyle(0xc060ff, isAnchor ? 1 : (i % 2 ? 0.9 : 0.55));
      g.fillCircle(x, y, isAnchor ? 3.5 : 2);
    }
    this._bindTether = g;
    if (this.motionOk) {
      this._bindTetherTween = this.tweens.add({
        targets: g,
        alpha: 0.4,
        duration: 150,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }

  // 독 투척 — 적 사망 위치에서 플레이어로 독 글롭이 포물선으로 날아간다. 도달 시 플레이어에 독 DoT(ticks틱).
  // 위치 기반 웅덩이의 '회피 불가' 문제를 피하려 투사체→경계 있는 DoT로 단순화("두 번 맞고 끝").
  // reduced-motion: 연출(글롭/포물선) 생략하고 즉시 DoT만 적용(공정성 유지).
  throwPoison(fromX, fromY, dmg, ticks) {
    const tx = this.playerX;
    const ty = this.groundY - this.charDisplayH * 0.5;
    const apply = () => this.applyPlayerPoison(dmg, ticks);
    if (!this.motionOk) { apply(); return; }
    const glob = this.add
      .ellipse(fromX, fromY, 12, 12, COMBAT_COLORS.toxicGlow, 0.95)
      .setStrokeStyle(1.5, COMBAT_COLORS.hazard, 0.7)
      .setDepth(this.parallax.topDepth + 4)
      .setBlendMode(Phaser.BlendModes.ADD);
    // 포물선 — x는 선형 보간, y는 위로 솟았다 떨어지는 아치(onUpdate에서 sin).
    const dur = 420;
    const arc = { t: 0 };
    this.tweens.add({
      targets: arc,
      t: 1,
      duration: dur,
      ease: 'Linear',
      onUpdate: () => {
        const t = arc.t;
        glob.x = fromX + (tx - fromX) * t;
        glob.y = fromY + (ty - fromY) * t - Math.sin(t * Math.PI) * 40; // 40px 아치
      },
      onComplete: () => {
        if (glob.active) glob.destroy();
        // 착탄 스플랫 — 플레이어 발치에 짧은 녹색 퍼프(생성→tween→destroy).
        const splat = this.add
          .ellipse(tx, ty, 18, 10, COMBAT_COLORS.toxicGlow, 0.8)
          .setDepth(this.parallax.topDepth + 4)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: splat, scaleX: 2, scaleY: 2, alpha: 0, duration: 240, ease: 'Quad.out',
          onComplete: () => { if (splat.active) splat.destroy(); }
        });
        apply();
      }
    });
  }

  // 플레이어 독 DoT — 단일 슬롯, ticks회 틱 후 종료. per-enemy식 타이머 없이 update 루프가 now 비교로 구동.
  // 재적용은 풀 리셋(겹침=갱신). teardown에서 _playerPoison 리셋.
  applyPlayerPoison(dmg, ticks) {
    this._playerPoison = {
      dmg,
      ticksLeft: ticks,
      nextAt: this.time.now + 420 // 첫 틱까지 짧은 유예(착탄 직후 즉발 0)
    };
  }

  // update()에서 매 프레임 호출 — 독 DoT 틱 처리(scene.time.now 비교, 새 타이머 0).
  _updatePlayerPoison(now) {
    const p = this._playerPoison;
    if (!p || p.ticksLeft <= 0 || this.playerHP <= 0) return;
    if (now < p.nextAt) return;
    this.takePlayerDamage(p.dmg); // 방어/방벽/사망 처리 재사용
    if (!this.combatReady) { this._playerPoison = null; return; } // 사망→teardown 재진입 가드
    p.ticksLeft -= 1;
    p.nextAt = now + 620; // 틱 간격
    if (p.ticksLeft <= 0) this._playerPoison = null;
  }

  _clearBindTether() {
    this._bindTetherTween?.stop();
    this._bindTetherTween = null;
    if (this._bindTether) {
      this._bindTether.destroy();
      this._bindTether = null;
    }
  }

  // ── 독웅덩이(hazard pool) ───────────────────────────────────────────────
  // poolOnDeath 행동이 ctx.spawnHazard로 호출. draw-once Shape(타원) + alpha/scale 펄스 tween만.
  // 동시 3개 캡(초과 시 가장 오래된 것 회수). reduced-motion에도 존은 생성(게임플레이) — 펄스만 생략.
  spawnHazard(x, radius, dmg, durationMs) {
    // 캡 초과 — 가장 오래된 존부터 회수(배열 앞이 오래된 것).
    while (this._hazards.length >= HAZARD_MAX) this._removeHazard(this._hazards[0], 0);

    const now = this.time.now;
    const y = this.groundY - 2; // 발치 바닥에 깔림
    // draw-once 타원 Shape — 매 프레임 graphics.clear/재그리기 금지(perf 핵심). 깊이는 캐릭터(+1) 아래.
    const gfx = this.add
      .ellipse(x, y, radius * 2, radius * 0.7, COMBAT_COLORS.hazard, 0.26)
      .setStrokeStyle(1.5, COMBAT_COLORS.toxic, 0.6)
      .setDepth(this.parallax.topDepth + 0.4);

    const hz = {
      x,
      r: radius,
      dmg,
      expiresAt: now + durationMs,
      nextTickAt: now + HAZARD_FIRST_TICK_MS,
      gfx,
      pulse: null
    };

    if (this.motionOk) {
      gfx.setScale(0.85);
      // 등장 팝 후 청록 alpha/scale 펄스(repeat:-1). 회수 시 .stop().
      hz.pulse = this.tweens.add({
        targets: gfx,
        alpha: 0.46,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 560,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
    this._hazards.push(hz);
  }

  // 단일 update 틱 — 만료 회수(reverse-splice) + 플레이어가 존 안이면 nextTick 도달 시 1틱.
  // canTick=false(오버레이 중)면 피해는 멈추되 만료 청소는 계속(누수 0).
  _updateHazards(now, canTick) {
    if (this._hazards.length === 0) return;
    for (let i = this._hazards.length - 1; i >= 0; i--) {
      const hz = this._hazards[i];
      if (now >= hz.expiresAt) {
        this._removeHazard(hz, i);
        continue;
      }
      if (
        canTick &&
        now >= hz.nextTickAt &&
        this.playerHP > 0 &&
        Math.abs(this.playerX - hz.x) < hz.r
      ) {
        hz.nextTickAt = now + HAZARD_TICK_MS;
        this.takePlayerDamage(hz.dmg); // 방어/방벽/사망 처리 재사용(작은 dmg → small 숫자 체감)
        // 이 틱이 사망을 유발하면 teardown이 _clearHazards로 배열을 비운다 → 순회 즉시 중단(재진입 가드).
        if (!this.combatReady) return;
      }
    }
  }

  // 존 1개 회수 — 배열에서 즉시 제거(중복 처리 방지) 후 펄스 stop + gfx 페이드아웃 destroy.
  _removeHazard(hz, idx) {
    this._hazards.splice(idx, 1);
    hz.pulse?.stop();
    const g = hz.gfx;
    if (!g?.active) return;
    if (!this.motionOk) {
      g.destroy();
      return;
    }
    (this._hazardFx ||= []).push(g); // 페이드 중 gfx 추적 — teardown이 이 200ms 창에 끼어도 회수.
    this.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 0.6,
      scaleY: 0.6,
      duration: 200,
      ease: 'Quad.in',
      onComplete: () => {
        const fx = this._hazardFx;
        if (fx) { const i = fx.indexOf(g); if (i >= 0) fx.splice(i, 1); }
        if (g.active) g.destroy();
      }
    });
  }

  // 전체 정리(teardown/재시작) — 펄스 stop + 진행 트윈 kill + Shape destroy + 배열 비움(페이드 중 gfx 포함).
  _clearHazards() {
    for (const hz of this._hazards) {
      hz.pulse?.stop();
      if (hz.gfx?.active) {
        this.tweens.killTweensOf(hz.gfx);
        hz.gfx.destroy();
      }
    }
    this._hazards.length = 0;
    if (this._hazardFx) {
      for (const g of this._hazardFx) {
        if (g?.active) { this.tweens.killTweensOf(g); g.destroy(); }
      }
      this._hazardFx.length = 0;
    }
  }

  // [모션 훅] 사망 확정 순간 붉은 화면 플래시 — "당했다" 강조. 과하지 않게 짧고 강하게.
  // reduced-motion 시 즉시 after() 호출.
  _triggerDeathFlash(after) {
    if (!this.motionOk) {
      after();
      return;
    }
    const flash = this.add
      .rectangle(0, 0, LOGICAL.width, COMBAT_H, 0xcc1800, 0)
      .setOrigin(0, 0)
      .setDepth(80);

    this.tweens.add({
      targets: flash,
      alpha: MOTION.deathFlashAlpha,
      duration: MOTION.deathFlashMs,
      ease: 'Quad.out',
      onComplete: () => {
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: MOTION.deathFlashOutMs,
          ease: 'Quad.in',
          onComplete: () => {
            flash.destroy();
            after();
          }
        });
      }
    });
  }

  // 주인공 사망 → 런 종료. 전투를 내리고 사망 오버레이(요약 + 유산 선택)를 띄운다.
  onPlayerDeath() {
    SFX.play('death'); // 하강 사망 톤
    this.teardownEncounter();
    this.triggerDangerPulse(false);
    this.character.clearTint();
    // R5 — 이번 런에서 누적된 적기억 tally를 즉시 영속(런 종료 1회, 핫패스 아님).
    // 사망 화면에서 탭을 닫아도 다음 런 학습이 보존된다(startNewRun도 한 번 더 저장).
    GameState.saveMeta();
    GameState.recordRunSummary(); // R7 — 직전 런 요약 기록(오버레이가 RUN #N과 함께 표시)
    this.showDeathOverlay();
  }

  // ── 사망 오버레이: 런 요약 + 유산 4선택 + "들고 시작" ───────────────────
  // [모션 훅] showDeathOverlay / hideDeathOverlay / playRunResetTransition —
  //           전환 정교화는 motion-engineer가 이 훅 위에 얹는다.
  showDeathOverlay() {
    const W = LOGICAL.width;
    const H = COMBAT_H;
    this.selectedLegacy = null;

    const layer = this.add.container(0, 0).setDepth(90);
    this.deathLayer = layer;

    // ── 풀커버 암막 ────────────────────────────────────────────────────
    const scrim = this.add.rectangle(0, 0, W, H, 0x0a0805, 0.88).setOrigin(0, 0);
    layer.add(scrim);

    // ── RUN #N (좌상단) — 로그라이크 회차 표식. runCount는 startNewRun에서 +1 되므로
    //    현재 플레이한(방금 끝난) 런 번호 = runCount+1. ─────────────────────
    const runNo = GameState.meta.runCount + 1;
    const runText = this.add
      .text(16, 50, `RUN #${runNo}`, {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#f0c040'
      })
      .setOrigin(0, 0.5);
    runText.setShadow(1, 1, '#000000', 0, false, true);
    layer.add(runText);

    // ── +N 잔해 포인트 (우상단) — RUN #N 대칭. 메타 성장 체감용(R8). spEarned>0일 때만. ──
    const spEarned = GameState.meta.lastRunSummary.spEarned || 0;
    let spText = null;
    if (spEarned > 0) {
      spText = this.add
        .text(W - 16, 50, `+${spEarned} 잔해 포인트`, {
          fontFamily: BODY_FONT, // 한글 라벨 — BODY로
          fontSize: '13px',
          color: '#20ff9a'
        })
        .setOrigin(1, 0.5);
      spText.setShadow(1, 1, '#000000', 0, false, true);
      layer.add(spText);
    }

    // ── 단계 도달(상단 중앙) — RUN#N과 SP 사이 빈 공간. "이번 N · 역대 M"으로 메타 성장 체감. ──
    const runStage = GameState.meta.lastRunSummary.stage || 1;
    const bestStage = GameState.meta.bestStage || 1;
    const stageText = this.add
      .text(W / 2, 50, `단계 ${runStage} · 역대 ${bestStage}`, {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: '#cbb89a'
      })
      .setOrigin(0.5);
    stageText.setShadow(1, 1, '#000000', 0, false, true);
    layer.add(stageText);

    // ── 타이틀 ─────────────────────────────────────────────────────────
    const titleText = this.add
      .text(W / 2, 70, '런 종료', {
        fontFamily: PIXEL_FONT,
        fontSize: '22px',
        color: '#ff6020',
        stroke: '#3a1000',
        strokeThickness: 4
      })
      .setOrigin(0.5);
    layer.add(titleText);

    // ── 런 요약(강화) — 최다 킬 / 최고 웨이브 / 획득 자원. lastRunSummary 사용. ─────
    const sum = GameState.meta.lastRunSummary;
    const summaryLines = [
      `최다 킬  ${sum.kills}`,
      `최고 웨이브  ${sum.maxWave}`,
      `획득 자원  ${sum.coins}`
    ];
    const summaryTexts = summaryLines.map((line, i) => {
      const t = this.add
        .text(W / 2, 94 + i * 14, line, {
          fontFamily: BODY_FONT, // 한글 라벨+수치 — 픽셀은 자소 뭉갬, BODY로 가독성 ↑
          fontSize: '13px',
          color: '#cbb89a'
        })
        .setOrigin(0.5);
      t.setShadow(1, 1, '#000000', 0, false, true);
      layer.add(t);
      return t;
    });

    // 주력 속성 칩 + 제작 무기 — 0킬/무제작이면 각각 null(빈 행 안 그림).
    const attrRow = this.buildDeathAttrRow(layer, sum, 142);
    const weaponRow = this.buildDeathWeaponRow(layer, sum, 160);

    const subtitleText = this.add
      .text(W / 2, 177, '유산 1개를 들고 새 런 시작', {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: '#9a8b78'
      })
      .setOrigin(0.5);
    layer.add(subtitleText);

    // ── 유산 카드 2×2 (buildLegacyCard 내부에서 container 생성) ─────────
    const opts = legacyOptions(GameState);
    this.legacyCards = [];
    const slotW = 86;
    const slotH = 46;
    const gapX = 16;
    const gapY = 14;
    const gridW = slotW * 2 + gapX;
    const startX = (W - gridW) / 2;
    const startY = 191; // 요약 강화(주력 속성·제작 무기 행)만큼 카드 그리드를 아래로

    opts.forEach((opt, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = startX + col * (slotW + gapX) + slotW / 2;
      const cy = startY + row * (slotH + gapY) + slotH / 2;
      this.legacyCards.push(this.buildLegacyCard(layer, opt, cx, cy, slotW, slotH));
    });

    const anyEnabled = opts.some((o) => o.enabled);

    // ── 확정 버튼 ──────────────────────────────────────────────────────
    const btnBg = this.add
      .rectangle(W / 2, 322, 132, 30, 0xff6020)
      .setStrokeStyle(1, 0x000000, 0.45);
    const btnLabel = this.add
      .text(W / 2, 322, anyEnabled ? '들고 시작' : '새 런 시작', {
        fontFamily: BODY_FONT, // 한글 버튼 라벨 — BODY로
        fontSize: '13px',
        color: '#1a1008'
      })
      .setOrigin(0.5);
    layer.add(btnBg);
    layer.add(btnLabel);
    this.confirmBtn = { bg: btnBg, label: btnLabel };

    btnBg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (!btnBg.getData('enabled')) return;
      this.confirmLegacy();
    });

    // 첫 런(유산 없음) 또는 들고 갈 게 전혀 없으면 → 즉시 활성.
    this.setConfirmEnabled(!anyEnabled);

    // ── 연출 분기 ──────────────────────────────────────────────────────
    if (!this.motionOk) {
      // reduced-motion: 즉시 전체 표시, 상태 변경 없음
      return;
    }

    // motionOk: 각 요소를 개별 숨김 → 순차 트윈 등장
    // (layer 자체는 항상 visible — 자식을 개별 제어)
    const origSummaryY = summaryTexts.map((t) => t.y);
    const origSubtitleY = subtitleText.y;
    const origCardY = this.legacyCards.map((c) => c.cardContainer.y);
    // 주력 속성/제작 무기 행(있을 때만) — 요약 텍스트와 같은 슬라이드 패턴으로 등장.
    const summaryExtras = [attrRow, weaponRow].filter(Boolean);
    const origExtraY = summaryExtras.map((c) => c.y);

    scrim.setAlpha(0);
    runText.setAlpha(0);
    if (spText) spText.setAlpha(0);
    titleText.setAlpha(0).setScale(0.55);
    summaryTexts.forEach((t, i) => t.setAlpha(0).setY(origSummaryY[i] + 8));
    summaryExtras.forEach((c, i) => c.setAlpha(0).setY(origExtraY[i] + 8));
    subtitleText.setAlpha(0).setY(origSubtitleY + 6);
    this.legacyCards.forEach((c, i) =>
      c.cardContainer.setAlpha(0).setY(origCardY[i] + MOTION.deathCardSlideY)
    );
    btnBg.setAlpha(0);
    btnLabel.setAlpha(0);

    // 1. 암막 페이드인 (600ms) + RUN #N 함께 등장
    this.tweens.add({
      targets: scrim,
      alpha: 0.88,
      duration: MOTION.deathScrimMs,
      ease: 'Quad.out'
    });
    this.tweens.add({
      targets: spText ? [runText, spText] : runText,
      alpha: 1,
      duration: MOTION.deathScrimMs,
      ease: 'Quad.out'
    });

    // 2. 타이틀 스케일인 + 주황 글로우 흔들림
    this.time.delayedCall(MOTION.deathTitleDelay, () => {
      if (!this.deathLayer) return;
      this.tweens.add({
        targets: titleText,
        alpha: 1,
        scale: 1,
        duration: MOTION.deathTitleInMs,
        ease: 'Back.out',
        onComplete: () => {
          if (!titleText.active) return;
          // 계단식 4단계 흔들림 — 레트로 임팩트
          const amp = MOTION.deathTitleShakeAmp;
          [amp, -amp * 0.55, amp * 0.28, 0].forEach((dx, idx) => {
            this.time.delayedCall(idx * 55, () => {
              if (titleText.active) titleText.x = W / 2 + dx;
            });
          });
        }
      });
    });

    // 3. 요약 항목 슬라이드인 (스태거)
    summaryTexts.forEach((t, i) => {
      this.time.delayedCall(
        MOTION.deathSummaryDelay + i * MOTION.deathSummaryStagger,
        () => {
          if (!this.deathLayer || !t.active) return;
          this.tweens.add({
            targets: t,
            alpha: 1,
            y: origSummaryY[i],
            duration: 150,
            ease: 'Quad.out'
          });
        }
      );
    });

    // 3-b. 주력 속성/제작 무기 행 — 요약 직후·subtitle과 같은 슬롯(카드 등장 전).
    summaryExtras.forEach((c, i) => {
      this.time.delayedCall(
        MOTION.deathSummaryDelay + summaryTexts.length * MOTION.deathSummaryStagger,
        () => {
          if (!this.deathLayer || !c.active) return;
          this.tweens.add({
            targets: c,
            alpha: 1,
            y: origExtraY[i],
            duration: 150,
            ease: 'Quad.out'
          });
        }
      );
    });

    // subtitle
    this.time.delayedCall(
      MOTION.deathSummaryDelay + summaryTexts.length * MOTION.deathSummaryStagger,
      () => {
        if (!this.deathLayer || !subtitleText.active) return;
        this.tweens.add({
          targets: subtitleText,
          alpha: 1,
          y: origSubtitleY,
          duration: 150,
          ease: 'Quad.out'
        });
      }
    );

    // 4. 유산 카드 스태거 (아래서 올라오며 등장)
    this.legacyCards.forEach((c, i) => {
      this.time.delayedCall(
        MOTION.deathCardDelay + i * MOTION.deathCardStagger,
        () => {
          if (!this.deathLayer || !c.cardContainer.active) return;
          this.tweens.add({
            targets: c.cardContainer,
            alpha: 1,
            y: origCardY[i],
            duration: 180,
            ease: 'Quad.out'
          });
        }
      );
    });

    // 5. 확정 버튼 (카드 완료 후)
    const btnDelay =
      MOTION.deathCardDelay + this.legacyCards.length * MOTION.deathCardStagger + 60;
    this.time.delayedCall(btnDelay, () => {
      if (!this.deathLayer) return;
      this.tweens.add({
        targets: [btnBg, btnLabel],
        alpha: 1,
        duration: 180,
        ease: 'Quad.out'
      });
    });
  }

  // ── 사망 요약: 주력 속성 칩 행 ────────────────────────────────────────
  // attrKills에서 상위 1~2개 속성을 색 칩(스와치+라벨)으로. 전부 0이면 null(행 생략).
  // 컨테이너로 묶어 모션(슬라이드인) 한 번에 처리. 자식은 중앙정렬로 배치.
  buildDeathAttrRow(layer, sum, cy) {
    const W = LOGICAL.width;
    const attrKills = sum.attrKills || {};
    const top = Object.entries(attrKills)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    if (top.length === 0) return null; // 0킬 런 — 빈 막대 안 그림

    const row = this.add.container(W / 2, cy);
    const padX = 7;
    const sw = 6; // 색 스와치 변
    const innerGap = 5;
    const chipGap = 6;
    const chipH = 16;

    // 1차: 라벨 생성 → 칩 폭 측정
    const chips = top.map(([attr, n]) => {
      const colorNum = ATTR_DEATH_COLOR[attr] ?? 0x9a8b78;
      const label = this.add
        .text(0, 0, `${attr} ${n}`, {
          fontFamily: PIXEL_FONT,
          fontSize: '11px',
          color: toHexStr(colorNum)
        })
        .setOrigin(0, 0.5);
      label.setShadow(1, 1, '#000000', 0, false, true);
      const chipW = padX + sw + innerGap + label.width + padX;
      return { colorNum, label, chipW };
    });

    const prefix = this.add
      .text(0, 0, '주력', { fontFamily: BODY_FONT, fontSize: '12px', color: '#8a7c68' })
      .setOrigin(0, 0.5);
    const prefixGap = 8;

    const totalW =
      prefix.width +
      prefixGap +
      chips.reduce((s, c) => s + c.chipW, 0) +
      chipGap * (chips.length - 1);

    let x = -totalW / 2; // 컨테이너 중심 기준 좌측 끝
    prefix.setPosition(x, 0);
    row.add(prefix);
    x += prefix.width + prefixGap;

    chips.forEach((c) => {
      const cxChip = x + c.chipW / 2;
      const bg = this.add
        .rectangle(cxChip, 0, c.chipW, chipH, c.colorNum, 0.14)
        .setStrokeStyle(1, c.colorNum, 0.55);
      const swatch = this.add.rectangle(x + padX + sw / 2, 0, sw, sw, c.colorNum, 1);
      c.label.setPosition(x + padX + sw + innerGap, 0);
      row.add([bg, swatch, c.label]);
      x += c.chipW + chipGap;
    });

    layer.add(row);
    return row;
  }

  // ── 사망 요약: 제작 무기 행 ───────────────────────────────────────────
  // lastCraftedWeapon 있으면 "제작 [아이콘] 이름". 텍스처 미로드면 이름만(아이콘 생략).
  buildDeathWeaponRow(layer, sum, cy) {
    const W = LOGICAL.width;
    const id = sum.lastCraftedWeapon;
    const rec = id && WEAPON_RECIPES[id];
    if (!rec) return null;

    const row = this.add.container(W / 2, cy);
    const prefix = this.add
      .text(0, 0, '제작', { fontFamily: BODY_FONT, fontSize: '12px', color: '#8a7c68' })
      .setOrigin(0, 0.5);
    const name = this.add
      .text(0, 0, rec.name, { fontFamily: BODY_FONT, fontSize: '13px', color: '#f0c040' })
      .setOrigin(0, 0.5);
    name.setShadow(1, 1, '#000000', 0, false, true);

    const iconSize = 16;
    let icon = null;
    if (this.textures.exists(id)) {
      const src = this.textures.get(id).getSourceImage();
      icon = this.add.image(0, 0, id).setScale(iconSize / src.height);
    }

    const prefixGap = 7;
    const iconGap = icon ? 6 : 0;
    const iconW = icon ? iconSize : 0;
    const totalW = prefix.width + prefixGap + iconW + iconGap + name.width;

    let x = -totalW / 2;
    prefix.setPosition(x, 0);
    row.add(prefix);
    x += prefix.width + prefixGap;
    if (icon) {
      icon.setPosition(x + iconW / 2, 0);
      row.add(icon);
      x += iconW + iconGap;
    }
    name.setPosition(x, 0);
    row.add(name);

    layer.add(row);
    return row;
  }

  buildLegacyCard(layer, opt, cx, cy, w, h) {
    const enabled = opt.enabled;

    // container로 묶어 hover/select 트윈을 한 번에 적용
    const cardContainer = this.add.container(cx, cy);
    cardContainer.setSize(w, h);

    const bg = this.add
      .rectangle(0, 0, w, h, enabled ? 0x1c1712 : 0x141210, 1)
      .setStrokeStyle(2, enabled ? 0x3d2b1a : 0x241c14, 1);
    const title = this.add
      .text(0, -12, this.legacyTitle(opt), {
        fontFamily: BODY_FONT, // 한글 카드 제목(무기/재료/코인/스탯) — 픽셀 11px 자소 뭉갬, BODY로
        fontSize: '13px',
        color: enabled ? '#f0c040' : '#5a4f3e'
      })
      .setOrigin(0.5);
    const detail = this.add
      .text(0, 8, this.legacyDetail(opt), {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: enabled ? '#cbb89a' : '#4f463a',
        align: 'center'
      })
      .setOrigin(0.5);
    detail.setShadow(1, 1, '#000000', 0, false, true);

    cardContainer.add([bg, title, detail]);

    // 무기 유산은 강화 레벨이 따라오지 않는다(런 한정) — 오해 방지 한 줄. 활성 무기 카드일 때만.
    if (opt.type === 'weapon' && enabled) {
      const note = this.add
        .text(0, 19, '(강화 Lv 초기화)', {
          fontFamily: BODY_FONT,
          fontSize: '11px', // 카드 하단 좁은 자리 주석 — 9px로 절제(픽셀 8px 대비 BODY가 또렷)
          color: '#8a7a64'
        })
        .setOrigin(0.5);
      note.setShadow(1, 1, '#000000', 0, false, true);
      cardContainer.add(note);
    }
    layer.add(cardContainer);

    const card = { opt, bg, cardContainer, enabled };

    if (enabled) {
      // interactive는 container에 걸어 hover/select를 한 번에 처리
      cardContainer
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.selectLegacy(card));

      if (this.motionOk) {
        cardContainer
          .on('pointerover', () => {
            this.tweens.add({
              targets: cardContainer,
              scaleX: MOTION.legacyHoverScale,
              scaleY: MOTION.legacyHoverScale,
              duration: 100,
              ease: 'Quad.out'
            });
          })
          .on('pointerout', () => {
            this.tweens.add({
              targets: cardContainer,
              scaleX: 1,
              scaleY: 1,
              duration: 120,
              ease: 'Quad.in'
            });
          });
      }
    }
    return card;
  }

  legacyTitle(opt) {
    switch (opt.type) {
      case 'weapon':
        return '무기';
      case 'materials':
        return '재료';
      case 'coins':
        return '코인';
      case 'stat':
        return '스탯';
      default:
        return '';
    }
  }

  legacyDetail(opt) {
    switch (opt.type) {
      case 'weapon':
        return opt.enabled ? (WEAPON_RECIPES[opt.weapon]?.name || opt.weapon) : '기본 무기뿐';
      case 'materials':
        return opt.enabled ? `${opt.kinds}종 ${opt.total}개` : '보유 없음';
      case 'coins':
        return opt.enabled ? `+${opt.coins} 코인` : '보유 없음';
      case 'stat':
        return opt.enabled ? `${STAT_UPGRADES[opt.stat]?.label || opt.stat} Lv1` : '투자 없음';
      default:
        return '';
    }
  }

  selectLegacy(card) {
    this.selectedLegacy = card.opt;
    // 금 테두리 강조 + 나머지 기본 테두리 복귀
    this.legacyCards.forEach((c) => {
      if (!c.enabled) return;
      c.bg.setStrokeStyle(2, c === card ? 0xf0c040 : 0x3d2b1a, 1);
    });
    // 선택 카드 펄스 (scale 1 → 1.06 → 1, yoyo×repeat×2 ≈ 400ms)
    if (this.motionOk && card.cardContainer.active) {
      this.tweens.killTweensOf(card.cardContainer);
      this.tweens.add({
        targets: card.cardContainer,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: MOTION.legacyPulseMs,
        ease: 'Quad.out',
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          if (card.cardContainer.active) card.cardContainer.setScale(1);
        }
      });
    }
    this.setConfirmEnabled(true);
  }

  setConfirmEnabled(on) {
    const { bg, label } = this.confirmBtn;
    bg.setData('enabled', on);
    bg.setFillStyle(on ? 0xff6020 : 0x2a2a2a);
    label.setColor(on ? '#1a1008' : '#6a5a50');

    // 기존 펄스 트윈 정리 후 재설정
    if (this._confirmPulseTween) {
      this._confirmPulseTween.stop();
      this._confirmPulseTween = null;
    }
    bg.setAlpha(1);

    if (on && this.motionOk) {
      // 활성화 시 alpha 반복 펄스 — 주목 유도, 선택 대기감
      this._confirmPulseTween = this.tweens.add({
        targets: bg,
        alpha: 0.72,
        duration: MOTION.confirmPulseMs,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }

  confirmLegacy() {
    // 선택된 옵션 → 유산 payload(없으면 빈손).
    const opt = this.selectedLegacy;
    let legacy = null;
    if (opt) {
      if (opt.type === 'weapon') legacy = { type: 'weapon', weapon: opt.weapon };
      else if (opt.type === 'materials') legacy = { type: 'materials', materials: opt.materials };
      else if (opt.type === 'coins') legacy = { type: 'coins', coins: opt.coins };
      else if (opt.type === 'stat') legacy = { type: 'stat', stat: opt.stat };
    }
    GameState.setLegacy(legacy); // meta.legacy 저장
    GameState.startNewRun(); // 유산 소비 + run 리셋 + runCount++
    this.playRunResetTransition(() => this.restartRun());
  }

  // [모션 훅] 확정 후 오렌지 플래시 → 전투뷰 복귀. 짧고 경쾌한 런 리셋 전환.
  // 오렌지 플래시 정점에서 deathLayer를 즉시 숨기고 after()로 전투 복귀 준비 →
  // 암막색 rect가 페이드아웃되며 전투뷰가 자연스럽게 드러남.
  playRunResetTransition(after) {
    if (!this.motionOk || !this.deathLayer) {
      after();
      return;
    }

    // 확정 버튼 펄스 먼저 정리
    if (this._confirmPulseTween) {
      this._confirmPulseTween.stop();
      this._confirmPulseTween = null;
      this.confirmBtn?.bg.setAlpha(1);
    }

    const W = LOGICAL.width;
    const H = COMBAT_H;
    // deathLayer(depth 90) 위에 플래시 레이어
    const flash = this.add
      .rectangle(0, 0, W, H, 0xff7010, 0)
      .setOrigin(0, 0)
      .setDepth(95);

    // 1단계: 오렌지 플래시 인
    this.tweens.add({
      targets: flash,
      alpha: 0.82,
      duration: MOTION.resetFlashMs,
      ease: 'Quad.out',
      onComplete: () => {
        // 플래시 정점: deathLayer 즉시 숨김 + 전투 복귀 콜백
        if (this.deathLayer) this.deathLayer.setAlpha(0);
        after();
        // 2단계: 암막색으로 교체 후 페이드아웃 → 전투뷰 서서히 드러남
        flash.setFillStyle(0x0a0805);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: MOTION.resetFadeInMs,
          ease: 'Quad.out',
          onComplete: () => flash.destroy()
        });
      }
    });
  }

  hideDeathOverlay() {
    this.deathLayer?.destroy();
    this.deathLayer = null;
    this.legacyCards = null;
    this.confirmBtn = null;
    this.selectedLegacy = null;
  }

  // 새 런으로 전투 재시작 — HP 풀피, 웨이브/자원 HUD 갱신, 새 director.
  restartRun() {
    this.hideDeathOverlay();
    this.maxHP = GameState.stats.maxHP;
    this.playerHP = this.maxHP;
    this.updateHpBar();
    this.character.clearTint();
    this._playerDead = false; // 사망 플래그 해제 — 아래 swap/walk가 다시 살아나게(순서 중요)
    // teardown이 idle 트윈을 죽여 x/y/scale/angle이 중간값으로 멈췄을 수 있으니 기준값 복원
    this.character.setPosition(this.playerX, this.groundY).setScale(this.charScale).setAngle(0);
    this.shadow.setScale(1).setAlpha(0.35); // 그림자 bob 기준값 복원
    this.startIdleBob(); // bob 재생성
    // 새 런 단계 복구 — startNewRun이 런 스냅샷을 리셋했으면 stage1(맨손). 아틀라스/scale + walk 복원.
    this.characterStage = deriveStage(GameState);
    this.swapCharacterStage(this.characterStage, { silent: true }); // _doSwap이 walk 루프 재생
    if (this.motionOk && !this._attacking) this._playWalk(); // swap이 미적용(미캐시 로드 대기)일 때 보강
    this.syncResourceHud();
    // 새 런 — startNewRun이 waveIndex=0(downtown)으로 리셋했으니 배경도 패럴랙스로 복귀.
    this.currentRegionId = getRegion(GameState.waveIndex).id;
    this.parallax.hideRegion();
    this.startEncounter(); // 새 director 구성 + refreshWaveHud
  }

  // ── R9 웨이브 업그레이드(런 한정 버프) ─────────────────────────────────
  // first_hit_shield 차지를 보유 레벨만큼 채운다(웨이브 진입/전투 시작 시).
  refillWaveShield() {
    this.waveShield = GameState.getModifier('first_hit_shield');
  }

  // 방벽이 피해를 막은 순간 — 주인공 위에 "방벽" 표시. reduced-motion: 짧게 표시 후 제거.
  showShieldBlock() {
    const tag = this.add
      .text(this.character.x, this.groundY - this.charDisplayH * 0.8, '방벽', {
        fontFamily: BODY_FONT, // 한글 태그 — BODY로
        fontSize: '13px',
        color: '#bfe3ff'
      })
      .setOrigin(0.5)
      .setDepth(72);
    tag.setShadow(1, 1, '#001018', 0, false, true);
    // 가벼운 시안 플래시 — 피격 플래시(붉은 tint)와 구분되는 "막았다" 피드백.
    this.character.setTint(0x9ad8ff);
    this.time.delayedCall(120, () => this.character.clearTint());

    if (!this.motionOk) {
      this.time.delayedCall(450, () => tag.destroy());
      return;
    }
    tag.setScale(0.6).setAlpha(0);
    this.tweens.add({
      targets: tag,
      scale: 1,
      alpha: 1,
      duration: 150,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({
          targets: tag,
          y: tag.y - 22,
          alpha: 0,
          duration: 460,
          ease: 'Quad.out',
          onComplete: () => tag.destroy()
        });
      }
    });
  }

  // 5웨이브마다 발동 — 전투를 잠깐 멈추고 버프 카드 3장 중 1장 선택. 사망 오버레이 카드
  // 패턴(scrim + 카드 + 모션 스태거)을 재사용한다. depth 88(사망 오버레이 90 아래).
  showUpgradeOverlay(waveIndex) {
    // 가드 — 이미 업그레이드/사망 오버레이가 떠 있으면 발동 안 함(중복·겹침 방지).
    // 보스전 중(_bossActive)에도 차단 — %5 잡몹 처치 트리거가 보스전에 끼어들어 director.stop()으로
    // 멈추고 보스HP바가 남는 버그 방지. 보스 처치 보상(onBossDefeated)은 _bossActive=false 직후 호출하므로 통과한다.
    if (this.upgradeLayer || this.deathLayer || this._bossActive) return;

    SFX.play('upgrade'); // 강화 오버레이 등장 상승음

    const W = LOGICAL.width;
    const H = COMBAT_H;
    let layer = null;
    try {
      layer = this.add.container(0, 0).setDepth(88);
      this.upgradeLayer = layer;

      const scrim = this.add.rectangle(0, 0, W, H, 0x0a0805, 0.82).setOrigin(0, 0);
      layer.add(scrim);

      const title = this.add
        .text(W / 2, H * 0.2, `WAVE ${waveIndex} 강화`, {
          fontFamily: PIXEL_FONT,
          fontSize: '18px',
          color: '#ffd24a',
          stroke: '#3a1000',
          strokeThickness: 4
        })
        .setOrigin(0.5);
      layer.add(title);

      const subtitle = this.add
        .text(W / 2, H * 0.2 + 22, '버프 1개 선택 · 이번 런 한정', {
          fontFamily: BODY_FONT,
          fontSize: '13px',
          color: '#9a8b78'
        })
        .setOrigin(0.5);
      layer.add(subtitle);

      // 카드 3장 — 가로 1행 배치(중복 없이 풀에서 뽑음).
      const picks = pickRunUpgrades(3);
      const slotW = 100;
      const slotH = 128;
      const gapX = 12;
      const gridW = slotW * picks.length + gapX * (picks.length - 1);
      const startX = (W - gridW) / 2;
      const cy = H * 0.5;
      this.upgradeCards = picks.map((up, i) => {
        const cx = startX + i * (slotW + gapX) + slotW / 2;
        return this.buildUpgradeCard(layer, up, cx, cy, slotW, slotH);
      });

      // 전투 일시정지 — 오버레이/카드 빌드가 성공한 뒤에만 director를 멈춘다(teardown 아님).
      // 빌드 중 예외가 나면 director가 멈춘 채 오버레이도 못 떠 전투가 영구정지되므로,
      // stop은 여기로 미루고 실패 시(catch) director.start()로 복구한다. 재개는 카드 선택 후.
      this.director?.stop();
      this._upgradeResolving = false;

      if (!this.motionOk) return; // reduced-motion: 즉시 전체 표시

      // 모션: scrim 페이드 + 카드 아래서 스태거 등장(사망 오버레이와 동일 톤).
      const origCardY = this.upgradeCards.map((c) => c.cardContainer.y);
      scrim.setAlpha(0);
      title.setAlpha(0).setScale(0.7);
      subtitle.setAlpha(0);
      this.upgradeCards.forEach((c, i) =>
        c.cardContainer.setAlpha(0).setY(origCardY[i] + MOTION.deathCardSlideY)
      );

      this.tweens.add({ targets: scrim, alpha: 0.82, duration: 260, ease: 'Quad.out' });
      this.tweens.add({ targets: title, alpha: 1, scale: 1, duration: 200, ease: 'Back.out' });
      this.tweens.add({ targets: subtitle, alpha: 1, duration: 220, delay: 60, ease: 'Quad.out' });
      this.upgradeCards.forEach((c, i) => {
        this.time.delayedCall(120 + i * MOTION.deathCardStagger, () => {
          if (!this.upgradeLayer || !c.cardContainer.active) return;
          this.tweens.add({
            targets: c.cardContainer,
            alpha: 1,
            y: origCardY[i],
            duration: 180,
            ease: 'Quad.out'
          });
        });
      });
    } catch (e) {
      // 빌드/모션 중 예외 — 반쪽 오버레이를 걷고 director를 되살려 영구정지를 막는다.
      console.error('[upgrade overlay]', e);
      layer?.destroy();
      this.upgradeLayer = null;
      this.upgradeCards = null;
      this._upgradeResolving = false;
      this.director?.start();
    }
  }

  buildUpgradeCard(layer, up, cx, cy, w, h) {
    const hex = upgradeHex(up.color);
    const cardContainer = this.add.container(cx, cy);
    cardContainer.setSize(w, h);

    const bg = this.add
      .rectangle(0, 0, w, h, 0x161009, 1)
      .setStrokeStyle(2, up.color, 0.9);
    // 상단 속성색 액센트 바 — 카드 톤을 버프 속성으로 즉시 식별.
    const accent = this.add.rectangle(0, -h / 2 + 5, w - 8, 4, up.color, 1);
    const name = this.add
      .text(0, -h * 0.3, up.name, {
        fontFamily: BODY_FONT, // 한글 버프 이름 — 픽셀 13px 자소 뭉갬, BODY로
        fontSize: '14px',
        color: hex
      })
      .setOrigin(0.5);
    name.setShadow(1, 1, '#000000', 0, false, true);
    const desc = this.add
      .text(0, h * 0.12, up.desc, {
        fontFamily: BODY_FONT,
        fontSize: '13px',
        color: '#cbb89a',
        align: 'center',
        wordWrap: { width: w - 18 }
      })
      .setOrigin(0.5);
    desc.setShadow(1, 1, '#000000', 0, false, true);

    cardContainer.add([bg, accent, name, desc]);
    layer.add(cardContainer);

    const card = { up, bg, cardContainer };
    cardContainer
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.selectUpgrade(card));

    if (this.motionOk) {
      cardContainer
        .on('pointerover', () => {
          this.tweens.add({
            targets: cardContainer,
            scaleX: MOTION.legacyHoverScale,
            scaleY: MOTION.legacyHoverScale,
            duration: 100,
            ease: 'Quad.out'
          });
        })
        .on('pointerout', () => {
          this.tweens.add({
            targets: cardContainer,
            scaleX: 1,
            scaleY: 1,
            duration: 120,
            ease: 'Quad.in'
          });
        });
    }
    return card;
  }

  selectUpgrade(card) {
    if (this._upgradeResolving) return; // 더블탭/연타 가드
    this._upgradeResolving = true;

    GameState.addRunModifier(card.up.key); // 런 한정 버프 누적(레벨++)
    this.applyUpgradeEffect(card.up.key); // 즉시효과(max_hp_up/atk_up/shield 등)

    // 선택 카드 강조 + 나머지 디밍 → 짧은 펄스 후 오버레이 닫고 전투 재개.
    if (this.motionOk && card.cardContainer.active) {
      this.upgradeCards.forEach((c) => {
        if (c !== card) c.cardContainer.setAlpha(0.35);
        else c.bg.setStrokeStyle(2, card.up.color, 1);
      });
      this.tweens.killTweensOf(card.cardContainer);
      this.tweens.add({
        targets: card.cardContainer,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: MOTION.legacyPulseMs,
        ease: 'Quad.out',
        yoyo: true,
        repeat: 1,
        onComplete: () => this.closeUpgradeOverlay()
      });
    } else {
      this.closeUpgradeOverlay();
    }
  }

  // 선택 즉시 반영되는 효과만 처리(누적형은 getModifier로 런타임에서 읽음).
  applyUpgradeEffect(key) {
    switch (key) {
      case 'max_hp_up':
        // 런 한정이지만 GameState.stats에 직접 더해도 사망 시 baseRun으로 리셋되므로 안전.
        GameState.stats.maxHP += 20;
        GameState._markRunDirty();
        this.maxHP = GameState.stats.maxHP;
        this.playerHP = Math.min(this.maxHP, this.playerHP + 20);
        this.updateHpBar();
        break;
      case 'atk_up':
        GameState.stats.atk += 6;
        GameState._markRunDirty();
        break;
      case 'first_hit_shield':
        // 선택 즉시 이번 웨이브 방벽도 채워 바로 체감되게(다음 웨이브에 다시 리필).
        this.refillWaveShield();
        break;
      default:
        break; // 나머지는 런타임에서 getModifier로 적용(즉시효과 없음)
    }
  }

  closeUpgradeOverlay() {
    const resume = () => {
      this.hideUpgradeOverlay();
      this.director?.start(); // 전투 재개(teardown 아님 — 멈춘 director를 다시 돌림)
    };
    if (!this.motionOk || !this.upgradeLayer) {
      resume();
      return;
    }
    this.tweens.add({
      targets: this.upgradeLayer,
      alpha: 0,
      duration: 200,
      ease: 'Quad.in',
      onComplete: resume
    });
  }

  hideUpgradeOverlay() {
    this.upgradeLayer?.destroy();
    this.upgradeLayer = null;
    this.upgradeCards = null;
    this._upgradeResolving = false;
  }

  // ── HUD: 주인공 HP바 (전투뷰 상단) ──────────────────────────────────
  createHud() {
    const x = 10;
    const y = 8;
    const w = 100; // designer: 132→100 — 길고 평평한 인상 완화, 좌측 컬럼 응집
    const h = 12;
    this.hpBarW = w;

    this.add
      .rectangle(x, y, w + 2, h + 2, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(60);
    this.add
      .rectangle(x + 1, y + 1, w, h, PALETTE.hubSecondary)
      .setOrigin(0, 0)
      .setDepth(60);
    this.hpFill = this.add
      .rectangle(x + 1, y + 1, w, h, COMBAT_COLORS.gold)
      .setOrigin(0, 0)
      .setDepth(61);
    // 상단 1px 광택 하이라이트 — 평평한 바에 입체감(채움 위, 트랙 폭 고정).
    this.add
      .rectangle(x + 1, y + 1, w, 1, 0xffffff, 0.22)
      .setOrigin(0, 0)
      .setDepth(62);

    // 좌상단 HUD 세로 리듬 — HP바(8) → 라벨(24) → WAVE(40) → 진행바(56), 일관 16px 스텝.
    this.add
      .text(x, 24, 'SCRAPPER', {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: '#cbb89a'
      })
      .setOrigin(0, 0)
      .setDepth(61);
  }

  updateHpBar() {
    const ratio = Phaser.Math.Clamp(this.playerHP / this.maxHP, 0, 1);
    this.hpFill.width = this.hpBarW * ratio;
    // 위험 구간이면 바 색도 주황으로
    this.hpFill.fillColor =
      ratio <= PLAYER.dangerThreshold ? COMBAT_COLORS.electric : COMBAT_COLORS.gold;
  }

  // ── 웨이브 HUD (HP바/라벨 아래, 좌상단) ──────────────────────────────
  createWaveHud() {
    const x = 10;
    // WAVE/RUN y=40 — createHud 리듬(8→24→40→56) 연속. 진행바 barY=56로 16px 스텝 유지.
    this.waveText = this.add
      .text(x, 40, 'WAVE 0', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#ff6020'
      })
      .setOrigin(0, 0)
      .setDepth(61);
    this.waveText.setShadow(1, 1, '#000000', 0, false, true);

    // RUN #N — WAVE 옆(바 우측 끝선), 회차 표식. WAVE보다 위계상 위라 골드(#f0c040,
    // 사망 오버레이 RUN과 동일 톤)로 구분. 현재 진행 런 = runCount+1(사망 오버레이와 동일).
    this.runText = this.add
      .text(78, 40, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#f0c040'
      })
      .setOrigin(0, 0)
      .setDepth(61);
    this.runText.setShadow(1, 1, '#000000', 0, false, true);

    const barY = 56;
    this.waveBarW = 72;
    this.add
      .rectangle(x, barY, this.waveBarW + 2, 6, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarTrack = this.add
      .rectangle(x + 1, barY + 1, this.waveBarW, 4, PALETTE.hubSecondary)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarFill = this.add
      .rectangle(x + 1, barY + 1, 0, 4, COMBAT_COLORS.toxic)
      .setOrigin(0, 0)
      .setDepth(61);

    this.refreshWaveHud();
  }

  refreshWaveHud() {
    if (!this.waveText) return;
    this.waveText.setText(`WAVE ${GameState.waveIndex}`);
    // 현재 진행 중 런 번호 = runCount+1 (startNewRun에서 +1 되므로). 새 런 시작 시
    // restartRun→startEncounter→refreshWaveHud 경로로 자동 갱신.
    this.runText?.setText(`RUN #${GameState.meta.runCount + 1}`);
    const inWave = GameState.runKills % WAVE.killsPerWave;
    this.waveBarFill.width = this.waveBarW * (inWave / WAVE.killsPerWave);
  }

  // 지역 패시브 버프 → 한 줄 라벨 {text,color}. 보너스 없는 지역은 null.
  // 속성 1채널(현 데이터)만 노출 — 여러 채널이 생겨도 가장 큰 1개만 보여 짧게 유지.
  _regionBonusLabel(region) {
    const b = region?.combatBonus;
    if (!b) return null;
    const NAMES = { FIRE: '화염', TOXIC: '독', SHOCK: '감전', PIERCE: '관통', PHYSICAL: '물리' };
    const COLORS = { FIRE: '#ff6020', TOXIC: '#20ff9a', SHOCK: '#66ddff', PIERCE: '#88ccff', PHYSICAL: '#cbb89a' };
    let bestAttr = null, bestMult = 1;
    for (const k of Object.keys(b)) if (b[k] > bestMult) { bestMult = b[k]; bestAttr = k; }
    if (!bestAttr) return null;
    const pct = Math.round((bestMult - 1) * 100);
    return { text: `이 지역 · ${NAMES[bestAttr] || bestAttr} 데미지 +${pct}%`, color: COLORS[bestAttr] || '#cbb89a' };
  }

  // [모션 훅] 웨이브 진입 배너 — "WAVE N" + 현재 지역명 서브라인. 지역이 바뀌는
  // 웨이브면 서브라인을 강조(밝은 색 + "NEW AREA" 프리픽스). 스케일인→유지→스케일업+페이드.
  showWaveBanner(n) {
    SFX.play('wave_up'); // 웨이브 진입 상승음
    const region = getRegion(n);
    const isNewRegion = n > 0 && getRegion(n - 1).id !== region.id;

    // 두 텍스트를 컨테이너로 묶어 스케일/페이드를 함께 — 정렬 흔들림 없음.
    const banner = this.add.container(LOGICAL.width / 2, COMBAT_H * 0.3).setDepth(75);

    const main = this.add
      .text(0, 0, `WAVE ${n}`, {
        fontFamily: PIXEL_FONT,
        fontSize: '20px',
        color: '#ff6020',
        stroke: '#1a1008',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    const subLabel = isNewRegion ? `▶ ${region.name}` : region.name;
    const sub = this.add
      .text(0, 18, subLabel, {
        fontFamily: BODY_FONT, // 한글 지역명 — 픽셀은 뭉개짐, BODY 11px로 가독성 ↑
        fontSize: '13px',
        color: isNewRegion ? '#ffd24a' : '#cbb89a'
      })
      .setOrigin(0.5);
    sub.setShadow(1, 1, '#000000', 0, false, true);

    banner.add([main, sub]);

    // 지역 패시브 버프 1줄 안내(테마 지역 한정) — "이 지역: 독 데미지 +30%" 톤. 작은 화면이라 짧게.
    const bonus = this._regionBonusLabel(region);
    if (bonus) {
      const bonusTxt = this.add
        .text(0, 35, bonus.text, { fontFamily: BODY_FONT, fontSize: '12px', color: bonus.color })
        .setOrigin(0.5);
      bonusTxt.setShadow(1, 1, '#000000', 0, false, true);
      banner.add(bonusTxt);
    }

    if (!this.motionOk) {
      this.time.delayedCall(700, () => banner.destroy());
      return;
    }

    banner.setScale(0.6).setAlpha(0);
    this.tweens.add({
      targets: banner,
      scale: 1,
      alpha: 1,
      duration: MOTION.waveBannerInMs,
      ease: 'Back.out',
      onComplete: () => {
        // 신규 지역: 착지 직후 scale 펄스로 "지역 바뀜" 임팩트 강조(yoyo 1회, 가볍게)
        if (isNewRegion) {
          this.tweens.add({
            targets: banner,
            scaleX: 1.07,
            scaleY: 1.07,
            duration: MOTION.waveBannerNewPulseMs, // 90ms
            ease: 'Quad.out',
            yoyo: true
          });
        }
        this.time.delayedCall(MOTION.waveBannerStayMs, () => {
          if (!banner.active) return;
          // 아웃: 스케일 업 + 페이드 — 터지듯 사라져 전투에 다시 집중
          this.tweens.add({
            targets: banner,
            scale: 1.22,
            alpha: 0,
            duration: MOTION.waveBannerOutMs,
            ease: 'Quad.in',
            onComplete: () => banner.destroy()
          });
        });
      }
    });
  }

  // ── 자원 HUD (전투뷰 우상단): 코인만 상시 표시 ────────────────────────
  // R7 — 재료는 인벤 탭에서 본다(전투 HUD는 코인만). 코인 줍기가 빨려드는 목적지.
  createResourceHud() {
    const y = 14;
    // 상단 가운데 — 아이콘(16) + 숫자 묶음이 화면 중앙에 오게 좌측 시작점을 보정.
    const x = Math.round(LOGICAL.width / 2 - 16);
    if (this.textures.exists(TEX.COIN_REWARD)) {
      const src = this.textures.get(TEX.COIN_REWARD).getSourceImage();
      this.add
        .image(x, y, TEX.COIN_REWARD)
        .setOrigin(0, 0.5)
        .setScale(16 / src.height)
        .setDepth(61);
    }
    const txt = this.add
      .text(x + 15, y, '0', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#f4ead2'
      })
      .setOrigin(0, 0.5)
      .setDepth(61);
    txt.setShadow(1, 1, '#000000', 0, false, true);
    this.resHud = { coins: { txt, x, y } };

    this.syncResourceHud();
  }

  syncResourceHud() {
    if (!this.resHud) return;
    this.resHud.coins.txt.setText(String(GameState.coins));
  }

  // ── 킬 콤보 HUD (상단 중앙, 코인 아래) ────────────────────────────────
  // 단일 Text(풀 불필요) — 처치마다 갱신/팝, 창 만료 시 슬라이드아웃. depth 62(코인 61 위).
  createComboHud() {
    this.comboText = this.add
      .text(Math.round(LOGICAL.width / 2), 31, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#ffd24a'
      })
      .setOrigin(0.5, 0)
      .setDepth(62)
      .setVisible(false);
    this.comboText.setShadow(1, 1, '#000000', 0, false, true);
  }

  // ── 환경설정 진입 버튼 (우상단, 톱니) ───────────────────────────────────
  // 코드로 그린 픽셀 톱니 아이콘. 입력은 onCombatTap의 뷰포트 히트테스트로 처리(이 씬의
  // 오프셋 뷰포트 환경에서 per-object setInteractive가 어긋나는 걸 피하는 기존 패턴 그대로).
  // 탭하면 SettingsScene을 launch(전체 화면 모달).
  createSettingsButton() {
    const w = 24; // designer: 18→24 — 작아서 톱니 디테일이 죽던 걸 키움
    const h = 20;
    const x = LOGICAL.width - w - 4; // 맨 우상단 코너
    const y = 6; // 상단 코너 — 코인(좌측)과 같은 띠, x로 분리
    this._settingsBounds = { x, y, w, h };

    // 배경 박스(유저 거부) 대신 은은한 원형 링 테두리로 "버튼"임을 암시 — 부동감 해소.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const ring = this.add.graphics().setDepth(62);
    ring.fillStyle(0x000000, 0.18); // 톱니 뒤 아주 옅은 다크 원(대비 받침)
    ring.fillCircle(cx, cy, 10.5);
    ring.lineStyle(1, 0xf0c040, 0.45); // 금색 1px 링
    ring.strokeCircle(cx, cy, 10.5);
    const g = this.add.graphics().setDepth(63);
    this._drawGear(g, cx, cy, 0xf0c040);
  }

  // 톱니 아이콘 — 8개 이빨(사다리꼴) + 작은 본체 링 + 가운데 구멍.
  // 핵심: 본체 반경(3.0) < 이빨 안쪽(4.5)이라 톱니가 본체 앞으로 확실히 돌출 → "기어"로 읽힘.
  _drawGear(g, cx, cy, color) {
    g.clear();
    const rHole = 1.5; // 가운데 구멍(작게 — 링 비율 강화)
    const half = 0.35; // 이빨 각폭(라디안) 절반

    // 톱니+본체 한 패스 — 어두운 외곽선 → 금색 본체 2패스로 대비 확보.
    const draw = (col, rBody, rToothIn, rToothOut, tHalf) => {
      g.fillStyle(col, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const p = (rad, da) => ({ x: cx + Math.cos(a + da) * rad, y: cy + Math.sin(a + da) * rad });
        g.fillPoints(
          [p(rToothIn, -tHalf), p(rToothIn, tHalf), p(rToothOut, tHalf * 1.25), p(rToothOut, -tHalf * 1.25)],
          true
        );
      }
      g.fillCircle(cx, cy, rBody);
    };

    draw(0x000000, 3.8, 4.5, 9.5, half + 0.12); // 외곽선(살짝 크게, 어둡게)
    draw(color, 3.0, 4.5, 8.5, half); // 본체(금색) — rBody<rToothIn이 핵심
    g.fillStyle(0x000000, 1); // 가운데 구멍
    g.fillCircle(cx, cy, rHole);
  }

  // ── 드롭 줍기 연출 ─────────────────────────────────────────────────────
  // 코인은 우상단 HUD 카운터로 빨려들고(flyPickup), 재료는 탭/자동수집 시 사망 위치에서
  // 아이콘이 떠올랐다 사라지는 "줍기 표시"(popMaterial). 토스트는 onDropToast에서 별도.

  // 재료 1종 줍기 팝 — 아이콘 + ×N 라벨이 사망 위치에서 피드백 연출 후 사라짐.
  // fromTap=false(기본): 포물선 상승 + 페이드 (자동수집/기존 경로).
  // fromTap=true:  스케일 팝 → 인벤(하단 허브) 방향으로 축소+페이드 빨려가기.
  //   "코인은 우상단, 재료는 하단" — flyPickup 톤 통일(Back/Quad.in), 목적지만 차별화.
  // 누수 없음: 모든 경로의 onComplete에서 obj·label destroy.
  popMaterial(key, count, x, y, idx, fromTap = false) {
    const meta = MATERIAL_META[key];
    const sx = x + Phaser.Math.Between(-MOTION.pickupSpreadX, MOTION.pickupSpreadX);
    let obj;
    if (meta && this.textures.exists(meta.iconKey)) {
      const src = this.textures.get(meta.iconKey).getSourceImage();
      obj = this.add.image(sx, y, meta.iconKey).setScale(18 / src.height);
    } else {
      obj = this.add
        .rectangle(sx, y, 10, 10, GRADE_COLOR[meta?.grade] || 0x8a6a3a)
        .setStrokeStyle(1, 0x000000, 0.5);
    }
    obj.setDepth(66);
    const label = this.add
      .text(sx + 9, y - 7, `×${count}`, {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: '#f4ead2'
      })
      .setOrigin(0, 0.5)
      .setDepth(66);
    label.setShadow(1, 1, '#000000', 0, false, true);

    if (!this.motionOk) {
      this.time.delayedCall(450, () => {
        obj.destroy();
        label.destroy();
      });
      return;
    }

    const s0 = obj.scaleX;

    if (fromTap) {
      // ── 자동 획득: 드라마틱 팝 → 인벤(하단) 빨려가기 ──────────────────────
      // idx*60 스태거 — 한 처치에서 여러 재료가 동시 드롭돼도 팝이 겹치지 않게.
      const popDelay = idx * 60;
      // 라벨은 팝 구간에 빠르게 페이드(빨려가는 건 아이콘만)
      this.tweens.add({
        targets: label,
        alpha: 0,
        delay: popDelay,
        duration: MOTION.matCollectPopMs + 60,
        ease: 'Quad.in'
      });
      // 아이콘: 스케일 팝(Back.out) → 하단 중앙으로 축소+페이드 빨려가기(Quad.in)
      this.tweens.add({
        targets: obj,
        scaleX: s0 * 1.3,
        scaleY: s0 * 1.3,
        delay: popDelay,
        duration: MOTION.matCollectPopMs, // 80ms
        ease: 'Back.out',
        onComplete: () => {
          this.tweens.add({
            targets: obj,
            x: LOGICAL.width / 2,  // 화면 가로 중앙으로 수렴
            y: COMBAT_H + 10,      // 허브 경계 아래 — "인벤으로 들어간다" 힌트
            scaleX: s0 * 0.2,
            scaleY: s0 * 0.2,
            alpha: 0,
            duration: MOTION.matCollectFlyMs, // 320ms
            ease: 'Quad.in',
            onComplete: () => { obj.destroy(); label.destroy(); }
          });
        }
      });
    } else {
      // ── 자동수집/기존 경로: 스케일 팝 + 포물선 상승 페이드 ─────────────────
      // 레이블은 scale 1 고정. reduced-motion 분기는 위에서 이미 반환됨.
      this.tweens.add({
        targets: obj,
        scaleX: { from: s0 * MOTION.matPopScaleFrom, to: s0 },
        scaleY: { from: s0 * MOTION.matPopScaleFrom, to: s0 },
        delay: idx * 60,
        duration: MOTION.matPopScaleMs,
        ease: 'Back.out'
      });

      // 포물선 상승 + 페이드 — arcX 드리프트로 "뭔가 주웠다" 체감.
      const arcX = Phaser.Math.Between(-MOTION.matPopArcX, MOTION.matPopArcX);
      this.tweens.add({
        targets: [obj, label],
        x: `+=${arcX}`,
        y: `-=${22 + idx * 4}`,
        alpha: 0,
        delay: idx * 60,
        duration: 700,
        ease: 'Quad.out',
        onComplete: () => {
          obj.destroy();
          label.destroy();
        }
      });
    }
  }

  flyPickup(type, x, y, target, idx) {
    if (!target) return;
    const pulse = () => this.pulseCounter(target.txt);
    if (!this.motionOk) {
      pulse();
      return;
    }

    const sx = x + Phaser.Math.Between(-MOTION.pickupSpreadX, MOTION.pickupSpreadX);
    let obj;
    if (type.tex && this.textures.exists(type.tex)) {
      const src = this.textures.get(type.tex).getSourceImage();
      obj = this.add.image(sx, y, type.tex).setScale(18 / src.height);
    } else {
      obj = this.add.rectangle(sx, y, 10, 10, type.color).setStrokeStyle(1, 0x000000, 0.5);
    }
    obj.setDepth(66);
    const s0 = obj.scaleX;

    // 1) 살짝 튀어오름 → 2) HUD 카운터로 빨려가며 회전·축소
    this.tweens.add({
      targets: obj,
      y: y - MOTION.pickupPopUpY,
      duration: MOTION.pickupPopMs,
      ease: 'Quad.out',
      onComplete: () => {
        this.tweens.add({
          targets: obj,
          x: target.x,
          y: target.y,
          angle: MOTION.pickupSpinDeg,
          scaleX: s0 * 0.55,
          scaleY: s0 * 0.55,
          delay: idx * 40,
          duration: MOTION.pickupFlyMs,
          ease: 'Back.in',
          onComplete: () => {
            obj.destroy();
            pulse();
          }
        });
      }
    });
  }

  pulseCounter(txt) {
    if (!this.motionOk) return;
    this.tweens.add({
      targets: txt,
      scaleX: 1.35,
      scaleY: 1.35,
      duration: 90,
      yoyo: true,
      ease: 'Quad.out'
    });
  }

  // ── 드롭 토스트 (희소 재료 획득 시 중앙상단 배너 "획득: 이름 ×N") ──────────
  // 흔한 재료(grade 1)는 매 처치라 줍기 팝(popMaterial)으로 충분 — 토스트는 grade≥2
  // 희소 재료에만 띄워 스팸/오버드로우를 막는다(designer 박스 스펙 유지).
  createToast() {
    this.toast = this.add
      .container(LOGICAL.width / 2, 40)
      .setDepth(78)
      .setAlpha(0)
      .setVisible(false);
    this.toastBg = this.add
      .rectangle(0, 0, 184, 34, 0x12100c, 0.92)
      .setStrokeStyle(1, PALETTE.accentGold, 0.85);
    this.toastIcon = this.add.image(-78, 0, TEX.COIN_REWARD).setVisible(false);
    this.toastText = this.add
      .text(-60, 0, '', {
        fontFamily: BODY_FONT, // "획득: <재료명> ×N" — 한글 재료명 가독성 위해 BODY 11px
        fontSize: '13px',
        color: '#ffffff'
      })
      .setOrigin(0, 0.5);
    this.toastText.setShadow(1, 1, '#000000', 0, false, true);
    this.toast.add([this.toastBg, this.toastIcon, this.toastText]);
  }

  onDropToast(info) {
    // grade≥2(희소) 재료만 토스트. 가장 높은 등급 1종을 대표로 보여주고 나머지는 +N종.
    const notable = MATERIAL_ORDER.filter((k) => info[k] && MATERIAL_META[k].grade >= 2).sort(
      (a, b) => MATERIAL_META[b].grade - MATERIAL_META[a].grade
    );
    if (notable.length === 0) return;
    const key = notable[0];
    const meta = MATERIAL_META[key];
    const extra = notable.length > 1 ? `  +${notable.length - 1}종` : '';
    this.showToast(`획득: ${meta.name} ×${info[key]}${extra}`, meta.iconKey, meta.grade >= 3);
  }

  // text + 아이콘(iconKey). hot=true(grade3)면 테두리를 주황으로 더 강조.
  showToast(text, iconKey, hot = false) {
    this.toastText.setText(text);
    if (iconKey && this.textures.exists(iconKey)) {
      const src = this.textures.get(iconKey).getSourceImage();
      this.toastIcon.setTexture(iconKey).setScale(20 / src.height).setVisible(true);
    } else {
      this.toastIcon.setVisible(false);
    }
    const accent = hot ? PALETTE.accentElectric : PALETTE.accentGold;
    this.toastBg.setStrokeStyle(1, accent, 0.9);
    this.toast.setVisible(true);
    this.tweens.killTweensOf(this.toast);
    this.toastTimer?.remove();

    if (!this.motionOk) {
      this.toast.setAlpha(1);
      this.toastTimer = this.time.delayedCall(MOTION.toastStayMs, () =>
        this.toast.setAlpha(0).setVisible(false)
      );
      return;
    }

    this.toast.setAlpha(0).setY(34);
    this.tweens.add({
      targets: this.toast,
      alpha: 1,
      y: 40,
      duration: MOTION.toastInMs,
      ease: 'Back.out',
      onComplete: () => {
        this.toastTimer = this.time.delayedCall(MOTION.toastStayMs, () => {
          this.tweens.add({
            targets: this.toast,
            alpha: 0,
            y: 34,
            duration: MOTION.toastOutMs,
            ease: 'Quad.in',
            onComplete: () => this.toast.setVisible(false)
          });
        });
      }
    });
  }

  // ── 데미지 숫자 팝업 (오브젝트 풀) ───────────────────────────────────────
  // 풀에서 비활성 Text를 꺼내 스타일/위치를 갱신해 재활성 → 트윈 종료 시 풀로 반납.
  // RESIST 라벨은 빈도가 낮아(내성 적중 시만) 풀 대상에서 제외하고 그때만 생성/파괴한다.
  spawnDamageNumber(x, y, amount, color, isResisted = false, small = false) {
    const t = this._acquireDmgText();
    if (!t) return; // 풀 상한 초과 — 이 숫자는 생략(밀집 전투의 시각 스팸 억제)

    // 가로 흩뿌림: 같은 위치에 숫자가 겹치는 것 방지 + 레트로 튐 감성
    // small=true(DoT 틱)는 작은 폰트 + 팝 없이 잔잔하게 — 직접타와 시각 위계 분리.
    const driftX = Phaser.Math.Between(-MOTION.dmgDriftX, MOTION.dmgDriftX);
    t.setText(String(amount))
      .setColor(color)
      .setFontSize(small ? 9 : 13)
      .setStroke('#1a1008', small ? 2 : 3)
      .setOrigin(0.5)
      .setPosition(x + driftX, y)
      .setAlpha(1)
      .setScale(small ? 1 : MOTION.dmgScaleFrom); // 팝 시작 스케일(small은 팝 생략)

    // R5 내성 라벨 — 숫자 위 "RESIST"(8px, plain, stroke 없음). 숫자와 함께
    // 상승·페이드·제거(트윈 onComplete에서 destroy)되어 누수 없음.
    let label = null;
    if (isResisted) {
      label = this.add
        .text(x + driftX, y - 18, 'RESIST', {
          fontFamily: PIXEL_FONT,
          fontSize: '10px',
          color: COMBAT_CSS.resisted
        })
        .setOrigin(0.5)
        .setDepth(70);
    }

    if (!this.motionOk) {
      t.setScale(1);
      this.time.delayedCall(400, () => {
        this._releaseDmgText(t);
        label?.destroy();
      });
      return;
    }

    // 스케일 팝 — 임팩트 순간 크게 터졌다 정상으로 (숫자에만)
    this.tweens.add({
      targets: t,
      scale: 1,
      duration: MOTION.dmgPopMs,
      ease: 'Back.out'
    });

    // 상승 + 페이드 — 팝 직후 시작해 자연스럽게 이어짐. 완료 시 풀로 반납.
    this.tweens.add({
      targets: t,
      y: y - MOTION.dmgRiseY,
      alpha: 0,
      delay: MOTION.dmgFadeDelay,
      duration: MOTION.dmgFadeMs,
      ease: 'Quad.out',
      onComplete: () => this._releaseDmgText(t)
    });

    // RESIST 라벨 — 숫자와 같은 상승량으로 따라 올라가며 사라짐(상대 간격 유지).
    if (label) {
      this.tweens.add({
        targets: label,
        y: y - 18 - MOTION.dmgRiseY,
        alpha: 0,
        delay: MOTION.dmgFadeDelay,
        duration: MOTION.dmgFadeMs,
        ease: 'Quad.out',
        onComplete: () => label.destroy()
      });
    }
  }

  // 풀에서 유휴 Text를 꺼내거나(재사용) 상한 내에서 새로 만든다. 상한 초과 시 null(생략).
  _acquireDmgText() {
    let t = this._dmgPool.pop();
    if (!t) {
      if (this._dmgLive >= DMG_POOL_MAX) return null;
      // 공통 폰트만 지정해 생성 — 색/크기/stroke는 spawn 시점에 갱신.
      t = this.add.text(0, 0, '', { fontFamily: PIXEL_FONT }).setDepth(70);
    }
    this._dmgLive++;
    t.setActive(true).setVisible(true);
    return t;
  }

  // 트윈 종료/만료 시 호출 — 진행 트윈 정리 후 비활성 보관(파괴하지 않음 → 재사용).
  _releaseDmgText(t) {
    if (!t) return;
    this.tweens.killTweensOf(t);
    t.setActive(false).setVisible(false).setAlpha(1).setScale(1).setAngle(0);
    this._dmgLive = Math.max(0, this._dmgLive - 1);
    this._dmgPool.push(t);
  }

  // ── 비네트 + 위험 펄스 ──────────────────────────────────────────────
  createVignette() {
    // 은은한 상시 비네트
    const g = this.add.graphics().setDepth(50);
    g.lineStyle(3, 0x000000, 0.35);
    g.strokeRect(1.5, 1.5, LOGICAL.width - 3, COMBAT_H - 3);

    // [모션 훅] 위험 펄스용 붉은 비네트 — 평소 alpha 0, HP 위험 시 펄스.
    this.dangerVignette = this.add.graphics().setDepth(51).setAlpha(0);
    this.dangerVignette.lineStyle(6, COMBAT_COLORS.danger, 1);
    this.dangerVignette.strokeRect(3, 3, LOGICAL.width - 6, COMBAT_H - 6);
  }

  // [모션 훅] HP 위험 시 가장자리 붉은 펄스 on/off.
  // hpRatio: 현재 HP 비율(0~1) — 낮을수록 심장박동이 빠름.
  triggerDangerPulse(on, hpRatio = PLAYER.dangerThreshold) {
    if (on === this.dangerOn) return;
    this.dangerOn = on;

    // LAST SALVAGE 사투 모드 — off→on 전이 1회만 토스트(이 메서드의 동일상태 early-return이 중복 가드).
    // 빠져나오면(on=false) 토스트 없이 base 배율(×1.0)이 playerAttack에서 자동 원복.
    if (on && this.combatReady) this.showToast('LAST SALVAGE', null, true);

    if (on) {
      if (!this.motionOk) {
        this.dangerVignette.setAlpha(0.5);
        return;
      }
      this._startHeartbeatPulse(hpRatio);
    } else {
      this.dangerTween?.stop();
      this.dangerTween = null;
      // reduced-motion 비대칭 수정 — on 경로가 즉시 setAlpha이므로 off 경로도 motionOk 여부로 분기.
      // motionOk면 기존 260ms 페이드, 아니면 즉시 alpha 0으로 스냅해 대칭을 맞춘다.
      if (this.motionOk) {
        this.tweens.add({
          targets: this.dangerVignette,
          alpha: 0,
          duration: 260
        });
      } else {
        this.dangerVignette.setAlpha(0);
      }
    }
  }

  // 심장박동 리듬: 빠른 수축(in) → 느린 이완(out) → 재귀 반복.
  // HP가 낮을수록 speedMult가 커져(분모 작아짐) 빠르게 박동.
  _startHeartbeatPulse(hpRatio) {
    // 위험 구간(0~dangerThreshold)에서 hpRatio가 낮을수록 빠름
    const t = Phaser.Math.Clamp(
      (PLAYER.dangerThreshold - hpRatio) / PLAYER.dangerThreshold,
      0,
      1
    );
    const speedMult = Phaser.Math.Linear(1.0, MOTION.dangerPulseMinSpeedMult, t);
    const inMs = MOTION.dangerPulseInMs * speedMult;
    const outMs = MOTION.dangerPulseOutMs * speedMult;

    // 이전 심박 트윈 정리
    this.dangerTween?.stop();

    const beat = () => {
      if (!this.dangerOn) return; // 위험 해제되면 자동 종료
      this.dangerTween = this.tweens.add({
        targets: this.dangerVignette,
        alpha: MOTION.dangerPulseAlphaMax,
        duration: inMs,
        ease: 'Quad.in',
        onComplete: () => {
          if (!this.dangerOn) return;
          this.dangerTween = this.tweens.add({
            targets: this.dangerVignette,
            alpha: MOTION.dangerPulseAlphaMin,
            duration: outMs,
            ease: 'Quad.out',
            onComplete: beat  // 재귀 — 다음 박동
          });
        }
      });
    };
    beat();
  }

  update(time, delta) {
    this.parallax.update(delta);
    this.updateHandWeaponPos(); // 손 무기를 캐릭터(bob/런지)에 붙여 따라가게
    // 히트스톱 구간엔 director(이동/공격 타이밍)만 중단 — 트윈 연출은 계속 진행
    if (this.combatReady && time >= this.hitStopUntil) {
      this.director.update(delta);
    }
    // 보스 HP바 — 살아있는 보스 HP 비율로 갱신(rectangle width 1회, cheap).
    if (this.bossHpBar && this.boss && !this.boss.dead) this.updateBossHpBar();

    // 독웅덩이 — 만료 청소는 항상, 피해 틱은 전투 활성 + 오버레이 없을 때만(정지 중 무피해).
    this._updateHazards(time, this.combatReady && !this.upgradeLayer && !this.deathLayer);

    // 플레이어 독 DoT(투척 착탄) — 전투 활성 + 오버레이 없을 때만 틱(정지 중 무피해).
    if (this.combatReady && !this.upgradeLayer && !this.deathLayer) this._updatePlayerPoison(time);

    // 속박 테더 — 봉쇄 만료 시 시각 신호 회수(scene.time.now 비교, 새 타이머 0).
    if (this._bindTether && time >= this.playerBindUntil) this._clearBindTether();

    // 킬 콤보 만료 — 창(comboExpireAt)을 넘기면 소멸(HUD 슬라이드아웃). per-kill 타이머 0.
    if (this.comboCount > 0 && time > this.comboExpireAt) this._resetCombo();
  }
}
