import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { inspectWorkspace, git } from './workspace.mjs'
import { readTaskBoard } from './task-board.mjs'
import { quoteLine, quoteFields, sections, splitRefs, TASK_ID } from './spec-format.mjs'
import { runtimeRoot, readRuntime, transaction, readLock, unlockRuntime, canonicalDestination } from './work-runtime.mjs'
import { SkillPackageError } from './errors.mjs'
import { lintSpec } from './spec-lint.mjs'
import { progressSnapshot, progressState, workSummary, progressChecks } from './work-progress.mjs'
import { planUnits } from './task-graph.mjs'

const execute = promisify(exec)
import { activeAttempt as active, workerBusy, pendingReview, workLimits, invalidateReview, overlaps, rankedUnits, unitTasks } from './work-policy.mjs'
const now = () => new Date().toISOString()
const date = () => now().slice(2, 10).replaceAll('-', '')
const creator = () => ({ pid: process.pid, host: os.hostname() })
const fail = (message, details = []) => { throw new SkillPackageError(message, details) }
const digest = (value) => createHash('sha256').update(value).digest('hex')
const head = async (root, ref = 'HEAD') => (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
const ancestor = async (root, old, next) => (await git(root, ['merge-base', '--is-ancestor', old, next], [1])) !== null
const clean = async (root) => !(await git(root, ['status', '--porcelain', '--untracked-files=all'])).trim()
const blob = (root, commit, file) => git(root, ['show', `${commit}:${file}`], [128])

async function repository(options) {
  const workspace = await inspectWorkspace(options)
  if (!workspace.git?.head) fail('이 작업에는 커밋이 있는 Git checkout이 필요합니다. 단독 구현은 기존 스킬 흐름으로 진행할 수 있습니다.')
  return { workspace, root: runtimeRoot(workspace), cwd: workspace.git.root }
}

function groupOf(state, id) {
  const group = Object.hasOwn(state.groups, id ?? '') ? state.groups[id] : null
  if (!group || group.status !== 'active') fail(`활성 작업 묶음을 찾을 수 없습니다: ${id ?? '(미지정)'}`)
  return group
}

function attemptOf(state, id) {
  const attempt = Object.hasOwn(state.attempts, id ?? '') ? state.attempts[id] : null
  if (!attempt) fail(`실행 기록을 찾을 수 없습니다: ${id ?? '(미지정)'}`)
  return attempt
}

function noOperation(group) {
  if (group.operation) fail('작업 묶음에서 통합 명령이 실행 중입니다.', [JSON.stringify(group.operation)])
}

// Only integration, sync and finish move the group branch, so only they exclude each other.
// Claims, submissions and reviews keep going while a long integration check runs.
function notIntegrating(group, attempt) {
  if (group.operation?.attempt === attempt.id) fail('이 실행을 통합하는 명령이 진행 중입니다.', [JSON.stringify(group.operation)])
}

function requireStopped(processInfo) {
  if (!processInfo || processInfo.host !== os.hostname()) fail('이 호스트에서 중단 여부를 확인할 수 없는 명령입니다.')
  try { process.kill(processInfo.pid, 0); fail('명령 프로세스가 아직 실행 중입니다.') } catch (error) { if (error.code !== 'ESRCH') throw error }
}

function assertFreeWorkspace(state, destination, except) {
  for (const attempt of Object.values(state.attempts)) {
    if (attempt.id !== except && !attempt.cleanedAt && attempt.workspace === destination) {
      fail('이 작업 공간에는 이미 실행 기록이 있습니다. 종료·정리하거나 다른 공간을 사용하세요.', [attempt.id])
    }
  }
  if (Object.values(state.groups).some((group) => group.path === destination)) fail('기획·통합 공간을 워커에게 배정할 수 없습니다.')
}

async function destination(context, name, requested) {
  const main = context.workspace.git.worktrees.find((tree) => !tree.bare)?.path ?? context.cwd
  const identity = `${path.basename(main)}-${digest(context.workspace.git.commonDir).slice(0, 8)}`
  return canonicalDestination(path.resolve(requested ?? path.join(path.dirname(main), '.haeram-worktrees', identity, name)))
}

async function requireClean(root) {
  if (!(await clean(root))) fail('미커밋·미추적 변경이 있습니다. 해당 작업을 먼저 정리하세요.', [root])
  await requireNoGitOperation(root)
}

async function requireNoGitOperation(root) {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (await git(root, ['rev-parse', '--verify', '--quiet', marker], [1])) fail(`Git ${marker} 작업이 진행 중입니다.`, [root])
  }
  for (const marker of ['rebase-merge', 'rebase-apply']) {
    const location = (await git(root, ['rev-parse', '--git-path', marker])).replace(/\r?\n$/, '')
    try { await access(path.resolve(root, location)); fail('Git rebase 작업이 진행 중입니다.', [root]) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function assertWorkspace(context, entry) {
  const workspace = await inspectWorkspace({ targetRoot: entry.workspace ?? entry.path })
  if (workspace.git?.commonDir !== context.workspace.git.commonDir || workspace.git.gitDir !== entry.gitDir || workspace.git.branch !== entry.branch) {
    fail('작업 공간의 저장소·브랜치·Git 경로가 배정 이후 바뀌었습니다.', [entry.workspace ?? entry.path])
  }
  return workspace
}

function taskContract(content) {
  const map = sections(content)
  return digest(JSON.stringify({ title: content.match(/^# .+$/m)?.[0], quote: quoteLine(content), goal: map.get('goal'), notes: map.get('impl notes'),
    acceptance: map.get('acceptance')?.map((row) => row.replace(/^- \[v\]/, '- [ ]')) }))
}

// A unit starts only when every dep outside it is integrated. Deps inside a lane are
// implemented in order in the same workspace and never wait for integration.
async function currentUnit(context, group, ids, snapshot) {
  const commit = snapshot?.commit ?? await head(context.cwd, `refs/heads/${group.branch}`)
  const board = snapshot?.board ?? await readTaskBoard({ targetRoot: context.cwd, ref: commit })
  if (!board.ok || board.warnings.length) fail('상위 브랜치의 태스크/STATE를 먼저 정리하고 커밋하세요.', [...board.errors, ...board.warnings])
  const tasks = ids.map((id) => board.tasks.find((item) => item.id === id))
  if (tasks.some((task) => task?.st !== 'todo')) fail(`${ids.join(' ')}: todo 상태이며 상위 브랜치에서 dep이 충족된 태스크만 배정할 수 있습니다.`)
  const waiting = [...new Set(tasks.flatMap((task) => task.waitingOn.filter((dep) => !ids.includes(dep))))]
  if (waiting.length) fail(`${ids.join(' ')}: dep ${waiting.join(' ')}이 상위 브랜치에 아직 통합되지 않았습니다.`)
  for (const task of tasks) {
    for (const base of task.base) {
      const parsed = base.match(/^([A-Z]{2,6})@(\d+)$/)
      if (!parsed) fail(`${task.id}: 잘못된 SSOT base: ${base}`)
      const ssot = await blob(context.cwd, commit, `spec/ssot/${parsed[1]}.md`)
      const revision = quoteLine(ssot ?? '')?.match(/^r(\d+)\b/)?.[1]
      if (revision !== parsed[2]) fail(`${task.id}: ${base}가 현재 SSOT와 다릅니다. 기획 공간에서 신선도를 확인하고 태스크를 갱신하세요.`)
    }
  }
  return { commit, board, tasks: await Promise.all(tasks.map(async (task) => ({ task, content: await blob(context.cwd, commit, task.file) }))) }
}

// Tasks before and including the attempt's current task must be complete; later lane
// tasks only have to keep their contract.
async function checkWorker(context, group, attempt, workingTree = false) {
  const workspace = await assertWorkspace(context, attempt)
  if (workingTree) await requireNoGitOperation(attempt.workspace)
  else await requireClean(attempt.workspace)
  const ids = unitTasks(attempt)
  const position = ids.indexOf(attempt.taskId)
  if (position === -1) fail('실행 기록의 현재 태스크가 배정 단위에 없습니다.')
  const current = await currentUnit(context, group, ids)
  const read = (file) => workingTree ? readFile(path.join(attempt.workspace, file), 'utf8').catch(() => null) : blob(context.cwd, workspace.git.head, file)
  for (const [index, { task, content: upstream }] of current.tasks.entries()) {
    const content = await read(task.file)
    if (!content || taskContract(content) !== taskContract(upstream)) fail(`${task.id}: 태스크 계약이 상위 브랜치와 다릅니다. 기획 변경을 확인하고 작업을 동기화하세요.`)
    if (index > position) continue
    const acceptance = sections(content).get('acceptance') ?? []
    if (!acceptance.some((row) => /^- \[v\] /.test(row)) || acceptance.some((row) => /^- \[[^v]\]/.test(row))) fail(`${task.id}: 태스크 acceptance를 실제로 확인하고 모두 [v]로 기록하세요.`)
    const result = (sections(content).get('result') ?? []).join('\n')
    for (const key of ['outcome', 'at', 'verified', 'limits']) {
      if (!new RegExp(`^- ${key}: .+`, 'm').test(result)) fail(`${task.id}: 태스크 result에 ${key} 기록이 필요합니다.`)
    }
  }
  for (const domain of new Set(current.tasks.flatMap(({ task }) => task.base.map((base) => base.split('@')[0])))) {
    const file = `spec/ssot/${domain}.md`
    const canonical = await blob(context.cwd, current.commit, file)
    if (!canonical || canonical !== await read(file)) fail(`${domain}: 상위 브랜치의 SSOT가 달라졌습니다. 동기화 후 다시 검증하세요.`)
  }
  const common = (await git(context.cwd, ['merge-base', current.commit, workspace.git.head])).trim()
  const changes = (await git(workingTree ? attempt.workspace : context.cwd, ['diff', '--name-only', '-z', common, ...(workingTree ? [] : [workspace.git.head]), '--', 'spec/'])).split('\0').filter(Boolean)
  if (workingTree) changes.push(...(await git(attempt.workspace, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'spec/'])).split('\0').filter(Boolean))
  const own = new Set(current.tasks.map(({ task }) => task.file))
  if (changes.some((file) => !own.has(file))) fail('워커는 자신의 태스크 외 spec 문서를 변경할 수 없습니다. 기획 공간으로 인계하세요.', changes)
  return { ...current, workerCommit: workspace.git.head }
}

function commands(options, key = 'verify', optional = false) {
  const values = options[key] ?? []
  if (optional && Array.isArray(values) && !values.length) return []
  if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== 'string' || !value.trim())) {
    fail(`실행할 검증 명령을 --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}로 지정하세요. 여러 번 지정할 수 있습니다.`)
  }
  return values
}

// Verification commands live on the group so any session, runner or background gate
// runs the right tier without repeating them. Explicit --verify still wins.
function storedChecks(options) {
  const verify = {}
  for (const [tier, key] of [['task', 'taskVerify'], ['unit', 'verify'], ['group', 'groupVerify']]) {
    if (options[key] !== undefined) verify[tier] = commands(options, key, true)
  }
  return verify
}

function tierChecks(options, group, tier) {
  if (tier === 'task') return options.verify !== undefined ? commands(options, 'verify', true) : group.verify?.task ?? []
  if (options.verify?.length) return commands(options)
  if (group.verify?.[tier]?.length) return group.verify[tier]
  return fail(`실행할 검증 명령을 --verify로 지정하거나 work start/configure에 ${tier === 'unit' ? '--verify' : '--group-verify'}로 저장하세요.`)
}

// Full suites run at unit integration and group finish, so a single check may be long.
function verifyTimeout(options) {
  const value = Number(options.verifyTimeoutMs ?? 60 * 60 * 1000)
  if (!Number.isSafeInteger(value) || value < 1) fail('verify-timeout-ms: 양의 정수가 필요합니다.')
  return value
}

// HAERAM_DIFF_BASE lets one stored command select only the affected tests, e.g.
// `git diff --name-only "$HAERAM_DIFF_BASE" HEAD`, so the host verifies the impact itself.
async function verify(root, checks, commit, signal, timeout = 60 * 60 * 1000, scope = {}) {
  const results = []
  const env = { ...process.env, ...Object.fromEntries(Object.entries(scope).map(([key, value]) => [`HAERAM_${key}`, String(value)])) }
  for (const command of checks) {
    const startedAt = now()
    try {
      const { stdout, stderr } = await execute(command, { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout, signal, env })
      results.push({ command, startedAt, finishedAt: now(), stdout: stdout.slice(-16000), stderr: stderr.slice(-16000) })
    } catch (error) {
      fail(`검증 실패: ${command}`, [(error.stderr || error.stdout || error.message).slice(-16000)])
    }
    if (await head(root) !== commit) fail('검증 명령 실행 중 HEAD가 변경됐습니다. 새 커밋을 다시 검증하세요.')
    await requireClean(root)
  }
  return results
}

// An approval survives a moved target when nothing that moved touches the submission's
// files or SSOT. The merged result is still fully verified at integration.
async function approvalHolds(root, review, target) {
  if (!review?.baseCommit || review.baseCommit === target) return Boolean(review?.baseCommit)
  if (!(await ancestor(root, review.baseCommit, target))) return false
  const changed = async (...range) => (await git(root, ['diff', '--name-only', '-z', ...range])).split('\0').filter(Boolean)
  const own = new Set(await changed(`${review.baseCommit}...${review.commit}`))
  const moved = (await changed(review.baseCommit, target)).filter((file) => file !== 'spec/STATE.md' && !file.startsWith('spec/work/'))
  return !moved.some((file) => own.has(file) || file.startsWith('spec/ssot/'))
}

export async function inspectWork(options = {}) {
  const workspace = await inspectWorkspace(options)
  if (!workspace.git) return { schemaVersion: 1, mode: 'single', groups: [], attempts: [], lock: null }
  const root = runtimeRoot(workspace)
  const state = await readRuntime(root)
  const groups = Object.values(state.groups)
  const attempts = Object.values(state.attempts)
  const currentAttempt = attempts.find((entry) => entry.workspace === workspace.git.root && !entry.cleanedAt) ?? null
  const currentGroup = groups.find((entry) => entry.path === workspace.git.root && entry.status === 'active') ?? null
  const currentReview = attempts.flatMap((entry) => [entry.review, ...(entry.reviewHistory ?? [])]).find((review) => review?.workspace === workspace.git.root) ?? null
  return { schemaVersion: 1, mode: currentReview ? 'reviewer' : currentAttempt ? 'worker' : currentGroup ? 'group' : 'single',
    currentAttempt, currentReview, currentGroup, groups, attempts, lock: await readLock(root) }
}

export async function startWork(options) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name ?? '') || options.name.length > 60) fail('작업 이름은 60자 이하의 kebab-case로 지정하세요.')
  const context = await repository(options)
  storedChecks(options)
  const mode = options.workspace ?? 'auto'
  if (!['auto', 'new', 'current'].includes(mode)) fail('workspace는 auto, current, new 중 하나여야 합니다.')
  const adopted = mode === 'current' || (mode === 'auto' && context.workspace.git.isLinkedWorktree && !options.path && !options.base && !options.branch)
  if (adopted && (options.path || options.base || options.branch)) fail('current 모드는 현재 브랜치를 그대로 연결합니다. path/base/branch를 함께 지정하지 마세요.')
  const branch = adopted ? context.workspace.git.branch : options.branch ?? `work/${options.name}`
  if (!branch) fail('작업 묶음은 브랜치가 필요합니다. detached HEAD에서는 new 모드를 사용하세요.')
  await git(context.cwd, ['check-ref-format', '--branch', branch])
  const baseRef = adopted ? null : options.base ?? context.workspace.git.branch
  if (!adopted && !baseRef) fail('분기 기준을 --base로 지정하세요.')
  const baseCommit = await head(context.cwd, baseRef ?? 'HEAD')
  if (await blob(context.cwd, baseCommit, `spec/work/${options.name}.json`) !== null) fail('같은 이름의 작업 묶음 이력이 이미 저장돼 있습니다. 이력을 보존하려면 새 이름으로 시작하세요.')
  // Avoid silently omitting the user's uncommitted planning documents.
  await requireClean(context.cwd)
  const target = adopted ? context.cwd : await destination(context, `${options.name}-plan`, options.path)
  const group = { id: options.name, branch, baseRef, baseCommit, path: target, managed: !adopted, status: 'preparing', creator: creator(), createdAt: now(), limits: workLimits(options), verify: storedChecks(options) }
  await transaction(context.root, (state) => {
    if (Object.hasOwn(state.groups, group.id)) fail('같은 이름의 작업 묶음이 이미 있습니다. work status를 확인하세요.')
    if (Object.values(state.groups).some((entry) => entry.branch === branch || entry.path === target)) fail('이미 사용 중인 기획 브랜치 또는 작업 공간입니다.')
    if (Object.values(state.attempts).some((entry) => !entry.cleanedAt && entry.workspace === target)) fail('워커가 사용 중인 공간입니다.')
    state.groups[group.id] = group
  })
  try {
    if (!adopted) await git(context.cwd, ['worktree', 'add', '-b', branch, target, baseCommit])
    const created = await inspectWorkspace({ targetRoot: target })
    return await transaction(context.root, (state) => {
      Object.assign(state.groups[group.id], { gitDir: created.git.gitDir, status: 'active' })
      return state.groups[group.id]
    })
  } catch (error) {
    await transaction(context.root, (state) => { Object.assign(state.groups[group.id], { status: 'failed', error: error.message }) })
    throw new SkillPackageError('작업 공간 준비에 실패했습니다. 현재 작업 공간은 전환하지 않았습니다. 남은 경로/브랜치를 확인하세요.', [target, branch, error.message])
  }
}

