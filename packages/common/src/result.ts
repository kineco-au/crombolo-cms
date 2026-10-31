/**
 * A value, or the HTTP outcome a page answers instead (story 206; in
 * `@crombolo/common` since story 210, so apps and packages share it).
 *
 * The site's own services return a `Result` so data code composes and its
 * failures are typed. A component ends the chain with `unwrap()`, which returns
 * the value or throws the outcome for the renderer to answer.
 * docs/rendering.md, "Server code".
 */

/** A redirect a page may answer with. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308

/** A refusal a page may answer with, rendered by the site's status pages. */
export type RefusalStatus = 400 | 401 | 403 | 404 | 410 | 422

export type OutcomeStatus = RedirectStatus | RefusalStatus

/** One input that failed validation. */
export interface FieldError {
  field: string
  message: string
}

/** The name each status goes by, as the helper that answers it. */
export const OUTCOME_NAMES: Readonly<Record<OutcomeStatus, string>> = {
  301: 'movedPermanentlyTo',
  302: 'foundAt',
  303: 'seeOther',
  307: 'redirect',
  308: 'permanentRedirect',
  400: 'badRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  410: 'gone',
  422: 'unprocessableContent',
}

const BRAND = Symbol.for('crombolo.outcome')

/**
 * Throws unless a redirect target is safe to put in a `Location` header: a path,
 * or an `http(s)` address. A protocol-relative address, another scheme such as
 * `javascript:`, or anything that would break the header is a template error.
 */
export function assertSafeLocation(url: string): string {
  if (typeof url !== 'string' || url.trim() === '')
    throw new Error('A redirect needs an address to send the visitor to.')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
  if (/[\u0000-\u001f\u007f]/.test(url))
    throw new Error(`Refused to redirect to ${JSON.stringify(url)}: it would break the header.`)
  const trimmed = url.trim()
  if (/^[/\\]{2}/.test(trimmed) || /^\/\\/.test(trimmed))
    throw new Error(
      `Refused to redirect to '${url}': an address starting '//' could lead to any site. Write the scheme, or a path.`,
    )
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https')
    throw new Error(
      `Refused to redirect to '${url}': only paths and http(s) addresses are allowed.`,
    )
  return trimmed
}

/** What every result can do, whichever side it is. */
interface ResultMethods<T, S extends OutcomeStatus> {
  isOk(): this is Ok<T>
  isOutcome(): this is Outcome<S>
  map<U>(f: (value: T) => U): Result<U, S>
  mapAsync<U>(f: (value: T) => Promise<U>): Promise<Result<U, S>>
  andThen<U, S2 extends OutcomeStatus = never>(f: (value: T) => Result<U, S2>): Result<U, S | S2>
  andThenAsync<U, S2 extends OutcomeStatus = never>(
    f: (value: T) => Promise<Result<U, S2>>,
  ): Promise<Result<U, S | S2>>
  match<R>(handlers: MatchHandlers<T, S, R>): R
  /** The value, or throws the outcome for the page to answer. */
  unwrap(): T
  unwrapOr<U>(fallback: U): T | U
}

/**
 * `match`'s handlers: `ok`, and either one per status the result can hold or
 * `outcome` for the rest.
 */
export type MatchHandlers<T, S extends OutcomeStatus, R> = { ok: (value: T) => R } & (
  | ({ [K in S]: (outcome: Outcome<K>) => R } & { outcome?: never })
  | ({ [K in S]?: (outcome: Outcome<K>) => R } & { outcome: (outcome: Outcome<S>) => R })
)

/** A value. */
export class Ok<T> implements ResultMethods<T, never> {
  readonly ok = true as const
  constructor(readonly value: T) {}
  isOk(): this is Ok<T> {
    return true
  }
  isOutcome(): this is Outcome<never> {
    return false
  }
  map<U>(f: (value: T) => U): Ok<U> {
    return new Ok(f(this.value))
  }
  async mapAsync<U>(f: (value: T) => Promise<U>): Promise<Ok<U>> {
    return new Ok(await f(this.value))
  }
  andThen<U, S2 extends OutcomeStatus = never>(f: (value: T) => Result<U, S2>): Result<U, S2> {
    return f(this.value)
  }
  andThenAsync<U, S2 extends OutcomeStatus = never>(
    f: (value: T) => Promise<Result<U, S2>>,
  ): Promise<Result<U, S2>> {
    return f(this.value)
  }
  match<R>(handlers: MatchHandlers<T, never, R>): R {
    return handlers.ok(this.value)
  }
  unwrap(): T {
    return this.value
  }
  unwrapOr<U>(_fallback: U): T {
    return this.value
  }
}

interface OutcomeInit {
  message?: string
  errors?: readonly FieldError[]
  location?: string
}

/**
 * An HTTP outcome in place of a value: a redirect, or a refusal the site's
 * status pages render. Built with `Outcome.notFound()` and its siblings; thrown
 * by `unwrap()` and by `@crombolo/crombolo/navigation`'s functions.
 */
