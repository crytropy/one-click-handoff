/** Where a handoff stands: none running, writing the doc, asking whether to clear, clearing, or failed. */
export type Phase = 'idle' | 'summarizing' | 'asking' | 'clearing' | 'failed'

/** A handoff doc that was saved and not yet sent into a cleared conversation. */
export type Written = { path: string; doc: string }

declare module 'claude-code' {
  interface PluginState {
    'one-click-handoff': {
      /** The main conversation's context fill, in percent; null before a reading. */
      contextPercent: number | null
      phase: Phase
      /** Why the last handoff failed, shown beside the retry button. */
      failure: string | null
      /** The saved doc until it is sent into a cleared conversation or kept; null otherwise. */
      written: Written | null
    }
  }
}
