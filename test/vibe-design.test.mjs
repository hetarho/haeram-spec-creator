import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, git, execute } from './helpers/vibe-fixture.mjs'
import { vibeDesign } from '../src/vibe-design.mjs'
import { vibeStatus } from '../src/vibe.mjs'
import { designOf, setDesign, mergeState, upsertActive } from '../src/state-doc.mjs'
import { lintSpec } from '../src/spec-lint.mjs'
const cli = fileURLToPath(new URL('../bin/haeram-spec-creator.mjs', import.meta.url))

const entry = { since: '2026-10-30T01:00Z', tag: 'k3f9', scope: 'landing hero' }

test('design 줄: active 뒤(없으면 cfg 뒤)에 하나만 쓰고, 지우면 원래 STATE로 돌아간다', async (t) => {
  const { state } = await fixture(t, 1)
  const opened = setDesign(state, entry)
  assert.match(opened, /- brief: domain[^\n]*\n(?:- always[^\n]*\n)?\n## design\n- since:2026-10-30T01:00Z \| tag:k3f9 \| scope:landing hero\n\n## ssot/)
  assert.deepEqual(designOf(opened), { ...entry, line: '- since:2026-10-30T01:00Z | tag:k3f9 | scope:landing hero' })
  assert.equal(setDesign(opened, null), state)
  const withActive = setDesign(upsertActive(state, { tag: 'aaaa', host: 'h', mode: 'pair', since: entry.since, at: entry.since }), entry)
  assert.match(withActive, /## active\n[\s\S]*\| aaaa \|[^\n]*\n\n## design\n/)
  assert.equal(designOf(state), null)
  // A malformed line still counts as an open design.
  assert.equal(designOf(state.replace('## ssot', '## design\n- designing\n\n## ssot')).tag, null)
  // One side opening a design while the other logs: both survive the section merge.
  const theirs = state.replace('## log', '## log\n- 261030 fix ui: label')
  const merged = mergeState(state, opened, theirs)
  assert.deepEqual(merged.conflicts, [])
  assert.equal(designOf(merged.text).tag, 'k3f9')
  assert.match(merged.text, /- 261030 fix ui: label/)
})

test('lint: design 줄은 하나, since·tag 형식을 지킨다', async (t) => {
  const { root, state } = await fixture(t, 1)
  const file = path.join(root, 'spec/STATE.md')
  const designErrors = async () => (await lintSpec({ targetRoot: root })).errors.filter((error) => error.startsWith('design'))
  await writeFile(file, setDesign(state, entry))
  assert.deepEqual(await designErrors(), [])
  await writeFile(file, state.replace('## ssot', '## design\n- since:yesterday | tag:k | scope:-\n- designing\n\n## ssot'))
  const errors = await designErrors()
  assert.ok(errors.some((error) => /하나입니다/.test(error)))
  assert.ok(errors.some((error) => /since/.test(error)))
  assert.ok(errors.some((error) => /tag 형식/.test(error)))
  assert.ok(errors.some((error) => /줄 형식 오류/.test(error)))
})

test('vibe design: 시작·재개·status route·끝 — 커밋은 하지 않는다', async (t) => {
  const { root } = await fixture(t, 1)
  const head = await git(root, 'rev-parse', 'HEAD')
  const started = await vibeDesign({ targetRoot: root, step: 'start', tag: 'k3f9', scope: '  landing\n hero ' })
  assert.equal(started.resumed, false)
  assert.equal(started.design.scope, 'landing hero')
  const status = await vibeStatus({ targetRoot: root, fetch: false })
  assert.equal(status.route, 'design')
  assert.deepEqual(status.design, started.design)
  // A later conversation resumes the same design, keeping since and tag.
  const resumed = await vibeDesign({ targetRoot: root, step: 'start', tag: 'zz99' })
  assert.deepEqual(resumed.design, started.design)
  assert.equal(resumed.resumed, true)
  assert.equal((await vibeDesign({ targetRoot: root, step: 'start', tag: 'zz99', scope: 'pricing table' })).design.scope, 'pricing table')
  assert.equal(await git(root, 'rev-parse', 'HEAD'), head)
  const ended = await vibeDesign({ targetRoot: root, step: 'end' })
  assert.equal(ended.ended, true)
  assert.equal((await vibeDesign({ targetRoot: root })).design, null)
  assert.equal(await git(root, 'status', '--porcelain'), '')
  assert.equal((await vibeStatus({ targetRoot: root, fetch: false })).route, 'implementation')
  await assert.rejects(vibeDesign({ targetRoot: root, step: 'start', tag: 'x' }), /세션 tag/)
  await assert.rejects(vibeDesign({ targetRoot: root, step: 'publish' }), /vibe design/)
})

test('vibe design verify: 미커밋 디자인에서 task·batch 명령을 모두 돌리고, 빠른 검사가 실패하면 무거운 검사를 미룬다', async (t) => {
  const { root, temporary } = await fixture(t, 1)
  const runs = path.join(temporary, 'runs.txt')
  const script = (name, fails) => `require('fs').appendFileSync(${JSON.stringify(runs)}, '${name}\\n');process.exit(${fails ? "require('fs').existsSync('broken') ? 1 : 0" : '0'})\n`
  await writeFile(path.join(root, 'fast.js'), script('fast', true))
  await writeFile(path.join(root, 'slow.js'), script('slow', false))
  const arch = path.join(root, 'spec/ssot/ARCH.md')
  await writeFile(arch, (await readFile(arch, 'utf8')).replace('task, before done: `node --version`', 'task, before done: `node fast.js`').replace('batch, before code push: `node --version`', 'batch, before code push: `node slow.js`'))
  await git(root, 'add', '-A'); await git(root, 'commit', '-q', '-m', 'checks')
  await vibeDesign({ targetRoot: root, step: 'start', tag: 'k3f9' })
  await writeFile(path.join(root, 'app.css'), 'h1 { color: tomato }\n')
  await writeFile(path.join(root, 'broken'), '')
  const count = async () => (await readFile(runs, 'utf8').catch(() => '')).split('\n').filter(Boolean)
  const failed = await vibeDesign({ targetRoot: root, step: 'verify' })
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.results.map((result) => [result.command, result.tier, result.ok]), [['node fast.js', 'task', false]])
  assert.deepEqual(failed.skipped, ['node slow.js'])
  assert.equal(failed.tree, null)
  await rm(path.join(root, 'broken'))
  const passed = await vibeDesign({ targetRoot: root, step: 'verify' })
  assert.equal(passed.ok, true)
  assert.deepEqual(passed.results.map((result) => [result.command, result.ok, result.cached]), [['node fast.js', true, false], ['node slow.js', true, false]])
  assert.match(passed.tree, /^[0-9a-f]{40}$/)
  assert.equal(passed.design.tag, 'k3f9')
  assert.deepEqual(await count(), ['fast', 'fast', 'slow'])
  // The same tree is not checked twice.
  assert.ok((await vibeDesign({ targetRoot: root, step: 'verify' })).results.every((result) => result.cached))
  assert.equal((await count()).length, 3)
  const override = await vibeDesign({ targetRoot: root, step: 'verify', verify: ['node --version'] })
  assert.deepEqual(override.results.map((result) => result.command), ['node fast.js', 'node --version'])
})

test('vibe CLI: design start·end는 JSON을, 잘못된 단계는 오류 JSON을 출력한다', async (t) => {
  const { root } = await fixture(t, 1)
  const run = (...args) => execute(process.execPath, [cli, 'vibe', 'design', ...args, '--target', root], { encoding: 'utf8' })
  const started = JSON.parse((await run('start', '--tag', 'k3f9', '--scope', 'hero section')).stdout)
  assert.equal(started.design.scope, 'hero section')
  assert.equal(JSON.parse((await run()).stdout).design.tag, 'k3f9')
  assert.equal(JSON.parse((await run('end')).stdout).ended, true)
  const failed = await run('publish').catch((error) => error)
  assert.equal(failed.code, 1)
  assert.match(JSON.parse(failed.stdout).error, /vibe design/)
})
