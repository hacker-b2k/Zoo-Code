/**
 * Virtual Spec Documents foundation (F-001) + minimal UI (F-002).
 * No agent tools in this package area yet (F-004).
 */

export { SpecService } from "./SpecService"
export { SpecStore } from "./SpecStore"
export {
	getSpecServiceForTask,
	getSpecWorkspaceRoot,
	resolveSpecId,
	resolveExistingSpecIdSoft,
} from "./getSpecServiceForTask"
export {
	hashWorkspaceRoot,
	normalizeWorkspaceRoot,
	normalizeFsPath,
	relativePathInsideWorkspace,
	isPathInsideWorkspace,
	assertSafeId,
	assertSafeDocFileName,
	assertPathInsideBase,
	coerceOptionalSpecId,
	isTruncatedDisplaySpecId,
	truncatedSpecIdErrorMessage,
} from "./paths"
export { getSpecContextSection, invalidateSpecContextCache, formatSpecContextBlock } from "./specContext"
export type {
	SpecDocKind,
	SpecStage,
	SpecDocument,
	SpecWorkspace,
	SpecWorkspaceMeta,
	SpecWorkspaceIndex,
	SpecWorkspaceIndexEntry,
	CreateSpecWorkspaceInput,
	WriteSpecDocumentInput,
	SpecDocumentWithContent,
} from "./types"
export { SPEC_SCHEMA_VERSION, STARTER_SPEC_DOCS } from "./types"
export {
	SpecWorkspacePanel,
	saveLastOpened,
	loadLastOpened,
	clearLastOpened,
	lastOpenedStateKey,
	SPEC_UI_STATE_KEY_PREFIX,
	buildSpecWorkspaceHtml,
} from "./ui"
export type { SpecUiLastOpened } from "./ui"
