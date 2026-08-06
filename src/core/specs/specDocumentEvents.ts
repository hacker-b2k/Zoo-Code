export type SpecDocumentChangeReason = "write" | "restore" | "import" | "template" | "initial" | "delete"

export interface SpecDocumentChangeEvent {
	workspaceRootHash: string
	specId: string
	docId: string
	revision: number
	reason: SpecDocumentChangeReason
}

export interface SpecDocumentEventDisposable {
	dispose(): void
}

/**
 * Shared post-commit event bus for durable virtual-spec mutations.
 * F-020 partials never reach this bus because they do not call SpecService.
 */
export class SpecDocumentEvents {
	private readonly listeners = new Set<(event: SpecDocumentChangeEvent) => void>()

	onDocumentChanged(listener: (event: SpecDocumentChangeEvent) => void): SpecDocumentEventDisposable {
		this.listeners.add(listener)
		return { dispose: () => this.listeners.delete(listener) }
	}

	emitDocumentChanged(event: SpecDocumentChangeEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event)
			} catch {
				// One subscriber must not prevent a completed mutation from notifying others.
			}
		}
	}
}

export const specDocumentEvents = new SpecDocumentEvents()
