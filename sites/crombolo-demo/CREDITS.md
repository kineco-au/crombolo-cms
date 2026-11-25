# Crombolo demo site — image credits

This site is distributed (`"distribute": true` in its `site.json`), so it is
staged into `@crombolo/cli`'s `templates/` when the CLI is packed, and every
image in it is **redistributed** to anyone who runs
`crombolo init --template demo/crombolo`. Each one therefore needs a recorded
source and licence, and `tests/packaging.test.ts` asserts that none is missing
from this file.

Every image but the logo is a screenshot of Crombolo itself, taken from this demo on
25 November 2026: the back office, the site, or the `crombolo` command line run
against it, each framed at 1,600 by 1,000 pixels. The names, answers and
workspace in them are invented for the demo, and the paths in the terminals are
shortened to `~/sites/`.

| File | What it shows | Licence | Made by |
| --- | --- | --- | --- |
| `content/media/workspace-editor.jpg` | A page open in the Spring launch workspace, the menu in its colour | MIT, as the rest of this repository | Kineco |
| `content/media/page-editor.jpg` | The page tree and a page open in the back office | MIT, as the rest of this repository | Kineco |
| `content/media/workspace-changes.jpg` | What the Spring launch workspace changed, page by page | MIT, as the rest of this repository | Kineco |
| `content/media/workspace-share.jpg` | Sharing the Spring launch workspace with a colleague | MIT, as the rest of this repository | Kineco |
| `content/media/workspace-merge.jpg` | Merging a workspace, keeping mine or theirs where a page changed on both sides | MIT, as the rest of this repository | Kineco |
| `content/media/workspace-menu.jpg` | The workspace switch at the top of Content, open | MIT, as the rest of this repository | Kineco |
| `content/media/block-editor.jpg` | A block of the home page open for editing | MIT, as the rest of this repository | Kineco |
| `content/media/page-history.jpg` | A page's history: each version, who saved it and when | MIT, as the rest of this repository | Kineco |
| `content/media/library-person.jpg` | A person kept in the Library | MIT, as the rest of this repository | Kineco |
| `content/media/translation-dictionary.jpg` | The dictionary under Translation, in English and Spanish | MIT, as the rest of this repository | Kineco |
| `content/media/form-entries.jpg` | Answers to the contact form, under Forms | MIT, as the rest of this repository | Kineco |
| `content/media/media-library.jpg` | The media library | MIT, as the rest of this repository | Kineco |
| `content/media/site-search.jpg` | The site's search results for workspace | MIT, as the rest of this repository | Kineco |
| `content/media/site-home.jpg` | This site's home page | MIT, as the rest of this repository | Kineco |
| `content/media/site-editors.jpg` | This site's page for editors, built from blocks | MIT, as the rest of this repository | Kineco |
| `content/media/preview-mode.jpg` | A page in preview mode, as visitors will see it before it is published | MIT, as the rest of this repository | Kineco |
| `content/media/publish-options.jpg` | The publish options beside Save and publish: schedule, publish with what is below, unpublish | MIT, as the rest of this repository | Kineco |
| `content/media/cli-status.jpg` | crombolo status in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/cli-profiles.jpg` | crombolo profile list, then a command on one site by its profile | MIT, as the rest of this repository | Kineco |
| `content/media/cli-help.jpg` | The topics crombolo --help lists | MIT, as the rest of this repository | Kineco |
| `content/media/cli-agents.jpg` | The AGENTS.md a new site comes with | MIT, as the rest of this repository | Kineco |
| `content/media/cli-workspaces.jpg` | crombolo workspaces and workspace diff in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/cli-events.jpg` | crombolo events status in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/cli-check.jpg` | crombolo workspace check rendering each changed page | MIT, as the rest of this repository | Kineco |
| `content/media/cli-deploy.jpg` | crombolo site deploy --help in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/cli-upgrade.jpg` | crombolo upgrade check in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/cli-changes.jpg` | crombolo changes and workspaces in a terminal | MIT, as the rest of this repository | Kineco |
| `content/media/crombolo-logo.png` | The Crombolo logo (`packages/backoffice-host/plugin/branding/logo-surface-dark.svg`) on the hero's green | MIT, as the rest of this repository | Kineco |
