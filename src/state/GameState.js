// 공유 게임 상태 — 전투 씬과 허브 씬이 같은 단일 객체를 본다.
// Phaser는 Combat/Hub를 병렬 씬으로 돌리므로(씬 간 직접 참조 X) 이 싱글톤이 둘의 다리.
// 의존성 0의 plain JS 객체 + 아주 얇은 이벤트(emit/on) 한 겹. Redux류 금지(스펙).
//
// 2레이어 구조 (로그라이크):
//   · run  — 현재 회차. 사망하면 리셋된다. 최상위 필드로 둬 기존 콜사이트 불변.
//            (coins, materials, stats, statLevels, ownedWeapons, equippedWeapon, waveIndex, runKills)
//   · meta — 여러 런을 가로지르는 영구 데이터. GameState.meta 네임스페이스.
//            (runCount, legacy, codex, enemyMemory)
//   저장도 두 키로 분리: 'last-salvage:run:v1' / 'last-salvage:meta:v1'.
//
// 이벤트:
//   'change' — 자원/스탯/장비/웨이브 무엇이든 바뀌면 발행. HUD·허브가 구독해 표시 갱신.
//   'drop'   — 전투 드롭이 들어올 때만. payload = { coins, <재료키>:n, x, y }.
//   'stats'  — 능력치가 업그레이드됐을 때. CombatScene이 maxHP 증가분을 현재 전투에 반영.

import { WAVE } from '../constants/combat.js';
import { deriveStage } from '../constants/layout.js';
import {
  STAT_UPGRADES,
  WEAPON_RECIPES,
  ENHANCE_MAX_LEVEL,
  ENHANCE_ATK_PER_LEVEL,
  enhanceCost
} from '../constants/crafting.js';
import { MATERIAL_ORDER, freshMaterials } from '../constants/materials.js';
import {
  freshMeta,
  freshLegacy,
  MEMORY_DECAY,
  MEMORY_DECAY_FLUSH,
  MEMORY_TIERS,
  MEMORY_ATTRS,
  PERMANENT_UPGRADES,
  FIRST_FORGE_MULT,
  SCAVENGER_COUNT
} from '../constants/meta.js';

// R5 적기억 스냅샷 — tally(누적 학습)에서 속성별 데미지 배율을 파생한다.
// 런 시작 시 1회만 호출해 runResistance에 고정(스냅샷). 런 중엔 tally가 자라도
// 이 값은 안 바뀐다 → "이전 런에 많이 쓴 속성 = 이번 런 그 적이 내성"을 보장.
// MEMORY_TIERS는 threshold 오름차순 — 충족하는 가장 높은 tier의 mult가 최종값.
function deriveResistance(tally) {
  const res = {};
  for (const attr of MEMORY_ATTRS) {
    const t = tally[attr] || 0;
    let mult = 1.0;
    for (const tier of MEMORY_TIERS) {
      if (t >= tier.threshold) mult = tier.mult;
    }
    res[attr] = mult;
  }
  return res;
}

// R7 — 재료 시스템 도입으로 run 세이브 스키마가 바뀌어(parts→materials) 키를 v2로 bump.
// 구 v1 런(parts 기반)은 1:1 환산 없이 조용히 폐기(load에서 제거). meta(runCount/도감)는 보존.
const RUN_KEY = 'last-salvage:run:v2';
const RUN_KEY_V1 = 'last-salvage:run:v1'; // 폐기 대상(R7 마이그레이션)
const META_KEY = 'last-salvage:meta:v1';
const OLD_KEY = 'last-salvage:save:v1'; // 구 단일키(전부 영구) — 마이그레이션 대상

// 이번 런의 속성별 처치 누적(사망 요약 "주력 속성"용). freshMaterials처럼 매 런 새 객체.
function freshAttrKills() {
  return { PHYSICAL: 0, SHOCK: 0, PIERCE: 0, FIRE: 0, TOXIC: 0 };
}

