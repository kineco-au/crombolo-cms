import { UMB_CREATE_PARTIAL_VIEW_WORKSPACE_PATH_PATTERN } from '../../../paths.js';
import type { UmbPartialViewFolderEntityType, UmbPartialViewRootEntityType } from '../../../entity.js';
import { UmbEntityCreateOptionActionBase } from '@umbraco-cms/backoffice/entity-create-option-action';
import type { MetaEntityCreateOptionAction } from '@umbraco-cms/backoffice/entity-create-option-action';

/** Crombolo (story 292): opens the create page for a plain `.ts` file. */
export class UmbModulePartialViewCreateOptionAction extends UmbEntityCreateOptionActionBase<MetaEntityCreateOptionAction> {
	override async getHref() {
		const parentEntityType = this.args.entityType as UmbPartialViewRootEntityType | UmbPartialViewFolderEntityType;
		if (!parentEntityType) throw new Error('Entity type is required to create a module');

		const path = UMB_CREATE_PARTIAL_VIEW_WORKSPACE_PATH_PATTERN.generateAbsolute({
			parentEntityType,
			parentUnique: this.args.unique ?? null,
		});
		return `${path}/module`;
	}
}

export { UmbModulePartialViewCreateOptionAction as api };
