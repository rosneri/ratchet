const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
}
const on = process.stdout.isTTY && !process.env.NO_COLOR

const wrap = (code: string) => (s: string) => (on ? code + s + C.reset : s)
export const dim = wrap(C.dim)
export const bold = wrap(C.bold)
export const red = wrap(C.red)
export const green = wrap(C.green)
export const yellow = wrap(C.yellow)
export const blue = wrap(C.blue)
export const magenta = wrap(C.magenta)
export const cyan = wrap(C.cyan)

export function heading(text: string): string {
  return `\n${bold(text)}\n${dim('─'.repeat(Math.min(text.length, 60)))}`
}

export function statusDot(status: string): string {
  switch (status) {
    case 'active': case 'passed': case 'clean': return green('●')
    case 'quarantined': case 'failed': case 'blocked': return red('●')
    case 'retired': return dim('●')
    default: return yellow('●')
  }
}