export async function configureWork(options) {
  const verify = storedChecks(options)
  if (!Object.keys(verify).length) fail('저장할 검증 명령을 --task-verify, --verify, --group-verify로 지정하세요.')
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const group = groupOf(state, options.work)
    group.verify = { ...group.verify, ...verify }
    return group
  })
}

export async function claimWork(options) {
  if (!TASK_ID.test(options.task ?? '')) fail('배정할 태스크 ID가 필요합니다 (T###).')
  return claimTask(options)
}

export async function claimNextWork(options) {
  if (!options.owner?.trim()) fail('claim-next에는 --owner가 필요합니다.')
  return claimTask(options, true)
}

async function claimTask(options, next = false) {
  const context = await repository(options)
  const initial = await readRuntime(context.root)
  const group = groupOf(initial, options.work)
  const commit = await head(context.cwd, `refs/heads/${group.branch}`)
  const board = await readTaskBoard({ targetRoot: context.cwd, ref: commit })
  if (!board.ok || board.warnings.length) fail('상위 브랜치의 태스크/STATE를 먼저 정리하고 커밋하세요.', [...board.errors, ...board.warnings])
  // Read/validate immutable task snapshots before the short allocation transaction.
  const claimed = new Set(Object.values(initial.attempts).filter(active).flatMap(unitTasks))
  const units = rankedUnits(planUnits(board.tasks, board.doneIds, claimed), board.tasks)
  const candidates = []
  const skipped = []
  for (const unit of units.filter((entry) => next ? entry.ready : entry.ids.includes(options.task))) {
    try { candidates.push({ unit, ...await currentUnit(context, group, unit.ids, { commit, board }) }) } catch (error) {
      if (!next) throw error
      skipped.push({ task: unit.ids.join(' '), reason: error.message })
    }
  }
  if (!next && !candidates.length) fail(`${options.task}: 다른 실행이 이미 선점했거나 todo 태스크가 아닙니다.`)
  const mode = options.workspace ?? 'auto'
  if (!['auto', 'current', 'new'].includes(mode)) fail('workspace는 auto, current, new 중 하나여야 합니다.')
  const bound = Object.values(initial.attempts).some((entry) => entry.workspace === context.cwd && !entry.cleanedAt)
  const adopted = mode === 'current' || (mode === 'auto' && !options.path && !bound && context.workspace.git.isLinkedWorktree && context.cwd !== group.path)
  if (adopted && options.path) fail('current 모드에 path를 함께 지정하지 마세요.')
  if (adopted) {
    await requireClean(context.cwd)
    if (!(await ancestor(context.cwd, commit, context.workspace.git.head))) fail('현재 공간에 상위 작업 브랜치의 최신 커밋이 없습니다. 먼저 동기화하거나 --workspace new를 사용하세요.')
  }
  const id = randomUUID()
  const owner = options.owner ?? 'agent'
  const prepared = await Promise.all(candidates.map(async (current) => ({ current,
    target: adopted ? context.cwd : await destination(context, `${group.id}-${current.unit.lane ?? current.unit.ids[0]}-${id.slice(0, 8)}`, options.path),
  })))
  const selected = await transaction(context.root, async (state) => {
    const live = groupOf(state, group.id)
    const idle = (reason) => { if (!next) fail(reason); return { idle: true, reason, skipped } }
    if (await head(context.cwd, `refs/heads/${group.branch}`) !== commit || candidates.some((entry) => entry.commit !== commit)) return idle('planning-changed; retry')
    const all = Object.values(state.attempts)
    const local = all.filter((entry) => entry.group === group.id)
    const limits = workLimits(live.limits)
    if (local.filter(workerBusy).length >= limits.workers) return idle('worker-capacity')
    if (next && local.some((entry) => workerBusy(entry) && entry.owner === owner)) return idle('owner-busy')
    if (local.some((entry) => entry.status === 'changes_requested')) return idle('changes-requested; resume corrections first')
    if (local.filter(pendingReview).length >= limits.maxPending) return idle('review-backpressure')
    const available = prepared.find(({ current }) => !all.some((entry) => active(entry) &&
      (unitTasks(entry).some((taskId) => current.unit.ids.includes(taskId)) || overlaps(current.unit.touches, entry.touches))))
    if (!available) return idle(next ? 'no-eligible-task' : `${options.task}: 다른 실행이 이미 선점했거나 touches 영역을 사용 중입니다.`)
    const { current: { unit }, target } = available
    assertFreeWorkspace(state, target)
    const branch = adopted ? context.workspace.git.branch : unit.lane ? `lane/${group.id}/${unit.lane}-${id.slice(0, 8)}` : `task/${group.id}/${unit.ids[0]}-${id.slice(0, 8)}`
    const attempt = { id, group: group.id, taskId: unit.ids[0], tasks: unit.ids, lane: unit.lane, owner, contributors: [owner], workspace: target,
      branch, managed: !adopted, startCommit: commit, touches: unit.touches, status: 'preparing', creator: creator(), createdAt: now(), heartbeatAt: now() }
    state.attempts[id] = attempt
    return attempt
  })
  if (selected.idle) return selected
  try {
    if (!adopted) await git(context.cwd, ['worktree', 'add', '-b', selected.branch, selected.workspace, selected.startCommit])
    const created = await inspectWorkspace({ targetRoot: selected.workspace })
    return await transaction(context.root, (state) => {
      if (attemptOf(state, id).status !== 'preparing') fail('작업 공간 준비 중 배정 상태가 변경됐습니다.')
      Object.assign(attemptOf(state, id), { gitDir: created.git.gitDir, status: 'doing' })
      return state.attempts[id]
    })
  } catch (error) {
    await transaction(context.root, (state) => {
      const entry = attemptOf(state, id)
      if (entry.status === 'preparing') Object.assign(entry, { status: 'failed', error: error.message })
    })
    throw new SkillPackageError('태스크 작업 공간 준비에 실패했습니다. 병렬 쓰기로 우회하지 않습니다.', [selected.workspace, selected.branch ?? '(detached)', error.message])
  }
}

