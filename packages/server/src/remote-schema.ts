/**
 * The remote protocol's routes for the site's schema files (story 374): `schema`
 * reads them, and `schema/edits` writes and removes them by the definition and
 * applies the change at once, as a type saved in the back office is. Reading
 * takes Pull; changing takes Push and ApplyStructure, at the `content` level.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { RemotePermissions, type RemoteVerb } from '@crombolo/core'
import type { createSchemaTransfer, SchemaEdit, SchemaWrites } from './schema-transfer.ts'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface SchemaRouteOptions {
  transfer: () => Pick<ReturnType<typeof createSchemaTransfer>, 'files' | 'edit'>
  problem(status: number, body: Problem): Response
  /** Whether the site's remote access level is at least this. */
  atLeast(level: 'read' | 'content'): boolean
  /** A refusal naming the level a thing needs. */
  notAtLevel(level: 'read' | 'content', what: string): Response
  may(principal: Principal, verb: RemoteVerb): boolean
  /** Push, and PushProtected where the environment is protected. */
  mayChange(principal: Principal): boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An edit as a request names it, or undefined when it is not one. */
export function schemaEditOf(asked: unknown): SchemaEdit | undefined {
  if (!isRecord(asked) || !isRecord(asked.edits)) return undefined
  const edits: SchemaWrites = {}
  for (const [path, text] of Object.entries(asked.edits)) {
    if (typeof text !== 'string' && text !== null) return undefined
    edits[path] = text
  }
  let base: Record<string, string | null> | undefined
  if (asked.base !== undefined) {
    if (!isRecord(asked.base)) return undefined
    base = {}
    for (const [path, hash] of Object.entries(asked.base)) {
      if (typeof hash !== 'string' && hash !== null) return undefined
      base[path] = hash
    }
  }
  return {
    edits,
    ...(base ? { base } : {}),
    retire: asked.retire === true,
    dryRun: asked.dryRun === true,
  }
}

export function createSchemaRoutes(options: SchemaRouteOptions) {
  const { problem, atLeast, notAtLevel, may, mayChange } = options

  return {
    /** The capabilities these routes add to discovery, at the site's level. */
    capabilities(): string[] {
      return [
        ...(atLeast('read') ? ['schema-files'] : []),
        ...(atLeast('content') ? ['schema-edit'] : []),
      ]
    },

    /** Whether the person may change the schema here. */
    mayEdit(principal: Principal): boolean {
      return (
        atLeast('content') &&
        mayChange(principal) &&
        may(principal, RemotePermissions.ApplyStructure)
      )
    },

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      if (what === 'schema') {
        if (request.method !== 'GET') return new Response(null, { status: 405 })
        if (!atLeast('read')) return notAtLevel('read', 'reading the schema')
        if (!may(principal, RemotePermissions.Pull))
          return problem(403, { code: 'forbidden', title: 'You may not read this site’s schema' })
        return Response.json(options.transfer().files(), {
          headers: { 'cache-control': 'private, no-store' },
        })
      }
      if (what !== 'schema/edits') return undefined
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      if (!atLeast('content')) return notAtLevel('content', 'changes to the schema')
      if (!mayChange(principal))
        return problem(403, { code: 'forbidden', title: 'You may not change this environment' })
      if (!may(principal, RemotePermissions.ApplyStructure))
        return problem(403, {
          code: 'forbidden-structure',
          title: 'You may not change this site’s schema',
          detail: 'Changing content types and data types needs Crombolo.Remote.ApplyStructure.',
        })
      const asked = schemaEditOf(await request.json().catch(() => undefined))
      if (!asked)
        return problem(400, {
          code: 'bad-request',
          title: 'That is not a schema edit',
          detail: 'Send { edits: { <path>: <text> | null }, base?, retire?, dryRun? }.',
        })
      const outcome = await options
        .transfer()
        .edit({ id: principal.id, name: principal.name, ipAddress: null }, asked)
      if (outcome.ok) {
        const { ok: _, ...result } = outcome
        return Response.json(result)
      }
      return problem(outcome.status, {
        code: outcome.code ?? 'refused',
        title: outcome.message,
        ...(outcome.problems ? { items: outcome.problems } : {}),
      })
    },
  }
}
