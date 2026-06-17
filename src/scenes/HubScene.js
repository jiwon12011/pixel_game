import Phaser from 'phaser';
import TabBar from '../objects/TabBar.js';
import { TEX, WEAPON_MANIFEST } from '../assets/manifest.js';
import { BORDER_H, HUB_H, HUB_VIEW, LOGICAL } from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import GameState from '../state/GameState.js';
import {
  STAT_UPGRADES,
  STAT_ORDER,
  upgradeCost,
  WEAPON_RECIPES,
  WEAPON_ORDER,
  ENHANCE_MAX_LEVEL,
  ENHANCE_BASE_COST,
  ENHANCE_ATK_PER_LEVEL,
  enhanceCost,
  getWeaponDPS
} from '../constants/crafting.js';
import { MATERIAL_META, MATERIAL_ORDER, GRADE_COLOR } from '../constants/materials.js';
import { PERMANENT_UPGRADES, PERMANENT_ORDER } from '../constants/meta.js';
import SFX from '../audio/sfx.js';

// 합성 허브 (하단 42%): 트럭 작업대 톤의 어두운 철판 패널 + 4탭 바.
// 능력치/합성 탭은 실제 동작(GameState 연동), 스킬/인벤은 "준비 중" 스텁.
//
// 렌더 전략: 탭 전환 시 contentLayer를 통째로 재구성하고, 자원/스탯/장비 변경('change')
//           시엔 전체 재생성 대신 refreshActive()로 값/버튼 상태만 갱신(플리커·GC 회피).
const TABS = [
  { key: 'craft', label: '합성', icon: TEX.TAB_CRAFT },
  // key는 동작(영구 강화 보드)에 맞춰 'enhance'. 아이콘 키 TEX.TAB_SKILL은 자산 파일명이라 그대로 둔다.
  { key: 'enhance', label: '강화', icon: TEX.TAB_SKILL },
  { key: 'stats', label: '능력치', icon: TEX.TAB_STATS },
  { key: 'inv', label: '인벤', icon: TEX.TAB_INVENTORY }
];

// 콘텐츠 가용영역 (designer 스펙): 좌상단(12,20) · 폭336 · 높이183. 탭바 위.
const PAD = 12;
const CONTENT = { x: PAD, y: 20, w: LOGICAL.width - PAD * 2, h: 183 };

const C = {
  gold: '#f0c040',
  orange: '#ff6020',
  toxic: '#20ff9a',
  gray: '#9a8b78',
  stub: '#7a6a50',
  btnDark: '#6a5a50',
  ink: '#1a1008'
};
const FILL = { active: 0xff6020, disabled: 0x2a2a2a };

// 무기 속성 태그 → 능력 설명 색. FIRE 주황·TOXIC 청록 표식(designer 스펙).
const ATTR_COLOR = {
  FIRE: C.orange,
  TOXIC: C.toxic,
  SHOCK: '#66ddff',
  PIERCE: '#66ddff',
  PHYSICAL: C.gray
};

export default class HubScene extends Phaser.Scene {
  constructor() {
    super('HubScene');
  }

  create() {
    installCrispText(this); // 모든 텍스트 2배 해상도 + 정수좌표(한글 선명화)
    this.cameras.main.setViewport(HUB_VIEW.x, HUB_VIEW.y, HUB_VIEW.width, HUB_VIEW.height);

    this.weaponsLoaded = false;
    this.refreshActive = null;
    this.activeTab = null;

    this.drawPanel();
    this.drawBorderStrip();
    this.drawContentBackdrop();

    this.contentLayer = this.add.container(0, 0).setDepth(10);

    this.createTabBar();
    this.bindGameState();

    // 무기 18종 백그라운드 프리페치(P1-2) — 허브는 전투와 병렬 씬이라, 여기서 미리 캐시해 두면
    // 합성 탭에서 무기를 장착했을 때 CombatScene이 textures.exists()=true로 즉시 손에 표시한다.
    // (안 하면 전투 루프 중 load.start()가 돌아 모바일에서 1~3프레임 히치)
    this.prefetchWeapons();

    this.showTab(TABS[0]);
  }

  // 무기 텍스처 일괄 로드(이미 있으면 스킵). 합성 탭 빌드와 무관하게 허브 진입 즉시 시작한다.
  // 완료 시 weaponsLoaded를 세우고, 합성 탭이 "불러오는 중"으로 떠 있으면 무기 행을 채워 다시 그린다.
  prefetchWeapons() {
    const ids = Object.keys(WEAPON_MANIFEST).filter((id) => !this.textures.exists(id));
    if (ids.length === 0) {
      this.weaponsLoaded = true;
      return;
    }
    ids.forEach((id) => this.load.image(id, WEAPON_MANIFEST[id]));
    this.load.once('complete', () => {
      this.weaponsLoaded = true;
      if (this.activeTab === 'craft') this.showTab(this.tabByKey('craft'));
      // 인벤 도감 — 텍스처가 이제 막 로드됐으니 발견 무기 아이콘을 채워 다시 그린다(탭 재구성 불필요).
      else if (this.activeTab === 'inv') this.refreshActive?.();
    });
    this.load.start();
  }

  bindGameState() {
    const off = GameState.on('change', () => this.refreshActive?.());
    this.events.once('shutdown', off);
    this.events.once('shutdown', () => this.teardownScroll());
  }

