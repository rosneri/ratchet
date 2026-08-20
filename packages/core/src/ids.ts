import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function id(prefix: string, len = 8): string {
  const bytes = randomBytes(len)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return `${prefix}_${out}`
}

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'check'
}

export function now(): string {
  return new Date().toISOString()
}
