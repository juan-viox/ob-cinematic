'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PackageCheck, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { withBasePath } from '@/lib/url'

/**
 * A bar across every page while a paid order is still sitting untouched.
 *
 * Deliberately not a toast and deliberately not dismissible. A toast that
 * fades is exactly the thing somebody misses while they are on the phone,
 * and a dismiss button is a way to make the reminder go away without doing
 * anything about the order.
 *
 * There is no read flag behind this. It counts orders whose fulfillment
 * status is still 'new', so it clears when somebody actually moves an order
 * to Packing and not a moment sooner. That also makes it shared for free:
 * if Kari starts packing, it stops nagging Sarah, because the underlying
 * fact changed rather than a per-person flag.
 */
export default function OrderAlertBanner() {
  const [count, setCount] = useState(0)
  const [oldestHours, setOldestHours] = useState<number | null>(null)
  const supabase = createClient()

  const check = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at')
      .eq('fulfillment_status', 'new')
      .order('created_at', { ascending: true })
      .limit(50)

    if (error) return
    setCount(data?.length ?? 0)
    if (data?.length) {
      const oldest = new Date(data[0].created_at as string).getTime()
      setOldestHours(Math.floor((Date.now() - oldest) / 3_600_000))
    } else {
      setOldestHours(null)
    }
  }, [supabase])

  useEffect(() => { void check() }, [check])

  // A minute is frequent enough that nobody sits in front of a stale screen,
  // and rare enough to be invisible next to everything else the page does.
  useEffect(() => {
    const t = setInterval(() => void check(), 60_000)
    return () => clearInterval(t)
  }, [check])

  if (count === 0) return null

  // An order that has sat overnight is a different problem from one that
  // arrived while you were reading this, and should not look the same.
  const stale = oldestHours !== null && oldestHours >= 12

  return (
    <Link
      href={withBasePath('/orders')}
      className="flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      style={{
        background: stale ? 'var(--danger, #e17055)' : 'var(--accent, #6c5ce7)',
        color: '#fff',
      }}
    >
      <PackageCheck className="w-4 h-4 shrink-0" />
      <span>
        {count === 1 ? '1 paid order is' : `${count} paid orders are`} waiting to be packed
        {stale && oldestHours !== null && (
          <span style={{ opacity: 0.85 }}>
            {' '}· the oldest came in {oldestHours >= 48
              ? `${Math.floor(oldestHours / 24)} days ago`
              : `${oldestHours} hours ago`}
          </span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1 whitespace-nowrap" style={{ opacity: 0.9 }}>
        Open orders <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  )
}
