import { actionState } from '@crombolo/crombolo'
import * as bottlings from '#actions/bottlings.ts'

/**
 * A server action from a page (story 219): it posts without JavaScript and the
 * visitor is returned here, where `actionState` says how it went.
 */
export function RemindMe({ name }: { name: string }) {
  const state = actionState<{ email: string }>(bottlings.remindMe)
  if (state?.ok)
    return (
      <p class="mt-10 border-t border-line pt-8 font-display text-xl">
        We will tell {state.value?.email} when {name} is back.
      </p>
    )
  const problem = state?.errors?.find((error) => error.field === 'email')?.message
  return (
    <form class="mt-10 border-t border-line pt-8" action={bottlings.remindMe}>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex min-w-56 flex-1 flex-col gap-3 text-sm text-ink">
          Tell me when the next batch of {name} is out
          <input
            class="field"
            type="email"
            name="email"
            value={state?.values?.email ?? ''}
            required
          />
        </label>
        <button
          class="min-h-12 cursor-pointer bg-ink px-6 text-xs font-medium tracking-caps text-foam uppercase hover:bg-brass-deep motion-safe:transition-colors"
          type="submit"
        >
          Remind me
        </button>
      </div>
      {problem ? <p class="mt-2 text-sm text-wine">{problem}</p> : null}
    </form>
  )
}
