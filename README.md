# haeram-spec-creator

아이디어를 구현 가능한 스펙으로 발전시키고, **요구사항 → 설계 → 작업 계획 → 구현 → 검증**을 일관된 흐름으로 연결하는 스펙 주도 개발(Spec-Driven Development)용 Agent Skills 모음입니다.

Claude Code와 Codex가 바로 코드를 작성하기 전에 목표, 범위, 제약, 결정 사항, 완료 조건을 먼저 명확히 하고 각 단계의 결과를 다음 단계의 입력으로 이어 가도록 돕습니다. 이 저장소의 핵심은 라이브러리 API가 아니라 AI 에이전트가 필요할 때 불러 쓰는 스킬이며, npm 패키지는 여러 프로젝트에 그 스킬을 안전하게 설치하고 동기화하기 위한 배포 수단입니다.

> [!IMPORTANT]
> 현재는 초기 개발 단계입니다. 설치·검증·패키징 CLI는 준비되어 있지만 실제 스펙 주도 개발 스킬은 아직 `skills/`에 추가되지 않았고 npm에도 배포 전입니다. 아래 빠른 시작은 첫 스킬 릴리스 이후의 사용 흐름을 기준으로 합니다.

## 개발 흐름

| 단계 | 에이전트가 돕는 일 | 남기는 결과 |
| --- | --- | --- |
| 요구사항 | 만들려는 이유, 사용자 시나리오, 범위와 제외 범위를 정리합니다. | 합의 가능한 스펙 |
| 설계 | 기술 선택, 제약, 대안과 트레이드오프를 구체화합니다. | 구현 설계 |
| 작업 계획 | 구현 순서와 검증 가능한 단위로 작업을 나눕니다. | 실행 가능한 작업 목록 |
| 구현 | 합의한 스펙과 계획을 기준으로 코드를 변경합니다. | 추적 가능한 구현 |
| 검증 | 테스트와 수용 기준으로 결과를 확인하고 차이를 스펙에 반영합니다. | 검증 결과와 최신 스펙 |

스펙은 구현 전에 한 번 작성하고 버리는 문서가 아닙니다. 개발 중 발견한 제약과 결정까지 계속 반영하는 기준점이며, 에이전트는 이 기록을 바탕으로 맥락을 잃지 않고 다음 단계를 진행합니다.

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

명령어를 외우기보다 평소처럼 원하는 결과를 설명하면 됩니다.

```text
사용자가 저장한 글을 태그로 분류하는 기능을 추가하고 싶어.
바로 구현하지 말고 스펙 주도 개발 흐름으로 요구사항부터 정리해줘.
```

```text
이 기능의 스펙과 현재 코드를 비교해서 빠진 요구사항과 모호한 완료 조건을 찾아줘.
```

```text
합의된 스펙을 기준으로 구현 계획을 세우고, 각 작업의 검증 방법까지 포함해줘.
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

## 라이선스

[MIT](./LICENSE)
