// ── 절차적 8비트 SFX/BGM 합성 (Web Audio API) ────────────────────────────
// 외부 음원 파일 0 — 모든 소리를 oscillator + noise 버퍼로 런타임 합성한다(라이선스/다운로드 무관).
// 설계 요약:
//   · AudioContext 1개 싱글톤. master gain 한 겹으로 음소거/볼륨 제어.
//   · 모바일 autoplay 정책 대응 — ctx는 "첫 사용자 제스처"에서만 생성+resume한다.
//     제스처 전엔 ctx 자체가 없어 무음(콘솔 경고 0). play()는 조용히 no-op.
//   · 누수 0 — 이벤트성 노드는 onended에서 disconnect, 동시 보이스 상한(MAX_VOICES) 초과분 드롭.
//   · 사운드 실패가 게임을 막지 않도록 모든 진입점 try/catch.
//   · 빌드/SSR 안전 — window/AudioContext 가드.

const isBrowser = typeof window !== 'undefined';
const STORAGE_KEY = 'ls_muted';
const SFXVOL_KEY = 'ls_sfxvol'; // SFX 버스 볼륨(0~1)
const BGMVOL_KEY = 'ls_bgmvol'; // BGM 버스 볼륨(0~1)

const MASTER_VOLUME = 0.5; // 마스터 상한(개별 레시피 vol은 이 아래로 합성)
const MAX_VOICES = 8; // 동시 재생 보이스 상한(SFX만 계수, BGM 제외)
const BGM_VOLUME = 0.95;   // BGM out 게인 — 아주 크게(요청). 컴프레서+메이크업으로 클리핑 없이 라우드.
const BGM_MAKEUP = 1.7;    // 컴프레서 뒤 메이크업 게인 — 압축으로 낮아진 평균을 끌어올려 체감 음량↑.
const BGM_TEMPO = 96;      // BPM — 스산하면서도 추진력 있는 드라이브.

let ctx = null; // AudioContext (첫 제스처에서 lazy 생성)
let master = null; // 마스터 gain 노드(음소거 토글이 묶이는 한 겹)
let sfxBus = null; // SFX 버스 gain — 모든 효과음이 여기로 모임(master 하위)
let bgmBus = null; // BGM 버스 gain — 앰비언트 BGM out이 여기로(master 하위)
let resumed = false; // 첫 제스처 resume 완료 여부
let muted = false; // 음소거 상태(localStorage 동기화)
let sfxVolume = 1.0; // SFX 버스 볼륨(0~1, localStorage 동기화). 제스처 전엔 모듈 변수만 갱신.
let bgmVolume = 1.0; // BGM 버스 볼륨(0~1, localStorage 동기화). unlock 시 노드에 반영.
let activeVoices = 0; // 현재 살아있는 SFX 보이스 수
let bgm = null; // BGM 핸들({ 노드들, interval })
let noiseBuffer = null; // 재사용 노이즈 버퍼(타격/폭발용)

const muteListeners = new Set(); // 음소거 토글 시 UI 갱신용 구독자

// 동일 사운드 연타 스팸 억제 — 핫패스(타격/처치/획득)만 최소 간격(ms) 적용.
const THROTTLE_MS = { tap_attack: 55, enemy_kill: 40, pickup: 70, player_hurt: 80 };
const lastPlayMs = {};

// ── 코어 합성 헬퍼 ────────────────────────────────────────────────────────

// 1초짜리 화이트노이즈 버퍼 1개를 캐시해 모든 타격/폭발이 공유한다(매번 생성 X).
function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

// 보이스 등록 — onended에서 노드 disconnect + 카운트 감소(누수/CPU 누적 방지).
function trackVoice(node, ...extras) {
  activeVoices++;
  node.onended = () => {
    try {
      node.disconnect();
      extras.forEach((n) => n.disconnect());
    } catch {
      /* 이미 정리됨 — 무시 */
    }
    activeVoices = Math.max(0, activeVoices - 1);
  };
}

