// prefers-reduced-motion 존중 — 연출은 살리되 모션 민감 사용자에겐 정적 폴백.
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
