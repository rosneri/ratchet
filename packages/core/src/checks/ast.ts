import { Project, SyntaxKind, type SourceFile } from 'ts-morph'
import type { SymbolKind } from '../types.ts'

export interface DeclarationRecord {
  name: string
  kind: SymbolKind
  file: string
  line: number
  exported: boolean
  text: string
}

/**
 * Build a ts-morph Project over the given files. Deliberately no tsconfig resolution:
 * checks must be fast and must not depend on a compilable project.
 */
export function buildProject(root: string, files: string[]): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, checkJs: false, noLib: true },
  })
  for (const f of files) {
    try { project.addSourceFileAtPath(`${root}/${f}`) } catch { /* unreadable / binary */ }
  }
  return project
}

/** Every top-level named declaration in a source file. */
export function topLevelDeclarations(sf: SourceFile, relPath: string): DeclarationRecord[] {
  const out: DeclarationRecord[] = []
  const push = (name: string | undefined, kind: SymbolKind, node: { getStartLineNumber(): number; getText(): string }, exported: boolean) => {
    if (!name) return
    out.push({ name, kind, file: relPath, line: node.getStartLineNumber(), exported, text: node.getText().slice(0, 200) })
  }

  for (const fn of sf.getFunctions()) push(fn.getName(), 'function', fn, fn.isExported())
  for (const cls of sf.getClasses()) push(cls.getName(), 'class', cls, cls.isExported())
  for (const i of sf.getInterfaces()) push(i.getName(), 'interface', i, i.isExported())
  for (const t of sf.getTypeAliases()) push(t.getName(), 'type', t, t.isExported())
  for (const e of sf.getEnums()) push(e.getName(), 'enum', e, e.isExported())
  for (const vs of sf.getVariableStatements()) {
    for (const d of vs.getDeclarations()) {
      const init = d.getInitializer()
      const isFnLike =
        init?.getKind() === SyntaxKind.ArrowFunction || init?.getKind() === SyntaxKind.FunctionExpression
      push(d.getName(), isFnLike ? 'function' : 'const', d, vs.isExported())
    }
  }
  return out
}

export function allDeclarations(root: string, files: string[]): DeclarationRecord[] {
  const project = buildProject(root, files)
  const out: DeclarationRecord[] = []
  for (const f of files) {
    const sf = project.getSourceFile(`${root}/${f}`)
    if (!sf) continue
    out.push(...topLevelDeclarations(sf, f))
  }
  return out
}
