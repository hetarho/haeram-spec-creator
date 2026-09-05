# haeram-spec-creator

아이디어를 구현 가능한 스펙으로 발전시키고, **요구사항 → 설계 → 작업 계획 → 구현 → 검증**을 일관된 흐름으로 연결하는 스펙 주도 개발(Spec-Driven Development)용 Agent Skills 모음입니다.

Claude Code와 Codex가 바로 코드를 작성하기 전에 목표, 범위, 제약, 결정 사항, 완료 조건을 먼저 명확히 하고 각 단계의 결과를 다음 단계의 입력으로 이어 가도록 돕습니다. 이 저장소의 핵심은 라이브러리 API가 아니라 AI 에이전트가 필요할 때 불러 쓰는 스킬이며, npm 패키지는 여러 프로젝트에 그 스킬을 안전하게 설치하고 동기화하기 위한 배포 수단입니다.

> [!IMPORTANT]
> 스킬 6종(`create-architecture`, `create-ssot`, `update-ssot`, `create-task`, `implement-task`, `create-narrative`)은 `skills/`에 포함되어 있지만 아직 npm에는 배포 전입니다. 배포 전에는 이 저장소를 클론한 뒤 `node ./bin/haeram-spec-creator.mjs install --target <프로젝트 경로>`로 설치할 수 있습니다.

## 핵심 개념

이 스킬셋은 세 가지 원칙 위에 설계되어 있습니다.

1. **역할 분리** — SSOT(기획)는 **기획자** 역할의 에이전트가 기획 관점 질문(목적·타겟·범위·플로우·정책)으로 만들고, 태스크(구현 계획)는 **엔지니어** 역할의 에이전트가 개발 관점 질문(데이터 모델·API·엣지·마이그레이션)으로 만듭니다. 기획 문서에 기술 결정이, 구현 단계에 기획 재논의가 섞이지 않습니다.
2. **사용자 수준 적응** — 최초 1회 캘리브레이션으로 `expert / mid / novice`를 정하면 모든 질문과 보고가 그 수준에 맞춰집니다. expert에게는 선택지를 용어로만 나열하고 세부·엣지까지 직접 묻고, mid에게는 선택지에 장단점을 한 줄씩 붙이고, novice에게는 기술명 대신 "무엇이 어떻게 되는지"를 물은 뒤 기술 결정은 에이전트가 내리고 한 줄로 보고합니다.
3. **문서 먼저** — 모든 스킬은 질문·추론·구현을 시작하기 전에 관제탑 문서(`spec/STATE.md`)에 시작을 기록하고, 상태가 바뀌는 즉시 반영합니다. 병렬 세션들은 이 파일 하나로 서로의 상황을 파악하므로 어떤 세션에서든 "다음 태스크 구현해줘", "SSOT 변경분 태스크로 쪼개줘"가 바로 통합니다.

## 개발 흐름

| 순서 | 스킬 | 역할 | 하는 일 | 산출물 |
| --- | --- | --- | --- | --- |
| 0 | `create-architecture` | 엔지니어 | `spec/` 초기화 + 사용자 수준 캘리브레이션 + 아키텍처 인터뷰 | `spec/STATE.md` `spec/FORMAT.md` `spec/ssot/ARCH.md` |
| 1 | `create-ssot` | 기획자 | 기획 인터뷰로 도메인 SSOT 작성 | `spec/ssot/<ID>.md` |
| 수시 | `update-ssot` | 기획자 | 기획 변경 반영 — rev+1, 변경 로그, 파급 표시 | 갱신된 SSOT + STATE pending |
| 2 | `create-task` | 엔지니어 | SSOT 변경분(pending)을 개발 인터뷰와 함께 태스크로 분해 | `spec/tasks/T###.md` |
| 3 | `implement-task` | 엔지니어 | 태스크 선점(doing) → 구현 → 검증(test·lint·format·CI/CD) → done | 코드 + 갱신된 태스크/STATE |
| 필요시 | `create-narrative` | 작가 | spec 전체를 사람이 읽기 좋은 한국어 이야기로 엮음 | `spec/NARRATIVE.md` |

