import { usePage } from '@crombolo/crombolo'
import { SocialIcon } from './social-icon.tsx'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter({ siteName }: { siteName: string }) {
  const { settings } = usePage()
  const links = [
    { label: 'GitHub', url: settings?.text('repositoryUrl') },
    { label: 'Instagram', url: settings?.text('instagramUrl') },
    { label: 'X', url: settings?.text('xUrl') },
  ]
  return (
    <footer class="site-footer">
      <div class="wrap site-footer__inner">
        <div>
          <p class="wordmark">{siteName}</p>
          <p>{settings?.text('tagline')}</p>
        </div>
        <div>
          <p>{settings?.text('footerNote')}</p>
          <ul class="site-footer__links">
            {links.map(({ label, url }) => (
              <li>
                <SocialIcon name={label} url={url} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  )
}
