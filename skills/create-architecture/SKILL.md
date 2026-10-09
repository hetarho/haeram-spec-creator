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
2. **문서 먼저**: 쓰기 전에 `npx haeram-spec-creator work status --json`으로 배정을 확인한다(CLI가 없으면 Git checkout과 사용자의 배정을 확인). 단독/기획 공간에서는 STATE에 시작과 상태 변화를 기록한다. 작업 묶음의 워커는 STATE·SSOT를 수정하지 않고 실행 상태를 CLI로 기록하며, 자신의 태스크 acceptance·result만 갱신한다. 리뷰 공간에서는 코드·spec을 수정하지 않고 리뷰 runtime만 갱신한다. 브랜치명은 소유권 근거가 아니다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.
5. **읽기**(FORMAT Reading): 한 번에 한 문서씩, 큰 문서는 섹션 단위로 읽는다. 마지막 섹션(ssot=`## chg`, task=`## result`)이 안 보이면 출력이 잘린 것이다 — 누락 범위를 다시 읽고 나서 판단한다. tasks/done/은 역사 기록이라 일괄로 읽지 않고, 특정 태스크·회귀 원인·이전 검증을 찾을 때만 연다.

## 0. 부트스트랩 (spec/ 없을 때만)
1. `spec/ssot/`, `spec/tasks/` 생성. 이 스킬 폴더의 `assets/STATE.md`, `assets/FORMAT.md`를 `spec/`으로 복사. log에 `- YYMMDD create-architecture start (spec init)` 1줄 — 이것이 공통 규칙 2의 시작 기록이다.
2. level 캘리브레이션 — 첫 질문으로 묻는다:
   - a) **expert** — 용어로 빠르게. 세부 기술까지 내가 직접 결정
   - b) **mid** — 선택지와 장단점을 보고 내가 결정
   - c) **novice** — 뭘 만들지만 말하면 기술은 알아서
   cfg의 `?`를 답으로 교체(level = 답, lang = 대화 언어).

spec/이 이미 있으면 0단계 생략, ARCH 개정 모드 — 진행과 마감 모두 update-ssot와 동일 규칙(rev+1·chg·STATE pending·[?] 갱신).

작업 묶음의 워커에서 호출됐다면 이 스킬의 문서 쓰기 절차는 기획 공간으로 인계한다. `manage-work`가 반환한 group.path가 기획·채번·문서 정리 위치이며, 워커 checkout의 STATE·SSOT를 변경하지 않는다.

작업 묶음의 ARCH 개정은 공유 보드의 활성 attempt에도 영향을 줄 수 있다. 영향을 보고하고, 변경 후 워커의 동기화·재검증을 요구한다.

## 1. 컨텍스트
- ssot/에 기획 SSOT가 있으면 읽는다. 없으면 "무엇을 만드는지 한 줄"만 묻는다 — 상세 기획은 create-ssot로 미룬다.
- 기존 코드베이스면 스택을 스캔(package.json, 디렉토리 구조 등). 이미 정해진 것은 묻지 않고 기록만 한다.

## 2. 아키텍처 인터뷰 (level별)
결정할 것: 플랫폼(웹/앱/API) · 스택 · 데이터 저장 · 인증 방식 · 폴더 구조와 컨벤션 · 테스트 정책 · verify 명령(test·lint·format 각각)과 검증 단계 · CI/CD · 배포/인프라.
- **expert**: 이름만 나열해 묻는다. "스택? Next 15 / Remix / SvelteKit / 기타" "DB? PG / SQLite / Mongo". 인덱스·캐시·모노레포 여부 같은 세부도 직접 묻는다.
- **mid**: 선택지 + 장단점 각 1줄. "PG(관계·확장에 강함, 서버 필요) vs SQLite(운영 제로, 단일 서버 한정)".
- **novice**: 기술명으로 묻지 않는다. "사용자가 몇 명쯤 될까요? / 서버 비용을 쓸 수 있나요? / 폰에서도 쓰나요?" 같은 결과 수준 질문 → 답으로 AI가 스택을 결정하고 "데이터는 ○○에 저장할게요 — 무료로 시작 가능해요" 식으로 한 줄씩 보고만.

사용자가 답을 모르면 강요하지 말고 [?]로 등록하고 진행한다.

## 3. ssot/ARCH.md 작성
create-ssot 스킬 폴더의 assets/ssot.md 템플릿을 `spec/ssot/ARCH.md`로 복사해 시작한다(r1). ARCH-n 결정으로: 스택 / 폴더 구조(트리 압축) / 데이터 저장·스키마 원칙 / 코드 컨벤션(네이밍·상태관리·에러 처리) / 테스트 정책 / verify 명령(test·lint·format) / CI/CD / 배포. 근거(←)는 트레이드오프가 있던 결정에만 붙인다. 폴더 구조·컨벤션처럼 항목이 여러 개인 결정은 한 줄로 늘이지 말고 결정 블록(2칸 들여쓴 하위 항목·표)으로 편다. verify 명령은 백틱 코드로, 설명을 섞지 않은 실행 가능한 형태 그대로 적는다. 테스트가 많아 전체 실행이 느린 프로젝트면 검증 단계를 결정 블록으로 나눈다: 태스크(그 태스크가 추가·수정한 테스트와 영향받는 기존 테스트 + 빠른 lint·타입 검사) / 단위 통합(전체 test — 작업 묶음의 `work integrate --verify`) / 묶음 완료·push 전(CI 재현 — `work finish --verify`). 단계를 나누지 않으면 모든 태스크가 verify 전체를 실행한다. 태스크 단계 명령은 CLI가 넘겨주는 `$HAERAM_DIFF_BASE`로 영향받는 테스트를 고를 수 있다(예 `git diff --name-only "$HAERAM_DIFF_BASE" HEAD`를 테스트 러너의 related/changed 옵션에 전달). **테스트는 기본 의무** — 빼려면 ARCH에 명시적 [o] 결정으로만 가능하고, 그 결정이 없으면 모든 태스크의 acceptance에 테스트가 요구된다.

## 4. 마감
- STATE: ssot 행 `ARCH | 1 | 0 | all | <[?] 수>` (스캐폴딩도 태스크로 만들 것이므로 tasked=0), next = 기획 SSOT 없으면 `create-ssot`, 있으면 `create-task ARCH`, log 1줄.
- 보고는 cfg.level대로 — novice: 무엇을 결정했고 이제 뭘 할 수 있는지 풀어서 / expert: 결정 목록만.