// run 최상위 필드의 base 초기값. resetRun이 이걸로 되돌린 뒤 유산을 주입한다.
function baseRun() {
  return {
    coins: 0,
    materials: freshMaterials(), // R7 — 실제 재료 7종 dict(전부 0)
    stats: { maxHP: 100, atk: 20, def: 0 },
    statLevels: { maxHP: 0, atk: 0, def: 0 },
    ownedWeapons: new Set(['pipe_wrench']),
    equippedWeapon: 'pipe_wrench',
    // R11 — 무기 강화 레벨(런 한정). id→레벨(0~ENHANCE_MAX_LEVEL). 매 런 새 객체라 사망 시 자동 리셋.
    weaponLevels: {},
    waveIndex: 0,
    runKills: 0,
    // 무피해 클리어 보너스(CLEAN SWEEP) — 이번 웨이브 중 피격 여부. 피격 시 true,
    // 웨이브 클리어 판정 후 false로 리셋. 영속 불필요(런 한정 ephemeral, saveRun에서 제외).
    waveHitFlag: false,
    runBossKills: 0, // 이번 런 보스 처치 수(런 한정) — deriveStage powerScore bossBonus 신호.
    runAttrKills: freshAttrKills(), // 속성별 처치 누적 — 사망 요약 "주력 속성"
    lastCraftedWeapon: null, // 이번 런에 마지막으로 제작한 무기(사망 요약용)
    // R9 — 웨이브 업그레이드(런 한정 버프). key→레벨/누적값 dict. 매 런 새 객체라
    // 사망(resetRun→baseRun) 시 자동 초기화. CombatScene이 getModifier로 읽어 적용.
    runModifiers: {}
  };
}

const listeners = new Map(); // event -> Set<fn>

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // 복사 후 순회 — 콜백이 off()를 불러도 안전
  for (const fn of [...set]) fn(payload);
}

