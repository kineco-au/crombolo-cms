/**
 * Crombolo's seams in the back office: the places Crombolo's plugin plugs in
 * behaviour of its own, set at start-up. Each is optional, and unset leaves
 * Umbraco's behaviour as it was. Kept to the seam itself, so the logic and its
 * tests stay with Crombolo and this fork stays small to rebase.
 */
export interface UmbCromboloViewEditor {
	/** The language monaco uses for the view. */
	language: string;
	/** Run before the editor is created, once per editor. */
	prepare?(): Promise<void>;
	/** Run once the editor exists, with monaco's editor. */
	created?(editor: unknown): void;
	/** Text inserted at the cursor, in the view's dialect. */
	insert?(text: string): string;
}

export interface UmbCromboloHooks {
	/** For a code editor in `language`: how a view is edited, or undefined to leave it as it is. */
	viewEditor?(language: string): UmbCromboloViewEditor | undefined;
	/** The content of a new template. */
	templateScaffold?(): string;
	/** The content of a new, empty partial view. */
	partialViewScaffold?(): Promise<string | undefined>;
	/** A template's content with its layout set to `alias`, or removed when null. */
	writeLayout?(content: string, alias: string | null): string;
	/** A snippet as a view written in the views' dialect would hold it. */
	translateSnippet?(snippet: string): string;
	/** The name of the views' dialect, as a code sample's label shows it. */
	viewLanguageLabel?: string;
	/** Hide the inserts a view in the views' dialect cannot take: partial views and sections. */
	hideRazorInserts?: boolean;
	/** An entity's editor is loading it; the returned function is called once it has. */
	onEntityLoad?(entityType: string, unique: string): (() => void) | undefined;
	/** Why a page's notifications cannot be chosen here, or undefined when they can. */
	notificationsUnavailable?(): Promise<string | undefined>;
}

export const umbCromboloHooks: UmbCromboloHooks = {};