export async function updateWork(options) {
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, options.attempt)
    notIntegrating(groupOf(state, attempt.group), attempt)
    if (!['doing', 'blocked', 'ready', 'approved', 'changes_requested'].includes(attempt.status)) fail(`이 실행은 갱신할 수 없습니다: ${attempt.status}`)
    if (options.status && !['doing', 'blocked'].includes(options.status)) fail('상태는 doing 또는 blocked만 지정할 수 있습니다. ready는 submit으로 검증합니다.')
    if (options.status === 'blocked' && !options.reason?.trim()) fail('blocked에는 --reason이 필요합니다.')
    if (options.status) {
      if (options.status === 'doing' && !workerBusy(attempt) && Object.values(state.attempts).filter((entry) => entry.group === attempt.group && workerBusy(entry)).length >= workLimits(groupOf(state, attempt.group).limits).workers) fail('worker-capacity')
      invalidateReview(attempt, 'worker resumed or blocked')
      attempt.status = options.status
      attempt.reason = options.reason ?? null
      delete attempt.verifiedCommit
    }
    attempt.heartbeatAt = now()
    return attempt
  })
}

export async function releaseWork(options) {
  const context = await repository(options)
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, options.attempt)
    notIntegrating(groupOf(state, attempt.group), attempt)
    if (!['doing', 'blocked', 'ready', 'approved', 'changes_requested', 'preparing', 'failed'].includes(attempt.status)) fail(`이 실행은 해제할 수 없습니다: ${attempt.status}`)
    if (attempt.status === 'preparing') requireStopped(attempt.creator)
    invalidateReview(attempt, 'attempt released')
    attempt.status = 'released'
    attempt.reason = options.reason ?? 'explicit release; workspace retained'
    attempt.releasedAt = now()
    return attempt
  })
}

