import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inspectWorkspace } from './workspace.mjs'
import { designOf, setDesign } from './state-doc.mjs'
import { SESSION_TAG } from './spec-format.mjs'
import { readVerification } from './vibe-brief.mjs'
import { runVibeCheck } from './vibe-check.mjs'
import { minuteNow } from './vibe.mjs'
import { SkillPackageError } from './errors.mjs'

const fail = (message, details = []) => { throw new SkillPackageError(message, details) }

// Design mode: a pair session edits code while the user watches the result live. Tests, commits
// and pushes wait until the user ends the design; STATE ## design marks the checkout meanwhile
// (normally uncommitted, next to the design edits). The caller commits.
export async function vibeDesign(options = {}) {
  const step = options.step ?? 'status'
  if (!['status', 'start', 'verify', 'end'].includes(step)) fail('vibe design [start|verify|end]')
  const workspace = await inspectWorkspace(options)
  const root = workspace.git?.root ?? workspace.targetRoot
  const file = path.join(root, 'spec/STATE.md')
  const text = await readFile(file, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (text === null) fail('spec/STATE.md가 없습니다.')
  const design = designOf(text)
  if (step === 'status') return { schemaVersion: 1, ok: true, design }
  if (step === 'verify') return verifyDesign(options, root, design)
  if (step === 'end') {
    if (design) await writeFile(file, setDesign(text, null))
    return { schemaVersion: 1, ok: true, ended: Boolean(design), design }
  }
  if (!SESSION_TAG.test(options.tag ?? '')) fail('--tag에는 영숫자 2-8자의 세션 tag가 필요합니다.')
  const scope = options.scope?.replace(/\s+/g, ' ').trim() || null
  // A design left open by an earlier conversation resumes with its own since and tag.
  if (design?.since && design.tag) {
    const resumed = { ...design, scope: scope ?? design.scope }
    if (resumed.scope !== design.scope) await writeFile(file, setDesign(text, resumed))
    return { schemaVersion: 1, ok: true, resumed: true, design: { since: resumed.since, tag: resumed.tag, scope: resumed.scope } }
  }
  const entry = { since: minuteNow(), tag: options.tag, scope: scope ?? '-' }
  await writeFile(file, setDesign(text, entry))
  return { schemaVersion: 1, ok: true, resumed: false, design: entry }
}

// Every ARCH task and batch command once, on the uncommitted working tree, at the batch tier.
// Fast checks go first: a failure there changes the tree anyway, so the slow suites wait for the fix.
async function verifyDesign(options, root, design) {
  const verify = await readVerification(root)
  const plan = []
  for (const [tier, commands] of [['task', verify.task], ['batch', options.verify ?? verify.batch]]) {
    for (const command of commands) if (!plan.some((step) => step.command === command)) plan.push({ tier, command })
  }
  if (!plan.length) return { schemaVersion: 1, ok: false, design, results: [], skipped: [], error: 'ARCH와 package.json에서 검증 명령을 찾지 못했습니다. 프로젝트의 전체 테스트 명령을 --verify로 넘기세요.' }
  const results = [], skipped = []
  let tree = null
  for (const step of plan) {
    if (step.tier === 'batch' && results.some((result) => !result.ok)) { skipped.push(step.command); continue }
    const result = await runVibeCheck({ targetRoot: root, tier: 'batch', uncommitted: true, timeoutMs: options.timeoutMs, signal: options.signal, env: options.env }, step.command)
    results.push({ tier: step.tier, command: step.command, ok: result.ok, cached: result.cached, exitCode: result.exitCode, timedOut: result.timedOut ?? false, stale: result.stale ?? false,
      ms: result.ms ?? 0, failedTests: result.failedTests, tail: result.ok ? [] : result.tail, log: result.log })
    tree = result.tree
  }
  const ok = !skipped.length && results.every((result) => result.ok)
  // tree identifies what passed: a commit of exactly this tree needs no second run before push.
  return { schemaVersion: 1, ok, design, tree: ok ? tree : null, results, skipped, guidance: verify.guidance }
}
