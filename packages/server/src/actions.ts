/**
 * Server actions (story 219): `POST /crombolo/actions/{id}`, through route
 * handlers' pipeline, so CSRF, the rate limit, the time limit and the signal
 * are theirs. A form post is answered with a 303 back, its result in a signed
 * flash cookie; a call asking for JSON with the result itself.
 * docs/rendering.md, "Server actions".
 */
import {
  ACTIONS_PATH,
  type ActionState,
  isOutcome,
  Ok,
  type Outcome,
  type RouteContext,
  route,
  type ServerAction,
} from '@crombolo/common'
import { readSignedFlash, writeSignedFlash } from './form-submit.ts'
import type { DeclaredRoute } from './routes.ts'

/** The cookie an action's result returns to the page in. */
export const ACTION_FLASH_COOKIE = 'crombolo-action'

/** The fields an action's form carries for Crombolo, taken out before the action sees them. */
export const RETURN_FIELD = '__return'
export const ANTIFORGERY_FIELD = '__antiforgery'

/** Fields whose values are never sent back to the page: what a password field is called. */
const SECRET_FIELD = /pass(word)?|secret|pin$/i

/** The site's actions, by id and by function. */
export interface ActionRegistry {
  ids: readonly string[]
  /** The id a listed function answers at, or undefined for one the config does not list. */
  idOf(action: unknown): string | undefined
  byId(id: string): ServerAction | undefined
}

/** A flash: which action answered, and what. */
export interface ActionFlash {
  id: string
  state: ActionState
}

/**
 * The config's action modules as a registry, and why any of it cannot be
 * mounted: an export that is not a function, a module key with a dot in it,
 * or one function listed twice.
 */
export function actionRegistry(modules: Record<string, Record<string, unknown>> | undefined): {
  registry: ActionRegistry
  problems: string[]
} {
  const byId = new Map<string, ServerAction>()
  const ids = new Map<unknown, string>()
  const problems: string[] = []
  for (const [moduleKey, exports] of Object.entries(modules ?? {})) {
    if (moduleKey.includes('.')) {
      problems.push(
        `The action module "${moduleKey}" has a dot in its key; an action's id is the key, a dot, and the export's name.`,
      )
      continue
    }
    for (const [name, action] of Object.entries(exports ?? {})) {
      const id = `${moduleKey}.${name}`
      if (typeof action !== 'function') {
        problems.push(
          `"${id}" is not a function: every export of an action module is an action, so move anything else to a module of its own.`,
        )
        continue
      }
      const listed = ids.get(action)
      if (listed) {
        problems.push(`One function is listed as two actions, "${listed}" and "${id}".`)
        continue
      }
      ids.set(action, id)
      byId.set(id, action as ServerAction)
    }
  }
  return {
    registry: {
      ids: [...byId.keys()],
      idOf: (action) => ids.get(action),
      byId: (id) => byId.get(id),
    },
    problems,
  }
}

/** Where an action's form returns: a path on this site, else the home page. */
export function returnPath(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

const wantsJson = (request: Request) =>
  (request.headers.get('accept') ?? '').includes('application/json')

/** What was submitted, to fill the form again: strings only, secrets left out. */
function submitted(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, value] of form)
    if (typeof value === 'string' && !SECRET_FIELD.test(name)) values[name] = value
  return values
}

/** The route each action answers at, through the site's route pipeline. */
export function actionRoutes(
  registry: ActionRegistry,
  flashSecret: string,
  secureCookies: boolean,
) {
  const flashCookie = (flash: ActionFlash) => {
    const value = writeSignedFlash(flashSecret, flash, [
      { state: { ...flash.state, values: {} } },
      { state: { ...flash.state, values: {}, value: undefined } },
    ])
    return `${ACTION_FLASH_COOKIE}=${value}; Path=/; Max-Age=60; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}`
  }
  const back = (location: string, flash: ActionFlash) =>
    new Response(null, {
      status: 303,
      headers: { location, 'set-cookie': flashCookie(flash), 'cache-control': 'no-store' },
    })

  const entries = new Map<string, DeclaredRoute>()
  for (const id of registry.ids) {
    const action = registry.byId(id) as ServerAction
    const handler = async (request: Request, context: RouteContext): Promise<Response> => {
      const json = wantsJson(request)
      const form = await request.formData().catch(() => undefined)
      if (!form)
        return Response.json(
          { ok: false, status: 400, message: 'An action is posted as a form.' },
          { status: 400 },
        )
      const to = returnPath(form.get(RETURN_FIELD))
      form.delete(RETURN_FIELD)
      form.delete(ANTIFORGERY_FIELD)
      const { params: _, ...actionContext } = context
      let answer: Response | Ok<unknown> | Outcome | unknown
      try {
        answer = await action(form, actionContext)
      } catch (error) {
        // `redirect()` and `notFound()` throw their outcome, as in a page.
        if (!isOutcome(error)) throw error
        answer = error
      }
      if (answer instanceof Response) return answer
      if (isOutcome(answer)) {
        if (answer.isRedirect)
          return json
            ? Response.json({ ok: true, redirect: answer.location })
            : back(answer.location as string, { id, state: { ok: true } })
        const state: ActionState = {
          ok: false,
          status: answer.status,
          message: answer.message,
          errors: answer.errors,
          values: submitted(form),
        }
        return json
          ? Response.json(
              { ok: false, status: answer.status, message: answer.message, errors: answer.errors },
              { status: answer.status },
            )
          : back(to, { id, state })
      }
      const value = answer instanceof Ok ? answer.value : answer
      return json
        ? Response.json({ ok: true, value })
        : back(to, { id, state: { ok: true, value } })
    }
    entries.set(id, {
      route: route(`${ACTIONS_PATH}/${id}`, { POST: handler as never }),
      owner: `the action ${id}`,
    })
  }

  return {
    /** The action a path names, or undefined when it names none. */
    match(pathname: string): DeclaredRoute | undefined {
      if (!pathname.startsWith(`${ACTIONS_PATH}/`)) return undefined
      return entries.get(decodeURIComponent(pathname.slice(ACTIONS_PATH.length + 1)))
    },
    /** The flash a page returned to holds, when its signature holds and it is fresh. */
    readFlash(cookie: string | undefined): ActionFlash | undefined {
      return readSignedFlash<ActionFlash>(flashSecret, cookie)
    },
  }
}
