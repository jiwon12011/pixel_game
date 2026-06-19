# 플레이어 애니메이션 생성 가이드 (Codex 전달용)

스카퍼(플레이어) 캐릭터의 **walk / attack / hit / death** 프레임을, **외모·의상을 1px도 바꾸지 않고**
8단계(stage_01~08) 각각에 대해 생성하기 위한 작업 지시서.

---

## 0. 절대 원칙 (이거 하나만 어겨도 캐릭터가 깨진다)

> **텍스트→이미지로 새로 그리지 말 것. 반드시 기존 stage PNG를 "레퍼런스 입력 이미지"로 넣고, 포즈만 바꾸는 image-to-image(편집)로 생성한다.**

- 신원(얼굴·머리·눈·표정)·의상·색·라이팅·스케일은 **레퍼런스 이미지가 고정**한다.
- 모델에게는 **"같은 인물, 같은 옷, 같은 정면 3/4 방향, 포즈만 ○○로"** 만 지시한다.
- 단계마다 옷이 다르므로 → **각 단계의 stage PNG를 그 단계 프레임의 레퍼런스로** 쓴다.
  (stage_03 프레임은 stage_03.png를 레퍼런스로, stage_07은 stage_07.png를 레퍼런스로.)

레퍼런스 원본:
```
assets/ai-generated/characters/progression/scrapper_stage_01.png  ~  scrapper_stage_08.png
```

---

## 1. 8단계 일관성 전략 — 포즈 골격 세트

옷이 8벌이라 단계별로 프레임을 따로 만들어야 하는데, 그대로 두면 단계마다 동작 타이밍이 어긋난다.
해결책: **포즈 골격(OpenPose)을 단계와 무관하게 1세트로 고정**하고, 모든 단계에 같은 골격을 적용한다.
→ 옷이 달라도 8단계의 walk/attack/hit/death 포즈가 **정확히 동일한 타이밍**으로 맞는다.

골격 세트(이미 생성됨, 검은 배경 · COCO-18 표준 OpenPose):
```
assets/pose-skeletons/scrapper_pose_walk_0.png  walk_1  walk_2  walk_3
assets/pose-skeletons/scrapper_pose_attack_0.png  attack_1  attack_2
assets/pose-skeletons/scrapper_pose_hit_0.png  hit_1
assets/pose-skeletons/scrapper_pose_death_0.png  death_1  death_2
assets/pose-skeletons/_contact_sheet.png   ← 전체 미리보기
```
재생성/수정: `python3 tools/generate_pose_skeletons.py` (각 프레임 포즈는 이 스크립트의 `FRAMES` dict에서 조정).

### 도구별 사용법
- **ControlNet(OpenPose)을 지원하는 파이프라인**(Stable Diffusion / ComfyUI):
  - img2img 입력 = 해당 단계 stage PNG, ControlNet = 해당 프레임 골격 PNG(openpose preprocessor 끄고 골격 이미지를 그대로 control map으로).
  - denoising strength 0.35~0.55 (낮을수록 원본 의상 보존 ↑). ControlNet weight 0.8~1.1.
- **레퍼런스 편집형 모델**(Nano Banana / gpt-image edit 등 ControlNet 미지원):
  - 이미지 2장 첨부: ① stage PNG(= "이 인물·이 옷 유지") ② 골격 PNG(= "이 포즈로").
  - 프롬프트에 "첫 번째 이미지의 인물·의상·스타일을 그대로 유지하고, 두 번째 이미지의 스켈레톤 포즈를 따르라"고 명시.

---

## 2. 출력 규격 (전 프레임 공통)

| 항목 | 값 |
|---|---|
| 배경 | **완전 투명**(알파). 그림자·바닥 X |
| 방향 | 레퍼런스와 **동일한 정면 3/4**(절대 측면 프로필로 돌리지 말 것, 좌우 반전 금지) |
| 프레이밍 | 전신, 머리끝 상단 ~4%, 발끝 하단 ~96% (= 기존 stage와 동일 세로 정렬) |
| 스타일 | 레퍼런스와 동일 — 셀/픽셀 혼합 톤, 같은 외곽선·채도·라이팅 |
| 해상도 | 레퍼런스와 동급(짧은 변 ≥ 256px, 투명 PNG) |
| 캐릭터 정체성 | 얼굴·머리·스카프·의상 패턴·색 **변경 0** |

