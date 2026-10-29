/**
 * The component stack of a template error (story 214): which components were
 * rendering when it was thrown, outermost first, `homePage › Layout › Card`.
 * Recorded only where error details are shown, by a tracker the JSX runtime
 * calls for each component.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { type Child, COMPONENT_TRACKER, isPromise } from './jsx-runtime.ts'

const STACK = Symbol.for('crombolo.componentStack')
const owners = new AsyncLocalStorage<readonly string[]>()

function tag(error: unknown, chain: readonly string[]): unknown {
  // The innermost component tags it first; the ones around it leave that alone.
  if (error !== null && typeof error === 'object' && !(STACK in error))
    Object.defineProperty(error, STACK, { value: chain })
  return error
}

/** Runs a component's render with its name on the stack, tagging what it throws. */
export function trackComponent<T>(name: string, call: () => T): T {
  if (!tracking()) return call()
  const chain = [...(owners.getStore() ?? []), name]
  try {
    const result = owners.run(chain, call)
    return (
      isPromise(result)
        ? (result as Promise<unknown>).then(undefined, (error: unknown) => {
            throw tag(error, chain)
          })
        : result
    ) as T
  } catch (error) {
    throw tag(error, chain)
  }
}

/** Starts recording component stacks in this process. */
export function enableComponentStack(): void {
  ;(globalThis as Record<symbol, unknown>)[COMPONENT_TRACKER] = (name: string, call: () => Child) =>
    trackComponent(name, call)
}

function tracking(): boolean {
  return (globalThis as Record<symbol, unknown>)[COMPONENT_TRACKER] !== undefined
}

/** The components that were rendering when this was thrown, outermost first. */
export function componentStackOf(error: unknown): readonly string[] | undefined {
  return error !== null && typeof error === 'object'
    ? ((error as Record<symbol, unknown>)[STACK] as readonly string[] | undefined)
    : undefined
}
