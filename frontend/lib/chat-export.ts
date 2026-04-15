import type { CandidateCard, ManualCandidateCard, Message } from "@/components/chatbot/chat-message"

export type ChatExportFormat = "txt" | "md" | "pdf"
export type ChatExportTemplate = "user" | "operator" | "report"
export type ChatExportScope = "all" | "latest_exchange" | "latest_answer"

export interface ChatExportRequest {
  format: ChatExportFormat
  template?: ChatExportTemplate
  scope?: ChatExportScope
  includeSources?: boolean
  includeDiagnostics?: boolean
  includeManualPreviews?: boolean
}

interface NormalizedChatExportRequest {
  format: ChatExportFormat
  template: ChatExportTemplate
  scope: ChatExportScope
  includeSources: boolean
  includeDiagnostics: boolean
  includeManualPreviews: boolean
}

const FORMAT_LABEL: Record<ChatExportFormat, string> = {
  txt: "\uD14D\uC2A4\uD2B8",
  md: "Markdown",
  pdf: "PDF \uC778\uC1C4",
}

const TEMPLATE_LABEL: Record<ChatExportTemplate, string> = {
  user: "\uC0AC\uC6A9\uC790\uC6A9",
  operator: "\uC6B4\uC601\uC790\uC6A9",
  report: "\uBCF4\uACE0\uC6A9",
}

const TEMPLATE_DESCRIPTION: Record<ChatExportTemplate, string> = {
  user: "\uC9C8\uBB38\uACFC \uB2F5\uBCC0 \uC911\uC2EC",
  operator: "\uCD9C\uCC98\uC640 \uC9C4\uB2E8 \uC815\uBCF4 \uD3EC\uD568",
  report: "\uACF5\uC720\uC6A9 \uC694\uC57D \uD3EC\uB9F7",
}

const SCOPE_LABEL: Record<ChatExportScope, string> = {
  all: "\uC804\uCCB4 \uB300\uD654",
  latest_exchange: "\uCD5C\uADFC \uC9C8\uC758/\uC751\uB2F5",
  latest_answer: "\uCD5C\uC885 \uB2F5\uBCC0",
}

const TEMPLATE_HEADLINE: Record<ChatExportTemplate, string> = {
  user: "\uC9C8\uBB38\uACFC \uC548\uB0B4\uB97C \uBC14\uB85C \uD655\uC778\uD560 \uC218 \uC788\uB294 \uC0C1\uB2F4 \uACB0\uACFC\uC9C0 \uD615\uC2DD\uC785\uB2C8\uB2E4.",
  operator: "\uAC80\uC0C9 \uACBD\uB85C\uC640 \uADFC\uAC70\uB97C \uD568\uAED8 \uAC80\uD1A0\uD560 \uC218 \uC788\uB294 \uC6B4\uC601 \uC9C4\uB2E8 \uB9AC\uD3EC\uD2B8\uC785\uB2C8\uB2E4.",
  report: "\uACF5\uC720\uC640 \uBCF4\uACE0\uC5D0 \uB9DE\uCD98 \uBE0C\uB9AC\uD551 \uBB38\uC11C \uD615\uC2DD\uC785\uB2C8\uB2E4.",
}

const ANSWER_SOURCE_LABEL: Record<string, string> = {
  llm: "LLM \uB2F5\uBCC0",
  deterministic_fallback: "\uC774\uB825 \uAE30\uBC18 \uB2F5\uBCC0",
  rule_only: "\uADDC\uCE59 \uAE30\uBC18 \uB2F5\uBCC0",
  manual: "\uB9E4\uB274\uC5BC \uB2F5\uBCC0",
  clarification: "\uCD94\uAC00 \uC815\uBCF4 \uD544\uC694",
  no_match: "\uC720\uC0AC \uC774\uB825 \uC5C6\uC74C",
  proxy_error: "\uC5F0\uACB0 \uC624\uB958",
}

const RETRIEVAL_MODE_LABEL: Record<string, string> = {
  hybrid: "\uD558\uC774\uBE0C\uB9AC\uB4DC \uAC80\uC0C9",
  rule_only: "\uADDC\uCE59 \uAC80\uC0C9",
  manual: "\uB9E4\uB274\uC5BC \uAC80\uC0C9",
}

const STRUCTURED_SECTION_TITLES = [
  "\uD575\uC2EC \uB2F5\uBCC0",
  "\uD575\uC2EC \uC548\uB0B4",
  "\uC801\uC6A9 \uBC29\uBC95",
  "\uC9C4\uD589 \uBC29\uBC95",
  "\uD655\uC778 \uD3EC\uC778\uD2B8",
  "\uCCB4\uD06C \uD3EC\uC778\uD2B8",
  "\uCC38\uACE0 \uB9C1\uD06C",
  "\uCC38\uACE0 \uC0AC\uD56D",
  "\uC8FC\uC694 \uB0B4\uC6A9",
] as const

interface ParsedAnswerSection {
  title: string
  body: string
}

interface ExportContext {
  template: ChatExportTemplate
  exportedAt: string
  conversationTitle: string
  scope: ChatExportScope
  includeSources: boolean
  includeDiagnostics: boolean
  includeManualPreviews: boolean
}

interface ExportStats {
  totalMessages: number
  userMessages: number
  botMessages: number
  manualReferences: number
}

function getDefaultExportOptions(template: ChatExportTemplate): Omit<NormalizedChatExportRequest, "format" | "template"> {
  if (template === "operator") {
    return {
      scope: "all",
      includeSources: true,
      includeDiagnostics: true,
      includeManualPreviews: true,
    }
  }

  if (template === "report") {
    return {
      scope: "latest_exchange",
      includeSources: true,
      includeDiagnostics: false,
      includeManualPreviews: true,
    }
  }

  return {
    scope: "all",
    includeSources: true,
    includeDiagnostics: false,
    includeManualPreviews: true,
  }
}

function normalizeChatExportRequest(request: ChatExportFormat | ChatExportRequest = "txt"): NormalizedChatExportRequest {
  if (typeof request === "string") {
    const defaults = getDefaultExportOptions("user")
    return { format: request, template: "user", ...defaults }
  }

  const template = request.template ?? "user"
  const defaults = getDefaultExportOptions(template)

  return {
    format: request.format,
    template,
    scope: request.scope ?? defaults.scope,
    includeSources: request.includeSources ?? defaults.includeSources,
    includeDiagnostics: request.includeDiagnostics ?? defaults.includeDiagnostics,
    includeManualPreviews: request.includeManualPreviews ?? defaults.includeManualPreviews,
  }
}

function formatExportedAt(): string {
  return new Date().toLocaleString("ko-KR")
}

