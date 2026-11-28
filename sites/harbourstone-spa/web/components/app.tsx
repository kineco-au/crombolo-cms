'use client'
import { DeliveryError, type RouteAnswer } from '@crombolo/delivery-client'
import { usePathname } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { CMS } from '@/lib/address'
import { cms } from '@/lib/cms'
import type { DeliveryTypes } from '@/lib/cms-types.gen'
import { finishSignIn } from '@/lib/members'
import { leavePreview, previewToken, startPreview } from '@/lib/preview'
import { MemberProvider, MembersOnly, useMember } from './member'
import { CmsPage, NotFound } from './page'
import { PageTitle, Standfirst } from './section-intro'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

type Answer =
  | Exclude<RouteAnswer<DeliveryTypes>, { kind: 'redirect' }>
  | { kind: 'membersOnly' }
  | { kind: 'refused' }
  | { kind: 'failed' }

/** Where a redirect leads in the app: a path on the site stays in it, anywhere else is left for. */
function follow(location: string): void {
  const target = new URL(location, window.location.origin)
  if (target.origin === window.location.origin || target.origin === new URL(CMS).origin)
    history.replaceState(null, '', `${target.pathname}${target.search}${target.hash}`)
  else window.location.replace(target.href)
}

/** The page at an address: the site's route lookup answers what it is, and the app draws it. */
function CmsRoute({ path }: { path: string }) {
  const [shown, setShown] = useState<{ path: string; answer: Answer }>()
  useEffect(() => {
    let current = true
    cms.route(path, { seo: true }).then(
      (answer) => {
        if (!current) return
        if (answer.kind === 'redirect') {
          follow(answer.location)
          return
        }
        document.title =
          answer.kind === 'page'
            ? (answer.item.seo?.title ?? answer.item.name)
            : 'Page not found — Harbourstone'
        setShown({ path, answer })
      },
      (error: unknown) => {
        if (!current) return
        const status = error instanceof DeliveryError ? error.status : 0
        document.title = 'Harbourstone'
        setShown({
          path,
          answer: {
            kind: status === 401 ? 'membersOnly' : status === 403 ? 'refused' : 'failed',
          },
        })
      },
    )
    return () => {
      current = false
    }
  }, [path])
  // The last page stays while the next is read, as a page that loads in place should.
  if (!shown) return <Loading>Loading…</Loading>
  const { answer } = shown
  switch (answer.kind) {
    case 'page':
      return <CmsPage key={answer.item.id} page={answer.item} />
    case 'notFound':
      return <NotFound page={answer.item} />
    case 'membersOnly':
      return <MembersOnly />
    case 'refused':
      return <MembersOnly refused />
    default:
      return (
        <header className="page-column pt-16 pb-6 md:pt-24">
          <PageTitle>This page could not be loaded.</PageTitle>
          <Standfirst>Please try again in a moment.</Standfirst>
        </header>
      )
  }
}

/** What shows while a page is read: quiet, where the page will be. */
function Loading({ children }: { children: ReactNode }) {
  return <p className="page-column mt-16 text-muted">{children}</p>
}

/** `/signed-in`: where the site sends a member back to, to finish signing in. */
function SignedIn() {
  const { setSignedIn } = useMember()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    finishSignIn(location.search).then(
      (returnTo) => {
        setSignedIn(true)
        history.replaceState(null, '', returnTo)
      },
      () => setFailed(true),
    )
  }, [setSignedIn])
  return (
    <header className="page-column pt-16 pb-6 md:pt-24">
      <PageTitle>{failed ? 'You could not be signed in.' : 'Signing you in…'}</PageTitle>
      {failed ? <Standfirst>Please try signing in again.</Standfirst> : null}
    </header>
  )
}

/** `/preview?path=…&token=…`: where the CMS's Preview button opens a draft. */
function StartPreview({ onStart }: { onStart(): void }) {
  useEffect(() => {
    const query = new URLSearchParams(location.search)
    const token = query.get('token')
    const path = query.get('path') ?? '/'
    if (token) startPreview(token)
    onStart()
    history.replaceState(null, '', path.startsWith('/') ? path : '/')
  }, [onStart])
  return <Loading>Opening the preview…</Loading>
}

function PreviewBar() {
  const leave = () => {
    leavePreview()
    location.reload()
  }
  return (
    <aside
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-sea px-5 py-2.5 text-sm text-foam"
      aria-label="Preview"
    >
      <span>Previewing drafts: visitors do not see these changes yet.</span>
      <button
        type="button"
        className="cursor-pointer rounded-full border border-current px-3 py-0.5 hover:bg-foam hover:text-sea motion-safe:transition-colors"
        onClick={leave}
      >
        Leave preview
      </button>
    </aside>
  )
}

/**
 * The whole site, in the browser: one static page that reads whatever address it is
 * opened at, and every link after, from the site's APIs (story 347).
 */
export function App() {
  const path = usePathname()
  const [previewing, setPreviewing] = useState<boolean>()
  // Read once mounted: the built page is the same for every address, so nothing
  // that depends on the address or this tab is drawn before then.
  useEffect(() => setPreviewing(Boolean(previewToken())), [])
  const onStart = useCallback(() => setPreviewing(true), [])
  return (
    <MemberProvider>
      {previewing ? <PreviewBar /> : null}
      <SiteHeader />
      <main>
        {previewing === undefined ? null : path === '/signed-in' ? (
          <SignedIn />
        ) : path === '/preview' ? (
          <StartPreview onStart={onStart} />
        ) : (
          <CmsRoute path={path} />
        )}
      </main>
      <SiteFooter />
    </MemberProvider>
  )
}
