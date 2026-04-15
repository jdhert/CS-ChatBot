import type { CandidateCard, ManualCandidateCard, Message } from "@/components/chatbot/chat-message"

export type ChatExportFormat = "txt" | "md" | "pdf"
export type ChatExportTemplate = "user" | "operator" | "report"

export interface ChatExportRequest {
  format: ChatExportFormat
  template?: ChatExportTemplate
}

const FORMAT_LABEL: Record<ChatExportFormat, string> = {
  txt: "텍스트",
  md: "Markdown",
  pdf: "PDF 인쇄",
}

const TEMPLATE_LABEL: Record<ChatExportTemplate, string> = {
  user: "사용자용",
  operator: "운영자용",
  report: "보고용",
}

const TEMPLATE_DESCRIPTION: Record<ChatExportTemplate, string> = {
  user: "질문과 답변 중심",
  operator: "출처와 진단 정보 포함",
  report: "공유용 요약 포맷",
}

const ANSWER_SOURCE_LABEL: Record<string, string> = {
  llm: "LLM 답변",
  deterministic_fallback: "이력 기반 답변",
  rule_only: "규칙 기반 답변",
  manual: "매뉴얼 답변",
  clarification: "추가 정보 필요",
  no_match: "유사 이력 없음",
  proxy_error: "연결 오류",
}

const RETRIEVAL_MODE_LABEL: Record<string, string> = {
  hybrid: "하이브리드 검색",
  rule_only: "규칙 검색",
  manual: "매뉴얼 검색",
}

const STRUCTURED_SECTION_TITLES = [
  "핵심 답변",
  "핵심 안내",
  "적용 방법",
  "진행 방법",
  "확인 포인트",
  "체크 포인트",
  "참고 링크",
  "참고 사항",
  "주요 내용",
] as const

interface ParsedAnswerSection {
  title: string
  body: string
}

interface ExportContext {
  template: ChatExportTemplate
  exportedAt: string
  conversationTitle: string
}

function normalizeChatExportRequest(request: ChatExportFormat | ChatExportRequest = "txt"): Required<ChatExportRequest> {
  if (typeof request === "string") {
    return { format: request, template: "user" }
  }

  return {
    format: request.format,
    template: request.template ?? "user",
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

function formatSender(message: Message): string {
  return message.sender === "user" ? "사용자" : message.title ?? "AI Core"
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
  if (!firstUserMessage) return "코비전 CS AI Core 대화"
  return trimConversationTitle(firstUserMessage.content)
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
          .replace(/^[:：\-]\s*/, "")
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
      currentTitle = "핵심 안내"
    }
    currentBody.push(line)
  }

  flush()

  if (sections.length <= 1) {
    return []
  }

  return sections.filter((section) => section.body.length > 0)
}

