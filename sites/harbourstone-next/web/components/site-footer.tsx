import { shell } from '@/lib/classes'
import { crombolo } from '@/lib/crombolo'
import { Wordmark } from './site-header'

/** The footer, from the site's settings page, which editors change in Content. */
export async function SiteFooter() {
  const settings = await crombolo.settings()
  const values = (settings?.properties ?? {}) as {
    address?: string | null
    footerNote?: string | null
  }
  return (
    <footer className="mt-20 border-t border-line text-sm text-muted">
      <div
        className={`${shell} flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-8 pb-12`}
      >
        <p>
          <Wordmark plain /> {values.address}
        </p>
        {values.footerNote ? <p>{values.footerNote}</p> : null}
      </div>
    </footer>
  )
}
