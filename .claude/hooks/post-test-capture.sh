#!/usr/bin/env bash
# post-test-capture.sh — PostToolUse 훅 (Bash 매처).
# 테스트/빌드 명령 실행 직후 stdout/stderr 의 끝 40줄을
# .jiwon-team/last-test-output.txt 에 적재.
# team-lead 의 "완료 검증" 게이트가 이 파일을 증거로 읽는다 — "빌드/테스트 통과했다"를
# 말로 단언하기 전에 실제 결과가 남도록.
#
# 입력: stdin 으로 JSON (tool_input.command, tool_response.stdout/stderr 등)
# 출력: 항상 종료코드 0 (관찰만, 차단 X). python3 없으면 조용히 종료.

set -u

command -v python3 >/dev/null 2>&1 || exit 0

REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO" 2>/dev/null || exit 0

INPUT="$(cat)"

CMD="$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("command",""))
except Exception:
    pass' 2>/dev/null || echo "")"

# 테스트/빌드 명령인지 (간단 휴리스틱)
case "$CMD" in
  *"npm test"*|*"npm run test"*|*"npm run build"*|*"pnpm test"*|*"pnpm build"*|*"yarn test"*|*"yarn build"*|*"vitest"*|*"jest"*|*"playwright"*|*"vite build"*|*"next build"*|*"astro build"*|*"tsc"*|*"pytest"*|*"go test"*|*"cargo test"*)
    ;;
  *)
    exit 0
    ;;
esac

mkdir -p "$REPO/.jiwon-team" 2>/dev/null || exit 0
OUT_FILE="$REPO/.jiwon-team/last-test-output.txt"

{
  echo "=== 마지막 테스트/빌드 — $(date '+%Y-%m-%d %H:%M:%S') ==="
  echo "명령: $CMD"
  echo ""
  echo "--- stdout (마지막 40줄) ---"
  printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get("tool_response",d.get("tool_result",{}))
    print(r.get("stdout","") if isinstance(r,dict) else "")
except Exception:
    pass' 2>/dev/null | tail -40
  echo ""
  echo "--- stderr (마지막 40줄) ---"
  printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get("tool_response",d.get("tool_result",{}))
    print(r.get("stderr","") if isinstance(r,dict) else "")
except Exception:
    pass' 2>/dev/null | tail -40
} > "$OUT_FILE" 2>/dev/null

exit 0
