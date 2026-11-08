/**
 * `site().content` (story 298): the site's own code reading and writing pages,
 * through the document operations the Management API uses, as the API user the
 * config's `content.actAs` names. Its permissions, start nodes, languages and the
 * approval workflows bound what this may do, and the audit names the route,
 * action, job or event that made each change. docs/rendering.md, "Writing content".
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Principal } from '@crombolo/api-management'
import { canReadDocument } from '@crombolo/api-management'
import { AuthStore } from '@crombolo/auth'
import type { DocumentOperations, Refusal } from '@crombolo/content'
import { userActor } from '@crombolo/content'
import { normaliseUuid, Outcome, ok, toSectionAliases } from '@crombolo/core'
import {
  ContentTypeRepository,
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  UserRepository,
} from '@crombolo/data'
import type { SiteContent, SiteDocument } from '@crombolo/render'
import { createNodeLookup, loadAccess } from './access.ts'
import {
  documentName,
  fromDocumentValues,
  toDocumentValues,
  type ValueProperty,
} from './site-content-values.ts'

/** Where site code may write from, and what it is: `route POST /api/listings`, `job imports.nightly`. */
interface WriteScope {
  via: string
  source: 'request' | 'job'
}

const writes = new AsyncLocalStorage<WriteScope>()

/**
 * Runs site code that may write content: a route, an action, a job or an event
 * handler, named for the audit. A page render runs outside any, and only reads.
 */
