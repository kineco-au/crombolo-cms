import { usePathname } from 'next/navigation'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { accessToken, signIn, signOut } from '@/lib/members'
import { Eyebrow, PageTitle, Standfirst } from './section-intro'

interface MemberState {
  /** Undefined until the app knows. */
  signedIn: boolean | undefined
  setSignedIn(signedIn: boolean): void
}

const Member = createContext<MemberState>({ signedIn: undefined, setSignedIn: () => undefined })

export const useMember = () => useContext(Member)

/** Whether a member is signed in in this tab: a token kept, renewed if it has run out. */
export function MemberProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean>()
  useEffect(() => {
    accessToken().then(
      (token) => setSignedIn(Boolean(token)),
      () => setSignedIn(false),
    )
  }, [])
  return <Member.Provider value={{ signedIn, setSignedIn }}>{children}</Member.Provider>
}

/** Sign in, or sign out, in the masthead. */
export function MemberButton() {
  const { signedIn } = useMember()
  const path = usePathname()
  if (signedIn === undefined) return null
  return (
    <button
      type="button"
      className="caps shrink-0 cursor-pointer text-muted hover:text-ink motion-safe:transition-colors"
      onClick={() => (signedIn ? signOut() : signIn(path))}
    >
      {signedIn ? 'Sign out' : 'Sign in'}
    </button>
  )
}

/** A members-only page, to someone not signed in, or signed in without access to it. */
export function MembersOnly({ refused }: { refused?: boolean }) {
  const path = usePathname()
  return (
    <header className="page-column pt-16 pb-6 md:pt-24">
      <Eyebrow>Members only</Eyebrow>
      <PageTitle>
        {refused ? 'This page is not open to your account.' : 'This page is for members.'}
      </PageTitle>
      <Standfirst>
        {refused ? 'It is kept for other members.' : 'Sign in with your member account to see it.'}
      </Standfirst>
      {refused ? null : (
        <button type="button" className="btn-ink mt-8" onClick={() => signIn(path)}>
          Sign in
        </button>
      )}
    </header>
  )
}
