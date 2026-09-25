import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { startWork, claimWork, claimNextWork, inspectWork, updateWork, releaseWork, submitWork, integrateWork, cleanupWork, recoverWork, workBoard } from '../src/work-groups.mjs'
import { claimReview, finishReview, releaseReview, resumeWork } from '../src/work-review.mjs'
import { runWork, recoverRunner } from '../src/work-runner.mjs'
import { inspectWorkspace } from '../src/workspace.mjs'
import { runtimeRoot, transaction, readRuntime, unlockRuntime } from '../src/work-runtime.mjs'

const execute = promisify(execFile)
const cli = fileURLToPath(new URL('../bin/haeram-spec-creator.mjs', import.meta.url))
const git = (cwd, ...args) => execute('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const commit = async (cwd, message = 'change') => {
  await git(cwd, 'add', '.')
  await git(cwd, 'commit', '-m', message)
  return (await git(cwd, 'rev-parse', 'HEAD')).stdout.trim()
}
const task = (id, dep = '-') => `# ${id} example\n> st:todo | ssot:ARCH-1 | base:ARCH@1 | dep:${dep}\n\n## goal\nimplement ${id}\n\n## acceptance\n- [ ] result exists\n\n## impl notes\n- keep contracts\n\n## result\n`
const checkFile = (file) => `node -e "require('fs').accessSync('${file}')"`
const checks = [checkFile('one.txt')]

async function fixture(t) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'haeram-work-flow-')))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = path.join(temporary, 'repo with spaces')
  await mkdir(path.join(root, 'spec/tasks'), { recursive: true })
  await mkdir(path.join(root, 'spec/ssot'), { recursive: true })
  await git(root, 'init', '-b', 'trunk')
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(temporary, 'no-hooks')]]) await git(root, 'config', key, value)
  await writeFile(path.join(root, 'spec/FORMAT.md'), '# FORMAT\n')
  await writeFile(path.join(root, 'spec/STATE.md'), `# STATE\n\n## cfg\n- level: expert\n- lang: ko\n- docs: en\n\n## ssot\n| id | rev | tasked | pending | [?] |\n|---|---|---|---|---|\n| ARCH | 1 | 1 | - | 0 |\n\n## tasks\n| id | title | ssot | dep | st |\n|---|---|---|---|---|\n| T001 | first | ARCH | - | todo |\n| T002 | second | ARCH | - | todo |\n| T003 | after | ARCH | T001 | todo |\n\n## next\n- implement-task T001\n\n## log\n`)
  await writeFile(path.join(root, 'spec/ssot/ARCH.md'), '# ARCH architecture\n> r1 | architecture\n\n## decisions\n- ARCH-1 [o] runtime: node\n\n## chg\n- r1 260924 initial\n')
  await writeFile(path.join(root, 'spec/tasks/T001.first.md'), task('T001'))
  await writeFile(path.join(root, 'spec/tasks/T002.second.md'), task('T002'))
  await writeFile(path.join(root, 'spec/tasks/T003.after.md'), task('T003', 'T001'))
  await writeFile(path.join(root, 'shared.txt'), 'base\n')
  const initial = await commit(root, 'spec')
  return { root, temporary, initial, targetRoot: root }
}

async function implement(attempt, file = 'one.txt', extra = {}) {
  const taskFile = path.join(attempt.workspace, `spec/tasks/${attempt.taskId}.${attempt.taskId === 'T001' ? 'first' : 'second'}.md`)
  const content = (await readFile(taskFile, 'utf8')).replace('- [ ]', '- [v]') + '- outcome: implemented\n- at: -\n- verified: pending submit\n- limits: -\n'
  await writeFile(taskFile, content)
  await writeFile(path.join(attempt.workspace, file), 'result\n')
  for (const [name, value] of Object.entries(extra)) await writeFile(path.join(attempt.workspace, name), value)
  return commit(attempt.workspace)
}

async function approve(setup, attempt) {
  const review = await claimReview({ ...setup, work: attempt.group, attempt: attempt.id, owner: 'reviewer' })
  assert.ok(review.id, JSON.stringify(review))
  return finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'Task and implementation reviewed', findings: [] } })
}

async function ready(t) {
  const fixtureData = await fixture(t)
  const group = await startWork({ ...fixtureData, name: 'feature' })
  const attempt = await claimWork({ ...fixtureData, work: group.id, task: 'T001' })
  const sha = await implement(attempt)
  await submitWork({ ...fixtureData, attempt: attempt.id, verify: checks })
  await approve(fixtureData, attempt)
  return { ...fixtureData, group, attempt, sha }
}

