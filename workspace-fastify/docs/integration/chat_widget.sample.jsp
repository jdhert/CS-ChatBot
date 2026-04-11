<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%
  String aiCoreBaseUrl = (String) request.getAttribute("aiCoreBaseUrl");
  if (aiCoreBaseUrl == null || aiCoreBaseUrl.isBlank()) {
    aiCoreBaseUrl = "http://localhost:3101";
  }
%>
<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Core Chat Widget Sample</title>
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", "Malgun Gothic", sans-serif;
      background: #f4f7fb;
      color: #172033;
    }
    .chat-shell {
      max-width: 960px;
      margin: 24px auto;
      background: #ffffff;
      border: 1px solid #d7deea;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(23, 32, 51, 0.08);
    }
    .chat-header {
      padding: 18px 20px;
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      color: #ffffff;
    }
    .chat-header h1 {
      margin: 0 0 6px;
      font-size: 20px;
    }
    .chat-header p {
      margin: 0;
      font-size: 13px;
      opacity: 0.9;
    }
    .chat-log {
      padding: 20px;
      min-height: 420px;
      max-height: 60vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #f8fbff;
    }
    .bubble-row {
      display: flex;
    }
    .bubble-row.user {
      justify-content: flex-end;
    }
    .bubble-row.assistant {
      justify-content: flex-start;
    }
    .bubble {
      max-width: 76%;
      padding: 14px 16px;
      border-radius: 16px;
      white-space: pre-wrap;
      line-height: 1.55;
      font-size: 14px;
      box-shadow: 0 8px 20px rgba(23, 32, 51, 0.06);
    }
    .bubble.user {
      background: #1d4ed8;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .bubble.assistant {
      background: #ffffff;
      color: #172033;
      border: 1px solid #d7deea;
      border-bottom-left-radius: 4px;
    }
    .bubble-meta {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e5ebf5;
      color: #607089;
      font-size: 12px;
      display: grid;
      gap: 4px;
    }
    .bubble-link {
      color: #1d4ed8;
      text-decoration: none;
      font-weight: 600;
    }
    .bubble-link:hover {
      text-decoration: underline;
    }
    .composer {
      display: grid;
      grid-template-columns: 1fr 120px 120px;
      gap: 12px;
      padding: 18px 20px 20px;
      border-top: 1px solid #e5ebf5;
      background: #ffffff;
    }
    .composer textarea,
    .composer select,
    .composer button {
      font: inherit;
      border-radius: 12px;
    }
    .composer textarea,
    .composer select {
      border: 1px solid #c9d4e5;
      padding: 12px 14px;
      resize: vertical;
      min-height: 56px;
    }
    .composer button {
      border: 0;
      cursor: pointer;
      font-weight: 700;
    }
    .composer button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .composer button.primary {
      background: #1d4ed8;
      color: #ffffff;
    }
    .composer button.secondary {
      background: #e8eef8;
      color: #24324a;
    }
    .status {
      padding: 0 20px 18px;
      font-size: 13px;
      color: #607089;
    }
    @media (max-width: 780px) {
      .composer {
        grid-template-columns: 1fr;
      }
      .bubble {
        max-width: 92%;
      }
    }
  </style>
