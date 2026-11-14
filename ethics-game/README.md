# 윤리 퀘스트

게임을 하면서 「현대사회와 윤리」를 공부하는 모바일 웹 게임입니다. 3D 게임 3종이 같은 문제 은행과 학습 기록을 함께 씁니다.

| 게임 | 방식 |
|---|---|
| 지식 러너 | 좌우 스와이프로 레인 이동, 위로 점프, 아래로 슬라이드. 수레·경사로(지붕 위 달리기)·마주 오는 수레·막대 장애물을 피하며 코인을 모읍니다. 정답 색깔의 게이트를 통과해 답합니다 |
| 개념 슬래시 | 튀어 오르는 물건을 손가락으로 그어서 벱니다. 놓치면 체력이 깎이고, 폭탄은 베면 안 됩니다. 정답 구슬을 베어 답합니다 |
| 논쟁 배틀 | 손가락을 끌어 상대의 불덩이를 피합니다. 정답 구슬이 도착할 때 그 줄에 서서 받아치면 상대를 공격합니다 |

문제가 나오면 게임이 멈추고 문제 전체를 보여 줍니다. 시간 제한 없이 읽고 **Ready!**를 누르면 게임이 다시 움직이며 정답 게이트·구슬이 나옵니다.

세 게임 모두 6가지 문제 유형(O/X, 객관식, 모두 고르기, 분류, 순서, 제시문)을 냅니다.

## 실행

```bash
node dev-server.mjs      # http://localhost:8787 (랭킹은 메모리에만 저장되는 흉내 서버)
```

## Netlify 배포

1. Netlify에서 이 저장소를 연결합니다.
2. **Base directory**를 `ethics-game`으로 지정합니다. 나머지는 `netlify.toml`이 설정합니다(빌드 명령 없음, 게시 폴더 `public`).
3. 랭킹과 문제 신고는 Netlify Functions + Netlify Blobs를 쓰므로 별도 DB 설정이 필요 없습니다.
   - 신고 내용: Netlify 대시보드 → Blobs → `question-reports`

## 문제 추가

- 문제는 `public/questions/*.json`에 있고, 파일 목록은 `public/questions/index.json`에 적습니다.
- 추가한 뒤 `npm run check`로 형식·정답 범위·중복·글자 수를 검사합니다.

| 유형 | 필수 항목 |
|---|---|
| `ox` | `stem`, `answer`(true/false) |
| `choice` | `stem`, `options`(2~4개), `answer`(정답 번호, 0부터) |
| `multi` | `stem`, `items: [{ text, correct }]` |
| `classify` | `stem`, `buckets`(2~4개), `items: [{ text, bucket }]` |
| `order` | `stem`, `items`(올바른 순서대로 3~4개) |
| `passage` | `passage`, `who: { options, answer }`, `then: { stem, options, answer }` |

공통 항목: `id`, `unit`, `tags`, `level`(1~5), `type`, `explanation`

## 학습 규칙

- **난이도**: 정답이면 +0.1, 오답이면 −0.3으로 레벨을 조절해 정답률이 약 75%가 되게 맞춥니다. 설정에서 레벨을 고정할 수도 있습니다.
- **복습**: 틀린 문제는 3~5문제 뒤에 다시 나오고, 맞힐 때마다 20 → 60 → 150 → 300 → 500문제 간격으로 늘어납니다. 500문제 간격은 계속 유지됩니다. 복습 문제는 한 판의 최대 20%입니다.
- **반복 방지**: 문제 은행을 한 바퀴 다 풀기 전에는 같은 문제를 새 문제로 내지 않습니다.
- **랭킹**: 맞힌 문제 수(누적), 푼 문제 수(누적), 게임별 한 판 최고 점수(러너 코인, 슬래시로 벤 물건, 배틀에서 입힌 피해)를 항목별로 봅니다. 기록은 기기에 저장됩니다.

## 폴더 구조

```
public/            게시되는 정적 파일
  js/core.js       저장, 출제(난이도·복습), 랭킹 통신
  js/engine.js     3D 엔진(품질 단계, 캐릭터, 파티클, 효과음)
  js/runner.js     지식 러너
  js/slash.js      개념 슬래시
  js/battle.js     논쟁 배틀
  questions/       문제 은행
  assets/          3D 모델, 글꼴
  vendor/          three.js 묶음 파일
netlify/functions/ 랭킹(rank), 문제 신고(report)
tools/             문제 검사 도구
```

## 사용한 외부 자료

- 3D 모델: [KayKit](https://kaylousberg.itch.io/) Adventurers, Medieval Hexagon Pack, Dungeon Remastered(코인) (CC0)
- 글꼴: 주아체 (SIL Open Font License)
- 3D 라이브러리: three.js (MIT)

## 테스트용 주소 옵션

`?play=runner|slash|battle` 바로 시작 · `?type=ox|choice|multi|classify|order|passage` 유형 고정 · `?lv=1~5` 레벨 고정 · `?q=high|mid|low` 그래픽 고정 · `?god` 장애물·불덩이 무시 · `?auto` 배틀 자동 정답
