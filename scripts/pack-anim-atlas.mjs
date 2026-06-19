// 플레이어 애니메이션 아틀라스 패킹 — 정규화된 12프레임/단계를 trimmed 아틀라스(webp+json)로 묶는다.
//   입력: assets/.../animation/normalized/scrapper_stage_<NN>_<action>_<i>.png (512×512, 발끝 베이스라인 통일)
//   출력: assets/.../animation/atlas/scrapper_stage_<NN>.webp + .json  (Phaser JSON Hash 포맷)
//
// 설계(=perf 게이트):
//  - 단계당 아틀라스 1장. 각 프레임을 알파 bbox로 trim → spriteSourceSize/sourceSize를 json에 실어
//    Phaser가 "원래 512 캔버스 안 위치"를 복원한다(=origin 0~1 정규화가 전 프레임/전 단계 공통으로 성립).
//  - VRAM(=아틀라스 가로×세로×4B) ≤ 4MB/단계. 풀해상도 12프레임은 예산을 넘으므로 SCALE로 다운스케일.
//    origin은 0~1 정규화라 스케일 불변 — sourceSize만 같은 단계 안에서 일치하면 발끝 정렬이 유지된다.
//  - 셸프 패킹(높이 내림차순 → 행 채우기). NPOT 아틀라스는 Phaser/WebGL이 clamp+no-mipmap으로 처리.
//
// 실행: node scripts/pack-anim-atlas.mjs [stageNN]   (인자 없으면 발견된 모든 단계)

import sharp from 'sharp';
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'assets/ai-generated/characters/animation/normalized';
const OUT = path.join('assets/ai-generated/characters/animation', 'atlas');

const ALPHA = 16;     // trim 임계 알파(>이면 콘텐츠로 간주)
const PAD = 2;        // 프레임 간 여백 px(샘플 블리딩 방지)
const SCALE = 0.78;   // 소스 다운스케일 — VRAM ≤4MB 맞춤. origin 0~1 정규화라 스케일 무관(튜닝 가능).
const MAX_W = 1024;   // 셸프 줄바꿈 기준 가로 상한
const VRAM_BUDGET = 4 * 1024 * 1024; // 단계당 4MB

// 12프레임 순서(walk0-3 / attack0-2 / hit0-1 / death0-2). 프레임 키 = '<action>_<i>'.
const ACTIONS = [
  'walk_0', 'walk_1', 'walk_2', 'walk_3',
  'attack_0', 'attack_1', 'attack_2',
  'hit_0', 'hit_1',
  'death_0', 'death_1', 'death_2'
];

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

// 알파 bbox 측정(raw 버퍼 기준). 콘텐츠 없으면 null.
function bboxOf(data, W, H, C) {
  let top = -1, bot = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > ALPHA) {
        if (top < 0) top = y;
        bot = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, w: right - left + 1, h: bot - top + 1 };
}

