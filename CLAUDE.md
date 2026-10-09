# haeram-spec-creator

스펙 주도 개발 스킬셋을 npm으로 배포하는 저장소. **산출물은 `skills/`의 SKILL.md들**이고, `src/`·`bin/`은 Claude(.claude/skills)·Codex(.codex/skills) 설치/검증과 선택적 작업 묶음·worktree 실행 기록을 제공하는 CLI다.

## 구조
- `skills/<name>/SKILL.md` — 스킬 본문 (frontmatter `name`=폴더명, `description` 필수)
- `skills/<name>/agents/openai.yaml` — Codex 전용 메타 (Claude 설치 시 제외됨)
- `skills/create-architecture/assets/{STATE,FORMAT}.md` — 타겟 프로젝트 `spec/`에 복사되는 템플릿 (부트스트랩 정본)
- 스킬 11종: review-task · manage-work · ideation · create-architecture · create-ssot · update-ssot · create-task · implement-task · review-code · doc-review · create-narrative

## 스킬 설계 원칙 (수정 시 유지할 것)
1. 역할 분리: manage-work=기획 배정·검증·통합을 조정하는 작업 조정자, ideation=기획 전문가(능동 제안, 결정은 사용자), create-ssot/update-ssot=기획자(기획 질문만), create-task/implement-task=엔지니어(개발 질문만), review-task=제출 커밋을 독립적으로 검토하고 승인·수정 요청을 기록하는 리뷰어, review-code=시니어 엔지니어 리뷰어(리팩토링을 능동 제안, 채택은 사용자, 코드는 안 고침), doc-review=편집자(의미 보존 편집만, 정책 변경은 update-ssot로), create-narrative=작가. 서로의 영역을 침범하는 지시를 넣지 않는다. 제안→전환 대칭: ideation→create-ssot(기획), review-code→create-task(개발), doc-review→update-ssot(문서).
2. 문서 먼저: 모든 스킬은 질문·추론·구현 전에 `spec/STATE.md`(checkout별 진행 기록)에 기록. 작업 묶음의 워커는 STATE를 쓰지 않고 CLI runtime에 기록한다. STATE 수정은 원자적 선점이나 worktree 간 조정 수단이 아니다. 이 공통 규칙 5줄은 11개 스킬에 동일하게 반복돼 있다 — 바꾸면 전부(특히 5번 읽기 규칙은 11곳 모두 한 글자까지 같다). 예외 문구: create-architecture·ideation은 1번(자체 부트스트랩), create-narrative는 3·4번(사람용 한국어 산문).
3. cfg.level(expert/mid/novice)별 질문 방식이 각 스킬에 명시돼 있다.
4. 표기 규칙의 정본은 `assets/FORMAT.md`. 스킬이 새 표기를 쓰면 FORMAT에도 정의할 것. 문서 골격은 세 곳이 함께 움직인다 — FORMAT의 골격 줄, 각 스킬의 assets 템플릿(ssot/task/ideation/review), `src/spec-lint.mjs`의 검사 규칙. 하나를 바꾸면 셋 다 바꾼다. 결정은 한 줄이 아니라 **결정 블록**(머리줄 + 2칸 들여쓴 하위 항목·표)이다: lint가 하위 줄을 결정 라인으로 오해하면 복잡한 계약을 한 줄로 뭉개게 만든다(0.2.3까지의 실제 원인).
5. SSOT 순수성: ssot/에는 지금 지켜야 하는 규칙(결정·이유·제약·chg)만 남고 요청·대화 흔적은 남지 않는다(FORMAT 원칙 6이 정본). create-ssot·update-ssot §3의 "최종 점검" 체크리스트는 두 스킬에 동일하게 반복돼 있다 — 바꾸면 둘 다.
6. lint의 세 층을 섞지 않는다: **오류**=구조 위반(형식·참조·골격) · **경고**=정합성 흔들림(rev/tasked, chg 연속성, 빈 result) · **검토 후보(reviewHints)**=의미 품질 신호로 종료 코드에 영향이 없고 doc-review가 판단한다. 검토 후보를 오류로 올리면 "경고를 없애려고 줄을 합치거나 기계적으로 쪼개는" 회피가 생긴다 — 길이 신호는 블록 전체가 아니라 **한 줄** 길이만 센다(합치면 더 걸리고, 펴면 사라진다).
7. 완료 태스크(`tasks/done/`)는 보존 대상 역사 기록이다. 채번·dep 판정은 파일명만 보고, 내용은 선택 조회만. 현재 규칙의 근거로 쓰지 않는다.
8. 작업 묶음의 배정·리뷰·통합 단위는 **lane**(lane 없는 태스크는 단독 단위)이다. 단위는 바깥 dep이 모두 통합된 뒤에만 시작하고 안쪽 dep은 같은 worktree에서 순서대로 처리한다 — 서로 기다리는 줄기(단위 그래프 순환)는 lint/board 오류로 기획 단계에서 막는다. 세션·오케스트레이터 에이전트는 모두 같은 `work next` 루프를 돌며 구현·리뷰만 하고, 통합·묶음 검증 같은 기계적 관문은 CLI가 백그라운드 프로세스로 실행한다(모델 턴을 쓰지 않음). 검증은 태스크(변경 영향 테스트, `HAERAM_DIFF_BASE`)·단위(integrate 전체)·묶음(finish) 3단계로 묶음에 저장되며, 태스크 단계에 전체 스위트를 다시 넣지 않는다. 그룹 브랜치를 움직이는 통합·sync·finish만 서로 배타적이고, 승인은 겹치지 않는 상위 변경에 유지된다.
9. 언어: spec 산출 문서(FORMAT/STATE 템플릿 포함)는 영어, SKILL.md 본문은 한국어. 스킬이 인용하는 문서 리터럴(`all`, 섹션명, log 문구 등)은 반드시 FORMAT의 영어 값과 일치시킬 것.

## 검증
- `npm run check` — 테스트 + 스킬 frontmatter/구조 검증 + 패키징 검증. 스킬 수정 후 항상 실행.
- 로컬 설치 테스트: `node ./bin/haeram-spec-creator.mjs install --target <경로>` 후 `check --target <경로>`.
- `lint --target <경로>` — 타겟 프로젝트 spec/의 FORMAT 불변식 검사(ID·st 형식, rev/tasked 정합, 참조 무결성, chg 연속성, 고아 파일, SSOT 골격 밖 섹션·산문). `--hints`로 검토 후보 전체 출력(기본 10건).

## 배포
- main 푸시 시 release.yml이 자동 publish — 단 package.json 버전이 npm에 아직 없을 때만(가드 스텝이 건너뜀). 릴리스는 `npm version patch` 후 푸시.
- npm 인증은 Trusted Publishing(OIDC) — 토큰 시크릿 없음. npmjs.com 패키지 설정에 GitHub Actions(hetarho/haeram-spec-creator, release.yml)가 등록돼 있어야 한다.
