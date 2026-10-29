/**
 * The supported API for a server bundle's author (story 173): what a bundle's
 * factory returns, what its handlers are given, and the builder for tables of
 * its own. `docs/api.md`, and `docs/bundles.md` Part 3.
 *
 * A wired bundle is trusted code in the server process; this is a stability
 * boundary, not a sandbox.
 */

export {
  type RouteContext,
  type RouteHandler,
  type RouteMethod,
  type RouteOptions,
  route,
} from '@crombolo/common'
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
  BundleMethod,
  BundleRedirectInput,
  BundleRedirectRule,
  BundleRedirects,
  BundleRoute,
  BundleRouteContext,
  BundleSection,
  ExtensionSectionAlias,
  ImageLocation,
  Principal,
  ProviderOverrideInput,
  ServerBundle,
} from '@crombolo/server'