// 단음 — square/triangle/sawtooth + AD 엔벨로프(어택→지수 감쇠). 8비트 특유의 펀치감.
// freqEnd 지정 시 피치 슬라이드(다운/업스윕). when: 시작 지연(아르페지오 스태거용).
function playTone({
  type = 'square',
  freq = 440,
  freqEnd = null,
  dur = 0.12,
  vol = 0.22,
  attack = 0.004,
  when = 0
}) {
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
  }
  // AD 엔벨로프 — 0에 도달 못하는 exponential 특성상 0.0001로 수렴.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  trackVoice(osc, g);
}

// 노이즈 버스트 — 타격/폭발/크런치. 밴드/로우/하이패스 필터 + 선택적 필터 스윕으로 질감 차별화.
function playNoise({
  dur = 0.1,
  vol = 0.25,
  filterType = 'lowpass',
  filterFreq = 2000,
  filterEnd = null,
  when = 0
}) {
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreq, t);
  if (filterEnd != null) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterEnd), t + dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(sfxBus);
  src.start(t);
  src.stop(t + dur + 0.02);
  trackVoice(src, g, filter);
}

// 상승/하강 아르페지오 — 제작·강화·승리 스팅어 공용. freqs 순서대로 스태거 재생.
function arp(freqs, { type = 'square', noteDur = 0.09, gap = 0.06, vol = 0.2, attack = 0.004 } = {}) {
  freqs.forEach((f, i) => playTone({ type, freq: f, dur: noteDur, vol, attack, when: i * gap }));
}

// 살짝 랜덤 디튠 — 타격/처치음이 매번 똑같지 않게(레트로 SFX 생동감).
const wobble = (f) => f * (0.94 + Math.random() * 0.12);

