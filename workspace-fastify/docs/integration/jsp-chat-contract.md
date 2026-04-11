# JSP AJAX 연동 계약

이 문서는 운영 JSP/WAS 화면에서 AI Core를 직접 호출할 때의 최소 계약을 고정합니다.
Next 프론트엔드 운영 경로(`/api/chat/stream`)와 혼동하지 않기 위해, JSP 샘플은 AI Core 백엔드의 JSON 엔드포인트인 `/chat`을 기준으로 둡니다.

## 호출 경로

운영 JSP/WAS가 AI Core에 직접 접근하는 경우:

```http
POST {AI_CORE_BASE_URL}/chat
Content-Type: application/json; charset=UTF-8
```

브라우저가 `csbotservice.com`의 Next/nginx 경로를 통과하는 경우는 다음 문서를 우선합니다.

- `docs/architecture/api-routing.md`

## 요청 본문

```json
{
  "query": "휴가신청서 상신이 불가능해",
  "retrievalScope": "scc"
}
```

선택 필드:

| 필드 | 설명 |
| --- | --- |
| `conversationId` | 클라이언트 대화 ID. 서버 대화 이력 저장과 연결할 때 사용 |
| `userKey` | 사용자 식별자. 서버 대화 목록 조회/저장에 사용 |
| `conversationHistory` | 최근 대화 이력. 후속 질문 맥락 보정에만 사용 |

## JSP 렌더링 권장 필드

JSP는 원칙적으로 `display` 객체만 렌더링합니다.

| 필드 | 설명 |
| --- | --- |
| `display.status` | `matched` 또는 `needs_more_info` |
| `display.title` | 답변 제목 |
| `display.answerText` | 화면에 노출할 답변 본문 |
| `display.linkUrl` | 유사 이력 링크. 없을 수 있음 |
| `display.linkLabel` | 링크 라벨 |
| `display.requireId` | 참조 SCC 요청 ID |
| `display.sccId` | 참조 SCC 번호 |
| `display.confidence` | 최종 신뢰도 |
| `display.answerSource` | `llm`, `deterministic_fallback`, `rule_only` 등 |
| `display.retrievalMode` | `hybrid` 또는 `rule_only` |

`candidates`, `top3Candidates`, `timings`, `vector*`, `llm*` 필드는 운영자 진단용입니다. 일반 사용자 화면에서는 직접 렌더링하지 않는 것을 권장합니다.

## 응답 예시

```json
{
  "logId": "6f923e04-5f87-4b55-8b20-5d329a60e5c7",
  "conversationId": "0a7bc89e-31d2-41ec-a5c7-f59d3f0b3d83",
  "display": {
    "status": "matched",
    "title": "휴가신청 상신 불가",
    "answerText": "유사 이력 기준으로 확인 포인트를 안내드립니다.",
    "linkLabel": "유사 이력 바로가기",
    "linkUrl": "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?req_id=...",
    "requireId": "6af1f31c-c3aa-4534-8c5a-0d6a29fec1ac",
    "sccId": "12345",
    "confidence": 0.8,
    "answerSource": "llm",
    "retrievalMode": "hybrid"
  }
}
```

## 운영 로깅

`/chat`와 `/chat/stream`은 응답 진단 정보를 `ai_core.query_log`에 적재합니다.
운영 분석에서 주로 보는 필드는 다음과 같습니다.

| 필드 | 목적 |
| --- | --- |
| `log_uuid` | 사용자 피드백과 대화 메시지를 연결하는 로그 ID |
| `query` | 원문 질문 |
| `confidence` | 최종 후보 신뢰도 |
| `best_require_id`, `best_scc_id` | 선택된 유사 이력 |
| `retrieval_mode` | `hybrid` / `rule_only` |
| `answer_source` | 최종 답변 생성 경로 |
| `is_no_match` | 매칭 실패 여부 |
| `is_failure`, `failure_reason` | 운영 실패/저신뢰도 분석용 |
| `rule_ms`, `embedding_ms`, `vector_ms`, `rerank_ms`, `retrieval_ms`, `llm_ms`, `total_ms` | 구간별 응답시간 |
| `user_feedback` | 좋아요/싫어요 피드백 |

스키마 보정은 다음 명령으로 수행할 수 있습니다.

```bash
npm run db:migrate:query-log
```

## 샘플

- `workspace-fastify/docs/integration/chat_widget.sample.jsp`
