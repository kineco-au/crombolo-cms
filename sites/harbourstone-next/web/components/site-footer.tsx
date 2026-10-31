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
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          <Wordmark /> {values.address}
        </p>
        {values.footerNote ? <p>{values.footerNote}</p> : null}
      </div>
    </footer>
  )
}
