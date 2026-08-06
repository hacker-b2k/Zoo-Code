import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

/* Removes image blocks from messages if they are not supported by the Api Handler */
export function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	// Check model capability ONCE instead of for every message
	const modelInfo = apiHandler.getModel()
	const supportsImages = modelInfo.info.supportsImages

	// [IMAGE-TRACE] Log image removal decision
	let totalImageBlocks = 0
	for (const msg of messages) {
		if (Array.isArray(msg.content)) {
			totalImageBlocks += msg.content.filter((b: any) => b.type === "image").length
		}
	}
	console.log(
		`[IMAGE-TRACE] maybeRemoveImageBlocks: modelId=${modelInfo.id}, supportsImages=${supportsImages}, totalMessages=${messages.length}, totalImageBlocks=${totalImageBlocks}`,
	)

	return messages.map((message) => {
		// Handle array content (could contain image blocks).
		let { content } = message
		if (Array.isArray(content)) {
			if (!supportsImages) {
				// Convert image blocks to text descriptions.
				content = content.map((block) => {
					if (block.type === "image") {
						console.log(
							`[IMAGE-TRACE] maybeRemoveImageBlocks: STRIPPING image block (supportsImages=false)`,
						)
						// Convert image blocks to text descriptions.
						// Note: We can't access the actual image content/url due to API limitations,
						// but we can indicate that an image was present in the conversation.
						return {
							type: "text",
							text: "[Referenced image in conversation]",
						}
					}
					return block
				})
			} else {
				const imageCount = content.filter((b: any) => b.type === "image").length
				if (imageCount > 0) {
					console.log(
						`[IMAGE-TRACE] maybeRemoveImageBlocks: KEEPING ${imageCount} image block(s) (supportsImages=true)`,
					)
				}
			}
		}
		return { ...message, content }
	})
}
