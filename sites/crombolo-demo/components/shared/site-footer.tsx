import { usePage } from '@crombolo/crombolo'
import { SocialIcon } from './social-icon.tsx'
import { wrap } from './styles.ts'

/** The footer, from the site's settings page, which editors change in Content. */
export function SiteFooter({ siteName }: { siteName: string }) {
  const { settings } = usePage()
  const links = [
    { label: 'GitHub', url: settings?.text('repositoryUrl') },
    { label: 'Instagram', url: settings?.text('instagramUrl') },
    { label: 'X', url: settings?.text('xUrl') },
  ]
  return (
    <footer class="bg-panel py-10">
      <div class={`${wrap} grid grid-cols-1 gap-8 sm:grid-cols-[1fr_auto]`}>
        <div>
          <p class="mb-1 font-serif text-xl font-bold">{siteName}</p>
          <p>{settings?.text('tagline')}</p>
        </div>
        <div>
          <p class="mb-2">{settings?.text('footerNote')}</p>
          <ul class="flex gap-4">
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
