import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const SHOW_AT_PERCENT = 70

const COMMAND = 'one-click-handoff'

// Follows https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md
const HANDOFF_PROMPT = `請為目前這段對話寫一份交接文件，讓一個全新的 agent 能接續工作。它看不到現在的任何內容，只能靠這份文件。只輸出文件本身，用 Markdown，不要開場白。

文件裡要有「建議使用的 skill」一節，寫出下一個 agent 應該用 Skill 工具呼叫哪些 skill。

已經記在其他地方的內容（規格、計畫、ADR、issue、commit、diff）不要重複寫，改用路徑或網址指過去。

遮掉所有敏感資訊，例如 API key、密碼、個人身分資訊。`

const handoffPrompt = (focus: string) =>
  focus === '' ? HANDOFF_PROMPT : `${HANDOFF_PROMPT}\n\n下一段對話要做的是：${focus}\n依這個方向調整文件內容。`

const contextPercent = atom({ plugin: 'one-click-handoff', key: 'contextPercent' } as const, null as number | null)
const phase = atom({ plugin: 'one-click-handoff', key: 'phase' } as const, 'idle' as Phase)
const failure = atom({ plugin: 'one-click-handoff', key: 'failure' } as const, null as string | null)

async function refresh($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await update($, contextPercent, () => usage.context.percent ?? null)
  } catch {
    // keep the last reading
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

// The OS temp directory, not the workspace: $TMPDIR, else %TEMP% on Windows, else /tmp.
async function handoffPath($: EngineInterface): Promise<string> {
  const temp = ((await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? '/tmp').replace(/\\/g, '/').replace(/\/+$/, '')
  const cwd = (await $.session.cwd()).replace(/\\/g, '/').replace(/\/+$/, '')
  const project = (cwd.split('/').pop() || 'session').replace(/[^\p{L}\p{N}._-]+/gu, '-')
  const d = new Date(await $.clock.now())
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${temp}/handoff-${project}-${stamp}.md`
}

async function fail($: EngineInterface, reason: string): Promise<void> {
  await update($, failure, () => reason)
  await update($, phase, () => 'failed')
  $.ui.toast(`一鍵交接失敗：${reason}`)
}

const isRunning = async ($: EngineInterface) => {
  const now = await read($, phase)
  return now === 'summarizing' || now === 'clearing'
}

async function handoff($: EngineInterface, focus = ''): Promise<void> {
  if (await isRunning($)) return

  await update($, failure, () => null)
  await update($, phase, () => 'summarizing')

  try {
    const reply = await $.model.fork({ prompt: handoffPrompt(focus) })
    if (!reply.isAnswered) {
      await fail($, `沒有拿到交接文件（${reply.reason}）`)
      return
    }

    const doc = reply.text.trim()
    const path = await handoffPath($)
    await $.fs.write(path, `${doc}\n`)

    await update($, phase, () => 'clearing')
    await $.command.run({ command: 'clear' })
    await $.prompt.submit({
      text: `這是上一段對話的交接文件（已存成 ${path}）。請先讀完，再接續還沒做的工作；有不清楚的地方先問我。\n\n${doc}`,
    })

    await update($, contextPercent, () => null)
    await update($, phase, () => 'idle')
    $.ui.toast(`交接完成，交接文件存在 ${path}`)
  } catch (error) {
    await fail($, error instanceof Error ? error.message : String(error))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    await $.command.register({
      name: COMMAND,
      description: '寫交接文件、清空對話，再把文件當成新對話的第一句送出',
      argumentHint: '[下一段要做什麼]',
    })
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (await isRunning($)) return { text: '交接已經在進行中' }
    // Not awaited: the /clear it runs only starts once this command has ended.
    void handoff($, e.args.trim())
    return { text: '開始交接…' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($) // subagent turns don't count
    return result
  })

  // A /clear empties the context: hide the button until the next reading.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, contextPercent, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const percent = await read($, contextPercent)
    const now = await read($, phase)

    let mine = null
    if (now === 'summarizing') {
      mine = <Text color="warning">一鍵交接：正在寫交接文件…</Text>
    } else if (now === 'clearing') {
      mine = <Text color="warning">一鍵交接：清空對話，送出交接文件…</Text>
    } else if (now === 'failed') {
      mine = [
        <Text key="why" color="error">
          交接失敗：{(await read($, failure)) ?? '不明原因'}{' '}
        </Text>,
        <Button key="handoff" label="重試交接" onPress={() => handoff($)} />,
      ]
    } else if (percent !== null && percent >= SHOW_AT_PERCENT && !e.props.isWorking) {
      mine = [
        <Text key="why" color="warning">
          Context 已用 {Math.round(percent)}%{' '}
        </Text>,
        <Button key="handoff" label="一鍵交接" variant="primary" onPress={() => handoff($)} />,
      ]
    }

    if (mine === null) {
      return next(e)
    }

    // The band is shared: keep what the plugins beneath draw under this row.
    return (
      <Box flexDirection="column">
        <Box key="one-click-handoff" flexDirection="row">
          {mine}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
