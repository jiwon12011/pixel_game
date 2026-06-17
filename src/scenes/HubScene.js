import Phaser from 'phaser';
import TabBar from '../objects/TabBar.js';
import { TEX, WEAPON_MANIFEST } from '../assets/manifest.js';
import { BORDER_H, HUB_H, HUB_VIEW, LOGICAL } from '../constants/layout.js';
import { PALETTE } from '../constants/palette.js';
import { PIXEL_FONT, BODY_FONT } from '../constants/fonts.js';
import GameState from '../state/GameState.js';
import {
  STAT_UPGRADES,
  STAT_ORDER,
  upgradeCost,
  WEAPON_RECIPES,
  WEAPON_ORDER,
  PART_META
} from '../constants/crafting.js';

// 합성 허브 (하단 42%): 트럭 작업대 톤의 어두운 철판 패널 + 4탭 바.
// 능력치/합성 탭은 실제 동작(GameState 연동), 스킬/인벤은 "준비 중" 스텁.
//
// 렌더 전략: 탭 전환 시 contentLayer를 통째로 재구성하고, 자원/스탯/장비 변경('change')
//           시엔 전체 재생성 대신 refreshActive()로 값/버튼 상태만 갱신(플리커·GC 회피).
const TABS = [
  { key: 'craft', label: '합성', icon: TEX.TAB_CRAFT },
  { key: 'skill', label: '스킬', icon: TEX.TAB_SKILL },
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

    this.showTab(TABS[0]);
  }

  bindGameState() {
    const off = GameState.on('change', () => this.refreshActive?.());
    this.events.once('shutdown', off);
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
    this.contentLayer.removeAll(true); // 이전 탭 GameObject 파기
    this.refreshActive = null;

    if (tab.key === 'stats') this.buildStatsTab();
    else if (tab.key === 'craft') this.buildCraftTab();
    else this.buildStubTab(tab);
  }

  // 작은 헬퍼: 만든 객체를 contentLayer에 등록(탭 전환 시 자동 정리).
  layer(...objs) {
    this.contentLayer.add(objs);
    return objs.length === 1 ? objs[0] : objs;
  }

  // 상태 가변 버튼 — set(enabled, text, fill, textColor)로 갱신.
  makeButton(x, y, w, h, onClick) {
    const bg = this.add.rectangle(x, y, w, h, FILL.active).setStrokeStyle(1, 0x000000, 0.45);
    const label = this.add
      .text(x, y, '', { fontFamily: PIXEL_FONT, fontSize: '10px', color: C.ink })
      .setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (bg.getData('enabled')) onClick();
    });
    this.layer(bg, label);
    return {
      set(enabled, text, fill, textColor) {
        bg.setData('enabled', enabled);
        bg.setFillStyle(fill);
        label.setText(text).setColor(textColor);
      }
    };
  }

  // ── 능력치 탭 ────────────────────────────────────────────────────────
  buildStatsTab() {
    // 제목 + 우상단 보유 코인
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, '능력치', {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
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

    const rowH = 40;
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
      this.layer(
        this.add
          .text(CONTENT.x + 24, cy, def.label, {
            fontFamily: PIXEL_FONT,
            fontSize: '11px',
            color: C.gold
          })
          .setOrigin(0, 0.5)
      );

      // 현재값(주황) + 증가량(청록)
      const valueTxt = this.add
        .text(CONTENT.x + 96, cy, '', { fontFamily: PIXEL_FONT, fontSize: '11px', color: C.orange })
        .setOrigin(0, 0.5);
      const incrTxt = this.add
        .text(CONTENT.x + 152, cy, '', { fontFamily: PIXEL_FONT, fontSize: '10px', color: C.toxic })
        .setOrigin(0, 0.5);
      this.layer(valueTxt, incrTxt);

      // 업그레이드 버튼(비용 표시)
      const btn = this.makeButton(CONTENT.x + CONTENT.w - 42, cy, 78, 26, () => {
        const lvl = GameState.statLevels[stat];
        if (def.maxLevel != null && lvl >= def.maxLevel) return;
        const cost = upgradeCost(stat, lvl + 1);
        GameState.buyStatUpgrade(stat, cost, def.increment, def.maxLevel);
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
    // 무기 도면(텍스처)은 합성 탭 첫 진입에 1회 지연 로드 후 캐시.
    if (!this.weaponsLoaded) {
      this.layer(
        this.add
          .text(CONTENT.x + CONTENT.w / 2, CONTENT.y + CONTENT.h / 2, '무기 도면 불러오는 중…', {
            fontFamily: PIXEL_FONT,
            fontSize: '11px',
            color: C.gray
          })
          .setOrigin(0.5)
      );
      this.loadWeapons(() => {
        this.weaponsLoaded = true;
        if (this.activeTab === 'craft') this.showTab(this.tabByKey('craft'));
      });
      return;
    }

    // 헤더(축소 26px): 현재 장착 무기 — 5칸을 backdrop 안에 넣기 위해 헤더를 압축.
    this.equipIcon = this.add.image(CONTENT.x + 20, CONTENT.y + 14, 'pipe_wrench').setScale(0.16);
    this.equipName = this.add
      .text(CONTENT.x + 38, CONTENT.y + 8, '', { fontFamily: PIXEL_FONT, fontSize: '11px', color: C.gold })
      .setOrigin(0, 0.5);
    this.equipAbility = this.add
      .text(CONTENT.x + 38, CONTENT.y + 20, '', { fontFamily: BODY_FONT, fontSize: '9px', color: C.gray })
      .setOrigin(0, 0.5);
    this.equipAbility.setShadow(1, 1, '#000000', 0, false, true);
    this.layer(this.equipIcon, this.equipName, this.equipAbility);

    // 헤더 구분선
    this.layer(
      this.add.rectangle(CONTENT.x + 6, CONTENT.y + 29, CONTENT.w - 12, 1, 0x000000, 0.6).setOrigin(0, 0.5)
    );

    // 무기 슬롯 5칸(근접 3 + 투척 2) — rowH 30·gap0으로 203px 안에 스크롤 없이 fit.
    const startY = CONTENT.y + 31;
    const rowH = 30;
    const gap = 0;
    this.weaponRows = WEAPON_ORDER.map((id, i) => this.buildWeaponRow(id, startY + i * (rowH + gap), rowH));

    this.refreshActive = () => this.refreshCraft();
    this.refreshCraft();
  }

  buildWeaponRow(id, top, rowH) {
    const recipe = WEAPON_RECIPES[id];
    const cy = top + rowH / 2;

    // 아이콘(30px 목표) — 원본 정사각 128 기준 스케일
    const icon = this.add.image(CONTENT.x + 20, cy, id);
    if (this.textures.exists(id)) {
      const src = this.textures.get(id).getSourceImage();
      icon.setScale(30 / src.height);
    }
    this.layer(icon);

    // 이름(cy-8) + 능력(cy+2) — 능력은 속성색으로 FIRE 주황·TOXIC 청록 표식.
    this.layer(
      this.add
        .text(CONTENT.x + 40, cy - 8, recipe.name, {
          fontFamily: PIXEL_FONT,
          fontSize: '10px',
          color: C.gold
        })
        .setOrigin(0, 0.5)
    );
    const ability = this.add
      .text(CONTENT.x + 40, cy + 2, recipe.ability, {
        fontFamily: BODY_FONT,
        fontSize: '9px',
        color: ATTR_COLOR[recipe.attrTag] || C.gray
      })
      .setOrigin(0, 0.5);
    ability.setShadow(1, 1, '#000000', 0, false, true);
    this.layer(ability);

    // 재료 칩(색칩 + 보유/필요). 보유 무기는 숨김. 간격 k*50, 능력 아래 줄(cy+11).
    const chips = [];
    const costEntries = Object.entries(recipe.cost || {});
    costEntries.forEach(([part, need], k) => {
      const px = CONTENT.x + 40 + k * 50;
      const py = cy + 11;
      const chip = this.add
        .rectangle(px, py, 7, 7, PART_META[part].color)
        .setOrigin(0, 0.5)
        .setStrokeStyle(1, 0x000000, 0.5);
      const txt = this.add
        .text(px + 10, py, `${PART_META[part].label} 0/${need}`, {
          fontFamily: PIXEL_FONT,
          fontSize: '7px',
          color: C.gray
        })
        .setOrigin(0, 0.5);
      this.layer(chip, txt);
      chips.push({ part, need, chip, txt });
    });

    // 액션 버튼(제작/장착/상태) — 68×24.
    const btn = this.makeButton(CONTENT.x + CONTENT.w - 38, cy, 68, 24, () => {
      if (GameState.ownedWeapons.has(id)) {
        GameState.equipWeapon(id);
        return;
      }
      if (recipe.requires && !GameState.ownedWeapons.has(recipe.requires)) return;
      if (GameState.craftWeapon(id, recipe.cost)) GameState.equipWeapon(id); // 제작 후 자동 장착
    });

    return { id, recipe, chips, btn };
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

    // 슬롯들
    this.weaponRows.forEach(({ id, recipe, chips, btn }) => {
      const owned = GameState.ownedWeapons.has(id);
      const equipped = GameState.equippedWeapon === id;
      const prereqOk = !recipe.requires || GameState.ownedWeapons.has(recipe.requires);

      // 재료 칩 — 보유 무기는 숨기고, 미보유는 보유/필요 + 부족 시 주황 경고
      chips.forEach(({ part, need, chip, txt }) => {
        if (owned) {
          chip.setVisible(false);
          txt.setVisible(false);
          return;
        }
        chip.setVisible(true);
        txt.setVisible(true);
        const have = GameState.parts[part];
        txt.setText(`${PART_META[part].label} ${have}/${need}`);
        txt.setColor(have >= need ? C.toxic : C.orange);
      });

      if (equipped) btn.set(false, '장착 중', FILL.disabled, C.gold);
      else if (owned) btn.set(true, '장착', FILL.active, C.ink);
      else if (!prereqOk) btn.set(false, '선행 필요', FILL.disabled, C.btnDark);
      else if (!GameState.canAfford(recipe.cost)) btn.set(false, '재료 부족', FILL.disabled, C.btnDark);
      else btn.set(true, '제작', FILL.active, C.ink);
    });
  }

  loadWeapons(cb) {
    const ids = Object.keys(WEAPON_MANIFEST).filter((id) => !this.textures.exists(id));
    if (ids.length === 0) {
      cb();
      return;
    }
    ids.forEach((id) => this.load.image(id, WEAPON_MANIFEST[id]));
    this.load.once('complete', cb);
    this.load.start();
  }

  // ── 스킬/인벤 스텁 ───────────────────────────────────────────────────
  buildStubTab(tab) {
    this.layer(
      this.add.text(CONTENT.x + 4, CONTENT.y + 6, tab.label, {
        fontFamily: PIXEL_FONT,
        fontSize: '13px',
        color: C.gold
      })
    );
    this.layer(
      this.add
        .text(CONTENT.x + CONTENT.w / 2, CONTENT.y + CONTENT.h / 2, '준비 중입니다', {
          fontFamily: PIXEL_FONT,
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