test('Orca 없이 start→claim→submit→integrate→cleanup하고 dep은 통합 이후에만 열린다', async (t) => {
  const setup = await ready(t)
  const { group, attempt, root } = setup
  assert.equal(group.branch, 'work/feature')
  assert.equal(attempt.managed, true)
  assert.equal((await inspectWork({ targetRoot: root })).mode, 'single')
  assert.equal((await inspectWork({ targetRoot: group.path })).mode, 'group')
  assert.equal((await inspectWork({ targetRoot: attempt.workspace })).mode, 'worker')
  let board = await workBoard({ targetRoot: attempt.workspace, work: group.id })
  assert.equal(board.scope, 'work')
  assert.equal(board.tasks.find((entry) => entry.id === 'T001').runtimeStatus, 'approved')
  assert.equal(board.tasks.find((entry) => entry.id === 'T003').claimable, false)
  await assert.rejects(claimWork({ targetRoot: root, work: group.id, task: 'T003' }), /dep/)
  const integrated = await integrateWork({ targetRoot: root, attempt: attempt.id, verify: [...checks, checkFile('spec/tasks/done/T001.first.md')] })
  assert.equal(integrated.status, 'integrated')
  assert.equal((await git(group.path, 'rev-parse', 'HEAD')).stdout.trim(), integrated.integratedCommit)
  assert.equal((await git(root, 'rev-parse', 'HEAD')).stdout.trim(), setup.initial)
  assert.match(await readFile(path.join(group.path, 'spec/tasks/done/T001.first.md'), 'utf8'), new RegExp(`at: ${setup.sha}`))
  board = await workBoard({ targetRoot: root, work: group.id })
  assert.equal(board.tasks.find((entry) => entry.id === 'T003').claimable, true)
  const next = await claimWork({ targetRoot: root, work: group.id, task: 'T003' })
  await access(path.join(next.workspace, 'one.txt'))
  await releaseWork({ targetRoot: root, attempt: next.id })
  await cleanupWork({ targetRoot: root, attempt: next.id })
  const cleaned = await cleanupWork({ targetRoot: root, attempt: attempt.id })
  assert.ok(cleaned.cleanedAt)
  assert.deepEqual(cleaned.preservedCandidates, [])
  await assert.rejects(access(attempt.workspace), { code: 'ENOENT' })
  await access(group.path)
})

test('auto는 외부 linked worktree를 연결하고 current/new는 선택을 따른다', async (t) => {
  const setup = await fixture(t)
  const { root, temporary } = setup
  const group = await startWork({ ...setup, name: 'external' })
  const external = path.join(temporary, 'orca-or-any-tool')
  await git(root, 'worktree', 'add', '-b', 'arbitrary/provider-name', external, group.branch)
  const attempt = await claimWork({ targetRoot: external, work: group.id, task: 'T001' })
  assert.equal(attempt.managed, false)
  assert.equal(attempt.workspace, external)
  const other = await claimWork({ targetRoot: external, work: group.id, task: 'T002', workspace: 'new' })
  assert.equal(other.managed, true)
  assert.notEqual(other.workspace, external)
  await releaseWork({ targetRoot: root, attempt: attempt.id })
  assert.equal((await cleanupWork({ targetRoot: root, attempt: attempt.id })).workspaceRetained, true)
  await access(external)
  await assert.rejects(claimWork({ targetRoot: group.path, work: group.id, task: 'T001', workspace: 'current' }), /기획/)
})

test('start auto는 외부 linked branch를 그대로 기획 공간으로 수용한다', async (t) => {
  const setup = await fixture(t)
  const external = path.join(setup.temporary, 'external-plan')
  await git(setup.root, 'worktree', 'add', '-b', 'feature/from-tool', external)
  const group = await startWork({ targetRoot: external, name: 'adopted' })
  assert.equal(group.managed, false)
  assert.equal(group.branch, 'feature/from-tool')
  assert.equal(group.path, external)
})

test('detached 외부 워커도 지원한다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'detached' })
  const external = path.join(setup.temporary, 'detached')
  await git(setup.root, 'worktree', 'add', '--detach', external, group.branch)
  const attempt = await claimWork({ targetRoot: external, work: group.id, task: 'T001' })
  assert.equal(attempt.branch, null)
  await implement(attempt)
  const submitted = await submitWork({ ...setup, attempt: attempt.id, verify: checks })
  assert.equal(submitted.status, 'ready')
})

