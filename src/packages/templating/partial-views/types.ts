import type { UmbPartialViewEntityType, UmbPartialViewFolderEntityType } from './entity.js';

export type * from './tree/types.js';

export interface UmbPartialViewDetailModel {
	entityType: UmbPartialViewEntityType;
	unique: string;
	name: string;
	content: string;
	/** Crombolo: the file a new one is saved as; a component's `.tsx` when unset. */
	extension?: string;
}

export interface UmbPartialViewItemModel {
	entityType: UmbPartialViewEntityType | UmbPartialViewFolderEntityType;
	unique: string;
	parentUnique: string | null;
	name: string;
}
