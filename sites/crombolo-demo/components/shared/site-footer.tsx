import { usePage } from '@crombolo/crombolo'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter({ siteName }: { siteName: string }) {
  const { settings, dictionary } = usePage()
  const repository = settings?.text('repositoryUrl')
  return (
    <footer class="site-footer">
      <div class="wrap site-footer__inner">
        <div>
          <p class="wordmark">{siteName}</p>
          <p>{settings?.text('tagline')}</p>
        </div>
        <div>
          <p>{settings?.text('footerNote')}</p>
          {repository ? <a href={repository}>{dictionary('footer.source')}</a> : null}
        </div>
      </div>
    </footer>
  )
}