test('독립 프로세스의 동일 태스크 선점은 정확히 하나만 성공한다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'race' })
  const call = () => execute(process.execPath, [cli, 'work', 'claim', 'T001', '--work', 'race', '--target', setup.root, '--json'], { encoding: 'utf8' })
  const outcomes = await Promise.allSettled([call(), call()])
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1)
  const loser = outcomes.find((entry) => entry.status === 'rejected')
  assert.match(JSON.parse(loser.reason.stdout).error, /선점/)
  assert.equal((await inspectWork(setup)).attempts.length, 1)
})

test('해제한 이전 attempt는 새 선점을 갱신하거나 해제할 수 없다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'retry' })
  const first = await claimWork({ ...setup, work: 'retry', task: 'T001' })
  await releaseWork({ ...setup, attempt: first.id })
  const second = await claimWork({ ...setup, work: 'retry', task: 'T001' })
  assert.notEqual(first.id, second.id)
  await assert.rejects(updateWork({ ...setup, attempt: first.id, status: 'doing' }), /갱신/)
  await assert.rejects(releaseWork({ ...setup, attempt: first.id }), /해제/)
  assert.equal((await inspectWork(setup)).attempts.find((entry) => entry.id === second.id).status, 'doing')
})

test('미커밋 작업과 미완료 acceptance는 ready로 제출되지 않는다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'incomplete' })
  const attempt = await claimWork({ ...setup, work: 'incomplete', task: 'T001' })
  await assert.rejects(submitWork({ ...setup, attempt: attempt.id, verify: ['node -e "process.exit(0)"'] }), /acceptance/)
  await implement(attempt)
  await writeFile(path.join(attempt.workspace, 'uncommitted'), 'keep')
  await assert.rejects(submitWork({ ...setup, attempt: attempt.id, verify: checks }), /미커밋/)
})

test('워커의 STATE/SSOT 변경은 중앙 기획 문서로 조용히 통합되지 않는다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'planning' })
  const attempt = await claimWork({ ...setup, work: 'planning', task: 'T001' })
  await implement(attempt, 'one.txt', { 'spec/STATE.md': '# changed\n' })
  await assert.rejects(submitWork({ ...setup, attempt: attempt.id, verify: checks }), /자신의 태스크 외/)
})

test('상위 SSOT 변경 후 낡은 워커는 다시 동기화해야 한다', async (t) => {
  const setup = await ready(t)
  const arch = path.join(setup.group.path, 'spec/ssot/ARCH.md')
  await writeFile(arch, (await readFile(arch, 'utf8')).replace('runtime: node', 'runtime: node 22'))
  await commit(setup.group.path)
  await assert.rejects(submitWork({ ...setup, attempt: setup.attempt.id, verify: checks }), /SSOT/)
})

test('검증 실패는 상위 브랜치를 변경하지 않고 후보를 보존한다', async (t) => {
  const setup = await ready(t)
  const before = (await git(setup.group.path, 'rev-parse', 'HEAD')).stdout
  await assert.rejects(integrateWork({ ...setup, attempt: setup.attempt.id, verify: ['node -e "process.exit(7)"'] }), /통합을 완료하지/)
  assert.equal((await git(setup.group.path, 'rev-parse', 'HEAD')).stdout, before)
  const attempt = (await inspectWork(setup)).attempts[0]
  assert.equal(attempt.status, 'approved')
  assert.equal(attempt.integrationVerification, null)
  await access(attempt.candidate)
  const retry = await integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  assert.equal(retry.status, 'integrated')
})

test('merge 충돌은 후보에만 남고 워커와 상위 checkout은 보존된다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'conflict' })
  const attempt = await claimWork({ ...setup, work: group.id, task: 'T001' })
  await implement(attempt, 'one.txt', { 'shared.txt': 'worker\n' })
  await submitWork({ ...setup, attempt: attempt.id, verify: checks })
  await writeFile(path.join(group.path, 'shared.txt'), 'parent\n')
  const before = await commit(group.path)
  await approve(setup, attempt)
  await assert.rejects(integrateWork({ ...setup, attempt: attempt.id, verify: checks }), /통합을 완료하지/)
  assert.equal((await git(group.path, 'rev-parse', 'HEAD')).stdout.trim(), before)
  assert.equal(await readFile(path.join(attempt.workspace, 'shared.txt'), 'utf8'), 'worker\n')
  assert.equal((await git(group.path, 'status', '--porcelain')).stdout, '')
})