// ── 사운드 레시피 레지스트리 ──────────────────────────────────────────────
// 각 레시피는 파형/피치/길이를 달리해 청각적으로 구분되게. 대부분 <300ms.
const RECIPES = {
  // 타격 임팩트 — 짧은 노이즈(피치다운) + 낮은 square thud. 자동/탭 평타 히트.
  tap_attack() {
    playNoise({ dur: 0.06, vol: 0.2, filterType: 'lowpass', filterFreq: 3200, filterEnd: 700 });
    playTone({ type: 'square', freq: wobble(240), freqEnd: 110, dur: 0.07, vol: 0.15, attack: 0.002 });
  },
  // 처치 — 픽셀 크런치 + 다운피치 square.
  enemy_kill() {
    playNoise({ dur: 0.12, vol: 0.26, filterType: 'bandpass', filterFreq: 1600, filterEnd: 400 });
    playTone({ type: 'square', freq: wobble(330), freqEnd: 80, dur: 0.14, vol: 0.18, attack: 0.002 });
  },
  // 피격 — 낮은 buzz(sawtooth) + 묵직한 저역 노이즈.
  player_hurt() {
    playTone({ type: 'sawtooth', freq: 170, freqEnd: 90, dur: 0.18, vol: 0.22, attack: 0.003 });
    playNoise({ dur: 0.08, vol: 0.1, filterType: 'lowpass', filterFreq: 600 });
  },
  // 획득 — 밝은 짧은 2음 blip(재료/코인).
  pickup() {
    playTone({ type: 'square', freq: 880, dur: 0.05, vol: 0.15, attack: 0.002 });
    playTone({ type: 'square', freq: 1320, dur: 0.07, vol: 0.15, attack: 0.002, when: 0.05 });
  },
  // 제작 성공 — 상승 메이저 아르페지오(square).
  craft() {
    arp([523, 659, 784], { type: 'square', vol: 0.2 });
  },
  // 강화 성공 — 더 밝고 긴 상승(triangle, 4음).
  enhance() {
    arp([659, 784, 988, 1175], { type: 'triangle', noteDur: 0.08, gap: 0.05, vol: 0.2 });
  },
  // 업그레이드/능력치업 — 상승 3음(square).
  upgrade() {
    arp([440, 587, 880], { type: 'square', vol: 0.2 });
  },
  // 웨이브업 — 짧고 단단한 상승 2음.
  wave_up() {
    arp([392, 659], { type: 'square', noteDur: 0.1, gap: 0.08, vol: 0.2 });
  },
  // 보스 등장 — 낮고 묵직한 드론 다중음.
  boss_intro() {
    playTone({ type: 'sawtooth', freq: 55, dur: 0.7, vol: 0.3, attack: 0.04 });
    playTone({ type: 'square', freq: 82, dur: 0.7, vol: 0.12, attack: 0.04 });
    playTone({ type: 'sawtooth', freq: 110, freqEnd: 70, dur: 0.5, vol: 0.14, attack: 0.02, when: 0.15 });
  },
  // 보스 처치 — 승리 스팅어(상승 메이저 + 마지막 음 길게).
  boss_down() {
    arp([523, 659, 784, 1047], { type: 'triangle', noteDur: 0.12, gap: 0.1, vol: 0.24 });
    playTone({ type: 'square', freq: 1047, dur: 0.4, vol: 0.15, when: 0.42 });
  },
  // 사망 — 하강 톤(sawtooth + 저역 받침).
  death() {
    playTone({ type: 'sawtooth', freq: 440, freqEnd: 70, dur: 0.6, vol: 0.26, attack: 0.005 });
    playTone({ type: 'square', freq: 220, freqEnd: 50, dur: 0.6, vol: 0.1, attack: 0.005 });
  },
  // 단계 변신 — 반짝 상승(triangle 3음 + 고음 스파클).
  stage_up() {
    arp([784, 1047, 1319], { type: 'triangle', noteDur: 0.09, gap: 0.05, vol: 0.22 });
    playTone({ type: 'square', freq: 1568, dur: 0.12, vol: 0.13, when: 0.16 });
  },
  // 탭/버튼 클릭 — 아주 짧은 blip.
  tab() {
    playTone({ type: 'square', freq: 660, dur: 0.04, vol: 0.12, attack: 0.002 });
  }
};

