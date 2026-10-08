import { readTaskBoard } from './task-board.mjs'
import { readRuntime } from './work-runtime.mjs'
import { claimNextWork, workInternals } from './work-groups.mjs'
import { claimReview, resumeWork } from './work-review.mjs'
import { activeAttempt, unitTasks } from './work-policy.mjs'

const { repository, groupOf, fail } = workInternals
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function waitSeconds(options) {
  if (options.wait === undefined) return 0
  const value = Number(options.wait)
  if (!Number.isSafeInteger(value) || value < 0 || value > 3600) fail('wait: 0~3600 사이 초 단위 정수가 필요합니다.')
  return value
}

// complete: nothing left · stalled: only a person can unblock it · waiting: in-flight work
// can still open something. Liveness of other sessions is unknown, so --wait stays bounded.
async function outlook(context, id) {
  const state = await readRuntime(context.root)
  const group = groupOf(state, id)
  const board = await readTaskBoard({ targetRoot: context.cwd, ref: `refs/heads/${group.branch}` })
  const live = Object.values(state.attempts).filter((entry) => entry.group === group.id && activeAttempt(entry))
  const owned = new Set(live.flatMap(unitTasks))
  const open = board.tasks.filter((task) => task.st === 'todo' && !owned.has(task.id))
  const moving = live.filter((entry) => entry.status !== 'blocked')
  const blocked = live.filter((entry) => entry.status === 'blocked').map((entry) => ({ attempt: entry.id, tasks: unitTasks(entry), reason: entry.reason ?? null }))
  if (!open.length && !live.length) return { state: 'complete' }
  if (!moving.length && !group.runner && !group.operation) return { state: 'stalled', blocked, waitingOn: open.map((task) => ({ id: task.id, waitingOn: task.waitingOn })) }
  return { state: 'waiting', inFlight: moving.map((entry) => ({ attempt: entry.id, tasks: unitTasks(entry), status: entry.status })) }
}

async function waitFor(options, attemptOnce) {
  const seconds = waitSeconds(options)
  const deadline = Date.now() + seconds * 1000
  const context = await repository(options)
  for (;;) {
    const result = await attemptOnce()
    if (!result.idle || result.reason === 'owner-busy') return result
    const view = await outlook(context, options.work)
    if (view.state !== 'waiting') return { ...result, idle: true, reason: view.state, detail: result.reason, ...view }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { ...result, reason: seconds ? 'timeout' : result.reason, detail: result.reason, ...view }
    await sleep(Math.min(options.pollMs ?? 5000, remaining))
  }
}

// One call for a long-lived worker session: corrections first, then the next ready unit.
export async function nextWork(options) {
  if (!options.owner?.trim()) fail('next에는 --owner가 필요합니다.')
  return waitFor(options, async () => {
    const corrected = await resumeWork(options)
    if (!corrected.idle) return corrected
    return claimNextWork(options)
  })
}

export async function claimReviewWaiting(options) {
  if (!options.owner?.trim()) fail('review-claim에는 --owner가 필요합니다.')
  if (options.wait === undefined) return claimReview(options)
  return waitFor(options, () => claimReview(options))
}
