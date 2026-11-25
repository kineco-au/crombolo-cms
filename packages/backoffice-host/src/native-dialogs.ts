/**
 * The browser's own confirm, alert and prompt, and dialogs made on the page outside
 * the back office's look, found in back-office code: refused in an extension when it
 * is checked or installed, and held to in the back office's own code (AGENTS.md).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BACKOFFICE_DIR } from './bundle-package.ts'

const SOURCE = /\.(m?[jt]s|[jt]sx)$/
const NATIVE = /(?:^|[^.\w$]|\b(?:window|globalThis|self)\.)(confirm|alert|prompt)\s*\(/gm
const PAGE_DIALOG = /createElement\(\s*['"`]dialog['"`]\s*\)/

/** Code without its comments, so a word in one is not taken for a call. Pure. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

/** What a back-office source uses that the back office never does: each by name. Pure. */
export function nativeDialogUses(source: string): string[] {
  const code = withoutComments(source)
  const found = new Set<string>()
  for (const match of code.matchAll(NATIVE)) found.add(match[1] as string)
  if (PAGE_DIALOG.test(code)) found.add('a dialog made on the page')
  return [...found].sort()
}

const sources = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path)
    return SOURCE.test(entry.name) ? [path] : []
  })
}

/** Why an extension's back-office code is refused for asking or telling outside the back office's own look. */
export function extensionDialogProblems(directory: string): string[] {
  return sources(join(directory, BACKOFFICE_DIR)).flatMap((file) => {
    const uses = nativeDialogUses(readFileSync(file, 'utf8'))
    if (uses.length === 0) return []
    return [
      `${relative(directory, file)} uses ${uses.join(', ')}: an extension asks with the back office's own dialogs (umbConfirmModal and the modal manager), never the browser's, so it looks and works as the rest does`,
    ]
  })
}