// ── BGM — 절차적 앰비언트(종말물 톤) ───────────────────────────────────────
// 5겹 레이어로 황량한 폐허 분위기를 합성한다:
//   ① 서브 베이스(41Hz sine)   — 바닥을 누르는 묵직한 진동(불안/위협)
//   ② 디튠 드론 패드(saw×2+tri) — 두께 있는 저역 드론(코어 톤)
//   ③ 황량한 바람(필터 노이즈)  — LFO로 천천히 흔들리는 desolate wind 베드
//   ④ 숨 쉬는 LFO 필터          — 드론 컷오프를 흔들어 "살아 움직이는 폐허"감
//   ⑤ 단조 모티프 + 멀리 우는 종 — 희소하게 떨어지는 A단조 음 + 가끔 낮은 종소리(공허/종말)
// bgmBus→master를 거치므로 음소거에 함께 묶이고, bgmBus.gain으로 BGM만 따로 볼륨 조절된다.
// 모든 노드는 bgm에 모아 추적.
function startBgm() {
  if (bgm || !ctx || muted) return;
  try {
    // 컴프레서 — 여러 레이어 합이 라우드해도 피크를 눌러 클리핑/하시함을 막는다(크게+깔끔).
    // 뒤에 메이크업 게인을 둬 압축으로 낮아진 평균을 다시 끌어올린다(라우드니스 극대화).
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    const makeup = ctx.createGain();
    makeup.gain.value = BGM_MAKEUP;
    comp.connect(makeup).connect(bgmBus);

    const out = ctx.createGain();
    out.gain.value = BGM_VOLUME;
    out.connect(comp);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    lp.connect(out);

    const droneNodes = [];
    const startOsc = (f, type, g, dest) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      osc.connect(gain).connect(dest);
      osc.start();
      droneNodes.push(osc, gain);
      return osc;
    };

    // 짧은 음 1발을 절대시각 t에 예약하는 헬퍼(아르페지오/베이스/타악 공용). onended 정리(누수 0).
    const note = ({ type = 'square', freq, freqEnd = null, t, dur, vol, dest = out, attack = 0.004 }) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* 무시 */ } };
    };

    // ── 스산한 베드(드론) ──────────────────────────────────────────────
    // ① 서브 베이스 — 깊은 41Hz(A0). lp 우회 out 직결.
    startOsc(41.2, 'sine', 0.34, out);
    // ② 디튠 드론 패드 — 두께(리듬 자리 확보 위해 기존보다 약간 낮춤).
    startOsc(55, 'sawtooth', 0.32, lp);
    startOsc(55.5, 'sawtooth', 0.32, lp);
    startOsc(82.41, 'triangle', 0.20, lp);

    // ③ 황량한 바람 — 좁은 밴드패스 노이즈 + 느린 LFO.
    const wind = ctx.createBufferSource();
    wind.buffer = getNoiseBuffer();
    wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 480;
    windBp.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.08;
    wind.connect(windBp).connect(windGain).connect(out);
    wind.start();
    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.05;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 240;
    windLfo.connect(windLfoGain).connect(windBp.frequency);
    windLfo.start();

    // ④ 느린 LFO — 드론 컷오프를 흔들어 "숨 쉬는" 질감.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // ── 역동적 리듬 엔진 (룩어헤드 스케줄러) ───────────────────────────
    // A단조 4마디 루프(Am–F–G–Am). 16분음 격자로 베이스 펄스 + 긴장 아르페지오 + 킥/햇.
    // 마디마다 코드: bass(저역 루트), tones(아르페지오 4음).
    const CHORDS = [
      { bass: 55.00, tones: [220.00, 261.63, 329.63, 440.00] }, // Am (A1 / A3 C4 E4 A4)
      { bass: 43.65, tones: [174.61, 220.00, 261.63, 349.23] }, // F  (F1 / F3 A3 C4 F4)
      { bass: 49.00, tones: [196.00, 246.94, 293.66, 392.00] }, // G  (G1 / G3 B3 D4 G4)
      { bass: 55.00, tones: [220.00, 246.94, 329.63, 415.30] }  // Am→리딩톤(G#4) 긴장
    ];
    // 마디 내 8개 8분음 자리의 아르페지오 인덱스(오르내림으로 추진력 + 불안).
    const ARP = [0, 2, 3, 2, 1, 2, 3, 1];

    // 킥 — sine 피치드롭 + 짧은 클릭. 추진력의 중심.
    const kick = (t, strong) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(strong ? 0.85 : 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.18);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* 무시 */ } };
    };
    // 햇 — 하이패스 노이즈 짧게.
    const hat = (t, vol) => {
      const s = ctx.createBufferSource();
      s.buffer = getNoiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      s.connect(f).connect(g).connect(out);
      s.start(t); s.stop(t + 0.06);
      s.onended = () => { try { s.disconnect(); g.disconnect(); f.disconnect(); } catch { /* 무시 */ } };
    };

    const SIXTEENTH = (60 / BGM_TEMPO) / 4; // 16분음 길이(초)
    let s16 = 0;                            // 0..63 (4마디 × 16스텝)
    let nextNoteTime = ctx.currentTime + 0.12;

    const scheduleStep = (s, t) => {
      const bar = Math.floor(s / 16) % 4;
      const inBar = s % 16;
      const chord = CHORDS[bar];

      // 킥 — 강(0,8) / 중(4,12).
      if (inBar % 8 === 0) kick(t, true);
      else if (inBar % 4 === 0) kick(t, false);
      // 햇 — 8분 뒷박(2,6,10,14) 또렷, 그 외 홀수 16분에 고스트(아주 작게).
      if (inBar % 4 === 2) hat(t, 0.13);
      else if (inBar % 2 === 1) hat(t, 0.04);

      // 8분음 자리(짝수 16분)에 베이스 펄스 + 아르페지오.
      if (inBar % 2 === 0) {
        const eighth = inBar / 2; // 0..7
        // 베이스 — 거친 saw 펄스(추진). 마지막 마디 끝박은 옥타브 점프로 긴장.
        const bf = chord.bass * (bar === 3 && eighth >= 6 ? 2 : 1);
        note({ type: 'sawtooth', freq: bf, t, dur: 0.16, vol: 0.22, attack: 0.002, dest: out });
        // 아르페지오 — 긴장된 triangle(스산), 짧고 또렷. 4마디째는 한 옥타브 올려 고조.
        const af = chord.tones[ARP[eighth]] * (bar === 3 ? 2 : 1);
        note({ type: 'triangle', freq: af, t, dur: 0.19, vol: 0.085, attack: 0.003, dest: out });
      }

      // 멀리 우는 종 — 각 마디 첫 박(공허/종말 잔향). lp 베드 위로 길게.
      if (inBar === 0) {
        const bell = ctx.createOscillator();
        bell.type = 'sine';
        bell.frequency.value = chord.tones[0] / 2;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(0.06, t + 0.04);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        bell.connect(bg).connect(out);
        bell.start(t); bell.stop(t + 2.6);
        bell.onended = () => { try { bell.disconnect(); bg.disconnect(); } catch { /* 무시 */ } };
      }
    };

    // 룩어헤드 — 25ms마다 0.12s 앞까지 미리 예약해 setInterval 지터에도 박자가 안 흔들린다.
    const interval = setInterval(() => {
      if (!ctx || muted || ctx.state !== 'running') return;
      while (nextNoteTime < ctx.currentTime + 0.12) {
        scheduleStep(s16, nextNoteTime);
        nextNoteTime += SIXTEENTH;
        s16 = (s16 + 1) % 64;
      }
    }, 25);

    bgm = { comp, makeup, out, lp, lfo, lfoGain, wind, windBp, windGain, windLfo, windLfoGain, droneNodes, interval };
  } catch {
    bgm = null; // BGM 실패해도 SFX/게임 진행 무중단
  }
}

