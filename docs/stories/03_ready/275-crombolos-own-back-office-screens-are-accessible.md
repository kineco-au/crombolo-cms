# 275 — Crombolo's own back-office screens are accessible

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 235

## Story

As an editor using a keyboard or a screen reader, I want Crombolo's own
screens to work as well as Umbraco's, so that the parts of the back office
that are Crombolo's do not lock me out.

## Context

On Umbraco's roadmap ("Backoffice Accessibility Enhancements"), checked
2026-11-05: most WCAG findings from an external audit are fixed in 17 and
17.1, and the rest (keyboard movement, text spacing) are due in 2026. Those
arrive when the fork takes in Umbraco's newer client (story `235`). Crombolo's
own screens are not covered: Bundles, Workflows and its designer, Forms,
Redirects, the Settings cards, side panels, page sharing and preview as a
member, the overview and the setup screens.

## Acceptance criteria

- [ ] An automated check (axe) runs over each of Crombolo's screens in the
      browser suite and fails on serious findings.
- [ ] Every action on those screens can be reached and done by keyboard, with
      a visible focus, including dragging in the workflow designer and menus.
- [ ] Each control has an accessible name, and the colour contrast meets WCAG
      2.2 AA in the light and dark themes.
- [ ] Findings that cannot be fixed now are listed in `docs/backoffice-hosting.md`.
