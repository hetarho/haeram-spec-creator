---
name: create-task
description: >-
  엔지니어 역할로 SSOT 변경분(STATE pending)을 구현 태스크(spec/tasks/T###.md)로 분해한다. "task로
  쪼개줘 / 작업 계획 세워줘 / 변경사항 태스크로 만들어줘" 일 때 사용. STATE의 rev/tasked 차이와 SSOT
  chg로 무엇이 새로 생겼고 어디가 바뀌었는지 스스로 파악한다. 개발 관점 질문만 한다(데이터 모델·API·
  엣지·마이그레이션). 구현은 implement-task.
---

# create-task — SSOT 델타 → 태스크

**역할: 엔지니어.** SSOT의 기획 결정은 재논의하지 않는다. SSOT가 모호하거나 모순이면 추측으로 메우지
말고 update-ssot를 제안하고 그 부분은 보류한다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. 없으면 중단하고 create-architecture 실행을 안내한다.
2. **문서 먼저**: 질문·추론·구현을 시작하기 전에 STATE.md에 시작을 기록하고(log 1줄 + 해당 st), 상태가 바뀔 때마다 즉시 반영한다. 병렬 세션은 STATE.md로만 서로를 안다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.

## 1. 스코프와 델타
- 스코프: 사용자가 지정한 도메인, 없으면 STATE ssot에서 pending 있는(= tasked < rev) 전부.
- log에 `- YYMMDD create-task <IDs> start`.
- 델타 파악: 각 SSOT chg의 tasked+1..rev 줄 + 해당 결정 원문. tasked=0이면 도메인 전체가 신규. ARCH의 관련 결정도 읽는다(태스크가 따를 기준).
- 델타가 코드에 영향이 없으면(문구 정리, 컨벤션 서술 변경 등) 태스크 없이 소화한다: ssot `tasked=rev`·pending `-`, log에 `- YYMMDD <ID> rN..rM no-op (no code impact)` 1줄. 영향 여부가 확실하지 않으면 태스크를 만든다.

## 2. 개발 인터뷰 (필요한 것만)
ARCH·SSOT·기존 코드에 답이 있으면 묻지 않는다. 영역: 데이터 모델/스키마, API·인터페이스 계약, 상태·에러·엣지 처리, 기존 데이터 마이그레이션, 성능·보안 요구, 테스트 범위.
- **expert**: 설계 초안을 제시하고 세부를 직접 확인. "스키마 이 초안으로? 인덱스는? 소프트 딜리트?"
- **mid**: 갈림길마다 선택지 + 트레이드오프 1줄.
- **novice**: 기술 질문 금지. 결과 수준만 확인("기존에 저장된 글은 그대로 보여야 하죠?"). 나머지는 AI가 결정하고 근거를 구현메모에 남긴다.

## 3. 분해
- 크기: 태스크 1개 = 구현 세션이 **추가 질문 없이** 처음부터 끝까지 완주할 수 있는 단위. 그러기 위해 필요한 결정은 전부 이 단계에서 끝내 impl notes에 담는다 — 구현 중 질문이 생기면 분해 실패다.
- 크기 상한은 모델 능력 기준: 기본은 지금 분해 중인 모델 자신("내가 이걸 한 세션에 완주할 수 있나"). 사용자가 구현에 쓸 모델을 지정하면 그 모델 기준 — 약한 모델일수록 잘게, 강한 모델이면 응집된 큰 단위.
- acceptance에는 그 변경을 검증하는 테스트가 포함된다. 예외는 ARCH에 테스트 제외 [o] 결정이 있을 때뿐.
- 각 태스크(FORMAT 골격): goal 1줄 / acceptance(검증 가능한 체크리스트) / impl notes(여기서 결정한 스키마·계약·라이브러리와 근거) / 인용줄에 st·ssot(관련 결정 ID)·base(`<ID>@rev`)·dep.
- dep 그래프와 순서를 정리한다. 기존 todo 태스크와 겹치면 todo는 수정(base 갱신), doing·done은 불변 — 후속 태스크로 만든다.

## 4. 마감
- `tasks/T###.<slug>.md` 작성 → STATE: tasks 행 추가, ssot `tasked=rev`·pending `-`, next=`implement-task T###`(dep상 첫 것), log 1줄.
- 보고: 태스크 목록과 순서 — novice에겐 각 태스크가 무엇을 만들어내는지 한 줄씩 설명.
