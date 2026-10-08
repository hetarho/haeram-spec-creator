import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { lintSpec } from '../src/spec-lint.mjs'

const STATE = `# STATE
> control tower

## cfg
- level: mid  # expert|mid|novice
- lang: ko
- docs: en

## ssot
| id | rev | tasked | pending | [?] |
|---|---|---|---|---|
| ARCH | 2 | 2 | - | 1 |

## tasks
| id | title | ssot | dep | st |
|---|---|---|---|---|
| T002 | api | ARCH | T001 | todo |

## next
- implement-task T002

## log
- 260905 T001 done
- 260905 create-task ARCH start
`

const ARCH = `# ARCH architecture
> r2 | base architecture

## decisions
- ARCH-1 [o] stack: next 15 ← ecosystem
- ARCH-2 [?] deploy target

## chg
- r2 260905 ARCH-2+
- r1 260905 initial
`

const T001 = `# T001 scaffold
> st:done@260905 | ssot:ARCH-1 | base:ARCH@1 | dep:-

## goal
scaffold the project

## acceptance
- [v] project builds

## impl notes
- pnpm

## result
- done, files created
`

const T002 = `# T002 api
> st:todo | ssot:ARCH-1 ARCH-2 | base:ARCH@2 | dep:T001

## goal
first api

## acceptance
- [ ] GET /health returns 200
- [ ] test covers the route

## impl notes
- hono

## result
`

const REVIEW_STATE = STATE.replace(
  '## tasks\n',
  '## review\n| id | st |\n|---|---|\n| api-260906 | ready@260906 |\n\n## tasks\n',
)

const REVIEW = `# REVIEW api-260906
> st:ready@260906 | scope:src/api | at:abc1234 | base:ARCH@2

## summary
- handlers duplicate validation

## findings
- F1 [o] P1 src/api/*.ts: request validation copied in 3 handlers ← one fix must be applied 3 times
- F2 [x] P3 src/api/util.ts: rename helpers ← not worth the churn
- F3 [o] P2 src/api/health.ts: no test ← regressions go unnoticed →T002

## notes
- -
`

async function writeFixture(
  root,
  {
    state = STATE,
    arch = ARCH,
    tasks = { 'T002.api.md': T002 },
    done = { 'T001.scaffold.md': T001 },
    review = {},
  } = {},
) {
  const specRoot = path.join(root, 'spec')
  await mkdir(path.join(specRoot, 'ssot'), { recursive: true })
  await mkdir(path.join(specRoot, 'tasks', 'done'), { recursive: true })
  if (Object.keys(review).length > 0) await mkdir(path.join(specRoot, 'review'), { recursive: true })
  for (const [name, content] of Object.entries(review)) {
    await writeFile(path.join(specRoot, 'review', name), content)
  }
  await writeFile(path.join(specRoot, 'STATE.md'), state)
  await writeFile(path.join(specRoot, 'FORMAT.md'), '# FORMAT\n')
  await writeFile(path.join(specRoot, 'ssot', 'ARCH.md'), arch)
  for (const [name, content] of Object.entries(tasks)) {
    await writeFile(path.join(specRoot, 'tasks', name), content)
  }
  for (const [name, content] of Object.entries(done)) {
    await writeFile(path.join(specRoot, 'tasks', 'done', name), content)
  }
}

async function withFixture(overrides, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'spec-lint-'))
  try {
    await writeFixture(root, overrides)
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('규칙을 지킨 spec은 오류 없이 통과하고, 아카이브된 done이 dep을 충족한다', async () => {
  await withFixture({}, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.equal(result.ok, true)
    assert.equal(result.counts.ssot, 1)
    assert.equal(result.counts.tasks, 1)
    assert.equal(result.counts.done, 1)
    // 아카이브된 done 태스크는 어떤 경고도 만들지 않는다
    assert.equal(result.warnings.some((w) => w.includes('T001')), false)
  })
})

test('tasked > rev 는 오류다', async () => {
  const broken = STATE.replace('| ARCH | 2 | 2 | - | 1 |', '| ARCH | 2 | 3 | - | 1 |')
  await withFixture({ state: broken }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('tasked(3) > rev(2)')))
  })
})