async function reserve(context, attemptId, operation, allowed) {
  const token = randomUUID()
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, attemptId)
    const group = groupOf(state, attempt.group)
    if (operation === 'integrating') noOperation(group)
    else notIntegrating(group, attempt)
    if (!allowed.includes(attempt.status)) fail(`${operation}할 수 없는 상태입니다: ${attempt.status}`)
    if (operation === 'integrating' && (attempt.review?.status !== 'approved' || attempt.review.commit !== attempt.verifiedCommit)) fail('현재 제출 커밋에 대한 리뷰 승인이 필요합니다.')
    if (operation === 'verifying' && !workerBusy(attempt) && Object.values(state.attempts).filter((entry) => entry.group === attempt.group && workerBusy(entry)).length >= workLimits(group.limits).workers) fail('worker-capacity')
    if (operation === 'verifying') { invalidateReview(attempt, 'new submission'); delete attempt.verifiedCommit }
    attempt.operation = { token, attempt: attemptId, kind: operation, pid: process.pid, host: os.hostname(), at: now() }
    if (operation === 'integrating') group.operation = attempt.operation
    attempt.status = operation
    return { attempt: structuredClone(attempt), group: structuredClone(group), token }
  })
}

async function finishOperation(context, reservation, update) {
  return transaction(context.root, (state) => {
    const attempt = attemptOf(state, reservation.attempt.id)
    const group = groupOf(state, reservation.group.id)
    if (attempt.operation?.token !== reservation.token) fail('작업 명령의 소유권이 바뀌었습니다.')
    update(attempt)
    if (group.operation?.token === reservation.token) delete group.operation
    delete attempt.operation
    return attempt
  })
}

