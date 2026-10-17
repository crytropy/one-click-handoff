/** Where a handoff stands: none running, writing the summary, clearing, or failed. */
export type Phase = 'idle' | 'summarizing' | 'clearing' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    'one-click-handoff': {
      /** The main conversation's context fill, in percent; null before a reading. */
      contextPercent: number | null
      phase: Phase
      /** Why the last handoff failed, shown beside the retry button. */
      failure: string | null
    }
  }
}
