// 폰트 — 제목/영문 라벨/순수 숫자는 픽셀 폰트(Galmuri11), 한글 본문/이름/버튼 라벨은
// 시스템 산세리프(BODY_FONT)로 가독성 확보. pixelArt:true가 작은 한글 자소를 뭉개므로
// 한글은 BODY_FONT + 아래 installCrispText(2배 해상도)로 선명하게 그린다.
export const PIXEL_FONT = '"Galmuri11", monospace';
export const BODY_FONT =
  'system-ui, -apple-system, "Apple SD Gothic Neo", "Segoe UI", sans-serif';

// PreloadScene에서 텍스트 생성 전에 폰트 로드를 기다릴 대상
export const PRELOAD_FONTS = ['16px "Galmuri11"', 'bold 16px "Galmuri11"'];

// designer 폰트 표 (R10 가독성 상향). 픽셀폰트=타이틀/영문/숫자, BODY_FONT=한글 본문/이름/라벨.
//  · title  15px — 섹션 타이틀(금)
//  · label  11px — 라벨/주요 수치
//  · value  12px — 보조 수치/버튼(재료 수량 등)
//  · body   11px — 설명 문장(BODY_FONT) — 9~10px는 모바일 dpr2~3에서 한글 뭉개져 폐기
export const FONT_SIZE = {
  title: '15px',
  label: '11px',
  value: '12px',
  body: '11px'
};

// 자주 쓰는 텍스트 색 — 설명 본문 톤 + 충분/부족 신호색(designer).
export const FONT_COLOR = {
  body: '#cbb89a', // 설명 본문(어두운 배경 위 가독)
  enough: '#20ff9a', // 보유 충분 — 청록
  short: '#ff6020', // 보유 부족 — 주황
  gold: '#f0c040' // 타이틀/수치 강조
};

// 어두운 배경 텍스트 가독용 1px 검정 그림자 — t.setShadow(...TEXT_SHADOW) 로 적용.
export const TEXT_SHADOW = [1, 1, '#000000', 0, false, true];

// 텍스트 선명화 배율 — pixelArt:true 게임은 벡터 텍스트도 NEAREST로 뭉개므로 2배 해상도로 렌더.
export const TEXT_RESOLUTION = 2;

// 씬의 텍스트 팩토리(this.add.text)를 1회 감싸 모든 텍스트에
//  ① setResolution(2)  — pixelArt NEAREST 블러 해소(특히 작은 한글)
//  ② 정수 좌표 스냅     — 서브픽셀 흐림 방지
// 를 일괄 적용한다. 씬 create()/preload() 첫머리에서 호출 — 개별 호출마다 .setResolution을
// 붙이는 누락 위험을 없애는 단일 관문. (재호출/씬 재시작 시 중복 래핑은 플래그로 차단.)
export function installCrispText(scene) {
  const factory = scene.add;
  if (factory._crispWrapped) return;
  factory._crispWrapped = true;
  const orig = factory.text.bind(factory);
  factory.text = (x, y, text, style) =>
    orig(Math.round(x), Math.round(y), text, style).setResolution(TEXT_RESOLUTION);
}