test('검증 중 상위 브랜치가 이동하면 결과를 적용하지 않는다', async (t) => {
  const setup = await ready(t)
  const script = path.join(setup.temporary, 'move-parent.cjs')
  await writeFile(script, `const {execFileSync}=require('node:child_process');execFileSync('git',['-C',${JSON.stringify(setup.group.path)},'commit','--allow-empty','-m','parent moved'])`)
  await assert.rejects(integrateWork({ ...setup, attempt: setup.attempt.id, verify: [`node '${script.replaceAll("'", "'\\''")}'`] }), /통합을 완료하지/)
  assert.equal((await git(setup.group.path, 'log', '-1', '--format=%s')).stdout.trim(), 'parent moved')
  await access(path.join(setup.group.path, 'spec/tasks/T001.first.md'))
})

test('통합 후 정리는 미추적/ignored 파일과 추가 커밋을 보존한다', async (t) => {
  const setup = await ready(t)
  await integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  await writeFile(path.join(setup.attempt.workspace, 'keep.txt'), 'important')
  await assert.rejects(cleanupWork({ ...setup, attempt: setup.attempt.id }), /미커밋/)
  await access(path.join(setup.attempt.workspace, 'keep.txt'))
  await commit(setup.attempt.workspace)
  await assert.rejects(cleanupWork({ ...setup, attempt: setup.attempt.id }), /포함되지 않은/)
})

test('검증 명령이 코드를 바꾸면 ready로 기록하지 않는다', async (t) => {
  const setup = await ready(t)
  await assert.rejects(submitWork({ ...setup, attempt: setup.attempt.id, verify: ['node -e "require(\'fs\').writeFileSync(\'one.txt\',\'changed\')"'] }), /미커밋/)
  assert.equal((await inspectWork(setup)).attempts[0].status, 'blocked')
})

test('생성 실패가 기존 경로를 지우거나 현재 checkout을 전환하지 않는다', async (t) => {
  const setup = await fixture(t)
  const occupied = path.join(setup.temporary, 'occupied')
  await mkdir(occupied)
  await writeFile(path.join(occupied, 'keep'), 'data')
  await assert.rejects(startWork({ ...setup, name: 'failure', path: occupied }), /준비에 실패/)
  assert.equal(await readFile(path.join(occupied, 'keep'), 'utf8'), 'data')
  assert.equal((await git(setup.root, 'branch', '--show-current')).stdout.trim(), 'trunk')
})

test('손상된 runtime은 덮어쓰지 않고 살아있는 lock은 회수하지 않는다', async (t) => {
  const setup = await fixture(t)
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  await mkdir(runtime, { recursive: true })
  await writeFile(path.join(runtime, 'state.json'), '{broken')
  await assert.rejects(startWork({ ...setup, name: 'broken' }), /손상/)
  assert.equal(await readFile(path.join(runtime, 'state.json'), 'utf8'), '{broken')
  await mkdir(path.join(runtime, 'lock'))
  await writeFile(path.join(runtime, 'lock/owner.json'), JSON.stringify({ id: 'live', pid: process.pid, host: os.hostname() }))
  await assert.rejects(unlockRuntime(runtime, 'wrong'), /일치하지/)
  await assert.rejects(unlockRuntime(runtime, 'live'), /실행 중/)
})

test('프로세스 중단 후 검증된 후보가 이미 반영됐다면 recover가 완료 기록을 복원한다', async (t) => {
  const setup = await ready(t)
  const result = await integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  await transaction(runtime, (state) => {
    const entry = state.attempts[setup.attempt.id]
    entry.status = 'integrating'
    entry.operation = { token: 'interrupted', attempt: entry.id, kind: 'integrating', pid: 2147483647, host: os.hostname() }
    delete entry.integratedCommit
    state.groups.feature.operation = entry.operation
  })
  const recovered = await recoverWork({ ...setup, attempt: setup.attempt.id })
  assert.equal(recovered.status, 'integrated')
  assert.equal(recovered.integratedCommit, result.integratedCommit)
  assert.equal((await readRuntime(runtime)).groups.feature.operation, undefined)
})

test('Git 없는 프로젝트는 single로 감지하고 work 생성은 기존 흐름을 안내한다', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'haeram-single-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal((await inspectWork({ targetRoot: root })).mode, 'single')
  await assert.rejects(startWork({ targetRoot: root, name: 'new' }), /단독 구현/)
})

test('같은 외부 checkout에 서로 다른 태스크를 동시에 배정할 수 없다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'workspace-race' })
  const external = path.join(setup.temporary, 'shared-worker')
  await git(setup.root, 'worktree', 'add', '-b', 'external-worker', external, group.branch)
  const call = (taskId) => execute(process.execPath, [cli, 'work', 'claim', taskId, '--work', group.id, '--workspace', 'current', '--target', external, '--json'])
  const outcomes = await Promise.allSettled([call('T001'), call('T002')])
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal((await inspectWork(setup)).attempts.length, 1)
})

