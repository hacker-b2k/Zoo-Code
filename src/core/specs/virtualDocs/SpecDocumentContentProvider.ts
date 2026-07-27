import * as vscode from "vscode"

import { SpecService } from "../SpecService"
import { specDocumentEvents } from "../specDocumentEvents"
import { parseSpecDocumentUri, specDocumentIdentityKey } from "./specUri"

export class SpecDocumentContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>()
	private readonly currentUrisByIdentity = new Map<string, Map<string, vscode.Uri>>()
	private readonly eventSubscription = specDocumentEvents.onDocumentChanged((event) => {
		const key = specDocumentIdentityKey(event)
		for (const uri of this.currentUrisByIdentity.get(key)?.values() ?? []) {
			this.changeEmitter.fire(uri)
		}
	})

	readonly onDidChange = this.changeEmitter.event

	constructor(private readonly globalStoragePath: string) {}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const identity = parseSpecDocumentUri(uri)
		const service = new SpecService(this.globalStoragePath)
		if (identity.revision === "current") {
			const key = specDocumentIdentityKey(identity)
			let uris = this.currentUrisByIdentity.get(key)
			if (!uris) {
				uris = new Map()
				this.currentUrisByIdentity.set(key, uris)
			}
			uris.set(uri.toString(), uri)
			const doc = await service.getDocument(identity.workspaceRoot, identity.specId, identity.docId)
			if (!doc) return `# Spec document unavailable\n\nDocument \`${identity.docId}\` was not found.`
			return doc.content
		}
		return service.getDocumentRevision(identity.workspaceRoot, identity.specId, identity.docId, identity.revision)
	}

	dispose(): void {
		this.eventSubscription.dispose()
		this.changeEmitter.dispose()
		this.currentUrisByIdentity.clear()
	}
}
