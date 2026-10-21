# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **mod** (a plugin with a hooks module, no `package.json`, no build step). When the main conversation's context reaches 70%, it draws a 「一鍵交接」 button above the prompt. Pressing it asks the model for a handoff summary, saves it to `~/.claude/handoffs/<project>-<YYYYMMDD-HHMMSS>.md`, runs `/clear`, then submits the summary as the new conversation's first prompt. The README covers installing it locally and in cloud sessions (the cloud setup is unverified). User-facing text (UI strings, the summary prompt, README) is Traditional Chinese.

## Commands

```bash
claude plugin validate .   # check the manifest and hooks module the way the engine loads them
claude plugin test .       # run every tests/*.test.ts(x) against the engine; exits 1 on failure
claude --plugin-dir .      # run a session with the plugin loaded from this folder (hot-reloads on save)
```

`claude plugin test` has no per-test filter; it runs every test file.

`validate` passes but reports that the plugin directory would refuse a submission because there is no LICENSE and no `license` in `plugin.json`. It also warns that there is no icon. Neither affects loading.

On Linux, `the button summarizes, saves, clears, then sends the summary` fails. The test mocks `USERPROFILE` as `C:\Users\me`, and `$.fs.write` resolves the resulting `C:/...` path against the cwd because it isn't absolute on Linux. The other tests pass.

## Architecture

- `.claude-plugin/plugin.json` is the plugin manifest. `.claude-plugin/marketplace.json` makes the repo its own single-plugin marketplace (`source: "./"`). Bump `version` in `plugin.json` when releasing.
- `hooks/hooks.json` lists the hooks module, `hooks/register.tsx`, which holds all the logic. The module has no DOM or Node APIs. It reaches everything through the engine interface `$` (`$.session.usage()`, `$.model.fork`, `$.fs.write`, `$.command.run`, `$.prompt.submit`, `$.ui.toast`, `$.env.get`, `$.clock.now`). JSX elements come from `$.ui.resolve(e)` for the surface being drawn.
- `types/index.d.ts` is the `$.state` contract. Every `atom({ plugin: 'one-click-handoff', key })` in `register.tsx` must be declared under `PluginState['one-click-handoff']`, and `claude plugin validate` enforces this. Adding a state value means updating both files.

How the pieces fit together:
- **Context reading.** `contextPercent` is refreshed from `$.session.usage()` on `session.start` and on `turn.complete` for the main agent only (`e.agentId === undefined`, so subagent turns are skipped). It is reset to `null` on `session.end` with `reason === 'clear'` and after a successful handoff, which hides the button until the next reading.
- **State machine.** `phase` moves through `idle → summarizing → clearing → idle`, or to `failed`. While a handoff is in progress, `handoff()` ignores further presses. On failure, `failure` holds the reason and the band shows a 「重試交接」 button. If the summary fails, nothing is cleared or written.
- **Band rendering.** The `ui.render` hook on `AbovePrompt` must always call `next(e)` and render its output below its own row, because other plugins (e.g. prompt-band) share the band. It returns only `next(e)` when there is a survey, when it has nothing to show, or while a turn is running (`isWorking`), which hides the button.
- **Paths.** `handoffPath` handles both Windows and POSIX: it prefers `USERPROFILE` over `HOME` and normalizes backslashes. The project name is the sanitized last segment of the cwd.

## Tests

`tests/handoff.test.tsx` uses `claude-code/testing`. Hooks registered through the test's `on` sit beneath the plugin and stand in for the engine (usage, fs, model fork, command, prompt, clock). UI is exercised with `$.ui.mount({ plugin, surface, component: 'AbovePrompt', props })` and found or pressed by `key` (`'handoff'`). Tests loop over `['terminal', 'desktop']` so the band doesn't depend on one surface.
