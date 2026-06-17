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
//  - 적/보스/아이템/캐릭터: lossless(픽셀 색 경계 유지) — 종류 적고 또렷함 우선.
//  - 무기 18종/UI 탭: 128px 소형 + 작게 렌더되니 lossless:false/quality:85로 용량 절감(perf 허용).
//
// keepAspect:true 인 카테고리는 정사각 패딩을 하지 않는다.
//  - 캐릭터 히어로 스프라이트는 layout.js의 footOriginY/originX가 "그 프레임의 패딩 비율"이라
//    정사각 contain 패딩을 넣으면 originX(가로 중심 비율)가 틀어진다 → 종횡비 그대로 유지.
//  - maxHeight 로 height만 제한(withoutEnlargement) → 원본이 더 작으면 그대로 두어 선명도 보존.
// match:RegExp 가 있으면 그 패턴의 PNG만 처리(컨택트 시트/프리뷰 등 비-스프라이트 제외).
const CATEGORIES = [
  { name: 'enemies', dir: join(AI, 'enemies'), size: 320 },
  { name: 'bosses', dir: join(AI, 'bosses'), size: 512 },
  { name: 'items', dir: join(AI, 'items', 'individual'), size: 128 },
  // UI 탭 아이콘 4종 — 탭바에서 28px로 작게 렌더되니 128px·q85로 충분(초기 로드 -30% 핵심, P1-1).
  {
    name: 'ui',
    dir: join(AI, 'ui', 'individual'),
    size: 128,
    webp: { lossless: false, quality: 85, effort: 6 }
  },
  // 주인공 진행 스프라이트(stage_01~08) — 히어로라 선명도 우선: 종횡비 유지 + 512px 상한 + 무손실.
  //  표시 175px(2x=350px)보다 크게 유지. 원본(226x478 등)이 512보다 작으면 그대로 둠.
  //  컨택트 시트/프리뷰 PNG는 match로 제외(stage_NN만 처리).
  {
    name: 'characters',
    dir: join(AI, 'characters', 'progression'),
    keepAspect: true,
    maxHeight: 512,
    match: /^scrapper_stage_\d+\.png$/i,
    webp: { lossless: true, effort: 6 }
  },
  // 재료 7종(R7) — 합성 탭/인벤/전투 줍기에서 소형 아이콘으로만 쓰니 무기와 동일 톤(128px, q85).
  {
    name: 'materials',
    dir: join(AI, 'items', 'materials'),
    size: 128,
    webp: { lossless: false, quality: 85, effort: 6 }
  },
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

async function listPngs(dir, match) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .filter((e) => !match || match.test(e.name))
    .map((e) => e.name);
}

async function run() {
  let inTotal = 0;
  let outTotal = 0;

  for (const { name, dir, size, webp, keepAspect, maxHeight, match } of CATEGORIES) {
    const webpOpts = webp || DEFAULT_WEBP;
    const out = join(dir, 'web');
    await mkdir(out, { recursive: true });

    let files;
    try {
      files = await listPngs(dir, match);
    } catch {
      console.log(`(건너뜀) ${name}: 디렉터리 없음`);
      continue;
    }
    if (files.length === 0) {
      console.log(`(건너뜀) ${name}: PNG 없음`);
      continue;
    }

    const label = keepAspect ? `종횡비 유지 h<=${maxHeight}` : `${size}x${size}`;
    console.log(`\n[${name}] 타깃 ${label}  (${files.length}개)`);
    for (const file of files) {
      const srcPath = join(dir, file);
      const outName = basename(file, '.png') + '.webp';
      const outPath = join(out, outName);

      const inSize = (await stat(srcPath)).size;
      inTotal += inSize;

      // keepAspect: height만 제한해 종횡비/패딩 비율 보존(원본보다 키우지 않음).
      // 그 외: 정사각 contain + 투명 패딩으로 일정 타깃 크기.
      const resizeOpts = keepAspect
        ? { height: maxHeight, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 }
        : { width: size, height: size, fit: 'contain', background: TRANSPARENT, kernel: sharp.kernel.lanczos3 };

      await sharp(srcPath)
        .resize(resizeOpts)
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