export async function commitWorkerWork(options) {
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'committing', ['doing'])
  try {
    const current = await checkWorker(context, reservation.group, reservation.attempt, true)
    if (!options.expectedHead || current.workerCommit !== options.expectedHead) fail('에이전트 실행 중 HEAD가 변경됐습니다. 자동 커밋 전에 확인하세요.')
    options.signal?.throwIfAborted()
    if (!(await clean(reservation.attempt.workspace))) {
      await git(reservation.attempt.workspace, ['add', '--all'])
      options.signal?.throwIfAborted()
      await git(reservation.attempt.workspace, ['commit', '-m', `Implement ${reservation.attempt.taskId}`])
    }
    await checkWorker(context, reservation.group, reservation.attempt)
    return await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: 'doing', reason: null }))
  } catch (error) {
    await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: 'blocked', reason: error.message }))
    throw error
  }
}

// Task-level checks are optional: the worker runs the tests its change touches, while
// full suites belong to unit integration and group finish.
export async function submitWork(options) {
  if (options.verify !== undefined) commands(options, 'verify', true)
  const timeout = verifyTimeout(options)
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'verifying', ['doing', 'blocked', 'ready', 'approved', 'changes_requested'])
  try {
    const checks = tierChecks(options, reservation.group, 'task')
    const current = await checkWorker(context, reservation.group, reservation.attempt)
    const { attempt } = reservation
    const ids = unitTasks(attempt)
    // A first submission diffs from the previous lane step; a resubmission covers the whole unit.
    const previous = (attempt.steps ?? []).some((entry) => entry.taskId === attempt.taskId) ? null
      : (attempt.steps ?? []).find((entry) => entry.taskId === ids[ids.indexOf(attempt.taskId) - 1])?.commit
    const diffBase = previous ?? (await git(context.cwd, ['merge-base', current.commit, current.workerCommit])).trim()
    const verification = await verify(attempt.workspace, checks, current.workerCommit, options.signal, timeout,
      { TIER: 'task', DIFF_BASE: diffBase, TASK: attempt.taskId, TASKS: ids.join(' ') })
    await assertWorkspace(context, reservation.attempt)
    // Another unit may integrate meanwhile; the contract and SSOT must still match the new target.
    const latest = await checkWorker(context, reservation.group, reservation.attempt)
    if (latest.workerCommit !== current.workerCommit) fail('검증 중 워커 HEAD가 바뀌었습니다. 다시 제출하세요.')
    options.signal?.throwIfAborted()
    const position = ids.indexOf(reservation.attempt.taskId)
    const step = { taskId: reservation.attempt.taskId, commit: current.workerCommit, verification: progressChecks(verification), at: now() }
    const steps = (attempt) => [...(attempt.steps ?? []).filter((entry) => entry.taskId !== step.taskId), step]
    if (position < ids.length - 1) {
      // A lane step hands the same workspace its next task without waiting for review.
      return await finishOperation(context, reservation, (attempt) => Object.assign(attempt, {
        status: 'doing', taskId: ids[position + 1], steps: steps(attempt), reason: null,
      }))
    }
    await git(context.cwd, ['update-ref', `refs/haeram/attempts/${reservation.attempt.id}`, current.workerCommit])
    return await finishOperation(context, reservation, (attempt) => Object.assign(attempt, {
      status: 'ready', submissionId: randomUUID(), verifiedCommit: current.workerCommit, submittedBase: latest.commit, verification, steps: steps(attempt), submittedAt: now(), reason: null,
    }))
  } catch (error) {
    await finishOperation(context, reservation, (attempt) => Object.assign(attempt, { status: 'blocked', reason: error.message }))
    throw error
  }
}

