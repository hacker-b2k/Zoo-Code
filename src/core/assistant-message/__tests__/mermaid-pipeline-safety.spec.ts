/**
 * Reproduction test: Mermaid diagram content must NEVER be misidentified
 * as tool-call markup by any of the three detection functions.
 *
 * This is the prime suspect from the field report: models struggle to
 * generate Mermaid diagrams, get stuck in error loops, and sometimes
 * produce completely empty assistant responses. The suspicion is that
 * the markup-detection logic added for tool-call recovery false-positives
 * on Mermaid's bracket/arrow-heavy syntax.
 */
import { describe, it, expect } from "vitest"

import {
	looksLikeTextToolCall,
	textEndsWithIncompleteMarkup,
	stripMalformedToolCallMarkup,
	decodeXmlEntities,
} from "../TextToolCallParser"
import { NativeToolCallParser } from "../NativeToolCallParser"

// ---------------------------------------------------------------------------
// Real Mermaid diagram samples covering the most common diagram types.
// These must all pass through the pipeline untouched.
// ---------------------------------------------------------------------------

const MERMAID_SAMPLES: Array<{ name: string; content: string }> = [
	{
		name: "flowchart with decision braces and edge labels",
		content:
			"Here is the architecture:\n```mermaid\ngraph TD\n  A[Load Data] --> B{Valid?}\n  B -->|Yes| C[Process]\n  B -->|No| D[Error]\n  C --> E[Done]\n```\nThat's the flow.",
	},
	{
		name: "sequence diagram with arrows and participants",
		content:
			"```mermaid\nsequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hi Alice\n  A--xB: Async message\n```",
	},
	{
		name: "class diagram with braces and inheritance",
		content:
			"```mermaid\nclassDiagram\n  class Animal {\n    +String name\n    +int age\n    +makeSound() void\n  }\n  class Dog {\n    +bark() void\n  }\n  Animal <|-- Dog\n```",
	},
	{
		name: "state diagram with transitions",
		content:
			"```mermaid\nstateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start\n  Processing --> Done : complete\n  Done --> [*]\n```",
	},
	{
		name: "ER diagram with relationships",
		content:
			"```mermaid\nerDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER }|..|{ ADDRESS : has\n```",
	},
	{
		name: "gantt chart",
		content:
			"```mermaid\ngantt\n  title Project Timeline\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Task 1 :a1, 2024-01-01, 30d\n  Task 2 :after a1, 20d\n```",
	},
	{
		name: "pie chart",
		content: '```mermaid\npie title Distribution\n  "Cats" : 45\n  "Dogs" : 30\n  "Birds" : 25\n```',
	},
	{
		name: "flowchart with JSON-like node labels (worst case)",
		content:
			'```mermaid\ngraph TD\n  A["API {name: users, arguments: {}}"] --> B["Result"]\n  B --> C{Check "parameters"}\n```',
	},
	{
		name: "mindmap with nested indentation",
		content:
			"```mermaid\nmindmap\n  root((Project))\n    Frontend\n      React\n      CSS\n    Backend\n      Node\n      DB\n```",
	},
	{
		name: "git graph",
		content:
			"```mermaid\ngitGraph\n  commit\n  branch develop\n  checkout develop\n  commit\n  checkout main\n  merge develop\n```",
	},
	{
		name: "requirement diagram",
		content:
			"```mermaid\nrequirementDiagram\n  requirement Req1 {\n    id: 1\n    text: The system shall do X\n    risk: high\n    verifymethod: test\n  }\n```",
	},
	{
		name: "C4 context diagram",
		content:
			"```mermaid\nC4Context\n  title System Context\n  Person(user, User)\n  System(app, Application)\n  Rel(user, app, Uses)\n```",
	},
	{
		name: "timeline",
		content:
			"```mermaid\ntimeline\n  title History\n  2020 : Event A\n  2021 : Event B : Event C\n  2022 : Event D\n```",
	},
	{
		name: "sankey",
		content: "```mermaid\nsankey-beta\n  A,B,10\n  A,C,5\n  B,D,8\n  C,D,7\n```",
	},
	{
		name: "xy chart",
		content:
			"```mermaid\nxychart-beta\n  title Revenue\n  x-axis [Jan, Feb, Mar]\n  y-axis Amount 0 --> 100\n  bar [50, 70, 90]\n```",
	},
]

describe("Mermaid diagram content must never trigger tool-call detection", () => {
	for (const { name, content } of MERMAID_SAMPLES) {
		it(`looksLikeTextToolCall: ${name}`, () => {
			expect(looksLikeTextToolCall(content)).toBe(false)
		})

		it(`stripMalformedToolCallMarkup: ${name}`, () => {
			const stripped = stripMalformedToolCallMarkup(content)
			expect(stripped).toBe(content.trim())
		})
	}
})

