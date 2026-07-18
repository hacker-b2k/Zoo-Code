/**
 * MemoryStore — partitioned shared memory for the pipeline.
 *
 * Each memory partition is owned by exactly one stage. Earlier
 * partitions are immutable. The Coder has mutable coding memory
 * (the workspace itself). The Reviewer has a mutable streaming
 * buffer. Later phases will back immutable partitions with the
 * JSON artifact files described in the architecture blueprint.
 */

export type MemoryPartitionId =
	| "IntentMemory"
	| "PlanningMemory"
	| "ArchitectMemory"
	| "CodingMemory"
	| "ReviewMemory"
	| "FinalMemory"

export interface MemoryPartition {
	id: MemoryPartitionId
	owner: string
	mutable: boolean
	value?: unknown
}

export interface MemoryAccessPolicy {
	[stageId: string]: {
		canRead: MemoryPartitionId[]
		canWrite: MemoryPartitionId[]
	}
}

export class MemoryStore {
	private readonly partitions = new Map<MemoryPartitionId, MemoryPartition>()

	constructor(initial: MemoryPartition[] = []) {
		for (const p of initial) {
			this.partitions.set(p.id, p)
		}
	}

	get(id: MemoryPartitionId): MemoryPartition | undefined {
		return this.partitions.get(id)
	}

	write(id: MemoryPartitionId, value: unknown): void {
		const existing = this.partitions.get(id)
		if (existing && !existing.mutable) {
			throw new Error(`Memory partition ${id} is immutable`)
		}
		this.partitions.set(id, {
			id,
			owner: existing?.owner ?? "unknown",
			mutable: existing?.mutable ?? true,
			value,
		})
	}

	snapshot(): MemoryPartition[] {
		return [...this.partitions.values()].map((p) => ({ ...p }))
	}
}
