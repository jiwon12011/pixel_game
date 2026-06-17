import { defineConfig } from 'vite';

// 정적 호스팅(PWA/서브경로 배포)에서도 깨지지 않도록 상대 경로 기준.
// 에셋은 src/assets/manifest.js에서 `import ... from '.png'` (URL import)로 끌어오므로
// vite가 해시 처리해 dist로 자동 복사한다 — 빌드 시 누락/경로 문제 없음.
export default defineConfig({
  base: './',
  server: {
    host: true,
    open: false
  },
  build: {
    target: 'es2019',
    assetsInlineLimit: 0 // 큰 PNG는 인라인하지 않고 파일로 유지
  }
});
