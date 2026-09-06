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