// ── 제스처 언락 / 음소거 / 재생 ───────────────────────────────────────────

function applyMasterGain() {
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
}

// 버스 게인 반영 — 노드가 살아있을 때만(제스처 전 호출은 모듈 변수만 갱신되고 unlock에서 반영).
function applySfxGain() {
  if (sfxBus) sfxBus.gain.value = sfxVolume;
}
function applyBgmGain() {
  if (bgmBus) bgmBus.gain.value = bgmVolume;
}

// 첫 사용자 제스처 — ctx 생성 + master/버스 구성 + resume + BGM 시작. 1회만 동작.
function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      applyMasterGain();
      master.connect(ctx.destination);
      // master 하위에 SFX/BGM 두 버스 신설 — 개별 볼륨은 버스 게인으로, 음소거는 master로 묶임.
      sfxBus = ctx.createGain();
      bgmBus = ctx.createGain();
      applySfxGain(); // 복원된 sfxVolume을 노드에 반영
      applyBgmGain(); // 복원된 bgmVolume을 노드에 반영
      sfxBus.connect(master);
      bgmBus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    resumed = true;
    if (!muted) startBgm();
  } catch {
    /* 오디오 미지원/차단 — 무음으로 게임 진행 */
  }
}

let unlockInstalled = false;
function installUnlock() {
  if (!isBrowser || unlockInstalled) return;
  unlockInstalled = true;
  const handler = () => {
    unlock();
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('touchstart', handler);
    window.removeEventListener('keydown', handler);
  };
  // 첫 입력 종류 무엇이든(탭/터치/키) 1회 언락. passive로 스크롤 성능 영향 없음.
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('touchstart', handler, { passive: true });
  window.addEventListener('keydown', handler);
}

