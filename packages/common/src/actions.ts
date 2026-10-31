/**
 * Server actions (story 219): a function on the server that a form posts to,
 * or an island calls. The config lists action modules, and each export is an
 * action whose id is the module's key and the export's name, `profile.save`.
 * docs/rendering.md, "Server actions".
 */
import type { FieldError, OutcomeStatus, Result } from './result.ts'
import { Outcome, ok } from './result.ts'
import type { RouteContext } from './routes.ts'

/** The path an action is posted to: `/crombolo/actions/{id}`. */
export const ACTIONS_PATH = '/crombolo/actions'

/** The anti-forgery header and meta tag `/crombolo/bundle.js` uses, which a call from an island sends too. */
export const ACTION_ANTIFORGERY_HEADER = 'Crombolo-Antiforgery'
const ANTIFORGERY_META = 'crombolo-antiforgery'

/** What an action is given besides the form's data: a route's context, less its params. */
export type ActionContext<Site = unknown, Member = unknown> = Omit<
  RouteContext<Site, Member>,
  'params'
>

/** An action: the form's data in, a `Response` or a `Result` out. */
export type ServerAction<Site = unknown, Member = unknown> = (
  formData: FormData,
  context: ActionContext<Site, Member>,
) => Response | Result<unknown> | Promise<Response | Result<unknown>>

/** What an action answered, as the page it returned to reads it with `actionState`. */
export interface ActionState<T = unknown> {
  ok: boolean
  /** A success's value. */
  value?: T
  /** An outcome's status. */
  status?: number
  message?: string
  errors?: readonly FieldError[]
  /** What was submitted, so the form can be shown again; passwords and files left out. */
  values?: Record<string, string>
}

type Answer<A> = A extends (...args: never[]) => infer R
  ? Awaited<R> extends Result<infer T, infer S>
    ? Result<T, S>
    : Result<unknown>
  : never

/** An action as an island is given it: called with a form's data, or an object of fields. */
export type ClientAction<A> = (
  input: FormData | Record<string, string | Blob>,
) => Promise<Answer<A>>

/** An action given to an island, typed as the browser sees it, where inference falls short. */
export function clientAction<A extends (...args: never[]) => unknown>(action: A): ClientAction<A> {
  return action as unknown as ClientAction<A>
}

/** An action in an island's props, as the server writes it. */
export interface ActionReference {
  $action: string
}

const isReference = (value: unknown): value is ActionReference =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).length === 1 &&
  typeof (value as { $action?: unknown }).$action === 'string'

/** The JSON an action answers a browser's call with. */
interface ActionAnswer {
  ok: boolean
  value?: unknown
  status?: OutcomeStatus
  message?: string
  errors?: FieldError[]
  redirect?: string
}

/**
 * An island's props with each action rebuilt as a function that posts to it
 * and resolves to its `Result`; a redirect navigates. What the React mount
 * does before rendering, and what an `<Island>` module calls itself.
 */
export function reviveActions<T>(props: T, antiforgery?: () => string | null): T {
  const token =
    antiforgery ??
    (() =>
      globalThis.document
        ?.querySelector(`meta[name="${ANTIFORGERY_META}"]`)
        ?.getAttribute('content') ?? null)
  const revive = (value: unknown): unknown => {
    if (isReference(value)) return callAction(value.$action, token)
    if (Array.isArray(value)) return value.map(revive)
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
    return value
  }
  return revive(props) as T
}

function callAction(id: string, token: () => string | null) {
  return async (input: FormData | Record<string, string | Blob>): Promise<Result<unknown>> => {
    const body = input instanceof FormData ? input : new FormData()
    if (!(input instanceof FormData))
      for (const [name, value] of Object.entries(input)) body.append(name, value)
    const headers: Record<string, string> = { accept: 'application/json' }
    const antiforgery = token()
    if (antiforgery) headers[ACTION_ANTIFORGERY_HEADER] = antiforgery
    const response = await fetch(`${ACTIONS_PATH}/${encodeURIComponent(id)}`, {
      method: 'POST',
      body,
      headers,
      credentials: 'same-origin',
    })
    const answer = (await response.json()) as ActionAnswer
    if (answer.redirect) {
      globalThis.location?.assign(answer.redirect)
      return Outcome.seeOther(answer.redirect)
    }
    if (answer.ok) return ok(answer.value)
    return Outcome.of((answer.status ?? response.status) as OutcomeStatus, {
      message: answer.message,
      errors: answer.errors ?? [],
    })
  }
}