function collectMessageMeta(message: Message, template: ChatExportTemplate): string[] {
  const meta: string[] = []
  const answerSource = getAnswerSourceLabel(message.answerSource)
  const retrievalMode = getRetrievalModeLabel(message.retrievalMode)
  const confidence = formatConfidence(message.confidence)

  if (answerSource) meta.push(`답변 출처: ${answerSource}`)
  if (retrievalMode) meta.push(`검색 방식: ${retrievalMode}`)
  if (confidence) meta.push(`신뢰도: ${confidence}`)
  if (template === "operator" && message.logId) meta.push(`로그 ID: ${message.logId}`)

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
    "=== 코비전 CS AI Core 대화 내보내기 ===",
    `대화 제목: ${context.conversationTitle}`,
    `템플릿: ${getChatExportTemplateLabel(context.template)} (${TEMPLATE_DESCRIPTION[context.template]})`,
    `내보낸 시각: ${context.exportedAt}`,
    `메시지 수: ${messages.length}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`[${formatMessageTime(message.timestamp)}] ${formatSender(message)}`)
    lines.push(...renderStructuredSectionsAsPlainText(message.content))

    const meta = collectMessageMeta(message, context.template)
    if (meta.length > 0) {
      lines.push("")
      lines.push("출처 정보")
      lines.push(...meta.map((item) => `- ${item}`))
    }

    const manualLines = collectManualSourceLines(message.manualCandidates, context.template)
    if (manualLines.length > 0) {
      lines.push("")
      lines.push("매뉴얼 참고")
      lines.push(...manualLines.map((item) => `- ${item}`))
    }

    if (context.template === "operator") {
      const candidateLines = collectTopCandidateLines(message.top3Candidates)
      if (candidateLines.length > 0) {
        lines.push("")
        lines.push("상위 후보")
        lines.push(...candidateLines.map((item) => `- ${item}`))
      }
    }

    if (message.linkUrl) {
      lines.push("")
      lines.push(`참고 링크: ${absoluteUrl(message.linkUrl) ?? message.linkUrl}`)
    }

    lines.push("")
  }

  return lines.join("\n")
}

function buildMarkdown(messages: Message[], context: ExportContext): string {
  const lines: string[] = [
    "# 코비전 CS AI Core 대화 내보내기",
    "",
    `- 대화 제목: ${context.conversationTitle}`,
    `- 템플릿: ${getChatExportTemplateLabel(context.template)} (${TEMPLATE_DESCRIPTION[context.template]})`,
    `- 내보낸 시각: ${context.exportedAt}`,
    `- 메시지 수: ${messages.length}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`## [${formatMessageTime(message.timestamp)}] ${formatSender(message)}`)
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

    const meta = collectMessageMeta(message, context.template)
    if (meta.length > 0) {
      lines.push("### 출처 정보")
      lines.push("")
      lines.push(...meta.map((item) => `- ${item}`))
      lines.push("")
    }

    const manualLines = collectManualSourceLines(message.manualCandidates, context.template)
    if (manualLines.length > 0) {
      lines.push("### 매뉴얼 참고")
      lines.push("")
      lines.push(...manualLines.map((item) => `- ${item}`))
      lines.push("")
    }

    if (context.template === "operator") {
      const candidateLines = collectTopCandidateLines(message.top3Candidates)
      if (candidateLines.length > 0) {
        lines.push("### 상위 후보")
        lines.push("")
        lines.push(...candidateLines.map((item) => `- ${item}`))
        lines.push("")
      }
    }

    if (message.linkUrl) {
      lines.push(`- 참고 링크: ${absoluteUrl(message.linkUrl) ?? message.linkUrl}`)
      lines.push("")
    }
  }

  return lines.join("\n")
}

function renderMetaChips(message: Message, template: ChatExportTemplate): string {
  return collectMessageMeta(message, template)
    .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
    .join("")
}

function renderManualSources(message: Message, template: ChatExportTemplate): string {
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
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">원문 링크</a>` : ""}
          </div>
          <div class="source-preview">${escapeHtml(candidate.previewText)}</div>
          ${previewImage ? `<img class="manual-preview" src="${escapeHtml(previewImage)}" alt="${escapeHtml(candidate.title)} 미리보기" />` : ""}
        </li>
      `
    })
    .join("")

  return `
    <section class="source-block">
      <h4>매뉴얼 참고</h4>
      <ul class="source-list">${items}</ul>
    </section>
  `
}

function renderTopCandidates(message: Message): string {
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
      <h4>상위 후보</h4>
      <ul class="candidate-list">${items}</ul>
    </section>
  `
}

function renderMessageContentHtml(message: Message): string {
  const sections = parseStructuredAnswerSections(message.content)
  if (sections.length === 0) {
    return `<div class="content raw">${escapeHtml(message.content).replace(/\n/g, "<br />")}</div>`
  }

  return `
    <div class="content structured">
      ${sections
        .map(
          (section, index) => `
            <section class="answer-section">
              <div class="answer-section-title">${index + 1}. ${escapeHtml(section.title)}</div>
              <div class="answer-section-body">${escapeHtml(section.body).replace(/\n/g, "<br />")}</div>
            </section>
          `,
        )
        .join("")}
    </div>
  `
}

