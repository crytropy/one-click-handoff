import { expect, mock, test } from 'claude-code/testing'

const band = (surface: 'terminal' | 'desktop', isWorking = false) => ({
  plugin: 'one-click-handoff',
  surface,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
})

const DOC = '## 目前的目標\n做一鍵交接 mod\n\n## 建議使用的 skill\n- plugin-authoring'

function world(
  on: any,
  percent: { value: number },
  forkReply: any = { isAnswered: true, text: DOC, usage: {} },
  env: Record<string, string> = { TMPDIR: '/tmp/me/' },
) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 16, 14, 5, 9).getTime() })
  const calls: string[] = []
  const prompts: string[] = []
  const clear = { fails: false }
  const written: { path: string; text: string }[] = []
  const submitted: string[] = []
  const toasts: string[] = []

  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: 'C:\\work\\my-app' }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 0, percent: percent.value }, rateLimits: [] },
  }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($: any, e: any) => {
    // Stands for another plugin's band beneath this one.
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', (_$: any, e: any) => {
    calls.push('fork')
    prompts.push(e.prompt)
    return { value: forkReply }
  })
  on('fs.write', (_$: any, e: any) => {
    calls.push('write')
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('command.run', (_$: any, e: any) => {
    calls.push(`command:${e.command}`)
    if (clear.fails) throw new Error('clear refused')
    return { text: '' }
  })
  on('prompt.submit', (_$: any, e: any) => {
    calls.push('submit')
    submitted.push(e.text)
    return { text: e.text }
  })

  return { clock, clear, calls, prompts, written, submitted, toasts }
}

test('no button below 70% or while a turn runs', async ($, on) => {
  const percent = { value: 69 }
  world(on, percent)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
    await ui.unmount()
  }

  percent.value = 72
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const busy = await $.ui.mount(band(surface, true))
    expect(await busy.find({ key: 'handoff' })).toBeUndefined()
    await busy.unmount()

    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ key: 'handoff' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /72%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})

test('the button writes the handoff doc to the temp dir, then asks before clearing', async ($, on) => {
  const { calls, prompts, written, submitted, toasts } = world(on, { value: 80 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(band('desktop'))
  await ui.press({ key: 'handoff' })
  await ui.unmount()

  expect(calls).toEqual(['fork', 'write'])
  expect(prompts[0]).toContain('建議使用的 skill')
  expect(prompts[0]).toContain('敏感資訊')
  expect(prompts[0]).not.toContain('下一段對話要做的是')
  // The engine resolves the written path for this OS; the plugin's own path is in the toast.
  expect(written[0]?.path.replace(/\\/g, '/')).toEndWith('/tmp/me/handoff-my-app-20261016-140509.md')
  expect(written[0]?.text).toBe(`${DOC}\n`)
  expect(toasts.at(-1)).toContain('/tmp/me/handoff-my-app-20261016-140509.md')

  for (const surface of ['terminal', 'desktop'] as const) {
    const asking = await $.ui.mount(band(surface))
    expect(await asking.find({ key: 'handoff' })).toBeUndefined()
    expect(await asking.find({ key: 'keep' })).toBeDefined()
    expect((await asking.find({ key: 'clear' }))?.text).toBe('清空並接續')
    expect(await asking.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await asking.unmount()
  }

  const choice = await $.ui.mount(band('desktop'))
  await choice.press({ key: 'clear' })
  await choice.unmount()

  expect(calls).toEqual(['fork', 'write', 'command:clear', 'submit'])
  expect(submitted[0]).toContain('/tmp/me/handoff-my-app-20261016-140509.md')
  expect(submitted[0]).toContain(DOC)

  // The context reading is gone after the handoff: no button until the next turn.
  const after = await $.ui.mount(band('desktop'))
  expect(await after.find({ key: 'handoff' })).toBeUndefined()
  expect(await after.find({ key: 'clear' })).toBeUndefined()
  await after.unmount()
})

test('declining keeps the conversation and the saved doc', async ($, on) => {
  const { calls } = world(on, { value: 80 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'handoff' })
  await ui.unmount()

  const choice = await $.ui.mount(band('terminal'))
  await choice.press({ key: 'keep' })
  await choice.unmount()
  expect(calls).toEqual(['fork', 'write'])

  // Still past 70%: the handoff button is back.
  const after = await $.ui.mount(band('terminal'))
  expect(await after.find({ key: 'handoff' })).toBeDefined()
  expect(await after.find({ key: 'clear' })).toBeUndefined()
  await after.unmount()
})

test('a failed clear keeps the doc and retries the clear', async ($, on) => {
  const { calls, clear } = world(on, { value: 80 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'handoff' })
  await ui.unmount()

  clear.fails = true
  const choice = await $.ui.mount(band('terminal'))
  await choice.press({ key: 'clear' })
  await choice.unmount()

  clear.fails = false
  const retry = await $.ui.mount(band('terminal'))
  expect((await retry.find({ key: 'clear' }))?.text).toBe('重試清空')
  await retry.press({ key: 'clear' })
  await retry.unmount()
  expect(calls).toEqual(['fork', 'write', 'command:clear', 'command:clear', 'submit'])
})

test('without TMPDIR the doc goes to %TEMP%', async ($, on) => {
  const { toasts } = world(on, { value: 80 }, undefined, { TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'handoff' })
  expect(toasts.at(-1)).toContain('C:/Users/me/AppData/Local/Temp/handoff-my-app-20261016-140509.md')
  await ui.unmount()
})

test('the command writes the doc for what the next session is for', async ($, on) => {
  const { clock, calls, prompts } = world(on, { value: 10 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run({ command: 'one-click-handoff', args: ' 寫 README ' })
  expect(text).toBe('開始寫交接文件…')
  await clock.settle()

  expect(calls).toEqual(['fork', 'write'])
  expect(prompts[0]).toContain('下一段對話要做的是：寫 README\n')

  const asking = await $.ui.mount(band('terminal'))
  expect(await asking.find({ key: 'clear' })).toBeDefined()
  await asking.unmount()
})

test('a failed summary clears nothing and offers a retry', async ($, on) => {
  const { calls } = world(on, { value: 90 }, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: {} })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'handoff' })
  expect(calls).toEqual(['fork'])
  await ui.unmount()

  const retry = await $.ui.mount(band('terminal'))
  expect((await retry.find({ key: 'handoff' }))?.text).toBe('重試交接')
  expect(await retry.find({ type: 'Text', text: /api-error/ })).toBeDefined()
  await retry.unmount()
})
