import Phaser from 'phaser';
import { COMBAT_H, LOGICAL, PARALLAX } from '../constants/layout.js';
import { TEX, REGION_BG_MANIFEST } from '../assets/manifest.js';

// 지역 변형 텍스처 키 집합 — VRAM 회수 대상 화이트리스트. 패럴랙스 L1~L4(sky/factory/
// wreckage/ground)는 여기 없으므로 절대 제거되지 않는다(보호).
const REGION_TEX_KEYS = new Set(Object.values(REGION_BG_MANIFEST).map((e) => e.key));

// 4레이어 패럴랙스 무한 가로 스크롤.
// 레이어들은 동일 캔버스(web 사본 720x371)의 오버레이라, 같은 사각형에 겹쳐 깔고
// tilePositionX만 레이어별 속도로 흘려보내면 정확히 정렬된 패럴랙스가 된다.
export default class ParallaxBackground {
  /**
   * @param {Phaser.Scene} scene
   * @param {boolean} animate  reduced-motion이면 false → 정적
   */
  constructor(scene, animate = true) {
    this.scene = scene;
    this.animate = animate;
    this.layers = [];

    // 높이를 전투 뷰에 맞추는 균일 스케일 (가로는 자동 타일링)
    const tileScale = COMBAT_H / PARALLAX.sourceHeight;

    // 레이어별 수직 오프셋(px). L1 하늘은 0(전체 커버 고정).
    // 가까운 레이어일수록 더 많이 내려 패럴랙스 깊이감 유지.
    // groundDropY만큼 내리면 레이어 하단이 COMBAT_H 밖으로 크롭되고,
    // 상단 빈 영역은 뒤쪽 L1 하늘이 드러나 채운다.
    const d = PARALLAX.groundDropY;
    const defs = [
      { key: TEX.BG_L1, factor: PARALLAX.factors.l1, dropY: 0         }, // 하늘 — 고정(전체 배경)
      { key: TEX.BG_L2, factor: PARALLAX.factors.l2, dropY: d * 0.5   }, // 공장 스카이라인 — 절반 오프셋
      { key: TEX.BG_L3, factor: PARALLAX.factors.l3, dropY: d * 0.75  }, // 잔해/가로등 — 3/4 오프셋
      { key: TEX.BG_L4, factor: PARALLAX.factors.l4, dropY: d * 1.0   }  // 노면 — 풀 오프셋
    ];

    // 먼 레이어(하늘/공장)는 LINEAR로 부드럽게 — 천천히 흘러 픽셀 또렷함보다 시머 완화가 이득.
    // 가까운 L3/L4는 NEAREST 유지(지면/잔해 픽셀 디테일 보존). tileScale=1.0이라 NEAREST도 시머 없음.
    const linearKeys = [TEX.BG_L1, TEX.BG_L2];
    linearKeys.forEach((key) => {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    });

    defs.forEach(({ key, factor, dropY }, i) => {
      const ts = scene.add
        // y에 dropY를 더해 레이어를 아래로 내림 — tilePositionX 가로 스크롤은 그대로 동작.
        .tileSprite(0, dropY, LOGICAL.width, COMBAT_H, key)
        .setOrigin(0, 0)
        .setDepth(i); // L1 뒤 → L4 앞
      ts.tileScaleX = tileScale;
      ts.tileScaleY = tileScale;
      this.layers.push({ ts, factor });
    });

    // ── 지역 변형 오버레이 ───────────────────────────────────────────────
    // downtown은 위 4레이어 패럴랙스(시그니처 룩). highway/factory/sewer는 풀커버 단일
    // 변형 이미지를 패럴랙스(depth 0~3) 위·캐릭터/그림자(topDepth+0.5~+1) 아래에 깐다.
    // 변형 간 깔끔한 크로스페이드를 위해 더블버퍼(2장)로 두고 들어오는 쪽을 위로 페이드인한다.
    // 초기엔 로드 보장된 L1(하늘) 텍스처로 띄우되 alpha 0(=downtown, 패럴랙스 노출).
    //
    // [Image → tileSprite 전환] 지역 변형 배경도 패럴랙스 L4와 동일 속도로 가로 스크롤해
    // 모든 맵에서 "걷는 착시"가 유지된다. 변형 텍스처 3종 모두 659×371 → texHeight=COMBAT_H
    // 이므로 tileScaleY=1.0, 가로도 동일 비율(tileScaleX=1.0)로 무한 타일링.
    // 두 버퍼 모두 매 프레임 동기 스크롤해 크로스페이드 중 위치 차이 없음.
    const overlayDepth = this.topDepth + 0.25;
    this.regionImgs = [0, 1].map(() => {
      const ts = scene.add
        .tileSprite(0, 0, LOGICAL.width, COMBAT_H, TEX.BG_L1)
        .setOrigin(0, 0)
        .setDepth(overlayDepth)
        .setAlpha(0);
      // 변형 텍스처 659×371 → tileScale=1.0(1:1 타일링). 이후 _fitOverlay로 텍스처 교체마다 재계산.
      ts.tileScaleX = 1;
      ts.tileScaleY = 1;
      return ts;
    });
    this.regionIdx = 0;          // 현재 보이는 오버레이 인덱스
    this.regionTween = null;
    this.currentRegionTex = null; // 현재 표시 중인 변형 텍스처 키(없으면 downtown)
  }

