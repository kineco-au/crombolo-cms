/**
 * Cron expressions for job schedules (story 187): the standard five fields,
 * read in an IANA timezone, so "02:00 nightly" stays 02:00 local across
 * daylight saving. docs/rendering.md, "Background jobs".
 */

export interface Cron {
  readonly source: string
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** Both day fields restricted: either matching is enough, as cron has always read them. */
  eitherDay: boolean
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function field(
  text: string,
  name: string,
  min: number,
  max: number,
  names: readonly string[] = [],
  offset = 0,
): Set<number> {
  const out = new Set<number>()
  const value = (part: string) => {
    const named = names.indexOf(part.toLowerCase())
    const n = named >= 0 ? named + offset : Number(part)
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`the ${name} field's "${part}" is not from ${min} to ${max}`)
    return n
  }
  for (const item of text.split(',')) {
    const [range = '', stepText] = item.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`the ${name} field's step "${stepText}" is not a whole number from 1`)
    let from = min
    let to = max
    if (range !== '*') {
      const [a = '', b] = range.split('-')
      from = value(a)
      to = b === undefined ? (stepText === undefined ? from : max) : value(b)
      if (to < from) throw new Error(`the ${name} field's range "${range}" runs backwards`)
    }
    for (let n = from; n <= to; n += step) out.add(n)
  }
  return out
}

/** A cron expression, or an error saying what is wrong with it. */
export function parseCron(source: string): Cron {
  const parts = source.trim().split(/\s+/)
  if (parts.length !== 5)
    throw new Error(
      `"${source}" has ${parts.length} fields, not the five of minute, hour, day, month and weekday`,
    )
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string]
  const weekdays = field(weekday, 'weekday', 0, 7, WEEKDAYS)
  if (weekdays.delete(7)) weekdays.add(0)
  return {
    source,
    minutes: field(minute, 'minute', 0, 59),
    hours: field(hour, 'hour', 0, 23),
    days: field(day, 'day', 1, 31),
    months: field(month, 'month', 1, 12, MONTHS, 1),
    weekdays,
    eitherDay: day !== '*' && weekday !== '*',
  }
}

/** Whether `zone` is an IANA timezone this runtime knows. */
export function isTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock parts of an instant in a zone. */
function wallClock(at: Date, zone: string) {
  let format = formatters.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(zone, format)
  }
  const parts: Record<string, string> = {}
  for (const part of format.formatToParts(at)) parts[part.type] = part.value
  return {
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf((parts.weekday ?? '').slice(0, 3).toLowerCase()),
  }
}

const MINUTE = 60_000

/**
 * The first occurrence strictly after `after`, in `zone`. Walks an hour at a
 * time, and a minute at a time inside an hour that matches, so a yearly
 * schedule costs some thousands of steps rather than half a million.
 */
export function nextOccurrence(cron: Cron, zone: string, after: Date): Date {
  let at = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE
  // Four years and a day: long enough for a schedule that only falls on 29 February.
  const end = at + (4 * 366 + 1) * 24 * 60 * MINUTE
  while (at <= end) {
    const wall = wallClock(new Date(at), zone)
    const dayMatches = cron.eitherDay
      ? cron.days.has(wall.day) || cron.weekdays.has(wall.weekday)
      : cron.days.has(wall.day) && cron.weekdays.has(wall.weekday)
    if (!cron.months.has(wall.month) || !dayMatches || !cron.hours.has(wall.hour)) {
      at += (60 - wall.minute) * MINUTE
      continue
    }
    if (cron.minutes.has(wall.minute)) return new Date(at)
    at += MINUTE
  }
  throw new Error(`"${cron.source}" never falls due`)
}