test('독립 워커 두 개를 순서대로 통합해도 STATE 충돌 없이 결과를 모은다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'parallel' })
  const first = await claimWork({ ...setup, work: group.id, task: 'T001' })
  const second = await claimWork({ ...setup, work: group.id, task: 'T002' })
  await implement(first)
  await implement(second, 'two.txt')
  await Promise.all([
    submitWork({ ...setup, attempt: first.id, verify: checks }),
    submitWork({ ...setup, attempt: second.id, verify: [checkFile('two.txt')] }),
  ])
  await approve(setup, first)
  await integrateWork({ ...setup, attempt: first.id, verify: checks })
  await approve(setup, second)
  await integrateWork({ ...setup, attempt: second.id, verify: [...checks, checkFile('two.txt')] })
  const board = await workBoard({ ...setup, work: group.id })
  assert.deepEqual(board.doneIds, ['T001', 'T002'])
  assert.equal(board.tasks[0].id, 'T003')
  assert.equal(board.tasks[0].claimable, true)
})

test('stale SSOT base와 워커 계약 변조는 배정/제출 시 거부한다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'contract' })
  const attempt = await claimWork({ ...setup, work: group.id, task: 'T001' })
  await implement(attempt)
  const file = path.join(attempt.workspace, 'spec/tasks/T001.first.md')
  await writeFile(file, (await readFile(file, 'utf8')).replace('implement T001', 'different goal'))
  await commit(attempt.workspace)
  await assert.rejects(submitWork({ ...setup, attempt: attempt.id, verify: checks }), /계약/)
  const arch = path.join(group.path, 'spec/ssot/ARCH.md')
  await writeFile(arch, (await readFile(arch, 'utf8')).replace('> r1', '> r2'))
  await commit(group.path)
  await assert.rejects(claimWork({ ...setup, work: group.id, task: 'T002' }), /신선도/)
})

test('ignored 로컬 파일도 worktree cleanup이 보존한다', async (t) => {
  const setup = await ready(t)
  await integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  const exclude = (await git(setup.root, 'rev-parse', '--git-path', 'info/exclude')).stdout.trim()
  const file = path.resolve(setup.root, exclude)
  await writeFile(file, (await readFile(file, 'utf8')) + '\nlocal.cache\n')
  await writeFile(path.join(setup.attempt.workspace, 'local.cache'), 'keep')
  await assert.rejects(cleanupWork({ ...setup, attempt: setup.attempt.id }), /ignored/)
  assert.equal(await readFile(path.join(setup.attempt.workspace, 'local.cache'), 'utf8'), 'keep')
})

test('생성 중인 실행은 live creator가 있으면 release할 수 없다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'preparing' })
  const attempt = await claimWork({ ...setup, work: 'preparing', task: 'T001' })
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  await transaction(runtime, (state) => { state.attempts[attempt.id].status = 'preparing' })
  await assert.rejects(releaseWork({ ...setup, attempt: attempt.id }), /실행 중/)
})

test('live 생성기가 없는 기획 공간의 완료된 생성은 recover로 연결한다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'recover-plan' })
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  await transaction(runtime, (state) => {
    state.groups[group.id].status = 'preparing'
    state.groups[group.id].creator.pid = 2147483647
    delete state.groups[group.id].gitDir
  })
  const result = await recoverWork({ ...setup, work: group.id })
  assert.equal(result.status, 'active')
  assert.equal(result.managed, false)
})

async function expandTasks(setup, count) {
  const stateFile = path.join(setup.root, 'spec/STATE.md')
  let state = await readFile(stateFile, 'utf8')
  const rows = []
  for (let n = 4; n <= count; n += 1) {
    const id = `T${String(n).padStart(3, '0')}`
    await writeFile(path.join(setup.root, `spec/tasks/${id}.extra.md`), task(id))
    rows.push(`| ${id} | extra | ARCH | - | todo |`)
  }
  state = state.replace('\n## next', `${rows.join('\n')}\n\n## next`)
  await writeFile(stateFile, state)
  await commit(setup.root)
}

test('50개 대기 태스크에서 4개 프로세스가 중복 없이 선점하고 worker 한도를 지킨다', async (t) => {
  const setup = await fixture(t)
  await expandTasks(setup, 50)
  await startWork({ ...setup, name: 'fifty' })
  const calls = Array.from({ length: 5 }, (_, index) => execute(process.execPath, [cli, 'work', 'claim-next', '--work', 'fifty', '--owner', `worker-${index}`, '--target', setup.root, '--json'], { encoding: 'utf8' }))
  const results = (await Promise.all(calls)).map(({ stdout }) => JSON.parse(stdout))
  const claims = results.filter((entry) => entry.id)
  assert.equal(claims.length, 4)
  assert.equal(new Set(claims.map((entry) => entry.taskId)).size, 4)
  assert.ok(claims.some((entry) => entry.taskId === 'T001'))
  assert.ok(!claims.some((entry) => entry.taskId === 'T003'))
  assert.equal(results.find((entry) => entry.idle).reason, 'worker-capacity')
})

