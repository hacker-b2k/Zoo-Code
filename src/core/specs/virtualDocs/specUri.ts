import * as path from "path"
import * as vscode from "vscode"

import { assertSafeId, hashWorkspaceRoot, normalizeWorkspaceRoot } from "../paths"

export const SPEC_DOCUMENT_SCHEME = "zoo-spec"
export type SpecDocumentRevision = "current" | number

export interface SpecDocumentUriIdentity {
	workspaceRoot: string
	workspaceRootHash: string
	specId: string
	docId: string
	revision: SpecDocumentRevision
}

function encodeRoot(root: string): string {
	return Buffer.from(root, "utf8").toString("base64url")
}

function decodeRoot(encoded: string): string {
	try {
		return Buffer.from(encoded, "base64url").toString("utf8")
	} catch {
		throw new Error("Invalid zoo-spec workspace root encoding")
	}
}

export function buildSpecDocumentUri(input: {
	workspaceRoot: string
	specId: string
	docId: string
	revision?: SpecDocumentRevision
}): vscode.Uri {
	assertSafeId(input.specId, "specId")
	assertSafeId(input.docId, "docId")
	const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot)
	const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
	const revision = input.revision ?? "current"
	if (revision !== "current" && (!Number.isInteger(revision) || revision < 1)) {
		throw new Error(`Invalid revision: ${revision}`)
	}
	const query = new URLSearchParams({ root: encodeRoot(workspaceRoot), rev: String(revision) }).toString()
	return vscode.Uri.parse(`${SPEC_DOCUMENT_SCHEME}://${workspaceRootHash}/${input.specId}/${input.docId}.md?${query}`)
}

export function parseSpecDocumentUri(uri: vscode.Uri): SpecDocumentUriIdentity {
	if (uri.scheme !== SPEC_DOCUMENT_SCHEME) throw new Error(`Invalid scheme: ${uri.scheme}`)
	assertSafeId(uri.authority, "workspaceRootHash")
	const segments = uri.path.split("/").filter(Boolean)
	if (segments.length !== 2) throw new Error("Invalid zoo-spec path")
	const specId = segments[0]
	const fileName = segments[1]
	if (!fileName.endsWith(".md")) throw new Error("zoo-spec documents must be markdown")
	const docId = fileName.slice(0, -3)
	assertSafeId(specId, "specId")
	assertSafeId(docId, "docId")

	const params = new URLSearchParams(uri.query)
	const workspaceRoot = normalizeWorkspaceRoot(decodeRoot(params.get("root") ?? ""))
	const workspaceRootHash = hashWorkspaceRoot(workspaceRoot)
	if (workspaceRootHash !== uri.authority) throw new Error("zoo-spec workspace hash mismatch")
	const rawRevision = params.get("rev") ?? "current"
	const revision: SpecDocumentRevision = rawRevision === "current" ? "current" : Number(rawRevision)
	if (revision !== "current" && (!Number.isInteger(revision) || revision < 1)) {
		throw new Error(`Invalid revision: ${rawRevision}`)
	}
	if (path.basename(docId) !== docId) throw new Error("Invalid document id")
	return { workspaceRoot, workspaceRootHash, specId, docId, revision }
}

export function specDocumentIdentityKey(
	identity: Pick<SpecDocumentUriIdentity, "workspaceRootHash" | "specId" | "docId">,
): string {
	return `${identity.workspaceRootHash}:${identity.specId}:${identity.docId}`
}
