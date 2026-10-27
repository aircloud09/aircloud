import type { TranslationKey } from "./en";

const ko: Record<TranslationKey, string> = {
  // Header Controls
  "header.settings": "설정",

  // Modals
  "modal.close": "닫기",

  // Settings
  "settings.title": "설정",
  "settings.sessionBehavior": "세션 동작",
  "settings.autoFollow": "새 세션 자동으로 따라가기",
  "settings.autoFollowDesc":
    "같은 프로젝트에서 새 세션이 시작되면 자동으로 전환해요",
  "settings.floorTogether": "같은 층 세션 함께 보기",
  "settings.floorTogetherDesc":
    "같은 층에서 일하는 다른 세션의 Claude 도 사무실에 함께 나와요. 끄면 고른 세션만 보여요",
  "settings.language": "언어",
  "settings.theme": "테마",
  "settings.theme.light": "밝게",
  "settings.theme.dark": "어둡게",
  "settings.tabs.general": "일반",
  "settings.tabs.connect": "연결",
  "settings.connect.intro":
    "버튼을 누르면 이 컴퓨터에서 연결 명령을 대신 실행해요. 다른 설정은 그대로 두고 Agent Office 훅만 더해요.",
  "settings.connect.connected": "연결됨",
  "settings.connect.notConnected": "연결 안 됨",
  "settings.connect.connect": "연결",
  "settings.connect.reconnect": "다시 연결",
  "settings.connect.disconnect": "해제",
  "settings.connect.running": "실행 중…",
  "settings.connect.done": "완료했어요.",
  "settings.connect.failed": "실패했어요. 아래 출력을 확인해 주세요.",
  "settings.connect.output": "출력 · {command}",
  "settings.connect.cliMissing": "이 컴퓨터에서 {cli} 명령을 찾지 못했어요.",
  "settings.connect.toolMissing":
    "훅 도구가 보이지 않아요. 다시 연결해 주세요.",
  "settings.connect.afterClaude":
    "지금부터 여는 Claude Code 세션이 사무실에 나타나요.",
  "settings.connect.afterCodex":
    "Codex에서 /hooks 를 열어 Agent Office 훅을 신뢰해야 동작해요.",
  "settings.connect.afterGemini":
    "지금부터 여는 Gemini CLI 세션이 사무실에 나타나요.",
  "settings.connect.needToken":
    "연결하려면 백엔드 터미널에 찍힌 「Agent Office: http://localhost:4747/?token=…」 주소로 이 화면을 열어 주세요.",
  "settings.connect.notLocal":
    "이 백엔드는 다른 컴퓨터에서도 접속할 수 있게 떠 있어서(Docker 등) 연결할 수 없어요. 터미널에서 make hooks-install 을 실행해 주세요.",
  "settings.connect.cannotRun":
    "이 백엔드에서는 연결 명령을 실행할 수 없어요({reason}). 저장소 폴더에서 터미널로 make hooks-install 을 실행해 주세요.",
  "settings.connect.busy": "다른 연결 작업이 아직 진행 중이에요.",
  "settings.connect.loadFailed":
    "연결 상태를 불러오지 못했어요. 백엔드가 떠 있는지 확인해 주세요.",

  // Agent Status
  "agentStatus.inQueue": "{queueType} 대기열 {position}번째",

  // Office rooms
  "office.unknownAgent": "에이전트",

  // Isometric office
  "iso.live": "LIVE",
  "iso.offline": "오프라인",
  "iso.controlsHint": "드래그로 이동 · 휠로 확대 · 더블클릭으로 원위치",
  "iso.me": "나",
  "iso.agentType.general": "범용",
  "iso.bubble.thinking": "고민 중",
  "iso.bubble.thinkingFor": "{seconds}s째 고민 중",
  "iso.bubble.looking": "살펴보는 중",
  "iso.bubble.bye": "👋 퇴근합니다!",
  "iso.bubble.compacting": "☕ 대화 정리 중",
  "iso.panel.project": "프로젝트",
  "iso.panel.session": "세션",
  "iso.panel.people": "사무실",
  "iso.panel.atWork": "{count}명 근무 중",
  "iso.panel.working": "작업 중",
  "iso.panel.tools": "도구 {count}회 · {seconds}s",
  "iso.panel.tools_one": "도구 {count}회 · {seconds}s",
  "iso.panel.colleague": "같은 층 다른 세션 · {seconds}s",
  "iso.panel.tools_other": "도구 {count}회 · {seconds}s",
  "iso.panel.log": "활동 로그",
  "iso.panel.logTime": "{h}시 {m}분 {s}초",
  "iso.panel.rooms": "사무실 안내도",
  "iso.room.library": "자료실",
  "iso.room.dev": "개발실",
  "iso.room.server": "서버실",
  "iso.room.search": "정보검색실",
  "iso.room.meeting": "회의실",
  "iso.room.mydesk": "내 자리",
  "iso.room.lounge": "라운지",
  "iso.room.cafe": "카페",
  "iso.room.elevator": "엘리베이터",
  "iso.roomDoes.library": "파일 읽기 · 검색",
  "iso.roomDoes.dev": "코드 작성 · 수정",
  "iso.roomDoes.server": "명령 실행 · git",
  "iso.roomDoes.search": "웹 · 외부 도구",
  "iso.roomDoes.meeting": "계획 · 할 일 · 스킬",
  "iso.roomDoes.mydesk": "질문 · 에이전트 호출",
  "iso.roomDoes.lounge": "쉬기 · 다음 질문 기다리기",
  "iso.roomDoes.cafe": "퇴근 전 · 대화 정리 중 커피",
  "iso.roomDoes.elevator": "서브에이전트 출퇴근",
  "iso.floor.title": "층별 안내",
  "iso.connect.empty": "아직 아무도 출근하지 않았어요.",
  "iso.connect.cta": "에이전트 연결",
  "iso.floor.caption": "FLOOR GUIDE",
  "iso.floor.sessions": "세션 {count}개",
  "iso.floor.sessions_one": "세션 {count}개",
  "iso.floor.sessions_other": "세션 {count}개",
  "iso.floor.activeNow": "지금 활동 중",
  "iso.floor.follow": "최근 세션 자동으로 따라가기",
  "iso.floor.together": "같은 층 세션 함께 보기",
  "iso.floor.untitled": "제목 없는 세션 · {id}",
  "iso.floor.moreIdle": "오래 쉰 층 {count}개 더 보기",
  "iso.floor.moreIdle_one": "오래 쉰 층 {count}개 더 보기",
  "iso.floor.moreIdle_other": "오래 쉰 층 {count}개 더 보기",
  "iso.floor.lessIdle": "접기",

  // Zoom Controls
  "zoom.in": "확대",
  "zoom.out": "축소",
  "zoom.reset": "원래 크기",

  // Status Messages
  "status.switchedToSession": "세션 {sessionId}(으)로 전환하는 중...",
  "status.deletingSession": "세션 {sessionId} 삭제하는 중...",
  "status.sessionDeleted": "세션을 삭제했어요.",
  "status.failedDeleteSession": "세션을 삭제하지 못했어요.",
  "status.errorConnecting": "백엔드에 연결하지 못했어요.",
  "status.sessionRenamed": "세션 이름을 바꿨어요.",
  "status.failedRenameSession": "세션 이름을 바꾸지 못했어요.",
  "status.clearingDatabase": "데이터베이스 비우는 중...",
  "status.databaseCleared": "데이터베이스를 비웠어요.",
  "status.failedClearDatabase": "데이터베이스를 비우지 못했어요.",
  "status.triggeringSimulation": "시뮬레이션 시작하는 중...",
  "status.simulationStarted": "시뮬레이션을 시작했어요!",
  "status.failedSimulation": "시뮬레이션을 시작하지 못했어요.",
  "status.storeReset": "화면 상태를 초기화했어요.",
  "status.sessionDeletedSwitched":
    "세션을 삭제했어요. {sessionName}(으)로 전환했어요",
  "status.sessionDeletedNoOthers": "세션을 삭제했어요. 다른 세션이 없어요.",
  "status.connectedTo": "{sessionName}에 연결했어요",
  "status.autoFollowed": "새 세션을 따라갔어요: {sessionName}",
};

export default ko;