async function archiveTasks(root, tasks, attempt, integration) {
  const steps = new Map((attempt.steps ?? []).map((step) => [step.taskId, step]))
  const quoted = (entries) => entries.map((entry) => JSON.stringify(entry.command ?? entry)).join('; ')
  for (const task of tasks) {
    const step = steps.get(task.id) ?? { commit: attempt.verifiedCommit, verification: attempt.verification ?? [] }
    const file = path.join(root, task.file)
    let content = await readFile(file, 'utf8')
    content = content.replace(/^> st:[^|]+\|/m, `> st:done@${date()} |`)
    content = content.replace(/^- at:.*$/m, `- at: ${step.commit}`)
    // Host-executed checks replace the worker's wording; without them the worker's own
    // impact-selected checks stay, followed by the unit integration checks.
    content = content.replace(/^- verified:(.*)$/m, (_, worker) => `- verified: ${[step.verification.length ? quoted(step.verification) : worker.trim(),
      integration.length ? `integration ${quoted(integration)}` : null].filter(Boolean).join('; ')}`)
    await writeFile(file, content)
    const archive = path.join(root, 'spec', 'tasks', 'done', path.basename(file))
    try { await access(archive, constants.F_OK); fail('완료 아카이브 파일이 이미 있습니다.', [archive]) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await mkdir(path.dirname(archive), { recursive: true })
    await rename(file, archive)
  }
  const ids = tasks.map((task) => task.id)
  const statePath = path.join(root, 'spec', 'STATE.md')
  const state = await readFile(statePath, 'utf8')
  let section = null
  const removed = new Set()
  const rows = state.split(/\r?\n/).filter((row) => {
    if (row.startsWith('## ')) section = row.slice(3).trim()
    const id = section === 'tasks' && row.match(/^\|\s*(T\d{3,})\s*\|/)?.[1]
    if (id && ids.includes(id)) { removed.add(id); return false }
    return true
  })
  if (removed.size !== ids.length) fail('STATE에서 완료 처리할 태스크 행을 찾지 못했습니다.', ids.filter((id) => !removed.has(id)))
  let next = rows.join('\n').replace(/(## log\s*\n)/, `$1- ${date()} ${ids.join(' ')} integrated\n`)
  next = next.replace(/## next\n[\s\S]*?(?=\n## |$)/, '## next\n- inspect work board for remaining tasks\n')
  const log = next.indexOf('## log\n')
  if (log !== -1) next = next.slice(0, log) + '## log\n' + next.slice(log + 7).split('\n').filter((row) => row.startsWith('- ')).slice(0, 20).join('\n') + '\n'
  await writeFile(statePath, next)
}

export async function integrateWork(options) {
  if (options.verify?.length) commands(options)
  const timeout = verifyTimeout(options)
  const context = await repository(options)
  const initial = await readRuntime(context.root)
  const checks = tierChecks(options, groupOf(initial, attemptOf(initial, options.attempt).group), 'unit')
  const reservation = await reserve(context, options.attempt, 'integrating', ['approved'])
  const { attempt, group } = reservation
  let candidate
  let applied = false
  try {
    await assertWorkspace(context, group)
    await requireClean(group.path)
    const current = await checkWorker(context, group, attempt)
    if (!(await approvalHolds(context.cwd, attempt.review, current.commit))) {
      await finishOperation(context, reservation, (entry) => { invalidateReview(entry, 'integration base changed'); entry.status = 'ready'; entry.reason = 'review-base-changed' })
      fail('상위 브랜치가 리뷰 이후 변경됐습니다. 최신 기준으로 재리뷰하세요.')
    }
    if (current.workerCommit !== attempt.verifiedCommit) fail('제출 이후 워커 HEAD가 바뀌었습니다. submit으로 다시 검증하세요.')
    if (await head(group.path) !== current.commit) fail('기획 공간의 HEAD와 작업 브랜치가 다릅니다.')
    candidate = await destination(context, `${group.id}-integrate-${randomUUID().slice(0, 8)}`)
    await transaction(context.root, (state) => {
      const entry = attemptOf(state, attempt.id)
      Object.assign(entry, { candidate, targetCommit: current.commit, candidateCommit: null, integrationVerification: null })
      entry.candidates = [...(entry.candidates ?? []), candidate]
    })
    await git(context.cwd, ['worktree', 'add', '--detach', candidate, current.commit])
    await git(candidate, ['merge', '--no-ff', '--no-commit', attempt.verifiedCommit])
    const tasks = current.tasks.map((entry) => entry.task)
    await archiveTasks(candidate, tasks, attempt, checks)
    const progress = await readRuntime(context.root)
    Object.assign(progress.attempts[attempt.id], { status: 'integrated', reason: null })
    const historyFile = await writeProgress(candidate, group, progress, current.commit)
    const spec = await lintSpec({ targetRoot: candidate })
    if (!spec.ok || spec.warnings.length) fail('통합 후보의 spec 검증에 실패했습니다.', [...spec.errors, ...spec.warnings])
    await git(candidate, ['add', '--', 'spec/STATE.md', historyFile, ...tasks.flatMap((task) => [task.file, `spec/tasks/done/${path.basename(task.file)}`])])
    await git(candidate, ['commit', '-m', `Integrate ${attempt.lane ? `lane ${attempt.lane} (${tasks.map((task) => task.id).join(' ')})` : attempt.taskId} into ${group.id}`])
    const candidateCommit = await head(candidate)
    const verification = await verify(candidate, checks, candidateCommit, options.signal, timeout,
      { TIER: 'unit', DIFF_BASE: current.commit, TASKS: tasks.map((task) => task.id).join(' ') })
    await assertWorkspace(context, group)
    await requireClean(group.path)
    if (await head(group.path) !== current.commit) fail('검증 중 상위 브랜치가 이동했습니다. 새 기준으로 다시 통합하세요.')
    // Persist the receipt before moving the target. recover can reconcile a crash
    // between fast-forward and the last registry update.
    await transaction(context.root, (state) => { Object.assign(attemptOf(state, attempt.id), { candidateCommit, integrationVerification: verification }) })
    options.signal?.throwIfAborted()
    await git(group.path, ['merge', '--ff-only', candidateCommit])
    applied = true
    return await finishOperation(context, reservation, (entry) => Object.assign(entry, {
      status: 'integrated', integratedCommit: candidateCommit, integratedAt: now(), reason: null,
    }))
  } catch (error) {
    if (!applied) {
      const latest = (await readRuntime(context.root)).attempts[attempt.id]
      if (latest.operation?.token === reservation.token) {
        const sameWorker = await head(attempt.workspace).catch(() => null) === attempt.verifiedCommit && await clean(attempt.workspace).catch(() => false)
        const target = await head(group.path).catch(() => null)
        const sameBase = Boolean(target) && await approvalHolds(context.cwd, attempt.review, target).catch(() => false)
        await finishOperation(context, reservation, (entry) => {
          if (!sameWorker || !sameBase) invalidateReview(entry, 'review snapshot changed')
          // The background gate hands a failed merge or check back to the unit's owner as a correction.
          if (options.autoCorrect && sameWorker && candidate) {
            invalidateReview(entry, 'integration failed')
            entry.review = { id: randomUUID(), status: 'changes_requested', verdict: 'changes_requested', owner: 'integration', commit: attempt.verifiedCommit, baseCommit: target,
              summary: 'Integration failed on the merged candidate.', findings: [{ priority: 'P1', where: 'integration',
                message: `Merge the group branch into this workspace, fix the failure, and resubmit: ${[error.message, ...(error.details ?? [])].join('\n').slice(-4000)}` }], finishedAt: now() }
            Object.assign(entry, { status: 'changes_requested', reason: 'integration failed' })
          } else Object.assign(entry, { status: !sameWorker ? 'blocked' : sameBase ? 'approved' : 'ready', reason: error.message })
        })
      }
    }
    throw new SkillPackageError('통합을 완료하지 못했습니다. 후보 작업 공간을 보존했습니다. work status/recover로 확인하세요.', [candidate ?? '(후보 생성 전)', error.message, ...(error.details ?? [])])
  }
}

export async function recoverWork(options) {
  const context = await repository(options)
  const state = await readRuntime(context.root)
  if (options.work) {
    if (options.attempt) fail('복구 대상은 --work 또는 --attempt 중 하나만 지정하세요.')
    const group = Object.hasOwn(state.groups, options.work) ? state.groups[options.work] : null
    if (group?.status === 'active' && ['sync', 'finishing'].includes(group.operation?.kind)) {
      requireStopped(group.operation)
      return transaction(context.root, (current) => {
        const entry = current.groups[group.id]
        if (entry.operation?.token !== group.operation.token) fail('복구 중 묶음 명령의 소유권이 변경됐습니다.')
        entry[entry.operation.kind === 'sync' ? 'recoveredSync' : 'recoveredFinish'] = { ...entry.operation, recoveredAt: now() }
        delete entry.operation
        return entry
      })
    }
    if (!group || !['preparing', 'failed'].includes(group.status)) fail('복구할 작업 묶음 생성 기록이 없습니다.')
    if (group.status === 'preparing') requireStopped(group.creator)
    const workspace = await inspectWorkspace({ targetRoot: group.path })
    if (workspace.git?.commonDir !== context.workspace.git.commonDir || workspace.git.branch !== group.branch ||
        !(await ancestor(context.cwd, group.baseCommit, workspace.git.head))) fail('생성하려던 브랜치/경로와 현재 작업 공간이 다릅니다.')
    return transaction(context.root, (current) => {
      const entry = current.groups[group.id]
      if (entry.status !== group.status) fail('복구 중 생성 기록이 변경됐습니다.')
      Object.assign(entry, { status: 'active', gitDir: workspace.git.gitDir, managed: false, recoveredAt: now() })
      return entry
    })
  }
  const attempt = attemptOf(state, options.attempt)
  const group = groupOf(state, attempt.group)
  const operation = attempt.operation
  if (!operation || operation.attempt !== attempt.id) fail('복구할 실행 중 명령이 없습니다.')
  requireStopped(operation)
  if (operation.kind === 'cleaning') {
    const workspace = (await inspectWorkspace({ targetRoot: context.cwd })).git.worktrees.find((tree) => tree.path === attempt.workspace)
    let missing = false
    try { await access(attempt.workspace) } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true }
    return finishOperation(context, { attempt, group, token: operation.token }, (entry) => {
      entry.status = entry.integratedCommit ? 'integrated' : 'released'
      if (!workspace && missing) entry.cleanedAt = now()
      entry.reason = 'interrupted cleanup recovered; inspect retained candidates'
    })
  }
  const integrated = Boolean(attempt.candidateCommit && attempt.integrationVerification && await ancestor(context.cwd, attempt.candidateCommit, await head(context.cwd, `refs/heads/${group.branch}`)))
  return finishOperation(context, { attempt, group, token: operation.token }, (entry) => Object.assign(entry, integrated
    ? { status: 'integrated', integratedCommit: entry.candidateCommit, integratedAt: now(), reason: null }
    : { status: 'blocked', reason: 'interrupted operation; inspect preserved workspace before resubmitting' }))
}

export async function cleanupWork(options) {
  const context = await repository(options)
  const reservation = await reserve(context, options.attempt, 'cleaning', ['integrated', 'released'])
  const previous = reservation.attempt.integratedCommit ? 'integrated' : 'released'
  const { attempt, group } = reservation
  try {
    if (attempt.cleanedAt) fail('이미 정리된 실행입니다.')
    await assertWorkspace(context, attempt)
    await requireClean(attempt.workspace)
    const workerHead = await head(attempt.workspace)
    if (!(await ancestor(context.cwd, workerHead, await head(context.cwd, `refs/heads/${group.branch}`)))) fail('상위 브랜치에 포함되지 않은 커밋이 있습니다. 작업 공간을 보존합니다.')
    if (attempt.managed) {
      if ((await git(attempt.workspace, ['status', '--porcelain', '--ignored'])).trim()) fail('ignored 파일을 포함해 남은 파일이 있습니다. 확인 후 정리하세요.')
      await git(context.cwd, ['worktree', 'remove', attempt.workspace])
    }
    const preservedCandidates = []
    for (const candidate of attempt.candidates ?? []) {
      try {
        const inspection = await inspectWorkspace({ targetRoot: candidate })
        if (inspection.git?.commonDir !== context.workspace.git.commonDir || !inspection.git.detached ||
            (await git(candidate, ['status', '--porcelain', '--ignored'])).trim() ||
            !(await ancestor(context.cwd, inspection.git.head, await head(group.path)))) {
          preservedCandidates.push(candidate)
          continue
        }
        await git(context.cwd, ['worktree', 'remove', candidate])
      } catch { preservedCandidates.push(candidate) }
    }
    return await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: previous, cleanedAt: now(), workspaceRetained: !attempt.managed, preservedCandidates }))
  } catch (error) {
    await finishOperation(context, reservation, (entry) => Object.assign(entry, { status: previous, reason: error.message }))
    throw error
  }
}

