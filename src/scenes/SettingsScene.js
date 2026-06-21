import Phaser from 'phaser';
import { LOGICAL, RENDER_SCALE } from '../constants/layout.js';
import { PIXEL_FONT, BODY_FONT, installCrispText } from '../constants/fonts.js';
import SFX from '../audio/sfx.js';
import GameState from '../state/GameState.js';
import { setReduceMotion, getReduceMotion, prefersReducedMotion } from '../utils/motion.js';

// 전체 화면 환경설정 모달 — CombatScene 톱니 버튼이 launch한다.
// 카메라 뷰포트를 설정하지 않아 기본 360×640 전체를 덮는다(전투/허브 두 씬 위에 얹힘).
// 입력 격리: 열릴 때 CombatScene·HubScene input을 끄고, 닫을 때 복구한다.
// 좌표 전략: 패널은 center 컨테이너(outer, 팝 연출의 회전축)에 inner(top-left 0..PW/0..PH) 한 겹.
//   → outer scale 팝이 패널 중심에서 자라고, 자식 레이아웃은 친숙한 0..PW/0..PH 좌표로 짠다.

// 색 토큰(씬 독립)
const C = {
  gold: '#f0c040',
  orange: '#ff6020',
  toxic: '#20ff9a',
  gray: '#9a8b78',
  body: '#cbb89a',
  stub: '#7a6a50',
  ink: '#1a1008'
};

const PW = 300; // 패널 폭
const PH = 404; // 패널 높이
const PX = 30; // 패널 좌상단 x (가로 중앙: 30..330)
const PY = 118; // 패널 좌상단 y (세로 중앙 근처)
const HALF_W = PW / 2;
const HALF_H = PH / 2;