test('next는 의존 태스크를 많이 여는 일을 우선하고 touches 충돌을 직렬화한다', async (t) => {
  const setup = await fixture(t)
  for (const file of ['T001.first.md', 'T002.second.md']) {
    const target = path.join(setup.root, 'spec/tasks', file)
    await writeFile(target, (await readFile(target, 'utf8')).replace('dep:-', `dep:- | touches:${file.startsWith('T001') ? 'src/auth/' : 'src/auth/login.mjs'}`))
  }
  await commit(setup.root)
  await startWork({ ...setup, name: 'touches' })
  const first = await claimNextWork({ ...setup, work: 'touches', owner: 'a' })
  assert.equal(first.taskId, 'T001')
  assert.equal((await claimNextWork({ ...setup, work: 'touches', owner: 'b' })).reason, 'no-eligible-task')
  assert.equal((await workBoard({ ...setup, work: 'touches' })).tasks.find((entry) => entry.id === 'T002').claimable, false)
})

test('리뷰 대기 상한은 신규 선점을 멈추며 완료 검증만으로 통합할 수 없다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'pressure', maxPending: 1 })
  const attempt = await claimNextWork({ ...setup, work: 'pressure', owner: 'worker' })
  await implement(attempt)
  await submitWork({ ...setup, attempt: attempt.id, verify: checks })
  assert.equal((await claimNextWork({ ...setup, work: 'pressure', owner: 'other' })).reason, 'review-backpressure')
  await assert.rejects(integrateWork({ ...setup, attempt: attempt.id, verify: checks }), /상태|승인/)
  assert.equal((await claimReview({ ...setup, work: 'pressure', owner: 'worker' })).idle, true)
})

test('리뷰 선점은 하나만 성공하고 수정 요청은 신규 작업보다 먼저 재배정된다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'review-race' })
  const attempt = await claimNextWork({ ...setup, work: 'review-race', owner: 'a' })
  await implement(attempt)
  await submitWork({ ...setup, attempt: attempt.id, verify: checks })
  const calls = ['r1', 'r2'].map((owner) => execute(process.execPath, [cli, 'work', 'review-claim', '--work', 'review-race', '--owner', owner, '--target', setup.root, '--json'], { encoding: 'utf8' }))
  const results = (await Promise.all(calls)).map(({ stdout }) => JSON.parse(stdout))
  const review = results.find((entry) => entry.id)
  assert.equal(results.filter((entry) => entry.id).length, 1)
  await assert.rejects(updateWork({ ...setup, attempt: attempt.id, status: 'doing' }), /갱신/)
  await assert.rejects(finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'bad', findings: [{ priority: 'P1', where: 'one.txt:1', message: 'broken' }] } }), /P1/)
  await finishReview({ ...setup, review: review.id, result: { verdict: 'changes_requested', summary: 'fix outcome', findings: [{ priority: 'P2', where: 'one.txt:1', message: 'missing edge case' }] } })
  assert.match((await claimNextWork({ ...setup, work: 'review-race', owner: 'b' })).reason, /changes-requested/)
  const resumed = await resumeWork({ ...setup, work: 'review-race', owner: 'b' })
  assert.equal(resumed.id, attempt.id)
  assert.equal(resumed.correction.findings[0].message, 'missing edge case')
  assert.equal(resumed.verifiedCommit, undefined)
  await assert.rejects(finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'old reply', findings: [] } }), /오래된/)
  await writeFile(path.join(attempt.workspace, 'one.txt'), 'fixed\n')
  const changed = await commit(attempt.workspace)
  await submitWork({ ...setup, attempt: attempt.id, verify: checks })
  const approved = await approve(setup, attempt)
  assert.equal(approved.review.commit, changed)
  await integrateWork({ ...setup, attempt: attempt.id, verify: checks })
})

