/**
 * A stored date in the page's language, as words. Only its day is read, so the
 * words are the same whatever time zone the server runs in.
 */
export function formatDate(value: unknown, culture: string | null): string {
  const day = (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10)
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(culture ?? 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    date,
  )
}
