/**
 * Story 440: an extension naming an event by an old name, Umbraco's among them, is refused
 * at install and by `crombolo extension check`, naming the new one, before it is run.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { RENAMED_EVENTS } from '@crombolo/api-management/domain'

const CODE = /\.(m?[jt]sx?|cjs)$/

function files(dir: string, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (CODE.test(name)) out.push(path)
  }
  return out
}

/** Each file naming an old event, with the name it should use. */
export function extensionEventNameProblems(directory: string): string[] {
  const problems: string[] = []
  for (const file of files(directory)) {
    const text = readFileSync(file, 'utf8')
    for (const [old, now] of Object.entries(RENAMED_EVENTS))
      if (new RegExp(`['"\`]${old.replace('.', '\\.')}['"\`]`).test(text))
        problems.push(
          `${relative(directory, file)} names the event "${old}", which is now "${now}": every event is named "Crombolo." and its word.`,
        )
  }
  return problems
}
