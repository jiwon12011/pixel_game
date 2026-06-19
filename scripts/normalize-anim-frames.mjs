// 플레이어 애니메이션 프레임 정규화 — 캔버스/스케일/발끝이 제각각인 생성 프레임을
// 게임에 바로 쓸 수 있게 통일한다.
//   ① 알파로 콘텐츠 bbox 실측 → ② 단계 기준(서있는 walk_1)으로 캐릭터 키 통일 스케일 산출
//   → ③ 같은 스케일을 그 단계 전 프레임에 적용 → ④ 발끝을 고정 베이스라인에 맞추고 가로 중앙정렬
//   → ⑤ 동일 캔버스로 패딩 저장 + 측정 리포트(잔여 흔들림 점검용).
//
// 실행:  node scripts/normalize-anim-frames.mjs [stageNN]   (인자 없으면 발견된 모든 단계)
// 출력:  assets/ai-generated/characters/animation/normalized/<원본명>.png
//        assets/ai-generated/characters/animation/normalized/_report.json
//        assets/ai-generated/characters/animation/normalized/_preview_<stage>.png

import sharp from 'sharp';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'assets/ai-generated/characters/animation';
const OUT = path.join(SRC, 'normalized');
const ALPHA = 64;

// 출력 규격 — 모든 프레임 공통. 가장 넓은 포즈(사망 누움)·키 큰 단계까지 수용하는 정사각.
const CANVAS = 512;             // perf 게이트: 게임 표시(displayHeight175×2≈350px)에 맞춘 작업 해상도.
const TARGET_STAND_H = 384;     // 서있는 프레임 기준 캐릭터 콘텐츠 높이(px). 캔버스 대비 75%.
                                // 하드 상한 400 — 넘으면 stage_02~08(원본 ~400px)이 업스케일 블러 진입.
const BASELINE_FROM_BOTTOM = 24; // 발끝을 캔버스 하단에서 이만큼 위에.
const STAND_REF = 'walk_1';      // 단계 스케일 산출에 쓰는 "서있는" 기준 프레임.

const ACTION_ORDER = ['walk_0','walk_1','walk_2','walk_3','attack_0','attack_1','attack_2','hit_0','hit_1','death_0','death_1','death_2'];

async function bbox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let top = -1, bot = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > ALPHA) {
        if (top < 0) top = y; bot = y;
        if (x < left) left = x; if (x > right) right = x;
      }
    }
  }
  return { W, H, left, right, top, bot, cw: right - left + 1, ch: bot - top + 1, ccx: (left + right) / 2 };
}

async function listStages() {
  const files = await readdir(SRC);
  const set = new Set();
  for (const f of files) {
    const m = f.match(/^scrapper_stage_(\d{2})_(?:walk|attack|hit|death)_\d\.png$/);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
}

async function normalizeStage(nn, report) {
  const frames = ACTION_ORDER
    .map((a) => ({ a, file: `scrapper_stage_${nn}_${a}.png`, full: path.join(SRC, `scrapper_stage_${nn}_${a}.png`) }));

  // ② 단계 스케일 — 서있는 기준 프레임의 콘텐츠 높이로 통일.
  const refFile = path.join(SRC, `scrapper_stage_${nn}_${STAND_REF}.png`);
  let refBox;
  try { refBox = await bbox(refFile); }
  catch { console.warn(`  [${nn}] 기준 프레임 ${STAND_REF} 없음 — 건너뜀`); return; }
  const scale = TARGET_STAND_H / refBox.ch;

  const baselineY = CANVAS - BASELINE_FROM_BOTTOM;
  const previews = [];

  for (const fr of frames) {
    let box;
    try { box = await bbox(fr.full); }
    catch { continue; } // 해당 프레임 미생성 — 스킵
    // ③ 콘텐츠만 잘라 동일 스케일 적용
    const sw = Math.max(1, Math.round(box.cw * scale));
    const sh = Math.max(1, Math.round(box.ch * scale));
    const cropped = await sharp(fr.full)
      .extract({ left: box.left, top: box.top, width: box.cw, height: box.ch })
      .resize(sw, sh, { fit: 'fill' })
      .toBuffer();
    // ④ 발끝=베이스라인, 콘텐츠 중심=캔버스 중앙
    const leftPad = Math.round(CANVAS / 2 - sw / 2);
    const topPad = Math.round(baselineY - sh);
    const canvas = sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    const out = await canvas.composite([{ input: cropped, left: clamp(leftPad, 0, CANVAS - sw), top: clamp(topPad, 0, CANVAS - sh) }]).png().toBuffer();
    await writeFile(path.join(OUT, fr.file), out);

    // 측정 리포트(정규화 후 발끝/머리/중심)
    const nb = await bbox(path.join(OUT, fr.file));
    report.push({ stage: nn, action: fr.a, scale: +scale.toFixed(3), foot: +(nb.bot / CANVAS).toFixed(3), head: +(nb.top / CANVAS).toFixed(3), cX: +(nb.ccx / CANVAS).toFixed(3), chPx: nb.ch });
    previews.push(out);
  }

  // ⑤ 단계 미리보기(가로 스트립)
  if (previews.length) {
    const t = 200;
    const strip = sharp({ create: { width: t * previews.length, height: t, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 255 } } });
    const comps = [];
    for (let i = 0; i < previews.length; i++) {
      const thumb = await sharp(previews[i]).resize(t, t, { fit: 'contain', background: { r: 26, g: 26, b: 26, alpha: 255 } }).toBuffer();
      comps.push({ input: thumb, left: i * t, top: 0 });
    }
    await strip.composite(comps).png().toFile(path.join(OUT, `_preview_${nn}.png`));
  }
  console.log(`  [${nn}] ${previews.length}프레임 정규화 (scale ${scale.toFixed(3)})`);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function main() {
  await mkdir(OUT, { recursive: true });
  const arg = process.argv[2]?.replace(/\D/g, '');
  const stages = arg ? [arg.padStart(2, '0')] : await listStages();
  if (!stages.length) { console.log('정규화할 프레임을 못 찾음.'); return; }
  const report = [];
  for (const nn of stages) await normalizeStage(nn, report);
  await writeFile(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
  // 잔여 흔들림 점검 — 단계별 발끝/머리 표준편차
  const byStage = {};
  for (const r of report) (byStage[r.stage] ||= []).push(r);
  console.log('\n잔여 정렬 점검(정규화 후):');
  for (const [nn, rows] of Object.entries(byStage)) {
    const foots = rows.map((r) => r.foot), heads = rows.filter((r) => !r.action.startsWith('death')).map((r) => r.head);
    console.log(`  stage ${nn}: foot ${min(foots).toFixed(3)}~${max(foots).toFixed(3)} (Δ${(max(foots) - min(foots)).toFixed(3)}), head(non-death) ${min(heads).toFixed(3)}~${max(heads).toFixed(3)} (Δ${(max(heads) - min(heads)).toFixed(3)})`);
  }
}
const min = (a) => Math.min(...a), max = (a) => Math.max(...a);

main();
