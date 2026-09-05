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

async function writeFixture(
  root,
  {
    state = STATE,
    arch = ARCH,
    tasks = { 'T002.api.md': T002 },
    done = { 'T001.scaffold.md': T001 },
  } = {},
) {
  const specRoot = path.join(root, 'spec')
  await mkdir(path.join(specRoot, 'ssot'), { recursive: true })
  await mkdir(path.join(specRoot, 'tasks', 'done'), { recursive: true })
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

test('파일 rev와 STATE rev 불일치는 오류, todo의 낡은 base는 경고다', async () => {
  const staleState = STATE.replace('| ARCH | 2 | 2 | - | 1 |', '| ARCH | 3 | 2 | ARCH-3+ | 1 |')
  await withFixture({ state: staleState }, async (root) => {
    const result = await lintSpec({ targetRoot: root })
    assert.ok(result.errors.some((e) => e.includes('rev(r2)') && e.includes('STATE rev(3)')))
    assert.ok(result.warnings.some((w) => w.includes('T002') && w.includes('base ARCH@2')))
  })
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
