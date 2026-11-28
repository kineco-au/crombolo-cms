import type { Navigation } from '@crombolo/crombolo'
import { repositoryUrl } from './site.tsx'
import { CONTAINER } from './styles.tsx'

export function SiteFooter({ nav }: { nav: Navigation }) {
  return (
    <footer class="bg-ink py-10 text-center text-arc">
      <div class={CONTAINER}>
        <p>Crombolo: the editing experience your team already knows, on a stack built for today.</p>
        <p class="mt-2 text-sm">
          Open source, built on the open-source Umbraco back office. ·{' '}
          <a class="underline underline-offset-2 hover:text-white" href={repositoryUrl(nav)}>
            Source on GitHub
          </a>
        </p>
      </div>
    </footer>
  )
}
