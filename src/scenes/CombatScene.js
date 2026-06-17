import Phaser from 'phaser';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import CombatDirector from '../objects/CombatDirector.js';
import PickupItem from '../objects/PickupItem.js';
import { TEX, ENEMY_MANIFEST, WEAPON_MANIFEST } from '../assets/manifest.js';
import {
  CHARACTER,
  COMBAT_H,
  COMBAT_VIEW,
  GROUND_LINE_RATIO,
  LOGICAL
} from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import {
  PLAYER,
  SLICE_SPAWN_LIST,
  COMBAT_COLORS,
  COMBAT_CSS,
  MOTION,
  WAVE,
  WEAPON_HAND,
  waveParams,
  ENEMY_MEMORY_MAP
} from '../constants/combat.js';
import { PIXEL_FONT, BODY_FONT } from '../constants/fonts.js';
import { prefersReducedMotion } from '../utils/motion.js';
import GameState from '../state/GameState.js';
import { rollDrop } from '../constants/drops.js';
import { PICKUPS } from '../constants/pickups.js';
import { getRegion } from '../constants/regions.js';
import { WEAPON_RECIPES, STAT_UPGRADES, defenseMultiplier } from '../constants/crafting.js';
import { MATERIAL_META, MATERIAL_ORDER, GRADE_COLOR } from '../constants/materials.js';
import { legacyOptions } from '../constants/meta.js';

// 전투 뷰(상단 58%): 4레이어 패럴랙스 + 주인공 + 자동 진행 전투.
// 적 스폰/이동/공격 타이밍은 CombatDirector가, 적 단위 연출은 Enemy가 담당.
// 주인공 연출(자동 공격 런지·피격 플래시·위험 펄스)은 이 씬이 소유한다.
export default class CombatScene extends Phaser.Scene {
  constructor() {
    super('CombatScene');
  }

  create() {
    this.motionOk = !prefersReducedMotion();
    this.combatReady = false;
    this.dangerOn = false;
    this.hitStopUntil = 0;   // 히트스톱 종료 타임스탬프 (ms)
    this.activePickups = []; // 땅에 떨어진 재료 PickupItem들 — update에서 순회, teardown에서 정리

    this.cameras.main.setViewport(
      COMBAT_VIEW.x,
      COMBAT_VIEW.y,
      COMBAT_VIEW.width,
      COMBAT_VIEW.height
    );
    this.cameras.main.setBackgroundColor(PALETTE.bgSky);

    this.parallax = new ParallaxBackground(this, this.motionOk);

    this.groundY = COMBAT_H * GROUND_LINE_RATIO;
    this.playerX = LOGICAL.width * CHARACTER.xRatio;
    // maxHP는 GameState가 소유 — 전투 시작 시 풀피로.
    this.maxHP = GameState.stats.maxHP;
    this.playerHP = this.maxHP;

    this.createCharacter();
    this.syncHandWeapon(); // 장착 무기 손표시(맨손 stage_01 위 오버레이)
    this.createVignette();
    this.createHud();
    this.createWaveHud();
    this.createResourceHud();
    this.createToast();

    this.bindGameState();

    // 적은 일괄 선행로드하지 않는다 — 이 전투의 스폰 목록만 지연 로드 후 시작.
    this.loadEncounterEnemies(SLICE_SPAWN_LIST, () => this.startEncounter());
  }

