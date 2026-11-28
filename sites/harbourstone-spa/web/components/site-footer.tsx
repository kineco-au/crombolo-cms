import { cms } from '@/lib/cms'
import { useLoad } from '@/lib/use-load'
import { Wordmark } from './site-header'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter() {
  const settings = useLoad('settings', () => cms.settings())
  return (
    <footer className="mt-20 border-t border-line text-sm text-muted">
      <div className="page-column flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-8 pb-12">
        <p>
          <Wordmark plain /> {settings?.properties.address}
        </p>
        {settings?.properties.footerNote ? <p>{settings.properties.footerNote}</p> : null}
      </div>
    </footer>
  )
}