  // ── 패널/경계/배경 (기존 톤 유지) ────────────────────────────────────
  drawPanel() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x242424, 0x242424, PALETTE.hubBase, PALETTE.hubBase, 1);
    g.fillRect(0, 0, LOGICAL.width, HUB_H);

    g.lineStyle(2, PALETTE.hubSecondary, 1);
    g.strokeRect(3, BORDER_H + 1, LOGICAL.width - 6, HUB_H - BORDER_H - 2);

    const bolt = (x, y) => {
      g.fillStyle(0x5a4631, 1);
      g.fillCircle(x, y, 2.5);
      g.fillStyle(0x2a2018, 1);
      g.fillCircle(x, y, 1);
    };
    const m = 9;
    bolt(m, BORDER_H + m);
    bolt(LOGICAL.width - m, BORDER_H + m);
    bolt(m, HUB_H - m);
    bolt(LOGICAL.width - m, HUB_H - m);
  }

  drawBorderStrip() {
    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x0d0d0d, 1);
    g.fillRect(0, 0, LOGICAL.width, BORDER_H);
    const block = 12;
    for (let x = -block; x < LOGICAL.width + block; x += block * 2) {
      g.fillStyle(PALETTE.accentGold, 0.9);
      g.fillRect(x, 1, block, BORDER_H - 2);
    }
    g.fillStyle(PALETTE.hubSecondary, 1);
    g.fillRect(0, BORDER_H - 1, LOGICAL.width, 1);
  }

  // 함몰된 작업판 — 탭과 무관하게 한 번만 그린다(콘텐츠는 위 레이어에).
  drawContentBackdrop() {
    this.add
      .rectangle(LOGICAL.width / 2, CONTENT.y + CONTENT.h / 2, CONTENT.w, CONTENT.h, 0x121212, 1)
      .setStrokeStyle(1, 0x000000, 0.6)
      .setDepth(5);
  }

  createTabBar() {
    const tabBarH = 56;
    this.tabBar = new TabBar(this, {
      x: 0,
      y: HUB_H - tabBarH,
      width: LOGICAL.width,
      height: tabBarH,
      tabs: TABS,
      onChange: (_i, tab) => this.showTab(tab)
    });
  }

  // ── 탭 디스패치 ──────────────────────────────────────────────────────
  showTab(tab) {
    this.activeTab = tab.key;
    this.teardownScroll(); // 스크롤 입력/마스크 정리(합성·영구 강화 탭 전환·재진입 시)
    this.contentLayer.removeAll(true); // 이전 탭 GameObject 파기
    this.refreshActive = null;

    if (tab.key === 'stats') this.buildStatsTab();
    else if (tab.key === 'craft') this.buildCraftTab();
    else if (tab.key === 'inv') this.buildInventoryTab();
    else if (tab.key === 'enhance') this.buildPermanentTab();
    else this.buildStubTab(tab);

    SFX.play('tab'); // 탭 전환 blip (최초 create() 호출 땐 제스처 전이라 무음)
  }

  // 작은 헬퍼: 만든 객체를 contentLayer에 등록(탭 전환 시 자동 정리).
  layer(...objs) {
    this.contentLayer.add(objs);
    return objs.length === 1 ? objs[0] : objs;
  }

  // 상태 가변 버튼 — set(enabled, text, fill, textColor)로 갱신.
  //   target: 담을 컨테이너(없으면 contentLayer). 스크롤 리스트 버튼은 listContainer에 담아 함께 이동.
  //   반환에 bg를 노출 — 스크롤 컬링(뷰 밖 행 입력 차단)에서 input.enabled 토글에 사용.
  makeButton(x, y, w, h, onClick, target = null) {
    const bg = this.add.rectangle(x, y, w, h, FILL.active).setStrokeStyle(1, 0x000000, 0.45);
    // 버튼 라벨은 한글(제작/강화/장착/장착 중/재료 부족/선행 필요 등)이 섞여 BODY_FONT 11px로.
    // (↑비용·MAX 같은 숫자/영문도 BODY로 무난, 자소 뭉갬 없이 일관)
    const label = this.add
      .text(x, y, '', { fontFamily: BODY_FONT, fontSize: '11px', color: C.ink })
      .setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (!bg.visible) return; // 숨겨진 버튼(보유/미보유 토글)이 클릭을 가로채지 않게
      // 스크롤 드래그가 진행 중이면(행을 끌어 움직인 경우) 오발 제작/장착/구매를 막는다.
      if (this.scroll?.drag?.moved) return;
      if (bg.getData('enabled')) onClick();
    });
    if (target) target.add([bg, label]);
    else this.layer(bg, label);
    return {
      bg,
      label,
      set(enabled, text, fill, textColor) {
        bg.setData('enabled', enabled);
        bg.setFillStyle(fill);
        label.setText(text).setColor(textColor);
      },
      // 보유/미보유에 따라 버튼 묶음을 토글(bg+label 함께). 스크롤 컬링은 visible까지 보고 입력 제어.
      setVisible(v) {
        bg.setVisible(v);
        label.setVisible(v);
      }
    };
  }

  // ── 능력치 탭 ────────────────────────────────────────────────────────
  buildStatsTab() {
    // 제목 + 우상단 보유 코인
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, '능력치', {
        fontFamily: PIXEL_FONT, // 섹션 타이틀은 픽셀 톤 유지 — 크기 ↑ + resolution으로 선명
        fontSize: '15px',
        color: C.gold
      })
    );
    if (this.textures.exists(TEX.COIN_REWARD)) {
      const src = this.textures.get(TEX.COIN_REWARD).getSourceImage();
      this.layer(
        this.add
          .image(CONTENT.x + CONTENT.w - 64, CONTENT.y + 13, TEX.COIN_REWARD)
          .setOrigin(0, 0.5)
          .setScale(15 / src.height)
      );
    }
    this.coinBalTxt = this.add
      .text(CONTENT.x + CONTENT.w - 46, CONTENT.y + 13, '0', {
        fontFamily: PIXEL_FONT,
        fontSize: '12px',
        color: C.gold
      })
      .setOrigin(0, 0.5);
    this.layer(this.coinBalTxt);

    const rowH = 48; // 4탭 행 리듬 통일(합성 기준 48). 3행이라 시각 중심만 잡으면 충분.
    const gap = 6;
    const startY = CONTENT.y + 30;
    const chipColors = { maxHP: 0xff4848, atk: PALETTE.accentElectric, def: PALETTE.accentToxic };

    this.statRows = STAT_ORDER.map((stat, i) => {
      const def = STAT_UPGRADES[stat];
      const cy = startY + i * (rowH + gap) + rowH / 2;

      // 아이콘(색칩) + 이름
      this.layer(
        this.add.rectangle(CONTENT.x + 12, cy, 10, 10, chipColors[stat]).setStrokeStyle(1, 0x000000, 0.5)
      );
      const labelTxt = this.add
        .text(CONTENT.x + 24, cy, def.label, {
          fontFamily: BODY_FONT, // 한글 스탯 이름 — 픽셀 11px 자소 뭉갬, BODY로
          fontSize: '11px',
          color: C.gold
        })
        .setOrigin(0, 0.5);
      labelTxt.setShadow(1, 1, '#000000', 0, false, true); // 다른 탭과 일관 — 어두운 배경 가독
      this.layer(labelTxt);

      // 현재값(주황) + 증가량(청록)
      const valueTxt = this.add
        .text(CONTENT.x + 96, cy, '', { fontFamily: PIXEL_FONT, fontSize: '11px', color: C.orange })
        .setOrigin(0, 0.5);
      const incrTxt = this.add
        .text(CONTENT.x + 152, cy, '', { fontFamily: PIXEL_FONT, fontSize: '11px', color: C.toxic })
        .setOrigin(0, 0.5);
      valueTxt.setShadow(1, 1, '#000000', 0, false, true);
      incrTxt.setShadow(1, 1, '#000000', 0, false, true);
      this.layer(valueTxt, incrTxt);

      // 업그레이드 버튼(비용 표시)
      const btn = this.makeButton(CONTENT.x + CONTENT.w - 42, cy, 78, 26, () => {
        const lvl = GameState.statLevels[stat];
        if (def.maxLevel != null && lvl >= def.maxLevel) return;
        const cost = upgradeCost(stat, lvl + 1);
        if (GameState.buyStatUpgrade(stat, cost, def.increment, def.maxLevel)) {
          SFX.play('upgrade'); // 능력치업 상승음
        }
        // 성공 시 'change'/'stats' 발행 → refresh + 전투 maxHP 반영
      });

      return { stat, def, valueTxt, incrTxt, btn };
    });

    this.refreshActive = () => this.refreshStats();
    this.refreshStats();
  }

  statValueText(stat) {
    const s = GameState.stats;
    if (stat === 'def') {
      const pct = Math.round(Math.min(s.def * 4, 20));
      return `${s.def} · ${pct}%`;
    }
    return String(s[stat]);
  }

  refreshStats() {
    this.coinBalTxt.setText(String(GameState.coins));
    this.statRows.forEach(({ stat, def, valueTxt, incrTxt, btn }) => {
      valueTxt.setText(this.statValueText(stat));
      const lvl = GameState.statLevels[stat];
      const atCap = def.maxLevel != null && lvl >= def.maxLevel;
      incrTxt.setText(atCap ? '' : `+${def.increment}`);
      if (atCap) {
        btn.set(false, 'MAX', FILL.disabled, C.btnDark);
      } else {
        const cost = upgradeCost(stat, lvl + 1);
        const afford = GameState.coins >= cost;
        btn.set(afford, `↑ ${cost}`, afford ? FILL.active : FILL.disabled, afford ? C.ink : C.btnDark);
      }
    });
  }

  // ── 합성 탭 ──────────────────────────────────────────────────────────
  buildCraftTab() {
    // 무기 도면(텍스처)은 create()의 prefetchWeapons()가 백그라운드로 미리 로드한다.
    // 아직 로딩 중이면 안내만 띄우고 빠진다 — 완료 콜백이 weaponsLoaded를 세운 뒤 이 탭을 다시 그린다.
    if (!this.weaponsLoaded) {
      this.layer(
        this.add
          .text(CONTENT.x + CONTENT.w / 2, CONTENT.y + CONTENT.h / 2, '무기 도면 불러오는 중…', {
            fontFamily: BODY_FONT, // 한글 안내문 — 픽셀폰트 자소 뭉갬, BODY로
            fontSize: '11px',
            color: C.gray
          })
          .setOrigin(0.5)
      );
      return;
    }

    // 헤더(축소 26px·고정): 현재 장착 무기. 아래 스크롤 리스트와 분리해 항상 보이게 둔다.
    this.equipIcon = this.add.image(CONTENT.x + 20, CONTENT.y + 14, 'pipe_wrench').setScale(0.16);
    this.equipName = this.add
      .text(CONTENT.x + 38, CONTENT.y + 8, '', { fontFamily: BODY_FONT, fontSize: '11px', color: C.gold })
      .setOrigin(0, 0.5);
    this.equipAbility = this.add
      .text(CONTENT.x + 38, CONTENT.y + 20, '', { fontFamily: BODY_FONT, fontSize: '11px', color: C.gray })
      .setOrigin(0, 0.5);
    this.equipAbility.setShadow(1, 1, '#000000', 0, false, true);
    this.layer(this.equipIcon, this.equipName, this.equipAbility);

    // 무기 강화 Lv은 런 스코프(사망 시 리셋) — Lv.N이 다음 런에 0이 되는 걸 버그로 오인하지 않게
    // 헤더 우상단에 작게 고지. 정적 라벨이라 refreshCraft 갱신 대상 아님.
    const runLimit = this.add
      .text(CONTENT.x + CONTENT.w - 8, CONTENT.y + 10, '강화 · 이 무기만 · 런 한정', {
        fontFamily: BODY_FONT,
        fontSize: '11px', // 한글 주석 — 9px는 뭉갬, 우측 정렬이라 좌측 헤더와 안 겹침
        color: C.stub
      })
      .setOrigin(1, 0.5);
    runLimit.setShadow(1, 1, '#000000', 0, false, true);
    this.layer(runLimit);

    // 헤더 구분선
    this.layer(
      this.add.rectangle(CONTENT.x + 6, CONTENT.y + 29, CONTENT.w - 12, 1, 0x000000, 0.6).setOrigin(0, 0.5)
    );

    // ── 스크롤 리스트 영역 (공용 attachScroll) ──────────────────────────
    // 헤더(장착 무기)+구분선은 고정. 그 아래(listTop~listBottom)만 18행을 스크롤.
    // 행은 컨테이너에 1회 생성 후 컨테이너 y만 이동(매 프레임 재생성 없음 — perf).
    const rowH = 48; // designer: 32→48로 키워 아이콘/이름/능력/재료칩/버튼에 숨 쉴 여백 + 칸 구분 셀 배경 수용.
    const listTop = CONTENT.y + 31; // 51
    const listBottom = CONTENT.y + CONTENT.h - 1; // 202

    const container = this.add.container(0, 0);
    this.layer(container);

    // 행 1회 생성 — top은 절대 좌표(스크롤은 컨테이너 y로 처리).
    this.weaponRows = WEAPON_ORDER.map((id, i) =>
      this.buildWeaponRow(id, listTop + i * rowH, rowH, container)
    );

    this.attachScroll({
      container,
      listTop,
      listBottom,
      rowH,
      totalH: WEAPON_ORDER.length * rowH, // 18행
      rows: this.weaponRows
    });

    this.refreshActive = () => this.refreshCraft();
    this.refreshCraft();
  }

  buildWeaponRow(id, top, rowH, list) {
    const recipe = WEAPON_RECIPES[id];
    const cy = top + rowH / 2; // rowH 48 → cy = top + 24

    // 칸 구분 셀 배경 — 행 요소보다 먼저 add(컨테이너 뒤쪽 z). 톤은 refreshCraft가 상태별로 갱신.
    // 행 전체(top~top+rowH) 덮음: cy-rowH/2 = top. rowH 단일출처(literal 금지). 스크롤 컨테이너에 담는다.
    const cellBg = this.add
      .rectangle(CONTENT.x, cy - rowH / 2, CONTENT.w, rowH, 0x1a1008, 0.15)
      .setOrigin(0, 0);
    list.add(cellBg);
    // 행 하단 1px 구분선(칸 경계) — 셀 배경과 함께 뒤쪽 z, 스크롤 동행.
    list.add(
      this.add.rectangle(CONTENT.x, cy + rowH / 2, CONTENT.w, 1, 0x000000, 0.4).setOrigin(0, 0.5)
    );

    // 아이콘(32px 목표) — 원본 정사각 128 기준 스케일
    const icon = this.add.image(CONTENT.x + 16, cy, id);
    if (this.textures.exists(id)) {
      const src = this.textures.get(id).getSourceImage();
      icon.setScale(32 / src.height);
    }
    list.add(icon);

    // 이름(cy-13) + 능력(cy+1) — 능력은 속성색으로 FIRE 주황·TOXIC 청록 표식.
    // 한글 이름·설명은 BODY_FONT(픽셀폰트는 8~10px 한글 자소가 뭉개짐). 제목 톤(금)은 유지.
    const nameTxt = this.add
      .text(CONTENT.x + 56, cy - 13, recipe.name, {
        fontFamily: BODY_FONT,
        fontSize: '11px',
        color: C.gold
      })
      .setOrigin(0, 0.5);
    nameTxt.setShadow(1, 1, '#000000', 0, false, true);
    list.add(nameTxt);

    // 강화 레벨 표식 — "Lv.N"(보유 & Lv>0일 때만 refreshCraft가 표시). 청록으로 또렷이.
    // 좌표 고정: 한글 이름폭(BODY 렌더 변동)에 따라 흔들리지 않게 이름영역 우측 고정 x(+150)로 둔다.
    // (최장 무기명 7자 ≈ 80px < 94px 예약 → 이름과 겹치지 않고, 버튼(좌측 ~x+245)과도 안 닿음)
    const levelTxt = this.add
      .text(CONTENT.x + 150, cy - 13, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: C.toxic
      })
      .setOrigin(0, 0.5)
      .setVisible(false);
    levelTxt.setShadow(1, 1, '#000000', 0, false, true);
    list.add(levelTxt);

    // 능력 설명 — cy+1로 올려 아래 재료칩(cy+16)과 간격 확보(기존 cy+4는 칩과 겹침 빠듯).
    // lineSpacing 3 + wordWrap(버튼 직전까지)로 긴 설명이 버튼 영역으로 흘러넘치지 않게.
    const ability = this.add
      .text(CONTENT.x + 56, cy + 1, recipe.ability, {
        fontFamily: BODY_FONT,
        fontSize: '11px',
        color: ATTR_COLOR[recipe.attrTag] || C.gray,
        lineSpacing: 3,
        wordWrap: { width: 190 }
      })
      .setOrigin(0, 0.5);
    ability.setShadow(1, 1, '#000000', 0, false, true);
    list.add(ability);

    // 재료 아이콘(16px) + 보유/필요 수량(8px). 미보유=제작 비용, 보유=강화 비용으로 재활용(refreshCraft).
    //   충분(보유≥필요) 청록 / 부족 주황 — 색칩 대신 실제 재료 아이콘으로 한눈에 식별.
    //   칩 키는 제작 비용 키 우선, 비용이 빈 무기(pipe_wrench)는 강화 폴백 재료(ENHANCE_BASE_COST)로.
    const chips = [];
    const costKeys = Object.keys(recipe.cost || {});
    const chipKeys = costKeys.length > 0 ? costKeys : Object.keys(ENHANCE_BASE_COST[id] || {});
    chipKeys.forEach((matKey, k) => {
      const need = recipe.cost?.[matKey] || 0;
      const px = CONTENT.x + 56 + k * 48; // 이름/능력과 좌측 정렬, 간격 48 유지
      const py = cy + 16; // rowH 48 — 능력(cy+4) 아래 줄에 재료칩 배치
      const meta = MATERIAL_META[matKey];
      let icon;
      if (meta && this.textures.exists(meta.iconKey)) {
        const src = this.textures.get(meta.iconKey).getSourceImage();
        icon = this.add.image(px, py, meta.iconKey).setOrigin(0.5).setScale(16 / src.height);
      } else {
        icon = this.add
          .rectangle(px, py, 12, 12, GRADE_COLOR[meta?.grade] || 0x8a6a3a)
          .setOrigin(0.5)
          .setStrokeStyle(1, 0x000000, 0.5);
      }
      const txt = this.add
        .text(px + 11, py, `0/${need}`, {
          fontFamily: BODY_FONT,
          fontSize: '11px', // 보유/필요 수량 — 10→11px로 가독성 상향(그림자 + resolution)
          color: C.gray
        })
        .setOrigin(0, 0.5);
      txt.setShadow(1, 1, '#000000', 0, false, true);
      list.add([icon, txt]);
      chips.push({ matKey, need, icon, txt });
    });

    // ATK · DPS — "뭐가 센지" 한눈에. 이름 줄(cy-13) 우측: 보유 행은 버튼이 22px(이 줄 위)이라,
    //   미보유 행은 버튼(craftBtn)이 좌측 x268부터라 충돌 없음. x는 refreshCraft가 별 표식 유무로 보정.
    //   미보유=Lv0 base, 보유=현재 레벨. 강화 가능하면 "DPS 60→89"로 다음 레벨 미리보기(refreshCraft).
    const statTxt = this.add
      .text(CONTENT.x + 150, cy - 13, '', {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: C.gold
      })
      .setOrigin(0, 0.5);
    statTxt.setShadow(1, 1, '#000000', 0, false, true);
    list.add(statTxt);

    // MAX 강화 라벨 — 보유 & Lv5일 때 재료칩 자리에 표시(칩은 숨김). refreshCraft가 토글.
    const maxLabel = this.add
      .text(CONTENT.x + 56, cy + 16, '최대 강화', {
        fontFamily: BODY_FONT,
        fontSize: '11px',
        color: C.gold
      })
      .setOrigin(0, 0.5)
      .setVisible(false);
    maxLabel.setShadow(1, 1, '#000000', 0, false, true);
    list.add(maxLabel);

    // 액션 버튼 — 미보유: 제작(craftBtn 68×28). 보유: 장착(equipBtn) + 강화(enhBtn) 42×22 2개.
    // 보유/미보유는 동시 노출 안 됨(refreshCraft가 setVisible 토글) → 위치 겹쳐도 무방.
    const craftBtn = this.makeButton(
      CONTENT.x + CONTENT.w - 46,
      cy,
      68,
      28,
      () => {
        if (recipe.requires && !GameState.ownedWeapons.has(recipe.requires)) return;
        if (GameState.craftWeapon(id, recipe.cost)) {
          GameState.equipWeapon(id); // 제작 후 자동 장착
          SFX.play('craft'); // 제작 성공 상승음
        }
      },
      list
    );
    const equipBtn = this.makeButton(
      CONTENT.x + CONTENT.w - 70,
      cy,
      42,
      22,
      () => {
        if (GameState.equipWeapon(id)) SFX.play('tab'); // 장착 클릭 blip
      },
      list
    );
    const enhBtn = this.makeButton(
      CONTENT.x + CONTENT.w - 24,
      cy,
      42,
      22,
      () => {
        if (GameState.enhanceWeapon(id)) SFX.play('enhance'); // 'change' → refreshCraft 갱신
      },
      list
    );

    // R8 codex_preview — 해금 시 "지금 재료로 바로 제작 가능한 미보유 무기"에 켜지는 힌트 표식.
    // 해금 전엔 항상 숨김(차이가 보이게). 버튼 위 우상단에 작게 띄운다(스크롤 함께 이동).
    const hintTxt = this.add
      // 한글 '제작가능' — 픽셀 7px는 자소가 뭉개져 BODY로. 버튼 위 좁은 자리라 9px로 절제(우측 정렬).
      .text(CONTENT.x + CONTENT.w - 74, cy - 9, '★ 제작가능', {
        fontFamily: BODY_FONT,
        fontSize: '9px',
        color: C.toxic
      })
      .setOrigin(1, 0.5)
      .setVisible(false);
    hintTxt.setShadow(1, 1, '#000000', 0, false, true);
    list.add(hintTxt);

    return {
      id,
      recipe,
      chips,
      craftBtn,
      equipBtn,
      enhBtn,
      btnBgs: [craftBtn.bg, equipBtn.bg, enhBtn.bg], // 스크롤 컬링용(여러 버튼)
      hintTxt,
      cellBg,
      levelTxt,
      statTxt,
      maxLabel,
      cy
    };
  }

  // ── 공용 세로 스크롤 (합성·영구 강화 탭 공유) ─────────────────────────
  // 두 탭은 동시에 활성화되지 않는다(showTab이 teardownScroll 후 재구성) → 단일 상태(this.scroll)로 충분.
  // 호출 측이 listContainer에 행을 1회 채운 뒤 attachScroll로 등록. 스크롤은 컨테이너 y만 이동(perf).
  //   rows: [{ cy, btnBg }] — 뷰 밖으로 가려진 행 버튼 입력 컬링(클릭 누수 방지)용.
  attachScroll({ container, listTop, listBottom, rowH, totalH, rows }) {
    const listH = listBottom - listTop;

    // 리스트 영역만 보이게 클리핑(헤더 침범 방지). make.graphics는 표시목록 밖이라 teardown에서 직접 파기.
    const maskG = this.make.graphics();
    maskG.fillStyle(0xffffff);
    maskG.fillRect(CONTENT.x, listTop, CONTENT.w, listH);
    container.setMask(maskG.createGeometryMask());

    const minScroll = Math.min(0, listH - totalH);
    const s = {
      container,
      maskG,
      y: 0,
      min: minScroll,
      max: 0,
      listTop,
      listBottom,
      rowH,
      rows,
      drag: null,
      thumb: null
    };

    // 스크롤바 thumb — 내용이 영역을 넘칠 때만 노출. 트랙/thumb는 contentLayer 고정(스크롤 안 함).
    if (minScroll < 0) {
      const trackX = CONTENT.x + CONTENT.w - 3;
      this.layer(this.add.rectangle(trackX, listTop, 2, listH, 0x000000, 0.35).setOrigin(0.5, 0));
      const thumbH = Math.max(20, Math.round((listH * listH) / totalH));
      s.thumb = this.add.rectangle(trackX, listTop, 3, thumbH, 0xf0c040, 0.85).setOrigin(0.5, 0);
      this.layer(s.thumb);
      s.thumbTop = listTop;
      s.thumbTravel = listH - thumbH;
    }

    this.scroll = s;
    this.setupScrollInput();
    this.setScroll(0); // 초기 위치 + 입력 컬링 1회 적용
  }

  // 스크롤 입력 — 휠 + 드래그. 핸들러는 씬 전역에 1세트만(this.scroll 가드 + teardown).
  setupScrollInput() {
    const inRegion = (pointer) => {
      if (!this.scroll) return false;
      const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const s = this.scroll;
      return p.x >= CONTENT.x && p.x <= CONTENT.x + CONTENT.w && p.y >= s.listTop && p.y <= s.listBottom;
    };

    const onWheel = (pointer, _objs, _dx, dy) => {
      if (!this.scroll || !inRegion(pointer)) return;
      this.setScroll(this.scroll.y - dy * 0.5);
    };
    const onDown = (pointer) => {
      if (!this.scroll) return;
      if (!inRegion(pointer)) {
        this.scroll.drag = null;
        return;
      }
      this.scroll.drag = { startY: pointer.y, startScroll: this.scroll.y, moved: false };
    };
    const onMove = (pointer) => {
      if (!this.scroll || !this.scroll.drag) return;
      if (!pointer.isDown) {
        this.scroll.drag = null;
        return;
      }
      const dy = pointer.y - this.scroll.drag.startY;
      if (Math.abs(dy) > 3) this.scroll.drag.moved = true;
      this.setScroll(this.scroll.drag.startScroll + dy);
    };
    // 드래그 종료는 다음 프레임으로 미뤄, 같은 포인터의 버튼 pointerdown→up 동안 moved 가드가 살아있게.
    const onUp = () => {
      if (this.scroll?.drag) this.time.delayedCall(0, () => this.scroll && (this.scroll.drag = null));
    };

    this.input.on('wheel', onWheel);
    this.input.on('pointerdown', onDown);
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this._scrollInput = { onWheel, onDown, onMove, onUp };
  }

  // 스크롤 위치 적용 — 컨테이너 y 이동 + thumb 갱신 + 뷰 밖 행 입력 컬링(스크롤 시에만, 매 프레임 X).
  setScroll(y) {
    const s = this.scroll;
    if (!s) return;
    s.y = Phaser.Math.Clamp(y, s.min, s.max);
    s.container.y = s.y;

    if (s.thumb) {
      const denom = s.min - s.max; // 음수
      const t = denom === 0 ? 0 : (s.y - s.max) / denom; // 0(위)~1(아래)
      s.thumb.y = s.thumbTop + t * s.thumbTravel;
    }

    // 뷰 밖(헤더 아래로 가려진) 행의 버튼은 입력 차단 — 클릭 누수 방지.
    // 행에 버튼이 여럿이면(무기행: 제작/장착/강화) btnBgs로, 단일이면 btnBg로 컬링.
    // 숨겨진 버튼(보유/미보유 토글)은 뷰 안이라도 입력 비활성(가려진 버튼 오발 방지).
    const half = s.rowH / 2;
    s.rows.forEach((r) => {
      const screenY = r.cy + s.y;
      const visible = screenY >= s.listTop - half && screenY <= s.listBottom + half;
      const bgs = r.btnBgs || (r.btnBg ? [r.btnBg] : []);
      for (const bg of bgs) if (bg && bg.input) bg.input.enabled = visible && bg.visible;
    });
  }

  // 스크롤 입력/마스크 정리 — 탭 전환·재진입·씬 종료 시. 미설정 상태에서 호출해도 안전.
  teardownScroll() {
    if (this._scrollInput) {
      this.input.off('wheel', this._scrollInput.onWheel);
      this.input.off('pointerdown', this._scrollInput.onDown);
      this.input.off('pointermove', this._scrollInput.onMove);
      this.input.off('pointerup', this._scrollInput.onUp);
      this._scrollInput = null;
    }
    if (this.scroll?.maskG) this.scroll.maskG.destroy();
    this.scroll = null;
  }

  refreshCraft() {
    // 헤더(장착 무기)
    const eq = WEAPON_RECIPES[GameState.equippedWeapon] || WEAPON_RECIPES.pipe_wrench;
    if (this.textures.exists(eq.id)) {
      const src = this.textures.get(eq.id).getSourceImage();
      this.equipIcon.setTexture(eq.id).setScale(22 / src.height); // 축소 헤더에 맞춤
    }
    this.equipName.setText(eq.name);
    this.equipAbility.setText(`장착 중 · ${eq.ability}`);

    // R8 codex_preview 해금 여부 — 미보유·제작가능 무기에 힌트 표식을 켤지 결정.
    const codexPreview = !!GameState.meta.permanentUpgrades.codex_preview;

    // 슬롯들
    const playerAtk = GameState.stats.atk; // DPS 표시에 쓸 플레이어 기본 공격력(단일 출처)

    this.weaponRows.forEach(
      ({ id, recipe, chips, craftBtn, equipBtn, enhBtn, hintTxt, cellBg, levelTxt, statTxt, maxLabel }) => {
        const owned = GameState.ownedWeapons.has(id);
        const equipped = GameState.equippedWeapon === id;
        const prereqOk = !recipe.requires || GameState.ownedWeapons.has(recipe.requires);
        const level = GameState.weaponLevels[id] || 0;
        const atMax = level >= ENHANCE_MAX_LEVEL;

        // 셀 배경 톤 — 장착중(골드 강조)/보유/미보유 단계별. 상태 차이가 또렷하게(영구 탭과 동일 스케일).
        if (equipped) cellBg.setFillStyle(0xf0c040, 0.17);
        else if (owned) cellBg.setFillStyle(0x1a1008, 0.25);
        else cellBg.setFillStyle(0x1a1008, 0.15);

        // 레벨 표식 — 보유 & Lv>0일 때 진척을 별로 시각화(★채움/☆빈칸, 픽셀 톤).
        levelTxt.setVisible(owned && level > 0);
        if (owned && level > 0) {
          levelTxt.setText('★'.repeat(level) + '☆'.repeat(ENHANCE_MAX_LEVEL - level));
        }

        // ATK · DPS — 미보유=Lv0 base, 보유=현재 레벨. 보유·미MAX면 다음 레벨 DPS를 "→N"으로 미리보기.
        //   별 표식(레벨>0)이 보일 땐 그 우측(+50)으로 밀어 겹침 방지. 미보유는 craftBtn(x268)과 안 닿음.
        const shownLevel = owned ? level : 0;
        const atk = (recipe.atkBonus || 0) + shownLevel * ENHANCE_ATK_PER_LEVEL;
        const dps = getWeaponDPS(id, shownLevel, playerAtk);
        if (owned && !atMax) {
          const nextDps = getWeaponDPS(id, level + 1, playerAtk);
          statTxt.setText(`ATK ${atk} · DPS ${dps}→${nextDps}`);
        } else {
          statTxt.setText(`ATK ${atk} · DPS ${dps}`);
        }
        statTxt.setX(owned && level > 0 ? CONTENT.x + 200 : CONTENT.x + 150);

        // 버튼 가시성 — 보유: 장착+강화 / 미보유: 제작.
        craftBtn.setVisible(!owned);
        equipBtn.setVisible(owned);
        enhBtn.setVisible(owned);

        if (owned) {
          // 강화 비용(다음 레벨)으로 칩 재활용. MAX면 칩 숨기고 "최대 강화" 라벨.
          // first_forge 할인은 제작 비용에만 적용 — 강화 비용엔 무관(enhanceCost 단일 출처).
          const ecost = atMax ? {} : enhanceCost(id, level + 1);
          maxLabel.setVisible(atMax);
          hintTxt.setVisible(false);
          chips.forEach(({ matKey, icon, txt }) => {
            const needNow = ecost[matKey] || 0;
            if (atMax || needNow <= 0) {
              icon.setVisible(false);
              txt.setVisible(false);
              return;
            }
            icon.setVisible(true);
            txt.setVisible(true);
            const have = GameState.materials[matKey] || 0;
            txt.setText(`${have}/${needNow}`);
            txt.setColor(have >= needNow ? C.toxic : C.orange);
          });

          // 장착 버튼 — 장착중이면 비활성 표기.
          if (equipped) equipBtn.set(false, '장착 중', FILL.disabled, C.gold);
          else equipBtn.set(true, '장착', FILL.active, C.ink);

          // 강화 버튼 — MAX 비활성 / 재료부족 비활성 / afford 활성.
          if (atMax) enhBtn.set(false, 'MAX', FILL.disabled, C.gold);
          else if (!GameState.canAfford(ecost)) enhBtn.set(false, '강화', FILL.disabled, C.btnDark);
          else enhBtn.set(true, '강화', FILL.active, C.ink);
        } else {
          // 미보유 — 제작 비용 표시(R10 first_forge 첫 합성 할인 반영, craftWeapon 차감과 동일 출처).
          maxLabel.setVisible(false);
          const eff = GameState.effectiveCraftCost(recipe.cost);
          hintTxt.setVisible(codexPreview && prereqOk && GameState.canAfford(eff));
          chips.forEach(({ matKey, need, icon, txt }) => {
            const needNow = eff[matKey] ?? need; // 할인 적용 시 줄어든 필요 수량
            if (needNow <= 0) {
              icon.setVisible(false);
              txt.setVisible(false);
              return;
            }
            icon.setVisible(true);
            txt.setVisible(true);
            const have = GameState.materials[matKey] || 0;
            txt.setText(`${have}/${needNow}`);
            txt.setColor(have >= needNow ? C.toxic : C.orange);
          });

          if (!prereqOk) craftBtn.set(false, '선행 필요', FILL.disabled, C.btnDark);
          else if (!GameState.canAfford(eff)) craftBtn.set(false, '재료 부족', FILL.disabled, C.btnDark);
          else craftBtn.set(true, '제작', FILL.active, C.ink);
        }
      }
    );
  }

  // ── 인벤 탭 — 보유 재료(슬롯 그리드) + 발견한 무기 도감 ─────────────────
  // 전투 HUD에서 뺀 재료를 여기서 본다. 2열 슬롯 그리드(아이콘 + 한글 이름 + 보유수).
  // 그 아래 "발견한 무기" 도감 그리드(6열) — discoveredRecipes는 아이콘, 미발견은 ??? 어두운 칸.
  // 재료(8)+무기(18)가 CONTENT 높이를 넘쳐 합성/영구 탭과 같은 공용 스크롤(attachScroll)로 묶는다.
  // 제목만 고정, 그 아래 두 그리드가 함께 스크롤. 'change' 구독으로 수량/발견 상태를 갱신한다.
  buildInventoryTab() {
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, '재료', {
        fontFamily: PIXEL_FONT, // 섹션 타이틀 — 픽셀 톤 유지(크기 ↑)
        fontSize: '15px',
        color: C.gold
      })
    );

    // 스크롤 컨테이너 — 두 그리드를 절대 좌표로 1회 배치 후 컨테이너 y만 이동(perf).
    const listTop = CONTENT.y + 26; // 46 — 제목 아래
    const listBottom = CONTENT.y + CONTENT.h - 1; // 202
    const container = this.add.container(0, 0);
    this.layer(container);

    // ── 재료 그리드 (2열) ──────────────────────────────────────────────
    const cols = 2;
    const colW = CONTENT.w / cols; // 168
    const cellGutter = 6;
    const cellW = colW - cellGutter;
    const cellH = 34;
    const rowGap = 4;
    const gridTop = listTop;

    this.invCells = MATERIAL_ORDER.map((key, i) => {
      const meta = MATERIAL_META[key];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = CONTENT.x + col * colW + colW / 2;
      const cy = gridTop + row * (cellH + rowGap) + cellH / 2;
      const leftX = cx - cellW / 2;

      // 슬롯 배경 — 다른 탭 셀배경과 같은 ink 톤(0x1a1008)으로 통일. stroke 0.45.
      container.add(
        this.add.rectangle(cx, cy, cellW, cellH, 0x1a1008, 1).setStrokeStyle(1, 0x000000, 0.45)
      );

      // 아이콘(22px) — 없으면 등급색 칩 폴백.
      let icon;
      if (this.textures.exists(meta.iconKey)) {
        const src = this.textures.get(meta.iconKey).getSourceImage();
        icon = this.add.image(leftX + 18, cy, meta.iconKey).setOrigin(0.5).setScale(22 / src.height);
      } else {
        icon = this.add
          .rectangle(leftX + 18, cy, 16, 16, GRADE_COLOR[meta.grade] || 0x8a6a3a)
          .setOrigin(0.5)
          .setStrokeStyle(1, 0x000000, 0.5);
      }
      container.add(icon);

      // 이름(상단, BODY 11px 금) + 보유수(하단, 픽셀 12px) — 텍스트는 아이콘 우측 정렬.
      const textX = leftX + 36;
      const name = this.add
        .text(textX, cy - 7, meta.name, {
          fontFamily: BODY_FONT,
          fontSize: '11px',
          color: C.gold
        })
        .setOrigin(0, 0.5);
      name.setShadow(1, 1, '#000000', 0, false, true);
      const qty = this.add
        .text(textX, cy + 8, '0', {
          fontFamily: PIXEL_FONT,
          fontSize: '12px',
          color: C.toxic
        })
        .setOrigin(0, 0.5);
      qty.setShadow(1, 1, '#000000', 0, false, true);
      container.add([name, qty]);

      return { key, icon, name, qty };
    });

    const matRows = Math.ceil(MATERIAL_ORDER.length / cols); // 4
    const matBottom = gridTop + matRows * (cellH + rowGap); // 198

    // ── 발견한 무기 도감 섹션 헤더 ("발견 N/18") ─────────────────────────
    const headerY = matBottom + 12;
    container.add(
      this.add.rectangle(CONTENT.x + 4, headerY - 6, CONTENT.w - 8, 1, 0x000000, 0.5).setOrigin(0, 0.5)
    );
    this.codexCountTxt = this.add
      .text(CONTENT.x + 4, headerY + 6, `발견한 무기 0/${WEAPON_ORDER.length}`, {
        fontFamily: BODY_FONT, // 한글 섹션 라벨 — BODY로
        fontSize: '11px',
        color: C.gold
      })
      .setOrigin(0, 0.5);
    this.codexCountTxt.setShadow(1, 1, '#000000', 0, false, true);
    container.add(this.codexCountTxt);

    // ── 무기 도감 그리드 (6열) — 발견=아이콘, 미발견=??? 어두운 칸 ──────────
    const wCols = 6;
    const wColW = CONTENT.w / wCols; // 56
    const wCellSize = 40;
    const wGap = 6;
    const wGridTop = headerY + 18;

    this.codexCells = WEAPON_ORDER.map((id, i) => {
      const col = i % wCols;
      const row = Math.floor(i / wCols);
      const cx = CONTENT.x + col * wColW + wColW / 2;
      const cy = wGridTop + row * (wCellSize + wGap) + wCellSize / 2;

      const bg = this.add.rectangle(cx, cy, wCellSize, wCellSize, 0x0f0c08, 1).setStrokeStyle(1, 0x000000, 0.45);
      const icon = this.add.image(cx, cy, 'pipe_wrench').setOrigin(0.5).setVisible(false);
      // 미발견 실루엣 표식 — 어두운 칸 위 흐린 ???
      const lock = this.add
        .text(cx, cy, '?', { fontFamily: PIXEL_FONT, fontSize: '16px', color: C.stub })
        .setOrigin(0.5);
      container.add([bg, icon, lock]);
      return { id, bg, icon, lock };
    });

    const wRows = Math.ceil(WEAPON_ORDER.length / wCols); // 3
    const totalH = wGridTop + wRows * (wCellSize + wGap) - listTop;

    this.attachScroll({
      container,
      listTop,
      listBottom,
      rowH: wCellSize,
      totalH,
      rows: [] // 인벤은 클릭 버튼이 없어 입력 컬링 불필요(스크롤 위치/마스크만 사용)
    });

    this.refreshActive = () => this.refreshInventory();
    this.refreshInventory();
  }

  // 'change' 구독으로 실시간 갱신 — 재료 0개는 흐리게, 무기 도감은 발견/미발견 상태로.
  refreshInventory() {
    this.invCells.forEach(({ key, icon, name, qty }) => {
      const n = GameState.materials[key] || 0;
      const has = n > 0;
      qty.setText(String(n));
      qty.setColor(has ? C.toxic : C.stub);
      name.setColor(has ? C.gold : C.stub);
      icon.setAlpha(has ? 1 : 0.35);
    });

    if (!this.codexCells) return;
    // 발견 판정: 기본 무기(pipe_wrench)는 항상 보유로 간주 + 제작/보스해금된 레시피(meta.codex).
    const disc = GameState.meta.codex.discoveredRecipes;
    let found = 0;
    this.codexCells.forEach(({ id, bg, icon, lock }) => {
      const known = id === 'pipe_wrench' || disc.includes(id);
      if (known) found += 1;
      if (known && this.textures.exists(id)) {
        const src = this.textures.get(id).getSourceImage();
        icon
          .setTexture(id)
          .setScale(30 / Math.max(src.width, src.height))
          .setVisible(true)
          .setAlpha(1);
        lock.setVisible(false);
        bg.setFillStyle(0x1a1008, 1).setStrokeStyle(1, 0x3d2b1a, 0.9);
      } else {
        // 미발견(또는 텍스처 미로드) — 어두운 실루엣 칸 + ???
        icon.setVisible(false);
        lock.setVisible(true);
        bg.setFillStyle(0x0f0c08, 1).setStrokeStyle(1, 0x000000, 0.45);
      }
    });
    this.codexCountTxt.setText(`발견한 무기 ${found}/${WEAPON_ORDER.length}`);
  }

  // ── 강화 탭 (R8/R10 영구 업그레이드 보드 — 10종) ──────────────────────
  // 능력치 탭과 같은 골격: 제목 + 우상단 화폐(SP) + 행별(칩/이름/효과/구매버튼).
  // 다른 점은 화폐가 코인이 아닌 잔해 포인트(meta.salvagePoints)이고, 레벨/플래그를
  // GameState.buyPermanentUpgrade(key)로 사며 'change' 발행 → refreshPermanent로 갱신.
  // R10 — 10종으로 늘어 CONTENT에 안 들어가므로 합성 탭과 같은 공용 스크롤(attachScroll) 사용.
  //        제목+보유 SP 헤더는 고정, 그 아래 10행만 스크롤.
  buildPermanentTab() {
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, '영구 강화', {
        fontFamily: PIXEL_FONT, // 섹션 타이틀 — 픽셀 톤 유지(크기 ↑)
        fontSize: '15px',
        color: C.gold
      })
    );

    // 우상단 보유 SP — "잔해 N" (코인 칩 자리와 동일 라인). 헤더는 고정(스크롤 안 함).
    this.layer(
      this.add
        .text(CONTENT.x + CONTENT.w - 90, CONTENT.y + 13, '잔해', {
          fontFamily: BODY_FONT, // 한글 화폐 라벨 — BODY로
          fontSize: '11px',
          color: C.gray
        })
        .setOrigin(0, 0.5)
    );
    this.spBalTxt = this.add
      .text(CONTENT.x + CONTENT.w - 8, CONTENT.y + 13, '0', {
        fontFamily: PIXEL_FONT,
        fontSize: '12px',
        color: C.toxic
      })
      .setOrigin(1, 0.5);
    this.layer(this.spBalTxt);

    // 헤더 구분선(고정) — 합성 탭과 동일 톤.
    this.layer(
      this.add.rectangle(CONTENT.x + 6, CONTENT.y + 27, CONTENT.w - 12, 1, 0x000000, 0.6).setOrigin(0, 0.5)
    );

    // ── 스크롤 리스트 영역 (공용 attachScroll) ──────────────────────────
    // 무기 행(rowH 48 + 셀배경 + 구분선)과 톤을 맞춰 36→45로 넓힘. 셀배경/구분선은 컨테이너에
    // 담아 함께 스크롤되고 요소 뒤(z 하단)에 오도록 먼저 add.
    const rowH = 48; // 4탭 행 리듬 통일(합성 48). 이름(상단)+효과설명(하단)+구매버튼(26h) 여백 + 셀배경.
    const listTop = CONTENT.y + 29;
    const listBottom = CONTENT.y + CONTENT.h - 1;

    const container = this.add.container(0, 0);
    this.layer(container);

    // 행은 컨테이너에 절대 좌표로 1회 생성 — 스크롤은 컨테이너 y로만 처리.
    this.permRows = PERMANENT_ORDER.map((key, i) => {
      const def = PERMANENT_UPGRADES[key];
      const cy = listTop + i * rowH + rowH / 2;

      // 칸 구분 셀 배경(행 요소보다 먼저 add → 뒤쪽 z). 톤은 refreshPermanent가 상태별 갱신.
      const cellBg = this.add
        .rectangle(CONTENT.x, cy - rowH / 2, CONTENT.w, rowH, 0x1a1008, 0.18)
        .setOrigin(0, 0);
      container.add(cellBg);
      // 행 하단 1px 구분선 — 무기 행과 동일 톤.
      container.add(
        this.add.rectangle(CONTENT.x, cy + rowH / 2, CONTENT.w, 1, 0x000000, 0.4).setOrigin(0, 0.5)
      );

      // 색칩 + 이름(상단)
      container.add(
        this.add.rectangle(CONTENT.x + 12, cy - 9, 10, 10, def.chip).setStrokeStyle(1, 0x000000, 0.5)
      );
      container.add(
        this.add
          .text(CONTENT.x + 24, cy - 9, def.label, {
            fontFamily: BODY_FONT, // 한글 영구강화 항목명 — BODY로
            fontSize: '11px',
            color: C.gold
          })
          .setOrigin(0, 0.5)
      );

      // 효과 설명(하단, 현재 레벨 반영) — 한글 본문은 BODY_FONT로 또렷하게.
      const descTxt = this.add
        .text(CONTENT.x + 24, cy + 8, '', {
          fontFamily: BODY_FONT,
          fontSize: '11px',
          color: C.gray
        })
        .setOrigin(0, 0.5);
      descTxt.setShadow(1, 1, '#000000', 0, false, true);
      container.add(descTxt);

      // 구매 버튼(능력치 탭 makeButton 패턴 재사용) — 컨테이너에 담아 함께 스크롤.
      const btn = this.makeButton(
        CONTENT.x + CONTENT.w - 42,
        cy,
        78,
        26,
        () => {
          if (GameState.buyPermanentUpgrade(key)) SFX.play('enhance'); // 성공 시 'change' 발행 → refreshPermanent
        },
        container
      );

      return { key, def, descTxt, btn, btnBg: btn.bg, cellBg, cy };
    });

    this.attachScroll({
      container,
      listTop,
      listBottom,
      rowH,
      totalH: PERMANENT_ORDER.length * rowH, // 10행
      rows: this.permRows
    });

    this.refreshActive = () => this.refreshPermanent();
    this.refreshPermanent();
  }

  // 보유 SP·각 행의 효과/버튼 상태 갱신(전체 재생성 없이 값만 — 능력치 탭과 동일).
  refreshPermanent() {
    const sp = GameState.meta.salvagePoints;
    this.spBalTxt.setText(String(sp));

    this.permRows.forEach(({ key, def, descTxt, btn, cellBg }) => {
      const cur = GameState.meta.permanentUpgrades[key];
      const level = def.flag ? (cur ? 1 : 0) : cur || 0;
      const atMax = level >= def.maxLevel;

      // 효과 설명: 레벨형은 현재 레벨/최대, 플래그형은 ON/대기.
      const desc = def.desc(def.flag ? !!cur : level);
      descTxt.setText(def.flag ? desc : `${desc}  (${level}/${def.maxLevel})`);

      if (atMax) {
        cellBg.setFillStyle(0xf0c040, 0.17); // 완료/MAX — 골드 강조(합성 장착중과 동일 스케일)
        btn.set(false, def.flag ? '완료' : 'MAX', FILL.disabled, C.gold);
      } else {
        const cost = def.costs[level];
        const afford = sp >= cost;
        cellBg.setFillStyle(0x1a1008, afford ? 0.25 : 0.15); // 구매가능 시 진하게(보유 톤 통일)
        btn.set(afford, `↑ ${cost}`, afford ? FILL.active : FILL.disabled, afford ? C.ink : C.btnDark);
      }
    });
  }

  // ── 스킬 스텁 ────────────────────────────────────────────────────────
  buildStubTab(tab) {
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, tab.label, {
        fontFamily: PIXEL_FONT, // 섹션 타이틀 — 픽셀 톤 유지(크기 ↑)
        fontSize: '15px',
        color: C.gold
      })
    );
    this.layer(
      this.add
        .text(CONTENT.x + CONTENT.w / 2, CONTENT.y + CONTENT.h / 2, '준비 중입니다', {
          fontFamily: BODY_FONT, // 한글 안내문 — BODY로 가독성
          fontSize: '12px',
          color: C.stub
        })
        .setOrigin(0.5)
    );
  }

  tabByKey(key) {
    return TABS.find((t) => t.key === key);
  }
}
