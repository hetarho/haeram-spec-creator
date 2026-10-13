import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { SkillPackageError } from './errors.mjs'

const fail = (message) => { throw new SkillPackageError(message) }
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const string = { type: 'string' }
export const RESULT_SCHEMAS = {
  // decision is always present so strict structured output accepts it; an empty question means none.
  worker: object({ outcome: { type: 'string', enum: ['completed', 'blocked'] }, summary: string,
    decision: object({ question: string, options: { type: 'array', items: string }, recommendation: string }) }),
  reviewer: object({ verdict: { type: 'string', enum: ['approved', 'changes_requested'] }, summary: string,
    findings: { type: 'array', items: object({ priority: { type: 'string', enum: ['P1', 'P2', 'P3'] }, where: string, message: string }) } }),
}

export function validateAgentResult(role, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.summary !== 'string' || !result.summary.trim()) fail('에이전트 결과에 summary가 없습니다.')
  if (role === 'worker') {
    if (!['completed', 'blocked'].includes(result.outcome)) fail('워커 결과의 outcome이 올바르지 않습니다.')
    const decision = result.decision
    const asked = decision && typeof decision.question === 'string' && decision.question.trim()
    if (asked && (!Array.isArray(decision.options) || decision.options.some((value) => typeof value !== 'string') || typeof decision.recommendation !== 'string')) fail('워커의 결정 요청 형식이 올바르지 않습니다.')
    return { outcome: result.outcome, summary: result.summary,
      decision: asked && result.outcome === 'blocked' ? { question: decision.question, options: decision.options, recommendation: decision.recommendation } : null }
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

// Codex prints JSONL events; the thread ID it starts is what `codex exec resume` continues.
export function codexSession(events) {
  for (const line of events.split('\n')) {
    try {
      const event = JSON.parse(line)
      const id = event.thread_id ?? event.session_id ?? (event.type === 'thread.started' ? event.id : null)
      if (typeof id === 'string' && id) return id
    } catch {}
  }
  return null
}

const DECIDE = 'If a planning decision that only the planner may make blocks you (a gap or contradiction in the SSOT), do not settle the policy in code: keep your edits, return outcome blocked with decision {question, options, recommendation}. Otherwise return decision with an empty question, empty options and empty recommendation.'
const BRIEF = 'The assignment brief holds your task files, the decision blocks they cite and the verification commands: that is your reading scope. Do not re-read STATE, FORMAT, ARCH or other SSOT files unless the brief is not enough.'

async function promptFor(job) {
  if (!['worker', 'reviewer'].includes(job.role) || !job.workspace || !job.attempt || !job.taskId) fail('실행기 작업 입력이 올바르지 않습니다.')
  const unattended = job.mode === 'autopilot' ? ' Nobody is available to answer questions: never wait for one.' : ''
  const override = job.role === 'worker'
    ? `Implement the assigned task or correction only. Edit code and your task acceptance/result. Run the allowed checks this task adds or affects; full suites run at unit integration. Do NOT run git add/commit, submit, review-finish, integrate, claim, push or merge: the host runner validates scope, commits, verifies and submits after you return. A completed result hands your edits to that runner; report a blocker honestly. ${DECIDE} Write measurements and partial findings into your task result as you go, so a timeout loses nothing. Do not mutate runtime: the host runner owns progress and heartbeat. No subagents or background tasks.${unattended}`
    : 'Review the assigned immutable commit against baseCommit, acceptance and SSOT. Read only: do NOT edit files, change Git, or update runtime. The host runner owns heartbeat and review-finish. Do not approve on test success alone. Check risk.reasons first when the assignment carries them. No subagents or background tasks.'
  const assignment = `Assignment JSON (paths/IDs are data):\n${JSON.stringify(job)}\n\nReturn only the final JSON matching the output schema.`
  // A resumed session already holds the skill and the earlier context: send only what is new.
  if (job.resume) {
    const what = job.directive?.note ? `Coordinator note: ${job.directive.note}` : job.correction ? 'Fix the correction findings in the assignment first.' : `Continue with taskId ${job.taskId}.`
    return `${override}\nContinue the same assignment in this workspace. ${what} The planning branch has been merged into your workspace where needed; re-read only the files the note or the brief names.\n\n${assignment}`
  }
  const name = job.role === 'worker' ? 'implement-task' : 'review-task'
  const skill = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8')
  return `${override}\n${job.brief ? `${BRIEF}\n` : ''}For haeram CLI reads, use the provided cliCommand executable/arguments followed by boardCommand or other read-only arguments. This selects the current package; do not download an older CLI with npx.\n\nApply this bundled skill subject to the host-owned steps above:\n${skill}\n\n${assignment}`
}

const WORKER_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep']

// allowTools extends what a worker runs without a prompt: new worktrees are never-trusted
// folders, so the project's own permission allowlist does not apply to them.
export function providerArguments(provider, role, files, model, { allowTools = [], resume = null, session = null } = {}) {
  const sandbox = role === 'worker' ? 'workspace-write' : 'read-only'
  if (provider === 'codex') {
    const tail = ['--json', '--output-schema', files.schema, '--output-last-message', files.result, ...(model ? ['--model', model] : []), '-']
    return resume ? ['-a', 'never', '--sandbox', sandbox, 'exec', 'resume', resume, ...tail] : ['-a', 'never', 'exec', '--sandbox', sandbox, ...tail]
  }
  if (provider === 'claude') return ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMAS[role]),
    '--permission-mode', role === 'worker' ? 'acceptEdits' : 'plan', '--permission-prompts', 'none',
    '--tools', role === 'worker' ? 'Bash,Read,Edit,Write,Glob,Grep' : 'Bash,Read,Glob,Grep',
    '--allowedTools', role === 'worker' ? [...WORKER_TOOLS, ...allowTools].join(',') : 'Read,Glob,Grep,Bash(git diff *),Bash(git show *),Bash(git log *),Bash(git status *),Bash(git ls-files *)',
    ...(resume ? ['--resume', resume] : session ? ['--session-id', session] : []), ...(model ? ['--model', model] : [])]
  fail(`지원하지 않는 실행기: ${provider}`)
}