test('표에 있는 태스크의 파일이 없으면 오류다', async () => {
  await withFixture({ tasks: {} }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('T002') && e.includes('파일이 없습니다')))
  })
})

test('표에도 아카이브에도 없는 dep 참조는 오류다', async () => {
  const broken = STATE.replace('| T002 | api | ARCH | T001 | todo |', '| T002 | api | ARCH | T009 | todo |')
  await withFixture({ state: broken }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('dep T009')))
  })
})

test('태스크 파일에만 있는 누락 dep도 검사하고 STATE와 불일치를 경고한다', async () => {
  await withFixture({ tasks: { 'T002.api.md': T002.replace('dep:T001', 'dep:T099') } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((error) => error.includes('dep T099')))
    assert.ok(result.warnings.some((warning) => warning.includes('파일 dep과 STATE dep')))
  })
})

test('dep의 자기참조와 두 태스크 순환은 오류다', async () => {
  await withFixture({ tasks: { 'T002.api.md': T002.replace('dep:T001', 'dep:T002') } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((error) => error.includes('T002 → T002')))
  })
  const state = STATE.replace('| T002 | api | ARCH | T001 | todo |', '| T002 | api | ARCH | T003 | todo |\n| T003 | next | ARCH | T002 | todo |')
  const tasks = {
    'T002.api.md': T002.replace('dep:T001', 'dep:T003'),
    'T003.next.md': T002.replace('# T002 api', '# T003 next').replace('dep:T001', 'dep:T002'),
  }
  await withFixture({ state, tasks }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((error) => error.includes('T002 → T003 → T002')))
  })
})

test('서로 기다리는 lane은 태스크 순환이 없어도 오류다', async () => {
  const lane = (id, title, dep, name) => T002.replace('# T002 api', `# ${id} ${title}`).replace('dep:T001', `dep:${dep} | lane:${name}`)
  const rows = (deps) => STATE.replace('| T002 | api | ARCH | T001 | todo |', deps.map(([id, dep]) => `| ${id} | x | ARCH | ${dep} | todo |`).join('\n'))
  // T003(b) waits for T005(c) and T005 waits for T002(b): no task cycle, but lane b and c deadlock.
  const deadlock = { state: rows([['T002', 'T001'], ['T003', 'T005'], ['T005', 'T002']]),
    tasks: { 'T002.api.md': lane('T002', 'api', 'T001', 'b'), 'T003.next.md': lane('T003', 'next', 'T005', 'b'), 'T005.other.md': lane('T005', 'other', 'T002', 'c') } }
  await withFixture(deadlock, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(!result.errors.some((error) => error.startsWith('dep 순환')), result.errors.join('\n'))
    assert.ok(result.errors.some((error) => error.includes('lane 순환') && error.includes('T003→T005') && error.includes('T005→T002')), result.errors.join('\n'))
  })
  // A lane that waits for another lane to finish before it starts is an ordering, not a deadlock.
  const ordered = { state: rows([['T002', 'T001'], ['T003', 'T002'], ['T005', 'T003']]),
    tasks: { 'T002.api.md': lane('T002', 'api', 'T001', 'b'), 'T003.next.md': lane('T003', 'next', 'T002', 'b'), 'T005.other.md': lane('T005', 'other', 'T003', 'Bad_Lane') } }
  await withFixture(ordered, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(!result.errors.some((error) => error.includes('lane 순환')))
    assert.ok(result.errors.some((error) => error.includes('lane 형식 오류: Bad_Lane')))
  })
})

test('STATE에만 있는 순환도 감지한다', async () => {
  const state = STATE.replace('| T002 | api | ARCH | T001 | todo |', '| T002 | api | ARCH | T002 | todo |')
  await withFixture({ state }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((error) => error.includes('T002 → T002')))
  })
})

