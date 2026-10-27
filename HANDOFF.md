# HANDOFF — Agent Office for Claude Code (Windows)

Claude Code 작업을 3D(아이소메트릭) 사무실로 보여준다.
[heejunKIM01/agent-office](https://github.com/heejunKIM01/agent-office) @ `f8644e5`
(paulrobello/claude-office의 three.js 포크)를 레포 루트에 그대로 가져온 뒤, 런처와 훅을 추가했다.
기존 `lora_crawler/`는 이 작업과 무관하며 손대지 않았다.

## 1. 라이선스

| 대상 | 라이선스 | 비고 |
|---|---|---|
| 전체 소스 (`LICENSE`) | MIT, © 2026 Paul Robello | 파일 원본 유지. 재배포 시 저작권/허가 문구 포함 필수 |
| 3D 모델 | 없음 | 사무실·캐릭터·텍스처 모두 three.js 코드로 생성 (`frontend/src/components/iso/`) |
| 폰트 Geist / Geist Mono | SIL OFL 1.1 (Vercel) | `next/font/google`로 **빌드 시** 내려받음 → 빌드에 인터넷 필요 |
| `frontend/public/*.svg` | MIT (create-next-app 기본 아이콘) | |

## 2. 구조

```
aircloud/
├─ backend/            FastAPI (:8000) — 이벤트 수신, 상태머신, WebSocket
├─ frontend/           Next.js 정적 export → frontend/out (:4747에서 서빙)
│  └─ src/app/page.tsx       ?kiosk=1 → 사무실만 표시 + 모든 프로젝트의 새 세션 자동 추적
├─ hooks/              claude-office-hook (Claude Code 이벤트 → POST /api/v1/events)
│  └─ manage_hooks.py        settings.json 병합 (절대경로, 기존 hook 보존, 런처 SessionStart 추가)
├─ launcher/
│  ├─ agent_office.py        hook / ensure / stop / status (표준 라이브러리만 사용)
│  ├─ static_server.py       frontend/out 정적 서버 (Windows .js MIME 문제 회피)
│  ├─ install.py             사전요구 확인 → 설치 → 빌드 → hook 등록 (--uninstall 지원)
│  └─ e2e/                   테스트 도구 (가짜 chrome, hook 실행기, Playwright 관찰기)
├─ install.cmd / uninstall.cmd
└─ office-start.cmd / office-stop.cmd / office-status.cmd
```

### 동작 흐름

```
Claude Code 세션 시작 (CLI 또는 데스크톱 앱 Code 탭)
 └─ SessionStart hook: pythonw.exe agent_office.py hook || exit 0
      └─ ensure를 분리 프로세스로 띄우고 즉시 exit 0   (측정: ~0.06초)
           ensure:
             1) 락 획득 (~/.agent-office/run/ensure.lock, O_EXCL) — 실패 시 종료
             2) GET :8000/health + GET :4747/ → 둘 다 OK면 아무것도 안 함
             3) 꺼진 쪽만 백그라운드 실행 (로그: ~/.agent-office/logs/*.log)
             4) 둘 다 응답할 때까지 대기 (최대 90초)
             5) 창 1개: Chrome → Edge 순서로 --app=http://127.0.0.1:4747/?kiosk=1
                (전용 프로필 ~/.agent-office/browser-profile). 둘 다 없으면 기본 브라우저
이후 모든 hook 이벤트 → claude-office-hook → backend → WebSocket → 캐릭터 이동
```

- 첫 세션의 `session_start`는 서버가 뜨기 전에 보내져 유실되지만, 백엔드가 다음 이벤트에서 세션을 자동 복구한다(테스트로 확인).
- 토큰 0: 런처가 백엔드를 `SUMMARY_BACKEND=template`, `SUMMARY_ENABLED=false`, `CLAUDE_CODE_OAUTH_TOKEN=`(빈 값)로 실행하고, `ANTHROPIC_*` 환경변수는 넘기지 않는다. `install`이 `backend/.env`에도 같은 값을 쓴다. 원본 기본값(`claude-cli`)은 말풍선·이름을 만들 때마다 `claude -p`(Haiku)를 따로 실행해 계정 사용량을 썼다.
- 템플릿 모드(`backend/app/core/summary_service.py`의 `template`)는 모델 없이 세션에 이미 있는 값을 끼워 넣는다.

  | 항목 | 문구 |
  |---|---|
  | 내 질문 | `{질문 첫 줄, 최대 60자}` |
  | 답변 끝 (보스 말풍선) | `✅ {질문 첫 줄} 완료` |
  | 서브에이전트 이름/라벨 | `{Agent 도구의 description}` → 화면에는 `Explore · 인증 코드 찾기` |
  | 서브에이전트 끝 | `✅ {description} 완료` |
- `127.0.0.1` 사용: Windows에서 `localhost`는 `::1`을 먼저 시도해 hook이 느려질 수 있어서다. 프론트 빌드에 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`을 넣는다.

## 3. 설치 (Windows)

사전 요구사항 확인 (PowerShell):

```powershell
uv --version      # 없으면: winget install --id=astral-sh.uv -e
node --version    # v20 이상. 없으면: winget install OpenJS.NodeJS.LTS
git --version     # Claude Code가 hook 실행에 Git Bash 사용
```

Python 3.13은 따로 설치하지 않아도 된다(uv가 받아서 씀). 설치 후에는 **새 터미널**을 연다.

```powershell
git clone -b feat/agent-office-launcher https://github.com/aircloud09/aircloud.git
cd aircloud
.\install.cmd            # 사전요구 확인만: .\install.cmd --check
```

설치가 끝나면 Claude Code CLI와 데스크톱 앱을 **재시작**한다.
레포 폴더를 옮기면 hook 경로가 바뀌므로 `install.cmd`를 다시 실행해야 한다.

## 4. 실행 / 종료

| 동작 | 방법 |
|---|---|
| 자동 실행 | Claude Code 세션 시작 (서버가 꺼져 있을 때만 켜고 창 1번) |
| 수동 실행 + 창 열기 | `office-start.cmd` (이미 켜져 있어도 창을 연다. 창을 닫은 뒤 다시 볼 때 사용) |
| 종료 (서버 2개 + 사무실 창) | `office-stop.cmd` |
| 상태 | `office-status.cmd` |
| 로그 | `%USERPROFILE%\.agent-office\logs\` (launcher / backend / frontend / browser) |
| 제거 | `uninstall.cmd` (우리 hook만 제거, 다른 hook은 유지) |

## 5. 설치되는 hook (`%USERPROFILE%\.claude\settings.json`)

기존 항목은 그대로 두고 병합한다. 처음 수정할 때 `settings.json.bak` 백업을 만든다.
경로는 모두 절대경로이고 `/` 구분자를 쓴다. 공백이 있으면 따옴표로 감싼다.

| 이벤트 | 명령 |
|---|---|
| SessionStart | `<repo>/backend/.venv/Scripts/pythonw.exe <repo>/launcher/agent_office.py hook \|\| exit 0` (timeout 5) |
| SessionStart, SessionEnd, UserPromptSubmit, Stop, PreCompact | `<uv bin>/claude-office-hook.exe <event>` (timeout 2) |
| PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart, SubagentStop | 위와 같음, `matcher: ".*"` |

- `<uv bin>`은 `uv tool dir --bin`이고, 보통 `%USERPROFILE%\.local\bin`이다.
- 설정 파일은 `%USERPROFILE%\.claude\claude-office-config.env`(API URL, 프로젝트명 접두사)다.

## 6. 테스트 결과

이 클라우드 컨테이너(Linux, 화면 없음)에서 격리된 HOME으로 실행했다.
hook은 settings.json에 등록된 명령을 Claude Code와 같은 방식(셸 + stdin JSON)으로 호출했다.

| 항목 | 결과 |
|---|---|
| 서버 꺼진 상태에서 SessionStart 3개 동시 호출 | 서버 기동, **창 1번** (가짜 chrome 호출 기록 1줄) |
| 이어서 세션 6개 추가 시작 (2라운드) | 창 추가 없음, 로그 `office already running` |
| hook 소요 시간 | 런처 hook ~0.06초, claude-office-hook ~0.1초, 모두 exit 0 |
| 인터프리터가 없는 경우 | `\|\| exit 0`으로 exit 0 |
| 템플릿 문구 (prompt → Agent 서브에이전트 → Stop) | 보스 `✅ README.md 읽고 요약해줘 완료`, 서브에이전트 `인증 코드 찾기` → `✅ 인증 코드 찾기 완료`, 모델 호출 없음 |
| 작업 이벤트 (prompt → Read/Bash/Edit → Stop) | WebSocket으로 `working ↔ idle → completing` 수신. 스크린샷에서 캐릭터가 이동하고, 끝나면 라운지 소파로 감 |
| kiosk 화면 | 사이드패널·헤더·툴바 없음 (줌 버튼만 남음) |
| `stop` | 백엔드·프론트·창 프로세스 종료, 포트 해제 |
| `install` 재실행 / `uninstall` | 재실행 시 13개 모두 Skip(중복 없음). 제거 후 사용자 hook과 설정이 원본과 동일 |
| 기존 테스트 | backend pytest 523 통과(템플릿 테스트 포함), hooks pytest 114 통과, frontend vitest 309 통과, tsc/eslint 통과 |

재현 방법: `launcher/e2e/`의 `fire_hooks.py`(hook 호출), `fakebin/chrome`(창 기록), `watch_office.js`(Playwright 관찰).

## 7. 남은 할 일 / 주의

- [ ] **Windows 실기 검증 필요**: 이 세션에서는 Windows를 실행할 수 없었다. 확인할 항목:
  - `pythonw.exe` 분리 실행. `CREATE_BREAKAWAY_FROM_JOB`이 거부되면 해당 플래그 없이 재시도한다.
  - Chrome/Edge 경로 탐색 (Program Files, LOCALAPPDATA, 레지스트리 App Paths)
  - `taskkill /T` 종료, `netstat -ano` 포트 탐색
  - Git Bash로 hook 실행 시 `C:/...` 경로가 제대로 처리되는지
  - 데스크톱 앱 Code 탭에서 SessionStart 동작
- [ ] 창을 닫은 상태에서 서버가 켜져 있으면 새 세션에서 창이 다시 뜨지 않는다(요구사항대로). 다시 볼 때는 `office-start.cmd`를 쓴다.
- [ ] 포트 8000/4747은 고정이다. 다른 프로그램이 점유하면 시작에 실패하고 `logs/backend.log`·`frontend.log`에 기록된다.
- [ ] `git pull`로 프론트가 바뀌면 `install.cmd`를 다시 실행해 빌드한다. `--skip-build`는 기존 빌드를 재사용한다.
- [ ] 서버가 꺼져 있는 동안 claude-office-hook 이벤트는 버려진다(전송 timeout 0.5초, 무해).
- [ ] 원본 포크를 업데이트하려면 upstream을 받아 이 레포에 병합한다. 수정 지점: `frontend/src/app/page.tsx`, `frontend/src/hooks/useSessions.ts`, `hooks/manage_hooks.py`, 템플릿 모드(`backend/app/core/summary_service.py`, `handlers/agent_handler.py`, `handlers/conversation_handler.py`, `state_machine.py`의 `_handle_stop`, `tests/conftest.py`).
