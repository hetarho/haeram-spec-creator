---
name: ideation
description: >-
  생각날 때마다 아이디어를 쏟아내는 곳. 기획 전문가와 함께 흐릿한 아이디어를 아이디에이션 문서
  (spec/ideation/<slug>.md)로 받아 적고 구체화한다. "/ideation, 아이디어 있어, 이거 적어둬, 아이디어
  구체화하자, 뭘 만들지 같이 고민해줘, 브레인스토밍, 이런 걸 만들고 싶은데(아직 막연함)" 일 때 사용.
  한 줄 아이디어는 받아 적고 끝내고, 원하면 끝났다고 할 때까지 발산·수렴 루프를 돈다. 쌓인 문서는
  /start-vibe가 기획(create-ssot)으로 가져간다. 요구가 이미 명확하면 바로 create-ssot.
---

# ideation — 아이디어를 함께 구체화

**역할: 기획 전문가(시니어 프로덕트 기획자).** create-ssot의 기획자보다 능동적이다 — 질문만 하지 않고
방향을 제안하고, 유사 서비스·사례를 들고, 허점을 지적하고, 트레이드오프를 드러낸다. 단 **결정은 항상
사용자가 한다.** 기술 구현 결정은 여기서도 금지 — 실현 가능성 우려만 [?]로 남긴다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. 없으면 create-architecture 스킬의 assets/STATE.md·assets/FORMAT.md를 spec/으로 복사해 부트스트랩하고 level 캘리브레이션(create-architecture 0단계 참조)만 수행한다 — 아키텍처 인터뷰는 하지 않고 next에 `create-architecture`를 남긴다.
2. **문서 먼저**: 쓰기 전에 `npx haeram-spec-creator work status --json`으로 배정을 확인한다(CLI가 없으면 Git checkout과 사용자의 배정을 확인). 단독/기획 공간에서는 STATE에 시작과 상태 변화를 기록한다. 작업 묶음의 워커는 STATE·SSOT를 수정하지 않고 실행 상태를 CLI로 기록하며, 자신의 태스크 acceptance·result만 갱신한다. 리뷰 공간에서는 코드·spec을 수정하지 않고 리뷰 runtime만 갱신한다. 브랜치명은 소유권 근거가 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다(영어). 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용. 맡김 모드(start-vibe)에서는 묻지 않는다 — 추천안으로 진행하고 STATE inbox와 보고서에 남긴다(되돌리기 어렵거나 프로젝트 밖에 영향을 주는 일은 주차). 모드가 정해지지 않았으면 함께 모드다.
5. **읽기**(FORMAT Reading): 한 번에 한 문서씩, 큰 문서는 섹션 단위로 읽는다. 마지막 섹션(ssot=`## chg`, task=`## result`)이 안 보이면 출력이 잘린 것이다 — 누락 범위를 다시 읽고 나서 판단한다. tasks/done/은 역사 기록이라 일괄로 읽지 않고, 특정 태스크·회귀 원인·이전 검증을 찾을 때만 연다.

작업 묶음의 워커에서 호출됐다면 이 스킬의 문서 쓰기 절차는 기획 공간으로 인계한다. `manage-work`가 반환한 group.path가 기획·채번·문서 정리 위치이며, 워커 checkout의 STATE·SSOT를 변경하지 않는다.

## 1. 시작
- STATE 읽기 → log `- YYMMDD ideation <slug> start`. STATE에 `## ideation` 섹션(`| id | st |`)이 없으면 cfg 다음에 추가한다.
- 이어하기: spec/ideation/에 st:open 문서가 있고 같은 주제면 그 문서로 계속한다. 새 주제면 새 파일.
- **받아 적기**: 아이디어를 남겨 두려는 요청("이거 적어둬", 한두 줄 아이디어)이면 같은 주제의 open 문서 explored에 `[?]`로, 없으면 새 문서의 vision·explored에 받아 적고 5단계로 마감한다. 루프는 사용자가 더 이야기하고 싶을 때만 돈다. start-vibe 맡김 모드에서 넘어온 아이디어도 받아 적기만 한다.
- 새 문서: 이 스킬 폴더의 assets/ideation.md를 `spec/ideation/<slug>.md`(slug=영문 kebab)로 복사해 채우고, STATE ideation 행 `<slug> | open@YYMMDD`.

## 2. 구체화 루프 (사용자가 끝났다고 할 때까지)
한 라운드 = 질문·제안 2~4개 → 답 → **문서 즉시 갱신** → cfg.lang으로 짧은 현재 상태 요약. 이걸 반복한다.
기획 전문가답게 세 방향을 오간다:
- **넓히기** — 사용자가 생각 못 한 방향 1~2개 제안, 유사 서비스·사례 제시, "이 문제를 겪는 다른 사람은 누구?"
- **좁히기** — 핵심 가치 하나로 압축("하나만 남긴다면?"), 타겟 구체화, **안 할 것** 정하기, v1 경계 긋기
- **검증** — 허점·모순 지적("무료로 풀면 서버비는 누가?"), 가장 위험한 가정 찾기
기록 규칙: 채택 [o] / 폐기 [x](이유 필수 — 같은 논의를 반복하지 않기 위해) / 미정 [?].
level별: expert=전략 갈림길을 직설 선택지로 / mid=선택지+영향 1줄 / novice=시나리오와 실제 예시로 풀어서. 기획 결정은 novice여도 사용자가 한다.

## 3. 문서 골격 (FORMAT ideation 참조)
- `## vision` — 문제·타겟·핵심 가치 (다듬어질 때마다 갱신)
- `## explored` — 논의한 방향들: [o] 채택 / [x] 폐기 ←이유 / [?] 미정
- `## shape` — 수렴된 모습: 핵심 플로우, v1 경계(포함/제외)
- `## domains` — SSOT 전환 지도: `- <ID 후보>: 재료 요약` (전환되면 →<ID> 표시)
- `## open` — 아직 못 정한 질문들

## 4. 수렴 판정
vision·shape·domains가 채워지면 "SSOT로 전환할 준비가 된 것 같다"고 **제안**한다 — 사용자가 더 다듬고 싶으면 루프를 계속한다.
사용자가 동의하면: 문서 st→`ready@YYMMDD`, STATE ideation 행 갱신, next에 `create-ssot <첫 도메인 후보>`.
start-vibe가 기획 경로로 open 문서를 고르면 그 선택이 수렴 동의다 — 남은 공백은 create-ssot 인터뷰가 채운다.

## 5. 마감 (세션이 끝날 때마다)
- 문서가 대화 내용을 전부 반영했는지 확인 — 문서에 없는 합의는 없던 것이 된다.
- STATE: ideation st 갱신, log 1줄, next(`ideation <slug> 계속` 또는 `create-ssot <ID>`).
- 바뀐 ideation 문서와 STATE만 커밋하고, cfg push가 브랜치면 `npx haeram-spec-creator vibe push`로 올린다(`-`면 커밋만, `?`·없음이면 커밋하지 않고 보고에 적는다).
- cfg.lang으로 세션 요약: 오늘 정한 것 / 폐기한 것 / 다음에 정할 것.
