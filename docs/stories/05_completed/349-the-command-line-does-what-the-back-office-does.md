# 349 — The command line does what the back office does

**Epic:** P — The command line · **Priority:** should · **Size:** XL (a survey, split into the stories below)
**Depends on:** —

## Story

As an operator or a developer scripting a site, I want to do from the CLI what a
person does in the back office, except where a screen is the point, so that no
routine job forces someone to sign in to a browser and click.

## Context

Surveyed 2026-11-15 against the back office's sections, its own screens
(`packages/backoffice-host/plugin/`) and the CLI reference (`docs/cli/commands.md`).

The CLI already covers most of it. Stories 247–257 made definitions, pages and
blocks editable from the command line, and 150–156, 160, 167 and 241 covered
people, operations, remotes and bundles. What is left is:

- recovery: history, rollback and the recycle bin;
- members;
- media already in the library;
- a few user and group fields;
- the less common data-type editors;
- **anything on a hosted site.** Today a hosted site is changed by pushing a
  bundle. Only `content find`, `audit list`, `extension *`, `site apply|revert|runs|deploy`
  and `restart` reach a remote directly.

### Already covered

| Back office | CLI |
| --- | --- |
| Pages: create, edit values and blocks, copy, move, sort, delete | `content new|update|show|copy|move|sort|delete`, `content block *` |
| Publish, unpublish, by culture, with descendants, scheduled | `content publish|unpublish --culture --descendants --at --until` |
| Finding pages; the Content section's list views | `content find` |
| Content, element, media and member types; tabs, properties, compositions | `types *`, `schema *` |
| Data types with the 13 common editors | `types new data-type --editor`, `types update --set` |
| Languages, dictionary, domains, page addresses | `languages *`, `dictionary *`, `domains *`, `site urls` |
| Forms and approval workflows (definitions) | `forms *`, `workflows *` |
| Webhooks, and what failed to go out | `webhooks *`, `events *` |
| User groups: sections, permissions, languages | `users groups *` |
| Users: invite, disable, enable, unlock, reset password and two-factor | `users *` |
| Audit log | `audit list|stream` |
| Health checks, search indexes, published cache | `health`, `index *`, `cache rebuild` |
| Changes dashboard, upgrade | `upgrade check|ledger|schema` |
| Bundles and extensions: install, grant, enable, settings, created bundles | `extension *`, `bundle *`, `site export --subtree` |
| Trusted signers, CI access | `keys *`, `remote trust *` |
| Model types (Umbraco's ModelsBuilder) | `generate` |
| Home and overview dashboards | `status`, `content find --updated-from`, `audit list` |

### The gap: to build

| # | Back office | Missing from the CLI | Proposed |
| --- | --- | --- | --- |
| G1 | A page's history: View all changes, roll back, keep a version | everything | `content history <page>`, `content history show <page> <version>` (with a diff against the current version), `content rollback <page> <version> [--culture]`, `content history keep <page> <version>` |
| G2 | Recycle bin: what is in it, restore | only `empty` | `recycle-bin list [--content|--media]`, `recycle-bin restore <item> [--to <parent>]` |
| G3 | Members section: members and member groups | everything (155 adds CSV only) | `members list|show|new|update|remove`, `members approve|lock|unlock|reset-password|reset-2fa`, `members groups list|new|remove`, `members groups add|leave <member> <group>` |
| G4 | Media already in the library | `media list|show|find`, and changing an item | `media list|show [--references]`, `media update <item> --name --alt --focal --file`, `media folder new` |
| G5 | Media permissions (story 204) | everything | `media access show|set <folder> --group --read|--change [--inherit]` |
| G6 | A page's public access: sign-in, no-access page, member groups | only through content files and `site apply` | `content access show|set|clear <page> --group --login-page --no-access-page` |
| G7 | A user's details | changing name, e-mail, groups, UI language; removing | `users update <user> --name --email --group --remove-group --ui-language`, `users remove` |
| G8 | Signed-in devices: listing and signing out a terminal | everything except `logout`, which signs out this terminal | `users sessions [<user>]`, `users sessions end <id>` (yours, or anyone's for an administrator) |
| G9 | A user group's content and media start nodes, its owners (302) | not on `users groups update` | `--start-at`, `--media-start-at`, `--owner` and `--remove-owner` on `users groups new|update` (start nodes kept with the database, as 162 settles) |
| G10 | Data types with the other editors: tags, colour, slider, multi-URL, upload, image cropper, Markdown, code, e-mail, checkbox and radio lists, member picker, multi-node tree picker, decimal, label | `--editor` knows 13 | the rest as presets in `DATA_TYPE_PRESETS`, so `types editors` lists them, plus a raw `--editor Umbraco.X` |
| G11 | Blueprints: create from a page, start a page from one | export only (`site export --with-blueprints`) | `content blueprint new <name> --from <page>`, `content blueprint list|remove`, `content new --blueprint <name>` |
| G12 | Background jobs dashboard (story 187): list, see why one failed, run again | `bundle runs`/`site runs` cover bundles only | `jobs list [--state] [--owner]`, `jobs show <id>`, `jobs retry <id>` |
| G13 | Search & sharing in Settings: site defaults, robots file, not-found page | only configuration | `seo show`, `seo set <field> <value>`, `seo unset <field>` (the same override the screen saves) |
| G14 | Library elements and menus | only content files and `site apply` | the `content` commands accept a Library path (`/Library/...`); `content menu add|move|remove` |
| G15 | What one extension did (story 327) | everything | `extension activity <id> [--kind] [--user] [-o csv]` |
| G16 | The references a page or media item has ("used by", before deleting) | everything | `--references` on `content show` and `media show` |

### The gap: already a story

| Back office | Story |
| --- | --- |
| Approvals: what is waiting, approve, send back, withdraw | `240`, after the sign-in in `350` |
| Form entries: read, approve, reject, delete, CSV | `243` |
| Redirects written in Settings | `154` |
| Members as CSV, and privacy requests | `155` |
| User and member groups as files | `162` |

### Left out, and why

| Back office | Why not |
| --- | --- |
| Editing views, partials, scripts and stylesheets | They are files: an editor does it better, and `components new` and `assets new` start them |
| Preview, preview as a member, app preview, a page's search preview, page sharing details | The point is to look at the page; `site check-code` and `content show` give what a script needs |
| View as a group (314) | It checks what the back office shows a group; `users groups show` lists what it may do |
| Notification subscriptions | One person's e-mail preferences, set where they read the e-mails |
| Your own profile: password, two-factor setup, avatar, theme, UI language | Personal and done in the browser; an administrator's resets already exist (`users reset-*`) |
| Log viewer | Operators read the host's logs; `audit`, `health` and `events` cover what the CMS itself knows |
| Telemetry, profiling, help and news dashboards | Nothing to act on |
| Marketplace | Searching npm does it; `extension install` takes the result |
| Segments on a page's values | Inert: no provider ships (`roadmap.md`); revisit with the first one |
| Relation types | Derived and read-only; G16 covers what a person uses them for |
| E-mail settings, Delivery API settings, sign-in providers (Entra) | Set by the site's configuration (`crombolo.config.ts`, environment); the screens show them, or edit a value that holds a secret |
| Edit conflicts, who else is editing (274), progress of a media job, "extensions changed", "behind the database" | Coordination between open browser tabs, not something a person does |
| Bulk selection, drag and drop in trees | `content find` piped into `move`, `sort`, `publish`, which take many items |

## Decisions needed before it splits

- **D1 — who a local command acts as.** A local command acts as "the command
  line", not a person. G3, G7 and G8 change people and are audited, and 240's
  approvals need a real person. 240 was held for exactly this. Options:
  - (a) keep local commands anonymous and audited as the command line, with
    approvals only on a remote, where there is a sign-in;
  - (b) `crombolo login` also works against a local site, and the audited
    commands require it.

  **Decided 2026-11-15: an access level the site sets (stories 350, 351).**
  `cliAccess` (`CROMBOLO_CLI_ACCESS`) is `open` or `sign-in`:
  - `open`, the default in development. Commands run without anyone signing in,
    and the audit log records them as "the command line", as today.
  - `sign-in`, the default when `NODE_ENV` is `production`. Every command that
    reads or changes the site's data needs a signed-in person, and acts as them.
    A production site may set `open`, and is warned at start.

  Some commands never need a sign-in: starting and recovery (`init`, `start`,
  `restart`, `upgrade`, `admin reset-password`), signing in itself, and the
  commands that only work with files and never open the database. An approval
  decision always needs a person, even at `open`.

  There are two ways to sign in:
  - the browser, through the running site, with any provider it offers. Commands
    then work with the server stopped;
  - a personal access token, where the site turns them on (`cliTokens`, off by
    default).

  None of this protects the site from whoever holds the database credentials.
  It names the person behind each change. The earlier choice that day, an
  optional local sign-in with no setting, was replaced by this one.
- **D2 — how far the CLI reaches a hosted site.** Today definitions go out as a
  bundle and nothing changes live content directly. Options:
  - (a) keep that, so G1–G16 are local only;
  - (b) the editorial and operational commands gain `--remote`, through the
    Management API, as the signed-in person. These are publish, unpublish,
    history and rollback, the recycle bin, members, users, jobs, access, form
    entries, approvals and redirects. Definitions (types, forms, workflows,
    webhooks) still travel only as bundles, so a hosted site's files stay the
    committed record.

  **Decided 2026-11-15: (b).** Most of the value is on a live site, since that is
  where recovery and member work happen. Each command in the list takes
  `--remote` and `--env`, as `content find` and `audit list` already do. Story
  352 renames `--remote` to `--profile`, so these are built as `--profile`. Through
  a remote, a command acts as the person signed in to it, with their permissions,
  and the audit log names them. A CI token is refused for anything that changes
  people or decides an approval (story 160).

## Proposed split

Built in this order, after 352 (profiles) and 350 (signing in):
1. G1 and G2, recovery: story `353`.
2. G3 and G6, members and page access: `354`, then `155`.
3. G4, G5 and G16, media already in the library: `355`.
4. G7, G8 and G9, users and groups: `356`.
5. G10, every data type editor: `357`.
6. G11–G15, each small and independent:
   - blueprints, `358`;
   - background jobs, `359`;
   - search and sharing settings, `360`;
   - Library elements and menus, `361`;
   - what an extension did, `362`.

## Acceptance criteria

- [x] D1 and D2 decided and recorded here
- [x] A story written for each group in "Proposed split", and its row added to the index
- [x] Epic P's introduction in `docs/stories/README.md` says what the CLI covers and points here for the rest
