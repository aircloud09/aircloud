# 00a · 저장소 이름 agent-office · 에이전트 범위

- 브랜치: `docs/00a-agent-office`
- 근거: [근거 문서](../plan/spec.md) 「에이전트 범위」

## 목표

Claude Code 에만 묶이지 않게 저장소 이름을 `agent-office` 로 바꾸고, 다른 코딩 에이전트도 같은 사무실 동작을 갖도록 계획에 넣는다.

## 한 일

- GitHub 저장소 이름을 `heejunKIM01/claude-office` → `heejunKIM01/agent-office` 로 바꿨다. 옛 주소는 GitHub 가 넘겨준다.
- 근거 문서에 「에이전트 범위」 절을 더했다. Claude Code · OpenCode · Gemini CLI · Codex CLI 의 읽기 · 명령 도구 이름과 이벤트 수단을 표로 정리했다.
- 작업 분할에 08 에이전트 이름 · 09 Gemini CLI 연동 · 10 Codex CLI 연동을 넣고 통합 QA 를 11 로 미뤘다.
- README 포크 안내를 새 이름과 목표로 고쳤다.

## 검증

| 단계 | 명령 · 방법 | 결과 |
| --- | --- | --- |
| 정적 검증 | `make checkall` | 통과 |
| 실검증 | 해당 없음 — 문서만 바뀌었다 | — |

## 검증하지 못한 것

- Codex CLI 의 읽기 도구 이름 — 원본 조사(2026-04)에는 셸 도구만 훅에 잡힌다. 10 에서 현재 문서로 다시 확인한다.

## 다음 작업

01 `feat/01-office-rooms` — 자료실 · 서버실 방.
