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

const SUMMARY = '## 目前的目標\n做一鍵交接 mod\n\n## 還沒做的\n寫 README'

function world(on: any, percent: { value: number }, forkReply: any = { isAnswered: true, text: SUMMARY, usage: {} }) {
  mock.clock(on, { now: new Date(2026, 9, 16, 14, 5, 9).getTime() })
  const calls: string[] = []
  const written: { path: string; text: string }[] = []
  const submitted: string[] = []
  const toasts: string[] = []

  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:\\work\\my-app' }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
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
    expect(e.prompt).toContain('還沒做的')
    return { value: forkReply }
  })
  on('fs.write', (_$: any, e: any) => {
    calls.push('write')
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('command.run', (_$: any, e: any) => {
    calls.push(`command:${e.command}`)
    return { text: '' }
  })
  on('prompt.submit', (_$: any, e: any) => {
    calls.push('submit')
    submitted.push(e.text)
    return { text: e.text }
  })

  return { calls, written, submitted, toasts }
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

test('the button summarizes, saves, clears, then sends the summary', async ($, on) => {
  const { calls, written, submitted, toasts } = world(on, { value: 80 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(band('desktop'))
  await ui.press({ key: 'handoff' })

  expect(calls).toEqual(['fork', 'write', 'command:clear', 'submit'])
  expect(written[0]?.path.replace(/\\/g, '/')).toBe('C:/Users/me/.claude/handoffs/my-app-20261016-140509.md')
  expect(written[0]?.text).toContain(SUMMARY)
  expect(submitted[0]).toContain('C:/Users/me/.claude/handoffs/my-app-20261016-140509.md')
  expect(submitted[0]).toContain(SUMMARY)
  expect(toasts.at(-1)).toContain('交接完成')
  await ui.unmount()

  // The context reading is gone after the handoff: no button until the next turn.
  const after = await $.ui.mount(band('desktop'))
  expect(await after.find({ key: 'handoff' })).toBeUndefined()
  await after.unmount()
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