test('done 행이 표에 남아 있으면 경고, 아카이브와 동시 존재는 오류다', async () => {
  const withDoneRow = STATE.replace(
    '| T002 | api | ARCH | T001 | todo |',
    '| T001 | scaffold | ARCH | - | done@260905 |\n| T002 | api | ARCH | T001 | todo |',
  )
  await withFixture({ state: withDoneRow }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.warnings.some((w) => w.includes('T001') && w.includes('아카이브하세요')))
    assert.ok(result.errors.some((e) => e.includes('T001') && e.includes('동시에 있습니다')))
  })
})

test('결정 라인 형식 위반과 존재하지 않는 결정 참조를 잡는다', async () => {
  const brokenArch = ARCH.replace('- ARCH-2 [?] deploy target', '- ARCH-2 deploy target')
  await withFixture({ arch: brokenArch }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('결정 라인 형식 오류')))
    // ARCH-2가 결정으로 파싱되지 않으므로 T002의 ssot:ARCH-2 참조도 깨진다
    assert.ok(result.errors.some((e) => e.includes('존재하지 않는 결정 참조: ARCH-2')))
  })
})

test('✎ chg 항목에 old→new가 없으면 경고한다', async () => {
  const noOld = ARCH.replace('- r2 260905 ARCH-2+', '- r2 260905 ARCH-1✎ stack changed')
  await withFixture({ arch: noOld }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.warnings.some((w) => w.includes('old→new')))
  })
  const withOld = ARCH.replace('- r2 260905 ARCH-2+', '- r2 260905 ARCH-1✎ stack remix→next 15')
  await withFixture({ arch: withOld }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.warnings.some((w) => w.includes('old→new')), false)
  })
})

test('SSOT의 골격 밖 섹션은 오류, 산문 줄과 섹션 순서 위반은 경고다', async () => {
  const withDiscussion = ARCH.replace(
    '## chg',
    '## discussion\n- user asked for next because the team knows it\n\n## chg',
  )
  await withFixture({ arch: withDiscussion }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('골격 밖 섹션') && e.includes('## discussion')))
  })
  const withProse = ARCH.replace(
    '## chg',
    '## constraints\nWe discussed this at length and decided to keep it simple.\n\n## chg',
  )
  await withFixture({ arch: withProse }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.ok(result.warnings.some((w) => w.includes('constraints') && w.includes('산문 줄')))
  })
  const reordered = ARCH.replace('## decisions', '## chg\n- r2 260905 ARCH-2+\n- r1 260905 initial\n\n## decisions').replace(
    /## chg\n- r2 260905 ARCH-2\+\n- r1 260905 initial\n$/,
    '',
  )
  await withFixture({ arch: reordered }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.warnings.some((w) => w.includes('섹션 순서')))
  })
  const noChg = ARCH.replace(/## chg[\s\S]*$/, '')
  await withFixture({ arch: noChg }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('## chg 섹션이 없습니다')))
  })
})

test('파일 rev와 STATE rev 불일치는 오류, todo의 낡은 base는 경고다', async () => {
  const staleState = STATE.replace('| ARCH | 2 | 2 | - | 1 |', '| ARCH | 3 | 2 | ARCH-3+ | 1 |')
  await withFixture({ state: staleState }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('rev(r2)') && e.includes('STATE rev(3)')))
    assert.ok(result.warnings.some((w) => w.includes('T002') && w.includes('base ARCH@2')))
  })
})

test('리뷰 문서: 규칙을 지키면 통과하고, →T### 참조와 finding 형식을 검사한다', async () => {
  await withFixture({ state: REVIEW_STATE, review: { 'api-260906.md': REVIEW } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.equal(result.ok, true)
  })
  const badRef = REVIEW.replace('→T002', '→T099')
  const badLine = badRef.replace('- F2 [x] P3', '- F2 [x]')
  await withFixture({ state: REVIEW_STATE, review: { 'api-260906.md': badLine } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('F3') && e.includes('→T099')))
    assert.ok(result.errors.some((e) => e.includes('finding 형식 오류') && e.includes('F2')))
  })
})

