import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, git, execute } from './helpers/vibe-fixture.mjs'
import { vibeBrief, vibeFormat, verificationTiers } from '../src/vibe-brief.mjs'
import { runVibeCheck } from '../src/vibe-check.mjs'
import { vibeStatus } from '../src/vibe.mjs'
import { lintSpec } from '../src/spec-lint.mjs'
const cli = fileURLToPath(new URL('../bin/haeram-spec-creator.mjs', import.meta.url))

test('standalone brief contains exact cited blocks, freshness, touches and runnable tiers only', async (t) => {
  const { root, arch, initial } = await fixture(t)
  const brief = await vibeBrief({ targetRoot: root, task: 'T001' })
  assert.deepEqual(brief.decisions.map((x) => x.id), ['ARCH-1'])
  assert.deepEqual(brief.touches, ['src/'])
  assert.deepEqual(brief.freshness, [{ domain: 'ARCH', base: 1, current: 1, stale: false }])
  assert.equal(brief.diffBase, initial)
  const tiers = verificationTiers(arch)
  assert.deepEqual(tiers.task, ['node --version'])
  assert.deepEqual(tiers.batch, ['node --version'])
  assert.deepEqual(tiers.ci, [])
  assert.ok(tiers.declared)
  const format = await vibeFormat({ section: 'task' })
  assert.ok(JSON.stringify(format).length < 9500)
  const result = await execute(process.execPath, [cli, 'vibe', 'brief', 'T001', '--target', root, '--json'])
  assert.equal(JSON.parse(result.stdout).taskId, 'T001')
})

test('ARCH r12 prose keeps conditional checks and does not execute backticked paths', () => {
  const arch = '## decisions\n- ARCH-30 [o] Verification runs in three tiers.\n  - task, before each done commit: `pnpm run typecheck`, `pnpm exec vitest run --changed "$HAERAM_DIFF_BASE" --passWithNoTests`.\n  - a task changing UI also runs `pnpm run build` and only the `tests/e2e` specs: `PREVIEW_BUILD=1 pnpm exec playwright test --project=chromium` with spec paths.\n  - batch, once before a push (`work integrate --verify`): `pnpm run test:unit`, `pnpm run build`.\n  - CI, after code push: ARCH-23 runs every browser; `spec/`, `docs/` do not trigger it.\n'
  const v = verificationTiers(arch)
  assert.equal(v.task.length, 2); assert.equal(v.batch.length, 2)
  assert.deepEqual(v.ci, [])
  assert.ok(v.guidance.some((line) => line.includes('spec paths')))
  assert.ok(!v.task.some((line) => line.includes('playwright')))
})

test('check passes scope, bounds output, retains full log and includes scope in cached checks', async (t) => {
  const { root, initial } = await fixture(t)
  const command = 'node -e \'console.log(process.env.HAERAM_TIER,process.env.HAERAM_DIFF_BASE,process.env.HAERAM_TASK);console.log("x".repeat(50000));console.log("FAIL regression name");process.exit(2)\''
  const checked = await runVibeCheck({ targetRoot: root, diffBase: initial, task: 'T001' }, command)
  assert.equal(checked.ok, false); assert.equal(checked.exitCode, 2)
  assert.deepEqual(checked.failedTests, ['FAIL regression name'])
  assert.ok(JSON.stringify(checked).length < 6000)
  assert.match(await readFile(checked.log, 'utf8'), new RegExp(`task ${initial} T001`))
  assert.ok((await readFile(checked.log)).length > 50000)
  const cmd = 'node -e \'console.log(process.env.HAERAM_DIFF_BASE)\''
  const first = await runVibeCheck({ targetRoot: root, diffBase: initial }, cmd)
  assert.equal((await runVibeCheck({ targetRoot: root, diffBase: initial }, cmd)).cached, true)
  const second = await runVibeCheck({ targetRoot: root, diffBase: initial, tier: 'batch' }, cmd)
  assert.equal(second.cached, false)
  assert.equal(first.scope.TIER, 'task')
})

test('check timeout terminates the command group', async (t) => {
  const { root } = await fixture(t)
  const r = await runVibeCheck({ targetRoot: root, timeoutMs: 100 }, 'node -e "setTimeout(()=>{},10000)"')
  assert.equal(r.timedOut, true); assert.equal(r.ok, false)
})

test('legacy ARCH yields review hint, accepts lightweight fix log and status remains summarized', async (t) => {
  const { root } = await fixture(t)
  await writeFile(path.join(root, 'spec/ssot/ARCH.md'), '# ARCH Architecture\n> r1 | architecture\n\n## decisions\n- ARCH-1 [o] verification: `npm run verify`\n\n## chg\n- r1 261019 initial\n')
  const state = path.join(root, 'spec/STATE.md')
  await writeFile(state, (await readFile(state, 'utf8')).replace('## log', '## log\n- 261019 fix web: remove floating button gap'))
  const lint = await lintSpec({ targetRoot: root })
  assert.equal(lint.ok, true, lint.errors.join('\n'))
  assert.ok(lint.reviewHints.some((hint) => hint.includes('검증 단계')))
  const status = await vibeStatus({ targetRoot: root, tag: 't060', fetch: false })
  assert.equal(status.concurrency, 'solo'); assert.equal(status.counts.remaining, 3)
  assert.ok(status.next.length <= 3)
})

test('check defaults to the commit persisted by brief, even after a claim commit', async (t) => {
  const { root, initial } = await fixture(t)
  await vibeBrief({ targetRoot: root, task: 'T001' })
  const state = path.join(root, 'spec/STATE.md')
  await writeFile(state, (await readFile(state, 'utf8')).replace(/T001 \| example \| ARCH \| - \| todo/, 'T001 | example | ARCH | - | doing@261019.t060'))
  await git(root, 'add', 'spec/STATE.md'); await git(root, 'commit', '-q', '-m', 'claim')
  assert.notEqual(await git(root, 'rev-parse', 'HEAD'), initial)
  assert.equal((await vibeBrief({ targetRoot: root, task: 'T001' })).diffBase, initial)
  const result = await runVibeCheck({ targetRoot: root, task: 'T001' }, 'node --version')
  assert.equal(result.scope.DIFF_BASE, initial)
})

test('a cancelled heavy check does not wait behind a clone-wide lock', async (t) => {
  const { root } = await fixture(t)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runVibeCheck({ targetRoot: root, heavy: true, signal: controller.signal }, 'node --version'), /stopped/)
})
