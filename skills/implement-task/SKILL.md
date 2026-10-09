---
name: implement-task
description: >-
  spec/tasks/의 태스크를 구현하고 검증한다. "구현해줘 / T003 해줘 / 다음 태스크 진행 / 남은 태스크 구현해줘" 일 때 사용.
  단독 작업은 STATE의 다음 todo를 고르고, 작업 묶음이 있거나 태스크에 lane이 있으면 세션 루프로 기반·줄기·리뷰를
  다른 세션과 나눠 맡는다. SSOT 신선도와 완료기준을 확인하고 검증한다. 단독 작업은 done으로 마감하며, 묶음 워커는 제출하고 통합은 CLI가 진행한다.
---

# implement-task — 태스크 구현

**역할: 엔지니어.** SSOT와 ARCH가 법이다. 구현 중 기획 공백을 발견하면 임의로 정하지 말고 update-ssot를 제안하거나 blocked 처리한다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. 없으면 중단하고 create-architecture 실행을 안내한다.
2. **문서 먼저**: 쓰기 전에 `npx haeram-spec-creator work status --json`으로 배정을 확인한다(CLI가 없으면 Git checkout과 사용자의 배정을 확인). 단독/기획 공간에서는 STATE에 시작과 상태 변화를 기록한다. 작업 묶음의 워커는 STATE·SSOT를 수정하지 않고 실행 상태를 CLI로 기록하며, 자신의 태스크 acceptance·result만 갱신한다. 리뷰 공간에서는 코드·spec을 수정하지 않고 리뷰 runtime만 갱신한다. 브랜치명은 소유권 근거가 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.
5. **읽기**(FORMAT Reading): 한 번에 한 문서씩, 큰 문서는 섹션 단위로 읽는다. 마지막 섹션(ssot=`## chg`, task=`## result`)이 안 보이면 출력이 잘린 것이다 — 누락 범위를 다시 읽고 나서 판단한다. tasks/done/은 역사 기록이라 일괄로 읽지 않고, 특정 태스크·회귀 원인·이전 검증을 찾을 때만 연다.

## 1. 환경과 선택
- `npx haeram-spec-creator work status --json`으로 현재 배정을 확인한다. CLI가 없거나 `work`를 지원하지 않으면 기존 단독 흐름은 가능하지만 공유 선점을 흉내 내지 않는다.
- `mode:worker`이면 반환된 currentAttempt의 태스크와 workspace를 사용한다. `tasks`가 둘 이상이면 lane 배정이다 — `taskId`가 지금 구현할 태스크이고, 앞 태스크의 커밋 위에서 이어 간다. doing은 배정대로 구현하고 blocked는 원인 해소와 `work update --status doing` 이후 재개한다. changes_requested는 `work resume`로 수정 배정을 받는다. ready·reviewing·approved는 리뷰·통합 대기다. verifying/integrating/cleaning 중인 공간에 쓰지 않는다. integrated/released/failed라면 종료 기록을 보고 manage-work로 정리·재배정한다. 브랜치명으로 이어받을 태스크를 추정하지 않는다.
- `mode:reviewer`이면 구현하지 않고 review-task/manage-work로 인계한다.
- 배정이 없거나 끝난 워커 세션은 바로 종료하지 않고 아래 **세션 루프**로 다음 일을 받는다.
- `mode:group`이면 `manage-work`의 board→claim으로 작업자를 배정한다. `mode:single`이며 작은 단독 요청이면 아래 단독 흐름을 사용한다. 사용자가 병렬 작업을 요청했다면 `manage-work`로 묶음을 만든다. Orca 등 특정 실행기를 요구하거나 매번 모드를 묻지 않는다.
- **작업 묶음 워커**: doing/blocked/heartbeat는 `work update --attempt <id>`로 기록한다(명령 앞에 `npx haeram-spec-creator`를 붙인다). 태스크 st·base·goal·acceptance 문구·impl notes·STATE·SSOT는 수정하지 않는다. 자신의 acceptance 체크와 result, 구현 코드만 바꾼다.
- **단독 흐름**: 인자 T###이 없으면 STATE tasks에서 dep이 전부 충족된 첫 todo를 고른다(dep 충족 = 그 ID가 표에 없고 `tasks/done/`에 파일이 있음). doing은 다른 세션 소유로 보고, 회수는 사용자가 지시했을 때만 한다. 세션 tag(2~4자)로 STATE와 태스크 st를 `doing@YYMMDD.tag`로 바꾸고 log를 기록한다. 다시 읽어 다른 tag면 중단한다. 이것은 진행 기록이며 원자적 선점이 아니므로 같은 checkout의 동시 쓰기에 사용하지 않는다.

