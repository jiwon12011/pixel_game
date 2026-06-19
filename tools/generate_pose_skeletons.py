"""
LAST SALVAGE — 플레이어 애니메이션용 ControlNet OpenPose 스켈레톤 생성기.

목적:
  스카퍼(플레이어)의 walk/attack/hit/death 프레임 "포즈 골격"을 deterministic하게
  뽑는다. 이 골격을 8단계 의상(scrapper_stage_01~08) 각각에 ControlNet(OpenPose)으로
  동일하게 적용하면, 옷이 달라도 모든 단계의 애니메이션 타이밍·포즈가 정확히 일치한다.
  → "외모/의상은 stage PNG가 고정, 포즈만 골격이 지정" 이라는 일관성 전략의 핵심 입력.

프레이밍:
  기존 stage 아트와 동일하게 머리끝 ~3.7%, 발끝 ~96%(세로), 정면 3/4 자세에 맞춰
  키포인트를 배치한다(scripts/measure-character-foot.mjs 실측 기준).

출력:
  assets/pose-skeletons/scrapper_pose_<action>_<i>.png   (각 프레임, 검은 배경 + COCO-18 골격)
  assets/pose-skeletons/_contact_sheet.png               (전체 미리보기)

실행:
  python3 tools/generate_pose_skeletons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "pose-skeletons"

W, H = 480, 768  # 세로 포트레이트. ControlNet이 stage 비율로 리사이즈해도 포즈 비율 유지.

# ── 신체 앵커(정면) — 측정 프레이밍(머리 3.7% / 발 96%)에 맞춤 ───────────────
CX = W // 2
NECK_Y = 128
SHOULDER_Y = 142
HIP_Y = 410
NOSE_Y = 78
SHOULDER_HALF = 72
HIP_HALF = 44
L_UARM, L_FARM = 122, 112      # 위팔/아래팔
L_THIGH, L_SHIN = 152, 160     # 허벅지/정강이

# COCO-18 키포인트 인덱스
NOSE, NECK, RSHO, RELB, RWRI, LSHO, LELB, LWRI = 0, 1, 2, 3, 4, 5, 6, 7
RHIP, RKNE, RANK, LHIP, LKNE, LANK = 8, 9, 10, 11, 12, 13
REYE, LEYE, REAR, LEAR = 14, 15, 16, 17

# OpenPose 표준 림 연결 + 색(ControlNet OpenPose가 인식하는 관례적 배색)
LIMBS = [
    (NECK, RSHO), (NECK, LSHO), (RSHO, RELB), (RELB, RWRI),
    (LSHO, LELB), (LELB, LWRI), (NECK, RHIP), (RHIP, RKNE),
    (RKNE, RANK), (NECK, LHIP), (LHIP, LKNE), (LKNE, LANK),
    (NECK, NOSE), (NOSE, REYE), (REYE, REAR), (NOSE, LEYE), (LEYE, LEAR),
]
LIMB_COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0),
    (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85),
    (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255),
    (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170),
]
POINT_COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0),
    (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
    (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255),
    (255, 0, 255), (255, 0, 170), (255, 0, 85),
]


def _dir(origin, length, angle_deg):
    """수직 아래(0°)에서 시계방향(+ = 이미지 오른쪽)으로 angle만큼 회전한 끝점."""
    a = math.radians(angle_deg)
    return (origin[0] + length * math.sin(a), origin[1] + length * math.cos(a))


def _rot(pt, pivot, deg):
    a = math.radians(deg)
    dx, dy = pt[0] - pivot[0], pt[1] - pivot[1]
    return (
        pivot[0] + dx * math.cos(a) - dy * math.sin(a),
        pivot[1] + dx * math.sin(a) + dy * math.cos(a),
    )


# 기본(중립) 자세 파라미터 — 각도는 수직아래 기준, + = 이미지 오른쪽.
# person's right(RSHO/RHIP 등)은 정면뷰에서 이미지 왼쪽에 온다.
BASE = dict(
    lean=0.0, head_turn=4.0, drop_y=0.0, global_rot=0.0, scale=1.0,
    armR_sh=-14, armR_el=-6, armL_sh=14, armL_el=6,
    legR_hip=-7, legR_kn=4, legL_hip=7, legL_kn=4,
)

# 동작별 프레임 — BASE에서 바뀌는 값만 덮어쓴다.
# 정면뷰 보행은 다리를 크게 벌리지 않는다(앞발=무릎 굽혀 든 느낌, 뒷발=거의 직립).
FRAMES = {
    "walk": [
        dict(legL_hip=11, legL_kn=26, legR_hip=-6, legR_kn=4, armR_sh=14, armL_sh=-12, drop_y=6),
        dict(legL_hip=4, legR_hip=-4, drop_y=-4),
        dict(legR_hip=-11, legR_kn=26, legL_hip=6, legL_kn=4, armL_sh=14, armR_sh=-12, drop_y=6),
        dict(legL_hip=-4, legR_hip=4, drop_y=-4),
    ],
    "attack": [
        dict(armL_sh=42, armL_el=34, lean=-7, armR_sh=-12),                       # 윈드업(무기 들어올림, 뒤로 기댐)
        dict(armL_sh=98, armL_el=6, lean=9, legL_hip=16, legR_hip=-12, drop_y=4),  # 타격(오른쪽으로 내려침)
        dict(armL_sh=64, armL_el=22, lean=3),                                      # 회수
    ],
    "hit": [
        dict(lean=-17, head_turn=-10, armR_sh=-32, armL_sh=30, legR_hip=-15, drop_y=-2),  # 피격 리코일
        dict(lean=-6, armR_sh=-20, armL_sh=18),                                            # 복귀 중
    ],
    "death": [
        dict(lean=-22, drop_y=8, armR_sh=-26, armL_sh=22, legR_hip=-12, legL_hip=12),       # 비틀
        dict(global_rot=40, drop_y=92, lean=-10, scale=0.92),                               # 쓰러짐
        dict(global_rot=60, drop_y=150, scale=0.78, armR_sh=-46, armL_sh=46, legR_kn=20, legL_kn=20),  # 지면(프레임 내 유지)
    ],
}


def build_pose(p):
    """파라미터 dict → 18 키포인트 좌표 리스트."""
    midhip = (CX, HIP_Y)
    # 상체 클러스터(목/어깨/머리)는 mid-hip 기준 lean 회전.
    neck = _rot((CX, NECK_Y), midhip, p["lean"])
    rsho = _rot((CX - SHOULDER_HALF, SHOULDER_Y), midhip, p["lean"])
    lsho = _rot((CX + SHOULDER_HALF, SHOULDER_Y), midhip, p["lean"])
    nose = _rot((CX + p["head_turn"], NOSE_Y), midhip, p["lean"])
    reye = _rot((CX - 12 + p["head_turn"], NOSE_Y - 14), midhip, p["lean"])
    leye = _rot((CX + 14 + p["head_turn"], NOSE_Y - 14), midhip, p["lean"])
    rear = _rot((CX - 28 + p["head_turn"], NOSE_Y - 10), midhip, p["lean"])
    lear = _rot((CX + 30 + p["head_turn"], NOSE_Y - 10), midhip, p["lean"])

    rhip = (CX - HIP_HALF, HIP_Y)
    lhip = (CX + HIP_HALF, HIP_Y)

    # 팔: 어깨 → 팔꿈치 → 손목 (FK)
    relb = _dir(rsho, L_UARM, p["armR_sh"])
    rwri = _dir(relb, L_FARM, p["armR_sh"] + p["armR_el"])
    lelb = _dir(lsho, L_UARM, p["armL_sh"])
    lwri = _dir(lelb, L_FARM, p["armL_sh"] + p["armL_el"])
    # 다리: 골반 → 무릎 → 발목 (FK)
    rkne = _dir(rhip, L_THIGH, p["legR_hip"])
    rank = _dir(rkne, L_SHIN, p["legR_hip"] + p["legR_kn"])
    lkne = _dir(lhip, L_THIGH, p["legL_hip"])
    lank = _dir(lkne, L_SHIN, p["legL_hip"] + p["legL_kn"])

    pts = [None] * 18
    pts[NOSE], pts[NECK] = nose, neck
    pts[RSHO], pts[RELB], pts[RWRI] = rsho, relb, rwri
    pts[LSHO], pts[LELB], pts[LWRI] = lsho, lelb, lwri
    pts[RHIP], pts[RKNE], pts[RANK] = rhip, rkne, rank
    pts[LHIP], pts[LKNE], pts[LANK] = lhip, lkne, lank
    pts[REYE], pts[LEYE], pts[REAR], pts[LEAR] = reye, leye, rear, lear

    # 스케일(사망 프레임이 프레임 밖으로 안 나가게) → 전역 회전(낙하) → 수직 드롭
    if p["scale"] != 1.0:
        s = p["scale"]
        pts = [(midhip[0] + (q[0] - midhip[0]) * s, midhip[1] + (q[1] - midhip[1]) * s) for q in pts]
    if p["global_rot"]:
        pts = [_rot(q, midhip, p["global_rot"]) for q in pts]
    if p["drop_y"]:
        pts = [(q[0], q[1] + p["drop_y"]) for q in pts]
    return pts


def draw_skeleton(pts, w=W, h=H):
    img = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for (a, b), col in zip(LIMBS, LIMB_COLORS):
        d.line([pts[a], pts[b]], fill=col, width=12)
    for i, q in enumerate(pts):
        r = 7
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=POINT_COLORS[i])
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    produced = []
    for action, frames in FRAMES.items():
        for i, override in enumerate(frames):
            p = dict(BASE)
            p.update(override)
            img = draw_skeleton(build_pose(p))
            name = f"scrapper_pose_{action}_{i}.png"
            img.save(OUT / name)
            produced.append((f"{action} {i}", img))
    # 컨택트 시트(미리보기)
    cols = 6
    rows = (len(produced) + cols - 1) // cols
    tw, th = W // 3, H // 3
    sheet = Image.new("RGB", (cols * tw, rows * th), (18, 18, 18))
    sd = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for idx, (label, img) in enumerate(produced):
        thumb = img.resize((tw, th))
        cx, cy = (idx % cols) * tw, (idx // cols) * th
        sheet.paste(thumb, (cx, cy))
        sd.text((cx + 6, cy + 4), label, fill=(240, 240, 240), font=font)
    sheet.save(OUT / "_contact_sheet.png")
    print(f"생성 완료: {len(produced)}개 골격 → {OUT}")
    for label, _ in produced:
        print(f"  scrapper_pose_{label.replace(' ', '_')}.png")


if __name__ == "__main__":
    main()
