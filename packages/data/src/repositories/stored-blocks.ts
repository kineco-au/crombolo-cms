/**
 * Story 456: the stored pages and Library items whose blocks Umbraco would refuse,
 * so a site can fix them before their next save is refused. `crombolo content check`
 * and the health check's content entry list them.
 */
import { type DocumentValidationError, validationPath } from '@crombolo/core'
import type { Db } from '../database.ts'
import { currentSchemaState } from '../schema-state.ts'
import { DocumentRepository } from './documents.ts'

export interface StoredBlockProblem {
  kind: 'document' | 'element'
  key: string
  name: string
  errors: DocumentValidationError[]
}

/** Every stored page and Library item a save would refuse for its blocks, with each problem. */
export async function storedBlockProblems(db: Db): Promise<StoredBlockProblem[]> {
  const state = await currentSchemaState(db)
  const nodeState = { version: state.version, revision: state.revision }
  const out: StoredBlockProblem[] = []
  for (const kind of ['document', 'element'] as const) {
    const repo = new DocumentRepository(db, { nodeState, kind })
    for (const found of await repo.storedBlockProblems()) out.push({ kind, ...found })
  }
  return out
}

/** One problem as a line: the item, the full path and Umbraco's words. */
export const storedProblemLines = (problem: StoredBlockProblem): string[] =>
  problem.errors.map(
    (e) => `"${problem.name}" (${problem.key}) at ${validationPath(e)}: ${e.messages.join(' ')}`,
  )
