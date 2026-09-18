/**
 * The gifting calendar's date rules, shared by the Occasions page, the
 * outreach worklist and the voice agent's "what is coming up" endpoint.
 *
 * Dates are calendar dates, not instants: everything here works in local
 * time on Date(y, m, d) values and serialises to YYYY-MM-DD.
 */

export type OccasionRule = 'fixed' | 'nth_weekday' | 'last_weekday' | 'last_full_week' | 'manual'

export interface OccasionRuleFields {
  rule: OccasionRule
  month?: number | null
  day?: number | null
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number | null
  nth?: number | null
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const OCCASION_CATEGORIES: Record<string, { label: string; color: string }> = {
  holiday: { label: 'Holiday', color: '#e17055' },
  business: { label: 'Business', color: '#6c5ce7' },
  personal: { label: 'Personal', color: '#fd79a8' },
  seasonal: { label: 'Seasonal', color: '#fdcb6e' },
  real_estate: { label: 'Real estate', color: '#00b894' },
  internal: { label: 'Internal deadline', color: '#8888a0' },
}

export const CLIENT_OCCASION_STATUSES: Record<string, { label: string; color: string; bg: string }> = {
  planned: { label: 'Planned', color: 'var(--muted)', bg: 'rgba(136,136,160,0.15)' },
  proposed: { label: 'Proposal sent', color: 'var(--accent-light)', bg: 'rgba(108,92,231,0.15)' },
  approved: { label: 'Approved', color: '#DAA520', bg: 'rgba(218,165,32,0.18)' },
  in_production: { label: 'In production', color: '#CD853F', bg: 'rgba(205,133,63,0.18)' },
  shipped: { label: 'Shipped', color: 'var(--info)', bg: 'rgba(116,185,255,0.15)' },
  delivered: { label: 'Delivered', color: 'var(--success)', bg: 'rgba(0,184,148,0.15)' },
  skipped: { label: 'Skipped', color: 'var(--muted)', bg: 'rgba(136,136,160,0.1)' },
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parses YYYY-MM-DD (or a longer ISO string) as a local calendar date. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() + days)
  return out
}

export function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

export function today(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

/**
 * The occasion's date in a given year, or null when the rule cannot produce
 * one (a manual occasion with no month/day is per-client: birthdays,
 * closings, anniversaries).
 */
export function occasionDateInYear(o: OccasionRuleFields, year: number): Date | null {
  const month = o.month ?? null
  if (!month) return null
  const m0 = month - 1

  switch (o.rule) {
    case 'fixed':
    case 'manual': {
      if (!o.day) return null
      const day = Math.min(o.day, daysInMonth(year, month))
      return new Date(year, m0, day)
    }
    case 'nth_weekday': {
      if (o.weekday === null || o.weekday === undefined || !o.nth) return null
      const first = new Date(year, m0, 1)
      const offset = (o.weekday - first.getDay() + 7) % 7
      const day = 1 + offset + (o.nth - 1) * 7
      if (day > daysInMonth(year, month)) return null
      return new Date(year, m0, day)
    }
    case 'last_weekday': {
      if (o.weekday === null || o.weekday === undefined) return null
      const last = new Date(year, month, 0)
      const offset = (last.getDay() - o.weekday + 7) % 7
      return new Date(year, m0, last.getDate() - offset)
    }
    case 'last_full_week': {
      // The <weekday> of the last Sunday-to-Saturday week wholly inside the month.
      if (o.weekday === null || o.weekday === undefined) return null
      const last = new Date(year, month, 0)
      const lastSaturday = last.getDate() - ((last.getDay() - 6 + 7) % 7)
      const weekSunday = lastSaturday - 6
      return new Date(year, m0, weekSunday + o.weekday)
    }
    default:
      return null
  }
}

/** The next occurrence on or after `from` (default: today). */
export function nextOccurrence(o: OccasionRuleFields, from: Date = today()): Date | null {
  const thisYear = occasionDateInYear(o, from.getFullYear())
  if (thisYear && thisYear.getTime() >= from.getTime()) return thisYear
  return occasionDateInYear(o, from.getFullYear() + 1)
}

/** Latest date a proposal can be approved and still ship in time. */
export function approveBy(date: Date, leadTimeDays: number): Date {
  return addDays(date, -Math.max(0, leadTimeDays))
}

/** When to start the conversation: two weeks before the approval deadline. */
export function reachOutBy(date: Date, leadTimeDays: number, buffer = 14): Date {
  return addDays(approveBy(date, leadTimeDays), -buffer)
}

/** "Second Sunday of May", "16 October", "Wednesday of the last full week of April". */
export function describeRule(o: OccasionRuleFields): string {
  const month = o.month ? MONTH_NAMES[o.month - 1] : ''
  const weekday = o.weekday !== null && o.weekday !== undefined ? WEEKDAY_NAMES[o.weekday] : ''
  switch (o.rule) {
    case 'fixed':
      return o.day && month ? `${o.day} ${month}` : 'Date set per client'
    case 'manual':
      return o.day && month ? `${o.day} ${month} (set by hand each year)` : 'Date set per client'
    case 'nth_weekday': {
      const ord = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth'][o.nth ?? 0] ?? ''
      return `${ord} ${weekday} of ${month}`.trim()
    }
    case 'last_weekday':
      return `Last ${weekday} of ${month}`
    case 'last_full_week':
      return `${weekday} of the last full week of ${month}`
    default:
      return ''
  }
}

export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }).format(d)
}

export function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
}
