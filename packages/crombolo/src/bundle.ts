/**
 * The supported API for a server bundle's author (story 173): what a bundle's
 * factory returns, what its handlers are given, and the builder for tables of
 * its own. `docs/api.md`, and `docs/bundles.md` Part 3.
 *
 * A wired bundle is trusted code in the server process; this is a stability
 * boundary, not a sandbox.
 */
export {
  assertBundleTables,
  type BundleStep,
  type BundleTables,
  type BundleTablesCapability,
  bundleTablesCompatibility,
  defineBundleTables,
  type TableHandle,
  type Where,
} from '@crombolo/data'
export type {
  AppAlias,
  BackofficeBundleRoute,
  BundleAudience,
  BundleCaller,
  BundleCapability,
  BundleDocuments,
  BundleEventHandler,
  BundleEvents,
  BundleForms,
  BundleHost,
  BundleIdentityProviders,
  BundleLog,
  BundleMedia,
  BundleMediaCreate,
  BundleMediaDeclaration,
  BundleMediaItem,
  BundleMediaMetadata,
  BundleMediaRefusal,
  BundleMediaUpdate,
  BundleMember,
  BundleMemberRequest,
  BundleMethod,
  BundlePublicRequest,
  BundleRateLimit,
  BundleRedirectInput,
  BundleRedirectRule,
  BundleRedirects,
  BundleRequest,
  BundleSection,
  ExtensionSectionAlias,
  ImageLocation,
  MemberBundleRoute,
  Principal,
  ProviderOverrideInput,
  PublicBundleRoute,
  ServerBundle,
  ServerBundleRoute,
} from '@crombolo/server'
