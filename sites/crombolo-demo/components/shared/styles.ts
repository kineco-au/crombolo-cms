/** Tailwind class lists more than one view shares. */

export const wrap = 'mx-auto w-full max-w-6xl px-5'

export const narrow = 'mx-auto w-full max-w-3xl px-5'

export const h1 = 'mb-3 font-serif text-4xl/tight font-bold text-balance md:text-5xl/tight'

export const eyebrow = 'mb-1 text-sm tracking-wider text-muted uppercase'

export const lead = 'text-xl/8 text-muted'

const button = 'inline-block cursor-pointer rounded px-5 py-2.5 no-underline transition-colors'

export const buttons = {
  primary: `${button} bg-green text-white hover:bg-green-deep`,
  quiet: `${button} text-green ring-1 ring-green ring-inset hover:bg-green/5`,
  light: `${button} bg-white text-green-deep hover:bg-cream`,
  outline: `${button} text-white ring-1 ring-white ring-inset hover:bg-white/10`,
}

export const chip =
  'rounded-full border border-line px-3 py-1 text-sm text-green no-underline transition-colors hover:border-green aria-[current=true]:border-green aria-[current=true]:bg-green aria-[current=true]:text-white'

export const filters = 'mt-2 mb-8 flex flex-wrap gap-2'

export const wideImage = 'my-6 w-full rounded'

/** Rich text and Markdown bodies, in the site's colours and type. */
export const prose = [
  'prose max-w-none',
  '[--tw-prose-body:var(--color-ink)] [--tw-prose-headings:var(--color-ink)] [--tw-prose-lead:var(--color-muted)]',
  '[--tw-prose-links:var(--color-green)] [--tw-prose-bold:var(--color-ink)] [--tw-prose-counters:var(--color-muted)]',
  '[--tw-prose-bullets:var(--color-muted)] [--tw-prose-hr:var(--color-line)] [--tw-prose-quotes:var(--color-ink)]',
  '[--tw-prose-quote-borders:var(--color-terracotta)] [--tw-prose-captions:var(--color-muted)] [--tw-prose-code:var(--color-ink)]',
  '[--tw-prose-pre-code:var(--color-ink)] [--tw-prose-pre-bg:var(--color-panel)] [--tw-prose-th-borders:var(--color-line)] [--tw-prose-td-borders:var(--color-line)]',
  'prose-headings:font-serif prose-h2:wrap-anywhere prose-a:underline-offset-2 prose-a:hover:text-terracotta',
  'prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-panel [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:box-decoration-clone [&_:not(pre)>code]:wrap-anywhere',
  'prose-pre:rounded prose-pre:border prose-pre:border-line',
  'prose-table:block prose-table:overflow-x-auto prose-table:text-sm prose-th:text-left prose-td:align-top',
].join(' ')
