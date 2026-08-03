import { readUrl, searchWeb } from "./webResearch"

export interface ResearchSource {
	title: string
	url: string
	snippet?: string
	content?: string
	truncated?: boolean
	error?: string
}

export interface ResearchResponse {
	kind: "query" | "url"
	query?: string
	provider?: string
	sources: ResearchSource[]
}

export interface ResearchRequest {
	input: string
	maxSources?: number
	readTopSources?: number
}

function isUrl(value: string): boolean {
	try {
		const url = new URL(value)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch {
		return false
	}
}

export async function research(request: ResearchRequest): Promise<ResearchResponse> {
	const input = request.input.trim()
	if (!input) throw new Error("Research input is required")
	if (isUrl(input)) {
		try {
			const page = await readUrl(input)
			return {
				kind: "url",
				sources: [{ title: page.title, url: page.url, content: page.text, truncated: page.truncated }],
			}
		} catch (error) {
			return { kind: "url", sources: [{ title: "", url: input, error: String(error) }] }
		}
	}

	const result = await searchWeb(input, request.maxSources ?? 8)
	const sources: ResearchSource[] = result.results.map((item) => ({ ...item }))
	const readCount = Math.min(request.readTopSources ?? 0, sources.length)
	await Promise.all(
		sources.slice(0, readCount).map(async (source) => {
			if (!source.url) return
			try {
				const page = await readUrl(source.url)
				source.content = page.text
				source.truncated = page.truncated
			} catch (error) {
				source.error = String(error)
			}
		}),
	)
	return { kind: "query", query: input, provider: result.provider, sources }
}