function formatMessageTime(timestamp: Date | string): string {
  const ts = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  return ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

function formatMessageDateTime(timestamp: Date | string): string {
  const ts = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  return ts.toLocaleString("ko-KR")
}

function formatSender(message: Message, template?: ChatExportTemplate): string {
  if (message.sender === "user") {
    return template === "report" ? "\uC9C8\uC758" : "\uC0AC\uC6A9\uC790"
  }

  if (template === "report") {
    return message.title ?? "\uAC80\uD1A0 \uACB0\uACFC"
  }

  return message.title ?? "AI Core"
}
function createFileStem(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `chat_export_${date}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (typeof window === "undefined") return url

  try {
    return new URL(url, window.location.origin).toString()
  } catch {
    return url
  }
}

function trimConversationTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= 32) return normalized
  return `${normalized.slice(0, 32)}...`
}

function getConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((message) => message.sender === "user" && message.content.trim().length > 0)
  if (!firstUserMessage) return "\uCF54\uBE44\uC804 CS AI Core \uB300\uD654"
  return trimConversationTitle(firstUserMessage.content)
}

function getLatestExchangeMessages(messages: Message[]): Message[] {
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.sender === "user")?.index

  if (lastUserIndex === undefined) {
    return messages.slice(-1)
  }

  return messages.slice(lastUserIndex)
}

function getLatestAnswerMessages(messages: Message[]): Message[] {
  const lastBotIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.sender === "bot")?.index

  if (lastBotIndex === undefined) {
    return getLatestExchangeMessages(messages)
  }

  return messages.slice(lastBotIndex, lastBotIndex + 1)
}

function resolveExportMessages(messages: Message[], scope: ChatExportScope): Message[] {
  if (scope === "latest_answer") {
    return getLatestAnswerMessages(messages)
  }

  if (scope === "latest_exchange") {
    return getLatestExchangeMessages(messages)
  }

  return messages
}

function getAnswerSourceLabel(answerSource: string | null | undefined): string | null {
  if (!answerSource) return null
  return ANSWER_SOURCE_LABEL[answerSource] ?? answerSource
}

function getRetrievalModeLabel(retrievalMode: string | null | undefined): string | null {
  if (!retrievalMode) return null
  return RETRIEVAL_MODE_LABEL[retrievalMode] ?? retrievalMode
}

function formatConfidence(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null
  return `${Math.round(confidence * 100)}%`
}

function getScopeLabel(scope: ChatExportScope): string {
  return SCOPE_LABEL[scope]
}

function getSectionTone(title: string): "core" | "howto" | "checkpoint" | "reference" | "general" {
  if (title.includes("\uD575\uC2EC")) return "core"
  if (title.includes("\uC801\uC6A9") || title.includes("\uC9C4\uD589")) return "howto"
  if (title.includes("\uD655\uC778") || title.includes("\uCCB4\uD06C")) return "checkpoint"
  if (title.includes("\uCC38\uACE0")) return "reference"
  return "general"
}

function parseStructuredAnswerSections(content: string): ParsedAnswerSection[] {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const lines = normalized.split("\n")
  const sections: ParsedAnswerSection[] = []
  let currentTitle: string | null = null
  let currentBody: string[] = []

  const flush = () => {
    if (!currentTitle) return
    const body = currentBody.join("\n").trim()
    sections.push({ title: currentTitle, body })
    currentTitle = null
    currentBody = []
  }

  const parseHeadingLine = (line: string): { title: string; inlineBody: string } | null => {
    const headingMatch = line.match(/^(\d+)[.)]\s*(.+)$/)
    if (!headingMatch) return null

    const rest = headingMatch[2].trim()
    for (const candidateTitle of STRUCTURED_SECTION_TITLES) {
      if (rest.startsWith(candidateTitle)) {
        const inlineBody = rest
          .slice(candidateTitle.length)
          .replace(/^[:\uFF1A\-]\s*/, "")
          .trim()
        return {
          title: candidateTitle,
          inlineBody,
        }
      }
    }

    return {
      title: rest,
      inlineBody: "",
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const parsedHeading = parseHeadingLine(trimmed)
    if (parsedHeading) {
      flush()
      currentTitle = parsedHeading.title
      if (parsedHeading.inlineBody) {
        currentBody.push(parsedHeading.inlineBody)
      }
      continue
    }

    if (!currentTitle) {
      currentTitle = "\uD575\uC2EC \uC548\uB0B4"
    }
    currentBody.push(line)
  }

  flush()

  if (sections.length <= 1) {
    return []
  }

  return sections.filter((section) => section.body.length > 0)
}

function collectMessageMeta(message: Message, context: ExportContext): string[] {
  if (message.sender === "user") return []

  const template = context.template
  const meta: string[] = []
  const answerSource = getAnswerSourceLabel(message.answerSource)
  const retrievalMode = getRetrievalModeLabel(message.retrievalMode)
  const confidence = formatConfidence(message.confidence)

  if (template === "report") {
    if (answerSource) meta.push(`\uB2F5\uBCC0 \uCD9C\uCC98: ${answerSource}`)
    return meta
  }

  if (answerSource) meta.push(`\uB2F5\uBCC0 \uCD9C\uCC98: ${answerSource}`)
  if (confidence) meta.push(`\uC2E0\uB8B0\uB3C4: ${confidence}`)
  if (template === "operator" || context.includeDiagnostics) {
    if (retrievalMode) meta.push(`\uAC80\uC0C9 \uBC29\uC2DD: ${retrievalMode}`)
    if (message.logId) meta.push(`\uB85C\uADF8 ID: ${message.logId}`)
  }

  return meta
}

function getManualCandidateLimit(template: ChatExportTemplate): number {
  if (template === "operator") return 5
  if (template === "report") return 2
  return 3
}

function collectManualSourceLines(candidates: ManualCandidateCard[] | null | undefined, template: ChatExportTemplate): string[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return []

  return candidates.slice(0, getManualCandidateLimit(template)).map((candidate, index) => {
    const page = typeof candidate.previewPageNumber === "number" ? ` / p.${candidate.previewPageNumber}` : ""
    const section = candidate.sectionTitle ? ` / ${candidate.sectionTitle}` : ""
    const link = absoluteUrl(candidate.linkUrl)
    const score = template === "operator" ? ` / score ${Math.round(candidate.score * 100)}%` : ""
    return `${index + 1}. ${candidate.title}${candidate.version ? ` ${candidate.version}` : ""}${section}${page}${score}${link ? ` / ${link}` : ""}`
  })
}

function collectTopCandidateLines(candidates: CandidateCard[] | null | undefined): string[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return []

  return candidates.slice(0, 3).map((candidate, index) => {
    const chunkType = candidate.chunkType ? ` / ${candidate.chunkType}` : ""
    const preview = candidate.previewText.replace(/\s+/g, " ").trim().slice(0, 120)
    return `${index + 1}. require=${candidate.requireId}${chunkType} / score ${Math.round(candidate.score * 100)}% / ${preview}`
  })
}

function renderStructuredSectionsAsPlainText(content: string): string[] {
  const sections = parseStructuredAnswerSections(content)
  if (sections.length === 0) {
    return [content]
  }

  return sections.flatMap((section, index) => [
    `${index + 1}. ${section.title}`,
    section.body,
    "",
  ]).slice(0, -1)
}

function buildPlainText(messages: Message[], context: ExportContext): string {
  const lines: string[] = [
    "=== \uCF54\uBE44\uC804 CS AI Core \uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30 ===",
    `\uB300\uD654 \uC81C\uBAA9: ${context.conversationTitle}`,
    `\uD15C\uD50C\uB9BF: ${getChatExportTemplateLabel(context.template)} (${TEMPLATE_DESCRIPTION[context.template]})`,
    `\uBC94\uC704: ${getScopeLabel(context.scope)}`,
    `\uB0B4\uBCF4\uB0B8 \uC2DC\uAC01: ${context.exportedAt}`,
    `\uBA54\uC2DC\uC9C0 \uC218: ${messages.length}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`[${formatMessageTime(message.timestamp)}] ${formatSender(message, context.template)}`)
    lines.push(...renderStructuredSectionsAsPlainText(message.content))

    const meta = collectMessageMeta(message, context)
    if (meta.length > 0) {
      lines.push("")
      lines.push("\uCD9C\uCC98 \uC815\uBCF4")
      lines.push(...meta.map((item) => `- ${item}`))
    }

    const manualLines = context.includeSources ? collectManualSourceLines(message.manualCandidates, context.template) : []
    if (manualLines.length > 0) {
      lines.push("")
      lines.push("\uB9E4\uB274\uC5BC \uCC38\uACE0")
      lines.push(...manualLines.map((item) => `- ${item}`))
    }

    if (context.includeDiagnostics && context.template === "operator") {
      const candidateLines = collectTopCandidateLines(message.top3Candidates)
      if (candidateLines.length > 0) {
        lines.push("")
        lines.push("\uC0C1\uC704 \uD6C4\uBCF4")
        lines.push(...candidateLines.map((item) => `- ${item}`))
      }
    }

    if (message.linkUrl) {
      lines.push("")
      lines.push(`\uCC38\uACE0 \uB9C1\uD06C: ${absoluteUrl(message.linkUrl) ?? message.linkUrl}`)
    }

    lines.push("")
  }

  return lines.join("\n")
}