---

## 3. 프롬프트 템플릿

### 공통 고정 절(매 프레임 앞에 붙임)
```
Same exact character as the reference image: identical face, hairstyle, eye shape,
skin tone, scarf, and full outfit (do not change any clothing, color, or pattern).
Same front 3/4 view, same art style, same lighting and scale.
Full body, transparent background, no shadow, no ground.
ONLY the body pose changes as described below.
```

### 부정 프롬프트(negative)
```
different face, different outfit, changed clothing, side profile, back view, mirrored,
extra limbs, deformed hands, new character, background, ground shadow, text, watermark, cropped
```

### 동작별 포즈 지시 (위 골격과 1:1)
| 파일명 | 포즈 지시 (영문 키워드) |
|---|---|
| `walk_0` | mid-stride, left knee raised and bent forward, right leg back, arms swinging opposite (right arm forward) |
| `walk_1` | passing/contact pose, legs nearly together, slight downward bob, arms near neutral |
| `walk_2` | mid-stride opposite, right knee raised and bent forward, left leg back, left arm forward |
| `walk_3` | passing pose opposite phase, legs nearly together, slight bob |
| `attack_0` | wind-up: weapon arm (figure's left / screen-right) raised high, leaning slightly back |
| `attack_1` | strike: weapon arm extended out to the right, body leaning into the swing, wide stance |
| `attack_2` | recovery: weapon arm coming back down, returning to balance |
| `hit_0` | recoil: torso thrown back, head turned away, arms flailing outward, flinch |
| `hit_1` | recovering from the hit, torso returning upright |
| `death_0` | stagger: leaning back off-balance, arms out, about to fall |
| `death_1` | falling/collapsing toward the ground |
| `death_2` | on the ground, body low and slumped, limbs splayed |

> idle(서있는 기본)은 기존 `scrapper_stage_NN.png` 자체가 idle 프레임이다. 호흡 2프레임이 필요하면
> `idle_1` = "subtle breathing, chest slightly raised, no foot movement" 로 1장만 추가 생성.

---

## 4. 파일 네이밍 (게임 연동에 필요 — 꼭 지킬 것)

```
assets/ai-generated/characters/animation/scrapper_stage_<NN>_<action>_<i>.png
```
예: `scrapper_stage_03_walk_0.png`, `scrapper_stage_07_attack_1.png`
- `<NN>` = 01~08, `<action>` = walk|attack|hit|death, `<i>` = 0부터.
- 프레임 수: walk 0~3, attack 0~2, hit 0~1, death 0~2.

---

## 5. 생성 후 단계 (코드 쪽 — 내가 만들어 줄 수 있음)

1. **발끝 정렬**: 프레임마다 투명 패딩이 달라 발 위치가 흔들린다. `scripts/measure-character-foot.mjs`
   방식으로 프레임의 발끝 Y를 실측해 stage 기준선에 맞춘다(애니메이션 떨림 방지).
2. **스프라이트 시트 패킹**: action별 프레임을 가로 시트로 합치고 manifest 등록.
3. **webp 최적화**: 기존 `scripts/optimize-*.mjs` 패턴으로 변환.
4. **Phaser 연동**: CombatScene에서 walk/attack/hit/death 애니를 실제 재생(현재 idle+트윈 대체분 교체).

위 1~4는 프레임이 나오면 바로 붙일 수 있게 준비돼 있다.

---

## 6. Codex에게 넘길 한 줄 요약

> "각 stage_NN.png를 레퍼런스로, `assets/pose-skeletons/`의 해당 골격 포즈로만 바꿔서,
> 같은 인물·같은 옷·정면 3/4·투명배경으로 walk(4)·attack(3)·hit(2)·death(3) 프레임을 생성.
> 얼굴/의상/색은 절대 변경 금지. 파일명은 `scrapper_stage_<NN>_<action>_<i>.png`."
