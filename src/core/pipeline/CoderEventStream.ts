/**
 * CoderEventStream — structured event publishing for the Coder stage.
 *
 * Every action the Coder takes is published as a structured event,
 * enabling:
 * - Live timeline
 * - Event replay
 * - AI reasoning visualization
 * - Multiple reviewers
 * - Performance analytics
 * - Time-travel debugging
 */

import { v7 as uuidv7 } from "uuid"
import type { ReviewBuffer, CoderEvent, CoderEventType } from "./ReviewBuffer.js"

export class CoderEventStream {
	constructor(private readonly buffer: ReviewBuffer) {}

	/**
	 * Publish a structured event.
	 */
	emit(type: CoderEventType, data: Omit<CoderEvent, "type" | "timestamp">): CoderEvent {
		const event: CoderEvent = {
			type,
			timestamp: Date.now(),
			...data,
		}
		this.buffer.pushEvent(event)
		return event
	}

	/** Shorthand: file was edited. */
	fileEdited(filePath: string, description: string, metadata?: Record<string, unknown>): CoderEvent {
		return this.emit("FileEdited", { description, filePath, metadata })
	}

	/** Shorthand: file was created. */
	fileCreated(filePath: string, description: string): CoderEvent {
		return this.emit("FileCreated", { description, filePath })
	}

	/** Shorthand: file was deleted. */
	fileDeleted(filePath: string, description: string): CoderEvent {
		return this.emit("FileDeleted", { description, filePath })
	}

	/** Shorthand: tool was executed. */
	toolExecuted(toolName: string, description: string, output?: string): CoderEvent {
		return this.emit("ToolExecuted", { description, toolName, output })
	}

	/** Shorthand: shell command was executed. */
	shellExecuted(command: string, description: string, output?: string): CoderEvent {
		return this.emit("ShellExecuted", { description, command, output })
	}

	/** Shorthand: patch was applied. */
	patchApplied(filePath: string, description: string): CoderEvent {
		return this.emit("PatchApplied", { description, filePath })
	}

	/** Shorthand: build started. */
	buildStarted(description: string): CoderEvent {
		return this.emit("BuildStarted", { description })
	}

	/** Shorthand: build finished. */
	buildFinished(description: string, output?: string): CoderEvent {
		return this.emit("BuildFinished", { description, output })
	}

	/** Shorthand: test started. */
	testStarted(description: string): CoderEvent {
		return this.emit("TestStarted", { description })
	}

	/** Shorthand: test finished. */
	testFinished(description: string, output?: string): CoderEvent {
		return this.emit("TestFinished", { description, output })
	}

	/** Shorthand: error raised. */
	errorRaised(description: string, error: string): CoderEvent {
		return this.emit("ErrorRaised", { description, error })
	}
}
