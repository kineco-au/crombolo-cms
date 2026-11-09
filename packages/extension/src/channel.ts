/**
 * The channel between the CMS and an extension's process (story 311): frames of
 * JSON, each prefixed with its length, over the process's standard input and
 * output. Runs on Bun and Deno alike, so both ends share it.
 *
 * Values that JSON cannot carry are tagged: dates, bytes, maps, errors,
 * responses and the `Result` a route may answer with. docs/extensions.md, "The
 * channel".
 */
import { Ok, Outcome } from '@crombolo/common'

/** The largest frame either end accepts: a body travels in chunks well below it. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024

/** The size of each chunk a body is streamed in. */
export const CHUNK_BYTES = 64 * 1024

export type Frame = Record<string, unknown> & { t: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** One frame as bytes: its length, big-endian, then its JSON. */
export function frameBytes(frame: Frame): Uint8Array {
  const body = encoder.encode(JSON.stringify(frame))
  if (body.length > MAX_FRAME_BYTES)
    throw new Error(`A frame of ${body.length} bytes is past the ${MAX_FRAME_BYTES} allowed.`)
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setUint32(0, body.length)
  out.set(body, 4)
  return out
}

/** Reads frames from a byte stream as they complete; ends when the stream does. */
export async function* readFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)
  for (;;) {
    while (buffer.length >= 4) {
      const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0)
      if (length > MAX_FRAME_BYTES)
        throw new Error(`A frame of ${length} bytes is past the ${MAX_FRAME_BYTES} allowed.`)
      if (buffer.length < 4 + length) break
      const frame = JSON.parse(decoder.decode(buffer.subarray(4, 4 + length))) as Frame
      buffer = buffer.slice(4 + length)
      yield frame
    }
    const { value, done } = await reader.read()
    if (done) return
    const joined = new Uint8Array(buffer.length + value.length)
    joined.set(buffer)
    joined.set(value, buffer.length)
    buffer = joined
  }
}

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** A function the other end may call, by its number in the call's table. */
export interface FnMarker {
  $fn: number
}

/** What `encode` hands back for the parts it cannot carry itself. */
export interface EncodeHooks {
  /** A function: its number, so the other end can call it. Absent, functions are dropped. */
  fn?(fn: (...args: unknown[]) => unknown): number
  /** An abort signal: its number, so the other end is told when it aborts. */
  signal?(signal: AbortSignal): number
  /** A value this end handles itself, such as an extension's database; undefined to carry on. */
  special?(value: unknown, key: string | undefined): unknown
}

const isPlain = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * A value as the channel carries it. Async, because a response's or a file's
 * body has to be read. Objects that are not plain keep their data and, with
 * `hooks.fn`, their methods, own or inherited, never `Object`'s.
 */
export async function encode(
  value: unknown,
  hooks: EncodeHooks = {},
  key?: string,
  seen = new Set<object>(),
): Promise<unknown> {
  const special = hooks.special?.(value, key)
  if (special !== undefined) return special
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') return hooks.fn ? { $fn: hooks.fn(value as never) } : undefined
    if (typeof value === 'bigint') return { $big: value.toString() }
    if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) }
    return value
  }
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (value instanceof Date) return { $date: value.toISOString() }
    if (value instanceof URL) return { $url: value.href }
    if (value instanceof Uint8Array) return { $bytes: toBase64(value) }
    if (value instanceof ArrayBuffer) return { $bytes: toBase64(new Uint8Array(value)) }
    if (ArrayBuffer.isView(value))
      return {
        $bytes: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      }
    if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal)
      return hooks.signal ? { $signal: hooks.signal(value), aborted: value.aborted } : undefined
    if (value instanceof Response)
      return {
        $response: {
          status: value.status,
          statusText: value.statusText,
          headers: [...value.headers],
          body: toBase64(new Uint8Array(await value.arrayBuffer())),
        },
      }
    if (value instanceof Request)
      return {
        $request: {
          url: value.url,
          method: value.method,
          headers: [...value.headers],
          body:
            value.method === 'GET' || value.method === 'HEAD'
              ? null
              : toBase64(new Uint8Array(await value.arrayBuffer())),
        },
      }
    if (typeof Blob !== 'undefined' && value instanceof Blob)
      return {
        $blob: {
          type: value.type,
          name: (value as Blob & { name?: string }).name,
          body: toBase64(new Uint8Array(await value.arrayBuffer())),
        },
      }
    if (value instanceof Map)
      return {
        $map: await Promise.all(
          [...value].map(async ([k, v]) => [
            await encode(k, hooks, undefined, seen),
            await encode(v, hooks, undefined, seen),
          ]),
        ),
      }
    if (value instanceof Set)
      return { $set: await Promise.all([...value].map((v) => encode(v, hooks, undefined, seen))) }
    if (value instanceof Error) return { $error: { name: value.name, message: value.message } }
    if (value instanceof Outcome)
      return {
        $outcome: {
          status: value.status,
          message: value.message,
          errors: value.errors,
          location: value.location,
        },
      }
    if (value instanceof Ok) return { $ok: await encode(value.value, hooks, undefined, seen) }
    if (Array.isArray(value))
      return Promise.all(value.map((v) => encode(v, hooks, undefined, seen)))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$')) continue
      const encoded = await encode(v, hooks, k, seen)
      if (encoded !== undefined) out[k] = encoded
    }
    // A capability built as a class keeps its methods: walked up to, never into, Object's.
    if (hooks.fn && !isPlain(value))
      for (
        let proto = Object.getPrototypeOf(value);
        proto && proto !== Object.prototype;
        proto = Object.getPrototypeOf(proto)
      )
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor' || name in out) continue
          if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value !== 'function') continue
          // Read through the object, so a capability wrapped to check its grant stays wrapped.
          const method = (value as Record<string, unknown>)[name]
          if (typeof method === 'function') out[name] = { $fn: hooks.fn(method.bind(value)) }
        }
    return out
  } finally {
    seen.delete(value)
  }
}