test('제출 이후 변경과 리뷰 이후 상위 브랜치 이동은 승인을 무효화한다', async (t) => {
  const setup = await ready(t)
  await writeFile(path.join(setup.attempt.workspace, 'one.txt'), 'changed\n')
  await commit(setup.attempt.workspace)
  await assert.rejects(integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks }), /통합을 완료하지/)
  assert.equal((await inspectWork(setup)).attempts[0].status, 'blocked')
  await submitWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  await approve(setup, setup.attempt)
  await git(setup.group.path, 'commit', '--allow-empty', '-m', 'base moved')
  await assert.rejects(integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks }), /통합을 완료하지/)
  const entry = (await inspectWork(setup)).attempts[0]
  assert.equal(entry.status, 'ready')
  assert.equal(entry.review, undefined)
  await approve(setup, setup.attempt)
  await integrateWork({ ...setup, attempt: setup.attempt.id, verify: checks })
})

test('리뷰 중 변경된 기준과 해제한 review ID로는 승인할 수 없다', async (t) => {
  const setup = await ready(t)
  await submitWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  let review = await claimReview({ ...setup, work: 'feature', attempt: setup.attempt.id, owner: 'r' })
  await releaseReview({ ...setup, review: review.id })
  await assert.rejects(finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'late', findings: [] } }), /오래된/)
  review = await claimReview({ ...setup, work: 'feature', attempt: setup.attempt.id, owner: 'r' })
  await git(setup.group.path, 'commit', '--allow-empty', '-m', 'new base')
  await assert.rejects(finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'stale', findings: [] } }), /바뀌었/)
  assert.equal((await inspectWork(setup)).attempts[0].status, 'ready')
})

test('실행기가 워커를 보충하고 수정→재리뷰→통합을 완료한다 (Orca 불필요)', async (t) => {
  const setup = await fixture(t)
  await expandTasks(setup, 6)
  const group = await startWork({ ...setup, name: 'runner' })
  const adapter = path.join(setup.temporary, 'adapter.mjs')
  await writeFile(adapter, `import fs from 'node:fs'; import {execFileSync} from 'node:child_process';
let input=''; for await(const chunk of process.stdin) input+=chunk;
const job=JSON.parse(input);
if(job.role==='worker') {
 const file='spec/tasks/'+fs.readdirSync('spec/tasks').find(name=>name.startsWith(job.taskId+'.'));
 let text=fs.readFileSync(file,'utf8').replace('- [ ]','- [v]');
 text=text.split('## result')[0]+'## result\\n- outcome: implemented\\n- at: -\\n- verified: pending\\n- limits: -\\n';
 fs.writeFileSync(file,text); fs.writeFileSync(job.taskId+'.txt',job.correction?'corrected':'implemented');
 execFileSync('git',['add','.']);execFileSync('git',['commit','-m','implement '+job.taskId]);
 process.stdout.write(JSON.stringify({outcome:'completed'}));
} else {
 const fix=job.taskId==='T001'&&fs.readFileSync('T001.txt','utf8')!=='corrected';
 process.stdout.write(JSON.stringify({verdict:fix?'changes_requested':'approved',summary:fix?'fix edge case':'reviewed',findings:fix?[{priority:'P2',where:'T001.txt:1',message:'handle edge case'}]:[]}));
}`)
  const config = path.join(setup.temporary, 'adapter.json')
  await writeFile(config, JSON.stringify({ command: process.execPath, args: [adapter], maxTaskRuns: 12 }))
  const result = await runWork({ ...setup, work: group.id, adapter: config, verify: [checkFile('spec/ssot/ARCH.md')] })
  assert.deepEqual(result.failures, [])
  assert.equal(result.attempts.length, 6)
  assert.ok(result.attempts.every((entry) => entry.status === 'integrated'), JSON.stringify(result))
  assert.ok(result.dispatched >= 14)
  const board = await workBoard({ ...setup, work: group.id })
  assert.equal(board.doneIds.length, 6)
  assert.equal(board.tasks.length, 0)
  assert.equal(board.group.runner, undefined)
  assert.equal(await readFile(path.join(group.path, 'T001.txt'), 'utf8'), 'corrected')
})

test('어댑터 실패는 작업을 보존하고 runner 중복 실행과 live 복구를 거부한다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'failed-runner' })
  const config = path.join(setup.temporary, 'adapter.json')
  await writeFile(config, JSON.stringify({ command: process.execPath, args: ['-e', 'process.exit(3)'] }))
  const result = await runWork({ ...setup, work: group.id, adapter: config, verify: checks })
  assert.ok(result.failures.length)
  assert.ok(result.attempts.every((entry) => entry.status === 'blocked'))
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  await transaction(runtime, (state) => { state.groups[group.id].runner = { id: 'live', pid: process.pid, host: os.hostname() } })
  await assert.rejects(runWork({ ...setup, work: group.id, adapter: config, verify: checks }), /이미/)
  await assert.rejects(recoverRunner({ ...setup, work: group.id }), /실행 중/)
})

