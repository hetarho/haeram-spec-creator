---
name: start-vibe
description: >-
  작업의 진입점. "/start-vibe, 작업 시작하자, 이어서 해줘, 남은 거 해줘, 나 나갈게 알아서 해줘" 일 때 사용.
  STATE와 원격을 읽어 다른 기기의 진행을 확인하고, 시작할 때 한 번에 묻는다(모드: 함께=내가 결정 / 맡김=묻지 않고
  추천안으로 진행). 그 뒤 기획(create-ssot·update-ssot·create-task)과 구현(implement-task)을 스스로 골라 진행하고
  작업 단위마다 커밋·push한다. 맡김이면 결정함(STATE inbox)과 보고서를 남긴다. 아이디어를 쏟아내는 일은 ideation.
---

# start-vibe — 작업 진행자

**역할: 진행자.** 다음에 할 일을 고르고(라우팅) 모드·push·진행 표시·결정함·보고서를 지킨다. 기획·기술 판단은 하지 않는다 — 고른 스킬이 자기 역할로 한다. 스킬 절차를 여기서 다시 쓰지 않는다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. (이 스킬 예외: 없으면 create-architecture로 보낸다.)
2. **문서 먼저**: 쓰기 전에 `npx haeram-spec-creator work status --json`으로 배정을 확인한다(CLI가 없으면 Git checkout과 사용자의 배정을 확인). 단독/기획 공간에서는 STATE에 시작과 상태 변화를 기록한다. 작업 묶음의 워커는 STATE·SSOT를 수정하지 않고 실행 상태를 CLI로 기록하며, 자신의 태스크 acceptance·result만 갱신한다. 리뷰 공간에서는 코드·spec을 수정하지 않고 리뷰 runtime만 갱신한다. 브랜치명은 소유권 근거가 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용. 맡김 모드(start-vibe)에서는 묻지 않는다 — 추천안으로 진행하고 STATE inbox와 보고서에 남긴다(되돌리기 어렵거나 프로젝트 밖에 영향을 주는 일은 주차). 모드가 정해지지 않았으면 함께 모드다.
5. **읽기**(FORMAT Reading): 한 번에 한 문서씩, 큰 문서는 섹션 단위로 읽는다. 마지막 섹션(ssot=`## chg`, task=`## result`)이 안 보이면 출력이 잘린 것이다 — 누락 범위를 다시 읽고 나서 판단한다. tasks/done/은 역사 기록이라 일괄로 읽지 않고, 특정 태스크·회귀 원인·이전 검증을 찾을 때만 연다.

아래 `vibe ...`·`work ...`는 `npx haeram-spec-creator vibe|work ...`의 축약이다.

## 1. 시작 — 질문은 여기서 한 번에
- 세션 tag(영숫자 4자, 예 `k3f9`)를 정해 끝까지 쓴다. `vibe status --tag <tag> --json`이 fetch 후 원격의 다른 세션(active 행·doing·`wip/<tag>` 최근 시각), 로컬과 원격의 차이, 결정함, 기획 거리·구현 거리, 추천 경로(`route`)를 돌려준다. 원격이 앞서 있고 작업 트리가 깨끗하면 `vibe sync`.
- 선택지형 질문 **한 번**에 필요한 것만 묶는다(사용자는 지금 앞에 있다):
  ① 항상: "지금부터 작업을 시작합니다. 어떤 모드로 할까요?" — **함께**(결정할 때마다 모아서 묻는다) / **맡김**(묻지 않고 추천안대로 끝까지, 결정은 결정함·보고서에)
  ② `route:choose`(기획 거리와 구현 거리가 둘 다)일 때: 무엇부터 할지
  ③ 다른 기기의 살아 있는 세션이 보일 때: 이어받기(그 태스크를 넘겨받고 `wip/<tag>`의 변경을 가져온다) / 겹치지 않는 일만
  ④ cfg push가 `?`이거나 없을 때: push할 브랜치(`main` / 작업 브랜치 / 커밋만 `-`) — 답을 cfg에 쓴다
  인자가 이미 답한 것(`/start-vibe 맡김`, `/start-vibe 함께 태그 기능`)은 묻지 않는다. 선택지형 질문 도구가 없으면 같은 질문을 텍스트로 하고 이 턴을 끝낸다 — 답할 사람이 없다고 스스로 판단해 모드를 정하지 않는다. 헤드리스 실행·오케스트레이터는 인자로 모드를 준다.
- `vibe beat --tag <tag> --mode pair|autopilot`로 active 행을 쓰고 커밋·`vibe push` — 다른 기기가 이 세션을 본다.
- **맡김**: `vibe preflight --json`(push 권한·검증 명령·절전 방지·CI 인증). 사람이 정해야 할 실패가 있으면 떠나기 전에 질문 한 번으로 해결한다 — 이것이 마지막 질문이다. 통과하면 `vibe awake`, 이 스킬의 assets/report.md를 `spec/reports/<YYMMDD>-<tag>.md`로 복사해 채우기 시작한다(FORMAT report).
- **함께**: inbox가 있으면 먼저 보여 주고 한 번에 확인받는다. 승인 → 줄 삭제·log 1줄, 수정 → update-ssot 후 줄 삭제. 열린 보고서는 읽고 `to:`를 채워 닫는다.

## 2. 라우팅
인자(요청 문장)가 있으면 STATE보다 먼저 해석한다. 스킬 이름을 대면 그 스킬을 쓴다.

