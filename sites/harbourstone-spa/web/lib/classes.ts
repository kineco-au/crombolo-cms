/** Class lists more than one component shares, so the measure, the type and the controls stay one thing. */

/** The column every section's content sits in: the measure and the gutter. */
export const shell = 'mx-auto w-full max-w-6xl px-5 sm:px-8'

/** A heading in the display serif. Sizes are the component's. */
export const display = 'font-display font-medium tracking-tight text-balance'

/** The small letter-spaced capitals over headings, in the nav and on buttons. Colour is the caller's. */
export const caps = 'text-xs font-medium tracking-caps uppercase'

/** An outlined button or link that fills on hover; `light` sits on a photograph or the sea. */
export function button(tone?: 'light'): string {
  const base = `${caps} inline-flex min-h-11 cursor-pointer items-center border bg-transparent px-5 no-underline motion-safe:transition-colors`
  return tone === 'light'
    ? `${base} border-brass text-foam hover:bg-brass hover:text-ink`
    : `${base} border-ink text-ink hover:bg-ink hover:text-foam`
}

/** A text box, a list or a text area. */
export const field =
  'w-full rounded-none border border-line bg-card p-3 text-base text-ink outline-none focus-visible:border-brass aria-invalid:border-wine motion-safe:transition-colors'

/** A rich-text body as the editor wrote it: Tailwind's typography in the site's faces and colours. */
export const prose =
  'prose max-w-xl [--tw-prose-body:var(--color-muted)] [--tw-prose-bold:var(--color-ink)] [--tw-prose-bullets:var(--color-brass)] [--tw-prose-counters:var(--color-brass-deep)] [--tw-prose-headings:var(--color-ink)] [--tw-prose-links:var(--color-brass-deep)] [--tw-prose-quotes:var(--color-ink)] [--tw-prose-quote-borders:var(--color-line)] [--tw-prose-hr:var(--color-line)] prose-headings:font-display prose-headings:font-medium prose-headings:tracking-tight prose-h2:text-3xl prose-strong:font-medium'