export async function workBoard(options) {
  const context = await repository(options)
  const state = await readRuntime(context.root)
  const group = groupOf(state, options.work)
  const board = await readTaskBoard({ targetRoot: context.cwd, ref: `refs/heads/${group.branch}` })
  const attempts = Object.values(state.attempts)
  const live = attempts.filter(active)
  const units = planUnits(board.tasks, board.doneIds, new Set(live.flatMap(unitTasks)))
  const usable = !group.operation && board.ok && board.warnings.length === 0
  for (const task of board.tasks) {
    const attempt = live.find((entry) => unitTasks(entry).includes(task.id))
    const unit = units.find((entry) => entry.ids.includes(task.id))
    task.attempt = attempt ?? null
    task.unit = unit?.key ?? (attempt?.lane ? `lane:${attempt.lane}` : task.id)
    task.claimable = Boolean(unit?.ready) && usable && !live.some((entry) => overlaps(unit.touches, entry.touches))
    task.runtimeStatus = attempt?.status ?? null
  }
  const local = attempts.filter((entry) => entry.group === group.id)
  return { ...board, scope: 'work', group, limits: workLimits(group.limits), attempts: local,
    units: [
      ...local.filter(active).map((entry) => ({ key: entry.lane ? `lane:${entry.lane}` : entry.taskId, lane: entry.lane ?? null, tasks: unitTasks(entry), attempt: entry.id, status: entry.status, current: entry.taskId })),
      ...units.map((unit) => ({ key: unit.key, lane: unit.lane, tasks: unit.ids, waitingOn: unit.waitingOn,
        claimable: unit.ready && usable && !live.some((entry) => overlaps(unit.touches, entry.touches)) })),
    ],
    verified: await groupVerification(context, group),
    summary: workSummary(board, local),
    queues: Object.fromEntries(['doing', 'ready', 'reviewing', 'approved', 'changes_requested', 'blocked'].map((status) => [status, local.filter((entry) => entry.status === status).map((entry) => entry.id)])) }
}

// A group gate stays current while later commits only save progress checkpoints.
async function groupVerification(context, group) {
  if (!group.verified) return null
  const target = await head(context.cwd, `refs/heads/${group.branch}`)
  const changed = (await git(context.cwd, ['diff', '--name-only', group.verified.commit, target, '--', '.', ':(exclude)spec/STATE.md', `:(exclude)spec/work/${group.id}.json`], [128]))
  return { ...group.verified, current: changed !== null && !changed.trim() }
}

// The group gate runs the full verification once, after every unit is integrated.
export async function finishWork(options) {
  if (options.verify?.length) commands(options)
  const timeout = verifyTimeout(options)
  const context = await repository(options)
  const checks = tierChecks(options, groupOf(await readRuntime(context.root), options.work), 'group')
  const token = randomUUID()
  const group = await transaction(context.root, (state) => {
    const entry = groupOf(state, options.work)
    noOperation(entry)
    if (entry.runner && entry.runner.id !== options.runnerId) fail('runner 실행 중에는 수동 finish를 할 수 없습니다. runner의 --group-verify를 사용하세요.')
    const live = Object.values(state.attempts).filter((attempt) => attempt.group === entry.id && active(attempt))
    if (live.length) fail('통합되지 않은 실행이 남아 있습니다. 통합하거나 해제한 뒤 finish하세요.', live.map((attempt) => `${attempt.id} ${unitTasks(attempt).join(' ')} ${attempt.status}`))
    entry.operation = { token, kind: 'finishing', ...creator(), startedAt: now() }
    return structuredClone(entry)
  })
  let verified
  try {
    await assertWorkspace(context, group)
    await requireClean(group.path)
    const commit = await head(group.path)
    const board = await readTaskBoard({ targetRoot: context.cwd, ref: commit })
    if (!board.ok || board.warnings.length) fail('작업 브랜치의 태스크/STATE를 먼저 정리하세요.', [...board.errors, ...board.warnings])
    const remaining = board.tasks.filter((task) => !task.st?.startsWith('blocked@'))
    if (remaining.length) fail('남은 태스크가 있습니다. 모두 통합한 뒤 finish하세요.', remaining.map((task) => `${task.id} ${task.st}`))
    let verification
    try {
      verification = await verify(group.path, checks, commit, options.signal, timeout, { TIER: 'group', DIFF_BASE: group.baseCommit })
    } catch (error) {
      await transaction(context.root, (state) => { groupOf(state, group.id).finishFailure = { commit, error: [error.message, ...(error.details ?? [])].join('\n').slice(-4000), at: now() } })
      throw error
    }
    verified = { commit, checks: progressChecks(verification), at: now(), excluded: board.tasks.map((task) => task.id) }
    await transaction(context.root, (state) => {
      const entry = groupOf(state, group.id)
      if (entry.operation?.token !== token) fail('finish 소유권이 변경됐습니다.')
      entry.verified = verified
      delete entry.finishFailure
    })
  } finally {
    await transaction(context.root, (state) => {
      const entry = groupOf(state, group.id)
      if (entry.operation?.token === token) delete entry.operation
    })
  }
  // The runner saves its own checkpoint on exit; a manual finish saves one now.
  if (options.runnerId) return { schemaVersion: 1, work: group.id, verified, snapshot: null }
  try { return { schemaVersion: 1, work: group.id, verified, snapshot: await syncWork(options) } } catch (error) {
    return { schemaVersion: 1, work: group.id, verified, snapshot: null, snapshotError: error.message }
  }
}

