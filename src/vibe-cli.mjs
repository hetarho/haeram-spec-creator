import { vibeStatus, vibeSync, vibePush, vibeBeat, vibeCheckpoint, vibePreflight, vibeAwake, vibeCheck, vibeMergeState } from './vibe.mjs'
import { SkillPackageError } from './errors.mjs'

const HELP = `세션 도구 (start-vibe가 사용)
  vibe status [--tag <tag>] [--no-fetch]        원격의 다른 세션·남은 일·추천 경로(route)
  vibe sync                                     원격 push 브랜치를 HEAD에 반영 (STATE는 섹션 단위 병합)
  vibe push                                     sync 후 HEAD를 cfg push 브랜치로 push (거부되면 재시도)
  vibe beat --tag <tag> [--mode pair|autopilot] [--doing <T###|->] [--end]
                                                STATE ## active의 이 세션 행 쓰기·갱신·삭제 (커밋은 호출자)
  vibe checkpoint --tag <tag> [--message <text>] 작업 트리 스냅샷을 wip/<tag>로 push (현재 브랜치는 그대로)
  vibe preflight [--probe <command> [--provider claude|codex] [--allow-tool <rule> ...]]
                                                맡김 전 점검: push 권한·lint·절전 방지·CI 접근·헤드리스 워커 실측
  vibe awake [--hours <n>] | --stop             macOS caffeinate로 절전 방지
  vibe check [--heavy] [--no-cache] -- <command>
                                                같은 작업 트리에서 통과한 검사는 다시 돌리지 않음. --heavy는 무거운 검사를 하나씩
공통: --target <path>, --remote <name>. 출력은 JSON(check 제외).
`

const allowed = {
  status: ['tag', 'remote'], sync: ['remote'], push: ['remote'], beat: ['tag', 'mode', 'doing', 'host'],
  checkpoint: ['tag', 'message', 'remote'], preflight: ['remote', 'probe', 'provider', 'allow-tool', 'probe-timeout-ms'],
  awake: ['hours', 'remote'], check: [],
}
const flags = { status: ['no-fetch'], beat: ['end'], awake: ['stop'], check: ['heavy', 'no-cache'] }
const actions = { status: vibeStatus, sync: vibeSync, push: vibePush, beat: vibeBeat, checkpoint: vibeCheckpoint, preflight: vibePreflight, awake: vibeAwake }

export async function runVibeCLI(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(HELP); return }
  const action = args.shift()
  // Git calls the merge driver with three file paths and reads the exit code.
  if (action === 'merge-state') {
    const result = await vibeMergeState(args)
    if (result.conflicts.length) { process.stderr.write(`STATE 충돌: ${result.conflicts.join(', ')}\n`); process.exitCode = 1 }
    return
  }
  if (!Object.hasOwn(allowed, action)) throw new SkillPackageError(`알 수 없는 vibe 명령: ${action}`)
  const options = {}
  let command = null
  while (args.length) {
    const argument = args.shift()
    if (argument === '--') { command = args.splice(0).join(' '); break }
    if (argument === '--json') continue
    const key = argument.slice(2)
    if (argument.startsWith('--') && flags[action]?.includes(key)) {
      options[key === 'no-fetch' ? 'fetch' : key === 'no-cache' ? 'noCache' : key] = key === 'no-fetch' ? false : true
      continue
    }
    const equals = argument.indexOf('=')
    const name = argument.slice(2, equals === -1 ? undefined : equals)
    if (!argument.startsWith('--') || !['target', ...allowed[action]].includes(name)) throw new SkillPackageError(`지원하지 않는 옵션: ${argument}`)
    const value = equals === -1 ? args.shift() : argument.slice(equals + 1)
    if (value === undefined || (value.startsWith('--') && name !== 'probe')) throw new SkillPackageError(`${argument} 값이 필요합니다.`)
    const field = name === 'target' ? 'targetRoot' : name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (name === 'allow-tool') (options.allowTool ??= []).push(value)
    else options[field] = value
  }
  if (action === 'check') {
    process.exitCode = await vibeCheck(options, command)
    return
  }
  try {
    const result = await actions[action](options)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.ok === false) process.exitCode = 1
  } catch (error) {
    if (!(error instanceof SkillPackageError)) throw error
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: error.message, details: error.details ?? [] }, null, 2)}\n`)
    process.exitCode = 1
  }
}
