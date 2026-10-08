# haeram-spec-creator

아이디어를 구현 가능한 스펙으로 발전시키고, **요구사항 → 설계 → 작업 계획 → 구현 → 검증**을 일관된 흐름으로 연결하는 스펙 주도 개발(Spec-Driven Development)용 Agent Skills 모음입니다.

Claude Code와 Codex가 바로 코드를 작성하기 전에 목표, 범위, 제약, 결정 사항, 완료 조건을 먼저 명확히 하고 각 단계의 결과를 다음 단계의 입력으로 이어 가도록 돕습니다. 이 저장소의 핵심은 라이브러리 API가 아니라 AI 에이전트가 필요할 때 불러 쓰는 스킬이며, npm 패키지는 여러 프로젝트에 그 스킬을 안전하게 설치하고 동기화하기 위한 배포 수단입니다.

> [!TIP]
> [npm에 배포되어 있어](https://www.npmjs.com/package/haeram-spec-creator) 바로 설치할 수 있습니다 — `npm install --save-dev haeram-spec-creator && npx haeram-spec-creator install`. 스킬 11종: `review-task` · `manage-work` · `ideation` · `create-architecture` · `create-ssot` · `update-ssot` · `create-task` · `implement-task` · `review-code` · `doc-review` · `create-narrative`.

## 핵심 개념

이 스킬셋은 네 가지 원칙 위에 설계되어 있습니다.

1. **역할 분리** — SSOT(기획)는 **기획자** 역할의 에이전트가 기획 관점 질문(목적·타겟·범위·플로우·정책)으로 만들고, 태스크(구현 계획)는 **엔지니어** 역할의 에이전트가 개발 관점 질문(데이터 모델·API·엣지·마이그레이션)으로 만듭니다. 기획 문서에 기술 결정이, 구현 단계에 기획 재논의가 섞이지 않습니다. 기획 쪽에 변경을 제안하는 `ideation`이 있듯, 개발 쪽에는 코드 품질을 대변해 리팩토링을 주장하는 **리뷰어**(`review-code`)가, 문서 쪽에는 의미를 보존하며 문장을 다듬는 **편집자**(`doc-review`)가 있습니다 — 채택은 언제나 사용자가 합니다.
2. **사용자 수준 적응** — 최초 1회 캘리브레이션으로 `expert / mid / novice`를 정하면 모든 질문과 보고가 그 수준에 맞춰집니다. expert에게는 선택지를 용어로만 나열하고 세부·엣지까지 직접 묻고, mid에게는 선택지에 장단점을 한 줄씩 붙이고, novice에게는 기술명 대신 "무엇이 어떻게 되는지"를 물은 뒤 기술 결정은 에이전트가 내리고 한 줄로 보고합니다.
3. **문서 먼저** — 단독 작업과 기획 공간은 진행 문서(`spec/STATE.md`)에 시작과 상태 변화를 기록합니다. 작업 묶음의 워커는 공유 실행 기록에 상태를 남깁니다. 세션을 이어 받아도 "다음 태스크 구현해줘", "SSOT 변경분 태스크로 쪼개줘"가 통하도록 현재 checkout의 맥락을 보존합니다. STATE 수정은 원자적 선점이 아니며, 다른 worktree의 변경은 자동으로 공유되지 않습니다.
4. **정책 단위 문서** — SSOT의 한 결정은 **독립적으로 이해하고 검증할 수 있는 정책 하나**입니다. 조건이 많으면 줄을 합치지 않고 하위 항목이나 표로 폅니다(줄바꿈을 없애는 것은 간결화가 아닙니다). 대신 누가 언제 요청했는지, 과거 논의와 폐기된 방식의 상세, 미사여구는 남기지 않습니다 — 호환성·실패 조건·보안·과금·수치와 단위·부정 표현·필요한 근거는 반대로 반드시 남깁니다. 구조는 `lint`가 강제하고, 의미 품질은 `lint`가 **검토 후보**로만 표시한 뒤 `doc-review`가 사람과 함께 판단합니다.

## 개발 흐름

| 순서 | 스킬 | 역할 | 하는 일 | 산출물 |
| --- | --- | --- | --- | --- |
| 아이디어 | `ideation` | 기획 전문가 | 흐릿한 아이디어를 발산·수렴 루프로 함께 구체화, SSOT 전환용 도메인 분할까지 | `spec/ideation/<slug>.md` |
| 0 | `create-architecture` | 엔지니어 | `spec/` 초기화 + 사용자 수준 캘리브레이션 + 아키텍처 인터뷰 | `spec/STATE.md` `spec/FORMAT.md` `spec/ssot/ARCH.md` |
| 1 | `create-ssot` | 기획자 | 기획 인터뷰로 도메인 SSOT 작성 | `spec/ssot/<ID>.md` |
| 수시 | `update-ssot` | 기획자 | 기획 변경 반영 — rev+1, 변경 로그, 파급 표시 | 갱신된 SSOT + STATE pending |
| 2 | `create-task` | 엔지니어 | SSOT 변경분(pending)과 채택된 리뷰 finding을 개발 인터뷰와 함께 태스크로 분해 | `spec/tasks/T###.md` |
| 3 | `implement-task` | 엔지니어 | 태스크 선점(doing) → 구현 → 검증(test·lint·format·CI/CD) → done | 코드 + 갱신된 태스크/STATE |
| 수시 | `review-code` | 리뷰어 | 코드를 ARCH 컨벤션·개발 관점에서 점검해 우선순위 붙은 리팩토링 finding을 제안, 사용자가 채택 | `spec/review/<slug>.md` |
| 수시 | `doc-review` | 편집자 | 기존 SSOT를 의미 보존 원칙 아래 정리 — 복합 결정 분해, 과거 흔적·중복 제거. 정책이 바뀌어야 하는 문제는 `update-ssot`로 넘김 | 다듬어진 `spec/ssot/*.md` (rev 불변) |
| 제출물 리뷰 | `review-task` | 리뷰어 | 제출 커밋 검토 → 승인 또는 수정 요청 | 커밋·상위 기준에 고정된 리뷰 기록 |
| 병렬 작업 | `manage-work` | 작업 조정자 | 상위 브랜치·태스크 worktree 배정 → 검증·통합 → 정리 | 작업 묶음 + 공유 실행 기록 |
| 필요시 | `create-narrative` | 작가 | spec 전체를 사람이 읽기 좋은 한국어 이야기로 엮음 | `spec/NARRATIVE.md` |

설치된 프로젝트에는 다음 구조가 생깁니다.

```text
spec/
├── STATE.md      # 관제탑: cfg(사용자 수준) · SSOT rev 현황 · 태스크 보드 · next · log
├── FORMAT.md     # 모든 spec 문서의 압축 표기 규칙 (ID, 기호, 골격, 상태 규칙)
├── ideation/     # (선택) 아이디어 구체화 문서 — ready가 되면 create-ssot의 재료
├── ssot/         # 도메인별 SSOT — 결정([o]/[?]/[x])과 근거만, rev로 변경 추적
├── review/       # (선택) 코드 리뷰 finding — 채택([o])된 것이 ready가 되면 create-task의 재료
└── tasks/        # 남은 태스크(todo·doing·blocked)만 — 완료기준·구현메모·결과, base 스탬프로 신선도 검증
    └── done/     # 완료된 태스크 아카이브 — STATE 표는 항상 남은 일만 보여줍니다
```

`tasks/done/`은 **당시의 의도와 실제 구현·검증을 비교할 수 있는 역사 기록**입니다. 평가와 회귀 조사를 위해 보존하지만, 현재 규칙의 근거는 아닙니다(`st`·`base`는 완료 시점의 값입니다). 그래서 일반 구현 작업은 완료 태스크를 기본 입력으로 읽지 않고, 특정 태스크·회귀 원인·이전 검증 방법을 조사할 때만 해당 파일을 골라 엽니다. 지금도 지켜야 하는 계약이 완료 태스크에만 남아 있다면 그건 SSOT로 올라가야 할 신호입니다.

SSOT의 `rev`(현재 개정)와 STATE의 `tasked`(태스크로 소화된 개정)의 차이가 곧 "아직 구현 계획에 반영되지 않은 기획 변경"입니다. 그래서 어느 세션에서든 "SSOT 변경사항 태스크로 쪼개줘"라고만 해도 에이전트가 무엇이 어떻게 바뀌었는지 스스로 찾아냅니다.

모든 `spec/` 문서는 AI의 오독 방지와 토큰 효율을 위해 영어로 작성됩니다. 인터뷰·확인·최종 보고는 사용자의 언어(`cfg.lang`)로 진행됩니다. 유일한 예외는 `spec/NARRATIVE.md`입니다 — `create-narrative`가 spec 전체를 엮어 만드는 사람용 산문으로, 사용자의 언어로 쓰이며 새로운 결정을 담지 않는 파생 문서입니다.

스펙은 구현 전에 한 번 작성하고 버리는 문서가 아닙니다. 구현 중 발견한 제약과 결정까지 계속 반영하는 기준점이며, 에이전트는 이 기록을 바탕으로 맥락을 잃지 않고 다음 단계를 진행합니다.

## 빠른 시작

### 1. 에이전트에게 설치 요청하기

Claude Code나 Codex를 설치하려는 프로젝트에서 열고 다음 프롬프트를 붙여 넣으세요.

```text
이 프로젝트에 haeram-spec-creator 스킬셋을 설치해줘.
의존성으로 추가하지 말고 npx로 실행해줘.

먼저 `npx -y haeram-spec-creator@latest install --dry-run`으로 설치 계획과 충돌 여부를 확인하고,
기존 스킬과 충돌하면 덮어쓰지 말고 나에게 알려줘.
문제 없으면 `npx -y haeram-spec-creator@latest install`로 설치한 뒤,
`npx -y haeram-spec-creator@latest check`로 스킬 목록과 동기화 상태까지 검증해줘.
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

```text
리팩토링할 데 있는지 코드 점검해줘.                   → review-code
```

```text
THEME SSOT가 너무 길어. 의미 바꾸지 말고 정리해줘.      → doc-review
```

## 직접 설치하기

### 기본: npx (권장 — Node 프로젝트가 아니어도 됩니다)

이 패키지는 스킬을 프로젝트의 `.claude/`·`.codex/`로 복사하는 방식이라, 설치가 끝나면 패키지 자체는 프로젝트에 남을 필요가 없습니다. `package.json` 없이도(Python, Flutter, Go …) 동작하고 `node_modules`도 만들지 않습니다.

```bash
cd my-project
npx haeram-spec-creator@latest install   # 최초 설치와 이후 업데이트 모두 이 명령
npx haeram-spec-creator@latest check     # 동기화 확인
```

`@latest`가 실행 때마다 최신 버전을 확인하므로 업데이트도 같은 명령을 다시 실행하면 됩니다. 직접 수정하지 않은 스킬 파일만 새 버전으로 갱신되고, 수정한 파일은 충돌로 알려 줍니다.

### 옵션: 개발 의존성으로 버전 고정

CI에서 `lint`를 돌리거나 스킬셋 버전 변경을 PR 리뷰로 관리하고 싶은 Node 프로젝트라면 의존성으로 고정할 수 있습니다.

```bash
npm install --save-dev haeram-spec-creator   # pnpm add --save-dev haeram-spec-creator
npx haeram-spec-creator install
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

# spec/ 문서가 FORMAT 불변식을 지키는지 검사 (ID·상태 형식, rev/tasked 정합, 참조 무결성, chg 연속성, SSOT 골격 밖 섹션·산문)
npx haeram-spec-creator lint
npx haeram-spec-creator lint --target ../my-project

# 의미 품질 신호(검토 후보)까지 전부 보기 — 기본은 앞 10건만 출력하고 종료 코드에는 영향이 없습니다
npx haeram-spec-creator lint --hints

# 현재 Git/worktree 환경 조회 (외부 도구 연동용 JSON도 지원)
npx haeram-spec-creator context --json

# 현재 checkout의 태스크 파일에서 읽기 전용 보드 파생
npx haeram-spec-creator board
npx haeram-spec-creator board --target ../my-worktree --json

# 충돌한 로컬 파일을 패키지 버전으로 명시적으로 교체
npx haeram-spec-creator install --force
```

`--force`는 로컬 수정 내용을 덮어쓸 수 있으므로 충돌 내용을 확인한 뒤 사용하세요.

</details>

## 혼자 여러 AI 작업 진행하기

특정 실행기는 필요 없습니다. 일반 터미널에서 Git worktree를 직접 만들거나, Orca 등 외부 도구가 만든 공간을 그대로 사용할 수 있습니다. 작은 단독 작업은 기존 스킬 흐름을 유지하고, 여러 태스크를 묶어 진행할 때 `manage-work`를 사용합니다.

```text
로그인 개편을 작업 묶음으로 시작하고, 독립적인 태스크는 worktree로 나눠 진행해줘.
완료된 결과는 작업 묶음 브랜치에 검증해서 통합해줘.
```

에이전트는 기본 `auto`로 작업 공간을 선택합니다. 매번 모드를 고를 필요는 없습니다.

| workspace 옵션 | 동작 |
|---|---|
| `auto` (기본) | start는 기존 linked worktree를 기획 공간으로 연결하거나 새 기획 공간을 생성합니다. claim은 미배정 linked worktree를 연결하거나 새 worker 공간을 생성합니다. |
| `current` | 현재 checkout과 브랜치를 사용합니다. 기획 공간을 워커와 공유하는 배정은 거부합니다. |
| `new` | 별도 브랜치와 worktree를 생성합니다. |

새 작업 공간은 기본적으로 저장소 옆 `.haeram-worktrees/` 아래에 생성합니다. `--path`로 바꿀 수 있습니다. 이름·분기 기준을 지정하려면 start에 `--branch`·`--base`를 사용합니다. 자동 생성이 실패하면 경로와 원인을 보고하며 현재 checkout을 전환하거나 같은 폴더에서 병렬 쓰기를 시작하지 않습니다. Git이 없으면 기존 단독 흐름을 사용합니다.

다음은 CLI로 직접 진행하는 예입니다. `login`, `T042`, 경로, 검증 명령은 프로젝트에 맞게 바꿉니다. 시작 전 계획을 커밋하고, 생성 후 반환된 경로에서 작업합니다.

```bash
# 상위 작업 브랜치와 기획 공간 생성/연결
npx haeram-spec-creator work start login --json

# 어디서 실행해도 상위 브랜치 기준의 진행 상황 조회
npx haeram-spec-creator work board --work login --json

# 독립 태스크마다 실행: 반환된 workspace와 id를 해당 작업자에게 전달
npx haeram-spec-creator work claim T042 --work login --owner agent-a --json

# 워커는 코드와 자기 태스크의 acceptance/result를 작성하고 커밋
# 실제 실행 ID를 변수에 넣은 뒤 검증·제출 (예: npm 프로젝트)
ATTEMPT_ID='claim이 반환한 id'
npx haeram-spec-creator work submit --attempt "$ATTEMPT_ID" --verify 'npm test' --json

# 리뷰어가 고정된 제출물을 선점하고 review-task로 검토
npx haeram-spec-creator work review-claim --work login --attempt "$ATTEMPT_ID" --owner reviewer --json
REVIEW_ID='review-claim이 반환한 id'
# 실제 리뷰 결과를 저장소 밖 JSON 파일에 작성한 뒤 기록
npx haeram-spec-creator work review-finish --review "$REVIEW_ID" --result-file /tmp/review-result.json --json

# 승인된 변경을 별도 후보에서 재검증하고 상위 브랜치에 반영
# 후보 worktree에는 의존성이 없으므로 필요한 설치도 명시
npx haeram-spec-creator work integrate --attempt "$ATTEMPT_ID" --verify 'npm ci && npm test' --json

# 작업자가 종료한 뒤 공간 정리
npx haeram-spec-creator work cleanup --attempt "$ATTEMPT_ID" --json
```

상태 흐름은 `doing → ready → reviewing → approved → integrated`입니다. 수정 요청은 `changes_requested → doing → ready`로 재검증·재리뷰합니다. `ready`는 워커 검증을 마친 리뷰 대기 상태이고, `integrated`가 되어야 태스크 파일이 `done/`으로 이동하고 후속 의존성이 열립니다. main 반영·PR·원격 push는 프로젝트의 기존 흐름을 따릅니다. CLI는 로컬 작업 브랜치까지만 통합하며 원격에 push하지 않습니다.

진행 중 기록과 상태 변화 이력은 `<git-common-dir>/haeram/v1/state.json`에 저장됩니다. 같은 clone의 worktree들이 공유하고 runtime 자체는 Git에 커밋하지 않습니다. 태스크 통합과 실행기 종료 시 `spec/work/<묶음>.json` 상세 기록 및 `STATE.md`의 작업 묶음 요약을 Git에 저장합니다. CLI는 원자적 예약으로 동일 태스크 및 동일 작업 공간의 이중 배정을 막습니다. 워커는 STATE·SSOT를 바꾸지 않으며, 기획 변경·채번은 하나의 기획 공간에서 진행합니다.

검증 명령은 사용자가 지정한 `--verify`를 셸에서 순서대로 실행합니다(여러 번 지정 가능, 명령별 15분 제한). ARCH에 정의된 실제 검사와 필요한 환경 준비를 넣어야 합니다. 워커 HEAD가 변경되거나 검사가 미커밋 변경을 만들면 제출이 실패합니다. 통합은 별도 후보에서 수행하며, 충돌·검증 실패·상위 브랜치 이동이 있으면 후보를 보존합니다. 검증은 지정한 명령의 성공을 보장하며, 어떤 테스트가 충분한지는 프로젝트의 acceptance/ARCH가 정합니다.

중단·정리 명령도 제공합니다.

```bash
npx haeram-spec-creator work status --json
npx haeram-spec-creator work update --attempt "$ATTEMPT_ID" --status blocked --reason 'API contract needs a planning decision'
npx haeram-spec-creator work update --attempt "$ATTEMPT_ID" --status doing
npx haeram-spec-creator work release --attempt "$ATTEMPT_ID" --reason 'worker stopped'
npx haeram-spec-creator work recover --attempt "$ATTEMPT_ID"
npx haeram-spec-creator work recover --work login
npx haeram-spec-creator work --help
```

`release` 전에 기존 작업자를 종료해야 합니다. heartbeat가 오래됐다는 이유만으로 선점을 빼앗지 않습니다. update를 상태 없이 호출하면 heartbeat만 갱신합니다. `recover`는 중단된 검증·통합·정리를 조정하거나 생성 도중 중단된 기획 공간을 연결합니다. 짧은 기록 락이 남으면 status의 ID로 `work unlock --lock-id <id>`를 사용합니다. 살아있는 프로세스나 다른 호스트의 락은 회수하지 않습니다. 메타데이터조차 기록되지 않은 lock/recovery 디렉토리는 실행 프로세스가 없는지 별도로 확인해야 하며 자동 삭제하지 않습니다.

`cleanup`은 자체 생성한 워커의 통합/해제 여부·커밋 포함 여부·남은 파일을 확인합니다. 미커밋·미추적·ignored 파일이 있으면 보존합니다. 외부 worktree는 디렉토리를 남기고 배정만 해제하므로 다른 태스크에 재사용할 수 있습니다. 생성한 브랜치, 기획 공간과 실패 후보는 복구와 최종 반영을 위해 남을 수 있습니다. 실패 후보에서 수동으로 고친 결과를 자동 승인하지는 않으며, 원 워커에 수정하고 다시 submit/integrate해야 합니다.

`context --json`은 Git/worktree와 현재 작업 모드를 보여 줍니다. 일반 `board`는 현재 checkout의 파일만 읽는 조회 명령이고, `work board`가 작업 묶음의 기준 커밋과 공유 실행 기록을 함께 보여 줍니다. 보드의 claimable은 조회 시점의 후보이며 선점 자체는 claim이 수행합니다. JSON의 `schemaVersion`은 1입니다.

지원 범위는 같은 로컬 clone입니다. 다른 clone·호스트의 공유 선점, fan-out 경쟁 구현은 포함하지 않습니다. 자동 실행은 아래의 기본 실행기 또는 command 어댑터로 연결합니다. 기획 공간의 수동 Git 작업은 CLI 예약을 따르지 않으므로 통합 중 같은 checkout에서 다른 변경을 실행하지 않아야 합니다. 기존 프로젝트의 `spec/FORMAT.md`·`STATE.md`는 install로 자동 이관되지 않으며, 작업 묶음은 기존 task 골격을 이용하는 선택 기능입니다. 다른 clone에도 Git에 저장된 태스크·실행 이력 체크포인트가 남지만 현재 프로세스·선점 소유권과 명령 출력 로그는 전파되지 않습니다.

설계 배경은 [협업 설계 검토](https://github.com/hetarho/haeram-spec-creator/blob/main/docs/worktree-collaboration-review.md)에 기록합니다.

## 워커 4개와 리뷰어 1개로 대기 작업 계속 처리하기

`STATE.next`는 사람이 재개할 때 볼 안내입니다. 개별 에이전트의 배정은 공유 runtime이 관리합니다. `claim-next`는 의존성이 충족된 작업 중 후속 작업을 많이 여는 태스크, 오래된 ID 순으로 하나를 선택하고 원자적으로 선점합니다. 동시에 요청해도 같은 태스크를 배정하지 않습니다.

```bash
npx haeram-spec-creator work start feature --workers 4 --reviewers 1 --max-pending 8 --json
npx haeram-spec-creator work claim-next --work feature --owner worker-a --json
npx haeram-spec-creator work resume --work feature --owner worker-a --json
```

수정 요청이 있으면 resume로 먼저 처리합니다. 리뷰 대기가 max-pending에 도달하면 새 배정을 멈춥니다. 태스크 인용줄에 선택 필드 `touches:src/auth/ prisma/schema.prisma`를 적으면 겹치는 영역은 통합/해제될 때까지 직렬화합니다. 생략은 영향 범위가 알려지지 않았다는 뜻입니다. claimable은 보드의 후보 표시이며, 실제 배정은 용량·적체·신선도를 다시 검사합니다.

`work run`은 설치된 Codex·Claude CLI로 빈 워커 슬롯 보충, 완료 후 검증·리뷰, 수정 재배정, 승인 후 직렬 통합까지 수행합니다. 작업자와 리뷰어의 도구를 다르게 지정할 수 있습니다.

```bash
npx haeram-spec-creator work doctor --json
npx haeram-spec-creator work run --work feature --provider codex --reviewer-provider claude --verify 'npm ci && npm test' --dry-run --json
npx haeram-spec-creator work run --work feature --provider codex --reviewer-provider claude --verify 'npm ci && npm test' --json
```

doctor와 dry-run은 모델을 호출하지 않습니다. provider를 생략하면 호환되는 Codex, Claude 순으로 선택하며, reviewer-provider를 생략하면 같은 도구를 사용합니다. 모델은 각 CLI 기본 설정을 사용하거나 `--model`·`--reviewer-model`로 지정합니다. CLI 로그인과 모델 접근 권한은 별도 준비가 필요합니다. 기본 어댑터의 워커는 파일을 편집하고, 호스트가 계약·변경 범위를 검사한 뒤 커밋·검증·제출합니다.

다른 실행기는 `--adapter <json-file>`로 연결할 수 있습니다. [실행 설정과 Orca 연결 방법](skills/manage-work/references/runner.md)에 설정 예·출력 규약·권한·복구 절차가 있습니다. Orca에서는 coordinator가 같은 선점·리뷰 CLI를 호출할 수 있습니다. doctor는 macOS Orca 앱에 포함된 CLI도 찾아 확인하지만 Orca pane/task/dispatch 자동 생성 어댑터는 아직 포함하지 않습니다.

### 태스크 30개를 워커 6개로 실행하기

```sh
npx haeram-spec-creator work start feature --workers 6 --reviewers 1 --max-pending 12 --json
# Claude만 실행하려면 --provider claude, Codex만 실행하려면 --provider codex
npx haeram-spec-creator work run --work feature --providers codex,claude --verify 'npm test' --json
```

혼합 목록은 슬롯에 반복 배정합니다. `codex,claude`는 각각 3개, `codex,claude,claude`는 Codex 2개와 Claude 4개가 됩니다. 모델을 생략하면 각 CLI의 설정을 사용하며, 도구별 모델은 [adapter workers 설정](skills/manage-work/references/runner.md#단일-도구와-혼합-워커)에 지정합니다. 리뷰어는 워커 6개와 별도로 실행됩니다.

태스크를 미리 5개씩 묶지 않고 빈 슬롯이 다음 가능한 태스크를 가져갑니다. 작업 시간 차이로 일부 슬롯이 더 많은 일을 처리할 수 있고, 의존성·예상 변경 경로·리뷰 적체 때문에 동시 실행 수가 줄어들 수 있습니다.

```sh
npx haeram-spec-creator work board --work feature --json
npx haeram-spec-creator work history --work feature --task T001 --json
# 수동으로 실행했다면 작업 명령이 멈춘 체크포인트에서 Git에 저장
npx haeram-spec-creator work sync --work feature --json
```

보드의 `summary`는 총량·완료·남은 일·실행·리뷰·blocked 수를 보여 줍니다. STATE의 선택적 `## work` 표는 같은 요약과 상세 JSON 링크를 저장합니다. 완료 태스크의 acceptance·검증 근거는 `tasks/done/`, 배정·실행 도구·수정 요청·재시도 이력은 `spec/work/feature.json`에 남습니다. STATE는 마지막 저장 시점의 체크포인트이고 실행 중 최신 상태는 보드에서 확인합니다.

실행기는 통합할 때마다 기록을 저장하고 정상 완료·한도 도달·처리한 종료 신호 뒤 최종 기록을 커밋합니다. 저장에 실패하면 결과의 `snapshotError`와 `failures`에 원인을 남깁니다. 미커밋 기획 변경을 정리한 뒤 `work sync`로 다시 저장할 수 있습니다. 실행 중 수동 sync는 거부하며, 기준 브랜치가 이동하면 이전 리뷰 승인은 재리뷰가 필요할 수 있습니다. 새 clone에서도 `work history`로 저장된 이력을 조회할 수 있지만 과거 워커의 실행 권한을 복원하지는 않습니다.

리뷰는 제출 커밋과 상위 기준 커밋에 묶입니다. P1/P2 finding이 있으면 승인할 수 없고, 코드 변경은 재제출, 상위 브랜치 변경은 재리뷰가 필요합니다. 현재는 상위의 무관한 변경도 재리뷰하는 보수적인 정책입니다. 이 리뷰는 기존 review-code의 사용자 채택형 개선 제안과 별도로 동작합니다.

runner는 대기 중 모델을 반복 호출하지 않고 프로세스 완료를 기다립니다. 작업자가 긴 작업 중 최신 정책을 읽는 절차는 스킬에서 수행하며, heartbeat만으로 에이전트의 문맥이 자동 갱신되지는 않습니다. 전부 통합하면 completed, 더 진행할 수 없는 작업이 남으면 needs-attention과 목록을 반환합니다. 재시도/실행 횟수 제한과 중단 복구를 지원하고, 자동 cleanup·main 반영·push는 수행하지 않습니다.

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
