/**
 * The holding page for a site with nothing published — Umbraco's "no nodes"
 * screen, which `docs/features.md` asks for — written as a one-page guide to
 * getting a first page out (story 236).
 *
 * It answers 404, not 200: a brand-new site is not a working one, and anything
 * watching the URL should keep saying so until a page is published. It is only
 * reached when the published tree is empty, so a missing path on a live site is
 * the bare 404 it always was.
 */
import { faviconSvg, logoDarkSvg, logoSvg } from '@crombolo/backoffice-host/branding'

const DOCS = 'https://github.com/kineco-au/crombolo-cms#getting-started'

export function noNodesPage(options: { siteName: string; backOfficePath: string }): string {
  const site = escapeHtml(options.siteName)
  const backoffice = escapeHtml(options.backOfficePath)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(faviconSvg)}">
<title>${site} — getting started</title>
<style>
  :root {
    color-scheme: light dark;
    --ink: #54321f; --muted: #7a5a47; --ground: #fff7ea; --panel: #fff; --line: #f0e2cf;
    --code: #fbefe0; --accent: #ad4f2c; --on-accent: #fff; --accent-hover: #9b4526; --deep: #cb6f48; --link: #ad4f2c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--ground); color: var(--ink);
  }
  a { color: var(--link); }
  header.bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 0; }
  header.bar svg { height: 2.1rem; width: auto; display: block; }
  .logo-dark { display: none; }
  header.bar .site { color: var(--muted); font-size: .9rem; }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  .hero {
    position: relative; overflow: hidden;
    background: var(--panel); border: 1px solid var(--line); border-radius: 18px;
    padding: 2.5rem 2.25rem; margin-bottom: 2rem;
    box-shadow: 0 1px 2px rgba(84, 50, 31, .06), 0 12px 32px -18px rgba(84, 50, 31, .25);
  }
  .hero > * { position: relative; z-index: 1; }
  .hero::after {
    content: ''; position: absolute; right: -4rem; top: -4rem; width: 14rem; height: 14rem;
    border-radius: 50%; background: var(--deep); opacity: .12;
  }
  .eyebrow { margin: 0 0 .4rem; color: var(--link); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; font-size: .8rem; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.4rem); line-height: 1.15; margin: 0 0 .75rem; letter-spacing: -.01em; }
  .lede { font-size: 1.1rem; color: var(--muted); margin: 0 0 1.5rem; max-width: 34rem; }
  a.cta {
    display: inline-block; padding: .7rem 1.25rem; border-radius: 999px;
    background: var(--accent); color: var(--on-accent); text-decoration: none; font-weight: 700;
  }
  a.cta:hover { background: var(--accent-hover); }
  a.cta:focus-visible { outline: 3px solid var(--deep); outline-offset: 2px; }
  details.setup > summary {
    display: inline-flex; align-items: center; gap: .5rem; cursor: pointer; list-style: none;
    padding: .55rem 1.1rem; border-radius: 999px; border: 1px solid var(--line);
    background: var(--panel); color: var(--link); font-weight: 600; margin-bottom: 1.25rem;
  }
  details.setup > summary::-webkit-details-marker { display: none; }
  details.setup > summary::before { content: '›'; display: inline-block; transition: transform .15s; font-size: 1.2em; line-height: 1; }
  details.setup[open] > summary::before { transform: rotate(90deg); }
  details.setup .when-open, details.setup[open] .when-closed { display: none; }
  details.setup[open] .when-open { display: inline; }
  details.setup > summary:focus-visible { outline: 3px solid var(--deep); outline-offset: 2px; }
  ol.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); }
  ol.steps > li {
    counter-increment: step; position: relative;
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 1.4rem 1.5rem 1.4rem 4.5rem;
  }
  ol.steps > li::before {
    content: counter(step); position: absolute; left: 1.4rem; top: 1.3rem;
    width: 2.1rem; height: 2.1rem; border-radius: 50%;
    background: var(--accent); color: var(--on-accent);
    display: grid; place-items: center; font-weight: 800;
  }
  h2 { font-size: 1.15rem; margin: 0 0 .4rem; }
  section.where { margin-top: 2rem; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 1.4rem 1.5rem; }
  p { margin: 0 0 .75rem; }
  li p:last-child { margin-bottom: 0; }
  pre { margin: .6rem 0 .8rem; padding: .85rem 1rem; background: var(--code); border: 1px solid var(--line); border-radius: 10px; overflow-x: auto; font-size: .86rem; line-height: 1.55; }
  code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; }
  p code, td code { background: var(--code); padding: .1em .4em; border-radius: 4px; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .55rem 0; border-top: 1px solid var(--line); vertical-align: top; }
  tr:first-child td { border-top: 0; }
  td:first-child { width: 12rem; padding-right: 1rem; }
  .fine { margin-top: 2rem; font-size: .85rem; color: var(--muted); text-align: center; }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f6ede4; --muted: #c9b5a5; --ground: #1f1813; --panel: #2a211b; --line: #3b2e25;
      --code: #342922; --accent: #da987c; --on-accent: #25160e; --accent-hover: #e2ae98; --deep: #cb6f48; --link: #e8a688;
    }
    .logo-light { display: none; }
    .logo-dark { display: block; }
    .hero { box-shadow: none; }
  }
  @media (max-width: 560px) {
    .hero { padding: 1.75rem 1.25rem; }
    .hero::after { width: 8rem; height: 8rem; right: -3rem; top: -3rem; }
    ol.steps > li { padding: 3.9rem 1.1rem 1.2rem; }
    td:first-child { width: auto; }
  }
