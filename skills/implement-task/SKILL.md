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
1. 먼저 `vibe status --json` 또는 실행기 brief로 필요한 STATE 요약만 본다. 없으면 create-architecture 실행을 안내한다.
2. **문서 먼저**: 쓰기 전 실행기 배정 또는 `work status --json`으로 확인한다(CLI가 없으면 checkout·사용자 배정 확인). 단독/기획은 STATE에 시작·상태 변화를 기록한다. 워커는 STATE·SSOT 대신 runtime과 자기 acceptance 체크·result만 쓴다. 리뷰는 읽기 전용이며 리뷰 runtime만 쓴다. 브랜치명은 소유권이 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. `vibe format --section task|state|ssot|report` 중 필요한 발췌만 보고 FORMAT 전체를 읽지 않는다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용. 맡김 모드(start-vibe)에서는 묻지 않는다 — 추천안으로 진행하고 STATE inbox와 보고서에 남긴다(되돌리기 어렵거나 프로젝트 밖에 영향을 주는 일은 주차). 모드가 정해지지 않았으면 함께 모드다.
5. **읽기**: brief·status 요약을 먼저 쓰고 부족한 ID·섹션만 읽는다. 결정은 `vibe brief <T###|ID-n|ID@rev>`로 원문 블록째 받는다 — 끝의 `end` 줄이 없거나 complete:no면 빠진 부분부터 다시 읽고, unfollowed·related는 필요한 것만 연다. 직접 읽은 결정은 다음 결정 줄·제목까지 본 블록만 근거로 쓴다. STATE·FORMAT·ARCH·큰 코드 전체를 반복 읽지 않는다. tasks/done/은 특정 회귀·검증 근거만 선택 조회한다. 출력은 요약·tail, 전체 로그는 파일로 남긴다.

## 1. 선택과 브리핑
`work status --json`이 worker/group/reviewer이면 [작업 묶음 절차](references/work-group.md)만 추가로 읽는다. 단독이면 `vibe status --tag <tag> --json`에서 dep 충족 todo 또는 자기 doing 하나를 고른다. 다른 tag의 doing은 회수하지 않는다.
`vibe brief T###` 또는 실행기의 brief가 읽기 범위다: 태스크, 인용 도메인의 현재 규칙(cfg brief `domain`, 기본) 또는 인용 결정만(`cited`), 필수 의존(`→!`)·정본(`→=`)·인용 결정을 가리키는 결정, 전역 규칙(cfg always), flow·constraints, base 이후 chg, ARCH 검증 단계. 브리핑이 있으면 STATE·FORMAT·ARCH 전체를 다시 읽지 않는다. issues부터 처리한다 — complete:no면 빠진 원문을 먼저 읽고, [x]는 규칙이 아니며 [?]에 기대는 구현은 기획 결정이 먼저다. unfollowed·related는 이 태스크에 필요한 것만 `vibe brief <ID>-n`으로 더 받는다. 쓰는 표기는 `vibe format --section task` 발췌로 확인한다.
단독은 태스크 시작 HEAD를 `$HAERAM_DIFF_BASE`로 보존하고 모든 검사에 넘긴다(반복기는 이미 설정). 선점 st=`doing@YYMMDD.tag`를 태스크·STATE에 쓴다. solo는 첫 작업 커밋에 포함, strict는 start-vibe의 선점 커밋·push·원격 재확인을 먼저 한다. 같은 checkout에서 동시 쓰기를 하지 않는다.

## 2. 신선도
brief의 stale-base와 history(base 이후 chg 줄)가 델타다 — chg를 따로 읽지 않는다. 무관하면 base만 갱신, 영향 있으면 todo 복귀·log 후 create-task로 갱신한다. 완료 전 관련 rev만 다시 확인한다. 워커는 기획 공간에 인계하며 base를 임의로 바꾸지 않는다.

## 3. 구현
태스크 완료기준과 인용 결정에 맞춰 구현한다. 코드는 `rg`로 위치를 찾고 필요한 줄 범위만 읽는다. 큰 파일·같은 SSOT 전체를 반복 출력하지 않는다. 명령 출력은 요약·tail만 보고 전체 로그는 파일 경로로 남긴다. 완료 태스크는 회귀 근거가 필요한 특정 파일만 조회한다.
기획 공백은 update-ssot, 기술 결정 누락은 create-task로 올린다. 맡김은 추천안+inbox decided, 금지 정책·되돌리기 어려운 일은 parked. 새 문맥은 바깥 반복기가 만든다. 단독 구현을 서브에이전트에 분할하지 않는다. 범위 밖 발견은 result limits/log 한 줄로 남긴다.
explore는 시작 시각·timebox를 기록하고 측정값을 result에 보존한다. 시간이 다 되면 acceptance의 exit대로 끝낸다(함께는 한 번 확인, 맡김은 inbox decided).

## 4. 검증
① acceptance를 실제 확인해 `[v]` ② 추가·수정·영향받는 테스트 ③ typecheck·lint·format ④ spec lint ⑤ 묶음·CI는 아래 경계에 맡긴다.
- brief의 verify.guidance에 있는 조건부 UI·브라우저·저장소 검사도 적용한다. ARCH에 단계가 없어도 태스크 기본은 영향 테스트+빠른 검사다. 영향 범위를 한정할 수 없을 때만 해당 스위트로 넓히고 근거를 result verified에 남긴다. 빈 테스트 선택을 동작 검증으로 세지 않는다.
- 검사는 `vibe check --tier task --diff-base <태스크 시작 SHA> --task T### -- <command>`로 실행한다. `HAERAM_TIER=task`, `HAERAM_DIFF_BASE`와 TASK(S)가 전달된다. 요약의 실패 테스트·마지막 줄만 보고, 필요할 때만 log 경로의 범위를 읽는다. 같은 트리·명령·범위의 성공은 재사용한다.
- 전체 스위트는 **코드가 실리는 묶음 push 전 한 번**. 작업 묶음은 integrate --verify가 batch, 추가 로컬 최종 관문만 finish의 group-verify다. 워커는 이 검사를 중복 실행하지 않는다.
- ⑤ CI는 push한 묶음당 `vibe ci wait` 한 번이다. start-vibe/호스트가 수행한다. Claude는 셸 백그라운드+완료 알림, Codex는 긴 timeout의 단일 블로킹 호출. 모델의 sleep→조회→보고 반복은 금지한다. 긴 e2e·벤치마크도 완료 이벤트까지 모델을 깨우지 않는다. 실패는 수정 태스크로 넘긴다.
- `lint` 오류·경고는 고친다. reviewHints는 의미 검토 후보라 자동 수정하지 않고 next의 doc-review 또는 result limits로 넘긴다.

## 5. 마감
단독 태스크 result는 `- outcome:` / `- at:` 검증 SHA / `- verified:` 실제 검사 / `- limits:` 한계 또는 `-` 네 줄. 이후에도 지킬 계약은 result에 묻지 말고 update-ssot로 올린다. st=done@YYMMDD, tasks/done/으로 이동, STATE 행 삭제·next 갱신·log `- YYMMDD T### done`. 태스크마다 관련 파일만 커밋하며 push·보고서는 start-vibe/호스트의 묶음 경계를 따른다. start-vibe 밖 커밋은 요청받았을 때만 한다.
작업 묶음 워커는 acceptance 체크·result·코드만 갱신하고 제출한다. STATE·SSOT·st·아카이브는 CLI/기획 공간이 소유한다. 함께는 단위 완료 시 새 대화로 이어가면 빠르다고 안내한다.