설치된 프로젝트에는 다음 구조가 생깁니다.

```text
spec/
├── STATE.md      # 관제탑: cfg(사용자 수준) · SSOT rev 현황 · 태스크 보드 · next · log
├── FORMAT.md     # 모든 spec 문서의 압축 표기 규칙 (ID, 기호, 골격, 상태 규칙)
├── ssot/         # 도메인별 SSOT — 결정([o]/[?]/[x])과 근거만, rev로 변경 추적
└── tasks/        # 태스크 — 완료기준·구현메모·결과, SSOT rev 스탬프(base)로 신선도 검증
```

SSOT의 `rev`(현재 개정)와 STATE의 `tasked`(태스크로 소화된 개정)의 차이가 곧 "아직 구현 계획에 반영되지 않은 기획 변경"입니다. 그래서 어느 세션에서든 "SSOT 변경사항 태스크로 쪼개줘"라고만 해도 에이전트가 무엇이 어떻게 바뀌었는지 스스로 찾아냅니다.

모든 `spec/` 문서는 AI의 오독 방지와 토큰 효율을 위해 영어로 작성됩니다. 인터뷰·확인·최종 보고는 사용자의 언어(`cfg.lang`)로 진행됩니다. 유일한 예외는 `spec/NARRATIVE.md`입니다 — `create-narrative`가 spec 전체를 엮어 만드는 사람용 산문으로, 사용자의 언어로 쓰이며 새로운 결정을 담지 않는 파생 문서입니다.

스펙은 구현 전에 한 번 작성하고 버리는 문서가 아닙니다. 구현 중 발견한 제약과 결정까지 계속 반영하는 기준점이며, 에이전트는 이 기록을 바탕으로 맥락을 잃지 않고 다음 단계를 진행합니다.

## 빠른 시작

### 1. 에이전트에게 설치 요청하기

Claude Code나 Codex를 설치하려는 프로젝트에서 열고 다음 프롬프트를 붙여 넣으세요.

```text
이 프로젝트에 haeram-spec-creator를 설치해줘.
저장소 https://github.com/hetarho/haeram-spec-creator 의 README와 package.json을 먼저 확인하고,
이 프로젝트의 개발 의존성으로 추가한 뒤 Claude Code와 Codex 양쪽에서 쓸 수 있게 설정해줘.

실제 파일을 변경하기 전에 dry-run으로 설치 계획과 충돌 여부를 확인하고,
기존 스킬과 충돌하면 덮어쓰지 말고 나에게 알려줘.
설치 후에는 포함된 스킬 목록과 동기화 상태까지 검증해줘.
```

에이전트가 제시한 변경 계획을 확인한 뒤 실행을 승인하면 됩니다.

### 2. 새 세션 시작하기

설치된 스킬이 발견되도록 Claude Code나 Codex 세션을 다시 시작합니다. 스킬은 요청 내용과 `SKILL.md`의 설명이 일치하면 에이전트가 자동으로 불러오며, 필요할 때 스킬 이름을 직접 지정할 수도 있습니다.

### 3. 만들려는 것을 설명하기

명령어를 외우기보다 평소처럼 원하는 결과를 설명하면 됩니다. 스킬 이름을 직접 불러도 됩니다.

```text
새 프로젝트야. spec을 초기화하고 아키텍처부터 잡아줘.   → create-architecture
```

```text
사용자가 저장한 글을 태그로 분류하는 기능을 기획하고 싶어.  → create-ssot
```

```text
무료 플랜에도 태그 기능 열어주는 걸로 기획 바꾸자.        → update-ssot
```

```text
SSOT 변경사항 태스크로 쪼개줘.                        → create-task
```

```text
다음 태스크 구현해줘.                                → implement-task
```

## 직접 설치하기

에이전트 대신 명령어를 직접 실행하려면 다음 방법을 사용합니다.

### npm

```bash
npm install --save-dev haeram-spec-creator
npx haeram-spec-creator install --dry-run
npx haeram-spec-creator install
npx haeram-spec-creator check
```