</style>
</head>
<body>
<header class="bar">
  <span class="logo-light">${logoSvg}</span>
  <span class="logo-dark">${logoDarkSvg}</span>
  <span class="site">${site}</span>
</header>
<main>
  <section class="hero">
    <p class="eyebrow">${site} is running</p>
    <h1>Nothing is published yet</h1>
    <p class="lede">Visitors see this page until the site has one of its own.</p>
    <p><a class="cta" href="${backoffice}">Open the back office</a></p>
  </section>

  <details class="setup">
  <summary><span class="when-closed">Show how to set up your first page</span><span class="when-open">Hide the setup steps</span></summary>
  <ol class="steps">
    <li>
      <h2>Sign in</h2>
      <p>Open the back office at <code>${backoffice}</code>. On your own machine, <code>bun start</code> prints a username and password to sign in with, and a fresh password each time it starts. Set <code>CROMBOLO_ADMIN_PASSWORD</code> to keep the same one.</p>
    </li>
    <li>
      <h2>Configure page metadata</h2>
      <p>A content type says what a kind of page holds: a title, a summary, a body. Add one in the back office under <strong>Settings → Structure</strong>, or from the command line:</p>
      <pre><code>bunx crombolo types new content-type article --at-root
bunx crombolo types add-property article summary --type textarea</code></pre>
      <p>Either way it is saved as a file, <code>schema/content-types/article.toml</code>, so it travels with your code.</p>
    </li>
    <li>
      <h2>Write its template</h2>
      <p>A new content type comes with a template, <code>components/article.tsx</code>: a function from the page to JSX, rendered to HTML on the server.</p>
      <pre><code>import type { PageProps } from '@crombolo/crombolo'

export default function Article({ model }: PageProps) {
  return (
    &lt;html lang="en"&gt;
      &lt;body&gt;
        &lt;h1&gt;{model.text('title')}&lt;/h1&gt;
        &lt;p&gt;{model.text('summary')}&lt;/p&gt;
      &lt;/body&gt;
    &lt;/html&gt;
  )
}</code></pre>
      <p>Save the file and the next request renders it. There is nothing to rebuild.</p>
    </li>
    <li>
      <h2>Create and publish</h2>
      <p>In the back office, choose <strong>New content</strong> on the Overview, pick your content type, fill it in and press <strong>Save and publish</strong>. This page goes away and your site serves its own.</p>
    </li>
  </ol>

  <section class="where">
  <h2>Where things live</h2>
  <table>
    <tr><td><code>schema/</code></td><td>content types, data types and languages, as TOML files</td></tr>
    <tr><td><code>components/</code></td><td>templates and the components they share, as <code>.tsx</code></td></tr>
    <tr><td><code>seed/</code></td><td>starting pages and media, as files</td></tr>
    <tr><td><code>crombolo.config.ts</code></td><td>the site's settings: its name, its database, its addresses</td></tr>
  </table>
  </section>

  <p class="fine">More in the <a href="${DOCS}">getting started guide</a>. This page is served with a 404 because nothing is published, which is what a crawler should be told.</p>
  </details>
</main>
</body>
</html>
`
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