</head>
<body>
  <div class="chat-shell">
    <div class="chat-header">
      <h1>AI Core Chat Widget Sample</h1>
      <p>JSP AJAX 연동은 `/chat` JSON 응답의 `display` 필드만 렌더링하는 방식을 권장합니다.</p>
    </div>

    <div id="chatLog" class="chat-log"></div>

    <div class="composer">
      <textarea id="queryInput" placeholder="예: 휴가신청서 상신이 불가능해"></textarea>
      <select id="scopeSelect">
        <option value="scc">scc</option>
        <option value="all">all</option>
        <option value="manual">manual</option>
      </select>
      <button id="sendBtn" class="primary" type="button">보내기</button>
      <button id="clearBtn" class="secondary" type="button">초기화</button>
    </div>

    <div id="statusText" class="status">대기 중</div>
  </div>

  <script>
    const AI_CORE_BASE_URL = "<%= aiCoreBaseUrl %>";
    const chatLogEl = document.getElementById("chatLog");
    const queryInputEl = document.getElementById("queryInput");
    const scopeSelectEl = document.getElementById("scopeSelect");
    const sendBtnEl = document.getElementById("sendBtn");
    const clearBtnEl = document.getElementById("clearBtn");
    const statusTextEl = document.getElementById("statusText");

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function appendUserBubble(query) {
      const row = document.createElement("div");
      row.className = "bubble-row user";
      row.innerHTML = '<div class="bubble user">' + escapeHtml(query) + "</div>";
      chatLogEl.appendChild(row);
      chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }

    function appendAssistantBubble(display) {
      const row = document.createElement("div");
      row.className = "bubble-row assistant";

      const meta = [
        "status: " + escapeHtml(display.status),
        "answerSource: " + escapeHtml(display.answerSource),
        "retrievalMode: " + escapeHtml(display.retrievalMode),
        "confidence: " + escapeHtml(display.confidence)
      ];

      if (display.requireId) {
        meta.push("requireId: " + escapeHtml(display.requireId));
      }
      if (display.sccId) {
        meta.push("sccId: " + escapeHtml(display.sccId));
      }

      const linkHtml = display.linkUrl
        ? '<a class="bubble-link" href="' + escapeHtml(display.linkUrl) + '" target="_blank" rel="noreferrer">' +
            escapeHtml(display.linkLabel || "유사 이력 바로가기") +
          "</a>"
        : "";

      row.innerHTML =
        '<div class="bubble assistant">' +
          "<strong>" + escapeHtml(display.title) + "</strong>\n\n" +
          escapeHtml(display.answerText) +
          '<div class="bubble-meta">' +
            meta.map(function(item) { return "<div>" + item + "</div>"; }).join("") +
            (linkHtml ? "<div>" + linkHtml + "</div>" : "") +
          "</div>" +
        "</div>";

      chatLogEl.appendChild(row);
      chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }

    function appendErrorBubble(title, message) {
      appendAssistantBubble({
        status: "needs_more_info",
        title: title,
        answerText: message,
        linkLabel: null,
        linkUrl: null,
        requireId: null,
        sccId: null,
        confidence: 0,
        answerSource: null,
        retrievalMode: "rule_only"
      });
    }

    async function sendChat() {
      const query = queryInputEl.value.trim();
      const retrievalScope = scopeSelectEl.value;

      if (!query) {
        statusTextEl.textContent = "질문을 입력해 주세요.";
        return;
      }

      appendUserBubble(query);
      sendBtnEl.disabled = true;
      statusTextEl.textContent = "요청 중...";

      try {
        const response = await fetch(AI_CORE_BASE_URL + "/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
          },
          body: JSON.stringify({
            query: query,
            retrievalScope: retrievalScope
          })
        });

        const payload = await response.json();
        if (!response.ok) {
          appendErrorBubble("요청 실패", payload.message || "AI Core 요청에 실패했습니다.");
          statusTextEl.textContent = "실패 (" + response.status + ")";
          return;
        }

        if (!payload.display) {
          appendErrorBubble("응답 형식 오류", "display 필드가 없습니다.");
          statusTextEl.textContent = "실패 (display 없음)";
          return;
        }

        appendAssistantBubble(payload.display);
        statusTextEl.textContent = "성공";
      } catch (error) {
        appendErrorBubble("요청 실패", error && error.message ? error.message : "unknown error");
        statusTextEl.textContent = "요청 실패";
      } finally {
        sendBtnEl.disabled = false;
      }
    }

    sendBtnEl.addEventListener("click", function() {
      void sendChat();
    });

    clearBtnEl.addEventListener("click", function() {
      chatLogEl.innerHTML = "";
      queryInputEl.value = "";
      statusTextEl.textContent = "대기 중";
    });
  </script>
</body>
</html>