test('리뷰 문서: converted인데 태스크 없는 [o] finding이 남으면 오류, 표에 없는 파일은 오류다', async () => {
  const convertedState = REVIEW_STATE.replace('| api-260906 | ready@260906 |', '| api-260906 | converted@260906 |')
  const converted = REVIEW.replace('st:ready@260906', 'st:converted@260906')
  await withFixture({ state: convertedState, review: { 'api-260906.md': converted } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('converted인데') && e.includes('1개')))
  })
  await withFixture(
    { state: REVIEW_STATE, review: { 'api-260906.md': REVIEW, 'stray-260906.md': REVIEW } },
    async (root) => {
      const result = await lintSpec({ targetRoot: root })
      assert.ok(result.errors.some((e) => e.includes('stray-260906.md') && e.includes('STATE review 표에 없습니다')))
    },
  )
})

test('spec이 없는 프로젝트는 부트스트랩 안내 오류를 낸다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spec-lint-empty-'))
  try {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('STATE.md가 없습니다')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ---- 문서 품질: 구조는 lint(오류·경고)가, 의미는 doc-review(검토 후보)가 본다 ----

test('구조화된 결정 블록(하위 항목·표)은 오류도 검토 후보도 만들지 않는다', async () => {
  const structured = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    [
      '- ARCH-1 [o] stack: next 15 ← ecosystem',
      '- ARCH-3 [o] target size follows the pointer, not the device class ← a tablet with a mouse is not a phone',
      '  - fine pointer: 40 px floor',
      '  - coarse pointer: 44 px floor, never below',
      '  | surface | replacement |',
      '  |---|---|',
      '  | form field | Listbox |',
    ].join('\n'),
  )
  await withFixture({ arch: structured }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.reviewHints, [])
    assert.equal(result.ok, true)
  })
})

test('상위 항목 없이 시작하는 하위 줄은 오류다', async () => {
  const orphan = ARCH.replace('## decisions\n', '## decisions\n  - dangling condition with no decision above it\n')
  await withFixture({ arch: orphan }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('상위 항목 없이')))
  })
})

test('복합 결정 신호(긴 줄 · 묶음 · 이유 2개)는 검토 후보이고 오류는 아니다', async () => {
  const fused = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    [
      `- ARCH-1 [o] stack: next 15 with ${'a policy clause '.repeat(45)}trailing`,
      '- ARCH-3 [o] buttons: cta · secondary · ghost · danger',
      '- ARCH-4 [o] cache the manifest ← fewer round trips ← smaller bundle',
    ].join('\n'),
  )
  await withFixture({ arch: fused }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.equal(result.ok, true)
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-1') && h.includes('결정 라인이')))
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-3') && h.includes("' · ' 묶음이 4개")))
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-4') && h.includes('← 이유가 2개')))
  })
})

test('줄을 합쳐 경고를 피할 수 없다 — 하위 항목으로 펴야 신호가 사라진다', async () => {
  const clauses = [
    'login 5 per minute',
    'password reset 3 per hour',
    'over the limit the API answers 429 with retry-after, never a silent drop',
    'the counter is per account and never per IP',
  ]
  const joined = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    `- ARCH-1 [o] rate limits: ${clauses.join('; ')} ${'and the same holds for every write endpoint '.repeat(12)}`,
  )
  const split = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    ['- ARCH-1 [o] rate limits per account ← abuse without blocking shared offices', ...clauses.map((c) => `  - ${c}`)].join('\n'),
  )
  await withFixture({ arch: joined }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.reviewHints.some((h) => h.includes('결정 라인이')))
  })
  await withFixture({ arch: split }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.reviewHints, [])
    // 조건·수치·부정 표현은 전부 남아 있어야 한다
    assert.deepEqual(result.errors, [])
  })
})

test('과거 경위·ISO 날짜·미사여구는 검토 후보, 백틱 코드 안의 값은 아니다', async () => {
  const traced = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    [
      '- ARCH-1 [o] stack: next 15 (owner decision 2026-08-31, as discussed) ← ecosystem',
      '- ARCH-3 [o] obviously the cache stays in memory',
      '- ARCH-4 [o] the export filename is `report-2026-08-31.csv` ← the legacy importer matches on it',
    ].join('\n'),
  )
  await withFixture({ arch: traced }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-1') && h.includes('과거 경위')))
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-1') && h.includes('2026-08-31')))
    assert.ok(result.reviewHints.some((h) => h.includes('ARCH-3') && h.includes('군더더기')))
    assert.equal(result.reviewHints.some((h) => h.includes('ARCH-4')), false)
  })
})