  // tileSprite 변형 오버레이 스케일 재계산 — setTexture 후 호출.
  // 텍스처 height를 COMBAT_H에 맞추는 균일 스케일(가로도 동일 비율로 타일링).
  // 현재 변형 3종 모두 659×371(texHeight=COMBAT_H=371) → tileScale=1.0 고정이지만
  // 텍스처 해상도가 달라져도 안전하게 재계산한다.
  _fitOverlay(ts) {
    const tex = this.scene.textures.get(ts.texture.key).getSourceImage();
    const scale = COMBAT_H / tex.height;
    ts.tileScaleX = scale;
    ts.tileScaleY = scale;
  }

  // 지역 변형으로 즉시 전환(부팅/이어하기 — 페이드 없이 alpha 1).
  showRegionImmediate(texKey) {
    this.regionTween?.stop();
    this.regionTween = null;
    const img = this.regionImgs[this.regionIdx];
    img.setTexture(texKey);
    this._fitOverlay(img);
    img.setAlpha(1);
    this.regionImgs[this.regionIdx ^ 1].setAlpha(0);
    this.currentRegionTex = texKey;
  }

  // 패럴랙스(downtown)로 즉시 복귀 — 오버레이 숨김(새 런 리셋).
  hideRegion() {
    this.regionTween?.stop();
    this.regionTween = null;
    this.regionImgs.forEach((img) => img.setAlpha(0));
    this.currentRegionTex = null;
  }

  // 지역 변형으로 크로스페이드. 들어오는 버퍼를 위 depth에 깔고 alpha 0→1로 올리면
  // downtown→변형(패럴랙스 노출 위로 페이드인)·변형→변형(이전 위로 크로스페이드) 둘 다 자연스럽다.
  // reduced-motion(animate=false)이면 즉시 스왑.
  crossfadeToRegion(texKey, durationMs = 500) {
    if (this.currentRegionTex === texKey) return; // 같은 지역 재진입 무시
    const incoming = this.regionImgs[this.regionIdx ^ 1];
    const outgoing = this.regionImgs[this.regionIdx];
    // 직전 지역 텍스처 — 크로스페이드 완료 후 VRAM에서 회수할 후보(REGION 키 한정).
    const prevTexKey = outgoing.texture.key;
    incoming.setTexture(texKey);
    this._fitOverlay(incoming);
    incoming.setAlpha(0).setDepth(this.topDepth + 0.3); // 들어오는 쪽을 확실히 위로
    outgoing.setDepth(this.topDepth + 0.25);
    this.currentRegionTex = texKey;

    const finish = () => {
      outgoing.setAlpha(0);
      this.regionIdx ^= 1;
      this.regionTween = null;
      // outgoing이 완전히 alpha0(비표시)이 된 뒤에만 직전 텍스처를 회수한다(현재/다음 사용 보호).
      this._releaseRegionTexture(prevTexKey, texKey, outgoing);
    };

    this.regionTween?.stop();
    if (!this.animate) {
      incoming.setAlpha(1);
      finish();
      return;
    }
    this.regionTween = this.scene.tweens.add({
      targets: incoming,
      alpha: 1,
      duration: durationMs,
      ease: 'Sine.inOut',
      onComplete: finish
    });
  }

  // 크로스페이드 완료 후 직전 지역 텍스처를 GPU에서 회수(보수적). 잘못 지우면 즉시 깨지므로
  // ① REGION 화이트리스트 ② 현재(keepKey)와 다름 ③ 두 버퍼 모두 더는 참조 안 함 ④ exists 를 모두 통과할 때만.
  // outgoing은 직전 텍스처를 계속 들고 있으므로, 보호 텍스처(sky)로 되돌려 참조를 끊은 뒤 제거한다.
  _releaseRegionTexture(prevKey, keepKey, outgoing) {
    // [되돌림] 게임 진행 중 textures.remove()는 WebGL 텍스처 배치/유닛을 손상시켜
    // 화면 전체가 미싱 텍스처(초록)로 깨지는 사례 확인 → VRAM 회수 비활성(이전 정상 동작).
    // outgoing 버퍼는 직전 텍스처를 alpha0으로 그대로 들고 있어도 무해(다음 전환이 setTexture).
    void prevKey;
    void keepKey;
    void outgoing;
  }

  /** @param {number} dtMs 프레임 델타(ms) */
  update(dtMs) {
    if (!this.animate) return;
    const dt = dtMs / 1000;
    for (const { ts, factor } of this.layers) {
      // 텍스처 좌표 이동 → 화면 이동량은 tileScale이 곱해짐. 배경이 좌로 흐른다.
      ts.tilePositionX += PARALLAX.baseSpeed * factor * dt;
    }
    // 지역 변형 오버레이를 L4(노면)와 동일 속도로 스크롤 — 변형 맵에서도 걷는 착시 유지.
    // 두 버퍼 모두 동기 이동: 크로스페이드 중 두 텍스처 위치 차이 없이 자연스럽게 전환됨.
    // reduced-motion(animate=false)이면 이 블록 자체에 진입 안 함 — 정적 일관성 유지.
    const regionDx = PARALLAX.baseSpeed * PARALLAX.factors.l4 * dt;
    for (const ts of this.regionImgs) {
      ts.tilePositionX += regionDx;
    }
  }

  /** 깊이 정렬 기준 — 캐릭터/적은 이 값보다 위에 둔다 (L4 = 3) */
  get topDepth() {
    return this.layers.length - 1;
  }
}
