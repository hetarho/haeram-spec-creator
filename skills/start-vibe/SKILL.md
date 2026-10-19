---
name: start-vibe
description: >-
  작업의 진입점. "/start-vibe, 작업 시작하자, 이어서 해줘, 남은 거 해줘, 나 나갈게 알아서 해줘" 일 때 사용.
  STATE와 원격을 읽어 다른 기기의 진행을 확인하고, 시작할 때 한 번에 묻는다(모드: 함께=내가 결정 / 맡김=묻지 않고
  추천안으로 진행). 그 뒤 기획(create-ssot·update-ssot·create-task)과 구현(implement-task)을 스스로 골라 진행하고
  태스크별 커밋·묶음별 push한다. 맡김이면 결정함(STATE inbox)과 보고서를 남긴다. 아이디어를 쏟아내는 일은 ideation.
---

# start-vibe — 작업 진행자

**역할: 진행자.** 다음에 할 일을 고르고(라우팅) 모드·push·진행 표시·결정함·보고서를 지킨다. 기획·기술 판단은 하지 않는다 — 고른 스킬이 자기 역할로 한다. 스킬 절차를 여기서 다시 쓰지 않는다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 `vibe status --json` 또는 실행기 brief로 필요한 STATE 요약만 본다. 없으면 create-architecture로 보낸다.
2. **문서 먼저**: 쓰기 전 실행기 배정 또는 `work status --json`으로 확인한다(CLI가 없으면 checkout·사용자 배정 확인). 단독/기획은 STATE에 시작·상태 변화를 기록한다. 워커는 STATE·SSOT 대신 runtime과 자기 acceptance 체크·result만 쓴다. 리뷰는 읽기 전용이며 리뷰 runtime만 쓴다. 브랜치명은 소유권이 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. `vibe format --section task|state|ssot|report` 중 필요한 발췌만 보고 FORMAT 전체를 읽지 않는다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용. 맡김 모드(start-vibe)에서는 묻지 않는다 — 추천안으로 진행하고 STATE inbox와 보고서에 남긴다(되돌리기 어렵거나 프로젝트 밖에 영향을 주는 일은 주차). 모드가 정해지지 않았으면 함께 모드다.
5. **읽기**: brief·status 요약을 먼저 쓰고 부족한 ID·섹션만 읽는다. 결정은 `vibe brief <T###|ID-n|ID@rev>`로 원문 블록째 받는다 — 끝의 `end` 줄이 없거나 complete:no면 빠진 부분부터 다시 읽고, unfollowed·related는 필요한 것만 연다. 직접 읽은 결정은 다음 결정 줄·제목까지 본 블록만 근거로 쓴다. STATE·FORMAT·ARCH·큰 코드 전체를 반복 읽지 않는다. tasks/done/은 특정 회귀·검증 근거만 선택 조회한다. 출력은 요약·tail, 전체 로그는 파일로 남긴다.

CLI는 `npx haeram-spec-creator` 뒤에 붙인다. 실행기의 cliCommand가 있으면 그 경로를 사용한다.

## 1. 시작·단위1
`vibe status --tag <tag> --json`으로 cfg·active·inbox 수·next·남은 일만 본다. 원격 오류면 선점하지 않는다. 앞선 원격은 깨끗한 트리에서 sync한다. 함께(pair)와 실행기 밖 초기화는 필요할 때만 [세션 절차](references/session.md)를 읽는다.
장기 맡김은 `vibe loop --tag <tag> --provider claude|codex --json`: 바깥 CLI가 단위마다 새 세션을 띄운다. 이 대화 안에서 남은 일을 끝까지 반복하지 않는다.
`/start-vibe 맡김 단위1` 또는 `HAERAM_VIBE_UNIT=1`이면 시작 질문 없이 정확히 **태스크 1개 done / 기획 한 조각 / inbox 정리 / 작은 수정** 중 하나만 끝낸다. 기획 조각은 update-ssot(필요하면 create-ssot)+create-task를 같은 세션에서 끝내고 읽은 결정을 재사용한다. 그 뒤 구현으로 넘어가지 않는다. 구현을 부하 에이전트에 분할하지 않는다.
hostManaged 실행기에서는 초기화·active·보고서 생성/종료·묶음 검증·완료 push·CI를 호스트에 맡긴다. 같은 tag·보고서를 잇고 재초기화하지 않는다. 기본 권한은 acceptEdits+allow 목록, 사용자가 명시한 `--permission-mode bypass`만 우회한다. 메인 checkout의 프로젝트 settings와 실제 실행 권한은 시작 probe로 확인한다.