export function withSiteWrites<T>(scope: WriteScope, run: () => T): T {
  return writes.run(scope, run)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SiteContentDeps {
  db: Db
  documents: DocumentOperations
  /** The node's schema state, as every document read on it is given. */
  nodeState?: DocumentRepositoryOptions['nodeState']
  nodeId?: string
  /** The API user's client id, from `content.actAs`. */
  actAs?: string
}

/** The API user a client id names, as the Management API would see it signed in; undefined when none. */
export async function apiUserPrincipal(db: Db, clientId: string): Promise<Principal | undefined> {
  const owner = await new UserRepository(db).clientCredentialOwner(clientId)
  if (!owner) return undefined
  const store = new AuthStore(db)
  const user = await store.findUserById(owner.userId)
  if (!user || user.isLockedOut || !user.isApproved) return undefined
  const authorization = await store.loadAuthorization(user.id)
  return {
    id: user.key,
    userName: user.login,
    name: user.userName,
    email: user.email,
    isAdmin: authorization.isAdmin,
    languageIsoCode: user.language ?? undefined,
    avatarUrls: [],
    allowedSections: toSectionAliases(authorization.appAliases),
    permissions: authorization.permissions,
    groupKeys: authorization.groupKeys,
    hasAccessToAllLanguages: authorization.hasAccessToAllLanguages,
    ...(await loadAccess(db, user.id)),
  } as unknown as Principal
}

/** An operation's refusal as an `Outcome` site code matches on. */
function outcomeOf(refusal: Refusal) {
  switch (refusal.kind) {
    case 'notFound':
      return Outcome.notFound(refusal.reason)
    case 'forbidden':
      return Outcome.forbidden(refusal.reason)
    case 'needsApproval':
      return Outcome.badRequest(`This needs approval before it is published: ${refusal.reason}`)
    case 'validation':
    case 'blocked':
      if (refusal.kind === 'blocked' && !refusal.errors?.length)
        return Outcome.badRequest(refusal.reason)
      return Outcome.unprocessableContent(
        (refusal.errors ?? []).flatMap((error) =>
          error.messages.map((message) => ({
            field: error.culture ? `${error.alias}.${error.culture}` : error.alias,
            message,
          })),
        ),
        refusal.reason,
      )
    default:
      return Outcome.badRequest(refusal.reason)
  }
}

export function createSiteContent(deps: SiteContentDeps): SiteContent {
  const { db, documents } = deps
  const repo = new DocumentRepository(db, { nodeState: deps.nodeState, nodeId: deps.nodeId })
  const types = new ContentTypeRepository(db)
  const nodes = createNodeLookup(db)

  const notActing = () =>
    Outcome.forbidden(
      "This site's code cannot change content: name an API user in the config's content.actAs.",
    )

  const principal = async () => (deps.actAs ? apiUserPrincipal(db, deps.actAs) : undefined)

  /** Who a write is, inside a route, an action, a job or an event; a refusal elsewhere. */
  const writer = async () => {
    const scope = writes.getStore()
    if (!scope)
      return Outcome.forbidden(
        'A page render reads content and never changes it: write from an action, a route, a job or an event.',
      )
    const who = await principal()
    if (!who) return notActing()
    return userActor(who, { via: scope.via, source: scope.source } as never)
  }

  const properties = async (typeKey: string): Promise<ValueProperty[]> =>
    (await types.resolveProperties(typeKey)).map((p) => ({
      alias: p.alias,
      variesByCulture: p.variesByCulture,
    }))

  const read = async (key: string): Promise<SiteDocument | undefined> => {
    const document = await repo.byKey(key)
    if (!document || document.isTrashed) return undefined
    return {
      key: document.key,
      contentType: document.contentTypeAlias,
      parent: document.parentKey,
      name: documentName(document),
      values: fromDocumentValues(document.values, await properties(document.contentTypeKey)),
      published: document.published,
    }
  }

  const done = (key: string) => ok({ key })

  return {
    async get(key) {
      const who = await principal()
      if (!who) return notActing()
      if (!UUID.test(key) || !(await canReadDocument(who, key, nodes))) return Outcome.notFound()
      const found = await read(key)
      return found ? ok(found) : Outcome.notFound()
    },

    async children(key) {
      const who = await principal()
      if (!who) return notActing()
      if (key !== null && (!UUID.test(key) || !(await canReadDocument(who, key, nodes))))
        return Outcome.notFound()
      const page = await repo.children(key, 0, 10_000)
      const out: SiteDocument[] = []
      for (const row of page.items) {
        const childKey = normaliseUuid(row.key)
        if (!(await canReadDocument(who, childKey, nodes))) continue
        const found = await read(childKey)
        if (found) out.push(found)
      }
      return ok(out)
    },

    async create(input) {
      const actor = await writer()
      if (actor instanceof Outcome) return actor
      const type = await types.byAlias(input.contentType)
      if (!type)
        return Outcome.unprocessableContent(
          [{ field: 'contentType', message: `There is no content type "${input.contentType}".` }],
          `There is no content type "${input.contentType}".`,
        )
      const converted = toDocumentValues(input.values ?? {}, await properties(type.key), {
        culture: input.culture,
      })
      if ('errors' in converted)
        return Outcome.unprocessableContent(converted.errors, 'Some values could not be placed.')
      const key = crypto.randomUUID()
      const result = await documents.create(actor, {
        key,
        contentTypeKey: type.key,
        componentKey: type.defaultComponentKey,
        parentKey: input.parent,
        values: converted.values,
        variants: [
          {
            culture: type.variesByCulture ? (input.culture ?? null) : null,
            segment: null,
            name: input.name,
          },
        ],
      })
      return result.ok ? done(result.key) : outcomeOf(result)
    },

    async update(key, change) {
      const actor = await writer()
      if (actor instanceof Outcome) return actor
      const existing = UUID.test(key) ? await repo.byKey(key) : undefined
      if (!existing) return Outcome.notFound()
      const converted = toDocumentValues(
        change.values ?? {},
        await properties(existing.contentTypeKey),
        { culture: change.culture, existing: existing.values },
      )
      if ('errors' in converted)
        return Outcome.unprocessableContent(converted.errors, 'Some values could not be placed.')
      const variants = existing.variants
        .filter((v) => !v.segment)
        .map((v) => ({
          culture: v.culture,
          segment: null,
          name:
            change.name !== undefined && (change.culture ?? null) === (v.culture ?? null)
              ? change.name
              : v.name,
        }))
      if (
        change.name !== undefined &&
        change.culture &&
        !variants.some((v) => v.culture === change.culture)
      )
        variants.push({ culture: change.culture, segment: null, name: change.name })
      const result = await documents.save(
        actor,
        existing.key,
        {
          key: existing.key,
          contentTypeKey: existing.contentTypeKey,
          componentKey: existing.componentKey,
          parentKey: existing.parentKey,
          values: converted.values,
          variants,
        },
        { expectedRevision: existing.revision },
      )
      return result.ok ? done(existing.key) : outcomeOf(result)
    },

    async publish(key, options = {}) {
      const actor = await writer()
      if (actor instanceof Outcome) return actor
      if (!UUID.test(key)) return Outcome.notFound()
      const cultures = options.cultures ?? null
      const result = await documents.publish(actor, key, { cultures })
      return result.ok ? done(key) : outcomeOf(result)
    },

    async unpublish(key, options = {}) {
      const actor = await writer()
      if (actor instanceof Outcome) return actor
      if (!UUID.test(key)) return Outcome.notFound()
      const result = await documents.unpublish(actor, key, options.cultures ?? null)
      return result.ok ? done(key) : outcomeOf(result)
    },

    async delete(key) {
      const actor = await writer()
      if (actor instanceof Outcome) return actor
      if (!UUID.test(key)) return Outcome.notFound()
      const result = await documents.trash(actor, key)
      return result.ok ? done(key) : outcomeOf(result)
    },
  }
}
