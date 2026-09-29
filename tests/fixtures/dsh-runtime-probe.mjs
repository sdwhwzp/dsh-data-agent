import assert from 'node:assert/strict'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { livePresetMounts } from '@deepseek-ai/dsh-agent-preset-registry'

export const inject = ['loader', 'agentPresets', 'agents', 'llm', 'sessions', 'tools', 'commands', 'userQuestions']

const expectedTools = [
  'catalog-get', 'catalog-search', 'metric-get', 'render-analysis',
  'sql-cmd', 'sql-query', 'sql-write', 'str_replace_editor',
]

class FixtureModel extends LlmAdapter {
  calls = 0
  async *stream(options) {
    assert.equal(options.signal?.aborted, false)
    assert.deepEqual(options.tools.map(tool => tool.name).sort(), expectedTools)
    this.calls++
    if (this.calls === 1) {
      assert.ok(options.messages.some(message => message.role === 'user'))
      const block = { type: 'tool-call', id: 'fixture-query', name: 'sql-query', arguments: JSON.stringify({ sql: 'SELECT SUM(amount) AS total FROM sales' }) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      assert.equal(this.calls, 2)
      const result = options.messages.find(message => message.role === 'tool')
      assert.ok(result, 'real SQL tool result must reach the model')
      assert.match(JSON.stringify(result), /total/)
      assert.match(JSON.stringify(result), /42/)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Fixture total: 42.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Fixture total: 42.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function verifyConnection(ctx, agent, config, executeDatabaseCommand) {
  let connectionQuestions = 0
  // rc.2 makes userQuestions a remote service and checks that the caller is a
  // live root agent. Exercise the packaged command with the real service;
  // only the human answerer is scripted, and SQLite validates the connection.
  const invocation = { commandId: 'database', agent, rawInput: 'connect', signal: new AbortController().signal }
  const interaction = { isTuiFormAvailable: () => false }
  const missingProvider = await executeDatabaseCommand(ctx, invocation, interaction)
  assert.equal(missingProvider.kind, 'error')
  assert.match(missingProvider.text, /问答 provider/)
  assert.equal(ctx.dataAgentConnections.get(agent.id), undefined)
  const stopAnswering = ctx.on('user-questions/request', async request => {
    assert.equal(request.agent, agent)
    assert.equal(request.signal, invocation.signal)
    assert.equal(request.wait, undefined, 'database setup must keep its blocking question contract')
    connectionQuestions++
    if (connectionQuestions === 1) {
      assert.deepEqual(request.questions.map(question => question.id), ['type'])
      return { answers: [{ id: 'type', selected: ['sqlite'] }] }
    }
    assert.equal(connectionQuestions, 2)
    assert.deepEqual(request.questions.map(question => question.id), ['database', 'readonly'])
    return { answers: [{ id: 'database', selected: [], custom: config.database }, { id: 'readonly', selected: ['是'] }] }
  })
  try {
    const canceled = await executeDatabaseCommand(ctx, { ...invocation, signal: AbortSignal.abort() }, interaction)
    assert.equal(canceled.kind, 'error')
    assert.equal(connectionQuestions, 0)
    assert.equal(ctx.dataAgentConnections.get(agent.id), undefined)
    const connected = await executeDatabaseCommand(ctx, invocation, interaction)
    assert.equal(connected.kind, 'success', connected.text)
    assert.equal(connectionQuestions, 2)
    assert.equal(ctx.dataAgentConnections.get(agent.id).readonly, true)
  } finally {
    stopAnswering()
  }
  return connectionQuestions
}

async function run(ctx, config) {
  await ctx.loader.await()
  const { executeDatabaseCommand } = await import(config.commandEntry)
  assert.ok((await ctx.agentPresets.list()).some(preset => preset.id === 'data-agent'))
  const adapter = new FixtureModel()
  const unregisterModel = ctx.llm.registerAdapter(['fixture'], adapter)
  const unregisterStandard = await ctx.agentPresets.register({ id: 'fixture-standard', plugins: [] })
  const handle = await ctx.agents.create({
    sessionId: 'compatibility-fixture',
    meta: { cwd: process.cwd(), agentPreset: 'fixture-standard' },
    agentOptions: { provider: 'fixture', model: 'fixture-model' },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: { provider: 'fixture', model: 'fixture-model' }, assembled: undefined })
      await ctx.agentPresets.mount(agentCtx, 'fixture-standard')
    },
  })
  let connectionQuestions = 0
  try {
    assert.ok(ctx.tools.schemas(handle.agent).some(tool => tool.name === 'bash'))
    assert.equal(await ctx.agentPresets.select(handle.agent, 'data-agent'), 'data-agent')
    assert.deepEqual(ctx.tools.schemas(handle.agent).map(tool => tool.name).sort(), expectedTools)
    assert.ok(!ctx.commands.list(handle.agent).some(command => command.name === 'database'))
    // Keep the connection probe in a temporary dependent fiber so unloading
    // data-agent later does not also unload the lifecycle test's own context.
    let connectionFiber
    const connectionCtx = await new Promise(resolve => {
      connectionFiber = ctx.inject(['dataAgentAccounts', 'dataAgentConnections'], scope => { resolve(scope) })
    })
    try {
      connectionQuestions = await verifyConnection(connectionCtx, handle.agent, config, executeDatabaseCommand)
    } finally {
      await connectionFiber.dispose()
    }
    await handle.agent.whenIdle()
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Sum the fixture sales amounts.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await ctx.sessions.flush(handle.agent.session)
    assert.equal(adapter.calls, 2, 'one user turn must run the real SQL tool and reach its reply')
  } finally {
    await handle.dispose()
    unregisterModel()
    await unregisterStandard()
  }
  // Unload the contributing host fiber: its registration and scoped tools must
  // disappear, then a fresh host fiber must be able to claim the same id.
  const entry = [...ctx.loader.entries()].find(value => value.options.id === 'data-agent')
  assert.ok(entry)
  await entry.update({ disabled: true })
  await ctx.loader.await()
  assert.ok(!(await ctx.agentPresets.list()).some(preset => preset.id === 'data-agent'))
  assert.ok(!livePresetMounts(ctx.root.fiber).some(mount => mount.presetId === 'data-agent'))
  await entry.update({ disabled: false })
  await ctx.loader.await()
  assert.equal((await ctx.agentPresets.list()).filter(preset => preset.id === 'data-agent').length, 1)
  const restored = await ctx.agents.resume({
    resumeSessionId: 'compatibility-fixture',
    agentOptions: { provider: 'fixture', model: 'fixture-model' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'data-agent') },
  })
  try {
    assert.deepEqual(ctx.tools.schemas(restored.agent).map(tool => tool.name).sort(), expectedTools)
    const replies = restored.agent.session.snapshotEvents().filter(event => event.type.startsWith('assistant/') || event.type === 'turn/end')
    assert.match(JSON.stringify(replies), /Fixture total: 42\./)
  } finally {
    await restored.dispose()
  }
  await entry.update({ disabled: true })
  process.stdout.write('DSH_DATA_AGENT_SMOKE=' + JSON.stringify({ tools: expectedTools, modelCalls: adapter.calls, connectionQuestions, unload: true, reload: true }) + '\n')
}

export function apply(ctx, config) {
  // Do not await loader settlement from an activating Loader row.
  run(ctx, config).then(() => ctx.get('appExit')(0), error => {
    process.stderr.write(String(error.stack ?? error) + '\n')
    ctx.get('appExit')(1)
  })
}
