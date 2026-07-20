const OPENAI_COMPATIBLE_OPERATION_SUFFIXES = [
	"/models/chat/completions",
	"/audio/transcriptions",
	"/audio/translations",
	"/audio/speech",
	"/chat/completions",
	"/images/generations",
	"/images/edits",
	"/images/variations",
	"/embeddings",
	"/moderations",
	"/responses",
	"/completions",
	"/models",
] as const

export interface OpenAiCompatibleBaseUrlAnalysis {
	trimmedInput?: string
	baseUrl?: string
	host: string
	isValid: boolean
	isAzureAiInference: boolean
	isAzureOpenAi: boolean
	isGrokXAI: boolean
}

export function analyzeOpenAiCompatibleBaseUrl(
	baseUrl?: string,
	fallbackBaseUrl?: string,
): OpenAiCompatibleBaseUrlAnalysis {
	const trimmedInput = baseUrl?.trim()
	const candidate = trimmedInput || fallbackBaseUrl?.trim()

	if (!candidate || !URL.canParse(candidate)) {
		return {
			trimmedInput,
			baseUrl: candidate,
			host: "",
			isValid: false,
			isAzureAiInference: false,
			isAzureOpenAi: false,
			isGrokXAI: false,
		}
	}

	const parsedUrl = new URL(candidate)
	const host = parsedUrl.host
	const isAzureAiInference = host.endsWith(".services.ai.azure.com")
	const isAzureOpenAi = host === "azure.com" || host.endsWith(".azure.com")
	const normalizedPathname = normalizeOpenAiCompatiblePathname(parsedUrl.pathname, {
		appendVersionPath: !isAzureAiInference && !isAzureOpenAi,
	})
	parsedUrl.pathname = normalizedPathname
	parsedUrl.search = ""
	parsedUrl.hash = ""

	const normalizedBaseUrl = parsedUrl.toString().replace(/\/+$/, "")

	return {
		trimmedInput,
		baseUrl: normalizedBaseUrl,
		host,
		isValid: true,
		isAzureAiInference,
		isAzureOpenAi,
		isGrokXAI: host.includes("x.ai"),
	}
}

export function getOpenAiCompatibleModelsUrl(baseUrl: string): string {
	return new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString()
}

function normalizeOpenAiCompatiblePathname(
	pathname: string,
	{ appendVersionPath }: { appendVersionPath: boolean },
): string {
	let normalizedPathname = `/${pathname.split("/").filter(Boolean).join("/")}`
	let strippedOperationSuffix = false

	if (normalizedPathname === "//") {
		normalizedPathname = "/"
	}

	for (const suffix of OPENAI_COMPATIBLE_OPERATION_SUFFIXES) {
		if (normalizedPathname === suffix || normalizedPathname.endsWith(suffix)) {
			const strippedPathname = normalizedPathname.slice(0, -suffix.length)
			normalizedPathname = strippedPathname ? strippedPathname.replace(/\/+$/, "") || "/" : "/"
			strippedOperationSuffix = true
			break
		}
	}

	if (appendVersionPath && !strippedOperationSuffix && !hasOpenAiVersionPath(normalizedPathname)) {
		normalizedPathname = normalizedPathname === "/" ? "/v1" : `${normalizedPathname.replace(/\/+$/, "")}/v1`
	}

	return normalizedPathname === "//" ? "/" : normalizedPathname || "/"
}

function hasOpenAiVersionPath(pathname: string): boolean {
	return pathname
		.split("/")
		.filter(Boolean)
		.some((segment) => /^v\d+(?:\.\d+)?$/i.test(segment))
}
