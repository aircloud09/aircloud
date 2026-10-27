# 50 · `/clear` 해도 세션 수가 늘지 않게

- 브랜치: `fix/50-clear-keeps-session-count`
- 근거: 사용자 질문 — 「지금 실제로 이렇게많나? 왜이렇게 세셔닝많지」(likey-web 층 세션 21개), 「clear해서 세션 늘어나는건 막았으면좋겠음」

## 목표

`/clear` 는 같은 터미널을 새 세션 ID 로 이어 간다. 그래서 `/clear` 할 때마다 층별 안내에 세션이 하나씩 늘었다. 이 증가를 막는다.

## 한 일

- 세션 목록이 끝난 이유(`session_end` 의 `reason`)가 `clear` 인 세션을 뺀다(`backend/app/api/routes/sessions.py`). 이어지는 새 세션만 남아서 터미널 하나가 한 줄로 보인다.
- 뺀 세션을 `claude --resume` 으로 다시 열면 `session_start` 가 저장된 이벤트를 지우면서 `clear` 기록도 사라진다. 그래서 목록에 다시 나온다.
- 보던 세션이 목록에서 빠져도 자동 따라가기가 그 세션의 프로젝트를 기억한다(`frontend/src/hooks/useSessions.ts`). 그래서 같은 프로젝트의 새 세션으로 옮겨 간다. 전에는 보던 세션을 목록에서 못 찾으면 따라가기를 건너뛰었다.

## 검증

| 단계 | 명령 · 방법 | 결과 |
| --- | --- | --- |
| 정적 검증 | `make checkall` | 린트 · 백엔드 타입 통과. 백엔드 499 · 프런트 286 통과. 프런트 타입체크는 dev 서버가 남긴 `.next/types/validator.ts` 4건(이미 지운 `classic` · `sprite-debug` 페이지)에서만 실패했고 `src` 오류는 0이다 |
| 시험 추가 | `backend/tests/test_api.py` | `/clear` 로 끝난 세션은 빠지고 다른 이유로 끝난 세션은 남는다. 다시 연 세션은 돌아온다 |
| 실검증 | 사용자가 띄워 둔 백엔드(8000, 핫 리로드)의 `GET /api/v1/sessions` | likey-web 층 21개 → 12개. 빠진 세션은 모두 `reason: clear` 로 끝난 세션이었다 |

자동 따라가기 변경은 브라우저로 확인하지 않았다.