### 세션 루프 (여러 세션·오케스트레이터)
"남은 태스크 구현해줘"처럼 남은 일을 맡기는 요청이고, `work status`에 활성 작업 묶음이 있거나 todo 태스크에 `lane:`이 있으면 이 루프로 진행한다. ARCH가 단독 checkout 진행을 강제하면 따르지 않는다. 세션은 구현에 집중하고, 통합·묶음 검증은 CLI가 백그라운드에서 실행한다. 다른 세션이 있으면 같은 루프로 기반 → 줄기를 나눠 맡는다.
- owner는 세션마다 한 번 `<도구>-<영숫자 4자>`(예 `claude-k3f9`)로 정하고 끝까지 같은 값을 쓴다.
- 반복: `npx haeram-spec-creator work next --owner <owner> --wait 540 --json`. 활성 묶음이 없으면 `--start`와 ARCH 검증 단계의 명령(`--task-verify` 태스크 단계, `--verify` 단위 통합, `--group-verify` 묶음 완료)을 붙인다 — 같은 커밋에서 시작한 세션들은 같은 묶음에 합류한다. 셸 도구의 timeout은 대기 시간보다 길게 둔다.
- 응답의 `action`대로 하고 `instruction`을 따른다:
  - `implement`: `attempt.workspace`에서 `attempt.taskId`를 이 스킬의 2~5단계(작업 묶음 워커 규칙)로 구현·커밋하고 `work submit --attempt <id> --json`. 저장된 태스크 단계 명령이 자동 실행된다. 응답이 `doing`이고 `taskId`가 바뀌면 같은 공간에서 이어 구현하고, `ready`면 루프로 돌아간다. `correction`이 있으면 그 findings부터 처리한다(통합 실패면 묶음 브랜치를 merge해 해결).
  - `review`: review-task로 `review.workspace`를 읽기 전용 검토하고 `work review-finish`를 실행한다.
  - `blocked`: 직접 고칠 수 있으면 고치고 `work update --attempt <id> --status doing` 후 다시 submit, 기획 판단이 필요하면 보고하고 멈춘다.
  - `wait`: 그대로 다시 호출한다. `reason:needs-reviewer`면 독립 리뷰어가 없는 것이다 — 서브에이전트 도구가 있으면 새 컨텍스트의 서브에이전트에 review-task를 맡기고(owner `<owner>-review`로 `work review-claim`부터), 없으면 다른 세션을 열어 같은 요청을 하라고 안내한다.
  - `complete`: 묶음 브랜치와 검증 커밋을 보고하고 main 반영 여부를 묻는다. `stalled`: 막힌 원인을 보고하고 멈춘다.
- 루프에서는 `work integrate`·`work finish`를 직접 실행하지 않고, 다른 세션의 작업 공간에 쓰지 않는다.

## 2. 신선도
단독 작업은 태스크 base(`<ID>@rev`)와 STATE의 현재 rev를 비교한다. 작업 묶음의 워커는 `work board --work <group> --json`으로 상위 브랜치의 현재 태스크·커밋을 확인하고, 로컬 SSOT와 관련 정책 변경을 비교한다. 영향을 받으면 blocked 사유로 인계하고 기획 공간에서 갱신·재배정한다. 워커에서 base만 임의로 바꾸지 않는다. 아래 base 갱신 규칙은 단독 흐름에 적용한다. 뒤처져 있으면 SSOT chg 델타를 읽고:
- 이 태스크와 무관 → base만 갱신하고 진행.
- 영향 있음 → 선점 해제(todo 복귀) + log, create-task로 태스크를 갱신하라고 안내하고 중단.

## 3. 구현
- 작업 묶음에서는 구현 시작·수정 재개·제출 전에 `work board --work <group> --json`으로 최신 배정과 기획 기준을 확인한다. 긴 작업 중에는 주기적으로 heartbeat와 관련 변경을 확인한다. runner는 생존 heartbeat를 갱신하지만 정책 변경을 대신 판단하지 않는다. 리뷰 공간에서 implement-task를 실행하지 않는다.
- 정독: 태스크 전체 + ssot가 가리키는 결정 원문 + ARCH 컨벤션. impl notes가 `review/<slug> Fn`을 가리키면 그 finding 원문도 읽는다. 현재 규칙의 출처는 ssot/뿐이다 — 완료 태스크는 당시 기록이라 근거로 쓰지 않고, 회귀 원인·이전 검증 방법을 확인해야 할 때만 `tasks/done/`에서 해당 파일을 골라 연다.
- 완료기준을 위에서부터 구현. 범위 밖 발견(버그·개선거리)은 단독이면 log에 1줄, 작업 묶음이면 자신의 result limits 또는 blocked reason으로 인계한다(쌓이면 기획 공간에 `review-code` 제안).
- 태스크는 질문 없이 완주 가능해야 정상이다. 구현 중 결정이 필요한 질문이 생기면 분해 실패 신호 — 임의로 정하지 말고, 기획 공백·모순이면 update-ssot 제안, 기술 결정 누락이면 blocked 후 create-task 재분해 제안.

