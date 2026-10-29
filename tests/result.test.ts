/**
 * Story 206: `Result`, the outcomes it carries, and the navigation functions
 * that throw them. Pure; the pages that answer them are in page-logic.test.tsx.
 */
import { describe, expect, test } from 'bun:test'
import {
  badRequest,
  forbidden,
  foundAt,
  gone,
  movedPermanentlyTo,
  notFound,
  permanentRedirect,
  redirect,
  rethrow,
  seeOther,
  unauthorized,
  unprocessableContent,
} from '@crombolo/crombolo/navigation'
import {
  assertSafeLocation,
  isOk,
  isOutcome,
  Ok,
  Outcome,
  ok,
  Result,
} from '@crombolo/crombolo/server'

const thrown = (f: () => unknown): unknown => {
  try {
    f()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('Result', () => {
  const found = (id: number): Result<{ id: number }, 404> =>
    id > 0 ? ok({ id }) : Outcome.notFound(`No record ${id}`)

  test('map and andThen carry a value through and pass an outcome by', () => {
    const doubled = found(2).map((r) => r.id * 2)
    expect(doubled.unwrap()).toBe(4)
    const chained = found(2).andThen((r) => (r.id > 5 ? ok(r) : Outcome.forbidden()))
    expect(chained.ok).toBe(false)
    expect(chained.isOutcome() && chained.status).toBe(403)
    const missing = found(0).map(() => 'never')
    expect(missing.isOutcome() && missing.message).toBe('No record 0')
  })

  test('the async forms await their step', async () => {
    expect((await found(3).mapAsync(async (r) => r.id + 1)).unwrap()).toBe(4)
    expect((await found(3).andThenAsync(async (r) => ok(`#${r.id}`))).unwrap()).toBe('#3')
    expect((await found(0).andThenAsync(async () => ok(1))).ok).toBe(false)
  })

  test('match calls the handler for the status, or outcome for the rest', () => {
    const label = (r: Result<{ id: number }, 404>) =>
      r.match({ ok: (v) => `ok ${v.id}`, 404: (o) => `missing: ${o.message}` })
    expect(label(found(1))).toBe('ok 1')
    expect(label(found(0))).toBe('missing: No record 0')
    const either: Result<number, 403 | 404> = Outcome.forbidden('no')
    expect(either.match({ ok: () => 'ok', outcome: (o) => o.name })).toBe('forbidden')
  })

  test('unwrap throws the outcome itself; unwrapOr gives the fallback', () => {
    const outcome = thrown(() => found(0).unwrap())
    expect(isOutcome(outcome)).toBe(true)
    expect((outcome as Outcome).status).toBe(404)
    expect(found(0).unwrapOr(null)).toBeNull()
    expect(found(1).unwrapOr(null)).toEqual({ id: 1 })
  })

  test('Result.all gives every value, or the first outcome', () => {
    const both = Result.all([ok(1), ok('two')])
    expect(both.unwrap()).toEqual([1, 'two'])
    const first = Result.all([ok(1), Outcome.gone('old'), Outcome.notFound()])
    expect(first.isOutcome() && first.status).toBe(410)
    expect(isOk(ok(1))).toBe(true)
    expect(ok(1)).toBeInstanceOf(Ok)
  })

  test('each constructor carries its status, name and what it was given', () => {
    const errors = [{ field: 'email', message: 'Enter an e-mail address' }]
    expect(Outcome.unprocessableContent(errors)).toMatchObject({ status: 422, errors })
    expect(Outcome.badRequest('Bad', errors)).toMatchObject({ status: 400, message: 'Bad' })
    expect(Outcome.unauthorized().name).toBe('unauthorized')
    expect(Outcome.foundAt('/a')).toMatchObject({ status: 302, location: '/a', isRedirect: true })
    expect(Outcome.notFound().isRedirect).toBe(false)
  })
})

describe('redirect targets', () => {
  test('paths and http(s) addresses are allowed', () => {
    expect(assertSafeLocation('/sign-in?return=/x')).toBe('/sign-in?return=/x')
    expect(assertSafeLocation('https://example.com/a')).toBe('https://example.com/a')
    expect(assertSafeLocation('next')).toBe('next')
  })

  test('protocol-relative, other schemes and header breakers are template errors', () => {
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/a\r\nset-cookie: x=1',
      '',
    ])
      expect(() => redirect(bad), JSON.stringify(bad)).toThrow(Error)
    expect(isOutcome(thrown(() => redirect('//evil.example')))).toBe(false)
  })
})

describe('the navigation functions', () => {
  test('each throws the outcome for its status', () => {
    const cases: Array<[() => never, number]> = [
      [() => redirect('/a'), 307],
      [() => permanentRedirect('/a'), 308],
      [() => foundAt('/a'), 302],
      [() => movedPermanentlyTo('/a'), 301],
      [() => seeOther('/a'), 303],
      [() => badRequest('no'), 400],
      [() => unauthorized(), 401],
      [() => forbidden(), 403],
      [() => notFound('gone missing'), 404],
      [() => gone(), 410],
      [() => unprocessableContent([{ field: 'a', message: 'b' }]), 422],
    ]
    for (const [call, status] of cases) {
      const outcome = thrown(call)
      expect(isOutcome(outcome)).toBe(true)
      expect<number>((outcome as Outcome).status).toBe(status)
    }
    expect((thrown(() => notFound('gone missing')) as Outcome).message).toBe('gone missing')
  })

  test('rethrow passes outcomes through and returns for anything else', () => {
    expect(() => rethrow(new Error('mine'))).not.toThrow()
    expect(() => rethrow('x')).not.toThrow()
    const outcome = Outcome.notFound()
    expect(thrown(() => rethrow(outcome))).toBe(outcome)
  })
})