function buildMarkdown(messages: Message[], context: ExportContext): string {
  const lines: string[] = [
    "# \uCF54\uBE44\uC804 CS AI Core \uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30",
    "",
    `- \uB300\uD654 \uC81C\uBAA9: ${context.conversationTitle}`,
    `- \uD15C\uD50C\uB9BF: ${getChatExportTemplateLabel(context.template)} (${TEMPLATE_DESCRIPTION[context.template]})`,
    `- \uBC94\uC704: ${getScopeLabel(context.scope)}`,
    `- \uB0B4\uBCF4\uB0B8 \uC2DC\uAC01: ${context.exportedAt}`,
    `- \uBA54\uC2DC\uC9C0 \uC218: ${messages.length}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`## [${formatMessageTime(message.timestamp)}] ${formatSender(message, context.template)}`)
    lines.push("")

    const sections = parseStructuredAnswerSections(message.content)
    if (sections.length > 0) {
      for (const section of sections) {
        lines.push(`### ${section.title}`)
        lines.push("")
        lines.push(section.body)
        lines.push("")
      }
    } else {
      lines.push(message.content)
      lines.push("")
    }

    const meta = collectMessageMeta(message, context)
    if (meta.length > 0) {
      lines.push("### \uCD9C\uCC98 \uC815\uBCF4")
      lines.push("")
      lines.push(...meta.map((item) => `- ${item}`))
      lines.push("")
    }

    const manualLines = context.includeSources ? collectManualSourceLines(message.manualCandidates, context.template) : []
    if (manualLines.length > 0) {
      lines.push("### \uB9E4\uB274\uC5BC \uCC38\uACE0")
      lines.push("")
      lines.push(...manualLines.map((item) => `- ${item}`))
      lines.push("")
    }

    if (context.includeDiagnostics && context.template === "operator") {
      const candidateLines = collectTopCandidateLines(message.top3Candidates)
      if (candidateLines.length > 0) {
        lines.push("### \uC0C1\uC704 \uD6C4\uBCF4")
        lines.push("")
        lines.push(...candidateLines.map((item) => `- ${item}`))
        lines.push("")
      }
    }

    if (message.linkUrl) {
      lines.push(`- \uCC38\uACE0 \uB9C1\uD06C: ${absoluteUrl(message.linkUrl) ?? message.linkUrl}`)
      lines.push("")
    }
  }

  return lines.join("\n")
}

function renderMetaChips(message: Message, context: ExportContext): string {
  return collectMessageMeta(message, context)
    .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
    .join("")
}

