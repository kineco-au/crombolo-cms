/**
 * The migration chain. Append new migrations; never edit a released one.
 *
 * Every step here declares `release: '0.3.0'`, because 0.3.0 is the first release
 * there has ever been: nothing was published before the repository was split, so
 * none of these shipped in any earlier version, whatever the numbers said while
 * they were being written.
 *
 * `release` is compared between a contract and the expand it removes — a
 * contract may only take away what an *earlier* release added — and a contract
 * may only ship in a major (`x.0.0`), because every minor and patch is rolled
 * under live nodes. The first contract will therefore name 1.0.0 at the earliest.
 */

import { MigrationPlan } from '../migrations.ts'
import { approvalSchedulesMigration } from './approval-schedules.ts'
import { approvalsMigration } from './approvals.ts'
import { assistantMigration } from './assistant.ts'
import { auditLogMigration } from './audit-log.ts'
import { bundleComponentsMigration } from './bundle-components.ts'
import { bundleGrantDelegateMigration } from './bundle-grant-delegate.ts'
import { bundleGrantReachMigration } from './bundle-grant-reach.ts'
import { bundleGrantsMigration } from './bundle-grants.ts'
import { bundleKindMigration } from './bundle-kind.ts'
import { bundlePackageMigration } from './bundle-package.ts'
import { bundleSchemaPicksMigration } from './bundle-schema-picks.ts'
import { bundlesDisabledMigration } from './bundles-disabled.ts'
import { bundlesInSettingsMigration } from './bundles-in-settings.ts'
import { bundlesRenameMigration } from './bundles-rename.ts'
import { changeReportMigration } from './change-report.ts'
import { clientIdPrefixMigration } from './client-id-prefix.ts'
import { contentMigration } from './content.ts'
import { contentAppliedMigration } from './content-applied.ts'
import { contentCheckpointMigration } from './content-checkpoint.ts'
import { contentEditingMigration } from './content-editing.ts'
import { contentEventsMigration } from './content-events.ts'
import { contentNotificationsMigration } from './content-notifications.ts'
import { contentTypeSeoMigration } from './content-type-seo.ts'
import { createdPackagesMigration } from './created-packages.ts'
import { deliveryMemberTokensMigration } from './delivery-member-tokens.ts'
import { diagnosticsMigration } from './diagnostics.ts'
import { dropAssistantMigration } from './drop-assistant.ts'
import { elementsMigration } from './elements.ts'
import { extensionSettingsMigration } from './extension-settings.ts'
import { formLibraryMigration } from './form-library.ts'
import { formPermissionPrefixMigration } from './form-permission-prefix.ts'
import { formPermissionsMigration } from './form-permissions.ts'
import { formWorkflowsMigration } from './form-workflows.ts'
import { formsMigration } from './forms.ts'
import { groupPermissionsMigration } from './group-permissions.ts'
import { identityMigration } from './identity.ts'
import { imageAltTextMigration } from './image-alt-text.ts'
import { jobsMigration } from './jobs.ts'
import { logViewerMigration } from './log-viewer.ts'
import { mediaAccessMigration } from './media-access.ts'
import { mediaCacheMigration } from './media-cache.ts'
import { mediaMemberGrantsMigration } from './media-member-grants.ts'
import { mediaMemberUploadsMigration } from './media-member-uploads.ts'
import { mediaPermissionsMigration } from './media-permissions.ts'
import { mediaTreeOrderMigration } from './media-tree-order.ts'
import { memberPropertyTypeMigration } from './member-property-type.ts'
import { membersMigration } from './members.ts'
import { propertySearchableMigration } from './property-searchable.ts'
import { publicAccessMigration } from './public-access.ts'
import { recycleBinMigration } from './recycle-bin.ts'
import { redirectsMigration } from './redirects.ts'
import { remoteMigration } from './remote.ts'
import { remoteTrustMigration } from './remote-trust.ts'
import { richTextUiMigration } from './rich-text-ui.ts'
import { searchIndexMigration } from './search-index.ts'
import { searchRemovalsMigration } from './search-removals.ts'
import { serverRoleMigration } from './server-role.ts'
import { sinceVersionMigration } from './since-version.ts'
import { siteSearchMigration } from './site-search.ts'
import { siteSettingsTypesMigration } from './site-settings-types.ts'
import { transferAnswersMigration } from './transfer-answers.ts'
import { transferRunBundleTypeMigration } from './transfer-run-bundle-type.ts'
import { transferRunPackageMigration } from './transfer-run-package.ts'
import { transferRunsMigration } from './transfer-runs.ts'
import { trashedDateMigration } from './trashed-date.ts'
import { trustedSignersMigration } from './trusted-signers.ts'
import { twoFactorMigration } from './two-factor.ts'
import { upgradeReportMigration } from './upgrade-report.ts'
import { usersLocalisationMigration } from './users-localisation.ts'
import { valuesMigration } from './values.ts'
import { webhooksMigration } from './webhooks.ts'

export const cromboloPlan = new MigrationPlan([
  identityMigration,
  contentMigration,
  valuesMigration,
  sinceVersionMigration,
  upgradeReportMigration,
  recycleBinMigration,
  groupPermissionsMigration,
  memberPropertyTypeMigration,
  richTextUiMigration,
  contentEditingMigration,
  usersLocalisationMigration,
  logViewerMigration,
  membersMigration,
  publicAccessMigration,
  redirectsMigration,
  elementsMigration,
  assistantMigration,
  changeReportMigration,
  transferRunsMigration,
  clientIdPrefixMigration,
  serverRoleMigration,
  createdPackagesMigration,
  formsMigration,
  formWorkflowsMigration,
  formPermissionsMigration,
  formPermissionPrefixMigration,
  bundlesRenameMigration,
  bundleComponentsMigration,
  bundlePackageMigration,
  transferRunPackageMigration,
  searchIndexMigration,
  propertySearchableMigration,
  auditLogMigration,
  diagnosticsMigration,
  webhooksMigration,
  transferAnswersMigration,
  deliveryMemberTokensMigration,
  approvalsMigration,
  siteSearchMigration,
  twoFactorMigration,
  remoteMigration,
  trashedDateMigration,
  contentNotificationsMigration,
  approvalSchedulesMigration,
  mediaPermissionsMigration,
  contentEventsMigration,
  contentCheckpointMigration,
  dropAssistantMigration,
  contentAppliedMigration,
  mediaAccessMigration,
  mediaCacheMigration,
  mediaMemberUploadsMigration,
  mediaMemberGrantsMigration,
  bundleGrantsMigration,
  jobsMigration,
  bundlesDisabledMigration,
  siteSettingsTypesMigration,
  bundleSchemaPicksMigration,
  formLibraryMigration,
  bundlesInSettingsMigration,
  remoteTrustMigration,
  mediaTreeOrderMigration,
  searchRemovalsMigration,
  imageAltTextMigration,
  transferRunBundleTypeMigration,
  bundleGrantReachMigration,
  extensionSettingsMigration,
  bundleKindMigration,
  trustedSignersMigration,
  contentTypeSeoMigration,
  bundleGrantDelegateMigration,
])
