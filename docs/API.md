# API 명세서

CS 챗봇 시스템의 REST API 문서입니다.

## 목차
- [개요](#개요)
- [공통 사항](#공통-사항)
- [엔드포인트](#엔드포인트)
  - [POST /chat](#post-chat)
  - [POST /retrieval/search](#post-retrievalsearch)
  - [GET /chat/test](#get-chattest)

---

## 개요

**Base URL:** `http://localhost:3101`

**인증:** 현재 버전에서는 인증이 필요 없습니다.

**응답 형식:** JSON / Server-Sent Events (SSE)

---

## 공통 사항

### 요청 헤더

```http
Content-Type: application/json
Accept: application/json
```

### 에러 응답

모든 에러는 다음 형식으로 반환됩니다:

```json
{
  "error": {
    "message": "에러 메시지",
    "code": "ERROR_CODE",
    "status": 400
  }
}
```

### HTTP 상태 코드

| 코드 | 설명 |
|------|------|
| 200 | 성공 |
| 400 | 잘못된 요청 |
| 429 | 요청 횟수 초과 (Rate Limit) |
| 500 | 서버 내부 오류 |

---

## 엔드포인트

### POST /chat

사용자 질문에 대한 답변을 스트리밍 방식으로 제공합니다.

#### 요청

**URL:** `/chat`

**Method:** `POST`

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "question": "코비젼 메일 설정 방법을 알려주세요",
  "scope": "all"
}
```

**파라미터:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `question` | string | ✅ | - | 사용자 질문 (최대 500자) |
| `scope` | string | ❌ | "all" | 검색 범위 ("all", "manual", "scc") |

#### 응답

**Content-Type:** `text/event-stream; charset=utf-8`

**SSE 이벤트 스트림:**

```
data: {"type":"token","content":"안"}

data: {"type":"token","content":"녕"}

data: {"type":"token","content":"하"}

data: {"type":"token","content":"세"}

data: {"type":"token","content":"요"}

data: {"type":"metadata","bestRequireId":"6c11c32e-df4d-4b38-bc93-06df653b46a9","confidence":0.92}

data: {"type":"done"}
```

**이벤트 타입:**

| 타입 | 설명 | 예시 |
|------|------|------|
| `token` | 답변 텍스트 토큰 (스트리밍) | `{"type":"token","content":"안녕"}` |
| `metadata` | 검색 메타데이터 | `{"type":"metadata","bestRequireId":"...","confidence":0.92}` |
| `done` | 스트림 종료 | `{"type":"done"}` |

**Metadata 필드:**

```json
{
  "type": "metadata",
  "bestRequireId": "6c11c32e-df4d-4b38-bc93-06df653b46a9",
  "confidence": 0.92,
  "similarIssueUrl": "https://cs.covision.co.kr/...",
  "timings": {
    "retrievalMs": 1442,
    "llmMs": 3250,
    "totalMs": 4692,
    "cacheHit": false
  }
}
```

#### 예시

**cURL:**

```bash
curl -X POST http://localhost:3101/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "코비젼 메일 설정 방법",
    "scope": "all"
  }'
```

**JavaScript (Fetch API):**

```javascript
const eventSource = new EventSource('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: '코비젼 메일 설정 방법',
    scope: 'all'
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'token') {
    console.log('Token:', data.content);
  } else if (data.type === 'metadata') {
    console.log('Metadata:', data);
  } else if (data.type === 'done') {
    eventSource.close();
  }
};
```

---

### POST /retrieval/search

RAG 검색 엔진을 직접 호출하여 관련 문서를 검색합니다. (LLM 답변 생성 없음)

#### 요청

**URL:** `/retrieval/search`

**Method:** `POST`

**Request Body:**

```json
{
  "question": "메일 설정",
  "scope": "all"
}
```

#### 응답

**Content-Type:** `application/json`

```json
{
  "candidates": [
    {
      "requireId": "6c11c32e-df4d-4b38-bc93-06df653b46a9",
      "chunkId": "e6c062c6-b862-5334-eacc-b34e7c0e4edf",
      "chunkType": "resolution",
      "chunkText": "메일 설정은 관리자 > 시스템 설정에서...",
      "confidence": 0.92,
      "rerankedScore": 8.5
    },
    {
      "requireId": "fe8d5f21-09f9-820c-cd58-d59dff86990a",
      "chunkId": "a498da70-8086-eea7-d152-a36584a7d343",
      "chunkType": "action",
      "chunkText": "1. 관리자 메뉴 접속\n2. 시스템 설정 클릭...",
      "confidence": 0.87,
      "rerankedScore": 7.8
    }
  ],
  "timings": {
    "ruleMs": 297,
    "embeddingMs": 884,
    "vectorMs": 36,
    "rerankMs": 213,
    "retrievalMs": 1442,
    "cacheHit": false
  }
}
```

**응답 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `candidates` | array | 검색된 문서 후보 (최대 5개) |
| `candidates[].requireId` | string | 요구사항 ID (UUID) |
| `candidates[].chunkId` | string | 청크 ID (UUID) |
| `candidates[].chunkType` | string | 청크 타입 (issue/action/resolution/qa_pair) |
| `candidates[].chunkText` | string | 청크 텍스트 내용 |
| `candidates[].confidence` | number | 신뢰도 점수 (0~1) |
| `candidates[].rerankedScore` | number | Reranking 점수 |
| `timings` | object | 성능 측정 데이터 |
| `timings.ruleMs` | number | Rule-based 검색 시간 (ms) |
| `timings.embeddingMs` | number | 임베딩 생성 시간 (ms) |
| `timings.vectorMs` | number | Vector 검색 시간 (ms) |
| `timings.rerankMs` | number | Reranking 시간 (ms) |
| `timings.retrievalMs` | number | 전체 검색 시간 (ms) |
| `timings.cacheHit` | boolean | 캐시 사용 여부 |

#### 예시

**cURL:**

```bash
curl -X POST http://localhost:3101/retrieval/search \
  -H "Content-Type: application/json" \
  -d '{
    "question": "메일 설정",
    "scope": "all"
  }'
```

---

### GET /chat/test

챗봇 테스트 페이지를 제공합니다. (개발/디버깅용)

#### 요청

**URL:** `/chat/test`

**Method:** `GET`

#### 응답

**Content-Type:** `text/html`

HTML 페이지가 반환됩니다.

---

## 성능 최적화

### 캐싱

시스템은 메모리 기반 캐싱을 사용하여 성능을 최적화합니다:

- **Query Embedding Cache**: 동일한 질문의 임베딩 재사용
  - TTL: 5분 (기본값)
  - Cache Key: `{modelTag}::{normalizedQuery}`

- **Retrieval Cache**: 동일한 질문의 검색 결과 재사용
  - TTL: 30초 (기본값)
  - Cache Key: `{scope}::{normalizedQuery}`

캐시 히트 시 응답 시간이 **70-90% 단축**됩니다.

### Rate Limiting

현재 버전에서는 Rate Limiting이 적용되지 않습니다. (향후 추가 예정)

---

## 보안

### 입력 검증

악의적인 쿼리는 자동으로 차단됩니다:

**차단 키워드:**
- 보안 우회/차단 관련
- 권한 상승 관련
- 계정/토큰 탈취 관련
- SQL Injection, XSS 등

차단 시 응답:
```json
{
  "answer": "⚠️ 보안상 처리할 수 없는 질의입니다.",
  "confidence": 0,
  "timings": { ... }
}
```

---

## 에러 처리

### 일반적인 에러 시나리오

**1. 빈 질문**

```json
{
  "error": {
    "message": "Question is required",
    "status": 400
  }
}
```

**2. 임베딩 생성 실패 (429 Rate Limit)**

```json
{
  "candidates": [],
  "timings": {
    "embeddingMs": 0,
    "embeddingError": "GOOGLE_EMBEDDING_HTTP_429"
  }
}
```

이 경우 시스템은 **Rule-based 검색만** 사용하여 답변을 제공합니다.

**3. LLM 타임아웃**

```json
{
  "answer": "[시스템 오류] LLM 응답 시간 초과",
  "confidence": 0
}
```

---

## 변경 이력

### 2026-03-25
- ✅ 초기 API 문서 작성
- ✅ SSE 스트리밍 명세 추가

### 2026-03-23
- ✅ 성능 최적화: Rule-based 검색 속도 70-90% 개선
- ✅ 캐시 메커니즘 도입

---

**문의:** AI Core Team
