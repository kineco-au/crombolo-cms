/**
 * The content query endpoint (story 183): who is asking becomes the query's
 * scope. Start nodes narrow the statement, Browse is checked per page only when
 * some group could withhold it, and a property the user cannot read may not be
 * filtered or sorted on.
 */
import type { Principal } from '@crombolo/api-management'
import {
  DocumentPermissions,
  type GroupGrant,
  permissionsForPath,
  propertyValuePermissions,
  ROOT_ACCESS,
} from '@crombolo/core'
import {
  ContentQueryRefused,
  type Db,
  parseContentQuery,
  type QueryScope,
  queryDocuments,
} from '@crombolo/data'

/** Whether every group the user is in can browse every page. */
const browsesEverything = (groups: readonly GroupGrant[]) =>
  groups.some(
    (group) =>
      group.defaults.includes(DocumentPermissions.Read) &&
      [...group.granular.values()].every((verbs) => verbs.includes(DocumentPermissions.Read)),
  )

/** The scope a signed-in back-office user queries within. */
export function contentQueryScope(principal: Principal): QueryScope {
  const groups = principal.groups
  return {
    start: principal.startNodes.document,
    browses:
      principal.isAdmin || browsesEverything(groups)
        ? undefined
        : (chain) => permissionsForPath(groups, chain).has(DocumentPermissions.Read),
    readsProperty: (key) =>
      principal.isAdmin ||
      propertyValuePermissions(groups, key).has(DocumentPermissions.PropertyValueRead),
  }
}

/** Everything, for an operator at the command line on the site's own database. */
export const OPERATOR_SCOPE: QueryScope = { start: ROOT_ACCESS, readsProperty: () => true }

/** A 400 the back office and the remote protocol both read: a title, and every problem. */
const badQuery = (problems: string[]) =>
  Response.json(
    { code: 'bad-query', title: problems[0] ?? 'The query cannot be run.', problems },
    { status: 400 },
  )

/** A request body to a response: 400 with each problem named, else the matches. */
export async function answerContentQuery(
  db: Db,
  scope: QueryScope,
  body: unknown,
): Promise<Response> {
  const parsed = parseContentQuery(body)
  if (!parsed.ok) return badQuery(parsed.problems)
  try {
    return Response.json(await queryDocuments(db, parsed.query, scope))
  } catch (error) {
    if (error instanceof ContentQueryRefused) return badQuery([error.message])
    throw error
  }
}