| 상황 | 다음 |
|---|---|
| spec/ 없음 | create-architecture. 맡김: 추천 스택으로 ARCH 초안을 쓰고 결정을 inbox에, 스캐폴딩 구현은 주차(스택은 되돌리기 비싸다) |
| 막연한 아이디어 | ideation. 맡김: 아이디어를 ideation 문서에 받아 적기만 하고 구체화 루프는 하지 않는다 |
| 명확한 새 기능 / 기존 기획 변경 / 버그 | create-ssot / update-ssot / create-task(수정 태스크 1개) → 이어서 구현 |
| 인자 없음, 기획·구현 거리 둘 다 없음 | "/ideation으로 아이디어부터 내 주세요"라고 안내하고 마감 |
| 기획 거리: 전환 안 된 ideation(open·ready) | create-ssot(도메인마다) → create-task. open 문서는 이때 ready로 수렴시키고 공백은 인터뷰로 채운다 |
| 구현 거리: pending(rev>tasked)·채택된 review | create-task → implement-task |
| 구현 거리: todo 태스크 | implement-task를 dep 순서로 하나씩, 메인 세션에서 단독으로 |
| 태스크 5개 완료마다·todo 소진 | review-code 제안(맡김: inbox `suggest`). lint 검토 후보가 쌓이면 doc-review 제안 |

- **작업 묶음은 예외적으로만** 쓴다: 독립 단위(lane·lane 없는 태스크) 2개 이상, 단위마다 태스크 3개 이상, touches가 서로 겹치지 않음, explore 태스크와 그 후속이 아님 — 모두 맞을 때. 묶음의 고정비(worktree·리뷰·통합 검증)가 병렬 이득보다 크면 단독이 빠르다. 묶음을 쓰면 [조정자 절차](references/coordinator.md)를 따른다.
- **explore 태스크**(FORMAT): 메인 세션에서 실행한다. 시간 제한을 시작 시각과 함께 log에 적고, 실험·e2e 같은 무거운 명령은 `vibe check --heavy -- <cmd>`로 돌린다. 시간이 다 되면 exit 줄대로 측정값을 result에 남기고 마감한다 — 함께는 그 전에 한 번 묻는다.

## 3. 모드
- **함께**: 결정 지점마다 선택지형으로 묻되 한 번에 모아서(최대 4개) 묻는다. 각 스킬의 cfg.level 질문법을 그대로 쓴다.
- **맡김**: 시작 이후 질문 0회. 고른 스킬은 함께 모드와 **같은 질문을 만들고**, 묻는 대신 추천안을 채택해 평소처럼 문서에 반영한 뒤(SSOT에는 일반 `[o]`) inbox `decided` 줄과 보고서 decided에 질문·선택·대안을 남긴다 — 돌아온 사용자는 받았어야 할 질문을 그대로 검토한다.
  - 과금·데이터 삭제·개인정보·보안 정책은 정하지 않는다 — `[?]`로 남기고 inbox `parked`, 그 결정에 걸린 태스크는 건너뛴다.
  - 되돌리기 어렵거나 프로젝트 밖에 영향을 주는 일(브랜치 삭제, force push·이력 재작성, 전역·사용자 설정, 배포·릴리스·게시, 유료 외부 서비스, 메시지 발송, 공유·운영 데이터 마이그레이션)은 하지 않고 inbox `parked` 후 다른 일을 계속한다.
  - blocked는 기다리지 않는다: 기획 공백이면 update-ssot를 추천안으로 진행(잠정, inbox), 기술 공백이면 create-task로 재분해, 그래도 막히면 그 태스크를 주차하고 다음 일로 간다.
- 전환: 사용자가 "나 나갈게/알아서 해"라고 하면 1절의 맡김 준비(preflight·보고서)를 거쳐 맡김으로. 돌아와서 말을 걸거나 /start-vibe를 실행하면 함께로 — inbox부터 보여 준다. 전환은 `vibe beat --mode`로 active 행에 반영한다.
- 모드는 이 세션의 것이다. cfg에 쓰지 않는다.

## 4. 작업 단위마다 커밋·push
- 단위: 태스크 done, SSOT rev(create-ssot·update-ssot 마감), create-task 묶음, ideation 마감, inbox 정리. 고른 스킬이 마감 단계(STATE log 기록)에 도달하면 변경 파일만 골라 커밋하고 `vibe push`(cfg push가 `-`면 커밋만). 사용자의 관련 없는 변경은 커밋하지 않는다.
- 태스크 선점: st를 `doing@YYMMDD.<tag>`로 바꾸고 `vibe beat --tag <tag> --doing T###` 후 커밋·push를 **먼저** 한다. push가 거부되면 `vibe sync` 후 그 태스크가 이미 다른 tag의 doing이면 다른 일을 고른다 — 원격이 판정한다.
- 1시간 넘게 커밋할 단위가 없으면 `vibe checkpoint --tag <tag>`(작업 트리 스냅샷을 `wip/<tag>`로 push, 현재 브랜치는 그대로). 긴 명령 전에도 한 번.
- 맡김이면 단위마다 보고서 done·checks를 갱신해 같은 커밋에 넣는다. 원격에 CI가 있으면 push 뒤 결과를 확인하고, 실패는 고칠 태스크로 처리한다(맡김에서 못 고치면 inbox `parked`).

## 5. 마감
- 남은 일이 없거나 사용자가 멈추라고 할 때. 맡김: 보고서 `to:`·next를 채우고, `vibe awake --stop`.
- `vibe beat --tag <tag> --end`로 active 행을 지우고 커밋·push. STATE next를 1~3줄로 갱신한다.
- 보고(cfg.level대로): 한 일, 내린 잠정 결정(inbox 수), 주차한 일, 다음 할 일. 맡김이었다면 보고서 경로를 알려 준다.
