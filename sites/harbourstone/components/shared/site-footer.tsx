import { usePage } from '@crombolo/crombolo'
import { Wordmark } from './site-header.tsx'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter() {
  const { settings } = usePage()
  const address = settings?.text('address')
  const note = settings?.text('footerNote')
  return (
    <footer class="site-footer">
      <div class="site-footer__inner">
        <p>
          <Wordmark /> {address}
        </p>
        {note ? <p>{note}</p> : null}
      </div>
    </footer>
  )
}
