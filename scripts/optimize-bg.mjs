// 패럴랙스 배경 다운스케일 (원본 보존, web 사본 생성)
// 목적: 1774x887 원본을 런타임 tileScale=1.0이 되는 720x371로 줄여
//       NEAREST 1:1 샘플링으로 시머(픽셀 흔들림)를 근본 제거 + 용량 절감.
//
// 높이 371 = COMBAT_H 와 일치(layout.js) → ParallaxBackground의
//   tileScale = COMBAT_H / sourceHeight = 1.0.
// 가로 720 = 논리 뷰포트(360) 2배 → 가로 타일링 여유.
//
// 원본 비율 2.0:1 → 720x360이 등비. 의도적으로 371까지 ~3% 세로 늘림(fit:fill)해
// 정수 1:1 정렬을 얻는다(이 미세 스트레치는 리사이즈 시 한 번 구워지고 런타임 시머 없음).
//
// 실행: npm run optimize:bg

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BG = join(__dirname, '..', 'assets', 'ai-generated', 'backgrounds');
const OUT = join(BG, 'web');

const TARGET = { width: 720, height: 371 };

// L1 sky: 그라디언트라 손실 WebP q90 허용. 나머지는 무손실(선명한 지면/잔해 디테일).
const LAYERS = [
  { src: 'parallax_l1_sky.png', out: 'parallax_l1_sky.webp', lossless: false, quality: 90 },
  { src: 'parallax_l2_factory.png', out: 'parallax_l2_factory.webp', lossless: true },
  { src: 'parallax_l3_wreckage.png', out: 'parallax_l3_wreckage.webp', lossless: true },
  { src: 'parallax_l4_ground.png', out: 'parallax_l4_ground.webp', lossless: true }
];

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

async function run() {
  await mkdir(OUT, { recursive: true });
  let inTotal = 0;
  let outTotal = 0;

  for (const { src, out, lossless, quality } of LAYERS) {
    const srcPath = join(BG, src);
    const outPath = join(OUT, out);

    const inSize = (await stat(srcPath)).size;
    inTotal += inSize;

    await sharp(srcPath)
      // fit:fill = 비율 무시하고 정확히 720x371 (의도된 미세 세로 스트레치).
      // lanczos3 = 고해상 원본 다운스케일에 선명. 런타임은 NEAREST 1:1이라 추가 블러 없음.
      .resize({ ...TARGET, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .webp(lossless ? { lossless: true, effort: 6 } : { quality, effort: 6 })
      .toFile(outPath);

    const outSize = (await stat(outPath)).size;
    outTotal += outSize;
    console.log(
      `${src.padEnd(24)} ${kb(inSize).padStart(8)} -> ${out.padEnd(26)} ${kb(outSize).padStart(8)}  ${lossless ? 'lossless' : 'q' + quality}`
    );
  }

  console.log('-'.repeat(72));
  console.log(`합산  ${kb(inTotal)} -> ${kb(outTotal)}  (${(100 - (outTotal / inTotal) * 100).toFixed(1)}% 감소)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