function renderManualSources(message: Message, context: ExportContext): string {
  if (!context.includeSources) return ""

  const template = context.template
  const candidates = Array.isArray(message.manualCandidates)
    ? message.manualCandidates.slice(0, getManualCandidateLimit(template))
    : []

  if (candidates.length === 0) return ""

  const items = candidates
    .map((candidate) => {
      const link = absoluteUrl(candidate.linkUrl)
      const previewImage = absoluteUrl(candidate.previewImageUrl)
      return `
        <li>
          <div class="source-title">${escapeHtml(candidate.title)}${candidate.version ? ` <span class="source-version">${escapeHtml(candidate.version)}</span>` : ""}</div>
          <div class="source-body">
            ${candidate.product ? `<span>${escapeHtml(candidate.product)}</span>` : ""}
            ${candidate.sectionTitle ? `<span>${escapeHtml(candidate.sectionTitle)}</span>` : ""}
            ${typeof candidate.previewPageNumber === "number" ? `<span>p.${candidate.previewPageNumber}</span>` : ""}
            ${template === "operator" ? `<span>score ${Math.round(candidate.score * 100)}%</span>` : ""}
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">\uC6D0\uBB38 \uB9C1\uD06C</a>` : ""}
          </div>
          <div class="source-preview">${escapeHtml(candidate.previewText)}</div>
          ${context.includeManualPreviews && previewImage ? `<img class="manual-preview" src="${escapeHtml(previewImage)}" alt="${escapeHtml(candidate.title)} \uBBF8\uB9AC\uBCF4\uAE30" />` : ""}
        </li>
      `
    })
    .join("")

  return `
    <section class="source-block">
      <h4>\uB9E4\uB274\uC5BC \uCC38\uACE0</h4>
      <ul class="source-list">${items}</ul>
    </section>
  `
}

function renderTopCandidates(message: Message, context: ExportContext): string {
  if (!context.includeDiagnostics) return ""

  const candidates = Array.isArray(message.top3Candidates) ? message.top3Candidates.slice(0, 3) : []
  if (candidates.length === 0) return ""

  const items = candidates
    .map(
      (candidate) => `
        <li>
          <strong>${escapeHtml(candidate.requireId)}</strong>
          <span>${escapeHtml(candidate.chunkType)}</span>
          <span>score ${Math.round(candidate.score * 100)}%</span>
          <p>${escapeHtml(candidate.previewText)}</p>
        </li>
      `,
    )
    .join("")

  return `
    <section class="source-block operator-only">
      <h4>\uC0C1\uC704 \uD6C4\uBCF4</h4>
      <ul class="candidate-list">${items}</ul>
    </section>
  `
}

function renderOperatorDiagnostics(message: Message, context: ExportContext): string {
  if (!context.includeDiagnostics || message.sender !== "bot") return ""

  const rows = [
    message.answerSource ? [`\uB2F5\uBCC0 \uCD9C\uCC98`, getAnswerSourceLabel(message.answerSource) ?? message.answerSource] : null,
    message.retrievalMode ? [`\uAC80\uC0C9 \uBAA8\uB4DC`, getRetrievalModeLabel(message.retrievalMode) ?? message.retrievalMode] : null,
    formatConfidence(message.confidence) ? [`\uC2E0\uB8B0\uB3C4`, formatConfidence(message.confidence)] : null,
    message.logId ? [`\uB85C\uADF8 ID`, message.logId] : null,
  ].filter((row): row is [string, string] => Array.isArray(row) && typeof row[1] === "string")

  if (rows.length === 0) return ""

  return `
    <section class="diagnostic-block">
      <h4>\uC9C4\uB2E8 \uC694\uC57D</h4>
      <div class="diagnostic-legend">
        <span class="legend-chip priority-good">\uC548\uC815</span>
        <span class="legend-chip priority-medium">\uC8FC\uC758</span>
        <span class="legend-chip priority-high">\uD655\uC778 \uD544\uC694</span>
        <span class="legend-chip priority-critical">\uC6B0\uC120 \uC810\uAC80</span>
      </div>
      <dl class="diagnostic-grid">
        ${rows
          .map(
            ([label, value]) => `
              <div class="diagnostic-item priority-${getDiagnosticPriority(label, value, message)}">
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `,
          )
          .join("")}
      </dl>
    </section>
  `
}

function renderManualSpotlight(message: Message, context: ExportContext): string {
  if (!context.includeSources || message.sender !== "bot") return ""
  const candidate = Array.isArray(message.manualCandidates) ? message.manualCandidates[0] : null
  if (!candidate) return ""

  const previewImage = context.includeManualPreviews ? absoluteUrl(candidate.previewImageUrl) : null
  const link = absoluteUrl(candidate.linkUrl)

  return `
    <section class="manual-spotlight">
      <div class="manual-spotlight-copy">
        <div class="manual-spotlight-label">\uCD94\uCC9C \uD654\uBA74</div>
        <h4>${escapeHtml(candidate.title)}</h4>
        <p>${escapeHtml(candidate.previewText)}</p>
        <div class="manual-spotlight-meta">
          ${candidate.product ? `<span>${escapeHtml(candidate.product)}</span>` : ""}
          ${candidate.sectionTitle ? `<span>${escapeHtml(candidate.sectionTitle)}</span>` : ""}
          ${typeof candidate.previewPageNumber === "number" ? `<span>p.${candidate.previewPageNumber}</span>` : ""}
          ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">\uC6D0\uBB38 \uBCF4\uAE30</a>` : ""}
        </div>
      </div>
      ${previewImage ? `<img class="manual-spotlight-image" src="${escapeHtml(previewImage)}" alt="${escapeHtml(candidate.title)} \uBBF8\uB9AC\uBCF4\uAE30" />` : ""}
    </section>
  `
}

function renderReportBrief(message: Message): string {
  if (message.sender !== "bot") return ""

  const sections = parseStructuredAnswerSections(message.content)
  if (sections.length === 0) return ""

  const core = sections[0]
  const supporting = sections.slice(1, 4)

  return `
    <section class="brief-block">
      <div class="brief-label">\uD575\uC2EC \uC694\uC57D</div>
      <div class="brief-core">${escapeHtml(core.body).replace(/\n/g, "<br />")}</div>
      ${
        supporting.length > 0
          ? `<ul class="brief-points">
              ${supporting
                .map(
                  (section) => `
                    <li><strong>${escapeHtml(section.title)}</strong> ${escapeHtml(section.body)}</li>
                  `,
                )
                .join("")}
            </ul>`
          : ""
      }
    </section>
  `
}

function renderTemplateHeaderVisual(template: ChatExportTemplate): string {
  if (template === "operator") {
    return `
      <div class="header-visual operator-visual" aria-hidden="true">
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="16" y="18" width="88" height="84" rx="22" fill="url(#opsBg)" />
          <rect x="30" y="34" width="58" height="8" rx="4" fill="#DBEAFE" fill-opacity="0.9" />
          <rect x="30" y="50" width="44" height="8" rx="4" fill="#93C5FD" fill-opacity="0.9" />
          <rect x="30" y="66" width="32" height="8" rx="4" fill="#60A5FA" fill-opacity="0.9" />
          <circle cx="86" cy="70" r="14" fill="#F59E0B" />
          <path d="M82 70l3 3 7-8" stroke="#0F172A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
          <defs>
            <linearGradient id="opsBg" x1="16" y1="18" x2="104" y2="102" gradientUnits="userSpaceOnUse">
              <stop stop-color="#0F172A" />
              <stop offset="1" stop-color="#2563EB" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    `
  }

  if (template === "report") {
    return `
      <div class="header-visual report-visual" aria-hidden="true">
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="18" y="16" width="84" height="88" rx="22" fill="#FFF8EE" stroke="#D6B98B" stroke-width="2" />
          <path d="M36 42h48" stroke="#8A6A38" stroke-width="6" stroke-linecap="round" />
          <path d="M36 58h48" stroke="#B68A4A" stroke-width="6" stroke-linecap="round" />
          <path d="M36 74h30" stroke="#D6B98B" stroke-width="6" stroke-linecap="round" />
          <circle cx="84" cy="82" r="10" fill="#2563EB" fill-opacity="0.12" stroke="#2563EB" stroke-width="2" />
          <path d="M79 82h10" stroke="#2563EB" stroke-width="3" stroke-linecap="round" />
        </svg>
      </div>
    `
  }

  return `
    <div class="header-visual user-visual" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="16" y="16" width="88" height="88" rx="28" fill="url(#userBg)" />
        <path d="M40 46h40" stroke="white" stroke-width="7" stroke-linecap="round" />
        <path d="M40 62h28" stroke="white" stroke-width="7" stroke-linecap="round" opacity="0.9" />
        <path d="M40 78h18" stroke="white" stroke-width="7" stroke-linecap="round" opacity="0.75" />
        <circle cx="84" cy="78" r="10" fill="#BFDBFE" />
        <path d="M81 78l2 2 5-5" stroke="#1D4ED8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <defs>
          <linearGradient id="userBg" x1="16" y1="16" x2="104" y2="104" gradientUnits="userSpaceOnUse">
            <stop stop-color="#2563EB" />
            <stop offset="1" stop-color="#60A5FA" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  `
}

type DiagnosticPriority = "good" | "medium" | "high" | "critical" | "neutral"

function getDiagnosticPriority(
  label: string,
  value: string,
  message: Message,
): DiagnosticPriority {
  if (label === "\uB2F5\uBCC0 \uCD9C\uCC98") {
    if (message.answerSource === "proxy_error" || message.answerSource === "no_match") return "critical"
    if (message.answerSource === "clarification") return "high"
    if (message.answerSource === "deterministic_fallback" || message.answerSource === "rule_only") return "medium"
    return "good"
  }

  if (label === "\uAC80\uC0C9 \uBAA8\uB4DC") {
    if (message.retrievalMode === "hybrid" || message.retrievalMode === "manual") return "good"
    if (message.retrievalMode === "rule_only") return "medium"
    return "neutral"
  }

  if (label === "\uC2E0\uB8B0\uB3C4") {
    const confidence = typeof message.confidence === "number" ? message.confidence : null
    if (confidence === null) return "neutral"
    if (confidence < 0.5) return "critical"
    if (confidence < 0.7) return "high"
    if (confidence < 0.85) return "medium"
    return "good"
  }

  return "neutral"
}

function renderMessageContentHtml(message: Message, context: ExportContext): string {
  const sections = parseStructuredAnswerSections(message.content)
  if (sections.length === 0) {
    return `<div class="content raw">${escapeHtml(message.content).replace(/\n/g, "<br />")}</div>`
  }

  const visibleSections =
    context.template === "report"
      ? sections.slice(0, Math.min(sections.length, 3))
      : context.template === "user"
        ? sections.slice(0, Math.min(sections.length, 4))
        : sections

  return `
    <div class="content structured">
      ${visibleSections
        .map(
          (section, index) => `
            <section class="answer-section tone-${getSectionTone(section.title)}">
              <div class="answer-section-title">${index + 1}. ${escapeHtml(section.title)}</div>
              <div class="answer-section-body">${escapeHtml(section.body).replace(/\n/g, "<br />")}</div>
            </section>
          `,
        )
        .join("")}
      ${context.template === "report" && sections.length > visibleSections.length ? `<div class="answer-overflow-note">\uB098\uBA38\uC9C0 \uC138\uBD80 \uC808\uCC28\uB294 \uC6B4\uC601\uC790\uC6A9 \uB610\uB294 \uC0AC\uC6A9\uC790\uC6A9 \uB0B4\uBCF4\uB0B4\uAE30\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</div>` : ""}
    </div>
  `
}

function collectStats(messages: Message[]): ExportStats {
  return {
    totalMessages: messages.length,
    userMessages: messages.filter((message) => message.sender === "user").length,
    botMessages: messages.filter((message) => message.sender === "bot").length,
    manualReferences: messages.reduce((sum, message) => sum + (message.manualCandidates?.length ?? 0), 0),
  }
}

function renderTemplateHeader(context: ExportContext, stats: ExportStats): string {
  if (context.template === "operator") {
    return `
      <section class="page-header operator-header">
        <div class="header-topline">
          <div class="header-badge operator-badge">
            <span class="header-badge-kicker">OPERATOR PDF</span>
            <strong>OPS</strong>
          </div>
          <div class="header-copy">
            <div class="eyebrow">OPERATOR DIAGNOSTIC EXPORT</div>
            <div class="header-caption">\uC6B4\uC601 \uD310\uB2E8\uC640 \uC870\uCE58 \uD6C4\uBCF4\uB97C \uBC14\uB85C \uBCF4\uB294 \uC9C4\uB2E8\uC6A9 PDF</div>
          </div>
        </div>
        <h1>\uCF54\uBE44\uC804 CS AI Core \uC6B4\uC601 \uC9C4\uB2E8 \uBD84\uC11D \uB9AC\uD3EC\uD2B8</h1>
        <p class="headline">${escapeHtml(TEMPLATE_HEADLINE[context.template])}</p>
        <div class="header-split operator-split">
          <div class="operator-callout">
            <div class="operator-callout-label">OPERATOR CHECKLIST</div>
            <div class="operator-callout-body">\uAC80\uC0C9 \uACBD\uB85C, \uB9E4\uCE6D \uADFC\uAC70, \uCC38\uACE0 \uBB38\uC11C, \uC9C4\uB2E8 \uD6C4\uBCF4\uB97C \uD55C \uBC88\uC5D0 \uD655\uC778\uD558\uB294 \uC6B4\uC601 \uC6A9\uB3C4 \uBB38\uC11C\uC785\uB2C8\uB2E4.</div>
          </div>
          ${renderTemplateHeaderVisual("operator")}
        </div>
        <div class="summary-grid operator-grid">
          <article class="summary-card accent-blue">
            <span class="label">\uB300\uD654 \uC81C\uBAA9</span>
            <strong>${escapeHtml(context.conversationTitle)}</strong>
            <span class="helper">\uC0C1\uB2F4 \uC138\uC158 \uC2DD\uBCC4\uC6A9 \uC81C\uBAA9</span>
          </article>
          <article class="summary-card accent-violet">
            <span class="label">\uBA54\uC2DC\uC9C0 \uAD6C\uC131</span>
            <strong>${stats.userMessages} / ${stats.botMessages}</strong>
            <span class="helper">\uC0AC\uC6A9\uC790 / AI \uC751\uB2F5</span>
          </article>
          <article class="summary-card accent-amber">
            <span class="label">\uB9E4\uB274\uC5BC \uD6C4\uBCF4</span>
            <strong>${stats.manualReferences}</strong>
            <span class="helper">\uB2F5\uBCC0\uC5D0 \uC5F0\uACB0\uB41C \uCC38\uACE0 \uCE74\uB4DC \uC218</span>
          </article>
          <article class="summary-card accent-slate">
            <span class="label">\uBC94\uC704 / \uC2DC\uAC01</span>
            <strong>${escapeHtml(getScopeLabel(context.scope))}</strong>
            <span class="helper">${escapeHtml(context.exportedAt)}</span>
          </article>
        </div>
      </section>
    `
  }

  if (context.template === "report") {
    return `
      <section class="page-header report-header">
        <div class="header-topline">
          <div class="header-badge report-badge">
            <span class="header-badge-kicker">REPORT PDF</span>
            <strong>BRIEF</strong>
          </div>
          <div class="header-copy">
            <div class="eyebrow">SHAREABLE BRIEF</div>
            <div class="header-caption">\uACF5\uC720\uC640 \uBCF4\uACE0\uC5D0 \uBC14\uB85C \uC4F0\uB294 \uC694\uC57D \uBB38\uC11C</div>
          </div>
        </div>
        <h1>\uCF54\uBE44\uC804 CS AI Core \uACF5\uC720 \uBE0C\uB9AC\uD551 \uC694\uC57D\uBCF8</h1>
        <p class="headline">${escapeHtml(TEMPLATE_HEADLINE[context.template])}</p>
        <div class="report-cover">
          <div class="report-cover-copy">
            <div class="report-cover-kicker">\uBE0C\uB9AC\uD551 \uCEE4\uBC84</div>
            <strong>${escapeHtml(context.conversationTitle)}</strong>
            <p>\uD575\uC2EC \uB0B4\uC6A9\uACFC \uACF5\uC720 \uD3EC\uC778\uD2B8\uB97C \uC9E7\uACE0 \uBC14\uB85C \uC4F8 \uC218 \uC788\uB294 \uD615\uC2DD\uC73C\uB85C \uC815\uB9AC\uD55C \uBCF4\uACE0\uC6A9 \uD45C\uC9C0\uC785\uB2C8\uB2E4.</p>
          </div>
          <div class="report-cover-side">
            ${renderTemplateHeaderVisual("report")}
            <div class="report-deck">
              <div class="report-deck-item">
                <span class="report-deck-label">topic</span>
                <strong>${escapeHtml(context.conversationTitle)}</strong>
              </div>
              <div class="report-deck-item">
                <span class="report-deck-label">audience</span>
                <strong>\uACF5\uC720 / \uBCF4\uACE0</strong>
              </div>
              <div class="report-deck-item">
                <span class="report-deck-label">snapshot</span>
                <strong>${escapeHtml(context.exportedAt)}</strong>
              </div>
            </div>
          </div>
        </div>
        <div class="summary-strip">
          <div><strong>\uB300\uD654 \uC81C\uBAA9</strong><span>${escapeHtml(context.conversationTitle)}</span></div>
          <div><strong>\uC694\uC57D</strong><span>\uC9C8\uC758 ${stats.userMessages}\uAC74 / \uC751\uB2F5 ${stats.botMessages}\uAC74</span></div>
          <div><strong>\uBC94\uC704</strong><span>${escapeHtml(getScopeLabel(context.scope))}</span></div>
        </div>
      </section>
    `
  }

  return `
    <section class="page-header user-header">
      <div class="header-topline">
        <div class="header-badge user-badge">
          <span class="header-badge-kicker">USER PDF</span>
          <strong>Q/A</strong>
        </div>
        <div class="header-copy">
          <div class="eyebrow">COUNSELING RESULT</div>
          <div class="header-caption">\uC0AC\uC6A9\uC790\uAC00 \uBC14\uB85C \uD655\uC778\uD558\uB294 \uC0C1\uB2F4 \uACB0\uACFC \uC815\uB9AC\uBCF8</div>
        </div>
      </div>
      <h1>\uCF54\uBE44\uC804 CS AI Core \uC0AC\uC6A9\uC790 \uC0C1\uB2F4 \uACB0\uACFC\uC11C</h1>
      <p class="headline">${escapeHtml(TEMPLATE_HEADLINE[context.template])}</p>
      <div class="user-hero">
        <div class="user-hero-copy">
          <div class="user-hero-label">\uBC14\uB85C \uBCF4\uB294 \uC548\uB0B4</div>
          <strong>\uD575\uC2EC \uB2F5\uBCC0\uACFC \uCC38\uACE0 \uD654\uBA74\uC744 \uD55C \uBB38\uC11C\uC5D0 \uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.</strong>
          <span>\uC0AC\uC6A9\uC790\uAC00 \uBC14\uB85C \uD655\uC778\uD558\uACE0 \uB530\uB77C\uD560 \uC218 \uC788\uB3C4\uB85D \uC0C1\uB2F4 \uC2DC\uAC01, \uBC94\uC704, \uCC38\uACE0 \uC815\uBCF4\uB97C \uAC04\uACB0\uD558\uAC8C \uBB36\uC5C8\uC2B5\uB2C8\uB2E4.</span>
        </div>
        <div class="user-hero-side">
          ${renderTemplateHeaderVisual("user")}
          <div class="user-pill-list">
            <span class="user-pill">\uC9C8\uBB38 ${stats.userMessages}\uAC74</span>
            <span class="user-pill">\uB2F5\uBCC0 ${stats.botMessages}\uAC74</span>
            <span class="user-pill">${escapeHtml(getScopeLabel(context.scope))}</span>
          </div>
        </div>
      </div>
      <div class="summary-grid user-grid">
        <article class="summary-card large">
          <span class="label">\uB300\uD654 \uC81C\uBAA9</span>
          <strong>${escapeHtml(context.conversationTitle)}</strong>
          <span class="helper">\uCC98\uC74C \uC9C8\uBB38\uC744 \uAE30\uC900\uC73C\uB85C \uC0DD\uC131\uB41C \uC81C\uBAA9\uC785\uB2C8\uB2E4.</span>
        </article>
        <article class="summary-card">
          <span class="label">\uBA54\uC2DC\uC9C0 \uC218</span>
          <strong>${stats.totalMessages}</strong>
          <span class="helper">\uC774\uBC88 \uC0C1\uB2F4\uC5D0 \uD3EC\uD568\uB41C \uC804\uCCB4 \uBA54\uC2DC\uC9C0</span>
        </article>
        <article class="summary-card">
          <span class="label">\uBC94\uC704</span>
          <strong>${escapeHtml(getScopeLabel(context.scope))}</strong>
          <span class="helper">${escapeHtml(context.exportedAt)}</span>
        </article>
      </div>
    </section>
  `
}

function renderPrintableMessage(message: Message, context: ExportContext): string {
  const link = absoluteUrl(message.linkUrl)
  const manualBlock = renderManualSources(message, context)
  const candidateBlock = context.template === "operator" ? renderTopCandidates(message, context) : ""
  const templateClass = `${context.template}-${message.sender}`
  const briefBlock = context.template === "report" ? renderReportBrief(message) : ""
  const spotlightBlock =
    message.sender === "bot" && (context.template === "user" || context.template === "report")
      ? renderManualSpotlight(message, context)
      : ""
  const diagnosticBlock = renderOperatorDiagnostics(message, context)

  return `
    <section class="message ${message.sender} ${templateClass}">
      <div class="message-head">
        <div class="identity">
          <div class="sender">${escapeHtml(formatSender(message, context.template))}</div>
          <div class="timestamp">${escapeHtml(formatMessageDateTime(message.timestamp))}</div>
        </div>
        <div class="meta-chips">${renderMetaChips(message, context)}</div>
      </div>
      ${briefBlock}
      ${renderMessageContentHtml(message, context)}
      ${link ? `<div class="link-row"><strong>\uCC38\uACE0 \uB9C1\uD06C</strong><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a></div>` : ""}
      ${spotlightBlock}
      ${diagnosticBlock}
      ${manualBlock}
      ${candidateBlock}
    </section>
  `
}
function buildPrintableHtml(messages: Message[], context: ExportContext): string {
  const stats = collectStats(messages)
  const items = messages.map((message) => renderPrintableMessage(message, context)).join("")

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(context.conversationTitle)} - \uCF54\uBE44\uC804 CS AI Core \uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30</title>
  <style>
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      line-height: 1.6;
      background: #f6f8fc;
    }
    body.template-user {
      background: linear-gradient(180deg, #f7fbff 0%, #eef4ff 100%);
    }
    body.template-operator {
      background: #f3f5f9;
    }
    body.template-report {
      background: #faf9f6;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
    }
    .eyebrow {
      font-size: 10px;
      letter-spacing: 0.22em;
      font-weight: 700;
      text-transform: uppercase;
      color: #5b6b86;
      margin-bottom: 10px;
    }
    .page-header {
      margin-bottom: 24px;
      padding: 22px 24px;
      border-radius: 24px;
      page-break-inside: avoid;
    }
    .page-header h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.24;
    }
    .header-topline {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 12px;
    }
    .header-copy {
      min-width: 0;
      flex: 1;
    }
    .header-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 180px;
      gap: 18px;
      align-items: stretch;
      margin-top: 18px;
    }
    .header-caption {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #64748b;
    }
    .header-badge {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 2px;
      min-width: 86px;
      padding: 10px 12px;
      border-radius: 18px;
      border: 1px solid transparent;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
    }
    .header-badge-kicker {
      font-size: 9px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      opacity: 0.8;
    }
    .header-badge strong {
      font-size: 20px;
      line-height: 1;
      letter-spacing: 0.04em;
    }
    .header-visual {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 150px;
      border-radius: 22px;
      border: 1px solid transparent;
      overflow: hidden;
    }
    .header-visual svg {
      width: 100%;
      height: auto;
      max-width: 132px;
    }
    .headline {
      margin: 10px 0 0;
      font-size: 13px;
      color: #4f5d75;
    }
    .user-hero,
    .operator-callout,
    .report-deck {
      margin-top: 18px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .user-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.7fr);
      gap: 16px;
      padding: 16px 18px;
      border: 1px solid #cfe0ff;
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(239, 246, 255, 0.92), rgba(255, 255, 255, 0.98));
    }
    .user-hero-label,
    .operator-callout-label,
    .report-deck-label {
      display: inline-flex;
      margin-bottom: 8px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .user-hero-label {
      color: #2563eb;
    }
    .user-hero-copy strong {
      display: block;
      margin-bottom: 8px;
      font-size: 16px;
      line-height: 1.45;
      color: #15315f;
    }
    .user-hero-copy span {
      display: block;
      font-size: 12px;
      color: #4f6b95;
    }
    .user-hero-side {
      display: flex;
      flex-direction: column;
      gap: 12px;
      justify-content: center;
    }
    .user-pill-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      justify-content: center;
    }
    .user-pill {
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      padding: 0 14px;
      border-radius: 999px;
      border: 1px solid #bfdbfe;
      background: rgba(255, 255, 255, 0.86);
      font-size: 12px;
      font-weight: 700;
      color: #1d4ed8;
    }
    .operator-visual {
      border-color: rgba(96, 165, 250, 0.16);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.22), rgba(15, 23, 42, 0.06));
    }
    .operator-callout {
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(96, 165, 250, 0.24);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.26), rgba(15, 23, 42, 0.12));
    }
    .operator-callout-label {
      color: #93c5fd;
    }
    .operator-callout-body {
      font-size: 12px;
      color: rgba(226, 232, 240, 0.92);
    }
    .report-cover {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
      gap: 18px;
      margin-top: 18px;
      padding: 18px;
      border-radius: 24px;
      border: 1px solid #e5d7bf;
      background: linear-gradient(135deg, rgba(255, 252, 246, 0.96), rgba(248, 240, 226, 0.94));
      box-shadow: 0 14px 28px rgba(122, 104, 81, 0.08);
    }
    .report-cover-kicker {
      display: inline-flex;
      margin-bottom: 8px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #8a6a38;
    }
    .report-cover-copy strong {
      display: block;
      font-size: 24px;
      line-height: 1.32;
      color: #4d3920;
    }
    .report-cover-copy p {
      margin: 12px 0 0;
      font-size: 12px;
      color: #7a6851;
    }
    .report-cover-side {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .report-visual {
      min-height: 164px;
      border-color: rgba(182, 138, 74, 0.18);
      background: linear-gradient(180deg, rgba(255, 248, 238, 0.96), rgba(255, 255, 255, 0.9));
    }
    .report-deck {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .report-deck-item {
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid #e7d9bf;
      background: rgba(255, 253, 248, 0.92);
    }
    .report-deck-label {
      color: #8a6a38;
    }
    .report-deck-item strong {
      display: block;
      font-size: 14px;
      line-height: 1.45;
      color: #4d3920;
    }
    .user-visual {
      min-height: 152px;
      border-color: rgba(96, 165, 250, 0.18);
      background: linear-gradient(180deg, rgba(239, 246, 255, 0.96), rgba(255, 255, 255, 0.88));
    }
    .user-badge {
      background: linear-gradient(135deg, #2563eb, #60a5fa);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.55);
    }
    .user-header {
      position: relative;
      overflow: hidden;
      border: 1px solid #d7e5ff;
      background:
        radial-gradient(circle at top right, rgba(96, 165, 250, 0.22), transparent 32%),
        linear-gradient(135deg, #ffffff 0%, #edf5ff 55%, #f6f9ff 100%);
      box-shadow: 0 18px 34px rgba(57, 110, 193, 0.08);
    }
    .user-header::after {
      content: "";
      position: absolute;
      right: -48px;
      top: -58px;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: rgba(191, 219, 254, 0.45);
      filter: blur(6px);
    }
    .user-header .header-caption {
      color: #4f6b95;
    }
    .operator-badge {
      background: linear-gradient(135deg, #0f172a, #1d4ed8);
      color: #f8fafc;
      border-color: rgba(148, 163, 184, 0.35);
    }
    .operator-header {
      position: relative;
      overflow: hidden;
      border: 1px solid #dbe1ea;
      background:
        radial-gradient(circle at top right, rgba(37, 99, 235, 0.22), transparent 28%),
        linear-gradient(145deg, #0f172a 0%, #111827 38%, #1f2937 100%);
      color: #f8fafc;
      box-shadow: 0 24px 48px rgba(15, 23, 42, 0.22);
    }
    .operator-header::after {
      content: "";
      position: absolute;
      inset: auto 24px 0 auto;
      width: 180px;
      height: 2px;
      background: linear-gradient(90deg, rgba(37, 99, 235, 0), rgba(96, 165, 250, 0.82));
    }
    .operator-header .eyebrow,
    .operator-header .headline,
    .operator-header .header-caption {
      color: rgba(226, 232, 240, 0.82);
    }
    .report-badge {
      background: linear-gradient(135deg, #fff7e8, #f2d29a);
      color: #7c5e32;
      border-color: rgba(138, 106, 56, 0.18);
    }
    .report-header {
      position: relative;
      overflow: hidden;
      border: 1px solid #e5ddcf;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(255, 255, 255, 0)),
        linear-gradient(180deg, #fffdfa 0%, #f6f0e6 100%);
      box-shadow: 0 16px 34px rgba(102, 84, 59, 0.08);
    }
    .report-header::before {
      content: "";
      position: absolute;
      left: 24px;
      top: 24px;
      bottom: 24px;
      width: 4px;
      border-radius: 999px;
      background: linear-gradient(180deg, #d6b98b, #8a6a38);
    }
    .report-header h1,
    .report-header .headline,
    .report-header .summary-strip,
    .report-header .header-topline {
      position: relative;
      margin-left: 18px;
    }
    .report-header .header-caption {
      color: #8a6a38;
    }
    .summary-grid {
      display: grid;
      gap: 14px;
      margin-top: 18px;
    }
    .user-grid {
      grid-template-columns: 1.5fr 1fr 1fr;
    }
    .operator-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .summary-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 112px;
      padding: 16px 18px;
      border-radius: 20px;
      border: 1px solid #dbe3ef;
      background: rgba(255, 255, 255, 0.82);
    }
    .summary-card.large {
      min-height: 128px;
    }
    .summary-card .label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #5b6b86;
    }
    .summary-card strong {
      font-size: 20px;
      line-height: 1.35;
    }
    .summary-card .helper {
      margin-top: auto;
      font-size: 11px;
      color: #64748b;
    }
    .operator-grid .summary-card {
      min-height: 132px;
      background: rgba(15, 23, 42, 0.28);
      border-color: rgba(148, 163, 184, 0.2);
    }
    .operator-grid .summary-card .label,
    .operator-grid .summary-card .helper {
      color: rgba(226, 232, 240, 0.8);
    }
    .operator-grid .summary-card strong {
      color: #ffffff;
      font-size: 18px;
    }
    .accent-blue { box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.24); }
    .accent-violet { box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.24); }
    .accent-amber { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.24); }
    .accent-slate { box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.24); }
    .summary-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0;
      margin-top: 18px;
      overflow: hidden;
      border: 1px solid #e5ddcf;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.7);
    }
    .summary-strip > div {
      padding: 14px 16px;
      border-right: 1px solid #ece3d6;
    }
    .summary-strip > div:last-child {
      border-right: none;
    }
    .summary-strip strong {
      display: block;
      margin-bottom: 6px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7a6851;
    }
    .summary-strip span {
      font-size: 14px;
      color: #2b2d31;
    }
    .messages {
      display: block;
    }
    .messages.report-layout {
      padding-left: 18px;
      border-left: 2px solid #ddcfba;
    }
    .messages > .message + .message {
      margin-top: 16px;
    }
    .message {
      border-radius: 22px;
      break-inside: auto;
      page-break-inside: auto;
    }
    .template-user-user,
    .template-user-bot {
      padding: 18px 20px;
      border: 1px solid #d9e5f7;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 12px 26px rgba(36, 79, 164, 0.08);
    }
    .template-user-user {
      border-color: #cfe0ff;
      background: linear-gradient(180deg, #f3f8ff, #ffffff);
    }
    .template-user-bot {
      position: relative;
      overflow: hidden;
      border-left: 6px solid #60a5fa;
      background:
        radial-gradient(circle at top right, rgba(191, 219, 254, 0.45), transparent 24%),
        rgba(255, 255, 255, 0.96);
    }
    .template-operator-user,
    .template-operator-bot {
      padding: 16px 18px;
      border: 1px solid #d8dee9;
      background: #ffffff;
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
    }
    .template-operator-user {
      background: linear-gradient(180deg, #f8fafc, #eef2f7);
    }
    .template-operator-bot {
      position: relative;
      overflow: hidden;
      border-top: 5px solid #2563eb;
      background:
        linear-gradient(180deg, rgba(219, 234, 254, 0.42), rgba(255, 255, 255, 0)),
        linear-gradient(180deg, #ffffff, #f8fbff);
    }
    .template-operator-bot::after {
      content: "";
      position: absolute;
      right: 18px;
      top: 18px;
      width: 72px;
      height: 72px;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: linear-gradient(145deg, rgba(37, 99, 235, 0.07), rgba(15, 23, 42, 0.02));
    }
    .template-report-user,
    .template-report-bot {
      position: relative;
      padding: 18px 20px;
      border: 1px solid #e8ddca;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 10px 24px rgba(94, 76, 51, 0.08);
    }
    .template-report-user::before,
    .template-report-bot::before {
      content: "";
      position: absolute;
      left: -28px;
      top: 28px;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #caa96a;
      box-shadow: 0 0 0 5px #faf9f6;
    }
    .template-report-bot::before {
      background: #2563eb;
    }
    .template-report-bot::after {
      content: "";
      position: absolute;
      left: 20px;
      right: 20px;
      top: 0;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(37, 99, 235, 0.1), rgba(124, 94, 50, 0.72), rgba(37, 99, 235, 0.1));
    }
    .message-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
      align-items: flex-start;
    }
    .identity {
      min-width: 0;
    }
    .sender {
      font-size: 13px;
      font-weight: 800;
      color: #1d4ed8;
    }
    .template-report-user .sender,
    .template-report-bot .sender {
      color: #3a2f1e;
    }
    .template-report-bot .sender {
      color: #1e40af;
    }
    .timestamp {
      margin-top: 2px;
      font-size: 11px;
      color: #64748b;
    }
    .meta-chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .chip {
      display: inline-flex;
      margin-left: 6px;
      margin-bottom: 6px;
      padding: 4px 8px;
      border: 1px solid #d8e4f2;
      border-radius: 999px;
      background: #f8fbff;
      font-size: 10px;
      color: #475569;
      white-space: nowrap;
    }
    .template-operator-bot .chip {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .content.raw,
    .answer-section-body,
    .source-preview,
    .candidate-list p {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .structured {
      display: grid;
      gap: 10px;
    }
    .answer-section {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid #dbe3ef;
      background: #f8fbff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .tone-core {
      border-color: #bfdbfe;
      background: linear-gradient(180deg, #edf5ff, #ffffff);
    }
    .tone-howto {
      border-color: #c7d2fe;
      background: linear-gradient(180deg, #f5f7ff, #ffffff);
    }
    .tone-checkpoint {
      border-color: #bbf7d0;
      background: linear-gradient(180deg, #f2fbf5, #ffffff);
    }
    .tone-reference {
      border-color: #fde68a;
      background: linear-gradient(180deg, #fff9e8, #ffffff);
    }
    .template-user-bot .answer-section:nth-child(1) {
      background: linear-gradient(180deg, #eef6ff, #ffffff);
      border-color: #bfdbfe;
    }
    .template-user-bot .answer-section:nth-child(2) {
      background: linear-gradient(180deg, #f8fbff, #ffffff);
    }
    .template-user-bot .answer-section:nth-child(3) {
      background: linear-gradient(180deg, #f5fbf7, #ffffff);
      border-color: #bbf7d0;
    }
    .template-report-bot .answer-section {
      background: linear-gradient(180deg, #fffdf7, #fffaf0);
      border-color: #eadfce;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
    }
    .answer-section-title {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 800;
      color: #2563eb;
    }
    .answer-section-title::before {
      content: "";
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: linear-gradient(135deg, #2563eb, #60a5fa);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
      flex: 0 0 auto;
    }
    .template-user-bot .answer-section-title {
      color: #1d4ed8;
      border-bottom-color: rgba(96, 165, 250, 0.2);
    }
    .template-user-bot .answer-section-title::before {
      background: linear-gradient(135deg, #2563eb, #93c5fd);
    }
    .template-operator-bot .answer-section-title {
      color: #1e3a8a;
      border-bottom-style: dashed;
      border-bottom-color: rgba(37, 99, 235, 0.26);
    }
    .template-operator-bot .answer-section-title::before {
      width: 28px;
      height: 18px;
      border-radius: 8px;
      background: linear-gradient(135deg, #0f172a, #2563eb);
      box-shadow: inset 0 0 0 1px rgba(191, 219, 254, 0.3);
    }
    .template-report-bot .answer-section-title {
      color: #7c5e32;
      border-bottom-color: rgba(182, 138, 74, 0.28);
    }
    .template-report-bot .answer-section-title::before {
      width: 24px;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(90deg, #b68a4a, #ead4a6);
      box-shadow: none;
    }
    .answer-section-body {
      font-size: 12px;
      color: #172033;
    }
    .link-row {
      margin-top: 12px;
      font-size: 12px;
      word-break: break-all;
    }
    .link-row strong {
      margin-right: 8px;
    }
    .link-row a,
    .source-body a {
      color: #1d4ed8;
      text-decoration: none;
    }
    .source-block {
      margin-top: 14px;
      padding: 14px 16px;
      border: 1px solid #dbe3ef;
      border-radius: 18px;
      background: #fcfdff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .template-user-bot .source-block {
      background: linear-gradient(180deg, #f2f8ff, #ffffff);
      border-color: #cfe0ff;
      box-shadow: 0 8px 22px rgba(96, 165, 250, 0.08);
    }
    .template-operator-bot .source-block {
      background: linear-gradient(180deg, #f8fafc, #eef4fb);
      border-color: #cbd5e1;
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.04);
    }
    .template-report-bot .source-block {
      background: linear-gradient(180deg, #fffdfa, #fff7ea);
      border-color: #eadfce;
      box-shadow: 0 8px 18px rgba(148, 109, 52, 0.06);
    }
    .source-block h4 {
      margin: 0 0 10px;
      font-size: 12px;
      color: #0f172a;
    }
    .source-list,
    .candidate-list {
      margin: 0;
      padding-left: 18px;
    }
    .source-list li,
    .candidate-list li {
      margin-bottom: 12px;
      font-size: 11px;
    }
    .source-title {
      font-weight: 700;
      color: #172033;
      margin-bottom: 4px;
    }
    .source-version {
      color: #64748b;
      font-weight: 500;
      font-size: 10px;
    }
    .source-body {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      color: #475569;
      margin-bottom: 6px;
    }
    .manual-preview {
      display: block;
      max-width: 100%;
      max-height: 360px;
      margin-top: 10px;
      border: 1px solid #d8e4f2;
      border-radius: 14px;
      object-fit: contain;
      background: #ffffff;
    }
    .template-user-bot .manual-preview {
      max-height: 420px;
      box-shadow: 0 10px 26px rgba(51, 99, 173, 0.1);
    }
    .template-operator-bot .manual-preview {
      max-height: 260px;
      border-radius: 10px;
      border-color: #cbd5e1;
    }
    .template-report-bot .manual-preview {
      max-height: 300px;
      border-color: #e5d7bf;
      box-shadow: 0 8px 22px rgba(122, 104, 81, 0.08);
      background: #fffdfa;
    }
    .manual-spotlight,
    .diagnostic-block,
    .brief-block {
      margin-top: 14px;
      border-radius: 18px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .manual-spotlight {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr);
      gap: 16px;
      padding: 16px;
      border: 1px solid #d6e5ff;
      background: linear-gradient(180deg, #eff6ff, #ffffff);
    }
    .template-user-bot .manual-spotlight {
      border-color: #bfdbfe;
      background: linear-gradient(180deg, #eaf3ff, #ffffff);
      box-shadow: 0 14px 30px rgba(59, 130, 246, 0.1);
    }
    .template-report-bot .manual-spotlight {
      border-color: #e5d7bf;
      background: linear-gradient(180deg, #fff8ee, #fffdfa);
      box-shadow: 0 12px 26px rgba(148, 109, 52, 0.08);
    }
    .manual-spotlight-label,
    .brief-label {
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #2563eb;
    }
    .manual-spotlight h4,
    .diagnostic-block h4 {
      margin: 0 0 8px;
      font-size: 15px;
    }
    .manual-spotlight p {
      margin: 0;
      font-size: 12px;
      color: #334155;
      white-space: pre-wrap;
    }
    .manual-spotlight-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      margin-top: 10px;
      font-size: 11px;
      color: #475569;
    }
    .manual-spotlight-meta a {
      color: #1d4ed8;
      text-decoration: none;
    }
    .manual-spotlight-image {
      width: 100%;
      max-height: 260px;
      border: 1px solid #dbe3ef;
      border-radius: 14px;
      object-fit: contain;
      background: #ffffff;
    }
    .diagnostic-block {
      padding: 14px 16px;
      border: 1px solid #dbe3ef;
      background: #f8fafc;
    }
    .template-operator-bot .diagnostic-block {
      border-color: #c7d2fe;
      background: linear-gradient(180deg, #eef4ff, #f8fbff);
      box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.06);
    }
    .diagnostic-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 0;
    }
    .diagnostic-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 12px;
    }
    .legend-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
    }
    .diagnostic-item {
      padding: 10px 12px;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
    }
    .priority-good {
      background: rgba(220, 252, 231, 0.9);
      border-color: rgba(34, 197, 94, 0.24);
      color: #166534;
    }
    .priority-medium {
      background: rgba(254, 249, 195, 0.9);
      border-color: rgba(234, 179, 8, 0.24);
      color: #854d0e;
    }
    .priority-high {
      background: rgba(255, 237, 213, 0.92);
      border-color: rgba(249, 115, 22, 0.24);
      color: #9a3412;
    }
    .priority-critical {
      background: rgba(254, 226, 226, 0.92);
      border-color: rgba(239, 68, 68, 0.24);
      color: #991b1b;
    }
    .priority-neutral {
      background: rgba(241, 245, 249, 0.92);
      border-color: rgba(148, 163, 184, 0.24);
      color: #475569;
    }
    .diagnostic-item.priority-good {
      background: linear-gradient(180deg, rgba(220, 252, 231, 0.85), #ffffff);
      border-color: rgba(34, 197, 94, 0.26);
    }
    .diagnostic-item.priority-medium {
      background: linear-gradient(180deg, rgba(254, 249, 195, 0.82), #ffffff);
      border-color: rgba(234, 179, 8, 0.28);
    }
    .diagnostic-item.priority-high {
      background: linear-gradient(180deg, rgba(255, 237, 213, 0.88), #ffffff);
      border-color: rgba(249, 115, 22, 0.28);
    }
    .diagnostic-item.priority-critical {
      background: linear-gradient(180deg, rgba(254, 226, 226, 0.9), #ffffff);
      border-color: rgba(239, 68, 68, 0.32);
    }
    .diagnostic-item.priority-neutral {
      background: linear-gradient(180deg, rgba(241, 245, 249, 0.94), #ffffff);
      border-color: rgba(148, 163, 184, 0.24);
    }
    .diagnostic-item dt {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
    }
    .diagnostic-item dd {
      margin: 6px 0 0;
      font-size: 12px;
      color: #0f172a;
    }
    .brief-block {
      padding: 14px 16px;
      border: 1px solid #e9dcc7;
      background: linear-gradient(180deg, #fffdfa, #ffffff);
    }
    .template-report-bot .brief-block {
      position: relative;
      overflow: hidden;
      border-color: #dcc3a0;
      background: linear-gradient(180deg, #fff9f0, #ffffff);
      box-shadow: 0 12px 22px rgba(122, 104, 81, 0.07);
    }
    .template-report-bot .brief-block::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: linear-gradient(180deg, #b68a4a, #e6c790);
    }
    .brief-core {
      font-size: 13px;
      font-weight: 600;
      color: #2b2d31;
      white-space: pre-wrap;
    }
    .brief-points {
      margin: 12px 0 0;
      padding-left: 18px;
      font-size: 12px;
      color: #475569;
    }
    .brief-points li + li {
      margin-top: 6px;
    }
    .answer-overflow-note {
      font-size: 11px;
      color: #64748b;
    }
    .candidate-list strong {
      display: block;
      margin-bottom: 4px;
    }
    .candidate-list span {
      display: inline-block;
      margin-right: 10px;
      color: #475569;
      font-size: 10px;
    }
    @media print {
      body {
        background: #ffffff;
      }
      .page-header,
      .message {
        box-shadow: none !important;
      }
      .messages > .message + .message {
        margin-top: 12px;
      }
    }
    @media (max-width: 900px) {
      .header-split,
      .report-cover,
      .user-hero,
      .report-deck {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body class="template-${context.template}">
  <main>
    ${renderTemplateHeader(context, stats)}
    <section class="messages ${context.template === "operator" ? "operator-layout" : context.template === "report" ? "report-layout" : "default-layout"}">
      ${items}
    </section>
  </main>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      setTimeout(() => window.print(), 250);
    });
  </script>
</body>
</html>`
}

function downloadFile(content: string, fileName: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openPrintWindow(content: string): void {
  const printWindow = window.open("", "_blank", "width=1160,height=860")
  if (!printWindow) {
    throw new Error("\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC778\uC1C4 \uCC3D\uC744 \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uD31D\uC5C5 \uCC28\uB2E8 \uC124\uC815\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.")
  }

  printWindow.document.open()
  printWindow.document.write(content)
  printWindow.document.close()
}

export function exportChatMessages(messages: Message[], request: ChatExportFormat | ChatExportRequest): string {
  const normalized = normalizeChatExportRequest(request)
  const fileStem = `${createFileStem()}_${normalized.template}`
  const exportMessages = resolveExportMessages(messages, normalized.scope)
  const context: ExportContext = {
    template: normalized.template,
    exportedAt: formatExportedAt(),
    conversationTitle: getConversationTitle(exportMessages),
    scope: normalized.scope,
    includeSources: normalized.includeSources,
    includeDiagnostics: normalized.includeDiagnostics,
    includeManualPreviews: normalized.includeManualPreviews,
  }

  if (normalized.format === "md") {
    const fileName = `${fileStem}.md`
    downloadFile(buildMarkdown(exportMessages, context), fileName, "text/markdown;charset=utf-8")
    return fileName
  }

  if (normalized.format === "pdf") {
    openPrintWindow(buildPrintableHtml(exportMessages, context))
    return "\uC778\uC1C4 \uD654\uBA74"
  }

  const fileName = `${fileStem}.txt`
  downloadFile(buildPlainText(exportMessages, context), fileName, "text/plain;charset=utf-8")
  return fileName
}

export function getChatExportFormatLabel(format: ChatExportFormat): string {
  return FORMAT_LABEL[format]
}

export function getChatExportTemplateLabel(template: ChatExportTemplate): string {
  return TEMPLATE_LABEL[template]
}

export function getChatExportTemplateDescription(template: ChatExportTemplate): string {
  return TEMPLATE_DESCRIPTION[template]
}

export function getChatExportScopeLabel(scope: ChatExportScope): string {
  return SCOPE_LABEL[scope]
}