  // GameState 구독 — 허브에서 일어난 변경(업그레이드/합성)을 전투에 즉시 반영.
  // 씬 종료 시 누수 방지를 위해 unbinder를 모아 shutdown에서 해제.
  bindGameState() {
    const offChange = GameState.on('change', () => {
      this.syncResourceHud();
      this.syncHandWeapon(); // 합성 탭에서 장착 무기를 바꾸면 손 무기도 교체
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
        getAttackCooldown: () => this.currentWeapon().cooldown,
        attack: (enemy) => this.playerAttack(enemy),
        takeDamage: (amount) => this.takePlayerDamage(amount)
      }
    });
    this.director.start();
    this.combatReady = true;
    this.refreshWaveHud();
  }

  // 진행 중인 전투를 깔끔히 내린다 — 적/트윈/타이머 누수 없이(재시작/사망 공용).
  teardownEncounter() {
    this.combatReady = false;
    this.director?.stop();
    this.director?.clearAll(); // Enemy.destroy가 트윈·컨테이너까지 정리
    this.director = null;
    this.hitStopUntil = 0;

    // 땅에 남은 줍기 아이템 전부 소멸(트윈/입력 리스너까지) — 사망/재시작 누수 0.
    for (const p of this.activePickups) p.destroy();
    this.activePickups.length = 0;

    // 주인공 트윈 정리 — 사망이 playerAttack 런지 중간에 나면 3단계 체인/onComplete
    // (idleBobTween.resume 등)이 teardown 후에도 발화해 새 런 bob 상태가 꼬인다.
    // idle bob도 character/shadow 대상이라 함께 죽으므로 restartRun에서 startIdleBob으로 재생성.
    this.tweens.killTweensOf(this.character);
    this.tweens.killTweensOf(this.shadow);
    this.idleBobTween = null;
    this.shadowBobTween = null;
  }

  // ── 주인공 ──────────────────────────────────────────────────────────
  createCharacter() {
    const tex = this.textures.get(TEX.SCRAPPER_STAGE_01).getSourceImage();
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
      .image(this.playerX, this.groundY, TEX.SCRAPPER_STAGE_01)
      // originX는 프레임 중심이 아니라 실측한 "몸 중심"(무기 패딩 보정) → playerX에 정확히 안착
      .setOrigin(CHARACTER.originX, CHARACTER.footOriginY)
      .setScale(this.charScale)
      .setDepth(this.parallax.topDepth + 1);

    this.startIdleBob();
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
    this.weaponSprite.setPosition(
      this.character.x + WEAPON_HAND.offsetX,
      this.character.y - this.charDisplayH * WEAPON_HAND.heightRatio + WEAPON_HAND.offsetY
    );
  }

  // [모션] 무기 장착 플러리시 — 스케일 팝 equipScaleFrom→1 + 각도 정착.
  // "새 무기를 쥐었다" 체감. weaponSprite.angle만 조작(position은 update()가 처리).
  // onComplete 없음 — weaponSprite는 씬 종료까지 살아있어 누수 위험 없음.
  // reduced-motion: 즉시 최종 상태(scale/angle은 applyHandWeaponTexture에서 이미 세팅).
  _playEquipFlourish(scale) {
    if (!this.weaponSprite || !this.motionOk) return;

    // 이전 플러리시·런지 스윙 트윈 정리 후 새 플러리시 시작
    this.tweens.killTweensOf(this.weaponSprite);
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

  // [모션 훅] 자동 공격 3단계: anticipation → lunge(임팩트) → recovery.
  // 데미지는 lunge 완료(풀 익스텐션) 시 적용. 히트스톱은 임팩트 직후.
  playerAttack(enemy) {
    const apply = () => {
      if (!enemy || enemy.dead) return;
      const weapon = this.currentWeapon();
      const base = GameState.stats.atk + (weapon.atkBonus || 0);
      this.dealDamage(enemy, base);

      // 관통 메카닉 — 사거리 내 2번째 적에게 falloff 추가타(감전 트리거 제외).
      if (weapon.mechanic?.type === 'pierce' && this.director) {
        const inRange = this.director.enemiesInRange(this.playerX, PLAYER.attackRange);
        const second = inRange.find((e) => e !== enemy && !e.dead);
        if (second) this.dealDamage(second, base * weapon.mechanic.falloff, true);
      }

      // 히트스톱 — director.update를 잠깐 중단해 임팩트 정지감
      if (this.motionOk) {
        this.hitStopUntil = this.time.now + MOTION.hitStopMs;
      }
    };

    if (!this.motionOk) {
      apply();
      return;
    }

    // idle bob을 일시 중지해 x/scale 트윈과 y 트윈 간섭 차단
    this.idleBobTween?.pause();

    // 1단계: anticipation — 살짝 뒤로 당기며 쪼그라들기
    this.tweens.add({
      targets: this.character,
      x: this.playerX + MOTION.anticipationX,
      scaleX: this.charScale * MOTION.anticipationScaleX,
      scaleY: this.charScale * MOTION.anticipationScaleY,
      duration: MOTION.anticipationMs,
      ease: 'Quad.out',
      onComplete: () => {
        // 2단계: 런지 — 빠르고 강하게 앞으로 (스트레치)
        this.tweens.add({
          targets: this.character,
          x: this.playerX + MOTION.lungeX,
          scaleX: this.charScale * MOTION.lungeScaleX,
          scaleY: this.charScale * MOTION.lungeScaleY,
          duration: MOTION.lungeMs,
          ease: 'Expo.out',
          onComplete: () => {
            apply(); // 풀 익스텐션 시점에 데미지 + 히트스톱

            // [모션] 런지 정점 무기 스윙 — angle만 조작(position은 update()가 처리).
            // forward → 복귀 체인. 누수 없음(weaponSprite 씬 소유, onComplete 종료).
            if (this.weaponSprite?.active && this.motionOk) {
              this.tweens.add({
                targets: this.weaponSprite,
                angle: WEAPON_HAND.angle + MOTION.lungeWeaponAngleDelta,
                duration: MOTION.lungeWeaponSwingMs,
                ease: 'Quad.out',
                onComplete: () => {
                  if (!this.weaponSprite?.active) return;
                  this.tweens.add({
                    targets: this.weaponSprite,
                    angle: WEAPON_HAND.angle,
                    duration: MOTION.recoveryMs,
                    ease: 'Back.out'
                  });
                }
              });
            }

            // 3단계: 복귀 — 탄성 있게 원위치
            this.tweens.add({
              targets: this.character,
              x: this.playerX,
              scaleX: this.charScale,
              scaleY: this.charScale,
              duration: MOTION.recoveryMs,
              ease: 'Back.out',
              onComplete: () => {
                this.idleBobTween?.resume();
              }
            });
          }
        });
      }
    });
  }

  // 적 처치 → 웨이브 진행 → 지역별 드롭 롤(웨이브 배율) → 코인 자동/재료 터치 줍기.
  onEnemyKilled(enemy) {
    // 1) 처치 누적 → 웨이브 진행. 넘어가면 HUD 갱신 + 배너(지역명 포함).
    const { waveChanged, waveIndex } = GameState.addKill();
    this.refreshWaveHud();
    if (waveChanged) this.showWaveBanner(waveIndex);

    // 2) 드롭 — 현재 웨이브의 지역 배율 반영. 코인은 round, 재료는 floor로 dropMult 반영.
    const regionId = getRegion(GameState.waveIndex).id;
    const drop = rollDrop(enemy.typeKey, regionId);
    const mult = waveParams(GameState.waveIndex).dropMult;
    if (mult !== 1) {
      drop.coins = Math.round((drop.coins || 0) * mult);
      for (const k of MATERIAL_ORDER) if (drop[k]) drop[k] = Math.floor(drop[k] * mult);
    }

    const x = enemy.container.x;
    const y = enemy.container.y - enemy.displayHeight * 0.5;

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

    // 4) 재료 — 즉시 가산하지 않고 땅에 떨어뜨린다(탭해야 획득).
    this.spawnMaterialPickups(drop, x);
  }

  // 떨어진 재료를 땅(groundY-8 근처)에 PickupItem으로 스폰. 복수는 x±spread 흩뿌림.
  // 화면 과밀(maxOnScreen 초과)이면 새 드롭은 탭 없이 자동 수집(작은 "자동수집" 표시).
  // spawnIdx: 같은 처치에서 나온 순번 → spawnDelay 스태거(cosmetic, 수명 무관).
  spawnMaterialPickups(drop, deathX) {
    const groundItemY = this.groundY + PICKUPS.groundOffsetY;
    let spawnIdx = 0;
    for (const key of MATERIAL_ORDER) {
      if (!drop[key]) continue;
      const sx = deathX + Phaser.Math.Between(-PICKUPS.spreadX, PICKUPS.spreadX);

      if (this.activePickups.length >= PICKUPS.maxOnScreen) {
        this.autoCollectMaterial(key, drop[key], sx, groundItemY);
        continue;
      }

      const pickup = new PickupItem(this, {
        matKey: key,
        count: drop[key],
        x: sx,
        y: groundItemY,
        windowMs: PICKUPS.windowMs,
        motionOk: this.motionOk,
        depth: 64, // 적(topDepth+1)·DoT 위, 데미지숫자(70)·토스트(78) 아래
        spawnDelay: spawnIdx * PICKUPS.spawnStaggerMs, // 동시 드롭 스태거 딜레이
        // 탭 시점의 실제(드리프트된) 위치에서 줍기 연출이 나도록 라이브 좌표 사용.
        onTap: (mk, cnt) => this.onPickupTapped(mk, cnt, pickup.container.x, pickup.container.y)
      });
      this.activePickups.push(pickup);
      spawnIdx++;
    }
  }

  // 재료 탭 획득 — GameState 가산('drop'/'change' 발행 → 희소 토스트 포함) + 줍기 팝 연출.
  // fromTap: true → 인벤(하단 허브) 방향 빨려가기 연출 경로.
  onPickupTapped(matKey, count, x, y) {
    GameState.applyDrop({ [matKey]: count }, x, y);
    this.popMaterial(matKey, count, x, y, 0, true);
  }

  // 과밀 자동 수집 — 즉시 가산 + 줍기 팝 + 작은 "자동수집" 태그(탭 안 했음을 알림).
  autoCollectMaterial(matKey, count, x, y) {
    GameState.applyDrop({ [matKey]: count }, x, y);
    this.popMaterial(matKey, count, x, y, 0);
    this.showAutoCollectTag(x, y);
  }

  // "자동수집" 작은 라벨 — 팝인(Back.out) → 상승 + 페이드. reduced-motion: 짧게 표시 후 제거.
  showAutoCollectTag(x, y) {
    const tag = this.add
      .text(x, y - 14, '자동수집', {
        fontFamily: BODY_FONT,
        fontSize: '8px',
        color: '#9ad0ff'
      })
      .setOrigin(0.5)
      .setDepth(67);
    tag.setShadow(1, 1, '#000000', 0, false, true);

    if (!this.motionOk) {
      this.time.delayedCall(450, () => tag.destroy());
      return;
    }

    // 팝인: 작게→1 (Back.out 살짝 과슈트) → 상승+페이드
    tag.setScale(0.55).setAlpha(0);
    this.tweens.add({
      targets: tag,
      scale: 1,
      alpha: 1,
      duration: 160,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({
          targets: tag,
          y: y - 28,
          alpha: 0,
          duration: 460,
          ease: 'Quad.out',
          onComplete: () => tag.destroy()
        });
      }
    });
  }

  // 땅에 떨어진 줍기 아이템 순회 — 좌측 드리프트 진행 + 이탈/만료분 소멸·제거.
  // 핫패스 — 역순 splice로 할당 없이 제거. (탭 소멸은 PickupItem._collect가 직접 처리)
  updatePickups(delta) {
    const list = this.activePickups;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.removed) {
        list.splice(i, 1); // 탭으로 이미 소멸된 항목 정리
        continue;
      }
      if (p.update(delta)) {
        p.destroy();
        list.splice(i, 1);
      }
    }
  }

  takePlayerDamage(amount) {
    if (this.playerHP <= 0) return;
    // 방어력 피해감소 적용(적→플레이어). def*4%, 캡 20%.
    const dmg = Math.max(1, Math.round(amount * defenseMultiplier(GameState.stats.def)));
    this.playerHP = Math.max(0, this.playerHP - dmg);
    this.updateHpBar();
    this.flashPlayer();
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
        fontSize: '12px',
        color: '#f0c040'
      })
      .setOrigin(0, 0.5);
    runText.setShadow(1, 1, '#000000', 0, false, true);
    layer.add(runText);

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
        .text(W / 2, 104 + i * 16, line, {
          fontFamily: PIXEL_FONT,
          fontSize: '10px',
          color: '#cbb89a'
        })
        .setOrigin(0.5);
      t.setShadow(1, 1, '#000000', 0, false, true);
      layer.add(t);
      return t;
    });

    const subtitleText = this.add
      .text(W / 2, 162, '유산 1개를 들고 새 런 시작', {
        fontFamily: BODY_FONT,
        fontSize: '10px',
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
    const startY = 178;

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
        fontFamily: PIXEL_FONT,
        fontSize: '12px',
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

    scrim.setAlpha(0);
    runText.setAlpha(0);
    titleText.setAlpha(0).setScale(0.55);
    summaryTexts.forEach((t, i) => t.setAlpha(0).setY(origSummaryY[i] + 8));
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
      targets: runText,
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
        fontFamily: PIXEL_FONT,
        fontSize: '11px',
        color: enabled ? '#f0c040' : '#5a4f3e'
      })
      .setOrigin(0.5);
    const detail = this.add
      .text(0, 8, this.legacyDetail(opt), {
        fontFamily: BODY_FONT,
        fontSize: '9px',
        color: enabled ? '#cbb89a' : '#4f463a',
        align: 'center'
      })
      .setOrigin(0.5);
    detail.setShadow(1, 1, '#000000', 0, false, true);

    cardContainer.add([bg, title, detail]);
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
    // teardown이 런지/idle 트윈을 죽여 x/y/scale이 중간값으로 멈췄을 수 있으니 기준값 복원
    this.character.setPosition(this.playerX, this.groundY).setScale(this.charScale);
    this.shadow.setScale(1).setAlpha(0.35); // 그림자 bob 기준값 복원
    this.startIdleBob(); // bob 재생성 — 이후 playerAttack의 pause/resume가 정상 동작
    this.syncResourceHud();
    this.startEncounter(); // 새 director 구성 + refreshWaveHud
  }

  // ── HUD: 주인공 HP바 (전투뷰 상단) ──────────────────────────────────
  createHud() {
    const x = 10;
    const y = 10;
    const w = 124;
    const h = 9;
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

    this.add
      .text(x, y + h + 4, 'SCRAPPER', {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
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
      .text(x, 34, 'WAVE 0', {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: '#ff6020'
      })
      .setOrigin(0, 0)
      .setDepth(61);
    this.waveText.setShadow(1, 1, '#000000', 0, false, true);

    const barY = 46;
    this.waveBarW = 64;
    this.add
      .rectangle(x, barY, this.waveBarW + 2, 5, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarTrack = this.add
      .rectangle(x + 1, barY + 1, this.waveBarW, 3, PALETTE.hubSecondary)
      .setOrigin(0, 0)
      .setDepth(60);
    this.waveBarFill = this.add
      .rectangle(x + 1, barY + 1, 0, 3, COMBAT_COLORS.toxic)
      .setOrigin(0, 0)
      .setDepth(61);

    this.refreshWaveHud();
  }

  refreshWaveHud() {
    if (!this.waveText) return;
    this.waveText.setText(`WAVE ${GameState.waveIndex}`);
    const inWave = GameState.runKills % WAVE.killsPerWave;
    this.waveBarFill.width = this.waveBarW * (inWave / WAVE.killsPerWave);
  }

  // [모션 훅] 웨이브 진입 배너 — "WAVE N" + 현재 지역명 서브라인. 지역이 바뀌는
  // 웨이브면 서브라인을 강조(밝은 색 + "NEW AREA" 프리픽스). 스케일인→유지→스케일업+페이드.
  showWaveBanner(n) {
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
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
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
    const x = LOGICAL.width - 54;
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
        fontSize: '11px',
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
        fontSize: '8px',
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
      // ── 탭 획득: 드라마틱 팝 → 인벤(하단) 빨려가기 ──────────────────────
      // 라벨은 팝 구간에 빠르게 페이드(빨려가는 건 아이콘만)
      this.tweens.add({
        targets: label,
        alpha: 0,
        duration: MOTION.matCollectPopMs + 60,
        ease: 'Quad.in'
      });
      // 아이콘: 스케일 팝(Back.out) → 하단 중앙으로 축소+페이드 빨려가기(Quad.in)
      this.tweens.add({
        targets: obj,
        scaleX: s0 * 1.3,
        scaleY: s0 * 1.3,
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
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
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

  // ── 데미지 숫자 팝업 ─────────────────────────────────────────────────
  spawnDamageNumber(x, y, amount, color, isResisted = false, small = false) {
    // 가로 흩뿌림: 같은 위치에 숫자가 겹치는 것 방지 + 레트로 튐 감성
    // small=true(DoT 틱)는 작은 폰트 + 팝 없이 잔잔하게 — 직접타와 시각 위계 분리.
    const driftX = Phaser.Math.Between(-MOTION.dmgDriftX, MOTION.dmgDriftX);
    const t = this.add
      .text(x + driftX, y, String(amount), {
        fontFamily: PIXEL_FONT,
        fontSize: small ? '9px' : '13px',
        color,
        stroke: '#1a1008',
        strokeThickness: small ? 2 : 3
      })
      .setOrigin(0.5)
      .setDepth(70)
      .setScale(small ? 1 : MOTION.dmgScaleFrom); // 팝 시작 스케일(small은 팝 생략)

    // R5 내성 라벨 — 숫자 위 "RESIST"(8px, plain, stroke 없음). 숫자와 함께
    // 상승·페이드·제거(트윈 onComplete에서 destroy)되어 누수 없음.
    let label = null;
    if (isResisted) {
      label = this.add
        .text(x + driftX, y - 18, 'RESIST', {
          fontFamily: PIXEL_FONT,
          fontSize: '8px',
          color: COMBAT_CSS.resisted
        })
        .setOrigin(0.5)
        .setDepth(70);
    }

    if (!this.motionOk) {
      t.setScale(1);
      this.time.delayedCall(400, () => {
        t.destroy();
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

    // 상승 + 페이드 — 팝 직후 시작해 자연스럽게 이어짐
    this.tweens.add({
      targets: t,
      y: y - MOTION.dmgRiseY,
      alpha: 0,
      delay: MOTION.dmgFadeDelay,
      duration: MOTION.dmgFadeMs,
      ease: 'Quad.out',
      onComplete: () => t.destroy()
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
      this.tweens.add({
        targets: this.dangerVignette,
        alpha: 0,
        duration: 260
      });
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
    if (this.activePickups.length) this.updatePickups(delta); // 줍기 아이템 드리프트/만료
    // 히트스톱 구간엔 director(이동/공격 타이밍)만 중단 — 트윈 연출은 계속 진행
    if (this.combatReady && time >= this.hitStopUntil) {
      this.director.update(delta);
    }
  }
}