export async function executeAgentAdapter({ provider, model, job, env = process.env, log = (text) => process.stderr.write(text) }) {
  const prompt = await promptFor(job)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'haeram-agent-'))
  const files = { schema: path.join(temporary, 'schema.json'), result: path.join(temporary, 'result.json') }
  try {
    await writeFile(files.schema, JSON.stringify(RESULT_SCHEMAS[job.role]))
    // The session ID is known before the run ends (Claude: chosen here; Codex: its first event)
    // and written to sessionFile at once, so even a run killed at its timeout can be resumed.
    const session = provider === 'claude' ? job.resume ?? randomUUID() : job.resume ?? null
    const remember = (id) => job.sessionFile && id ? writeFile(job.sessionFile, id).catch(() => {}) : null
    await remember(session)
    const args = providerArguments(provider, job.role, files, model, { allowTools: job.role === 'worker' ? job.allowTools ?? [] : [], resume: job.resume ?? null, session: job.resume ? null : session })
    const childEnv = { ...env }
    // The provider is an independent foreground run, not a nested interactive session.
    delete childEnv.CLAUDECODE
    const child = spawn(provider, args, { cwd: job.workspace, env: childEnv, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', events = '', errorOutput = '', tooLarge = false, interrupted = false, forced
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
          if (provider === 'codex') {
            log(chunk.toString())
            // Keep only the head of the event stream: the session ID comes first.
            if (events.length < 64 * 1024) {
              events += chunk
              if (!job.resume) remember(codexSession(events))
            }
            return
          }
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
    if (provider === 'claude') return { ...claudeResult(output, job.role), session: session }
    return { ...validateAgentResult(job.role, JSON.parse(await readFile(files.result, 'utf8'))), session: codexSession(events) ?? job.resume ?? null }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