// 사운드 1발 — 제스처 전/음소거/보이스 초과/throttle 시 조용히 no-op.
function play(name, _opts) {
  try {
    if (muted || !resumed || !ctx) return;
    if (activeVoices >= MAX_VOICES) return;
    const min = THROTTLE_MS[name];
    if (min != null) {
      const nowMs = ctx.currentTime * 1000;
      if (lastPlayMs[name] != null && nowMs - lastPlayMs[name] < min) return;
      lastPlayMs[name] = nowMs;
    }
    const recipe = RECIPES[name];
    if (recipe) recipe();
  } catch {
    /* 합성 실패 — 게임 무중단 */
  }
}

// 음소거 토글 — localStorage 저장 + 마스터 게인 즉시 반영 + 구독 UI 갱신.
function toggleMute() {
  muted = !muted;
  if (isBrowser) {
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* 저장 실패 무시 */
    }
  }
  applyMasterGain();
  // 음소거 해제 + 이미 언락된 상태면 BGM 시작(아직 없을 때만).
  if (!muted && resumed && !bgm) startBgm();
  muteListeners.forEach((fn) => {
    try {
      fn(muted);
    } catch {
      /* 무시 */
    }
  });
  return muted;
}

const isMuted = () => muted;

// 음소거 상태 변화 구독(버튼 아이콘 동기화). 반환값은 해제 함수.
function onMuteChange(fn) {
  muteListeners.add(fn);
  return () => muteListeners.delete(fn);
}

// ── 버스 볼륨 (SFX / BGM 독립 제어) ───────────────────────────────────────
// 음소거(master)와 별개로 각 버스의 게인을 0~1로 조절. ctx/버스가 없어도(제스처 전)
// 모듈 변수만 갱신하고 노드 반영은 unlock 시점으로 미룬다(guard). 저장은 즉시.
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function persist(key, value) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 저장 실패 무시 — 볼륨은 세션 내에서 계속 동작 */
  }
}

function setSfxVolume(v) {
  sfxVolume = clamp01(v);
  persist(SFXVOL_KEY, sfxVolume);
  applySfxGain();
  return sfxVolume;
}
function setBgmVolume(v) {
  bgmVolume = clamp01(v);
  persist(BGMVOL_KEY, bgmVolume);
  applyBgmGain();
  return bgmVolume;
}
const getSfxVolume = () => sfxVolume;
const getBgmVolume = () => bgmVolume;

// 모듈 로드 시 초기화 — localStorage에서 음소거 상태 + 버스 볼륨 복원 + 제스처 언락 설치.
// 볼륨은 노드가 아직 없으니 모듈 변수만 채우고, 실제 게인 반영은 unlock()이 맡는다.
if (isBrowser) {
  try {
    muted = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    muted = false;
  }
  // 저장값이 유효 숫자면 복원, 아니면 기본 1.0 유지.
  const restoreVol = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? clamp01(n) : fallback;
    } catch {
      return fallback;
    }
  };
  sfxVolume = restoreVol(SFXVOL_KEY, sfxVolume);
  bgmVolume = restoreVol(BGMVOL_KEY, bgmVolume);
  installUnlock();
}

const SFX = {
  play,
  toggleMute,
  isMuted,
  onMuteChange,
  setSfxVolume,
  setBgmVolume,
  getSfxVolume,
  getBgmVolume,
  init: installUnlock
};
export default SFX;
export {
  play,
  toggleMute,
  isMuted,
  onMuteChange,
  setSfxVolume,
  setBgmVolume,
  getSfxVolume,
  getBgmVolume
};
