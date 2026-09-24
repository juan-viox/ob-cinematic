'use client'

/**
 * What volume actually adds up to the number, and what it would cost to pack.
 *
 * A revenue goal is easy to say and hard to picture. "A million dollars" and
 * "twenty four gift boxes a day, every working day, with sixty of them in
 * November" are the same sentence, but only the second one tells you whether
 * to hire somebody or rent space.
 *
 * So this works in both directions at once. Move the drivers and the revenue
 * moves; the same numbers also produce the box count, the packing hours and
 * the people those hours need. The capacity half is the point. Demand is a
 * marketing problem and there are a hundred ways to attack it. Hands and
 * square footage are not, and they are what a plan usually runs out of first.
 *
 * Defaults are a mix that lands just past a million using the real catalogue:
 * shop boxes at 105 to 175, favors at 38, the bespoke program at 5000.
 *
 * Nothing here is saved to the database. The figures are one person's planning
 * scratchpad, not a record of the business, and the page says so rather than
 * implying the CRM now believes any of it.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCcw, Target } from 'lucide-react'

const STORE_KEY = 'ob-planner-v1'

interface Inputs {
  target: number

  corporateClients: number
  corporateAnnual: number

  retailOrdersPerMonth: number
  retailAov: number
  boxesPerRetailOrder: number

  eventsPerYear: number
  favorsPerEvent: number
  favorPrice: number

  agents: number
  closingsPerAgent: number
  realtorBoxPrice: number

  bespokePrograms: number
  bespokePrice: number

  avgBoxPrice: number
  minutesPerBox: number
  minutesPerFavor: number
  workingDays: number
  q4Share: number
  productiveHours: number

  grossMargin: number
  operatingCosts: number
}

const DEFAULTS: Inputs = {
  target: 1_000_000,

  corporateClients: 20,
  corporateAnnual: 25_000,

  retailOrdersPerMonth: 100,
  retailAov: 180,
  boxesPerRetailOrder: 1.3,

  eventsPerYear: 30,
  favorsPerEvent: 120,
  favorPrice: 38,

  agents: 40,
  closingsPerAgent: 20,
  realtorBoxPrice: 125,

  bespokePrograms: 10,
  bespokePrice: 5_000,

  avgBoxPrice: 135,
  minutesPerBox: 10,
  minutesPerFavor: 3,
  workingDays: 250,
  q4Share: 40,
  productiveHours: 6,

  grossMargin: 62,
  operatingCosts: 260_000,
}

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const count = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits })

export default function PlannerPage() {
  const [v, setV] = useState<Inputs>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  // Per browser, on purpose. See the file header.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY)
      if (raw) setV({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Inputs>) })
    } catch {
      // Private windows and blocked storage both land here. The defaults are fine.
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(v))
    } catch {
      // Nothing to do, and nothing worth interrupting the person over.
    }
  }, [v, loaded])

  const set = (key: keyof Inputs) => (n: number) => setV((prev) => ({ ...prev, [key]: n }))

  const m = useMemo(() => {
    const corporate = v.corporateClients * v.corporateAnnual
    const retail = v.retailOrdersPerMonth * 12 * v.retailAov
    const events = v.eventsPerYear * v.favorsPerEvent * v.favorPrice
    const realtor = v.agents * v.closingsPerAgent * v.realtorBoxPrice
    const bespoke = v.bespokePrograms * v.bespokePrice
    const total = corporate + retail + events + realtor + bespoke

    const safeBoxPrice = Math.max(1, v.avgBoxPrice)
    const boxes =
      corporate / safeBoxPrice +
      v.retailOrdersPerMonth * 12 * v.boxesPerRetailOrder +
      v.agents * v.closingsPerAgent +
      bespoke / safeBoxPrice
    const favors = v.eventsPerYear * v.favorsPerEvent

    const days = Math.max(1, v.workingDays)
    const minutes = boxes * v.minutesPerBox + favors * v.minutesPerFavor
    const hoursPerDay = minutes / 60 / days
    const boxesPerDay = boxes / days
    const people = Math.max(1, Math.ceil(hoursPerDay / Math.max(1, v.productiveHours)))

    // October through December is roughly 60 working days.
    const q4Boxes = (boxes * v.q4Share) / 100
    const q4PerDay = q4Boxes / 60

    const gross = (total * v.grossMargin) / 100
    const fees = total * 0.03
    const operating = gross - fees - v.operatingCosts

    return {
      corporate, retail, events, realtor, bespoke, total,
      boxes, favors, boxesPerDay, hoursPerDay, people, q4PerDay,
      gross, fees, operating,
    }
  }, [v])

  const pct = v.target > 0 ? (m.total / v.target) * 100 : 0
  const gap = v.target - m.total
  const onTarget = Math.abs(gap) < v.target * 0.02

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Revenue planner</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            What it takes to hit the number, and what it would take to pack it. Move anything and
            both halves follow.
          </p>
        </div>
        <button
          onClick={() => setV(DEFAULTS)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]/40 transition-colors"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      {/* The answer, before the inputs that produce it. */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Annual revenue</p>
            <p className="text-4xl font-semibold text-[var(--text)] mt-1 tabular-nums">
              {money(m.total)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Target</p>
            <div className="flex items-center gap-2 mt-1 justify-end">
              <span className="text-[var(--muted)]">$</span>
              <input
                id="planner-target"
                type="number"
                min={0}
                step={50_000}
                value={v.target}
                onChange={(e) => set('target')(Number(e.target.value) || 0)}
                className="w-36 px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-lg text-right tabular-nums text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, pct))}%`,
              background: onTarget
                ? 'var(--success, #00b894)'
                : gap > 0
                  ? 'var(--accent)'
                  : '#fdcb6e',
            }}
          />
        </div>
        <p className="text-sm text-[var(--muted)] mt-2 tabular-nums">
          {count(pct, 1)}% of target.{' '}
          {gap > 0
            ? `${money(gap)} short, which is ${money(gap / 12)} a month.`
            : gap < 0
              ? `${money(-gap)} past it.`
              : 'Exactly on it.'}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
          <Stat label="Corporate" value={money(m.corporate)} total={m.total} part={m.corporate} />
          <Stat label="Website" value={money(m.retail)} total={m.total} part={m.retail} />
          <Stat label="Favors" value={money(m.events)} total={m.total} part={m.events} />
          <Stat label="Realtors" value={money(m.realtor)} total={m.total} part={m.realtor} />
          <Stat label="Bespoke" value={money(m.bespoke)} total={m.total} part={m.bespoke} />
        </div>
      </div>

      {/* Capacity. The half that decides whether the plan is real. */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Target size={16} style={{ color: 'var(--accent)' }} />
          <h2 className="font-medium text-[var(--text)]">What that means in the workroom</h2>
        </div>
        <p className="text-xs text-[var(--muted)] mb-4">
          Demand can be attacked a hundred ways. Hands and hours cannot, and they are what a plan
          usually runs out of first.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Big label="Boxes a year" value={count(m.boxes)} note={`plus ${count(m.favors)} favors`} />
          <Big label="Boxes a day" value={count(m.boxesPerDay, 1)} note={`over ${count(v.workingDays)} working days`} />
          <Big label="Packing hours a day" value={count(m.hoursPerDay, 1)} note="before sourcing or shipping" />
          <Big
            label="People on production"
            value={count(m.people)}
            note={`at ${count(v.productiveHours)} productive hours each`}
          />
        </div>

        {m.q4PerDay > m.boxesPerDay * 1.2 && (
          <div
            className="mt-4 rounded-lg p-3 flex items-start gap-3"
            style={{ background: 'rgba(253,203,110,0.10)', border: '1px solid rgba(253,203,110,0.35)' }}
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: '#fdcb6e' }} />
            <p className="text-xs text-[var(--text)] leading-relaxed">
              <span className="font-medium">The year is not flat. </span>
              At {count(v.q4Share)}% of volume in the last quarter, October through December runs at
              about <span className="tabular-nums font-medium">{count(m.q4PerDay, 1)} boxes a day</span> against{' '}
              <span className="tabular-nums">{count(m.boxesPerDay, 1)}</span> on average. That peak is what you
              hire and rent space for, and the inventory for it is bought months before any of the
              money arrives.
            </p>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Corporate programs"
          note="One conversation produces fifty boxes instead of one. This is the half of the plan that makes the rest possible."
          revenue={m.corporate}
        >
          <Slider label="Clients" value={v.corporateClients} onChange={set('corporateClients')} min={0} max={100} step={1} />
          <Slider label="Average a year, each" value={v.corporateAnnual} onChange={set('corporateAnnual')} min={0} max={100_000} step={1_000} format={money} />
          <Hint>
            {count(v.corporateAnnual / Math.max(1, v.avgBoxPrice))} boxes a year per client at your{' '}
            {money(v.avgBoxPrice)} average.
          </Hint>
        </Card>

        <Card
          title="Website retail"
          note="The nicest revenue and the slowest to scale. Every order is its own packing job."
          revenue={m.retail}
        >
          <Slider label="Orders a month" value={v.retailOrdersPerMonth} onChange={set('retailOrdersPerMonth')} min={0} max={600} step={5} />
          <Slider label="Average order" value={v.retailAov} onChange={set('retailAov')} min={50} max={500} step={5} format={money} />
          <Slider label="Boxes per order" value={v.boxesPerRetailOrder} onChange={set('boxesPerRetailOrder')} min={1} max={4} step={0.1} format={(n) => count(n, 1)} />
          <Hint>
            {count((v.retailOrdersPerMonth * 12) / Math.max(1, v.workingDays), 1)} orders on an average
            working day.
          </Hint>
        </Card>

        <Card
          title="Events and favors"
          note="Favors are quicker to assemble than boxes, so they buy revenue without the same hit to capacity."
          revenue={m.events}
        >
          <Slider label="Events a year" value={v.eventsPerYear} onChange={set('eventsPerYear')} min={0} max={150} step={1} />
          <Slider label="Favors per event" value={v.favorsPerEvent} onChange={set('favorsPerEvent')} min={20} max={400} step={10} />
          <Slider label="Price each" value={v.favorPrice} onChange={set('favorPrice')} min={10} max={100} step={1} format={money} />
          <Hint>{money(v.favorsPerEvent * v.favorPrice)} per event.</Hint>
        </Card>

        <Card
          title="Realtor channel"
          note="Each agent is a small recurring account rather than one sale. They gift on a schedule you can forecast."
          revenue={m.realtor}
        >
          <Slider label="Agents" value={v.agents} onChange={set('agents')} min={0} max={200} step={1} />
          <Slider label="Closings each a year" value={v.closingsPerAgent} onChange={set('closingsPerAgent')} min={0} max={60} step={1} />
          <Slider label="Price a box" value={v.realtorBoxPrice} onChange={set('realtorBoxPrice')} min={50} max={300} step={5} format={money} />
          <Hint>{money(v.closingsPerAgent * v.realtorBoxPrice)} a year per agent.</Hint>
        </Card>

        <Card
          title="Bespoke programs"
          note="Your $5,000 tier. Few of them, and each one is design work as much as product."
          revenue={m.bespoke}
        >
          <Slider label="Programs a year" value={v.bespokePrograms} onChange={set('bespokePrograms')} min={0} max={50} step={1} />
          <Slider label="Price each" value={v.bespokePrice} onChange={set('bespokePrice')} min={1_000} max={25_000} step={500} format={money} />
        </Card>

        <Card title="Production assumptions" note="Change these when you have timed a real packing session." revenue={null}>
          <Slider label="Average box price" value={v.avgBoxPrice} onChange={set('avgBoxPrice')} min={50} max={400} step={5} format={money} />
          <Slider label="Minutes to pack a box" value={v.minutesPerBox} onChange={set('minutesPerBox')} min={2} max={40} step={1} />
          <Slider label="Minutes for a favor" value={v.minutesPerFavor} onChange={set('minutesPerFavor')} min={1} max={15} step={1} />
          <Slider label="Working days a year" value={v.workingDays} onChange={set('workingDays')} min={150} max={330} step={5} />
          <Slider label="Productive hours a person" value={v.productiveHours} onChange={set('productiveHours')} min={2} max={10} step={0.5} format={(n) => count(n, 1)} />
          <Slider label="Share of volume in Q4" value={v.q4Share} onChange={set('q4Share')} min={10} max={70} step={1} format={(n) => `${count(n)}%`} />
        </Card>
      </div>

      {/* What is left over, which is the number that actually matters. */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h2 className="font-medium text-[var(--text)] mb-1">What reaches you</h2>
        <p className="text-xs text-[var(--muted)] mb-4">
          Revenue is the headline. This is the part you live on.
        </p>

        <div className="space-y-2 mb-4">
          <Slider label="Gross margin" value={v.grossMargin} onChange={set('grossMargin')} min={30} max={80} step={1} format={(n) => `${count(n)}%`} />
          <Slider label="Operating costs a year" value={v.operatingCosts} onChange={set('operatingCosts')} min={0} max={800_000} step={10_000} format={money} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Big label="Revenue" value={money(m.total)} note="before anything" />
          <Big label="Gross profit" value={money(m.gross)} note={`at ${count(v.grossMargin)}% margin`} />
          <Big label="Payment fees" value={money(m.fees)} note="about 3% of everything" />
          <Big
            label="Operating profit"
            value={money(m.operating)}
            note="after staff, space and the rest"
            tone={m.operating > 0 ? 'good' : 'bad'}
          />
        </div>
      </div>

      <p className="text-xs text-[var(--muted)] leading-relaxed">
        These figures are a planning scratchpad, not a record of the business. They are kept in this
        browser only, so they do not follow you to another device and nothing else in the CRM reads
        them. Orders, invoices and reports still come from the database.
      </p>
    </div>
  )
}