### pnpm

```bash
pnpm add --save-dev haeram-spec-creator
pnpm exec haeram-spec-creator install --dry-run
pnpm exec haeram-spec-creator install
pnpm exec haeram-spec-creator check
```

기본 설치 대상은 현재 프로젝트의 Claude Code와 Codex입니다.

```text
<project>/
├── .claude/skills/<skill-name>/...
├── .codex/skills/<skill-name>/...
└── .haeram-spec-creator-lock.json
```

잠금 파일에는 이 패키지가 설치한 파일과 해시만 기록합니다. 다른 스킬 폴더는 건드리지 않으며, 프로젝트에서 직접 수정한 파일과 충돌하면 설치를 중단합니다.

<details>
<summary>CLI 명령 보기</summary>

```bash
# 포함된 스킬 확인
npx haeram-spec-creator list

# Claude Code와 Codex 양쪽에 설치
npx haeram-spec-creator install

# 한 에이전트에만 설치
npx haeram-spec-creator install --agent claude
npx haeram-spec-creator install --agent codex

# 다른 프로젝트를 대상으로 설치
npx haeram-spec-creator install --target ../my-project

# 파일을 바꾸지 않고 설치 계획 확인
npx haeram-spec-creator install --dry-run

# 설치본이 현재 패키지와 같은지 확인
npx haeram-spec-creator check

# 충돌한 로컬 파일을 패키지 버전으로 명시적으로 교체
npx haeram-spec-creator install --force
```

`--force`는 로컬 수정 내용을 덮어쓸 수 있으므로 충돌 내용을 확인한 뒤 사용하세요.

</details>

## 스킬 구조

스킬은 [Agent Skills 공개 형식](https://agentskills.io/)을 따르며 하나의 공통 원본으로 관리합니다.

```text
skills/
└── <skill-name>/
    ├── SKILL.md                 # 필수: 발견 정보와 핵심 지침
    ├── agents/
    │   └── openai.yaml          # 선택: Codex용 메타데이터
    ├── scripts/                 # 선택: 반복 작업용 실행 코드
    ├── references/              # 선택: 필요할 때만 읽는 상세 지침
    └── assets/                  # 선택: 결과물에 사용하는 템플릿과 리소스
```

`SKILL.md`에는 폴더명과 같은 `name`, 그리고 스킬이 무엇을 하며 언제 사용해야 하는지를 설명하는 `description`이 필요합니다.

```yaml
---
name: create-spec
description: 기능 아이디어를 검증 가능한 요구사항과 수용 기준이 포함된 스펙으로 구체화합니다. 새 기능을 정의하거나 기존 요구사항의 모호함을 정리할 때 사용합니다.
---
```

에이전트는 먼저 이름과 설명만 보고 관련 스킬을 찾고, 필요할 때 `SKILL.md`와 참조 자료를 단계적으로 읽습니다. 따라서 공통 핵심 지침은 `SKILL.md`에, 특정 상황에서만 필요한 상세 내용은 `references/`에 둡니다.

## 저장소 개발

```bash
npm install
npm test
npm run validate
npm run check
```

- `npm run validate`: 추가된 스킬의 구조와 frontmatter를 검사합니다. 개발 중에는 빈 `skills/`도 허용합니다.
- `npm run check`: 테스트, 스킬 검증, 실제 npm tarball에 포함될 파일을 함께 확인합니다.
- `npm run release:check`: 스킬이 하나 이상 있는지까지 검사합니다.
- `prepublishOnly`: 배포 직전에 `release:check`를 다시 실행합니다.

### 릴리스

`package.json`의 버전을 올려 `main`에 푸시하면 GitHub Actions(`release.yml`)가 npm에 자동 배포합니다. 이미 배포된 버전이면 배포를 건너뛰므로, 버전을 올리지 않은 일반 푸시는 안전합니다.

```bash
npm version patch   # 또는 minor / major — 버전 커밋과 태그가 함께 생성됩니다
git push origin main --follow-tags
```

## 라이선스

[MIT](./LICENSE)