// 단계 번호 자동 발견(scrapper_stage_NN_walk_0.png 존재 기준).
async function discoverStages() {
  const files = await readdir(SRC);
  const set = new Set();
  for (const f of files) {
    const m = f.match(/^scrapper_stage_(\d+)_walk_0\.png$/i);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
}

async function packStage(stage) {
  const scaledCanvas = Math.round(512 * SCALE); // sourceSize(같은 단계 안에서 일치하면 정렬 유지)

  // 1) 각 프레임 로드 → SCALE 다운스케일 → trim. trimmed PNG 버퍼 + 메타 수집.
  const frames = [];
  for (const action of ACTIONS) {
    const srcPath = path.join(SRC, `scrapper_stage_${stage}_${action}.png`);
    const scaled = await sharp(srcPath)
      .resize({ width: scaledCanvas, height: scaledCanvas, kernel: sharp.kernel.lanczos3 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = scaled.info;
    const bb = bboxOf(scaled.data, W, H, C);
    if (!bb) {
      console.warn(`  ! 빈 프레임 ${action} — 1×1 투명으로 대체`);
      frames.push({ name: action, buf: await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), sx: 0, sy: 0, w: 1, h: 1 });
      continue;
    }
    const buf = await sharp(scaled.data, { raw: { width: W, height: H, channels: C } })
      .extract({ left: bb.left, top: bb.top, width: bb.w, height: bb.h })
      .png()
      .toBuffer();
    frames.push({ name: action, buf, sx: bb.left, sy: bb.top, w: bb.w, h: bb.h });
  }

  // 2) 셸프 패킹 — 높이 내림차순 정렬 후 행으로 배치(원래 순서는 name으로 보존).
  const order = [...frames].sort((a, b) => b.h - a.h);
  let x = 0, y = 0, shelfH = 0, atlasW = 0;
  for (const fr of order) {
    if (x > 0 && x + fr.w + PAD > MAX_W) { y += shelfH + PAD; x = 0; shelfH = 0; } // 줄바꿈
    fr.x = x; fr.y = y;
    x += fr.w + PAD;
    if (fr.h > shelfH) shelfH = fr.h;
    if (x > atlasW) atlasW = x;
  }
  const atlasH = y + shelfH;
  atlasW = Math.max(1, atlasW - PAD); // 마지막 프레임 뒤 PAD 제거

  // 3) 합성 — 투명 캔버스 위에 trimmed 버퍼 배치.
  const composites = frames.map((fr) => ({ input: fr.buf, left: fr.x, top: fr.y }));
  await mkdir(OUT, { recursive: true });
  const outImg = path.join(OUT, `scrapper_stage_${stage}.webp`);
  const outJson = path.join(OUT, `scrapper_stage_${stage}.json`);
  await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .webp({ lossless: true, effort: 6 }) // 픽셀/셀 색 경계 보존
    .toFile(outImg);

  // 4) Phaser JSON Hash — frame=packed rect, spriteSourceSize=원캔버스 내 위치, sourceSize=정사각 캔버스.
  const json = { frames: {}, meta: { app: 'pack-anim-atlas.mjs', image: path.basename(outImg), scale: '1', size: { w: atlasW, h: atlasH } } };
  for (const fr of frames) {
    json.frames[fr.name] = {
      frame: { x: fr.x, y: fr.y, w: fr.w, h: fr.h },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: fr.sx, y: fr.sy, w: fr.w, h: fr.h },
      sourceSize: { w: scaledCanvas, h: scaledCanvas }
    };
  }
  await writeFile(outJson, JSON.stringify(json));

  const vram = atlasW * atlasH * 4;
  const imgSize = (await stat(outImg)).size;
  const ok = vram <= VRAM_BUDGET ? 'OK' : '초과!';
  console.log(
    `  stage_${stage}  시트 ${atlasW}x${atlasH}  webp ${kb(imgSize).padStart(8)}  VRAM ${(vram / 1024 / 1024).toFixed(2)}MB  [${ok}]`
  );
  return { stage, atlasW, atlasH, imgSize, vram, over: vram > VRAM_BUDGET };
}

async function run() {
  const arg = process.argv[2]?.replace(/\D/g, '');
  const stages = arg ? [arg.padStart(2, '0')] : await discoverStages();
  if (stages.length === 0) { console.log('처리할 단계 없음(normalized/ 비어있음).'); return; }

  console.log(`[pack-anim-atlas] SCALE=${SCALE}  대상 단계 ${stages.length}개`);
  let totalImg = 0, anyOver = false;
  for (const s of stages) {
    const r = await packStage(s);
    totalImg += r.imgSize;
    if (r.over) anyOver = true;
  }
  console.log('-'.repeat(64));
  console.log(`합산 webp ${kb(totalImg)}  (단계당 평균 ${kb(totalImg / stages.length)})`);
  if (anyOver) {
    console.error('⚠ 일부 단계가 VRAM 4MB를 초과 — SCALE을 낮춰 다시 패킹하세요.');
    process.exit(1);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
