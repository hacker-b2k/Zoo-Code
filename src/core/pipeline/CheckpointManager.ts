/**
 * CheckpointManager — stage-boundary persistence.
 *
 * Phase 2: in-memory with checkpoint resume capability.
 * Each successful stage creates a checkpoint. The pipeline can be
 * resumed from any checkpoint without rerunning completed stages.
 */

export interface CheckpointSnapshot {
	stageId: string
	timestamp: number
	output: unknown
}

export interface PipelineCheckpoint {
	pipelineId: string
	taskId: string
	completedStages: string[]
	snapshots: CheckpointSnapshot[]
}

export class CheckpointManager {
	private readonly checkpoints = new Map<string, PipelineCheckpoint>()

	save(checkpoint: PipelineCheckpoint): void {
		this.checkpoints.set(checkpoint.pipelineId, checkpoint)
	}

	load(pipelineId: string): PipelineCheckpoint | undefined {
		return this.checkpoints.get(pipelineId)
	}

	clear(pipelineId: string): void {
		this.checkpoints.delete(pipelineId)
	}

	/**
	 * Returns the list of completed stages for a given pipeline.
	 * Used to determine which stages to skip on resume.
	 */
	getCompletedStages(pipelineId: string): string[] {
		const cp = this.checkpoints.get(pipelineId)
		return cp?.completedStages ?? []
	}

	/**
	 * Returns the snapshot for a specific stage from a checkpoint.
	 * Used to restore stage outputs when resuming.
	 */
	getStageOutput(pipelineId: string, stageId: string): unknown | undefined {
		const cp = this.checkpoints.get(pipelineId)
		if (!cp) return undefined
		const snapshot = cp.snapshots.find((s) => s.stageId === stageId)
		return snapshot?.output
	}

	/**
	 * Returns true if the given stage has been completed and checkpointed.
	 */
	isStageCompleted(pipelineId: string, stageId: string): boolean {
		return this.getCompletedStages(pipelineId).includes(stageId)
	}
}