export async function workHistory(options) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.work ?? '') || options.work.length > 60) fail('이력을 조회할 작업 묶음 이름이 필요합니다.')
  if (options.task && !TASK_ID.test(options.task)) fail('이력을 조회할 태스크 ID는 T### 형식이어야 합니다.')
  const context = await repository(options)
  const state = await readRuntime(context.root)
  const group = Object.hasOwn(state.groups, options.work) ? state.groups[options.work] : null
  let history, snapshotAt = null
  if (group) history = (state.history ?? []).filter((entry) => entry.group === group.id)
  else {
    let snapshot
    try { snapshot = JSON.parse(await readFile(path.join(context.cwd, 'spec/work', `${options.work}.json`), 'utf8')) } catch (error) {
      fail('작업 묶음의 실행 기록 또는 저장된 이력을 찾을 수 없습니다.', [error.message])
    }
    if (snapshot?.schemaVersion !== 1 || snapshot.group?.id !== options.work || !Array.isArray(snapshot.history)) fail('저장된 작업 이력 형식이 올바르지 않습니다.')
    history = snapshot.history
    snapshotAt = snapshot.snapshotAt
  }
  return { schemaVersion: 1, work: options.work, scope: group ? 'runtime' : 'snapshot', snapshotAt, task: options.task ?? null,
    history: history.filter((entry) => !options.task || entry.taskId === options.task || entry.tasks?.includes(options.task)) }
}

async function writeProgress(root, group, state, sourceCommit) {
  const board = await readTaskBoard({ targetRoot: root })
  if (!board.ok || board.warnings.length) fail('진행 기록을 저장할 태스크/STATE가 올바르지 않습니다.', [...board.errors, ...board.warnings])
  board.commit = sourceCommit
  const snapshot = progressSnapshot(state.groups[group.id], board, state)
  const file = `spec/work/${group.id}.json`
  await mkdir(path.join(root, 'spec/work'), { recursive: true })
  await writeFile(path.join(root, file), `${JSON.stringify(snapshot, null, 2)}\n`)
  const stateFile = path.join(root, 'spec/STATE.md')
  await writeFile(stateFile, progressState(await readFile(stateFile, 'utf8'), snapshot, `work/${group.id}.json`))
  return file
}

// Export a checkpoint through an isolated candidate, just like task integration.
// Workers never write STATE, and a dirty planning checkout is never overwritten.
export async function syncWork(options) {
  const context = await repository(options)
  const token = randomUUID()
  const group = await transaction(context.root, (state) => {
    const entry = groupOf(state, options.work)
    noOperation(entry)
    if (entry.runner) fail('runner 실행 중에는 수동 sync를 할 수 없습니다. 실행기가 종료 시 기록을 저장합니다.')
    if (Object.values(state.attempts).some((attempt) => attempt.group === entry.id && attempt.operation)) fail('태스크 명령이 실행 중입니다. 종료 후 sync하세요.')
    entry.operation = { token, kind: 'sync', ...creator(), startedAt: now() }
    return structuredClone(entry)
  })
  let candidate
  try {
    await assertWorkspace(context, group)
    await requireClean(group.path)
    const commit = await head(group.path)
    candidate = await destination(context, `${group.id}-sync-${token.slice(0, 8)}`)
    await transaction(context.root, (state) => {
      const entry = groupOf(state, group.id)
      if (entry.operation?.token !== token) fail('sync 소유권이 변경됐습니다.')
      Object.assign(entry.operation, { candidate, sourceCommit: commit })
    })
    await git(context.cwd, ['worktree', 'add', '--detach', candidate, commit])
    const file = await writeProgress(candidate, group, await readRuntime(context.root), commit)
    const spec = await lintSpec({ targetRoot: candidate })
    if (!spec.ok || spec.warnings.length) fail('진행 기록 후보의 spec 검증에 실패했습니다.', [...spec.errors, ...spec.warnings])
    await git(candidate, ['add', '--', 'spec/STATE.md', file])
    await git(candidate, ['commit', '-m', `Save progress for ${group.id}`])
    const savedCommit = await head(candidate)
    await transaction(context.root, (state) => {
      const entry = groupOf(state, group.id)
      if (entry.operation?.token !== token) fail('sync 소유권이 변경됐습니다.')
      entry.operation.savedCommit = savedCommit
    })
    await assertWorkspace(context, group)
    await requireClean(group.path)
    if (await head(group.path) !== commit) fail('진행 기록 저장 중 상위 브랜치가 변경됐습니다. 다시 sync하세요.')
    await git(group.path, ['merge', '--ff-only', savedCommit])
    // The saved commit now lives on the group branch; only a failed sync keeps its candidate.
    const removed = await git(context.cwd, ['worktree', 'remove', candidate]).then(() => true, () => false)
    return { schemaVersion: 1, work: group.id, commit: savedCommit, file, candidate: removed ? null : candidate }
  } catch (error) {
    throw new SkillPackageError('진행 기록을 저장하지 못했습니다. 원본과 후보를 보존했습니다.', [candidate ?? '(후보 생성 전)', error.message, ...(error.details ?? [])])
  } finally {
    await transaction(context.root, (state) => {
      const entry = groupOf(state, group.id)
      if (entry.operation?.token === token) delete entry.operation
    })
  }
}

export async function unlockWork(options) {
  const context = await repository(options)
  return unlockRuntime(context.root, options.lockId)
}

// Shared protocol primitives; only public lifecycle APIs are re-exported by index.mjs.
export const workInternals = { repository, groupOf, attemptOf, noOperation, notIntegrating, requireStopped, destination, requireClean, assertWorkspace, checkWorker, head, clean, now, creator, fail, verify, commands, tierChecks, approvalHolds, groupVerification }
