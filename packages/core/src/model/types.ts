export interface AgentTask {
  role: 'builder' | 'critic' | 'author'
  system: string
  prompt: string
  cwd: string
  /** `edit` grants write tools; `read-only` grants inspection only. */
  tools: 'edit' | 'read-only'
  maxTurns?: number
}

export interface AgentReply {
  text: string
  tokens: number
}

export interface Model {
  readonly name: string
  run(task: AgentTask): Promise<AgentReply>
}

/** Pull the first fenced JSON block, or the outermost JSON value, out of a model reply. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], sliceBalanced(text, '{', '}'), sliceBalanced(text, '[', ']'), text]
  for (const c of candidates) {
    if (!c) continue
    try { return JSON.parse(c.trim()) as T } catch { /* try next */ }
  }
  throw new Error(`Model reply contained no parseable JSON:\n${text.slice(0, 800)}`)
}

function sliceBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}
