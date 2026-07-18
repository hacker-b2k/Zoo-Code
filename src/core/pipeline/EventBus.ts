/**
 * EventBus — typed, isolated event channel for the pipeline.
 *
 * In Phase 1, this is a thin EventEmitter wrapper with strict
 * typing. It exists so the webview, debug tooling, and the
 * PipelineController itself all see the same lifecycle events
 * without depending on classic orchestration events.
 */

export type PipelineEventType =
	| "StageStarted"
	| "StageFinished"
	| "StageFailed"
	| "StageRetry"
	| "StageCancelled"
	| "StageCheckpointCreated"
	| "StageOutputPublished"
	| "PipelineStarted"
	| "PipelineCompleted"
	| "PipelineCancelled"

export interface PipelineEvent {
	type: PipelineEventType
	pipelineId: string
	stageId?: string
	timestamp: number
	payload?: Record<string, unknown>
}

export type PipelineEventListener = (event: PipelineEvent) => void

export class EventBus {
	private readonly listeners = new Set<PipelineEventListener>()

	emit(event: PipelineEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch {
				// Listeners must never break the pipeline.
			}
		}
	}

	subscribe(listener: PipelineEventListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	clear(): void {
		this.listeners.clear()
	}
}
