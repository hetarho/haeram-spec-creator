import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeAgentAdapter, claudeResult, providerArguments } from '../src/agent-adapter.mjs'
import { builtInAdapter, inspectProviders, inspectOrca } from '../src/work-providers.mjs'

async function stub(t, name, body) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'haeram-provider-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, name), `#!${process.execPath}\n${body}`, { mode: 0o755 })
  return { root, env: { ...process.env, PATH: root } }
}
const job = (workspace, role = 'worker') => ({ schemaVersion: 1, role, workspace, attempt: 'attempt-test', taskId: 'T001' })
const flag = (args, key) => args[args.indexOf(key) + 1]

test('Codex는 최종 결과 파일만 해석하고 진행 JSONL은 로그로 보낸다', async (t) => {
  const fixture = await stub(t, 'codex', `const fs=require('node:fs'); const args=process.argv.slice(2);let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{fs.writeFileSync('received.json',JSON.stringify({args,text}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({outcome:'completed',summary:'done'}));console.log(JSON.stringify({type:'item.completed',item:{text:'not the final JSON'}}));});`)
  let log = ''
  const result = await executeAgentAdapter({ provider: 'codex', job: job(fixture.root), env: fixture.env, log: (text) => { log += text } })
  assert.equal(result.outcome, 'completed')
  assert.match(log, /item.completed/)
  const received = JSON.parse(await readFile(path.join(fixture.root, 'received.json'), 'utf8'))
  assert.equal(flag(received.args, '--sandbox'), 'workspace-write')
  assert.match(received.text, /host runner validates scope, commits/)
  assert.match(received.text, /# implement-task/)
  assert.ok(!received.args.some((item) => item.includes('dangerously')))
})

test('Claude의 structured_output을 해석하고 오류/구조 누락을 성공으로 취급하지 않는다', () => {
  const result = { verdict: 'approved', summary: 'reviewed', findings: [] }
  assert.deepEqual(claudeResult(JSON.stringify({ type: 'result', is_error: false, structured_output: result }), 'reviewer'), result)
  assert.throws(() => claudeResult(JSON.stringify({ is_error: true, structured_output: result }), 'reviewer'), /실행 실패/)
  assert.throws(() => claudeResult(JSON.stringify({ result: JSON.stringify(result) }), 'reviewer'), /structured_output/)
  assert.throws(() => claudeResult(JSON.stringify({ structured_output: { ...result, findings: [{ priority: 'P0' }] } }), 'reviewer'), /finding/)
})

test('리뷰어는 읽기 정책으로 실행하며 모델 이름은 해석 없이 전달한다', async (t) => {
  const fixture = await stub(t, 'claude', `const fs=require('node:fs');let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{fs.writeFileSync('received.json',JSON.stringify({args:process.argv.slice(2),text}));console.log(JSON.stringify({type:'result',is_error:false,structured_output:{verdict:'approved',summary:'reviewed',findings:[]}}));});`)
  await executeAgentAdapter({ provider: 'claude', model: 'model with spaces', job: job(fixture.root, 'reviewer'), env: fixture.env, log: () => {} })
  const { args, text } = JSON.parse(await readFile(path.join(fixture.root, 'received.json'), 'utf8'))
  assert.equal(flag(args, '--permission-mode'), 'plan')
  assert.equal(flag(args, '--permission-prompts'), 'none')
  assert.equal(flag(args, '--model'), 'model with spaces')
  assert.ok(!flag(args, '--tools').includes('Edit'))
  assert.match(text, /# review-task/)
  assert.equal(flag(providerArguments('codex', 'reviewer', { schema: 'schema', result: 'result' }), '--sandbox'), 'read-only')
})

test('CLI 검사와 auto 선택은 모델을 호출하지 않고 필수 flag 지원을 확인한다', async (t) => {
  const fixture = await stub(t, 'codex', `const fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--version'))console.log('codex-test');else if(args.includes('--help'))console.log('--sandbox --output-schema --output-last-message --json');else {fs.writeFileSync('model-request','unexpected');process.exit(4);}`)
  const info = await inspectProviders({ targetRoot: fixture.root, env: fixture.env })
  assert.equal(info.autoProvider, 'codex')
  assert.equal(info.providers.find((entry) => entry.provider === 'claude').available, false)
  const config = await builtInAdapter({ targetRoot: fixture.root, env: fixture.env, provider: 'auto', model: 'chosen', reviewerModel: 'review-model' })
  assert.equal(config.roles.worker.provider, 'codex')
  assert.equal(config.roles.reviewer.model, 'review-model')
  await assert.rejects(readFile(path.join(fixture.root, 'model-request')), { code: 'ENOENT' })
  await assert.rejects(builtInAdapter({ targetRoot: fixture.root, env: fixture.env, provider: 'claude' }), /사용 가능한/)
  await writeFile(path.join(fixture.root, 'codex'), `#!${process.execPath}\nconsole.log('old cli')`, { mode: 0o755 })
  assert.equal((await inspectProviders({ targetRoot: fixture.root, env: fixture.env })).autoProvider, null)
})

test('Orca 실행 파일의 실제 경로가 주어지면 PATH 등록 없이 runtime을 감지한다', async (t) => {
  const fixture = await stub(t, 'orca-bundled', `if(process.argv.includes('--version'))console.log('1.4.test');else console.log(JSON.stringify({ok:true,result:{runtime:{reachable:true,capabilities:['orchestration.contract.v1','unrelated']}}}));`)
  const info = await inspectOrca({ targetRoot: fixture.root, env: fixture.env, orcaCommand: path.join(fixture.root, 'orca-bundled') })
  assert.equal(info.reachable, true)
  assert.equal(info.onPath, false)
  assert.deepEqual(info.capabilities, ['orchestration.contract.v1'])
})

test('오류 코드가 있으면 남아 있는 결과 파일로 성공을 만들지 않는다', async (t) => {
  const fixture = await stub(t, 'codex', `const fs=require('node:fs');const args=process.argv;fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({outcome:'completed',summary:'stale'}));process.exit(7);`)
  await assert.rejects(executeAgentAdapter({ provider: 'codex', job: job(fixture.root), env: fixture.env, log: () => {} }), /실행 실패/)
})

test('단일/혼합 워커와 모델별 설정을 지원하고 모호한 설정은 실행 전에 거부한다', async (t) => {
  const fixture = await stub(t, 'codex', `if(process.argv.includes('--version'))console.log('test');else console.log('--sandbox --output-schema --output-last-message --json');`)
  await writeFile(path.join(fixture.root, 'claude'), `#!${process.execPath}\nif(process.argv.includes('--version'))console.log('test');else console.log('--print --output-format --json-schema --permission-mode --allowedTools --tools --permission-prompts');`, { mode: 0o755 })
  const options = { targetRoot: fixture.root, env: fixture.env }
  const mixed = await builtInAdapter({ ...options, providers: 'codex,claude,claude' })
  assert.deepEqual(mixed.workers.map((entry) => entry.provider), ['codex', 'claude', 'claude'])
  assert.equal(mixed.roles.reviewer.provider, 'codex')
  const individual = await builtInAdapter({ ...options, provider: 'claude', model: 'claude-model' })
  assert.equal(individual.workers[0].provider, 'claude')
  assert.equal(individual.roles.reviewer.model, 'claude-model')
  const configured = await builtInAdapter({ ...options, workers: [{ provider: 'claude', model: 'claude-model' }, { provider: 'codex', model: 'codex-model' }], reviewerProvider: 'codex' })
  assert.deepEqual(configured.workers.map((entry) => entry.model), ['claude-model', 'codex-model'])
  assert.equal(configured.roles.reviewer.model, null)
  for (const invalid of [{ providers: '' }, { providers: 'claude,unknown' }, { providers: 'codex,claude', provider: 'codex' }, { providers: 'codex,claude', model: 'ambiguous' }, { workers: [] }, { workers: [{ provider: 'codex', model: '' }] }]) {
    await assert.rejects(builtInAdapter({ ...options, ...invalid }))
  }
})