const GameState = {
  // ── run: 자원/스탯/장비/진행 (최상위 — 기존 콜사이트 호환) ──────────────
  ...baseRun(),

  // ── meta: 런 간 영구 (유산/도감/적기억) ─────────────────────────────────
  meta: freshMeta(),

  // ── R5 적기억: 현재 런 고정 내성 스냅샷 { PHYSICAL:mult, ... } ──────────
  // resetRun(새 런)·load(부팅 resume)에서 (감쇠된) tally로 파생해 런 내내 불변.
  runResistance: deriveResistance(freshMeta().enemyMemory.tally),

  // ── 이벤트 ──────────────────────────────────────────────────────────
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  emit, // 외부에서 직접 발행할 일은 거의 없지만 노출

  // ── 드롭 가산 (전투에서 호출) ────────────────────────────────────────
  // delta = { coins, <재료키>:n } 중 들어온 것만. x,y는 줍기 연출용 좌표.
  applyDrop(delta, x, y) {
    // R10 coin_rush — 코인 드롭 +20%/lv. 가산 전에 배율 적용하고, 떠오르는 코인 연출(drop 이벤트)도
    // 실제 획득량과 일치하도록 배율 적용된 값으로 발행한다.
    let coins = delta.coins || 0;
    if (coins) coins = Math.floor(coins * this.getCoinMultiplier());
    if (coins) this.coins += coins;
    for (const k of MATERIAL_ORDER) if (delta[k]) this.materials[k] += delta[k];
    this._markRunDirty();
    emit('drop', { ...delta, coins, x, y });
    emit('change');
  },

  // R10 — coin_rush 레벨에 따른 코인 드롭 배율(1 + 0.20*lv). 중복 산출 방지용 단일 출처.
  getCoinMultiplier() {
    return 1 + 0.2 * (this.meta.permanentUpgrades.coin_rush || 0);
  },

  // ── 적 처치 누적 → 웨이브 진행 ──────────────────────────────────────
  // killsPerWave마다 waveIndex+1. @returns { waveChanged, waveIndex }.
  addKill() {
    this.runKills += 1;
    // 현재 장착 무기의 속성에 처치 1 가산(사망 요약 "주력 속성"용).
    const attr = WEAPON_RECIPES[this.equippedWeapon]?.attrTag;
    if (attr && this.runAttrKills[attr] != null) this.runAttrKills[attr] += 1;
    const newWave = Math.floor(this.runKills / WAVE.killsPerWave);
    const waveChanged = newWave !== this.waveIndex;
    this.waveIndex = newWave;
    this._markRunDirty();
    emit('change');
    return { waveChanged, waveIndex: this.waveIndex };
  },

  // ── R9 웨이브 업그레이드(런 한정 버프) ─────────────────────────────────
  // 5웨이브마다 고른 버프를 누적. 키→레벨(또는 누적값). 같은 버프 재선택 시 레벨++.
  // 사망 시 baseRun으로 돌아가며 runModifiers={}로 초기화(런 한정 보장).
  addRunModifier(key, amount = 1) {
    this.runModifiers[key] = (this.runModifiers[key] || 0) + amount;
    this._markRunDirty();
    emit('change');
  },
  // 조회 헬퍼 — 미선택 버프는 0. CombatScene 런타임 효과 계산에 쓴다.
  getModifier(key) {
    return this.runModifiers[key] || 0;
  },

  // ── 능력치 업그레이드 ────────────────────────────────────────────────
  // 성공 시 코인 차감 + 스탯 적용 + 레벨++ → true. 실패(코인부족/캡) → false.
  buyStatUpgrade(stat, cost, increment, maxLevel) {
    if (maxLevel != null && this.statLevels[stat] >= maxLevel) return false;
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.statLevels[stat] += 1;
    this.stats[stat] += increment;
    this._markRunDirty();
    emit('stats', { stat, increment });
    emit('change');
    return true;
  },

  // ── 합성 ─────────────────────────────────────────────────────────────
  // cost = { <재료키>: 수량 }. 보유 재료로 충족 가능한지.
  canAfford(cost) {
    for (const k of Object.keys(cost || {})) {
      if ((cost[k] || 0) > (this.materials[k] || 0)) return false;
    }
    return true;
  },
  // R10 first_forge — 이번 런 첫 합성(lastCraftedWeapon === null)이면 재료 비용을 레벨별로 할인.
  // 각 재료 Math.ceil(v * [1,0.7,0.5][lv]). craftWeapon 차감/검증과 HubScene 버튼·칩 표시가
  // 같은 결과를 보게 단일 출처로 노출(canAfford 판정과 실제 차감이 어긋나지 않게).
  effectiveCraftCost(cost) {
    const lv = this.meta.permanentUpgrades.first_forge || 0;
    if (lv <= 0 || this.lastCraftedWeapon !== null) return cost || {};
    const mult = FIRST_FORGE_MULT[lv];
    const out = {};
    for (const k of Object.keys(cost || {})) out[k] = Math.ceil(cost[k] * mult);
    return out;
  },
  craftWeapon(weaponId, cost) {
    if (this.ownedWeapons.has(weaponId)) return false;
    const eff = this.effectiveCraftCost(cost); // 첫 합성 할인 반영(차감·검증 일관)
    if (!this.canAfford(eff)) return false;
    for (const k of Object.keys(eff)) if (eff[k]) this.materials[k] -= eff[k];
    this.ownedWeapons.add(weaponId);
    this.lastCraftedWeapon = weaponId; // 사망 요약(lastRunSummary)용
    this._markRunDirty();
    this.recordCodex(weaponId); // 발견 레시피 영구 기록(meta) — R5 도감 보드용
    emit('change');
    return true;
  },
  equipWeapon(weaponId) {
    if (!this.ownedWeapons.has(weaponId)) return false;
    if (this.equippedWeapon === weaponId) return false;
    this.equippedWeapon = weaponId;
    this._markRunDirty();
    emit('change');
    return true;
  },

  // ── 무기 강화 (런 스코프) ───────────────────────────────────────────────
  // 무기 atk = 레시피 atkBonus + 강화레벨 × ENHANCE_ATK_PER_LEVEL. 전투 데미지 산출의 단일 출처.
  getWeaponAtk(weaponId) {
    return (
      (WEAPON_RECIPES[weaponId]?.atkBonus || 0) +
      (this.weaponLevels[weaponId] || 0) * ENHANCE_ATK_PER_LEVEL
    );
  },

  // 보유 무기를 1레벨 강화. 보유·레벨캡·재료 확인 후 차감 → 레벨++ → 'change'. 실패 시 false.
  enhanceWeapon(weaponId) {
    if (!this.ownedWeapons.has(weaponId)) return false;
    const level = this.weaponLevels[weaponId] || 0;
    if (level >= ENHANCE_MAX_LEVEL) return false;
    const cost = enhanceCost(weaponId, level + 1);
    if (!this.canAfford(cost)) return false;
    for (const k of Object.keys(cost)) if (cost[k]) this.materials[k] -= cost[k];
    this.weaponLevels[weaponId] = level + 1;
    this._markRunDirty();
    emit('change');
    return true;
  },

  // ── 온보딩 (meta) ────────────────────────────────────────────────────
  // 첫 탭 공격 성공 1회 호출 — 온보딩 완료 영속(이후 탭 힌트 안 뜸). 멱등(중복 호출 무해).
  markOnboarded() {
    if (this.meta.onboarded) return;
    this.meta.onboarded = true;
    this.saveMeta();
  },

  // 첫 실행 인트로(세계관→튜토리얼)를 닫으면 1회 호출 — 영속(다신 안 뜸). 멱등.
  markIntroSeen() {
    if (this.meta.introSeen) return;
    this.meta.introSeen = true;
    this.saveMeta();
  },

  // ── 엔딩(최종 보스 처치) ──────────────────────────────────────────────
  // 게이트키퍼 처치 시 1회 호출 — 클리어 기록 + New Game+ 레벨 +1(다음 런부터 난이도↑). 영속.
  recordClear() {
    this.meta.cleared = true;
    this.meta.clearCount = (this.meta.clearCount || 0) + 1;
    this.meta.ngPlus = (this.meta.ngPlus || 0) + 1;
    this.saveMeta();
  },

  // ── 도감 (meta) ──────────────────────────────────────────────────────
  recordCodex(weaponId) {
    const list = this.meta.codex.discoveredRecipes;
    if (list.includes(weaponId)) return;
    list.push(weaponId);
    this.saveMeta();
  },

  // ── 직전 런 요약 (사망 확정 시 1회 — meta 영속) ───────────────────────
  // 사망 오버레이가 RUN #N과 함께 표시한다. run 리셋 전에 호출해야 값이 살아있다.
  recordRunSummary() {
    // R8 — 잔해 포인트 산출(사망 확정 1회 호출 지점).
    //   기본 5 + 처치 5당 1 + 웨이브당 3 + 무기 제작 보너스 5.
    let earn =
      5 +
      Math.floor(this.runKills / 5) +
      this.waveIndex * 3 +
      (this.lastCraftedWeapon ? 5 : 0);
    // R10 salvage_rate — SP 적립 +15%/lv(산출 직후 배율). floor로 정수 유지.
    earn = Math.floor(earn * (1 + 0.15 * (this.meta.permanentUpgrades.salvage_rate || 0)));

    // SP 무한증식 차단: 여기서 salvagePoints에 더하지 않고 pendingSp에 "대기"만 시킨다.
    // 실제 적립은 다음 런 시작(startNewRun)에서 1회 확정. 사망 화면에서 새로고침해
    // 다음 런으로 넘어가지 않으면 미확정(미적립) — 의도된 안전(런 미확정 = SP 미지급).
    this.meta.pendingSp = earn;
    // 죽은 런을 닫는다 — 부팅 resume이 이 런(죽은 웨이브)을 풀피로 부활시키지 않게 차단(load 참조).
    this.meta.runClosed = true;

    // 이번 런 최종 도달 단계 — 런 리셋 전이라 GameState 스냅샷이 그대로 유효하다(deriveStage가 this를 읽음).
    // 역대 최고(bestStage)는 갱신만(내려가지 않음). 사망 오버레이가 "이번 N / 역대 M"을 표시.
    const runStage = deriveStage(this);
    if (runStage > (this.meta.bestStage || 1)) this.meta.bestStage = runStage;

    this.meta.lastRunSummary = {
      kills: this.runKills,
      maxWave: this.waveIndex,
      coins: this.coins,
      stage: runStage, // 이번 런 최고 단계(사망 오버레이용)
      attrKills: { ...this.runAttrKills }, // 속성별 처치 스냅샷(주력 속성 표시용)
      lastCraftedWeapon: this.lastCraftedWeapon,
      spEarned: earn // 사망 오버레이 "+N 잔해 포인트" 표시용
    };
    this.saveMeta();
  },

  // ── R8 영구 업그레이드 구매 (강화 보드) ───────────────────────────────
  // SP 충분 & 미최대면: SP 차감 + 레벨++/플래그 true, saveMeta, 'change' 발행 → true.
  // 부족·최대·미정의 키면 → false. flag형은 boolean, level형은 정수 레벨.
  buyPermanentUpgrade(key) {
    const def = PERMANENT_UPGRADES[key];
    if (!def) return false;
    const cur = this.meta.permanentUpgrades[key];
    const level = def.flag ? (cur ? 1 : 0) : cur || 0;
    if (level >= def.maxLevel) return false; // 이미 최대/해금됨
    const cost = def.costs[level]; // 다음 레벨 비용
    if (this.meta.salvagePoints < cost) return false;
    this.meta.salvagePoints -= cost;
    this.meta.permanentUpgrades[key] = def.flag ? true : level + 1;
    this.saveMeta();
    emit('change');
    return true;
  },

  // 재료 추가 드롭 확률 — '잔해 수집기'(구 scrap_magnet) 레벨당 +25%. 자동 획득 전환으로
  // 줍기 반경이 무의미해져 재해석: onEnemyKilled가 재료 종별로 이 확률만큼 +1 추가 드롭.
  getMaterialDropChance() {
    return 0.25 * (this.meta.permanentUpgrades.scrap_magnet || 0);
  },

  // ── 유산/런 사이클 ───────────────────────────────────────────────────
  // 사망 화면에서 고른 유산을 meta에 저장(다음 startNewRun이 소비).
  setLegacy(legacy) {
    this.meta.legacy = legacy ? { ...freshLegacy(), ...legacy } : freshLegacy();
    this.saveMeta();
  },

  // 최상위 run 필드를 base로 되돌린 뒤 legacy(있으면) 주입. saveRun까지.
  resetRun(legacy) {
    Object.assign(this, baseRun());
    const pu = this.meta.permanentUpgrades;
    // R8 — 영구 업글 'starting_coins'(레벨당 +8 코인)를 base 위에 주입. legacy 주입 전이라 코인 유산과 가산.
    this.coins += (pu.starting_coins || 0) * 8;
    // R10 — 시작 스탯 강화: 강화 골격(maxHP +15/lv) · 전투 본능(atk +4/lv). base 위에 가산.
    this.stats.maxHP += (pu.iron_bones || 0) * 15;
    this.stats.atk += (pu.battle_instinct || 0) * 4;
    // R10 선발굴 — 시작 시 MATERIAL_ORDER에서 랜덤으로 N개(레벨별 0/2/4/6) 뽑아 보유 재료에 가산.
    const scav = SCAVENGER_COUNT[pu.scavenger_start || 0] || 0;
    for (let i = 0; i < scav; i++) {
      const k = MATERIAL_ORDER[Math.floor(Math.random() * MATERIAL_ORDER.length)];
      this.materials[k] += 1;
    }
    if (legacy && legacy.type) this.applyLegacy(legacy);
    // R5 내성 스냅샷 — 이 시점의 (startNewRun에서 이미 감쇠된) tally로 고정.
    this.runResistance = deriveResistance(this.meta.enemyMemory.tally);
    this._markRunDirty();
  },

  // ── 설정: 현재 런만 초기화 (메타/유산 보존) ───────────────────────────────
  // 설정 화면 "런 포기/초기화"용. resetRun은 내부 사이클(startNewRun)에서도 쓰여
  // emit을 안 하므로, 외부 진입점은 이 래퍼로 'change' 발행 + 즉시 저장까지 책임진다.
  // 유산은 주입하지 않는다(현재 런을 깨끗한 base로 되돌림). meta는 그대로.
  resetRunPublic() {
    this.resetRun(null);
    this.flushRun(); // 디바운스 대기 없이 즉시 영속(설정 액션은 손실 민감)
    emit('change');
    return true;
  },

  // 유산 1개를 새 런 시작값에 반영. (carry는 base 위에 가산/대체)
  applyLegacy(legacy) {
    switch (legacy.type) {
      case 'weapon':
        if (legacy.weapon) {
          this.ownedWeapons.add(legacy.weapon);
          this.equippedWeapon = legacy.weapon; // 직접 장착(검증은 ownedWeapons로 충족)
        }
        break;
      case 'materials':
        for (const k of MATERIAL_ORDER) this.materials[k] += legacy.materials?.[k] || 0;
        break;
      case 'coins':
        this.coins += legacy.coins || 0;
        break;
      case 'stat': {
        const def = STAT_UPGRADES[legacy.stat];
        if (def) {
          this.statLevels[legacy.stat] = 1;
          this.stats[legacy.stat] += def.increment; // statLevel 1 상당치로 시작
        }
        break;
      }
      default:
        break;
    }
  },

  // 새 런 시작: meta.legacy 소비 → resetRun → runCount++. 적기억 tally 감쇠도 여기서.
  startNewRun() {
    // 직전 런(사망 확정)의 대기 SP를 이 시점에 1회 확정 적립 — recordRunSummary는 적립을 미루므로
    // "다음 런으로 넘어감 = 직전 런 확정"이 SP 지급 시점이다(사망→새로고침은 미적립). 소비 후 0.
    if (this.meta.pendingSp) {
      this.meta.salvagePoints += this.meta.pendingSp;
      this.meta.pendingSp = 0;
    }
    this.meta.runClosed = false; // 새 런 정상 시작 — 닫힘 해제(아래 saveMeta로 영속)
    this.decayEnemyMemory(); // R5 내성 계산 전, 과거 학습을 절반 감쇠해두기(적용만)
    const legacy = this.meta.legacy;
    this.resetRun(legacy && legacy.type ? legacy : null);
    this.meta.legacy = freshLegacy(); // 유산 소비(type=null)
    this.meta.runCount += 1;
    this.saveMeta();
    this.flushRun(); // 새 런 시작은 손실 민감 경계 — 디바운스 대기 없이 즉시 기록
    emit('change');
  },

  // 적기억 tally floor(*0.5) 감쇠 — R5 내성 계산용 누적치 관리.
  decayEnemyMemory() {
    // R8 — 'memory_flush' 해금 시 감쇠 비율을 0.7로(더 잘 잊음 = 내성 쌓이기 어려움).
    const rate = this.meta.permanentUpgrades.memory_flush ? MEMORY_DECAY_FLUSH : MEMORY_DECAY;
    const t = this.meta.enemyMemory.tally;
    for (const k of Object.keys(t)) t[k] = Math.floor(t[k] * rate);
  },

  // ── run 저장 디바운스 ────────────────────────────────────────────────
  // 한 처치당 addKill+applyDrop이 saveRun을 2번 부르고, 고웨이브 처치 폭주 시
  // 초당 수회 JSON.stringify+setItem(동기)이 메인스레드를 막았다(perf P1-1).
  // → 런 변경은 _markRunDirty()로 플래그만 세우고, 실제 write는 setTimeout(0)으로
  //   다음 매크로태스크에 1회로 합친다(같은 틱의 N회 변경 → write 1회).
  //   로그라이크라 처치 단위 즉시저장 손실은 허용. 단 손실 민감 경계
  //   (새 런 시작 / 탭 숨김·종료)에서는 flushRun()으로 즉시 동기 기록한다.
  _runDirty: false,
  _runFlushHandle: null,
  _autoFlushInstalled: false,

  _markRunDirty() {
    this._runDirty = true;
    if (this._runFlushHandle != null) return; // 이미 예약됨 — 1틱당 1회
    this._runFlushHandle = setTimeout(() => {
      this._runFlushHandle = null;
      this.flushRun();
    }, 0);
  },

  // 더티면 즉시 동기 기록 + 예약 취소(중복 write 방지). 안전하게 여러 번 호출 가능.
  flushRun() {
    if (this._runFlushHandle != null) {
      clearTimeout(this._runFlushHandle);
      this._runFlushHandle = null;
    }
    if (!this._runDirty) return;
    this._runDirty = false;
    this.saveRun();
  },

  // 탭 숨김(모바일 백그라운드 전환)·페이지 종료 시 더티 런을 잃지 않게 즉시 flush.
  // pagehide는 beforeunload보다 모바일에서 신뢰도가 높고, visibilitychange(hidden)는
  // 백그라운드 전환(앱 전환/탭 숨김)을 잡는다. load()에서 1회만 설치.
  installAutoFlush() {
    if (this._autoFlushInstalled) return;
    this._autoFlushInstalled = true;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const flush = () => this.flushRun();
    window.addEventListener('visibilitychange', () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  },

  // ── localStorage: run / meta 두 키로 분리 ────────────────────────────
  saveRun() {
    try {
      localStorage.setItem(
        RUN_KEY,
        JSON.stringify({
          coins: this.coins,
          materials: this.materials,
          stats: this.stats,
          statLevels: this.statLevels,
          ownedWeapons: [...this.ownedWeapons],
          equippedWeapon: this.equippedWeapon,
          weaponLevels: this.weaponLevels,
          waveIndex: this.waveIndex,
          runKills: this.runKills,
          runBossKills: this.runBossKills,
          runAttrKills: this.runAttrKills,
          lastCraftedWeapon: this.lastCraftedWeapon,
          runModifiers: this.runModifiers
        })
      );
    } catch {
      /* 비공개 모드/용량초과 — 저장 실패해도 게임 진행은 계속 */
    }
  },
  saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch {
      /* noop — 저장 실패해도 진행 계속 */
    }
  },

  // ── 설정: 전체 세이브 초기화 (런 + 메타 영구 데이터까지) ────────────────────
  // RUN_KEY/META_KEY를 지우고 메모리 상태도 공장초기값으로 되돌린다. 영속 자체를 끊기
  // 위해 예약된 디바운스 flush도 취소한다(지운 직후 재기록 방지). 실제 깨끗한 부팅은
  // 호출 측에서 location.reload()로 마무리한다 — 이 함수는 storage/메모리만 정리하고 true 반환.
  wipeAllSaves() {
    if (this._runFlushHandle != null) {
      clearTimeout(this._runFlushHandle);
      this._runFlushHandle = null;
    }
    this._runDirty = false;
    try {
      localStorage.removeItem(RUN_KEY);
      localStorage.removeItem(META_KEY);
    } catch {
      /* noop — 제거 실패해도 메모리는 초기화하고 reload로 정리됨 */
    }
    // 메모리 상태 초기값으로 — reload 전에 어떤 코드가 읽어도 잔여 데이터가 안 보이게.
    Object.assign(this, baseRun());
    this.meta = freshMeta();
    this.runResistance = deriveResistance(this.meta.enemyMemory.tally);
    return true;
  },

  load() {
    this.installAutoFlush(); // 탭 숨김/종료 시 더티 런 즉시 flush 보장
    this.loadMeta(); // 영구 메타 먼저
    this.migrateOldSave(); // 구 단일키 → 도감 씨앗 이관(메타 비었을 때만) + 구키 제거
    this.dropV1Run(); // R7 — parts 기반 v1 런 폐기(meta는 보존, 1:1 환산 안 함)
    // 사망으로 닫힌 런(runClosed)은 복원하지 않는다 — 죽은 런이 풀피로 부활하는
    // 새로고침 익스플로잇 차단. 닫힌 런 세이브는 제거하고 base로 시작(다음 startNewRun이 새 런 기록).
    if (this.meta.runClosed) this.dropClosedRun();
    else this.loadRun(); // 진행 중이던 런(없으면 base 유지)
    // 부팅 resume 경로는 startNewRun/resetRun을 안 거친다 → 여기서 스냅샷을 잡아야
    // 이어하는 런에도 유효한 내성이 적용된다(로드된 tally 기준).
    this.runResistance = deriveResistance(this.meta.enemyMemory.tally);
  },

  loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      const m = freshMeta();
      m.runCount = d.runCount ?? m.runCount;
      m.onboarded = d.onboarded ?? false; // 온보딩 완료 플래그(구 세이브엔 없으면 false — 첫 탭 힌트 노출)
      m.introSeen = d.introSeen ?? false; // 인트로 노출 완료(구 세이브엔 없으면 false — 첫 실행 인트로 노출)
      m.cleared = d.cleared ?? false;     // 엔딩 도달 여부(구 세이브엔 없으면 false)
      m.clearCount = d.clearCount ?? 0;   // 누적 클리어 횟수
      m.ngPlus = d.ngPlus ?? 0;           // New Game+ 레벨
      m.salvagePoints = d.salvagePoints ?? 0; // R8 — 영구 화폐(구 세이브엔 없으면 0)
      m.pendingSp = d.pendingSp ?? 0;         // 대기 SP(구 세이브엔 없으면 0 — 폴백)
      m.runClosed = d.runClosed ?? false;     // 닫힌 런 플래그(구 세이브엔 없으면 false — 폴백)
      m.bestStage = d.bestStage ?? 1;         // 역대 최고 단계(구 세이브엔 없으면 1 — 폴백)
      if (d.permanentUpgrades) m.permanentUpgrades = { ...m.permanentUpgrades, ...d.permanentUpgrades };
      if (d.legacy) m.legacy = { ...m.legacy, ...d.legacy };
      if (Array.isArray(d.codex?.discoveredRecipes)) {
        m.codex.discoveredRecipes = [...new Set(d.codex.discoveredRecipes)];
      }
      if (d.enemyMemory?.tally) m.enemyMemory.tally = { ...m.enemyMemory.tally, ...d.enemyMemory.tally };
      if (d.lastRunSummary) m.lastRunSummary = { ...m.lastRunSummary, ...d.lastRunSummary };
      this.meta = m;
    } catch {
      /* 손상 메타 — 기본값 유지 */
    }
  },

  loadRun() {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.coins = d.coins ?? this.coins;
      this.materials = { ...freshMaterials(), ...(d.materials || {}) };
      this.stats = { ...this.stats, ...(d.stats || {}) };
      this.statLevels = { ...this.statLevels, ...(d.statLevels || {}) };
      if (Array.isArray(d.ownedWeapons)) this.ownedWeapons = new Set(d.ownedWeapons);
      this.ownedWeapons.add('pipe_wrench'); // 기본 무기는 항상 보유
      this.equippedWeapon = d.equippedWeapon ?? this.equippedWeapon;
      this.weaponLevels = { ...(d.weaponLevels || {}) }; // 구 세이브엔 없으면 빈 객체(폴백)
      this.waveIndex = d.waveIndex ?? 0;
      this.runKills = d.runKills ?? 0;
      this.runBossKills = d.runBossKills ?? 0; // 구 세이브엔 없으면 0(폴백)
      this.runAttrKills = { ...freshAttrKills(), ...(d.runAttrKills || {}) };
      this.lastCraftedWeapon = d.lastCraftedWeapon ?? null;
      this.runModifiers = { ...(d.runModifiers || {}) };
    } catch {
      /* 손상된 런 세이브 — base로 진행 */
    }
  },

  // R7 마이그레이션: parts(SCRAP/ELEC/POWDER) 기반 v1 런은 재료 스키마와 호환되지 않아
  // 1:1 환산 없이 조용히 폐기한다. meta(runCount/도감/적기억)는 별도 키라 그대로 보존된다.
  dropV1Run() {
    try {
      localStorage.removeItem(RUN_KEY_V1);
    } catch {
      /* noop — 제거 실패해도 v2 로드엔 영향 없음 */
    }
  },

  // 사망으로 닫힌 런 처리(부팅) — 죽은 런 세이브를 제거하고 runClosed 플래그를 내려
  // base 런으로 깨끗이 시작한다. pendingSp는 그대로 둔다(미확정 — 새 런 사망 시 recordRunSummary가
  // 덮어쓰며, 실제 적립은 startNewRun에서만). 즉 사망 후 새로고침은 SP 미적립 + 런 미부활이 보장된다.
  dropClosedRun() {
    try {
      localStorage.removeItem(RUN_KEY);
    } catch {
      /* noop — 제거 실패해도 loadRun을 건너뛰므로 죽은 런이 복원되진 않음 */
    }
    this.meta.runClosed = false;
    this.saveMeta();
  },

  // 마이그레이션: 구 v1은 전부 영구 저장 구조였다. 로그라이크(런/메타 분리)로 모델이
  // 바뀌어 구 "런 진행도"는 더 이상 의미가 없으므로 폐기한다. 단, 그동안 발견한 무기는
  // 도감 씨앗으로 살려 수집 진행을 보존한다. 처리 후 구 키는 제거(레거시 잔존 방지).
  migrateOldSave() {
    let raw;
    try {
      raw = localStorage.getItem(OLD_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      // 메타가 비어 있을 때만 씨앗 이관(이미 새 메타가 있으면 그게 진실).
      if (this.meta.codex.discoveredRecipes.length === 0 && Array.isArray(d.ownedWeapons)) {
        const seeds = [...new Set(d.ownedWeapons.filter((w) => w && w !== 'pipe_wrench'))];
        if (seeds.length) {
          this.meta.codex.discoveredRecipes = seeds;
          this.saveMeta();
        }
      }
    } catch {
      /* 손상된 구 세이브 — 무시하고 폐기 */
    } finally {
      try {
        localStorage.removeItem(OLD_KEY);
      } catch {
        /* noop */
      }
    }
  }
};

export default GameState;