/** What `decode` asks this end to make of the markers the other end sent. */
export interface DecodeHooks {
  fn?(marker: number): (...args: unknown[]) => unknown
  signal?(marker: number, aborted: boolean): AbortSignal
  /** A tagged value this end owns, such as `$database` or `$incoming`; undefined to carry on. */
  special?(value: Record<string, unknown>): unknown
}

/** A value from the channel, with its tags made real again. */
export function decode(value: unknown, hooks: DecodeHooks = {}): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => decode(v, hooks))
  const tagged = value as Record<string, unknown>
  const special = hooks.special?.(tagged)
  if (special !== undefined) return special
  if ('$fn' in tagged) return hooks.fn?.(tagged.$fn as number)
  if ('$signal' in tagged)
    return (
      hooks.signal?.(tagged.$signal as number, tagged.aborted === true) ??
      new AbortController().signal
    )
  if ('$date' in tagged) return new Date(tagged.$date as string)
  if ('$url' in tagged) return new URL(tagged.$url as string)
  if ('$bytes' in tagged) return fromBase64(tagged.$bytes as string)
  if ('$big' in tagged) return BigInt(tagged.$big as string)
  if ('$num' in tagged) return Number(tagged.$num)
  if ('$map' in tagged)
    return new Map(
      (tagged.$map as [unknown, unknown][]).map(([k, v]) => [decode(k, hooks), decode(v, hooks)]),
    )
  if ('$set' in tagged) return new Set((tagged.$set as unknown[]).map((v) => decode(v, hooks)))
  if ('$error' in tagged) return errorFrom(tagged.$error as { name: string; message: string })
  if ('$outcome' in tagged) {
    const o = tagged.$outcome as {
      status: number
      message?: string
      errors?: { field: string; message: string }[]
      location?: string
    }
    return Outcome.of(o.status as never, {
      message: o.message,
      errors: o.errors,
      location: o.location,
    })
  }
  if ('$ok' in tagged) return new Ok(decode(tagged.$ok, hooks))
  if ('$response' in tagged) {
    const r = tagged.$response as {
      status: number
      statusText: string
      headers: [string, string][]
      body: string
    }
    const empty = r.status === 204 || r.status === 304 || (r.status >= 100 && r.status < 200)
    return new Response(empty ? null : (fromBase64(r.body) as BodyInit), {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
    })
  }
  if ('$request' in tagged) {
    const r = tagged.$request as {
      url: string
      method: string
      headers: [string, string][]
      body: string | null
    }
    return new Request(r.url, {
      method: r.method,
      headers: r.headers,
      body: r.body === null ? undefined : (fromBase64(r.body) as BodyInit),
    })
  }
  if ('$blob' in tagged) {
    const b = tagged.$blob as { type: string; name?: string; body: string }
    const bytes = fromBase64(b.body) as BlobPart
    return b.name !== undefined
      ? new File([bytes], b.name, { type: b.type })
      : new Blob([bytes], { type: b.type })
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(tagged)) out[k] = decode(v, hooks)
  return out
}

/** An error from the other end, its name kept so a caller can tell a refusal apart. */
export function errorFrom(error: { name: string; message: string }): Error {
  const made = new Error(error.message)
  made.name = error.name
  return made
}
