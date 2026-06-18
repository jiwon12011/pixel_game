// prefers-reduced-motion 존중 — 연출은 살리되 모션 민감 사용자에겐 정적 폴백.
// OS 미디어쿼리 + 사용자 토글(localStorage)을 OR로 합친다. 둘 중 하나라도 '줄여라'면 줄인다.
// 기존 호출부는 prefersReducedMotion() 그대로 쓰고, 설정 UI가 setReduceMotion으로 토글을 얹는다.

const isBrowser = typeof window !== 'undefined';
const STORAGE_KEY = 'ls_reducemotion'; // '1' = 사용자 강제 감소, '0'/없음 = OS 설정만 따름

// OS 단계 — matchMedia가 reduce를 가리키는지.
function osReducedMotion() {
  return (
    isBrowser &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// 사용자 토글 — localStorage에 '1'로 저장돼 있으면 OS와 무관하게 감소.
export function getReduceMotion() {
  if (!isBrowser) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

// 사용자 토글 설정 — true면 '1', false면 '0'으로 저장.
export function setReduceMotion(bool) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(STORAGE_KEY, bool ? '1' : '0');
  } catch {
    /* 저장 실패 무시 — 세션 내에선 getReduceMotion이 다시 읽으므로 영속만 실패 */
  }
}

// 최종 판정 — OS 설정 OR 사용자 토글. 어느 쪽이든 reduce면 정적 폴백을 쓴다.
export function prefersReducedMotion() {
  return osReducedMotion() || getReduceMotion();
}
