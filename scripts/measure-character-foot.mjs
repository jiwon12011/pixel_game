// 캐릭터 진행 스프라이트의 발끝/머리/중심 위치를 알파 채널로 실측한다.
// 스프라이트마다 투명 패딩이 달라 footOriginY가 다르므로, 단계별 값 테이블을 만들기 위함.
//   실행: node scripts/measure-character-foot.mjs
import sharp from 'sharp';

const dir = 'assets/ai-generated/characters/progression';
const ALPHA = 64; // 이 이상이면 캐릭터 픽셀로 간주

async function scan(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let top = -1, bot = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = data[(y * W + x) * C + 3];
      if (a > ALPHA) {
        if (top < 0) top = y;
        bot = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return {
    W, H, top, bot, left, right,
    footFrac: +(bot / H).toFixed(4),
    headFrac: +(top / H).toFixed(4),
    centerX: +(((left + right) / 2) / W).toFixed(4),
    contentHFrac: +((bot - top) / H).toFixed(4)
  };
}

const table = [];
for (let i = 1; i <= 8; i++) {
  const stage = String(i).padStart(2, '0');
  const file = `${dir}/scrapper_stage_${stage}.png`;
  try {
    const r = await scan(file);
    const frame = `${r.W}x${r.H}`;
    console.log(
      `stage ${i}  ${frame.padEnd(9)} foot=${r.footFrac.toFixed(4)}  head=${r.headFrac.toFixed(4)}  centerX=${r.centerX.toFixed(4)}  contentH=${r.contentHFrac.toFixed(4)}`
    );
    table.push({ stage: i, footOriginY: r.footFrac, centerX: r.centerX });
  } catch (e) {
    console.log(`stage ${i}  MISSING (${e.message})`);
  }
}

console.log('\n// 단계별 footOriginY 테이블 (layout.js에 붙여넣기용)');
console.log(JSON.stringify(table));
