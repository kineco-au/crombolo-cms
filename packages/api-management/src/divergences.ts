/**
 * Operations that answer 501 on purpose, with the reason; `coverage:api` lists
 * them apart from what is still to build. docs/roadmap.md, "Deliberate divergence".
 */
const INSTALL =
  'There is no browser install wizard: `crombolo init` and schema-as-code stand a site up.'
const UPGRADE =
  'Upgrades run from the command line with `crombolo upgrade`, not from the backoffice.'

export const DELIBERATE_DIVERGENCES: Readonly<Record<string, string>> = {
  GetInstallSettings: INSTALL,
  PostInstallSetup: INSTALL,
  PostInstallValidateDatabase: INSTALL,
  GetUpgradeSettings: UPGRADE,
  PostUpgradeAuthorize: UPGRADE,
}

/** Areas still to build, by the story that builds them. */
export const PLANNED_AREAS: Readonly<Record<string, string>> = {}

/** Operations outside those areas that a story builds. */
export const PLANNED_OPERATIONS: Readonly<Record<string, string>> = {}

const MEDIA_VERBS =
  'Umbraco has no media verbs: the Media section alone lets a group change everything in it. Crombolo asks for `Crombolo.Media.Read` to open media and `Crombolo.Media.Update` to change it (story 088).'

/**
 * Operations that answer, but are authorized differently from Umbraco, with the
 * reason. docs/roadmap.md, "Deliberate divergence".
 */
export const AUTHORIZATION_DIVERGENCES: Readonly<Record<string, string>> = {
  GetMediaById: MEDIA_VERBS,
  GetCollectionMedia: MEDIA_VERBS,
  GetMediaByIdAuditLog: MEDIA_VERBS,
  GetRecycleBinMediaByIdOriginalParent: MEDIA_VERBS,
  PostMedia: MEDIA_VERBS,
  PostMediaValidate: MEDIA_VERBS,
  PutMediaById: MEDIA_VERBS,
  PutMediaByIdValidate: MEDIA_VERBS,
  DeleteMediaById: MEDIA_VERBS,
  PutMediaByIdMove: MEDIA_VERBS,
  PutMediaByIdMoveToRecycleBin: MEDIA_VERBS,
  PutMediaByIdSortChildren: MEDIA_VERBS,
  PutMediaSort: MEDIA_VERBS,
  PutMediaRootSortChildren: MEDIA_VERBS,
  DeleteRecycleBinMedia: MEDIA_VERBS,
  DeleteRecycleBinMediaById: MEDIA_VERBS,
  PutRecycleBinMediaByIdRestore: MEDIA_VERBS,
  PostRedirectManagementStatus:
    'Umbraco asks only for the Content section. Turning URL tracking on or off is a setting for the whole site, so crombolo asks for Settings; deleting one redirect still needs Content (story 088).',
}
