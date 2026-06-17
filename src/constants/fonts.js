// 폰트 — 제목/수치/라벨은 한글 픽셀 폰트(Galmuri11), 설명/긴 문장은 시스템 산세리프(가독성).
export const PIXEL_FONT = '"Galmuri11", "Apple SD Gothic Neo", monospace';
export const BODY_FONT =
  'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

// PreloadScene에서 텍스트 생성 전에 폰트 로드를 기다릴 대상
export const PRELOAD_FONTS = ['16px "Galmuri11"', 'bold 16px "Galmuri11"'];

// designer 폰트 표 (R7 가독성). 픽셀폰트=타이틀/수치/라벨, BODY_FONT=설명/긴 문장.
//  · title  13px — 섹션 타이틀(금)
//  · label  11px — 라벨/주요 수치
//  · value  10px — 보조 수치/버튼
//  · body    9px — 설명 문장(BODY_FONT)
//  · mini    8px — 미니 라벨(보유/필요 수량 등)
export const FONT_SIZE = {
  title: '13px',
  label: '11px',
  value: '10px',
  body: '9px',
  mini: '8px'
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
