// LAST SALVAGE 컬러 팔레트 — 기획서 "비주얼 > 컬러 팔레트" Hex 그대로.
// Phaser Graphics는 0x 숫자를 쓰고, CSS/텍스트는 '#' 문자열을 쓰므로 둘 다 제공.

export const PALETTE = {
  bgBase: 0x2d1f0e, // 폐허 갈색 (배경 기본)
  bgSecondary: 0x4a4040, // 녹슨 회색 (배경 보조)
  bgSky: 0x7a4520, // 황혼 주황 (배경 하늘)
  hubBase: 0x1a1a1a, // 어두운 철판 (UI 허브 바탕)
  hubSecondary: 0x3d2b1a, // 녹슨 철 (UI 보조)
  accentGold: 0xf0c040, // 코인/보상
  accentElectric: 0xff6020, // 전기 무기
  accentToxic: 0x20ff9a // 변종/위험
};

/** 0xRRGGBB 숫자를 '#rrggbb' 문자열로. */
export const toCss = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

// 자주 쓰는 문자열 버전 미리 풀어둠
export const CSS = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, toCss(v)])
);
