import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const SHOW_AT_PERCENT = 70

const SUMMARY_PROMPT = `請為目前這段對話寫一份交接摘要。接手的是一段全新的對話，它看不到現在的任何內容，只能靠這份摘要繼續工作。

只輸出摘要本身，用 Markdown，依序使用以下標題：

## 目前的目標
## 已完成
## 還沒做的
## 改過的檔案
（每個檔案寫完整路徑，以及改了什麼）
## 要注意的地方
（做過的決定和理由、踩過的坑、使用者的偏好、還在等確認的事）

寫具體：路徑、指令、名稱、數值照原樣寫。不要開場白、不要客套話。`

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

async function handoffPath($: EngineInterface): Promise<string> {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
  const cwd = (await $.session.cwd()).replace(/\\/g, '/').replace(/\/+$/, '')
  const project = (cwd.split('/').pop() || 'session').replace(/[^\p{L}\p{N}._-]+/gu, '-')
  const d = new Date(await $.clock.now())
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${home}/.claude/handoffs/${project}-${stamp}.md`
}

async function fail($: EngineInterface, reason: string): Promise<void> {
  await update($, failure, () => reason)
  await update($, phase, () => 'failed')
  $.ui.toast(`一鍵交接失敗：${reason}`)
}

async function handoff($: EngineInterface): Promise<void> {
  const now = await read($, phase)
  if (now === 'summarizing' || now === 'clearing') return

  await update($, failure, () => null)
  await update($, phase, () => 'summarizing')

  try {
    const reply = await $.model.fork({ prompt: SUMMARY_PROMPT })
    if (!reply.isAnswered) {
      await fail($, `沒有拿到摘要（${reply.reason}）`)
      return
    }

    const summary = reply.text.trim()
    const path = await handoffPath($)
    const cwd = await $.session.cwd()
    await $.fs.write(path, `# 交接摘要\n\n> 專案：${cwd}\n\n${summary}\n`)

    await update($, phase, () => 'clearing')
    await $.command.run({ command: 'clear' })
    await $.prompt.submit({
      text: `這是上一段對話的交接摘要（已存成 ${path}）。請先讀完，再接續還沒做的工作；有不清楚的地方先問我。\n\n${summary}`,
    })

    await update($, contextPercent, () => null)
    await update($, phase, () => 'idle')
    $.ui.toast(`交接完成，摘要存在 ${path}`)
  } catch (error) {
    await fail($, error instanceof Error ? error.message : String(error))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
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
      mine = <Text color="warning">一鍵交接：正在寫交接摘要…</Text>
    } else if (now === 'clearing') {
      mine = <Text color="warning">一鍵交接：清空對話，送出摘要…</Text>
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