export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super('SettingsScene');
  }

  create() {
    installCrispText(this); // 한글 선명화(2배 해상도 + 정수좌표)

    // 풀스크린 모달 — 뷰포트는 백버퍼 전체(720×1280). 콘텐츠는 360×640 좌표라
    // setZoom(RENDER_SCALE)+origin(0,0)으로 그 월드를 버퍼 전체에 채운다(전투/허브 카메라와 동일 규약).
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);

    // 입력 격리 — 뒤 두 씬의 탭/공격/허브 조작을 모달 동안 차단.
    this._combat = this.scene.get('CombatScene');
    this._hub = this.scene.get('HubScene');
    if (this._combat) this._combat.input.enabled = false;
    if (this._hub) this._hub.input.enabled = false;

    this.motionOk = !prefersReducedMotion();
    this._confirmRun = false; // 런/전체 초기화 2차 확인 상태
    this._confirmWipe = false;
    this._closing = false;

    // ── 스크림 — 전체 화면 덮음. 탭하면 닫기.
    // launch가 CombatScene의 pointerdown에서 일어나므로, 그 제스처의 트레일링 pointerup이
    // 갓 생긴 스크림을 즉시 닫는 버그가 있다. 스크림 위에서 down을 본 적이 있을 때만 닫아 차단.
    const scrim = this.add
      .rectangle(0, 0, LOGICAL.width, LOGICAL.height, 0x000000, 0.78)
      .setOrigin(0, 0)
      .setInteractive();
    let scrimArmed = false;
    scrim.on('pointerdown', () => {
      scrimArmed = true;
    });
    scrim.on('pointerup', () => {
      if (scrimArmed) this.close();
    });
    this._scrim = scrim;

    // ── 패널 컨테이너(center pivot) + inner(top-left) ──────────────────────
    const outer = this.add.container(PX + HALF_W, PY + HALF_H);
    const inner = this.add.container(-HALF_W, -HALF_H);
    outer.add(inner);
    this._panel = outer;
    this._inner = inner;

    // 패널 배경 — 클릭 흡수(스크림으로 새지 않게).
    inner.add(
      this.add
        .rectangle(0, 0, PW, PH, 0x1a1008, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0x3d2b1a, 1)
        .setInteractive()
    );

    const mw = {};
    this._w = mw;

    // 타이틀(한글이라 BODY_FONT — PIXEL_FONT는 작은 한글 자소 뭉갬)
    const title = this.add
      .text(HALF_W, 30, '환경설정', { fontFamily: BODY_FONT, fontSize: '17px', color: C.gold })
      .setOrigin(0.5);
    title.setShadow(1, 1, '#000000', 0, false, true);
    inner.add(title);
    inner.add(this.add.rectangle(20, 52, PW - 40, 1, 0x3d2b1a, 1).setOrigin(0, 0.5));

    // 음소거 토글
    this.label(inner, 20, 84, '음소거', C.body);
    mw.muteBtn = this.makeButton(252, 84, 56, 30, () => {
      SFX.toggleMute();
      this.renderToggles();
    }, inner);

    // BGM 볼륨 — 라벨 + −/+ + 5칸 채움바
    this.label(inner, 20, 126, 'BGM 볼륨', C.gray, '13px');
    mw.bgmBar = this.add.graphics();
    inner.add(mw.bgmBar);
    mw.bgmMinus = this.makeButton(35, 150, 32, 30, () => this.stepVolume('bgm', -1), inner);
    mw.bgmPlus = this.makeButton(265, 150, 32, 30, () => this.stepVolume('bgm', +1), inner);

    // SFX 볼륨
    this.label(inner, 20, 192, 'SFX 볼륨', C.gray, '13px');
    mw.sfxBar = this.add.graphics();
    inner.add(mw.sfxBar);
    mw.sfxMinus = this.makeButton(35, 216, 32, 30, () => this.stepVolume('sfx', -1), inner);
    mw.sfxPlus = this.makeButton(265, 216, 32, 30, () => this.stepVolume('sfx', +1), inner);

    // 모션 줄이기 토글
    this.label(inner, 20, 258, '모션 줄이기', C.body);
    mw.motionBtn = this.makeButton(252, 258, 56, 30, () => {
      setReduceMotion(!getReduceMotion());
      this.motionOk = !prefersReducedMotion();
      this.renderToggles();
      SFX.play('tab');
    }, inner);

    // 구분선
    inner.add(this.add.rectangle(20, 290, PW - 40, 1, 0x000000, 0.5).setOrigin(0, 0.5));

    // 런 초기화 / 전체 초기화 — 둘 다 2차 확인.
    mw.runBtn = this.makeButton(HALF_W, 318, 260, 28, () => this.onRunReset(), inner);
    mw.wipeBtn = this.makeButton(HALF_W, 354, 260, 28, () => this.onWipeAll(), inner);

    // 닫기 — 터치타겟 일관성(22→30px). 패널 하단(PH 404) 안에서 wipe 버튼과 3px 간격 유지.
    const closeBtn = this.makeButton(HALF_W, 384, 260, 30, () => this.close(), inner);
    closeBtn.set(true, '닫기', 0x3d2b1a, C.gold);

    this.refresh();

    // 음소거 외부 변경 동기화 — shutdown에서 구독 해제.
    this._offMute = SFX.onMuteChange(() => this.renderToggles());
    this.events.once('shutdown', () => {
      this._offMute?.();
      // 안전망 — 어떤 경로로 닫혀도 두 씬 입력 복구.
      if (this._combat) this._combat.input.enabled = true;
      if (this._hub) this._hub.input.enabled = true;
    });

    // 등장 모션 — reduced면 즉시.
    if (this.motionOk) {
      scrim.alpha = 0;
      outer.setScale(0.9).setAlpha(0);
      this.tweens.add({ targets: scrim, alpha: 1, duration: 120 });
      this.tweens.add({ targets: outer, scale: 1, alpha: 1, duration: 200, ease: 'Back.easeOut' });
    }

    SFX.play('tab');
  }

  // ── 헬퍼 ───────────────────────────────────────────────────────────────
  // 어두운 패널 위 한글 가독용 라벨(그림자).
  label(target, x, y, text, color, size = '13px') {
    const t = this.add
      .text(x, y, text, { fontFamily: BODY_FONT, fontSize: size, color })
      .setOrigin(0, 0.5);
    t.setShadow(1, 1, '#000000', 0, false, true);
    target.add(t);
    return t;
  }

  // 상태 가변 버튼 — set(enabled, text, fill, textColor)로 갱신. (HubScene makeButton 축약판)
  makeButton(x, y, w, h, onClick, target) {
    const bg = this.add.rectangle(x, y, w, h, 0xff6020).setStrokeStyle(1, 0x000000, 0.45);
    const label = this.add
      .text(x, y, '', { fontFamily: BODY_FONT, fontSize: '13px', color: C.ink })
      .setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (!bg.visible) return;
      if (bg.getData('enabled')) onClick();
    });
    target.add([bg, label]);
    return {
      bg,
      label,
      set(enabled, text, fill, textColor) {
        bg.setData('enabled', enabled);
        bg.setFillStyle(fill);
        label.setText(text).setColor(textColor);
      }
    };
  }

  // ── 상태 렌더 ───────────────────────────────────────────────────────────
  refresh() {
    this.renderToggles();
    this.renderVolBar('bgm');
    this.renderVolBar('sfx');
    this.renderResetBtns();
  }

  renderToggles() {
    const mw = this._w;
    if (!mw) return;
    // on(toxic)/off(dark). 음소거 on=소리 꺼짐, 모션 on=모션 감소.
    const onStyle = (btn, on) =>
      btn.set(true, on ? 'ON' : 'OFF', on ? 0x20ff9a : 0x2a2a2a, on ? C.ink : C.gray);
    onStyle(mw.muteBtn, SFX.isMuted());
    onStyle(mw.motionBtn, getReduceMotion());
  }

  // 0~5단계(0,0.2,…,1.0) 그래픽 바 — 채움 toxic, 빈칸 dark.
  renderVolBar(bus) {
    const mw = this._w;
    if (!mw) return;
    const get = bus === 'bgm' ? SFX.getBgmVolume : SFX.getSfxVolume;
    const step = Math.round(get() * 5); // 0~5
    const g = bus === 'bgm' ? mw.bgmBar : mw.sfxBar;
    const ctrlY = bus === 'bgm' ? 150 : 216;
    const barTop = ctrlY - 11;
    const barH = 22;
    const left = 58;
    const segW = 33;
    const segGap = 4;
    g.clear();
    for (let i = 0; i < 5; i++) {
      const x = left + i * (segW + segGap);
      g.fillStyle(i < step ? 0x20ff9a : 0x2a2a2a, 1);
      g.fillRect(x, barTop, segW, barH);
      g.lineStyle(1, 0x000000, 0.4);
      g.strokeRect(x + 0.5, barTop + 0.5, segW - 1, barH - 1);
    }
    // 경계 스텝 버튼 시각 피드백 — 0이면 −, 5면 + 흐리게(클릭은 클램프로 무해).
    const minus = bus === 'bgm' ? mw.bgmMinus : mw.sfxMinus;
    const plus = bus === 'bgm' ? mw.bgmPlus : mw.sfxPlus;
    minus.set(step > 0, '−', step > 0 ? 0x3d2b1a : 0x241a10, step > 0 ? C.gold : C.stub);
    plus.set(step < 5, '+', step < 5 ? 0x3d2b1a : 0x241a10, step < 5 ? C.gold : C.stub);
  }

  stepVolume(bus, dir) {
    const get = bus === 'bgm' ? SFX.getBgmVolume : SFX.getSfxVolume;
    const set = bus === 'bgm' ? SFX.setBgmVolume : SFX.setSfxVolume;
    const step = Phaser.Math.Clamp(Math.round(get() * 5) + dir, 0, 5);
    set(step / 5);
    this.renderVolBar(bus);
    SFX.play('tab'); // 변경 체감용 짧은 blip(SFX 0이면 자동 무음)
  }

  renderResetBtns() {
    const mw = this._w;
    if (!mw) return;
    if (this._confirmRun) mw.runBtn.set(true, '한 번 더 누르면 초기화', 0xffa020, C.ink);
    else mw.runBtn.set(true, '런 초기화', 0xff6020, C.ink);
    if (this._confirmWipe) mw.wipeBtn.set(true, '한 번 더 누르면 전체삭제', 0xff4040, '#ffffff');
    else mw.wipeBtn.set(true, '전체 초기화', 0xff2020, '#ffffff');
  }

  // 런 초기화 — 1탭: 확인 대기 / 2탭: 실행 후 닫고 토스트.
  onRunReset() {
    if (this._confirmRun) {
      this._confirmRun = false;
      GameState.resetRunPublic();
      const combat = this._combat;
      this.close();
      combat?.showToast?.('런을 초기화했어', null, true);
      return;
    }
    this._confirmRun = true;
    this._confirmWipe = false; // 동시 대기 방지
    this.renderResetBtns();
    // 무반응 2.6s면 확인 자동 해제(오발 보호).
    this.time.delayedCall(2600, () => {
      if (this._confirmRun) {
        this._confirmRun = false;
        this.renderResetBtns();
      }
    });
  }

  // 전체 초기화 — 2차 확인 후 wipe + reload(돌이킬 수 없음).
  onWipeAll() {
    if (this._confirmWipe) {
      GameState.wipeAllSaves();
      if (typeof window !== 'undefined') window.location.reload();
      return;
    }
    this._confirmWipe = true;
    this._confirmRun = false;
    this.renderResetBtns();
    this.time.delayedCall(2600, () => {
      if (this._confirmWipe) {
        this._confirmWipe = false;
        this.renderResetBtns();
      }
    });
  }

  // 닫기 — 두 씬 입력 복구 후 씬 정지(shutdown이 구독 해제·안전망 복구).
  close() {
    if (this._closing) return;
    this._closing = true;
    if (this._combat) this._combat.input.enabled = true;
    if (this._hub) this._hub.input.enabled = true;
    this.scene.stop();
  }
}
