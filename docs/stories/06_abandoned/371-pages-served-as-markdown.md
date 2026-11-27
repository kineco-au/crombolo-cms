# 371 — Pages served as Markdown

**Epic:** O — Building a site · **Priority:** could · **Size:** M
**Depends on:** 370

## Story

As a site owner, I want some pages kept and served as Markdown, so that text meant for
tools rather than browsers, such as a guide for coding agents, is edited in the back
office like any other page and published at an address of its own.

## Context

- **What exists:** the `markdown` property preset (the Markdown editor), and site routes
  (story 211), which can answer with any text. A site can serve `/agents-guide.md` today
  from a route that reads a page's Markdown property, but it builds that by hand.
- **The first use:** 370's agents' guide. Its address is the deployer's setting
  (`remote.agentsGuide`); its text could be a page.
- **Related ideas:** a Markdown version of any page for agents and LLM tools, and a
  site-wide `llms.txt`.

## To decide when planned

- **How a page says it is Markdown:** a content type marked `format = "markdown"`, served
  as `text/markdown` at its route with no component, or a Markdown version beside every
  page (`/about.md` for `/about`), or both.
- **`llms.txt`:** in or out.
- **Caching, preview and links:** as HTML pages have them, or narrower.
- **Who may edit a guide for agents:** anyone who edits a page whose text a developer's
  agent reads is writing instructions for that agent. Page permissions apply, and a
  workflow can gate it; say so, and decide whether more is needed.

## Abandoned (2026-11-27)

Superseded by `450`, a content item served as a file. A Markdown page at an address of its
own, the agents' guide or `llms.txt`, is a file item whose name is its address
(`/agents-guide.md`) and whose text is its body, served as `text/markdown`. `450` carries
this story's question about who may edit text an agent reads as instructions, and names
`370`'s guide as its first use.

Not carried: a Markdown copy beside every HTML page (`/about.md` for `/about`). It is
derived from a page rather than an item of its own, so it would be a story of its own.
