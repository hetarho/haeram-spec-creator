import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { SkillPackageError } from './errors.mjs'

const execute = promisify(execFile)
const adapter = fileURLToPath(new URL('../bin/haeram-agent-adapter.mjs', import.meta.url))
const supported = ['codex', 'claude']
const requiredFlags = {
  codex: ['--sandbox', '--output-schema', '--output-last-message', '--json'],
  claude: ['--print', '--output-format', '--json-schema', '--permission-mode', '--allowedTools', '--tools', '--permission-prompts'],
}

async function probe(provider, cwd, env) {
  try {
    const [{ stdout: version }, { stdout: help }] = await Promise.all([
      execute(provider, ['--version'], { cwd, env, timeout: 5000, maxBuffer: 1024 * 1024 }),
      execute(provider, provider === 'codex' ? ['exec', '--help'] : ['--help'], { cwd, env, timeout: 5000, maxBuffer: 1024 * 1024 }),
    ])
    const missing = requiredFlags[provider].filter((flag) => !help.includes(flag))
    return { provider, available: true, compatible: missing.length === 0, version: version.trim(), missing }
  } catch (error) {
    return { provider, available: error.code !== 'ENOENT', compatible: false, error: error.code === 'ENOENT' ? 'not-installed' : error.killed ? 'probe-timeout' : 'probe-failed' }
  }
}

export async function inspectProviders(options = {}) {
  const providers = await Promise.all(supported.map((provider) => probe(provider, options.targetRoot ?? process.cwd(), options.env ?? process.env)))
  const selected = providers.find((entry) => entry.compatible)?.provider ?? null
  return { schemaVersion: 1, providers, autoProvider: selected, authentication: 'not-checked', modelRequests: 0 }
}

export async function inspectOrca(options = {}) {
  const env = options.env ?? process.env
  const candidates = options.orcaCommand ? [options.orcaCommand] : env.ORCA_CLI_COMMAND ? [env.ORCA_CLI_COMMAND] : [
    'orca', 'orca-dev', 'orca-ide',
    ...(process.platform === 'darwin' ? ['/Applications/Orca.app/Contents/Resources/bin/orca', path.join(os.homedir(), 'Applications/Orca.app/Contents/Resources/bin/orca')] : []),
  ]
  for (const command of candidates) {
    let version
    try { version = (await execute(command, ['--version'], { env, cwd: options.targetRoot, timeout: 5000 })).stdout.trim() } catch { continue }
    let reachable = false, capabilities = [], error = null
    try {
      const receipt = JSON.parse((await execute(command, ['status', '--json'], { env, cwd: options.targetRoot, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout)
      reachable = receipt.ok === true && receipt.result?.runtime?.reachable === true
      capabilities = (receipt.result?.runtime?.capabilities ?? []).filter((value) => value.startsWith('orchestration.'))
      if (!reachable) error = 'runtime-unavailable'
    } catch { error = 'runtime-unavailable' }
    return { available: true, command, version, reachable, capabilities, error, onPath: !path.isAbsolute(command) }
  }
  return { available: false, reachable: false, error: 'cli-not-found', registration: 'Settings → General → Orca CLI' }
}

export async function workDoctor(options = {}) {
  const [providers, orca] = await Promise.all([inspectProviders(options), inspectOrca(options)])
  return { ...providers, orca }
}

export async function builtInAdapter(options = {}) {
  for (const value of [options.provider ?? 'auto', options.reviewerProvider ?? options.provider ?? 'auto']) {
    if (!['auto', ...supported].includes(value)) throw new SkillPackageError(`지원하지 않는 실행기: ${value}. auto, codex, claude 중 선택하세요.`)
  }
  const inspection = await inspectProviders(options)
  const select = (requested) => {
    const provider = requested === 'auto' ? inspection.autoProvider : requested
    const entry = inspection.providers.find((item) => item.provider === provider && item.compatible)
    if (!entry) throw new SkillPackageError(`사용 가능한 ${requested} CLI가 없습니다. work doctor로 설치/호환성을 확인하세요.`, inspection.providers.map((item) => JSON.stringify(item)))
    return entry
  }
  const worker = select(options.provider ?? 'auto')
  const reviewer = options.reviewerProvider ? select(options.reviewerProvider) : worker
  const roles = {}
  for (const [role, entry, model] of [['worker', worker, options.model], ['reviewer', reviewer, options.reviewerModel ?? (reviewer.provider === worker.provider ? options.model : undefined)]]) {
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) throw new SkillPackageError('model은 비어 있지 않은 문자열이어야 합니다.')
    roles[role] = { command: process.execPath, args: [adapter, '--provider', entry.provider, ...(model ? ['--model', model] : [])], provider: entry.provider, version: entry.version, model: model ?? null }
  }
  return { kind: 'builtin', roles, ...Object.fromEntries(['timeoutMs', 'maxDispatches', 'maxTaskRuns'].filter((key) => options[key] !== undefined).map((key) => [key, Number(options[key])])) }
}