## 2. 라우팅
인자를 먼저 해석하고 없으면 route·dep을 따른다.

| 상황 | 다음 |
|---|---|
| spec 없음 | create-architecture 초안, 스캐폴딩 parked |
| 작은 버그·문구·스타일 수정 | 아래 경량 경로 |
| 새 기능·기획 변경 | create-ssot/update-ssot → create-task 한 조각 |
| pending·채택 review | create-task 한 조각 |
| 전환 전 ideation | 도메인 하나 create-ssot → create-task |
| dep 충족 todo·자기 doing | vibe brief T### → implement-task 1개 |
| inbox 정리 요청 | status --section inbox로 해당 항목만 반영·log |
| 일 없음·parked만 남음 | 마감; 맡김에서 새 아이디어를 만들지 않는다 |

경량 경로는 모두 만족할 때만: SSOT 규칙·계약·저장 형식·마이그레이션 변경 없음, 새 결정 없음, 버그/문구/스타일 수정, 코드+테스트 3파일·추가+삭제 100줄 이하(STATE 제외). 태스크·rev 없이 구현 → 영향 테스트+빠른 검사 → 커밋 하나에 STATE log `- YYMMDD fix <area>: <what>` → 묶음 push. 조건이 깨지거나 결정·기획 공백이 나오면 즉시 create-task/update-ssot로 올린다.
작업 묶음은 단위1에서 만들지 않는다. 사용자의 병렬 요청 또는 독립 단위 2개 이상·각 태스크 3개 이상·touches 분리·explore 제외일 때만 [조정자 절차](references/coordinator.md)를 읽는다.

## 3. 모드
맡김은 질문 0회. 스킬이 만든 질문의 추천안을 반영하고 inbox decided에 질문·선택·대안·이유를 남긴다. SSOT에는 일반 [o]만 쓴다. 과금·데이터 삭제·개인정보·보안 정책은 [?]+parked. 배포·게시·force push·브랜치 삭제·전역 설정·외부 메시지·공유 데이터 변경 등 되돌리기 어려운 일도 parked로 남기고 관련 태스크를 건너뛴다. 모드는 cfg에 쓰지 않는다.

## 4. 커밋·검증·push
- solo: 선점·active는 첫 작업 커밋에 포함, beat는 세션 시작·끝. 태스크별 커밋 유지. push·보고서 갱신은 태스크 3개(기본), 기획 조각의 태스크 소진, 세션 끝, 반복기 멈춤 중 먼저 온 묶음 경계. loop의 단위 세션 끝은 경계가 아니다.
- strict(다른 생존 세션·소유 불명 doing): doing tag·active를 별도 커밋·push **먼저**, sync 후 원격 소유가 자기 tag인지 재확인. 다른 tag면 다른 후보. 원격이 판정하며 매 단위 검증·push·보고서를 유지한다. 같은 checkout의 동시 쓰기 금지.
- 태스크=변경·영향 테스트+typecheck·lint·format. ARCH 단계가 없어도 전체 verify를 태스크에 붙이지 않는다. 코드 묶음 push 전 전체 스위트 한 번, push 뒤 CI. work 매핑은 task→task-verify, batch→verify, CI가 최종 관문이면 group-verify 생략.
- CI는 묶음당 `vibe ci wait --commit <sha> --diff-base <묶음 시작 SHA> --json` 한 번 또는 push --wait-ci. Claude는 셸 백그라운드+하네스 완료 알림, Codex는 긴 timeout의 단일 블로킹 호출. sleep→조회→보고 모델 루프 금지. 긴 e2e·벤치마크도 완료까지 모델을 깨우지 않는다. 실패는 수정 태스크, 못 고치면 parked. run 없는 push는 CLI가 skipped로 마친다.
- 1시간마다, 긴 명령 전 `vibe checkpoint --tag <tag>` 유지. 무관한 사용자 변경은 커밋하지 않는다.

## 5. 마감
단위1은 다음 단위로 넘어가지 않고 JSON 한 줄(호스트가 요구하면 스키마 결과):
`{"kind":"task","id":"T001","outcome":"completed","pushed":false,"next":"implementation"}`
kind=task|planning|inbox|fix|none, outcome=completed|parked|blocked|no_work. pushed는 실제 여부. hostManaged 단위는 active·보고서를 닫지 않는다. 반복기만 끝에서 active 정리·보고서 to/next·최종 묶음 검증/push를 한다. 함께는 단위 완료 시 “다음 단위는 새 대화에서 이어가면 빠르다”고 안내한다.
