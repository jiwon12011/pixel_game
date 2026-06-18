import Phaser from 'phaser';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import CombatDirector from '../objects/CombatDirector.js';
import { TEX, ENEMY_MANIFEST, BOSS_MANIFEST, WEAPON_MANIFEST, REGION_BG_MANIFEST, STAGE_MANIFEST } from '../assets/manifest.js';
import {
  CHARACTER,
  CHARACTER_STAGES,
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
  WEAPON_HAND,
  waveParams,
  ENEMY_MEMORY_MAP,
  bossStatsForWave,
  isBossWave
} from '../constants/combat.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import { prefersReducedMotion } from '../utils/motion.js';
import GameState from '../state/GameState.js';
import { rollDrop } from '../constants/drops.js';
import { getRegion } from '../constants/regions.js';
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

// 전투 뷰(상단 58%): 4레이어 패럴랙스 + 주인공 + 자동 진행 전투.
// 적 스폰/이동/공격 타이밍은 CombatDirector가, 적 단위 연출은 Enemy가 담당.
// 주인공 연출(자동 공격 런지·피격 플래시·위험 펄스)은 이 씬이 소유한다.
export default class CombatScene extends Phaser.Scene {
  constructor() {
    super('CombatScene');
  }

  create() {
    installCrispText(this); // 모든 텍스트 2배 해상도 + 정수좌표(한글/HUD 숫자 선명화)
    this.motionOk = !prefersReducedMotion();
    this.combatReady = false;
    this.dangerOn = false;
    this.hitStopUntil = 0;   // 히트스톱 종료 타임스탬프 (ms)
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
    this._stageTexKeys = new Set(Object.values(STAGE_MANIFEST).map((e) => e.key));

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
      onDotTick: (enemy, dmg) => this.applyDotTick(enemy, dmg),
      player: {
        getX: () => this.playerX,
        // R9 cooldown_down — 레벨당 쿨타임 ×0.88(곱연산). 미선택(lv0)이면 ×1.
        getAttackCooldown: () =>
          this.currentWeapon().cooldown * Math.pow(0.88, GameState.getModifier('cooldown_down')),
        attack: (enemy) => this.playerAttack(enemy),
        takeDamage: (amount) => this.takePlayerDamage(amount)
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
    // 보스 상태 정리 — clearAll이 보스 Enemy를 파괴하므로 여기선 플래그/HP바만 즉시 회수.
    this._bossActive = false;
    this.boss = null;
    this.bossWaveIndex = 0;
    this.removeBossHpBar();
    // 사망이 공격 모션 중간에 나면 onComplete가 발화 안 해 플래그가 남는다 → 여기서 강제 해제.
    this._attacking = false;
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

  // ── 주인공 ──────────────────────────────────────────────────────────
  createCharacter() {
    // 부팅은 항상 캐시된 stage1 텍스처로 캐릭터를 만든다(stage1만 선행로드 보장).
    const bootKey = STAGE_MANIFEST[1].key;
    const tex = this.textures.get(bootKey).getSourceImage();
    this.charScale = CHARACTER.displayHeight / tex.height;
    this.charDisplayH = CHARACTER.displayHeight;

    this.shadow = this.add
      .ellipse(
        this.playerX,
        this.groundY + 4,
        CHARACTER.displayHeight * 0.42,
        12,
        0x000000,
        0.35
      )
      .setDepth(this.parallax.topDepth + 0.5);

    this.character = this.add
      .image(this.playerX, this.groundY, bootKey)
      // originX는 프레임 중심이 아니라 실측한 "몸 중심"(무기 패딩 보정) → playerX에 정확히 안착
      .setOrigin(CHARACTER.originX, CHARACTER.footOriginY)
      .setScale(this.charScale)
      .setDepth(this.parallax.topDepth + 1);

    this.startIdleBob();

    // 이어하기/유산으로 stage>1이면 해당 단계 텍스처/origin으로 즉시 교체(연출 없이).
    // stage1 텍스처는 부팅에 항상 있으니 상위 단계만 지연 로드 후 적용된다.
    if (this.characterStage > 1) this.swapCharacterStage(this.characterStage, { silent: true });
  }

  // ── 진행 단계 외형 교체 (8단계) ─────────────────────────────────────────
  // 능력치 성장(statPower)으로 단계가 오르면 해당 단계 텍스처로 교체한다.
  // 텍스처가 캐시에 있으면 즉시, 없으면 지연 로드 후 적용. 전환 히치 방지를 위해
  // 다음 단계(newStage+1)를 같은 로드 배치에 실어 선행 캐시한다(메모리 최대 2~3장).
  // opts.silent: 성장 연출 없이 텍스처만 교체(부팅/새 런 복구용).
  swapCharacterStage(newStage, opts = {}) {
    const entry = STAGE_MANIFEST[newStage];
    const conf = CHARACTER_STAGES[newStage];
    if (!entry || !conf) return;

    const next = STAGE_MANIFEST[newStage + 1]; // 다음 단계 선행 캐시 대상(있으면)
    const needNext = next && !this.textures.exists(next.key);

    if (this.textures.exists(entry.key)) {
      this._doSwap(newStage, opts.silent);
      // 현재 단계는 이미 캐시 — 다음 단계만 백그라운드 선행 로드(완료 콜백 불필요).
      if (needNext) {
        this.load.image(next.key, next.url);
        this.load.start();
      }
      return;
    }

    // 현재 단계 미캐시 — 지연 로드 후 적용. 다음 단계도 같은 배치에 실어 한 번에 받는다.
    this.load.image(entry.key, entry.url);
    if (needNext) this.load.image(next.key, next.url);
    this.load.once('complete', () => {
      if (!this.scene.isActive()) return; // 로드 중 씬이 내려갔으면 무시
      this._doSwap(newStage, opts.silent);
    });
    this.load.start();
  }

  // 단계 텍스처/origin/scale을 실제로 적용한다(텍스처 캐시 보장 후 호출).
  // 단계마다 원본 height가 달라 표시높이(displayHeight 175)를 유지하려면 scale을 재계산한다.
  _doSwap(newStage, silent = false) {
    const entry = STAGE_MANIFEST[newStage];
    const conf = CHARACTER_STAGES[newStage];
    if (!entry || !conf || !this.textures.exists(entry.key)) return;
    if (!this.character?.active) return;

    // 교체 직전 실제 표시 중인 텍스처 키 — 교체 성공 후 회수 후보(characterStage가 아니라
    // 화면에 실제로 떠 있던 키를 봐야 정확. 부팅 stage>1 복구처럼 stage값과 텍스처가 어긋나는 경우 대비).
    const prevKey = this.character.texture.key;

    // 공격 스윙 중이면 in-flight 트윈이 옛 charScale로 복귀해버린다 → 깔끔히 스냅 복구 후 교체.
    if (this._attacking) this._forceAttackRecover();

    // 새 텍스처 height로 scale 재계산 → 표시높이 동일 유지(손 무기 높이도 charDisplayH 기준 자동 반영).
    const src = this.textures.get(entry.key).getSourceImage();
    this.charScale = CHARACTER.displayHeight / src.height;
    this.charDisplayH = CHARACTER.displayHeight;

    this.character
      .setTexture(entry.key)
      .setOrigin(conf.originX, conf.footOriginY) // 단계별 실측 발끝/중심 → y=groundY 그대로 발끝 안착
      .setScale(this.charScale);

    this.characterStage = newStage;

    // 새 단계 적용 성공 후 직전 단계 텍스처를 VRAM에서 회수(보수적 가드).
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
    const killed = enemy.takeDamage(dmg, { fromDot: true });
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

  // [모션] 오버헤드 찹 — 3단계 + 무기 스윙 병렬 진행:
  //   anticipation(70ms): 캐릭터 뒤로/쪼그라들기 + 무기 머리 위로 치켜들기 (동시 시작)
  //   chop(55ms):         캐릭터 런지 + 무기 Expo.in 가속으로 내려찍기 (동시 시작)
  //   impact:             apply(데미지+히트스톱) + 카메라 셰이크 → 충격 동기화
  //   recovery(150ms):    Back.out 탄성으로 무기+캐릭터 원위치
  // 무기 position은 updateHandWeaponPos()가 매 프레임 갱신 — angle + _weaponSwingProxy.offsetY만 조작.
  // 트윈 누수 없음: killTweensOf로 연타 보호, 모든 트윈 onComplete 체인/종료.
  playerAttack(enemy) {
    const apply = () => {
      if (!enemy || enemy.dead) return;
      const weapon = this.currentWeapon();
      // 무기 atk는 강화 레벨까지 반영(GameState.getWeaponAtk 단일 출처). 런모디파이어/적기억은 dealDamage 경로 그대로.
      const base = GameState.stats.atk + GameState.getWeaponAtk(GameState.equippedWeapon);
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
            this._spawnSlashVfx(second, c);
            this._spawnImpactSparks(second, c);
          }
        }
      }

      // 히트스톱 + 임팩트 VFX — 무기 chopImpactAngle 도달·런지 완료와 동기화
      if (this.motionOk) {
        this.hitStopUntil = this.time.now + MOTION.hitStopMs;
        // 슬래시(검격 호)·스파크·적 넉백 — reduced-motion 시 이 블록 전체 생략
        const slashColor = this._slashColorForWeapon();
        this._spawnSlashVfx(enemy, slashColor);
        this._spawnImpactSparks(enemy, slashColor);
        this._applyEnemyKnockback(enemy);
      }
    };

    if (!this.motionOk) {
      // reduced-motion 경로(_attacking 미사용) — apply 예외가 director 루프로 전파되지 않게 격리.
      try {
        apply();
      } catch (e) {
        console.error('[attack apply]', e);
      }
      return;
    }

    // 재진입 가드 — 이미 스윙 중이면 새 체인을 만들지 않는다(onCombatTap의 가드와 일관).
    // director 자동공격이 진행 중 스윙에 중첩 체인을 만들면 트윈이 꼬이므로 차단한다.
    // (director는 다음 쿨다운에 다시 시도하므로 공격이 영구 누락되지 않는다. _attacking이
    //  stuck되면 영구 누락되니 아래 워치독으로 복귀를 이중 보장한다.)
    if (this._attacking) return;

    // 공격 모션 시작 — 탭 공격이 진행 중인 스윙을 리셋·중첩하지 않도록 가드.
    this._attacking = true;

    // 워치독 — 스윙 총길이+200ms까지 _attacking이 안 풀리면(복귀 onComplete 누락 등)
    // 강제로 평상복구한다. 정상 완료 시 복귀 onComplete가 이 핸들을 취소한다.
    const swingTotalMs =
      MOTION.chopWindupMs + MOTION.chopImpactMs + Math.max(MOTION.chopRecoveryMs, MOTION.recoveryMs);
    this._attackWatchdog?.remove(false);
    this._attackWatchdog = this.time.delayedCall(swingTotalMs + 200, () => {
      this._attackWatchdog = null;
      if (!this._attacking) return; // 정상 복귀됨
      console.warn('[attack watchdog] forced recovery');
      this._forceAttackRecover();
    });

    // idle bob을 일시 중지해 x/scale 트윈과 y 트윈 간섭 차단
    this.idleBobTween?.pause();

    // 무기·스윙 프록시 이전 트윈 정리 (연타 쿨다운마다 충돌 방지)
    if (this.weaponSprite?.active) {
      this.tweens.killTweensOf(this.weaponSprite);
    }
    if (!this._weaponSwingProxy) this._weaponSwingProxy = { offsetY: 0, offsetX: 0 };
    this.tweens.killTweensOf(this._weaponSwingProxy);

    // ── 1a: 무기 치켜들기 — anticipation과 동시 시작 ─────────────────────────────
    // Phaser CCW=음수: chopWindupAngle(-108°)로 헤드를 머리 위-뒤로 들어올림.
    if (this.weaponSprite?.active) {
      this.tweens.add({
        targets: this.weaponSprite,
        angle: MOTION.chopWindupAngle,
        duration: MOTION.chopWindupMs,
        ease: 'Quad.out',
        onComplete: () => {
          if (!this.weaponSprite?.active) return;

          // ── 무기 잔상 — 내려찍기 직전 치켜든 위치에 반투명 ghost로 스피드감 강조 ──
          // motionOk 안에서만 생성(reduced-motion 제외). onComplete destroy로 누수 0.
          if (this.motionOk) {
            const trail = this.add
              .image(this.weaponSprite.x, this.weaponSprite.y, this.weaponSprite.texture.key)
              .setDisplaySize(this.weaponSprite.displayWidth, this.weaponSprite.displayHeight)
              .setAngle(this.weaponSprite.angle)
              .setOrigin(0.5)
              .setAlpha(0.46)
              .setDepth(this.weaponSprite.depth - 1);
            this.tweens.add({
              targets: trail,
              alpha: 0,
              duration: 85,
              ease: 'Quad.in',
              onComplete: () => { if (trail.active) trail.destroy(); }
            });
          }

          // ── 2a: 무기 내려찍기 — 런지와 동시 ──────────────────────────────────
          // Expo.in: 처음엔 느리다가 임팩트 직전 "쾅" 가속. 총 호 160° 빠른 스윙.
          this.tweens.add({
            targets: this.weaponSprite,
            angle: MOTION.chopImpactAngle,
            duration: MOTION.chopImpactMs,
            ease: 'Expo.in'
          });
        }
      });
    }

    // ── 1b: y 오프셋 치켜들기 — 손 위치를 위로 올려 찹 호 강조 ────────────────
    this.tweens.add({
      targets: this._weaponSwingProxy,
      offsetY: MOTION.chopWindupOffsetY,
      duration: MOTION.chopWindupMs,
      ease: 'Quad.out',
      onComplete: () => {
        // ── 2b: y 오프셋 내려찍기 ─────────────────────────────────────────────
        this.tweens.add({
          targets: this._weaponSwingProxy,
          offsetY: MOTION.chopImpactOffsetY,
          duration: MOTION.chopImpactMs,
          ease: 'Expo.in'
        });
      }
    });

    // ── 1c: 캐릭터 anticipation — 살짝 뒤로 당기며 쪼그라들기 ───────────────────
    this.tweens.add({
      targets: this.character,
      x: this.playerX + MOTION.anticipationX,
      scaleX: this.charScale * MOTION.anticipationScaleX,
      scaleY: this.charScale * MOTION.anticipationScaleY,
      duration: MOTION.anticipationMs,
      ease: 'Quad.out',
      onComplete: () => {
        // ── 2c: 캐릭터 런지 — 내려찍는 순간에 앞으로 스트레치 + 몸 기울임 ──────
        // leanAngle: 발 pivot(footOriginY≈0.96) 기준 CW 기울기 — "몸을 앞으로 숙이며 내려치는" 인상.
        this.tweens.add({
          targets: this.character,
          x: this.playerX + MOTION.lungeX,
          scaleX: this.charScale * MOTION.lungeScaleX,
          scaleY: this.charScale * MOTION.lungeScaleY,
          angle: MOTION.leanAngle,
          duration: MOTION.lungeMs,
          ease: 'Expo.out',
          onComplete: () => {
            // ── 임팩트: 데미지 + 히트스톱 + 카메라 셰이크 ──────────────────────
            // 무기 chopImpactAngle 도달과 런지 완료가 동시 → 타격감 동기화.
            // apply 예외가 복귀 트윈(3a/3b/3c) 스케줄링을 막지 못하게 격리한다 — 이게 막히면
            // _attacking이 영구 true + idle bob 영구 pause로 플레이어가 굳는다(이 버그의 핵심).
            try {
              apply();
            } catch (e) {
              console.error('[attack apply]', e);
            }
            if (this.cameras?.main) {
              this.cameras.main.shake(MOTION.chopShakeMs, MOTION.chopShakeIntensity);
            }

            // ── 3a: 무기 각도 복귀 (Back.out 탄성) ──────────────────────────────
            if (this.weaponSprite?.active) {
              this.tweens.add({
                targets: this.weaponSprite,
                angle: WEAPON_HAND.angle,
                duration: MOTION.chopRecoveryMs,
                ease: 'Back.out'
              });
            }

            // ── 3b: y 오프셋 복귀 (0으로, Back.out) ─────────────────────────────
            this.tweens.add({
              targets: this._weaponSwingProxy,
              offsetY: 0,
              duration: MOTION.chopRecoveryMs,
              ease: 'Back.out'
            });

            // ── 3b': 무기 리치(thrust) — 임팩트 순간 무기를 적 방향으로 순간 내질러 "닿는" 인상 ──
            // 몸이 앞으로 안 가는 대신 무기가 찔러나가며 타격을 주도한다.
            // 스냅(즉각 오프셋 세팅) → Back.out 탄성 복귀 = 채찍 느낌.
            if (this._weaponSwingProxy) {
              this._weaponSwingProxy.offsetX = MOTION.weaponThrustPx;
              this.tweens.add({
                targets: this._weaponSwingProxy,
                offsetX: 0,
                duration: MOTION.chopRecoveryMs,
                ease: 'Back.out'
              });
            }

            // ── 3c: 캐릭터 복귀 — 탄성 오버슈트로 원위치 (angle도 0으로) ──────
            // Back.out(2.2): 기본값(1.70)보다 오버슈트 크게 — "살아있는 반동" 강화.
            this.tweens.add({
              targets: this.character,
              x: this.playerX,
              scaleX: this.charScale,
              scaleY: this.charScale,
              angle: 0,
              duration: MOTION.recoveryMs,
              ease: 'Back.out(2.2)',
              onComplete: () => {
                // 정상 복귀 — 워치독 취소 후 평상 상태로.
                this._attackWatchdog?.remove(false);
                this._attackWatchdog = null;
                this.idleBobTween?.resume();
                this._attacking = false; // 모션 종료 — 다음 탭/평타 허용
              }
            });
          }
        });
      }
    });
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
      this.character.setAngle(0); // 런지 lean 각도 리셋
    }
    this.idleBobTween?.resume();
  }

  // 적 처치 → 웨이브 진행 → 지역별 드롭 롤(웨이브 배율) → 코인 자동/재료 터치 줍기.
  onEnemyKilled(enemy) {
    SFX.play('enemy_kill'); // 처치음(픽셀 크런치) — throttle로 폭주 처치 시 스팸 억제
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
    if (waveChanged) this.refillWaveShield();

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
    const ratio = Phaser.Math.Clamp(this.boss.hp / this.boss.maxHP, 0, 1);
    this.bossHpBar.fill.width = this.bossHpBar.barW * ratio;
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
    // 방어력 피해감소 적용(적→플레이어). def*4%, 캡 20%.
    const dmg = Math.max(1, Math.round(amount * defenseMultiplier(GameState.stats.def)));
    this.playerHP = Math.max(0, this.playerHP - dmg);
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

    if (this.playerHP <= 0) this._triggerDeathFlash(() => this.onPlayerDeath());
  }

  // [모션 훅] 피격 플래시 — tint 후 타이머 clearTint (텍스처 스왑 금지).
  flashPlayer() {
    this.character.setTint(0xff5050);
    this.time.delayedCall(120, () => this.character.clearTint());
    if (!this.motionOk) return;
    this.character.x = this.playerX - 6;
    this.tweens.add({
      targets: this.character,
      x: this.playerX,
      duration: 180,
      ease: 'Back.out'
    });
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
    // teardown이 런지/idle 트윈을 죽여 x/y/scale/angle이 중간값으로 멈췄을 수 있으니 기준값 복원
    this.character.setPosition(this.playerX, this.groundY).setScale(this.charScale).setAngle(0);
    this.shadow.setScale(1).setAlpha(0.35); // 그림자 bob 기준값 복원
    this.startIdleBob(); // bob 재생성 — 이후 playerAttack의 pause/resume가 정상 동작
    // 새 런 단계 복구 — startNewRun이 런 스냅샷을 리셋했으면 stage1(맨손). 텍스처/origin/scale 복원.
    this.characterStage = deriveStage(GameState);
    this.swapCharacterStage(this.characterStage, { silent: true });
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

    this.add
      .text(x, 26, 'SCRAPPER', {
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
    this.waveText = this.add
      .text(x, 42, 'WAVE 0', {
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
      .text(78, 42, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: '#f0c040'
      })
      .setOrigin(0, 0)
      .setDepth(61);
    this.runText.setShadow(1, 1, '#000000', 0, false, true);

    const barY = 60;
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
  }
}