function buildPrintableHtml(messages: Message[], context: ExportContext): string {
  const items = messages
    .map((message) => {
      const link = absoluteUrl(message.linkUrl)
      return `
        <section class="message ${message.sender}">
          <div class="message-head">
            <div>
              <div class="sender">${escapeHtml(formatSender(message))}</div>
              <div class="timestamp">${escapeHtml(formatMessageDateTime(message.timestamp))}</div>
            </div>
            ${renderMetaChips(message, context.template)}
          </div>
          ${renderMessageContentHtml(message)}
          ${link ? `<div class="link-row"><strong>참고 링크</strong><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a></div>` : ""}
          ${renderManualSources(message, context.template)}
          ${context.template === "operator" ? renderTopCandidates(message) : ""}
        </section>
      `
    })
    .join("")

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(context.conversationTitle)} - 코비전 CS AI Core 대화 내보내기</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      background: #f8fbff;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      line-height: 1.6;
    }
    main { max-width: 960px; margin: 0 auto; }
    .page-header {
      margin-bottom: 24px;
      padding: 18px 20px;
      border: 1px solid #d8e4f2;
      border-radius: 20px;
      background: linear-gradient(135deg, #ffffff, #eef6ff);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.3;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 16px;
      font-size: 12px;
      color: #475569;
    }
    .message {
      margin-bottom: 16px;
      padding: 16px 18px;
      border: 1px solid #dbe3ef;
      border-radius: 18px;
      background: #ffffff;
      page-break-inside: avoid;
    }
    .message.user {
      border-color: #cfe0ff;
      background: #eff6ff;
    }
    .message-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    .sender {
      font-size: 13px;
      font-weight: 700;
      color: #1d4ed8;
    }
    .timestamp {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
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
      border: 1px solid #d8e4f2;
      border-radius: 14px;
      background: #f8fbff;
    }
    .answer-section-title {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 700;
      color: #2563eb;
    }
    .answer-section-body {
      font-size: 12px;
    }
    .link-row {
      margin-top: 12px;
      font-size: 12px;
      word-break: break-all;
    }
    .link-row strong { margin-right: 8px; }
    .link-row a,
    .source-body a {
      color: #1d4ed8;
      text-decoration: none;
    }
    .source-block {
      margin-top: 14px;
      padding: 12px 14px;
      border: 1px solid #d8e4f2;
      border-radius: 14px;
      background: #fcfdff;
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
      margin-bottom: 10px;
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
      margin-top: 8px;
      border: 1px solid #d8e4f2;
      border-radius: 12px;
      object-fit: contain;
      background: #ffffff;
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
  </style>
</head>
<body>
  <main>
    <section class="page-header">
      <h1>코비전 CS AI Core 대화 내보내기</h1>
      <div class="summary">
        <div><strong>대화 제목</strong> ${escapeHtml(context.conversationTitle)}</div>
        <div><strong>템플릿</strong> ${escapeHtml(getChatExportTemplateLabel(context.template))}</div>
        <div><strong>설명</strong> ${escapeHtml(TEMPLATE_DESCRIPTION[context.template])}</div>
        <div><strong>내보낸 시각</strong> ${escapeHtml(context.exportedAt)}</div>
      </div>
    </section>
    ${items}
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
  const printWindow = window.open("", "_blank", "width=1100,height=820")
  if (!printWindow) {
    throw new Error("브라우저에서 인쇄 창을 열지 못했습니다. 팝업 차단 설정을 확인해 주세요.")
  }

  printWindow.document.open()
  printWindow.document.write(content)
  printWindow.document.close()
}

export function exportChatMessages(messages: Message[], request: ChatExportFormat | ChatExportRequest): string {
  const normalized = normalizeChatExportRequest(request)
  const fileStem = `${createFileStem()}_${normalized.template}`
  const context: ExportContext = {
    template: normalized.template,
    exportedAt: formatExportedAt(),
    conversationTitle: getConversationTitle(messages),
  }

  if (normalized.format === "md") {
    const fileName = `${fileStem}.md`
    downloadFile(buildMarkdown(messages, context), fileName, "text/markdown;charset=utf-8")
    return fileName
  }

  if (normalized.format === "pdf") {
    openPrintWindow(buildPrintableHtml(messages, context))
    return "인쇄 화면"
  }

  const fileName = `${fileStem}.txt`
  downloadFile(buildPlainText(messages, context), fileName, "text/plain;charset=utf-8")
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
