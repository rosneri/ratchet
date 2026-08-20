import type { AgentReply, AgentTask, Model } from './types.ts'

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Bash']
const EDIT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'MultiEdit', 'TodoWrite']

/**
 * Claude Agent SDK adapter. The Builder gets edit tools; the Critic and the check
 * Author are read-only by construction — a critic that can edit the code can talk
 * itself out of a finding by quietly fixing it.
 */
export class ClaudeModel implements Model {
  readonly name: string

  constructor(model = process.env.RATCHET_MODEL ?? 'claude-opus-5') {
    this.name = model
  }

  async run(task: AgentTask): Promise<AgentReply> {
    const { query } = await loadSdk()
    const stream = query({
      prompt: task.prompt,
      options: {
        cwd: task.cwd,
        model: this.name,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: task.system },
        allowedTools: task.tools === 'edit' ? EDIT_TOOLS : READ_ONLY_TOOLS,
        permissionMode: task.tools === 'edit' ? 'acceptEdits' : 'default',
        maxTurns: task.maxTurns ?? (task.tools === 'edit' ? 60 : 25),
      },
    })

    let text = ''
    let tokens = 0
    for await (const message of stream as AsyncIterable<any>) {
      if (message.type === 'result') {
        text = message.result ?? text
        tokens += (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0)
      } else if (message.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if (block.type === 'text') text = block.text
        }
        tokens += (message.message?.usage?.output_tokens ?? 0)
      }
    }
    return { text, tokens }
  }
}

let sdk: any
async function loadSdk(): Promise<any> {
  if (sdk) return sdk
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk')
  } catch {
    throw new Error(
      'The Claude Agent SDK is not installed. Run `npm i @anthropic-ai/claude-agent-sdk` ' +
        'and make sure ANTHROPIC_API_KEY (or a Claude Code login) is available. ' +
        'To explore Ratchet without a key, run `ratchet demo`.',
    )
  }
  return sdk
}