test('constraints의 과거 흔적도 검토 후보로 잡는다', async () => {
  const withConstraint = ARCH.replace(
    '## chg',
    '## constraints\n- the editor keeps the old parser as we agreed\n\n## chg',
  )
  await withFixture({ arch: withConstraint }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.reviewHints.some((h) => h.includes('constraints') && h.includes('과거 경위')))
  })
})

test('chg는 tasked와 활성 태스크 base 아래까지 이어져 있어야 한다', async () => {
  const noR2 = ARCH.replace('- r2 260905 ARCH-2+\n', '')
  await withFixture({ arch: noR2 }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.warnings.some((w) => w.includes('chg에 r2 항목이 없습니다')))
  })
  // 진행 중 태스크의 base가 낡았으면 그 아래 rev의 chg도 필요하다
  const rev3 = STATE.replace('| ARCH | 2 | 2 | - | 1 |', '| ARCH | 3 | 3 | - | 1 |')
  const archR3 = ARCH.replace('> r2 |', '> r3 |').replace('## chg\n', '## chg\n- r3 260906 ARCH-1✎ next 15→16\n')
  const staleBase = T002.replace('base:ARCH@2', 'base:ARCH@1')
  await withFixture(
    { state: rev3, arch: archR3.replace('- r2 260905 ARCH-2+\n', ''), tasks: { 'T002.api.md': staleBase } },
    async (root) => {
      const result = await lintSpec({ targetRoot: root })
      assert.ok(result.warnings.some((w) => w.includes('chg에 r2 항목이 없습니다')))
    },
  )
  await withFixture({ state: rev3, arch: archR3, tasks: { 'T002.api.md': staleBase } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.equal(result.warnings.some((w) => w.includes('chg에 r')), false)
  })
})

test('긴 chg 요약은 검토 후보다', async () => {
  const wordy = ARCH.replace('- r2 260905 ARCH-2+', `- r2 260905 ARCH-2+ ${'narrating why this changed '.repeat(20)}`)
  await withFixture({ arch: wordy }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.reviewHints.some((h) => h.includes('chg r2') && h.includes('요약이')))
  })
})

test('아카이브된 완료 태스크의 빈 result는 경고다', async () => {
  const emptyResult = T001.replace('- done, files created\n', '')
  await withFixture({ done: { 'T001.scaffold.md': emptyResult } }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, [])
    assert.ok(result.warnings.some((w) => w.includes('T001') && w.includes('## result가 비어 있습니다')))
  })
})

test('doc-review식 분할: 새 번호를 붙여도 참조·rev·pending·완료 dep이 그대로다', async () => {
  // ARCH-1이 두 정책을 품고 있었다 → 머리 정책은 ARCH-1이 유지하고, 떨어진 정책만 새 번호를 받는다.
  const tidied = ARCH.replace(
    '- ARCH-1 [o] stack: next 15 ← ecosystem',
    ['- ARCH-1 [o] stack: next 15 ← ecosystem', '- ARCH-3 [o] package manager: pnpm ← workspace hoisting'].join('\n'),
  )
  await withFixture({ arch: tidied }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.deepEqual(result.errors, []) // T002의 ssot:ARCH-1 ARCH-2 참조가 그대로 유효
    assert.equal(result.ok, true)
    assert.equal(result.counts.done, 1) // 완료 태스크 아카이브와 dep 판정은 영향받지 않는다
    // rev·pending을 건드리지 않았으므로 tasked=rev·pending='-' 경고가 새로 생기지 않는다
    assert.equal(result.warnings.some((w) => w.includes('pending')), false)
    assert.equal(result.warnings.some((w) => w.includes('chg')), false)
  })
})
