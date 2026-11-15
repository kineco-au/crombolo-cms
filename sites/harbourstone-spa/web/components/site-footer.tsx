import { cms } from '@/lib/cms'
import { useLoad } from '@/lib/use-load'
import { Wordmark } from './site-header'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter() {
  const settings = useLoad('settings', () => cms.settings())
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          <Wordmark /> {settings?.properties.address}
        </p>
        {settings?.properties.footerNote ? <p>{settings.properties.footerNote}</p> : null}
      </div>
    </footer>
  )
}
