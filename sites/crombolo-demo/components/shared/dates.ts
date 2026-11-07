/** A stored date in the page's language, as words. */
export function formatDate(value: unknown, culture: string | null): string {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(culture ?? 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    date,
  )
}
