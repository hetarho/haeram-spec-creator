import { inspectWork, startWork, claimWork, claimNextWork, updateWork, releaseWork, submitWork, integrateWork, cleanupWork, recoverWork, workBoard, workHistory, syncWork, unlockWork } from './work-groups.mjs'
import { claimReview, finishReview, releaseReview, updateReview, resumeWork } from './work-review.mjs'
import { runWork, recoverRunner } from './work-runner.mjs'
import { workDoctor } from './work-providers.mjs'
import { SkillPackageError } from './errors.mjs'

const HELP = `작업 묶음 (Orca 등 외부 도구 없이도 사용 가능)
  work start <name> [--workspace auto|current|new] [--base <ref>] [--branch <branch>] [--path <path>]
  work claim <T###> --work <name> [--workspace auto|current|new] [--path <path>] [--owner <label>]
  work claim-next --work <name> --owner <label> [--workspace auto|current|new]
  work resume --work <name> --owner <label> [--attempt <id>]
  work review-claim --work <name> --owner <label> [--attempt <id>]
  work review-finish --review <id> --result-file <json-file>
  work review-update --review <id>
  work review-release --review <id> [--reason <text>]
  work doctor
  work run --work <name> [--provider auto|codex|claude | --providers codex,claude | --adapter <json-file>] --verify <command>
    [--reviewer-provider codex|claude] [--model <id>] [--reviewer-model <id>] [--dry-run]
    [--timeout-ms <ms>] [--max-dispatches <n>] [--max-task-runs <n>]
  work runner-recover --work <name>
  work status
  work board --work <name>
  work history --work <name> [--task <T###>]
  work sync --work <name>
  work update --attempt <id> [--status doing|blocked] [--reason <text>]
  work submit --attempt <id> --verify <command> [--verify <command> ...]
  work integrate --attempt <id> --verify <command> [--verify <command> ...]
  work release --attempt <id> [--reason <text>]
  work cleanup --attempt <id>
  work recover (--attempt <id> | --work <name>)
  work unlock --lock-id <id>

start 배정 한도: --workers <n> (4), --reviewers <n> (1), --max-pending <n> (8).\n공통: --target <path>, --json. 생성·통합 명령은 로컬 Git을 변경하며 원격 push는 하지 않습니다.
auto: 배정 가능한 기존 linked worktree는 연결하고, 기획 공간에서는 새 worktree를 생성합니다.
current: 현재 checkout을 사용합니다. new: 항상 별도 worktree를 만듭니다.
submit/integrate: 지정한 검증 명령을 셸로 실행합니다. 워커 변경은 먼저 커밋하세요.
release/recover: 기존 작업자·명령이 종료됐음을 확인한 뒤 실행하세요. TTL 자동 회수는 없습니다.
`

const allowed = {
  start: ['workspace', 'base', 'branch', 'path', 'workers', 'reviewers', 'max-pending'], claim: ['work', 'workspace', 'path', 'owner'],
  'claim-next': ['work', 'owner', 'workspace', 'path'], resume: ['work', 'owner', 'attempt'],
  'review-claim': ['work', 'owner', 'attempt'], 'review-finish': ['review', 'result-file'],
  'review-update': ['review'], 'review-release': ['review', 'reason'],
  doctor: [], run: ['work', 'adapter', 'verify', 'provider', 'providers', 'reviewer-provider', 'model', 'reviewer-model', 'timeout-ms', 'max-dispatches', 'max-task-runs'], 'runner-recover': ['work'],
  history: ['work', 'task'], sync: ['work'],
  status: [], board: ['work'], update: ['attempt', 'status', 'reason'],
  submit: ['attempt', 'verify'], integrate: ['attempt', 'verify'], release: ['attempt', 'reason'],
  cleanup: ['attempt'], recover: ['attempt', 'work'], unlock: ['lock-id'],
}
const actions = { doctor: workDoctor, 'claim-next': claimNextWork, resume: resumeWork, 'review-claim': claimReview, 'review-finish': finishReview,
  'review-update': updateReview, 'review-release': releaseReview, run: runWork, 'runner-recover': recoverRunner, start: startWork, claim: claimWork, status: inspectWork, board: workBoard,
  history: workHistory, sync: syncWork, update: updateWork, submit: submitWork, integrate: integrateWork, release: releaseWork,
  cleanup: cleanupWork, recover: recoverWork, unlock: unlockWork }

async function dispatch(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(HELP); return }
  const action = args.shift()
  if (!Object.hasOwn(actions, action)) throw new SkillPackageError(`알 수 없는 work 명령: ${action}`)
  const options = {}
  if (['start', 'claim'].includes(action)) {
    if (!args[0] || args[0].startsWith('-')) throw new SkillPackageError(`${action} 대상이 필요합니다.`)
    options[action === 'start' ? 'name' : 'task'] = args.shift()
  }
  while (args.length) {
    const argument = args.shift()
    if (argument === '--dry-run' && action === 'run') { options.dryRun = true; continue }
    if (argument === '--json') { options.json = true; continue }
    const equals = argument.indexOf('=')
    const key = argument.slice(2, equals === -1 ? undefined : equals)
    if (!argument.startsWith('--') || !['target', ...allowed[action]].includes(key)) throw new SkillPackageError(`지원하지 않는 옵션: ${argument}`)
    const value = equals === -1 ? args.shift() : argument.slice(equals + 1)
    if (!value || value.startsWith('--')) throw new SkillPackageError(`${argument} 값이 필요합니다.`)
    const field = key === 'target' ? 'targetRoot' : key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (key === 'verify') (options.verify ??= []).push(value)
    else options[field] = value
  }
  const result = await actions[action](options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.ok === false) process.exitCode = 1
}

export async function runWorkCLI(args) {
  const json = args.includes('--json')
  try { await dispatch(args) } catch (error) {
    if (!json) throw error
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: error.message, details: error.details ?? [] }, null, 2)}\n`)
    process.exitCode = 1
  }
}