function Stat({ label, value, part, total }: { label: string; value: string; part: number; total: number }) {
  const share = total > 0 ? (part / total) * 100 : 0
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="text-sm font-medium text-[var(--text)] mt-0.5 tabular-nums">{value}</p>
      <p className="text-[10px] text-[var(--muted)] tabular-nums">{count(share)}% of total</p>
    </div>
  )
}

function Big({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'good' | 'bad'
}) {
  const color =
    tone === 'good' ? 'var(--success, #00b894)' : tone === 'bad' ? 'var(--danger, #e17055)' : 'var(--text)'
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="text-2xl font-semibold mt-0.5 tabular-nums" style={{ color }}>
        {value}
      </p>
      {note && <p className="text-[11px] text-[var(--muted)] mt-0.5">{note}</p>}
    </div>
  )
}

function Card({
  title,
  note,
  revenue,
  children,
}: {
  title: string
  note: string
  revenue: number | null
  children: React.ReactNode
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-medium text-[var(--text)]">{title}</h2>
        {revenue !== null && (
          <span className="text-sm font-medium tabular-nums shrink-0" style={{ color: 'var(--accent)' }}>
            {money(revenue)}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">{note}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step: number
  format?: (n: number) => string
}) {
  const id = `planner-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label htmlFor={id} className="text-xs text-[var(--muted)]">
          {label}
        </label>
        <span className="text-sm font-medium text-[var(--text)] tabular-nums">
          {format ? format(value) : count(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-[var(--muted)] pt-1 tabular-nums">{children}</p>
}
