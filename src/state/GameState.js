// 공유 게임 상태 — 전투 씬과 허브 씬이 같은 단일 객체를 본다.
// Phaser는 Combat/Hub를 병렬 씬으로 돌리므로(씬 간 직접 참조 X) 이 싱글톤이 둘의 다리.
// 의존성 0의 plain JS 객체 + 아주 얇은 이벤트(emit/on) 한 겹. Redux류 금지(스펙).
//
// 이벤트:
//   'change' — 자원/스탯/장비 무엇이든 바뀌면 발행. HUD·허브가 구독해 표시 갱신.
//   'drop'   — 전투 드롭이 들어올 때만. payload = { coins, SCRAP, ELEC, POWDER, x, y }.
//              CombatScene이 줍기 연출·토스트에 쓴다(어떤 자원이 떨어졌는지 알아야 함).
//   'stats'  — 능력치가 업그레이드됐을 때. CombatScene이 maxHP 증가분을 현재 전투에 반영.

const PARTS = ['SCRAP', 'ELEC', 'POWDER'];

const STORAGE_KEY = 'last-salvage:save:v1';

const listeners = new Map(); // event -> Set<fn>

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // 복사 후 순회 — 콜백이 off()를 불러도 안전
  for (const fn of [...set]) fn(payload);
}

const GameState = {
  // ── 자원/스탯/장비 ──────────────────────────────────────────────────
  coins: 0,
  parts: { SCRAP: 0, ELEC: 0, POWDER: 0 }, // 범용/전기/화약 — 레시피가 이 키로 소비
  stats: { maxHP: 100, atk: 20, def: 0 }, // 현재 능력치(베이스 + 업그레이드 누적)
  statLevels: { maxHP: 0, atk: 0, def: 0 }, // 구매 레벨(비용 곡선 계산용)
  ownedWeapons: new Set(['pipe_wrench']),
  equippedWeapon: 'pipe_wrench',

  // ── 이벤트 ──────────────────────────────────────────────────────────
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  emit, // 외부에서 직접 발행할 일은 거의 없지만 노출

  // ── 드롭 가산 (전투에서 호출) ────────────────────────────────────────
  // delta = { coins, SCRAP, ELEC, POWDER } 중 들어온 것만. x,y는 줍기 연출용 좌표.
  applyDrop(delta, x, y) {
    if (delta.coins) this.coins += delta.coins;
    for (const p of PARTS) if (delta[p]) this.parts[p] += delta[p];
    this.save();
    emit('drop', { ...delta, x, y });
    emit('change');
  },

  // ── 능력치 업그레이드 ────────────────────────────────────────────────
  // 성공 시 코인 차감 + 스탯 적용 + 레벨++ → true. 실패(코인부족/캡) → false.
  buyStatUpgrade(stat, cost, increment, maxLevel) {
    if (maxLevel != null && this.statLevels[stat] >= maxLevel) return false;
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.statLevels[stat] += 1;
    this.stats[stat] += increment;
    this.save();
    emit('stats', { stat, increment });
    emit('change');
    return true;
  },

  // ── 합성 ─────────────────────────────────────────────────────────────
  canAfford(cost) {
    for (const p of PARTS) if ((cost?.[p] || 0) > this.parts[p]) return false;
    return true;
  },
  craftWeapon(weaponId, cost) {
    if (this.ownedWeapons.has(weaponId)) return false;
    if (!this.canAfford(cost)) return false;
    for (const p of PARTS) if (cost?.[p]) this.parts[p] -= cost[p];
    this.ownedWeapons.add(weaponId);
    this.save();
    emit('change');
    return true;
  },
  equipWeapon(weaponId) {
    if (!this.ownedWeapons.has(weaponId)) return false;
    if (this.equippedWeapon === weaponId) return false;
    this.equippedWeapon = weaponId;
    this.save();
    emit('change');
    return true;
  },

  // ── localStorage (가벼운 보너스 저장) ────────────────────────────────
  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          coins: this.coins,
          parts: this.parts,
          stats: this.stats,
          statLevels: this.statLevels,
          ownedWeapons: [...this.ownedWeapons],
          equippedWeapon: this.equippedWeapon
        })
      );
    } catch {
      /* 비공개 모드/용량초과 — 저장 실패해도 게임 진행은 계속 */
    }
  },
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.coins = d.coins ?? this.coins;
      this.parts = { SCRAP: 0, ELEC: 0, POWDER: 0, ...(d.parts || {}) };
      this.stats = { ...this.stats, ...(d.stats || {}) };
      this.statLevels = { ...this.statLevels, ...(d.statLevels || {}) };
      if (Array.isArray(d.ownedWeapons)) this.ownedWeapons = new Set(d.ownedWeapons);
      this.ownedWeapons.add('pipe_wrench'); // 기본 무기는 항상 보유
      this.equippedWeapon = d.equippedWeapon ?? this.equippedWeapon;
    } catch {
      /* 손상된 세이브 — 기본값으로 진행 */
    }
  }
};

export default GameState;
