export function renderChatTestPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Core Chat Playground</title>
  <style>
    :root {
      --bg: #f4efe4;
      --bg-strong: #e6dcc9;
      --panel: rgba(255, 250, 242, 0.92);
      --panel-strong: #fff8ed;
      --panel-soft: #efe5d2;
      --text: #1e1a16;
      --muted: #6d6256;
      --line: rgba(55, 43, 31, 0.14);
      --brand: #b85c38;
      --brand-ink: #fff8f1;
      --assistant: #fffaf4;
      --user: linear-gradient(135deg, #b85c38, #cf7d4f);
      --success: #2f7a51;
      --warning: #a45c1d;
      --shadow: 0 24px 60px rgba(70, 52, 37, 0.16);
      --radius-xl: 28px;
      --radius-lg: 18px;
      --radius-md: 14px;
      --radius-sm: 10px;
      --mono: "Cascadia Code", "D2Coding", Consolas, monospace;
      --sans: "Segoe UI", "Noto Sans KR", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--text);
      font-family: var(--sans);
      background:
        radial-gradient(circle at top left, rgba(184, 92, 56, 0.12), transparent 26%),
        radial-gradient(circle at bottom right, rgba(111, 85, 53, 0.14), transparent 30%),
        linear-gradient(180deg, var(--bg), var(--bg-strong));
    }
    .shell {
      min-height: 100%;
      padding: 24px;
      display: grid;
      place-items: center;
    }
    .app {
      width: min(1240px, 100%);
      min-height: calc(100vh - 48px);
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      background: rgba(255, 248, 237, 0.7);
      border: 1px solid var(--line);
      border-radius: 34px;
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(18px);
    }
    .sidebar {
      padding: 28px 24px;
      background:
        linear-gradient(180deg, rgba(120, 84, 45, 0.08), rgba(120, 84, 45, 0)),
        linear-gradient(180deg, rgba(255, 248, 237, 0.92), rgba(247, 238, 226, 0.92));
      border-right: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto auto auto 1fr auto;
      gap: 20px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--brand);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 0 6px rgba(184, 92, 56, 0.12);
    }
    .sidebar h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }
    .sidebar p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
      font-size: 14px;
    }
    .side-card {
      background: rgba(255, 250, 244, 0.84);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 16px;
    }
    .side-card h2 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 0;
      border-radius: 999px;
      background: var(--panel-soft);
      color: var(--text);
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease;
    }
    .chip:hover {
      transform: translateY(-1px);
      background: #e8d9c0;
    }
    .metrics {
      display: grid;
      gap: 10px;
    }
    .metric {
      display: grid;
      gap: 4px;
    }
    .metric strong {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric span {
      font-size: 14px;
      color: var(--text);
      word-break: break-word;
    }
    .main {
      min-width: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background:
        linear-gradient(180deg, rgba(255, 251, 245, 0.74), rgba(255, 248, 238, 0.92));
    }
    .topbar {
      padding: 24px 28px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: rgba(255, 250, 243, 0.7);
      backdrop-filter: blur(12px);
    }
    .topbar h2 {
      margin: 0;
      font-size: 20px;
      letter-spacing: -0.03em;
    }
    .topbar p {
      margin: 4px 0 0;
      font-size: 13px;
      color: var(--muted);
    }
    .scope-wrap {
      min-width: 170px;
      display: grid;
      gap: 6px;
    }
    .scope-wrap label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    select, textarea, button {
      font: inherit;
    }
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      background: #fffaf2;
      color: var(--text);
      outline: none;
    }
    .conversation {
      min-height: 0;
      overflow: auto;
      padding: 28px 28px 18px;
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .bubble-row {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      animation: slideUp 180ms ease;
    }
    .bubble-row.user {
      justify-content: flex-end;
    }
    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      border: 1px solid var(--line);
      background: #fffaf1;
      color: var(--brand);
    }
    .bubble {
      max-width: min(760px, 84%);
      padding: 16px 18px;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: var(--assistant);
      box-shadow: 0 10px 30px rgba(82, 60, 41, 0.08);
      white-space: pre-wrap;
      line-height: 1.7;
      word-break: break-word;
    }
    .bubble-row.user .bubble {
      background: var(--user);
      color: var(--brand-ink);
      border-color: transparent;
      border-bottom-right-radius: 8px;
    }
    .bubble-row.assistant .bubble {
      border-bottom-left-radius: 8px;
    }
    .bubble-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .bubble-title {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .bubble-row.user .bubble-title {
      color: rgba(255, 248, 241, 0.8);
    }
    .bubble-meta {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(80, 61, 44, 0.08);
      color: var(--muted);
      font-size: 12px;
      border: 1px solid rgba(80, 61, 44, 0.08);
    }
    .link-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 14px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--brand);
      color: var(--brand-ink);
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .typing {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .typing span {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--brand);
      opacity: 0.25;
      animation: pulse 1000ms infinite ease-in-out;
    }
    .typing span:nth-child(2) { animation-delay: 120ms; }
    .typing span:nth-child(3) { animation-delay: 240ms; }
    .composer {
      border-top: 1px solid var(--line);
      padding: 18px 22px 22px;
      display: grid;
      gap: 12px;
      background: rgba(255, 249, 240, 0.92);
    }
    .composer-box {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
    }
    textarea {
      min-height: 72px;
      max-height: 180px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: #fffbf4;
      color: var(--text);
      padding: 16px 18px;
      outline: none;
      line-height: 1.6;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
    }
    textarea:focus, select:focus {
      border-color: rgba(184, 92, 56, 0.4);
      box-shadow: 0 0 0 4px rgba(184, 92, 56, 0.08);
    }
    .composer-actions {
      display: flex;
      gap: 10px;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 16px;
      padding: 14px 18px;
      cursor: pointer;
      font-weight: 800;
      letter-spacing: 0.01em;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    button:hover { transform: translateY(-1px); }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .primary {
      background: var(--brand);
      color: var(--brand-ink);
      min-width: 132px;
    }
    .secondary {
      background: #e7dac5;
      color: var(--text);
    }
    .subtext {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .debug {
      margin-top: 8px;
      border-top: 1px dashed var(--line);
      padding-top: 12px;
      min-width: 0;
      display: none;
    }
    .debug.open {
      display: grid;
    }
    pre {
      margin: 0;
      background: #17120d;
      color: #f6ece0;
      border-radius: 16px;
      padding: 16px;
      width: 100%;
      max-width: 100%;
      max-height: 320px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.6;
      font-family: var(--mono);
    }
    .ghost {
      opacity: 0.6;
    }
    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.24; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-1px); }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 1024px) {
      .app {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
    @media (max-width: 720px) {
      .shell { padding: 0; }
      .app {
        min-height: 100vh;
        border-radius: 0;
      }
      .topbar, .conversation, .composer {
        padding-left: 16px;
        padding-right: 16px;
      }
      .composer-box {
        grid-template-columns: 1fr;
      }
      .composer-actions {
        justify-content: stretch;
      }
      .composer-actions button {
        flex: 1 1 auto;
      }
      .bubble {
        max-width: 92%;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="app">
      <aside class="sidebar">
        <div>
          <div class="eyebrow"><span class="dot"></span>AI Core Playground</div>
          <h1>채팅형 테스트 화면</h1>
          <p>운영 JSP가 붙기 전까지 여기서 <code>/chat</code> 응답과 <code>display</code> 렌더링, 링크 동작, 응답 시간을 같이 검증합니다.</p>
        </div>

        <section class="side-card">
          <h2>추천 질의</h2>
          <div class="chips" id="sampleQueries">
            <button class="chip" data-query="휴가신청 상신이 불가능해">휴가신청 상신 불가</button>
            <button class="chip" data-query="다국어 코드 추가하는 법">다국어 코드 추가</button>
            <button class="chip" data-query="브라우저 캐시 저장이 되지 않아">브라우저 캐시 저장 불가</button>
            <button class="chip" data-query="야간근무 일정은 어떻게 생성해?">야간근무 일정 생성</button>
          </div>
        </section>

        <section class="side-card">
          <h2>응답 요약</h2>
          <div class="metrics">
            <div class="metric">
              <strong>Status</strong>
              <span id="metricStatus">Idle</span>
            </div>
            <div class="metric">
              <strong>Answer Source</strong>
              <span id="metricSource">-</span>
            </div>
            <div class="metric">
              <strong>Retrieval Mode</strong>
              <span id="metricRetrievalMode">-</span>
            </div>
            <div class="metric">
              <strong>Latency</strong>
              <span id="metricLatency">-</span>
            </div>
          </div>
        </section>

        <section class="side-card">
          <h2>Display Model</h2>
          <p><code>display.title</code>, <code>display.answerText</code>, <code>display.linkUrl</code>, <code>display.status</code>만 써도 UI를 그릴 수 있게 맞춘 상태입니다.</p>
        </section>

        <section class="side-card">
          <h2>디버그</h2>
          <button id="toggleDebug" class="secondary" type="button">JSON 보기</button>
        </section>
      </aside>

      <main class="main">
        <header class="topbar">
          <div>
            <h2>AI Core Chat</h2>
            <p>유사 이력 기반 응답을 채팅 UX로 확인합니다.</p>
          </div>
          <div class="scope-wrap">
            <label for="scope">Retrieval Scope</label>
            <select id="scope">
              <option value="scc">scc</option>
              <option value="all">all</option>
              <option value="manual">manual</option>
            </select>
          </div>
        </header>

        <section id="conversation" class="conversation">
          <div class="bubble-row assistant">
            <div class="avatar">AI</div>
            <div class="bubble">
              <div class="bubble-head">
                <div class="bubble-title">AI Core</div>
              </div>
              실제 운영 응답과 동일한 JSON을 기반으로 테스트하는 화면입니다. 질문을 입력하면 <code>display</code> 기준으로 말풍선을 그립니다.
            </div>
          </div>
        </section>

        <section class="composer">
          <div class="composer-box">
            <textarea id="query" placeholder="예: 휴가신청 상신이 불가능해"></textarea>
            <div class="composer-actions">
              <button id="clear" type="button" class="secondary">대화 초기화</button>
              <button id="send" type="button" class="primary">질문 보내기</button>
            </div>
          </div>
          <div class="subtext">
            <span id="requestStatus">Ready</span>
            <span>Enter로 전송, Shift+Enter로 줄바꿈</span>
          </div>
          <div id="debugPanel" class="debug">
            <pre id="result">{}</pre>
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const conversationEl = document.getElementById("conversation");
    const queryEl = document.getElementById("query");
    const scopeEl = document.getElementById("scope");
    const sendBtn = document.getElementById("send");
    const clearBtn = document.getElementById("clear");
    const resultEl = document.getElementById("result");
    const requestStatusEl = document.getElementById("requestStatus");
    const metricStatusEl = document.getElementById("metricStatus");
    const metricSourceEl = document.getElementById("metricSource");
    const metricRetrievalModeEl = document.getElementById("metricRetrievalMode");
    const metricLatencyEl = document.getElementById("metricLatency");
    const debugPanelEl = document.getElementById("debugPanel");
    const toggleDebugBtn = document.getElementById("toggleDebug");
    const sampleQueriesEl = document.getElementById("sampleQueries");

    let typingRow = null;

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function scrollConversationToBottom() {
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }

    function createBubbleRow(role, options) {
      const row = document.createElement("div");
      row.className = "bubble-row " + role;

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = role === "user" ? "ME" : "AI";

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      const head = document.createElement("div");
      head.className = "bubble-head";

      const title = document.createElement("div");
      title.className = "bubble-title";
      title.textContent = options.title || (role === "user" ? "User" : "Assistant");
      head.appendChild(title);

      if (options.metaLabel) {
        const metaLabel = document.createElement("div");
        metaLabel.className = "bubble-title ghost";
        metaLabel.textContent = options.metaLabel;
        head.appendChild(metaLabel);
      }

      bubble.appendChild(head);

      const body = document.createElement("div");
      if (options.html) {
        body.innerHTML = options.html;
      } else {
        body.textContent = options.text || "";
      }
      bubble.appendChild(body);

      if (options.tags && options.tags.length > 0) {
        const meta = document.createElement("div");
        meta.className = "bubble-meta";
        options.tags.forEach((tagText) => {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = tagText;
          meta.appendChild(tag);
        });
        bubble.appendChild(meta);
      }

      if (options.linkUrl) {
        const link = document.createElement("a");
        link.className = "link-btn";
        link.href = options.linkUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = options.linkLabel || "유사 이력 바로가기";
        bubble.appendChild(link);
      }

      if (role === "user") {
        row.appendChild(bubble);
        row.appendChild(avatar);
      } else {
        row.appendChild(avatar);
        row.appendChild(bubble);
      }

      return row;
    }

    function appendUserMessage(text) {
      const row = createBubbleRow("user", {
        title: "질문",
        text
      });
      conversationEl.appendChild(row);
      scrollConversationToBottom();
    }

    function showTyping() {
      removeTyping();
      typingRow = createBubbleRow("assistant", {
        title: "AI Core",
        html: '<div class="typing"><span></span><span></span><span></span></div>'
      });
      conversationEl.appendChild(typingRow);
      scrollConversationToBottom();
    }

    function removeTyping() {
      if (typingRow && typingRow.parentNode) {
        typingRow.parentNode.removeChild(typingRow);
      }
      typingRow = null;
    }

    function typeTextIntoElement(el, text, speed) {
      return new Promise((resolve) => {
        el.textContent = "";
        let index = 0;
        function tick() {
          if (index >= text.length) {
            resolve();
            return;
          }
          el.textContent += text[index];
          index += 1;
          const delay = text[index - 1] === "\\n" ? speed * 0.3 : speed;
          window.setTimeout(tick, delay);
        }
        tick();
      });
    }

    async function appendAssistantMessage(data) {
      const view = data && data.display ? data.display : null;
      if (!view) {
        const row = createBubbleRow("assistant", {
          title: "AI Core",
          text: "display 필드가 없습니다.",
          tags: ["invalid-response"]
        });
        conversationEl.appendChild(row);
        scrollConversationToBottom();
        return;
      }

      const tags = [];
      if (view.status) tags.push("status: " + view.status);
      if (view.answerSource) tags.push("source: " + view.answerSource);
      if (view.retrievalMode) tags.push("retrieval: " + view.retrievalMode);
      if (typeof view.confidence === "number") tags.push("confidence: " + view.confidence);

      const row = createBubbleRow("assistant", {
        title: view.title || "AI Core",
        text: "",
        tags,
        linkUrl: view.linkUrl || null,
        linkLabel: view.linkLabel || "유사 이력 바로가기"
      });
      conversationEl.appendChild(row);
      const bodyEl = row.querySelector(".bubble > div:nth-child(2)");
      scrollConversationToBottom();
      await typeTextIntoElement(bodyEl, view.answerText || "", 8);
      scrollConversationToBottom();
    }

    function renderMetrics(data) {
      const view = data && data.display ? data.display : null;
      const timings = data && data.timings ? data.timings : null;

      metricStatusEl.textContent = view && view.status ? view.status : "no-display";
      metricSourceEl.textContent = view && view.answerSource ? view.answerSource : "-";
      metricRetrievalModeEl.textContent = view && view.retrievalMode ? view.retrievalMode : "-";

      if (timings && typeof timings.totalMs === "number") {
        metricLatencyEl.textContent =
          "total " + timings.totalMs + "ms / retrieval " +
          (typeof timings.retrievalMs === "number" ? timings.retrievalMs : "-") +
          "ms / llm " +
          (typeof timings.llmMs === "number" ? timings.llmMs : "-") + "ms";
      } else {
        metricLatencyEl.textContent = "-";
      }
    }

    async function sendRequest() {
      const query = queryEl.value.trim();
      const retrievalScope = scopeEl.value;

      if (!query) {
        requestStatusEl.textContent = "질문을 입력해 주세요.";
        return;
      }

      appendUserMessage(query);
      queryEl.value = "";
      queryEl.focus();
      sendBtn.disabled = true;
      requestStatusEl.textContent = "AI Core 응답 생성 중...";
      showTyping();

      try {
        const response = await fetch("/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, retrievalScope })
        });

        const data = await response.json();
        resultEl.textContent = JSON.stringify(data, null, 2);
        renderMetrics(data);
        removeTyping();
        await appendAssistantMessage(data);

        if (!response.ok) {
          requestStatusEl.textContent = "요청 실패 (" + response.status + ")";
        } else {
          requestStatusEl.textContent = "응답 수신 완료 (" + response.status + ")";
        }
      } catch (error) {
        removeTyping();
        const message = error && error.message ? error.message : "unknown";
        const row = createBubbleRow("assistant", {
          title: "AI Core",
          text: "요청 처리 중 오류가 발생했습니다.\\n" + message,
          tags: ["request-failed"]
        });
        conversationEl.appendChild(row);
        requestStatusEl.textContent = "요청 실패";
        scrollConversationToBottom();
      } finally {
        sendBtn.disabled = false;
      }
    }

    function resetConversation() {
      conversationEl.innerHTML = "";
      resultEl.textContent = "{}";
      metricStatusEl.textContent = "Idle";
      metricSourceEl.textContent = "-";
      metricRetrievalModeEl.textContent = "-";
      metricLatencyEl.textContent = "-";
      requestStatusEl.textContent = "Ready";

      const row = createBubbleRow("assistant", {
        title: "AI Core",
        text: "실제 운영 응답과 동일한 JSON을 기반으로 테스트하는 화면입니다. 질문을 입력하면 display 기준으로 말풍선을 그립니다."
      });
      conversationEl.appendChild(row);
      scrollConversationToBottom();
    }

    sendBtn.addEventListener("click", () => void sendRequest());
    clearBtn.addEventListener("click", resetConversation);
    queryEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendRequest();
      }
    });

    toggleDebugBtn.addEventListener("click", () => {
      const opened = debugPanelEl.classList.toggle("open");
      toggleDebugBtn.textContent = opened ? "JSON 숨기기" : "JSON 보기";
    });

    sampleQueriesEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const query = target.dataset.query;
      if (!query) {
        return;
      }
      queryEl.value = query;
      queryEl.focus();
    });

    resetConversation();
  </script>
</body>
</html>`;
}
