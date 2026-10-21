# one-click-handoff
一鍵交接

Context 用到 70% 時，輸入框上方出現「一鍵交接」按鈕：請模型寫一份交接文件、存到系統的暫存資料夾（`$TMPDIR`，沒有就用 Windows 的 `%TEMP%`，再沒有就用 `/tmp`）。寫好後輸入框上方會問要不要清空對話：選「清空並接續」就清空，再把文件當成新對話的第一句送出；選「先不要」就留著目前的對話，文件仍然存在暫存資料夾。

也可以隨時輸入 `/one-click-handoff 下一段要做什麼`，交接文件會依你寫的方向調整。

交接文件的寫法照 [mattpocock/skills 的 handoff skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md)：

- 寫一節「建議使用的 skill」，列出下一段對話該用哪些 skill。
- 已經記在其他地方的內容（規格、計畫、ADR、issue、commit、diff）不重複寫，改用路徑或網址指過去。
- 遮掉 API key、密碼、個人身分資訊等敏感資訊。

## 安裝（本機）

```
/plugin marketplace add crytropy/one-click-handoff
/plugin install one-click-handoff@one-click-handoff
```

要讓某個 repo 在本機開的 session 自動載入，在那個 repo 的 `.claude/settings.json` 加上：

```json
{
  "extraKnownMarketplaces": {
    "one-click-handoff": { "source": { "source": "github", "repo": "crytropy/one-click-handoff" } }
  },
  "enabledPlugins": { "one-click-handoff@one-click-handoff": true }
}
```

這段設定只對本機 session 有效。雲端 session 不會安裝 repo 設定或使用者設定裡的外掛，見官方文件 [What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)。

## 雲端 session（未驗證）

> ⚠️ 這個做法還沒實際驗證過，雲端介面也不一定會畫出輸入框上方的按鈕。另外，雲端 session 不支援 `/clear`，選「清空並接續」時可能會失敗；交接文件也會存在雲端主機的暫存資料夾，不會存到你的電腦。

雲端 session 跑在雲端環境（environment）裡，環境和 repo 是分開選的。設定一次環境，用這個環境開的雲端 session 都會套用，不管開在哪個 repo。在 claude.ai/code 的環境設定裡：

1. **Setup script** 加上：

   ```bash
   git clone --depth 1 https://github.com/crytropy/one-click-handoff /opt/one-click-handoff
   ```

2. **Environment variables** 加上：

   ```
   CLAUDE_CODE_PLUGIN_DIRS=/opt/one-click-handoff
   ```

   如果也裝了 prompt-band，兩個資料夾用 `:` 接在一起（雲端主機是 Linux），例如 `/opt/prompt-band:/opt/one-click-handoff`。

設定好後開一個新的雲端 session，等 Context 用到 70% 時看輸入框上方有沒有出現按鈕。
