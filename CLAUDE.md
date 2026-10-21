# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這是什麼

一個 Claude Code 外掛（mod），只有 hooks 模組，沒有 `package.json`，也不用建置。主對話的 Context 用到 70% 時，輸入框上方會出現「一鍵交接」按鈕。按下去會請模型寫交接文件，存到系統暫存資料夾的 `handoff-<專案>-<YYYYMMDD-HHMMSS>.md`，執行 `/clear`，再把文件當成新對話的第一句送出。斜線指令 `/one-click-handoff [下一段要做什麼]` 跑同樣的流程，參數會加進提示詞，讓文件依那個方向寫。提示詞（`HANDOFF_PROMPT`）照 [mattpocock/skills 的 handoff skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) 寫：要有「建議使用的 skill」一節、已記在別處的內容用路徑或網址指過去、遮掉敏感資訊。改提示詞時要和那份 skill 保持一致。本機和雲端 session 的安裝方式寫在 README（雲端做法還沒驗證過）。介面文字、提示詞和 README 都用繁體中文。

## 指令

```bash
claude plugin validate .   # 用引擎載入的方式檢查 manifest 和 hooks 模組
claude plugin test .       # 對引擎跑所有 tests/*.test.ts(x)，有測試失敗就回傳 1
claude --plugin-dir .      # 開一個從這個資料夾載入外掛的 session（存檔會自動重新載入）
```

`claude plugin test` 沒有只跑單一測試的選項，每次都跑全部測試檔。

`validate` 會通過，但會提醒：沒有 LICENSE，`plugin.json` 也沒有 `license`，送到外掛目錄會被拒絕；另外也沒有圖示，並提醒 repo 根目錄的 `CLAUDE.md` 不會被當成外掛的 context 載入（這份檔案本來就只給開發這個 repo 用）。這些都不影響載入。

## 架構

- `.claude-plugin/plugin.json` 是外掛的 manifest。`.claude-plugin/marketplace.json` 讓這個 repo 自己就是只有一個外掛的 marketplace（`source: "./"`）。發新版時要更新 `plugin.json` 的 `version`。
- `hooks/hooks.json` 指向 hooks 模組 `hooks/register.tsx`，所有邏輯都在這裡。模組裡沒有 DOM 或 Node API，一律透過引擎介面 `$` 存取外部（`$.session.usage()`、`$.model.fork`、`$.fs.write`、`$.command.run`、`$.prompt.submit`、`$.ui.toast`、`$.env.get`、`$.clock.now`）。JSX 元件從 `$.ui.resolve(e)` 取得，對應目前要畫的介面。
- `types/index.d.ts` 是 `$.state` 的型別約定。`register.tsx` 裡每個 `atom({ plugin: 'one-click-handoff', key })` 都要在 `PluginState['one-click-handoff']` 底下宣告，`claude plugin validate` 會檢查。新增狀態值時兩個檔案都要改。

各部分怎麼串起來：
- **斜線指令。** 在 `session.start` 用 `$.command.register` 註冊，由 `command.run` hook 處理。hook 不等 `handoff()` 跑完就回傳，因為 `handoff()` 裡的 `/clear` 要等這個指令結束才會執行。
- **讀取 Context 用量。** `contextPercent` 在 `session.start` 時更新，也在主對話的 `turn.complete` 時更新（`e.agentId === undefined`，子代理的回合不算）。`session.end` 的 `reason === 'clear'` 時，以及交接成功之後，會把它設回 `null`，按鈕就會隱藏，直到下一次讀到數值。
- **狀態流程。** `phase` 依序是 `idle → summarizing → clearing → idle`，出錯時變成 `failed`。交接進行中再按按鈕，`handoff()` 會直接忽略。失敗時 `failure` 記下原因，輸入框上方改成「重試交接」按鈕。如果沒拿到交接文件，什麼都不會清掉，也不會寫檔。
- **畫輸入框上方那一列。** `AbovePrompt` 的 `ui.render` hook 一定要呼叫 `next(e)`，並把結果畫在自己那一列下面，因為這一列跟其他外掛（例如 prompt-band）共用。有問卷（`hasSurvey`）、沒有東西要顯示，或模型正在回應（`isWorking`）時，只回傳 `next(e)`，所以回應中不會出現按鈕。
- **存檔路徑。** `handoffPath` 依序用 `TMPDIR`、`TEMP`（Windows）、`/tmp`，並把反斜線換成斜線、去掉結尾的斜線。專案名稱取 cwd 的最後一段，再把不合法的字元換掉。

## 測試

`tests/handoff.test.tsx` 用 `claude-code/testing`。透過測試的 `on` 註冊的 hook 排在外掛底下，代替引擎回應（用量、檔案、model fork、指令註冊與執行、送出提示、時鐘）。plugin 新呼叫的 `$` 方法，測試的 `world()` 也要補上對應的 hook，否則該 hook 會被跳過。`$.fs.write` 收到的路徑已經被引擎依目前 OS 解析過，所以斷言 Windows 路徑時要看送出的提示文字，不要看寫入的路徑。斜線指令的測試在 `$.command.run` 之後要 `await clock.settle()`，等沒被 await 的交接跑完。介面用 `$.ui.mount({ plugin, surface, component: 'AbovePrompt', props })` 掛上，再用 `key`（`'handoff'`）找元件或按按鈕。每個介面測試都會在 `['terminal', 'desktop']` 各跑一次，確認那一列不依賴特定介面。
