/**
 * When an approval request asked to publish or take its page down (story 029),
 * in the reader's own time, with the time zone named.
 */
const zone = () =>
  new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? ''

export const formatTime = (iso) =>
  `${new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ${zone()}`.trim()

/** "Publishes 3 Nov 2026, 09:00 AEDT", one phrase per time; empty when it asked for none. */
export function describeWhen(action, schedule) {
  if (!schedule) return ''
  return schedule
    .flatMap((e) => {
      const culture = e.culture ? ` (${e.culture})` : ''
      return [
        ...(action === 'publish' && e.publishTime
          ? [`Publishes ${formatTime(e.publishTime)}${culture}`]
          : []),
        ...(e.unpublishTime ? [`Comes down ${formatTime(e.unpublishTime)}${culture}`] : []),
      ]
    })
    .join(' · ')
}

/** A `datetime-local` input's value, read as the reader's local time, in ISO form; null when empty. */
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)
