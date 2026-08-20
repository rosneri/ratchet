import type { AgentReply, AgentTask, Model } from './types.ts'

export type ScriptedStep = (task: AgentTask) => string | Promise<string>

/**
 * A model whose replies are supplied by the caller. Used by `ratchet demo` to
 * exercise the full harness — gauntlet, admission control, registry, UI — with no
 * API key, and by tests to pin the behaviour of the loop itself.
 */
export class ScriptedModel implements Model {
  readonly name: string
  private queue: ScriptedStep[]

  constructor(steps: ScriptedStep[], name = 'scripted') {
    this.queue = [...steps]
    this.name = name
  }

  async run(task: AgentTask): Promise<AgentReply> {
    const step = this.queue.shift()
    if (!step) throw new Error(`ScriptedModel exhausted: no reply scripted for a ${task.role} turn.`)
    const text = await step(task)
    return { text, tokens: Math.ceil((task.prompt.length + text.length) / 4) }
  }

  get remaining(): number {
    return this.queue.length
  }
}
