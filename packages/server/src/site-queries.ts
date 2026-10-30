/**
 * The site's named queries (story 189): modules the config lists, each export
 * run as `site().queries.<module>.<export>(…)` with the site's own tables and
 * who is asking supplied. docs/rendering.md, "Named queries".
 */
import { isOk, isOutcome } from '@crombolo/core'
import type { SiteTables, TablesDatabase } from '@crombolo/data'
import {
  currentCulture,
  markPersonal,
  type QueryCaller,
  type RequestMember,
  type SiteQueries,
} from '@crombolo/render'
import type { AnonymiseRules } from '@crombolo/transfer'
import { databaseFor, type TablesChain } from './custom-tables.ts'

export type { AnonymiseColumn, AnonymiseRules, AnonymiseTable } from '@crombolo/transfer'

export interface SiteDatabaseConfig {
  /** From `defineSiteTables`. */
  tables?: SiteTables
  /** Under `--anonymise`, each table that may travel, and how. */
  anonymise?: AnonymiseRules
}

/** Module namespaces, by the name `site().queries` calls them. */
export type SiteQueryModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>

const MODULE_NAME = /^[A-Za-z_$][\w$]*$/

/** Every reason the config's queries cannot be used. */
export function queryProblems(config: {
  queries?: SiteQueryModules
  database?: SiteDatabaseConfig
}): string[] {
  const problems: string[] = []
  const modules = Object.entries(config.queries ?? {})
  if (modules.length > 0 && !config.database?.tables)
    problems.push('queries are listed, but there is no database.tables for them to query')
  const seen = new Map<unknown, string>()
  for (const [name, module] of modules) {
    if (!MODULE_NAME.test(name))
      problems.push(`the query module "${name}" is not a name: letters, digits, _ and $`)
    if (!module || typeof module !== 'object') {
      problems.push(`queries.${name} is not a module: list it as \`import * as ${name} from …\``)
      continue
    }
    for (const [key, value] of Object.entries(module)) {
      const id = `${name}.${key}`
      if (typeof value !== 'function') {
        problems.push(`queries.${id} is not a function`)
        continue
      }
      const other = seen.get(value)
      if (other) problems.push(`queries.${id} is the same query as queries.${other}`)
      else seen.set(value, id)
    }
  }
  return problems.map((problem) => `${problem}.`)
}

/** A named query failed: its id is what an error page names. */
export class NamedQueryError extends Error {
  constructor(
    readonly query: string,
    cause: unknown,
  ) {
    super(
      `site().queries.${query} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}

type Member = RequestMember | undefined

/**
 * `site().queries` for one request, as `member` (or a visitor). The site's
 * tables are opened at the first call.
 */
export function createSiteQueries(options: {
  queries: SiteQueryModules | undefined
  chain: TablesChain | undefined
}): (member: Member | (() => Promise<Member>)) => SiteQueries {
  const modules = Object.entries(options.queries ?? {})
  let handle: TablesDatabase | undefined
  const database = () => {
    if (!options.chain) throw new Error('the site declares no tables')
    handle ??= databaseFor(options.chain)
    return handle
  }

  return (member) => {
    let found: Promise<Member> | undefined
    const caller: QueryCaller = Object.freeze({
      member: async () => {
        markPersonal()
        found ??= typeof member === 'function' ? member() : Promise.resolve(member)
        const who = await found
        return who
          ? Object.freeze({
              key: who.key,
              name: who.name,
              username: who.username,
              email: who.email,
              roles: Object.freeze([...who.roles]) as string[],
            })
          : undefined
      },
      locale: currentCulture(),
    })
    const queries: Record<string, Record<string, unknown>> = {}
    for (const [name, module] of modules) {
      const bound: Record<string, unknown> = {}
      for (const [key, fn] of Object.entries(module)) {
        if (typeof fn !== 'function') continue
        const id = `${name}.${key}`
        bound[key] = async (...args: unknown[]) => {
          let result: unknown
          try {
            result = await fn(database(), caller, ...args)
          } catch (error) {
            throw new NamedQueryError(id, error)
          }
          if (!isOk(result as never) && !isOutcome(result))
            throw new NamedQueryError(
              id,
              new Error(
                'it returned something other than a Result: return ok(value) or an Outcome',
              ),
            )
          return result
        }
      }
      queries[name] = Object.freeze(bound)
    }
    return Object.freeze(queries) as unknown as SiteQueries
  }
}