## 4. 검증 (항상 이 순서로 마친다)
① acceptance를 하나씩 실제로 확인하고 `[v]`로 채운다 ② test — 태스크 단계 ③ lint ④ formatter ⑤ ARCH에 CI/CD가 정의돼 있으면 그 파이프라인이 검사하는 항목을 로컬에서 재현하고, 원격에 푸시된 상태면 CI/CD 결과까지 확인한다 ⑥ `npx -y haeram-spec-creator lint`로 spec 정합성을 검사하고 오류·경고는 고친다(네트워크·CLI가 없으면 생략) — 출력의 `검토 후보`는 구조 위반이 아니라 문서 품질 신호라 여기서 고치지 않고, 쌓이면 단독 작업의 next에 `doc-review <ID>`를 남기고, 묶음 워커는 result limits로 기획 공간에 인계한다. ②~⑤의 명령은 ARCH의 verify 결정에서 가져온다.
- **태스크 단계 test**: 이 태스크가 추가·수정한 테스트와 변경이 영향을 줄 수 있는 기존 테스트(역의존 import, 공유 계약·설정·마이그레이션·테스트 설정의 소비자)만 실행한다. 영향 범위를 한정할 수 없으면 그 스위트 전체로 넓힌다. 선택한 명령과 영향 판단 근거를 result verified에 남기고, 빈 선택을 동작 검증으로 세지 않는다.
- **전체 스위트와 ⑤ CI 재현**: 작업 묶음에서는 단위 통합(`work integrate --verify`)과 묶음 완료(`work finish --verify`)가 실행하므로 워커는 돌리지 않는다. 단독 흐름은 ARCH에 단계 구분(태스크/push 전 등)이 있으면 그 단계에 맡기고, 없으면 ARCH verify 전체를 실행한다. 마지막으로 done 직전 신선도 재확인(2단계와 동일, 현재 checkout 기준이며 다른 브랜치의 SSOT 변경은 자동으로 보이지 않음) — 구현 중 rev가 올랐으면 델타 영향을 재평가한다. 어느 하나라도 실패한 채 done 금지 — 해결하거나 blocked(사유 1줄은 ## result에).

## 5. 마감
- 기본 어댑터가 커밋도 호스트가 담당한다고 지정했다면 코드·acceptance·result를 채우고 지정된 JSON 결과를 반환한다. git add/commit·submit은 실행하지 않는다. 호스트가 변경 범위·시작 HEAD를 확인하고 커밋·검증·제출한다. 아직 커밋되지 않은 변경을 검사했다면 result at은 `-`로 쓰고, 실제 실행한 검사만 verified에 적는다.
- 커밋은 워커에게 맡기는 `commit-only` 실행기라면 아래 작업 묶음 절차에서 commit까지 수행하고 지정된 JSON 결과를 반환한다. submit·재배정·통합은 runner가 담당한다. 모든 수정 배정에서 전달된 correction findings를 먼저 읽고 acceptance와 함께 확인한다.
- **작업 묶음 워커**는 아래 result 4줄을 채우고 코드와 자신의 태스크 변경만 커밋한 뒤 `npx haeram-spec-creator work submit --attempt <id> --verify '<태스크 단계 test 명령>' --json`으로 실제 검증을 실행한다(`--verify` 반복 가능, 전체 스위트는 넣지 않는다). lane 배정에서 응답이 `status:doing`이고 `taskId`가 바뀌었으면 같은 공간에서 다음 태스크를 1단계(정독)부터 이어 구현한다 — 마지막 태스크의 submit이 ready다. 그룹 작업을 수행하도록 받은 지시의 범위에 커밋이 포함되지 않았거나 금지됐다면 결과를 보존하고 제출에 필요한 커밋을 보고한다. 명령 성공 시 리뷰 대기 ready이며, STATE 갱신·done 표기·아카이브 이동은 하지 않고 관리 세션에 attempt와 검증 커밋을 전달한다. 통합과 정리는 `manage-work`가 수행한다.
- 아래 아카이브·STATE 마감 절차는 **단독 흐름에만** 적용한다.
- 태스크 `## result`(FORMAT 골격, 4줄): `- outcome:` 무엇이 되게 됐는지 / `- at:` 검증을 돌린 커밋 SHA(git이 없으면 `-`) / `- verified:` 실제로 통과시킨 검사 / `- limits:` 남은 한계·후속(없으면 `-`). 대화 경위와 구현 과정 서술은 넣지 않는다.
- 구현 중 정해진 것 중 **이후 변경이 계속 지켜야 하는 계약**은 result에 적어 끝내지 않는다 — 완료 태스크는 아카이브라 아무도 현재 규칙으로 읽지 않는다. update-ssot를 제안해 SSOT로 올린다.
- 태스크 파일: st→`done@YYMMDD` 갱신 후 `spec/tasks/done/`으로 이동(아카이브).
- STATE: 해당 행 삭제 — tasks 표는 남은 일만 남긴다. next 갱신(다음 todo), log `- YYMMDD T### done` 1줄.
- 보고는 cfg.level대로 — novice: 무엇이 가능해졌고 어떻게 확인하는지 / expert: 변경 요약과 리뷰 포인트. 단독 흐름의 커밋은 요청받았을 때만.