describe("Mermaid closing fence at stream end must not hold text forever", () => {
	it("textEndsWithIncompleteMarkup: complete mermaid block ending with closing fence", () => {
		const text = "Here's the diagram:\n```mermaid\ngraph TD\n  A --> B\n```"
		// The closing ``` is a COMPLETE fence, not an incomplete one.
		// The deferral gate must NOT hold this text.
		expect(textEndsWithIncompleteMarkup(text)).toBe(false)
	})

	it("textEndsWithIncompleteMarkup: mermaid block ending with closing fence + trailing newline", () => {
		const text = "```mermaid\ngraph LR\n  A --> B\n```\n"
		expect(textEndsWithIncompleteMarkup(text)).toBe(false)
	})

	it("textEndsWithIncompleteMarkup: prose + complete mermaid + prose after", () => {
		const text = "Before.\n```mermaid\ngraph TD\n  A --> B\n```\nAfter."
		expect(textEndsWithIncompleteMarkup(text)).toBe(false)
	})

	it("textEndsWithIncompleteMarkup: genuinely incomplete opening fence still defers", () => {
		// This SHOULD still defer — the fence is genuinely incomplete.
		const text = "Here's the diagram:\n```merm"
		expect(textEndsWithIncompleteMarkup(text)).toBe(true)
	})

	it("textEndsWithIncompleteMarkup: opening fence without language tag still defers", () => {
		const text = "Code:\n```"
		expect(textEndsWithIncompleteMarkup(text)).toBe(true)
	})

	it("textEndsWithIncompleteMarkup: mid-diagram content does not defer", () => {
		const text = "```mermaid\ngraph TD\n  A --> B\n"
		expect(textEndsWithIncompleteMarkup(text)).toBe(false)
	})
})

describe("Mermaid inside write_spec content parameter (tool-call pipeline)", () => {
	it("mermaid in a legitimate write_spec tool call is NOT stripped", () => {
		// The model emits a proper tool call with Mermaid content inside
		// the content parameter. The tool call itself should be recovered,
		// but the Mermaid content inside the parameter must survive.
		const toolCall = `<tool_call>
<function=write_spec>
<parameter=doc>design</parameter>
<parameter=content># Design

## Architecture

\`\`\`mermaid
graph TD
  A[Client] --> B[Server]
  B --> C{Database}
  C -->|query| D[(DB)]
\`\`\`

More text here.
</parameter>
</function>
</tool_call>`
		expect(looksLikeTextToolCall(toolCall)).toBe(true) // legit tool call
		const stripped = stripMalformedToolCallMarkup(toolCall)
		// The tool call itself is stripped (it's structural), but the
		// Mermaid content inside the parameter must NOT be affected by
		// the malformed-markup stripper.
		expect(stripped).not.toContain("<tool_call>")
		expect(stripped).not.toContain("</function>")
	})
})

// ---------------------------------------------------------------------------
// Issue 2: HTML entities double-encoded in Mermaid class diagrams.
// Models sometimes entity-encode bracket-heavy content (e.g. <<abstract>>)
// even inside JSON strings. The native tool call path must decode entities
// to parity with the XML recovery path.
// ---------------------------------------------------------------------------

describe("decodeXmlEntities: shared entity decoding for Mermaid content", () => {
	it("decodes &lt;&lt;abstract&gt;&gt; to <<abstract>>", () => {
		expect(decodeXmlEntities("&lt;&lt;abstract&gt;&gt;")).toBe("<<abstract>>")
	})

	it("decodes &lt; and &gt; in Mermaid node labels", () => {
		expect(decodeXmlEntities("A[&lt;Client&gt;] --> B")).toBe("A[<Client>] --> B")
	})

	it("decodes &amp; last (correct XML semantics)", () => {
		expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;")
	})

	it("decodes numeric entities", () => {
		expect(decodeXmlEntities("&#60;tag&#62;")).toBe("<tag>")
		expect(decodeXmlEntities("&#x3C;tag&#x3E;")).toBe("<tag>")
	})

	it("passes through plain text without entities unchanged", () => {
		expect(decodeXmlEntities("graph TD\n  A --> B")).toBe("graph TD\n  A --> B")
	})

	it("handles empty string", () => {
		expect(decodeXmlEntities("")).toBe("")
	})
})

describe("NativeToolCallParser: entity-decoded string parameters (Mermaid parity)", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it("write_spec content with entity-encoded Mermaid class diagram is decoded", () => {
		const entityEncodedMermaid =
			"classDiagram\n  class Animal {\n    +String name\n  }\n  class Dog {\n    &lt;&lt;abstract&gt;&gt;\n    +bark()\n  }\n  Animal &lt;|-- Dog\n"
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_entities",
			name: "write_spec",
			arguments: JSON.stringify({
				title: "Design",
				spec_id: null,
				doc: "design",
				content: "# Design\n\n```mermaid\n" + entityEncodedMermaid + "```\n",
				mode: "replace",
			}),
		}) as any
		expect(result).not.toBeNull()
		// The content must have entities decoded so the Mermaid renderer
		// gets <<abstract>> not &lt;&lt;abstract&gt;&gt;
		expect(result.nativeArgs.content).toContain("<<abstract>>")
		expect(result.nativeArgs.content).not.toContain("&lt;")
		expect(result.nativeArgs.content).not.toContain("&gt;")
	})

	it("write_spec content with plain Mermaid (no entities) passes through unchanged", () => {
		const plainMermaid = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n"
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_plain",
			name: "write_spec",
			arguments: JSON.stringify({
				title: "Design",
				spec_id: null,
				doc: "design",
				content: "# Design\n\n```mermaid\n" + plainMermaid + "```\n",
				mode: "replace",
			}),
		}) as any
		expect(result.nativeArgs.content).toContain(plainMermaid)
	})

	it("read_spec doc with entities is decoded (simple field)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_rs_entities",
			name: "read_spec",
			arguments: JSON.stringify({ doc: "design", spec_id: null }),
		}) as any
		expect(result.nativeArgs.doc).toBe("design")
	})

	it("content without entities is not modified by decodeXmlEntities", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_noent",
			name: "write_spec",
			arguments: JSON.stringify({
				title: "Plain",
				spec_id: null,
				doc: "tasks",
				content: "Just plain text with no entities at all.",
				mode: "replace",
			}),
		}) as any
		expect(result.nativeArgs.content).toBe("Just plain text with no entities at all.")
	})
})
