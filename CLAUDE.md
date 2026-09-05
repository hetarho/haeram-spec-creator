# haeram-spec-creator

스펙 주도 개발 스킬셋을 npm으로 배포하는 저장소. **산출물은 `skills/`의 SKILL.md들**이고, `src/`·`bin/`은 그걸 Claude(.claude/skills)·Codex(.codex/skills)에 설치/검증하는 CLI다.

## 구조
- `skills/<name>/SKILL.md` — 스킬 본문 (frontmatter `name`=폴더명, `description` 필수)
- `skills/<name>/agents/openai.yaml` — Codex 전용 메타 (Claude 설치 시 제외됨)
- `skills/create-architecture/assets/{STATE,FORMAT}.md` — 타겟 프로젝트 `spec/`에 복사되는 템플릿 (부트스트랩 정본)

## 스킬 설계 원칙 (수정 시 유지할 것)
1. 역할 분리: ideation=기획 전문가(능동 제안, 결정은 사용자), create-ssot/update-ssot=기획자(기획 질문만), create-task/implement-task=엔지니어(개발 질문만), create-narrative=작가. 서로의 영역을 침범하는 지시를 넣지 않는다.
2. 문서 먼저: 모든 스킬은 질문·추론·구현 전에 `spec/STATE.md`(관제탑)에 기록. 이 공통 규칙 4줄은 7개 스킬에 동일하게 반복돼 있다 — 바꾸면 전부. 예외 문구: create-architecture·ideation은 1번(자체 부트스트랩), create-narrative는 3·4번(사람용 한국어 산문).
3. cfg.level(expert/mid/novice)별 질문 방식이 각 스킬에 명시돼 있다.
4. 표기 규칙의 정본은 `assets/FORMAT.md`. 스킬이 새 표기를 쓰면 FORMAT에도 정의할 것.
5. 언어: spec 산출 문서(FORMAT/STATE 템플릿 포함)는 영어, SKILL.md 본문은 한국어. 스킬이 인용하는 문서 리터럴(`all`, 섹션명, log 문구 등)은 반드시 FORMAT의 영어 값과 일치시킬 것.

## 검증
- `npm run check` — 테스트 + 스킬 frontmatter/구조 검증 + 패키징 검증. 스킬 수정 후 항상 실행.
- 로컬 설치 테스트: `node ./bin/haeram-spec-creator.mjs install --target <경로>` 후 `check --target <경로>`.

## 배포
- main 푸시 시 release.yml이 자동 publish — 단 package.json 버전이 npm에 아직 없을 때만(가드 스텝이 건너뜀). 릴리스는 `npm version patch` 후 푸시.
- npm 인증은 Trusted Publishing(OIDC) — 토큰 시크릿 없음. npmjs.com 패키지 설정에 GitHub Actions(hetarho/haeram-spec-creator, release.yml)가 등록돼 있어야 한다.
