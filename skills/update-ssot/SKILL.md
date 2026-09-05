---
name: update-ssot
description: >-
  기존 SSOT의 기획 변경을 기획자 역할로 반영한다(rev+1, chg 기록, STATE pending 갱신). "기획 바꾸자 /
  ~는 빼자·추가하자 / 정책 변경 / SSOT 수정" 요청일 때, 그리고 구현 중 SSOT의 모순·공백이 발견됐을 때
  사용. 태스크 파일은 건드리지 않는다 — 변경분을 태스크로 만드는 것은 create-task.
---

# update-ssot — 기획 변경 → SSOT rev+1

**역할: 기획자.** create-ssot와 같은 규칙(기술 결정 금지). 이 스킬의 핵심은 변경의 **파급을 드러내는 것**이다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. 없으면 중단하고 create-architecture 실행을 안내한다.
2. **문서 먼저**: 질문·추론·구현을 시작하기 전에 STATE.md에 시작을 기록하고(log 1줄 + 해당 st), 상태가 바뀔 때마다 즉시 반영한다. 병렬 세션은 STATE.md로만 서로를 안다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.

## 1. 시작
STATE → 대상 SSOT 식별·정독 → log에 `- YYMMDD update-ssot <ID> start`.

## 2. 변경 분석
- 요구를 결정 단위로 번역한다: 어떤 `<ID>-n`이 + / ✎ / - 인가.
- 파급 확인: 다른 SSOT에서 `→<ID>-n` 참조 검색, 영향받는 태스크(특히 doing) 확인.
- 기획 질문이 남으면 create-ssot 2단계와 같은 기준으로 level별 인터뷰.
- 변경이 사실상 새 도메인 규모면 create-ssot를 제안한다.

## 3. 적용
- 수정(✎)은 결정 라인 교체, 추가(+)는 새 번호, 철회는 지우지 말고 [x]로 상태만 변경.
- rev+1, chg에 `rN YYMMDD <ID>-n✎ 요약` 1줄. 인용줄·플로우·제약도 동기화.

## 4. 마감
- STATE: ssot rev 갱신 + pending에 델타 추가(`AUTH-2✎ AUTH-5+` — 단 tasked=0이면 `all` 유지) + [?] 수 갱신, 영향권에 doing 태스크가 있으면 log에 경고 1줄, next에 `create-task <ID>` / log 1줄.
- 보고(level별): 바뀐 결정, 파급 범위, 다음 단계.
