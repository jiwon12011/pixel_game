// R9 — 웨이브 업그레이드 풀(로그라이트 런 한정 버프).
// 매 5웨이브 진입마다 전투를 잠깐 멈추고 이 풀에서 3장을 뽑아 1장 선택한다.
// 선택은 GameState.runModifiers[key]에 누적(레벨++)되고, 사망(resetRun)에서 초기화된다.
//
// 각 항목: { key, name, desc, color }
//   · key   — GameState.getModifier(key) 조회 키(런타임 효과는 CombatScene이 적용)
//   · name  — 카드 제목(한글)
//   · desc  — 효과 한 줄 설명(레벨당 효과 기준)
//   · color — 카드 강조색(속성/톤). 0xRRGGBB 정수.
// 효과가 즉시 반영되는 건(max_hp_up/atk_up) CombatScene이 선택 즉시 stats에 더한다.
export const RUN_UPGRADES = [
  {
    key: 'lifesteal_on_kill',
    name: '흡혈',
    desc: '처치 시 HP +3 회복',
    color: 0x20ff9a
  },
  {
    key: 'cooldown_down',
    name: '속사',
    desc: '공격 쿨타임 -12%',
    color: 0x66ddff
  },
  {
    key: 'coin_boost',
    name: '금화 자석',
    desc: '코인 드롭 +25%',
    color: 0xf0c040
  },
  {
    key: 'max_hp_up',
    name: '강골',
    desc: '최대 HP +20 (즉시 회복)',
    color: 0xff6020
  },
  {
    key: 'shock_dmg',
    name: '과부하',
    desc: '감전된 적에게 피해 +50%',
    color: 0x66ddff
  },
  {
    key: 'dot_speed',
    name: '맹독·맹화',
    desc: '화염·독 지속 피해 +30%',
    color: 0xffa020
  },
  {
    key: 'first_hit_shield',
    name: '방벽',
    desc: '웨이브당 1회 피해 무효',
    color: 0xbfe3ff
  },
  {
    key: 'atk_up',
    name: '예리함',
    desc: '공격력 +6 (즉시)',
    color: 0xff6020
  }
];

// 0xRRGGBB 정수 → '#rrggbb'(텍스트 color용).
export const upgradeHex = (n) => '#' + n.toString(16).padStart(6, '0');

// 풀에서 중복 없이 n장 뽑기(Fisher-Yates 부분 셔플). 풀보다 많이 요구하면 풀 크기로 클램프.
export function pickRunUpgrades(n = 3) {
  const pool = [...RUN_UPGRADES];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
