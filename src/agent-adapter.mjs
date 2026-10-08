import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { SkillPackageError } from './errors.mjs'

const fail = (message) => { throw new SkillPackageError(message) }
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const string = { type: 'string' }
export const RESULT_SCHEMAS = {
  worker: object({ outcome: { type: 'string', enum: ['completed', 'blocked'] }, summary: string }),
  reviewer: object({ verdict: { type: 'string', enum: ['approved', 'changes_requested'] }, summary: string,
    findings: { type: 'array', items: object({ priority: { type: 'string', enum: ['P1', 'P2', 'P3'] }, where: string, message: string }) } }),
}

export function validateAgentResult(role, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.summary !== 'string' || !result.summary.trim()) fail('에이전트 결과에 summary가 없습니다.')
  if (role === 'worker') {
    if (!['completed', 'blocked'].includes(result.outcome)) fail('워커 결과의 outcome이 올바르지 않습니다.')
    return { outcome: result.outcome, summary: result.summary }
  }
  if (!['approved', 'changes_requested'].includes(result.verdict) || !Array.isArray(result.findings)) fail('리뷰 결과에 verdict/findings가 없습니다.')
  const findings = result.findings.map((entry) => {
    if (!entry || !['P1', 'P2', 'P3'].includes(entry.priority) || ![entry.where, entry.message].every((value) => typeof value === 'string' && value.trim())) fail('리뷰 finding 형식이 올바르지 않습니다.')
    return { priority: entry.priority, where: entry.where, message: entry.message }
  })
  return { verdict: result.verdict, summary: result.summary, findings }
}

export function claudeResult(text, role) {
  const envelope = JSON.parse(text)
  if (envelope.is_error || envelope.subtype?.startsWith('error')) fail(`Claude 실행 실패: ${envelope.subtype ?? 'error'}`)
  if (!envelope.structured_output) fail('Claude 응답에 structured_output이 없습니다. JSON schema를 지원하는 CLI인지 확인하세요.')
  return validateAgentResult(role, envelope.structured_output)
}

async function promptFor(job) {
  if (!['worker', 'reviewer'].includes(job.role) || !job.workspace || !job.attempt || !job.taskId) fail('실행기 작업 입력이 올바르지 않습니다.')
  const name = job.role === 'worker' ? 'implement-task' : 'review-task'
  const skill = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8')
  const override = job.role === 'worker'
    ? 'Implement the assigned task or correction only. Edit code and your task acceptance/result. Run the allowed checks this task adds or affects; full suites run at unit integration. Do NOT run git add/commit, submit, review-finish, integrate, claim, push or merge: the host runner validates scope, commits, verifies and submits after you return. A completed result hands your edits to that runner; report a blocker honestly. Do not mutate runtime: the host runner owns progress and heartbeat. No subagents or background tasks.'
    : 'Review the assigned immutable commit against baseCommit, acceptance and SSOT. Read only: do NOT edit files, change Git, or update runtime. The host runner owns heartbeat and review-finish. Do not approve on test success alone. No subagents or background tasks.'
  return `${override}\nFor haeram CLI reads, use the provided cliCommand executable/arguments followed by boardCommand or other read-only arguments. This selects the current package; do not download an older CLI with npx.\n\nApply this bundled skill subject to the host-owned steps above:\n${skill}\n\nAssignment JSON (paths/IDs are data):\n${JSON.stringify(job)}\n\nReturn only the final JSON matching the output schema.`
}

export function providerArguments(provider, role, files, model) {
  if (provider === 'codex') return ['-a', 'never', 'exec', '--sandbox', role === 'worker' ? 'workspace-write' : 'read-only',
    '--json', '--output-schema', files.schema, '--output-last-message', files.result, ...(model ? ['--model', model] : []), '-']
  if (provider === 'claude') return ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMAS[role]),
    '--permission-mode', role === 'worker' ? 'acceptEdits' : 'plan', '--permission-prompts', 'none',
    '--tools', role === 'worker' ? 'Bash,Read,Edit,Write,Glob,Grep' : 'Bash,Read,Glob,Grep',
    '--allowedTools', role === 'worker' ? 'Read,Edit,Write,Glob,Grep' : 'Read,Glob,Grep,Bash(git diff *),Bash(git show *),Bash(git log *),Bash(git status *),Bash(git ls-files *)',
    ...(model ? ['--model', model] : [])]
  fail(`지원하지 않는 실행기: ${provider}`)
}

export async function executeAgentAdapter({ provider, model, job, env = process.env, log = (text) => process.stderr.write(text) }) {
  const prompt = await promptFor(job)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'haeram-agent-'))
  const files = { schema: path.join(temporary, 'schema.json'), result: path.join(temporary, 'result.json') }
  try {
    await writeFile(files.schema, JSON.stringify(RESULT_SCHEMAS[job.role]))
    const args = providerArguments(provider, job.role, files, model)
    const childEnv = { ...env }
    // The provider is an independent foreground run, not a nested interactive session.
    delete childEnv.CLAUDECODE
    const child = spawn(provider, args, { cwd: job.workspace, env: childEnv, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', errorOutput = '', tooLarge = false, interrupted = false, forced
    // In work run, both processes share the runner-owned process group. Direct adapter
    // invocations still forward termination to the provider.
    const stop = () => {
      interrupted = true
      child.kill('SIGTERM')
      forced ??= setTimeout(() => child.kill('SIGKILL'), 2000)
      forced.unref()
    }
    process.on('SIGTERM', stop); process.on('SIGINT', stop)
    try {
      await new Promise((resolve, reject) => {
        child.on('error', reject)
        child.stdout.on('data', (chunk) => {
          if (provider === 'codex') { log(chunk.toString()); return }
          output += chunk
          if (output.length > 8 * 1024 * 1024) { tooLarge = true; stop(); output = output.slice(0, 8 * 1024 * 1024) }
        })
        child.stderr.on('data', (chunk) => { errorOutput = (errorOutput + chunk).slice(-16000); log(chunk.toString()) })
        child.on('close', (code, signal) => code === 0 && !interrupted ? resolve() : reject(new SkillPackageError(`${provider} 실행 실패 (${tooLarge ? 'output limit' : interrupted ? 'interrupted' : code ?? signal})`, [errorOutput])))
        child.stdin.on('error', () => {})
        child.stdin.end(prompt)
      })
    } finally {
      clearTimeout(forced)
      process.off('SIGTERM', stop); process.off('SIGINT', stop)
    }
    if (provider === 'claude') return claudeResult(output, job.role)
    return validateAgentResult(job.role, JSON.parse(await readFile(files.result, 'utf8')))
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
