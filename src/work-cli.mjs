import { inspectWork, startWork, configureWork, claimWork, claimNextWork, updateWork, releaseWork, submitWork, integrateWork, finishWork, cleanupWork, recoverWork, workBoard, workHistory, syncWork, unlockWork } from './work-groups.mjs'
import { finishReview, releaseReview, updateReview, resumeWork } from './work-review.mjs'
import { nextWork, claimReviewWaiting } from './work-wait.mjs'
import { runWork, recoverRunner } from './work-runner.mjs'
import { workDoctor } from './work-providers.mjs'
import { SkillPackageError } from './errors.mjs'

const HELP = `작업 묶음 (Orca 등 외부 도구 없이도 사용 가능)
  work start <name> [--workspace auto|current|new] [--base <ref>] [--branch <branch>] [--path <path>]
    [--task-verify <command>] [--verify <command>] [--group-verify <command>]
  work configure --work <name> [--task-verify <command>] [--verify <command>] [--group-verify <command>]
  work claim <T###> --work <name> [--workspace auto|current|new] [--path <path>] [--owner <label>]
  work claim-next --work <name> --owner <label> [--workspace auto|current|new]
  work next --owner <label> [--work <name> | --start] [--wait <seconds>] [--workspace auto|current|new]
  work resume --work <name> --owner <label> [--attempt <id>]
  work review-claim --work <name> --owner <label> [--attempt <id>] [--wait <seconds>]
  work review-finish --review <id> --result-file <json-file>
  work review-update --review <id>
  work review-release --review <id> [--reason <text>]
  work doctor
  work run --work <name> [--provider auto|codex|claude | --providers codex,claude | --adapter <json-file>] --verify <command>
    [--task-verify <command>] [--group-verify <command>]
    [--reviewer-provider codex|claude] [--model <id>] [--reviewer-model <id>] [--dry-run]
    [--timeout-ms <ms>] [--max-dispatches <n>] [--max-task-runs <n>]
  work runner-recover --work <name>
  work status
  work board --work <name>
  work history --work <name> [--task <T###>]
  work sync --work <name>
  work update --attempt <id> [--status doing|blocked] [--reason <text>]
  work submit --attempt <id> [--verify <command> ...]
  work integrate --attempt <id> [--verify <command> ...] [--auto-correct]
  work finish --work <name> [--verify <command> ...]
  work release --attempt <id> [--reason <text>]
  work cleanup --attempt <id>
  work recover (--attempt <id> | --work <name>)
  work unlock --lock-id <id>

start 배정 한도: --workers <n> (4), --reviewers <n> (1), --max-pending <n> (8).\n공통: --target <path>, --json. 생성·통합 명령은 로컬 Git을 변경하며 원격 push는 하지 않습니다.
auto: 배정 가능한 기존 linked worktree는 연결하고, 기획 공간에서는 새 worktree를 생성합니다.
current: 현재 checkout을 사용합니다. new: 항상 별도 worktree를 만듭니다.
lane: 같은 lane의 태스크는 한 작업 공간에서 순서대로 구현하고 함께 리뷰·통합합니다.
검증 단계: submit=태스크(선택, 변경 영향) · integrate=단위 통합 · finish=묶음 완료. start/configure가 저장한
  --task-verify/--verify/--group-verify를 기본값으로 쓰며, 명령에는 HAERAM_TIER·HAERAM_DIFF_BASE·HAERAM_TASK(S)가 전달됩니다.
next: 세션 루프. 자기 단위 → 수정 요청 → 리뷰 → 다음 단위 순으로 action(implement|review|blocked|wait|complete|stalled)을
  반환하고, 승인된 단위의 통합과 묶음 완료 검증은 백그라운드 CLI로 시작합니다. --start는 활성 묶음이 없으면 새로 만듭니다.
submit/integrate/finish: 지정한 검증 명령을 셸로 실행합니다(--verify-timeout-ms, 기본 1시간). 워커 변경은 먼저 커밋하세요.
next/review-claim --wait: 배정이 생길 때까지 모델 호출 없이 기다립니다. complete·stalled·timeout이면 반환합니다.
release/recover: 기존 작업자·명령이 종료됐음을 확인한 뒤 실행하세요. TTL 자동 회수는 없습니다.
`

const allowed = {
  start: ['workspace', 'base', 'branch', 'path', 'workers', 'reviewers', 'max-pending', 'task-verify', 'verify', 'group-verify'],
  configure: ['work', 'task-verify', 'verify', 'group-verify'], claim: ['work', 'workspace', 'path', 'owner'],
  'claim-next': ['work', 'owner', 'workspace', 'path'], next: ['work', 'owner', 'workspace', 'path', 'wait', 'workers', 'reviewers', 'max-pending', 'task-verify', 'verify', 'group-verify'], resume: ['work', 'owner', 'attempt'],
  'review-claim': ['work', 'owner', 'attempt', 'wait'], 'review-finish': ['review', 'result-file'],
  'review-update': ['review'], 'review-release': ['review', 'reason'],
  doctor: [], run: ['work', 'adapter', 'verify', 'task-verify', 'group-verify', 'verify-timeout-ms', 'provider', 'providers', 'reviewer-provider', 'model', 'reviewer-model', 'timeout-ms', 'max-dispatches', 'max-task-runs'], 'runner-recover': ['work'],
  history: ['work', 'task'], sync: ['work'],
  status: [], board: ['work'], update: ['attempt', 'status', 'reason'],
  submit: ['attempt', 'verify', 'verify-timeout-ms'], integrate: ['attempt', 'verify', 'verify-timeout-ms'], finish: ['work', 'verify', 'verify-timeout-ms'], release: ['attempt', 'reason'],
  cleanup: ['attempt'], recover: ['attempt', 'work'], unlock: ['lock-id'],
}
const actions = { doctor: workDoctor, configure: configureWork, 'claim-next': claimNextWork, next: nextWork, resume: resumeWork, 'review-claim': claimReviewWaiting, 'review-finish': finishReview,
  'review-update': updateReview, 'review-release': releaseReview, run: runWork, 'runner-recover': recoverRunner, start: startWork, claim: claimWork, status: inspectWork, board: workBoard,
  history: workHistory, sync: syncWork, update: updateWork, submit: submitWork, integrate: integrateWork, finish: finishWork, release: releaseWork,
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
    if (argument === '--start' && action === 'next') { options.start = true; continue }
    if (argument === '--auto-correct' && action === 'integrate') { options.autoCorrect = true; continue }
    if (argument === '--json') { options.json = true; continue }
    const equals = argument.indexOf('=')
    const key = argument.slice(2, equals === -1 ? undefined : equals)
    if (!argument.startsWith('--') || !['target', ...allowed[action]].includes(key)) throw new SkillPackageError(`지원하지 않는 옵션: ${argument}`)
    const value = equals === -1 ? args.shift() : argument.slice(equals + 1)
    if (!value || value.startsWith('--')) throw new SkillPackageError(`${argument} 값이 필요합니다.`)
    const field = key === 'target' ? 'targetRoot' : key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (['verify', 'task-verify', 'group-verify'].includes(key)) (options[field] ??= []).push(value)
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
