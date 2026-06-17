// 지역 변형 배경 다운스케일 (원본 보존, web 사본 생성)
// 목적: 1672x941 변형 원본(각 ~2.5MB PNG)을 전투 뷰 높이에 맞춰 줄여
//       지역 진입 시 지연 로드할 풀커버 단일 이미지(webp)로 굽는다.
//
// 변형은 패럴랙스와 달리 "단일 씬 그림"이라 타일링하지 않고 풀커버 1장으로 깐다.
// 높이 371 = COMBAT_H(layout.js)에 맞춰 비율 유지 리사이즈 → 폭 ≈ 659.
//
// 패럴랙스 레이어는 무손실이지만 변형은 디테일이 빽빽한 씬이라 무손실이면 수백KB~MB로 과대.
// lossy q82가 디테일/용량 균형점(목표 100~250KB대). lanczos3로 다운스케일 선명도 확보.
//
// 실행: npm run optimize:variants

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VARIANTS = join(__dirname, '..', 'assets', 'ai-generated', 'backgrounds', 'variants');
const OUT = join(VARIANTS, 'web');

const TARGET_HEIGHT = 371; // = COMBAT_H. 폭은 비율 유지로 자동(원본 1672x941 → ~659).
const QUALITY = 82;

// 게임에 연결된 지역 변형 9종을 굽는다. 앞 3종(highway/factory/sewer) + 심층 6종(bunker~checkpoint).
// 나머지 변형 PNG는 향후 여유분(미사용).
const FILES = [
  'ruined_elevated_highway.png',
  'ruined_factory_exterior.png',
  'flooded_sewer_channel.png',
  'underground_bunker_corridor.png',
  'abandoned_hospital_courtyard.png',
  'damaged_power_plant_interior.png',
  'toxic_swamp_outskirts.png',
  'landfill_crater.png',
  'quarantine_checkpoint_ruins.png'
];

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

async function run() {
  await mkdir(OUT, { recursive: true });
  let inTotal = 0;
  let outTotal = 0;

  for (const src of FILES) {
    const srcPath = join(VARIANTS, src);
    const out = src.replace(/\.png$/, '.webp');
    const outPath = join(OUT, out);

    const inSize = (await stat(srcPath)).size;
    inTotal += inSize;

    const info = await sharp(srcPath)
      // height만 지정 → 비율 유지 다운스케일(lanczos3로 고해상 원본을 선명하게).
      .resize({ height: TARGET_HEIGHT, kernel: sharp.kernel.lanczos3 })
      .webp({ quality: QUALITY, effort: 6 })
      .toFile(outPath);

    const outSize = (await stat(outPath)).size;
    outTotal += outSize;
    console.log(
      `${src.padEnd(30)} ${kb(inSize).padStart(8)} -> ${out.padEnd(30)} ${kb(outSize).padStart(8)}  ${info.width}x${info.height} q${QUALITY}`
    );
  }

  console.log('-'.repeat(84));
  console.log(`합산  ${kb(inTotal)} -> ${kb(outTotal)}  (${(100 - (outTotal / inTotal) * 100).toFixed(1)}% 감소)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
