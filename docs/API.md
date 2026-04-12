# API 명세서

CS 챗봇 시스템의 REST API 문서입니다.

## 목차
- [개요](#개요)
- [공통 사항](#공통-사항)
- [엔드포인트](#엔드포인트)
  - [POST /chat/stream](#post-chatstream)
  - [POST /retrieval/search](#post-retrievalsearch)
  - [GET /health](#get-health)
  - [GET /conversations](#get-conversations)
  - [GET /conversations/:sessionId/messages](#get-conversationssessionidmessages)

---

## 개요

| 항목 | 값 |
|------|-----|
| **운영 Base URL** | `https://csbotservice.com/api` |
| **로컬 Base URL** | `http://localhost:3101` |
| **인증** | 없음 (내부 서비스) |
| **응답 형식** | JSON / Server-Sent Events (SSE) |

---

## 공통 사항

### 요청 헤더

```http
Content-Type: application/json
```

### 보안 차단

아래 유형의 질의는 자동 차단됩니다:

- SQL Injection / XSS / 스크립트 삽입
- 주민등록번호 / 개인정보 / 민감정보 요청
- 해킹 / 권한 탈취 / 계정 우회 관련

**차단 응답:**
```json
{
  "error": "SECURITY_BLOCKED",
  "message": "보안 정책에 따라 처리할 수 없는 질의입니다."
}
```

---

## 엔드포인트

### POST /chat/stream

사용자 질문에 대해 SSE 스트리밍으로 답변을 제공합니다.
하이브리드 RAG 검색(Rule + Vector) → LLM 답변 생성 → 스트리밍 순서로 처리됩니다.

#### 요청

```http
POST /chat/stream
Content-Type: application/json
```

```json
{
  "query": "휴가신청서 상신이 불가해",
  "retrievalScope": "scc",
  "conversationHistory": [
    { "role": "user", "content": "이전 질문" },
    { "role": "assistant", "content": "이전 답변" }
  ],
  "clientConversationId": "uuid-string",
  "userKey": "user-identifier"
}
```

**파라미터:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `query` | string | ✅ | - | 사용자 질문 |
| `retrievalScope` | string | ❌ | `"scc"` | 검색 범위 (`scc` / `manual`) |
| `conversationHistory` | array | ❌ | `[]` | 멀티턴 대화 이력 (최근 6개) |
| `clientConversationId` | string | ❌ | - | 클라이언트 대화 세션 ID |
| `userKey` | string | ❌ | - | 사용자 식별자 |

#### 응답 (SSE 스트림)

**Content-Type:** `text/event-stream; charset=utf-8`

**이벤트 순서:**

```
data: {"type":"metadata", "data": { ... }}

data: {"type":"chunk", "content":"안"}
data: {"type":"chunk", "content":"녕"}
...

data: {"type":"done"}
```

**이벤트 타입:**

| 타입 | 설명 |
|------|------|
| `metadata` | 검색 결과 메타데이터 (스트리밍 시작 전 1회) |
| `chunk` | LLM 답변 텍스트 청크 |
| `done` | 스트림 종료 |

**metadata 이벤트 상세:**

```json
{
  "type": "metadata",
  "data": {
    "logId": "uuid",
    "bestRequireId": "6c11c32e-df4d-4b38-bc93-06df653b46a9",
    "bestSccId": "12345",
    "confidence": 0.87,
    "similarIssueUrl": "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?scc_id=12345",
    "retrievalMode": "hybrid",
    "vectorUsed": true,
    "llmSkipped": false,
    "answerSource": "llm",
    "display": {
      "title": "휴가신청서 상신 불가",
      "answerText": "...",
      "linkUrl": "https://cs.covision.co.kr/...",
      "linkLabel": "유사 이력 바로가기",
      "status": "matched"
    },
    "top3Candidates": [
      {
        "requireId": "...",
        "sccId": "...",
        "previewText": "...",
        "confidence": 0.87,
        "chunkType": "qa_pair",
        "linkUrl": "..."
      }
    ],
    "timings": {
      "ruleMs": 320,
      "embeddingMs": 450,
      "vectorMs": 40,
      "rerankMs": 80,
      "retrievalMs": 890,
      "llmMs": 2100,
      "totalMs": 2990,
      "cacheHit": false
    }
  }
}
```

**display.status 값:**

| 값 | 설명 |
|---|---|
| `matched` | 유사 이력 발견, 답변 제공 |
| `needs_more_info` | 관련 이력 없음, 추가 정보 요청 |

**answerSource 값:**

| 값 | 설명 |
|---|---|
| `llm` | LLM이 생성한 답변 |
| `deterministic_fallback` | 하이브리드 검색 후 고정 포맷 답변 |
| `rule_only` | 벡터 검색 없이 Rule만으로 생성 |

#### cURL 예시

```bash
curl -X POST https://csbotservice.com/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"휴가신청 불가","retrievalScope":"scc"}' \
  | grep "metadata"
```

#### 타이밍 정보 확인

```bash
curl -s -X POST https://csbotservice.com/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"휴가신청 불가","retrievalScope":"scc"}' \
  | grep "^data:" | grep "metadata" \
  | python3 -c "
import sys, json
line = sys.stdin.read().strip()
data = json.loads(line.replace('data: ',''))
print(data['data']['timings'])
"
```

---

### POST /retrieval/search

LLM 없이 RAG 검색 결과만 반환합니다. 디버깅 및 점수 시각화용입니다.

#### 요청

```http
POST /retrieval/search
Content-Type: application/json
```

```json
{
  "query": "휴가신청 불가",
  "retrievalScope": "scc"
}
```

#### 응답

```json
{
  "candidates": [
    {
      "requireId": "6c11c32e-df4d-4b38-bc93-06df653b46a9",
      "sccId": "12345",
      "chunkType": "qa_pair",
      "previewText": "휴가신청서 상신 시 결재선이...",
      "confidence": 0.87,
      "score": 0.87,
      "vectorSimilarity": 0.82,
      "linkUrl": "https://cs.covision.co.kr/..."
    }
  ],
  "retrievalMode": "hybrid",
  "vectorUsed": true,
  "vectorModelTag": "google:gemini-embedding-2-preview",
  "vectorStrategy": "pgvector",
  "timings": {
    "ruleMs": 320,
    "embeddingMs": 450,
    "vectorMs": 40,
    "rerankMs": 80,
    "retrievalMs": 890,
    "cacheHit": false
  }
}
```

---

### GET /health

서버 및 DB 연결 상태를 확인합니다.

#### 응답

```json
{
  "status": "ok",
  "db": "connected",
  "cache": {
    "size": 12,
    "maxSize": 500
  },
  "uptime": 3600
}
```

---

### GET /conversations

저장된 대화 세션 목록을 반환합니다.

#### 요청

```http
GET /conversations?userKey=user-identifier&limit=20&search=휴가신청&includeMessages=true
```

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `userKey` | string | 사용자 식별자 |
| `clientSessionId` | string | 특정 클라이언트 세션 ID |
| `limit` | number | 최대 반환 건수 (기본 20) |
| `offset` | number | 페이지네이션 offset |
| `days` | number | 최근 N일 이내 대화만 조회 (최대 365) |
| `search` | string | 대화 제목 또는 메시지 본문 검색어 |
| `includeMessages` | boolean | 메시지 본문 포함 여부 |

#### 응답

`pagination.hasMore=true`이면 `pagination.nextOffset`을 다음 `offset`으로 전달해 다음 페이지를 조회합니다.

```json
{
  "rows": [
    {
      "session_id": "uuid",
      "client_session_id": "client-uuid",
      "user_key": "user-identifier",
      "title": "휴가신청 불가 문의",
      "created_at": "2026-04-09T10:00:00Z",
      "updated_at": "2026-04-09T10:05:00Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "count": 20,
    "hasMore": true,
    "nextOffset": 20
  }
}
```

---

### GET /conversations/:sessionId/messages

특정 세션의 메시지 목록을 반환합니다.

#### 응답

```json
[
  {
    "messageId": "uuid",
    "sessionId": "uuid",
    "role": "user",
    "content": "휴가신청 불가",
    "createdAt": "2026-04-09T10:00:00Z"
  },
  {
    "messageId": "uuid",
    "sessionId": "uuid",
    "role": "assistant",
    "content": "휴가신청서 상신 시...",
    "logId": "uuid",
    "createdAt": "2026-04-09T10:00:05Z"
  }
]
```

---

## 캐시 정책

| 캐시 | TTL | Key |
|---|---|---|
| Query Embedding Cache | 5분 | `{modelTag}::{query}` |
| Retrieval Cache | 30초 | `{scope}::{query}` |

캐시 히트 시 응답 시간 **수백ms → 즉시** 응답.

---

## 변경 이력

### 2026-04-09 (최신)
- ✅ Query Embedding Cache TTL 오류 수정 (60분 → 5분)
- ✅ `/chat/stream` 메인 엔드포인트로 정정 (기존 `/chat` 명세 오류 수정)
- ✅ `display` / `answerSource` / `top3Candidates` 응답 필드 추가
- ✅ `timings` 세분화 (ruleMs / embeddingMs / vectorMs / rerankMs / llmMs)
- ✅ `/conversations` / `/conversations/:sessionId/messages` 엔드포인트 추가
- ✅ 보안 차단 정책 (주민등록번호 / 개인정보 포함)
- ✅ Base URL Oracle Cloud 운영 URL로 업데이트

### 2026-04-02
- ✅ 대화 이력 DB 영속화 (conversation_session / conversation_message)
- ✅ 쿼리 리라이팅 활성화

### 2026-03-31
- ✅ 하이브리드 검색 안정화 (Rule + Vector)
- ✅ GIN FTS 기반 Rule 검색 최적화

### 2026-03-25
- ✅ 초기 API 문서 작성
