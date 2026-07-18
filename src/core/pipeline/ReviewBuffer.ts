/**
 * ReviewBuffer — event-driven communication between Coder and Reviewer.
 *
 * The Coder publishes structured events. The Reviewer subscribes and
 * analyzes in real time without blocking the Coder.
 *
 * All events are timestamped and ordered. The buffer supports:
 * - Push: Coder publishes events
 * - Subscribe: Reviewer receives events in real time
 * - Snapshot: Get all events for checkpointing
 * - Replay: Restore events from checkpoint
 */

/**
 * All event types the Coder can publish.
 */
export type CoderEventType =
	| "FileEdited"
	| "FileCreated"
	| "FileDeleted"
	| "ToolExecuted"
	| "ShellExecuted"
	| "PatchApplied"
	| "BuildStarted"
	| "BuildFinished"
	| "TestStarted"
	| "TestFinished"
	| "ErrorRaised"

/**
 * A structured event published by the Coder.
 */
export interface CoderEvent {
	type: CoderEventType
	timestamp: number
	/** Human-readable description of the action. */
	description: string
	/** File path affected, if applicable. */
	filePath?: string
	/** Tool name, if applicable. */
	toolName?: string
	/** Command executed, if applicable. */
	command?: string
	/** Output or result, if applicable. */
	output?: string
	/** Error message, if applicable. */
	error?: string
	/** Additional metadata. */
	metadata?: Record<string, unknown>
}

/**
 * Review finding severity levels.
 */
export type ReviewSeverity = "suggestion" | "warning" | "critical"

/**
 * A single finding from the Reviewer.
 */
export interface ReviewFinding {
	id: string
	severity: ReviewSeverity
	category: string
	filePath?: string
	line?: number
	description: string
	recommendation: string
	confidence: number
	timestamp: number
	/** Reference to the Coder event that triggered this finding. */
	triggerEventId?: string
}

/**
 * The ReviewBuffer — central communication hub between Coder and Reviewer.
 */
export class ReviewBuffer {
	private readonly events: CoderEvent[] = []
	private readonly findings: ReviewFinding[] = []
	private readonly subscribers = new Set<(event: CoderEvent) => void>()
	private readonly findingSubscribers = new Set<(finding: ReviewFinding) => void>()

	/**
	 * Coder publishes an event. All subscribers are notified immediately.
	 */
	pushEvent(event: CoderEvent): void {
		this.events.push(event)
		for (const subscriber of this.subscribers) {
			try {
				subscriber(event)
			} catch {
				// Subscribers must never break the pipeline.
			}
		}
	}

	/**
	 * Subscribe to Coder events (Reviewer uses this).
	 * Returns an unsubscribe function.
	 */
	onEvent(subscriber: (event: CoderEvent) => void): () => void {
		this.subscribers.add(subscriber)
		return () => this.subscribers.delete(subscriber)
	}

	/**
	 * Reviewer publishes a finding. All finding subscribers are notified.
	 */
	pushFinding(finding: ReviewFinding): void {
		this.findings.push(finding)
		for (const subscriber of this.findingSubscribers) {
			try {
				subscriber(finding)
			} catch {
				// Subscribers must never break the pipeline.
			}
		}
	}

	/**
	 * Subscribe to ReviewFindings (PipelineController uses this).
	 * Returns an unsubscribe function.
	 */
	onFinding(subscriber: (finding: ReviewFinding) => void): () => void {
		this.findingSubscribers.add(subscriber)
		return () => this.findingSubscribers.delete(subscriber)
	}

	/**
	 * Get all events (for checkpointing or review analysis).
	 */
	getEvents(): ReadonlyArray<CoderEvent> {
		return this.events
	}

	/**
	 * Get all findings (for checkpointing or final review).
	 */
	getFindings(): ReadonlyArray<ReviewFinding> {
		return this.findings
	}

	/**
	 * Get events since a given timestamp (for incremental review).
	 */
	getEventsSince(timestamp: number): CoderEvent[] {
		return this.events.filter((e) => e.timestamp > timestamp)
	}

	/**
	 * Snapshot for checkpointing.
	 */
	snapshot(): { events: CoderEvent[]; findings: ReviewFinding[] } {
		return {
			events: [...this.events],
			findings: [...this.findings],
		}
	}

	/**
	 * Restore from checkpoint.
	 */
	restore(snapshot: { events: CoderEvent[]; findings: ReviewFinding[] }): void {
		this.events.length = 0
		this.events.push(...snapshot.events)
		this.findings.length = 0
		this.findings.push(...snapshot.findings)
	}

	/**
	 * Total event count.
	 */
	get eventCount(): number {
		return this.events.length
	}

	/**
	 * Total finding count.
	 */
	get findingCount(): number {
		return this.findings.length
	}

	/**
	 * Clear all events and findings.
	 */
	clear(): void {
		this.events.length = 0
		this.findings.length = 0
	}
}
