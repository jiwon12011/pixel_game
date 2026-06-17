// 적/보스 스프라이트 다운스케일 (원본 PNG 보존, web/ webp 사본 생성)
// 목적: 1254x1254 원본을 런타임에 쓸 정사각 타깃(적 320 / 보스 512)으로 줄여
//       용량 절감 + 진입 시 지연 로드(per-encounter)에 적합한 가벼운 사본 확보.
//
// - fit:'contain' + 투명 배경 → 원본 여백/비율 보존(스프라이트 잘림 방지).
// - kernel: lanczos3 → 픽셀 디테일 선명하게 축소.
// - webp({ lossless, effort:6 }) → 알파 보존, 무손실(픽셀아트 색 경계 유지).
//
// 일반화: 카테고리별(적/보스)로 디렉터리를 통째로 훑어 모든 PNG를 처리한다.
//         새 적/보스를 추가해도 폴더에 PNG만 넣으면 자동 변환된다.
//
// 실행: npm run optimize:assets

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { mkdir, readdir, stat } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI = join(__dirname, '..', 'assets', 'ai-generated');

// 카테고리별 타깃 정사각 크기 (기획/perf 스펙)
// webp 옵션은 카테고리별 override 가능:
//  - 적/보스/아이템: lossless(픽셀 색 경계 유지) — 종류 적고 또렷함 우선.
//  - 무기 18종: 128px 소형 + 지연 로드라 lossless:false/quality:85로 용량 절감(perf 허용).
const CATEGORIES = [
  { name: 'enemies', dir: join(AI, 'enemies'), size: 320 },
  { name: 'bosses', dir: join(AI, 'bosses'), size: 512 },
  { name: 'items', dir: join(AI, 'items', 'individual'), size: 128 },
  {
    name: 'weapons',
    dir: join(AI, 'weapons', 'individual'),
    size: 128,
    webp: { lossless: false, quality: 85, effort: 6 }
  }
];

const DEFAULT_WEBP = { lossless: true, effort: 6 };

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const kb = (n) => (n / 1024).toFixed(0) + 'KB';

async function listPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => e.name);
}

async function run() {
  let inTotal = 0;
  let outTotal = 0;

  for (const { name, dir, size, webp } of CATEGORIES) {
    const webpOpts = webp || DEFAULT_WEBP;
    const out = join(dir, 'web');
    await mkdir(out, { recursive: true });

    let files;
    try {
      files = await listPngs(dir);
    } catch {
      console.log(`(건너뜀) ${name}: 디렉터리 없음`);
      continue;
    }
    if (files.length === 0) {
      console.log(`(건너뜀) ${name}: PNG 없음`);
      continue;
    }

    console.log(`\n[${name}] 타깃 ${size}x${size}  (${files.length}개)`);
    for (const file of files) {
      const srcPath = join(dir, file);
      const outName = basename(file, '.png') + '.webp';
      const outPath = join(out, outName);

      const inSize = (await stat(srcPath)).size;
      inTotal += inSize;

      await sharp(srcPath)
        .resize({
          width: size,
          height: size,
          fit: 'contain',
          background: TRANSPARENT,
          kernel: sharp.kernel.lanczos3
        })
        .webp(webpOpts)
        .toFile(outPath);

      const outSize = (await stat(outPath)).size;
      outTotal += outSize;
      console.log(
        `  ${file.padEnd(26)} ${kb(inSize).padStart(8)} -> ${outName.padEnd(26)} ${kb(outSize).padStart(8)}`
      );
    }
  }

  console.log('\n' + '-'.repeat(72));
  if (inTotal > 0) {
    console.log(
      `합산  ${kb(inTotal)} -> ${kb(outTotal)}  (${(100 - (outTotal / inTotal) * 100).toFixed(1)}% 감소)`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