export class Outcome<S extends OutcomeStatus = OutcomeStatus> implements ResultMethods<never, S> {
  readonly ok = false as const
  readonly [BRAND] = true
  /** The visitor-facing words for this case, shown by the status page. */
  readonly message: string | undefined
  /** Inputs that failed, for 400 and 422. */
  readonly errors: readonly FieldError[]
  /** Where a redirect sends the visitor. */
  readonly location: string | undefined

  private constructor(
    readonly status: S,
    init: OutcomeInit = {},
  ) {
    this.message = init.message
    this.errors = init.errors ?? []
    this.location = init.location
  }

  /** The helper's name for this status: `notFound`, `foundAt`. */
  get name(): string {
    return OUTCOME_NAMES[this.status]
  }

  get isRedirect(): boolean {
    return this.status < 400
  }

  isOk(): this is Ok<never> {
    return false
  }
  isOutcome(): this is Outcome<S> {
    return true
  }
  map<U>(_f: (value: never) => U): Outcome<S> {
    return this
  }
  async mapAsync<U>(_f: (value: never) => Promise<U>): Promise<Outcome<S>> {
    return this
  }
  andThen<U, S2 extends OutcomeStatus = never>(_f: (value: never) => Result<U, S2>): Outcome<S> {
    return this
  }
  async andThenAsync<U, S2 extends OutcomeStatus = never>(
    _f: (value: never) => Promise<Result<U, S2>>,
  ): Promise<Outcome<S>> {
    return this
  }
  match<R>(handlers: MatchHandlers<never, S, R>): R {
    const own = (handlers as Record<number, ((o: Outcome<S>) => R) | undefined>)[this.status]
    if (own) return own(this)
    return (handlers as { outcome: (o: Outcome<S>) => R }).outcome(this)
  }
  unwrap(): never {
    throw this
  }
  unwrapOr<U>(fallback: U): U {
    return fallback
  }

  /**
   * One by its status, as JSON carried it (story 219: an action's answer in the
   * browser). A redirect's location is checked as the redirect helpers check it.
   */
  static of<S extends OutcomeStatus>(status: S, init: OutcomeInit = {}): Outcome<S> {
    if (!(status in OUTCOME_NAMES)) throw new Error(`${status} is not an outcome's status.`)
    return new Outcome(status, {
      ...init,
      location: status < 400 ? assertSafeLocation(init.location ?? '') : undefined,
    })
  }
  /** 307: the visitor is sent on, keeping the request's method. */
  static redirect(url: string): Outcome<307> {
    return new Outcome(307, { location: assertSafeLocation(url) })
  }
  /** 308: the page has moved for good, keeping the request's method. */
  static permanentRedirect(url: string): Outcome<308> {
    return new Outcome(308, { location: assertSafeLocation(url) })
  }
  /** 302: the everyday redirect, as `umbracoRedirect` answers. */
  static foundAt(url: string): Outcome<302> {
    return new Outcome(302, { location: assertSafeLocation(url) })
  }
  /** 301: the page has moved for good. */
  static movedPermanentlyTo(url: string): Outcome<301> {
    return new Outcome(301, { location: assertSafeLocation(url) })
  }
  /** 303: after a POST, look at this address with a GET. */
  static seeOther(url: string): Outcome<303> {
    return new Outcome(303, { location: assertSafeLocation(url) })
  }
  static badRequest(message?: string, errors?: readonly FieldError[]): Outcome<400> {
    return new Outcome(400, { message, errors })
  }
  static unauthorized(message?: string): Outcome<401> {
    return new Outcome(401, { message })
  }
  static forbidden(message?: string): Outcome<403> {
    return new Outcome(403, { message })
  }
  static notFound(message?: string): Outcome<404> {
    return new Outcome(404, { message })
  }
  static gone(message?: string): Outcome<410> {
    return new Outcome(410, { message })
  }
  /** 422: well-formed input that failed validation. */
  static unprocessableContent(errors: readonly FieldError[], message?: string): Outcome<422> {
    return new Outcome(422, { message, errors })
  }
}

export type Result<T, S extends OutcomeStatus = OutcomeStatus> = Ok<T> | Outcome<S>

/** A value as a result. */
export function ok<T>(value: T): Ok<T> {
  return new Ok(value)
}

export function isOk<T, S extends OutcomeStatus>(result: Result<T, S>): result is Ok<T> {
  return result instanceof Ok
}

/** Whether a value, or something thrown, is an outcome; true across copies of this module. */
export function isOutcome(value: unknown): value is Outcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true
  )
}

type ValuesOf<R extends readonly Result<unknown, OutcomeStatus>[]> = {
  -readonly [K in keyof R]: R[K] extends Result<infer T, OutcomeStatus> ? T : never
}
type StatusesOf<R extends readonly Result<unknown, OutcomeStatus>[]> =
  R[number] extends Result<unknown, infer S> ? S : never

/** Every value, or the first outcome among them. */
function all<const R extends readonly Result<unknown, OutcomeStatus>[]>(
  results: R,
): Result<ValuesOf<R>, StatusesOf<R>> {
  const values: unknown[] = []
  for (const result of results) {
    if (!result.ok) return result as Outcome<StatusesOf<R>>
    values.push(result.value)
  }
  return new Ok(values as ValuesOf<R>)
}

export const Result = { ok, all, isOk, isOutcome }
