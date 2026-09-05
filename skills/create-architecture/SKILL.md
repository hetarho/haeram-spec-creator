---
name: create-architecture
description: >-
  spec 시스템 초기화 + 아키텍처 SSOT(spec/ssot/ARCH.md) 작성. 새 프로젝트를 시작할 때, spec/이 아직
  없을 때, "아키텍처 잡아줘 / 스택 정해줘 / 프로젝트 세팅하자" 요청일 때 사용. 인터뷰로 스택·구조·
  컨벤션·검증 명령을 결정해 이후 모든 태스크가 따를 기준을 만든다. 코드 구현은 하지 않는다
  (그건 implement-task). 기존 ARCH 수정도 이 스킬로.
---

# create-architecture — 초기화 + 아키텍처 SSOT

**역할: 엔지니어.** 기술 결정을 이끈다. 단, 무엇을 만들지(기획)는 정하지 않는다 — 그건 create-ssot의 기획자 몫.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. (이 스킬만 예외: 없으면 0단계 부트스트랩.)
2. **문서 먼저**: 질문·추론·구현을 시작하기 전에 STATE.md에 시작을 기록하고(log 1줄 + 해당 st), 상태가 바뀔 때마다 즉시 반영한다. 병렬 세션은 STATE.md로만 서로를 안다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.

## 0. 부트스트랩 (spec/ 없을 때만)
1. `spec/ssot/`, `spec/tasks/` 생성. 이 스킬 폴더의 `assets/STATE.md`, `assets/FORMAT.md`를 `spec/`으로 복사. log에 `- YYMMDD create-architecture start (spec init)` 1줄 — 이것이 공통 규칙 2의 시작 기록이다.
2. level 캘리브레이션 — 첫 질문으로 묻는다:
   - a) **expert** — 용어로 빠르게. 세부 기술까지 내가 직접 결정
   - b) **mid** — 선택지와 장단점을 보고 내가 결정
   - c) **novice** — 뭘 만들지만 말하면 기술은 알아서
   cfg의 `?`를 답으로 교체(level = 답, lang = 대화 언어).

spec/이 이미 있으면 0단계 생략, ARCH 개정 모드 — 진행과 마감 모두 update-ssot와 동일 규칙(rev+1·chg·STATE pending·[?] 갱신).

## 1. 컨텍스트
- ssot/에 기획 SSOT가 있으면 읽는다. 없으면 "무엇을 만드는지 한 줄"만 묻는다 — 상세 기획은 create-ssot로 미룬다.
- 기존 코드베이스면 스택을 스캔(package.json, 디렉토리 구조 등). 이미 정해진 것은 묻지 않고 기록만 한다.

## 2. 아키텍처 인터뷰 (level별)
결정할 것: 플랫폼(웹/앱/API) · 스택 · 데이터 저장 · 인증 방식 · 폴더 구조와 컨벤션 · 테스트 정책 · verify 명령(test·lint·format 각각) · CI/CD · 배포/인프라.
- **expert**: 이름만 나열해 묻는다. "스택? Next 15 / Remix / SvelteKit / 기타" "DB? PG / SQLite / Mongo". 인덱스·캐시·모노레포 여부 같은 세부도 직접 묻는다.
- **mid**: 선택지 + 장단점 각 1줄. "PG(관계·확장에 강함, 서버 필요) vs SQLite(운영 제로, 단일 서버 한정)".
- **novice**: 기술명으로 묻지 않는다. "사용자가 몇 명쯤 될까요? / 서버 비용을 쓸 수 있나요? / 폰에서도 쓰나요?" 같은 결과 수준 질문 → 답으로 AI가 스택을 결정하고 "데이터는 ○○에 저장할게요 — 무료로 시작 가능해요" 식으로 한 줄씩 보고만.

사용자가 답을 모르면 강요하지 말고 [?]로 등록하고 진행한다.

## 3. ssot/ARCH.md 작성
FORMAT 골격(r1). ARCH-n 결정으로: 스택 / 폴더 구조(트리 압축) / 데이터 저장·스키마 원칙 / 코드 컨벤션(네이밍·상태관리·에러 처리) / 테스트 정책 / verify 명령(test·lint·format) / CI/CD / 배포. 근거(←)는 트레이드오프가 있던 결정에만 붙인다. verify 명령은 백틱 코드로, 설명을 섞지 않은 실행 가능한 형태 그대로 적는다. **테스트는 기본 의무** — 빼려면 ARCH에 명시적 [o] 결정으로만 가능하고, 그 결정이 없으면 모든 태스크의 acceptance에 테스트가 요구된다.

## 4. 마감
- STATE: ssot 행 `ARCH | 1 | 0 | all | <[?] 수>` (스캐폴딩도 태스크로 만들 것이므로 tasked=0), next = 기획 SSOT 없으면 `create-ssot`, 있으면 `create-task ARCH`, log 1줄.
- 보고는 cfg.level대로 — novice: 무엇을 결정했고 이제 뭘 할 수 있는지 풀어서 / expert: 결정 목록만.
