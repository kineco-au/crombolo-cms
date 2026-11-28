/**
 * Class lists more than one view shares. Plain strings with no imports, so the
 * walkthrough's client island can use them as the server views do.
 */

/** Rich text and Markdown bodies: Tailwind's typography, in the site's colours. */
export const PROSE = [
  'prose max-w-none',
  '[--tw-prose-body:var(--color-ink)] [--tw-prose-headings:var(--color-terracotta-text)]',
  '[--tw-prose-lead:var(--color-muted)] [--tw-prose-links:var(--color-terracotta-text)]',
  '[--tw-prose-bold:var(--color-ink)] [--tw-prose-counters:var(--color-muted)]',
  '[--tw-prose-bullets:var(--color-terracotta)] [--tw-prose-hr:var(--color-line)]',
  '[--tw-prose-quotes:var(--color-ink)] [--tw-prose-quote-borders:var(--color-terracotta)]',
  '[--tw-prose-captions:var(--color-muted)] [--tw-prose-code:var(--color-ink)]',
  '[--tw-prose-pre-code:var(--color-arc)] [--tw-prose-pre-bg:var(--color-ink)]',
  '[--tw-prose-th-borders:var(--color-line)] [--tw-prose-td-borders:var(--color-line)]',
  'prose-headings:font-medium prose-headings:tracking-tight prose-headings:scroll-mt-24',
  'prose-h3:text-ink prose-a:underline-offset-2 prose-pre:rounded-lg prose-pre:text-sm',
  'prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-arc [&_:not(pre)>code]:px-1',
  '[&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:[overflow-wrap:anywhere]',
  // A wide table scrolls inside the page rather than widening it on a phone.
  'prose-table:block prose-table:overflow-x-auto prose-table:text-sm prose-th:bg-white',
  '*:first:mt-0 *:last:mb-0',
].join(' ')

const BUTTON =
  'inline-block rounded-lg border-2 px-7 py-3 font-semibold transition hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0'

/** On terracotta or cocoa: white, outlined, or terracotta on a light ground. */
export const BUTTON_LIGHT = `${BUTTON} border-white bg-white text-terracotta-text`
export const BUTTON_OUTLINE = `${BUTTON} border-white text-white`
export const BUTTON_SOLID = `${BUTTON} border-terracotta-deep bg-terracotta-deep text-white`

export const CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6'
export const NARROW = 'mx-auto w-full max-w-3xl px-4 sm:px-6'

export const SECTION_HEADING =
  'mb-3 text-3xl font-medium tracking-tight text-terracotta-text text-balance md:text-4xl'
export const LEAD = 'mb-10 max-w-2xl text-lg text-muted'

export const CODE =
  'overflow-x-auto whitespace-pre rounded-lg bg-ink p-5 font-mono text-sm/relaxed text-arc'

/** The docs' search box, in the sidebar and on the search page. */
export const SEARCH_FORM = 'mb-5 flex gap-2'
export const SEARCH_INPUT =
  'min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-ink focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/30'
export const SEARCH_BUTTON =
  'cursor-pointer rounded-md bg-terracotta-deep px-3.5 py-2 font-semibold text-white hover:bg-terracotta-text'

export const LINK = 'text-terracotta-text underline-offset-2 hover:underline'
