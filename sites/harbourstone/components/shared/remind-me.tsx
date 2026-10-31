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
      <p class="remind-me">
        We will tell {state.value?.email} when {name} is back.
      </p>
    )
  const problem = state?.errors?.find((error) => error.field === 'email')?.message
  return (
    <form class="remind-me" action={bottlings.remindMe}>
      <label>
        Tell me when the next batch of {name} is out
        <input type="email" name="email" value={state?.values?.email ?? ''} required />
      </label>
      {problem ? <p class="remind-me__problem">{problem}</p> : null}
      <button type="submit">Remind me</button>
    </form>
  )
}