test('리뷰 결과의 추가 필드로 고정된 커밋과 ID를 덮어쓸 수 없다', async (t) => {
  const setup = await ready(t)
  await submitWork({ ...setup, attempt: setup.attempt.id, verify: checks })
  const review = await claimReview({ ...setup, work: 'feature', attempt: setup.attempt.id, owner: 'r' })
  assert.equal((await inspectWork({ targetRoot: review.workspace })).mode, 'reviewer')
  const result = await finishReview({ ...setup, review: review.id, result: { verdict: 'approved', summary: 'reviewed', findings: [], id: 'injected', commit: 'wrong', baseCommit: 'wrong', submissionId: 'wrong' } })
  assert.equal(result.review.id, review.id)
  assert.equal(result.review.commit, review.commit)
  assert.equal(result.review.baseCommit, review.baseCommit)
})

test('runner는 긴 워커의 heartbeat를 갱신하고 timeout 뒤 프로세스와 선점을 정리한다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'heartbeat', workers: 1 })
  const config = path.join(setup.temporary, 'timeout.json')
  await writeFile(config, JSON.stringify({ command: process.execPath, args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], timeoutMs: 11000, maxDispatches: 1 }))
  const result = await runWork({ ...setup, work: group.id, adapter: config, verify: checks })
  assert.equal(result.heartbeatError, null)
  assert.equal(result.outcome, 'dispatch-limit')
  const state = await inspectWork(setup)
  assert.equal(state.groups[0].runner, undefined)
  assert.equal(state.attempts[0].status, 'blocked')
  assert.match(state.attempts[0].reason, /timeout/)
  assert.ok(Date.parse(state.attempts[0].heartbeatAt) - Date.parse(state.attempts[0].createdAt) > 5000)
  assert.throws(() => process.kill(state.attempts[0].dispatch.pid, 0), { code: 'ESRCH' })
})

test('존재하지 않는 어댑터 명령은 가짜 완료를 만들지 않는다', async (t) => {
  const setup = await fixture(t)
  const group = await startWork({ ...setup, name: 'missing-adapter' })
  const config = path.join(setup.temporary, 'missing.json')
  await writeFile(config, JSON.stringify({ command: path.join(setup.temporary, 'does-not-exist'), args: [] }))
  const result = await runWork({ ...setup, work: group.id, adapter: config, verify: checks })
  assert.equal(result.outcome, 'needs-attention')
  assert.ok(result.failures.length)
  assert.ok(result.attempts.every((entry) => entry.status === 'blocked'))
})

test('손상된 touches 경로와 비정상 slot 설정은 배정 전에 거부한다', async (t) => {
  const setup = await fixture(t)
  await assert.rejects(startWork({ ...setup, name: 'bad', workers: 0 }), /정수/)
  const file = path.join(setup.root, 'spec/tasks/T001.first.md')
  await writeFile(file, (await readFile(file, 'utf8')).replace('dep:-', 'dep:- | touches:../outside'))
  await commit(setup.root)
  await startWork({ ...setup, name: 'bad-path' })
  await assert.rejects(claimNextWork({ ...setup, work: 'bad-path', owner: 'a' }), /태스크\/STATE/)
})

test('CLI runner 종료 신호는 실행한 워커를 멈추고 미완료 작업을 보존한다', async (t) => {
  const setup = await fixture(t)
  await startWork({ ...setup, name: 'stop-runner', workers: 1 })
  const config = path.join(setup.temporary, 'stop.json')
  await writeFile(config, JSON.stringify({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }))
  let child
  const completion = new Promise((resolve, reject) => {
    child = execFile(process.execPath, [cli, 'work', 'run', '--work', 'stop-runner', '--target', setup.root, '--adapter', config, '--verify', checks[0], '--json'], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)))
  })
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM') })
  const runtime = runtimeRoot(await inspectWorkspace(setup))
  let dispatch
  for (let i = 0; i < 500 && !dispatch?.pid; i += 1) {
    dispatch = Object.values((await readRuntime(runtime)).attempts)[0]?.dispatch
    if (!dispatch?.pid) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(dispatch?.pid)
  child.kill('SIGTERM')
  const result = await completion
  assert.equal(result.outcome, 'interrupted')
  assert.equal(result.attempts[0].status, 'blocked')
  assert.throws(() => process.kill(dispatch.pid, 0), { code: 'ESRCH' })
  assert.equal((await readRuntime(runtime)).groups['stop-runner'].runner, undefined)
})
