# [Concept] Covision AI Core: 유지보수 지능형 에이전트 설계 가이드

본 문서는 코비젼(Covision) 그룹웨어 유지보수 효율화를 위한 AI 코어의 핵심 컨셉과 에이전트의 사고 로직을 정의한다.

---

## 1. 제품 비전 (Product Vision)
"단순 반복 문의의 80% 자동화, 복합 장애의 1:1 매칭 분석을 통한 엔지니어 리소스 최적화"

## 2. AI 코어 핵심 아키텍처 (Core Logic)

AI 코어는 다음의 3단계 레이어를 거쳐 사고 프로세스를 수행하도록 설계한다.

### ① Intent Classification (의도 분류)
입력된 쿼리를 다음 3가지 카테고리로 즉시 분류한다.
* **Type A (Simple Q&A):** 제품 기능 설정, UI 위치 등 단순 매뉴얼 확인 필요.
* **Type B (Issue Matching):** "에러 발생", "작동 안 함" 등 기존 유지보수 이력(History) 대조 필요.
* **Type C (Unsolved/New):** 기존 데이터에 없는 신규 유형 또는 심각한 시스템 장애.

### ② Knowledge Retrieval Strategy (RAG 전략)
* **Standard Manuals:** 제품 공식 가이드라인 참조.
* **Maintenance History DB:** 과거 티켓(Ticket) 데이터, SQL 패치 이력, 엔지니어 조치 노트 참조.
  - *Self-Correction:* 검색된 이력 중 '해결됨' 상태인 데이터에 가중치를 부여한다.

### ③ Contextual Synthesis (답변 합성)
* 단순 복붙이 아닌, 고객의 현재 그룹웨어 버전(Version)과 환경(OS, DB 등)을 고려한 맞춤형 솔루션을 생성한다.

---

## 3. 에이전트 페르소나 및 설계 원칙 (Persona)

* **Role:** 코비젼 시스템 엔지니어 수준의 전문 지식을 갖춘 '시니어 기술 지원 파트너'.
* **Reasoning Style:** 1. 가설 설정 (현상 분석)
  2. 근거 제시 (유지보수 이력 및 매뉴얼 대조)
  3. 조치 방안 제안 (Step 1, 2, 3)
  4. 위험 고지 (DB 직접 수정 시 주의사항 등)

## 4. 데이터 연동 스키마 (Target Data Structure)

AI 코어가 학습하고 참조해야 할 데이터의 핵심 속성은 다음과 같다.

| 필드명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `Incident_ID` | String | 과거 유지보수 티켓 고유 번호 |
| `Module_Tag` | Category | 전자결재, 인사, 메일, 메신저 등 모듈 구분 |
| `Issue_Pattern` | Text | 에러 로그, 증상 요약 |
| `Resolution_Script` | Code/Text | 실제 해결에 사용된 쿼리 또는 설정 변경값 |
| `Confidence_Score` | Float | 해당 조치로 해결될 확률 (AI 판단 지표) |


## 4.1 SCC 이력 기반 Vector Index 설계 (pgvector)

> 원본 DB(티켓/답변)에는 “정형 메타 + 원문”을 보관하고, Vector Index(pgvector)에는 **검색에 최적화된 단위(청크/QA 페어)** 를 적재한다.

### 4.1.1 Vector DB에 적재할 단위(권장 순서)
1) **QA 페어(메인 인덱스)**  
   - `content_text = 질문(title+context) + 답변(reply)` 형태로 결합하여 임베딩  
   - “비슷한 문제 → 해결책” 매칭(Type B)에 가장 강함

2) **Question-only / Answer-only(보조 인덱스)**  
   - 질문 유사도 매칭 보완, 답변 중심의 절차/스크립트 유사도 보완

### 4.1.2 청크(Chunk) 전략
- 긴 본문/답변은 **증상/원인/조치 단위**로 청킹(예: 500~1,000 토큰 수준)
- `chunk_id` 및 `chunk_version`을 두어 청크 규칙 변경 시 재색인이 가능하도록 설계

### 4.1.3 Vector Index에 함께 저장할 메타데이터(필수)
Vector 검색 품질과 하이브리드 필터링을 위해 아래 메타데이터를 함께 저장한다.

- `Incident_ID`(=scc_id)
- `Module_Tag` (req_type/req_type2 기반 매핑 결과)
- `Tenant/Customer` (고객사/테넌트 식별자; RLS/필터링)
- `Resolved_State` (resolved/workaround/failed/unknown 등)
- `Product_Version` (가능 시)
- `Work_Level / Reply_State` (신뢰도/상태 가중치)

### 4.1.4 룰 테이블의 의미(“Vector DB 설정”이 아님)
- 룰 테이블은 **벡터 자체의 설정이 아니라 메타 정규화 규칙**이다.
- 예: `REQ_TYPE/REQ_TYPE2 → Module_Tag` 매핑 테이블
- 벡터 검색 전에 `Module_Tag`, `Tenant`, `Version` 같은 필터로 후보를 좁히고,
  그 안에서 벡터 유사도(top-k)를 수행하는 구조가 운영/품질 모두 안정적이다.

---

## 4.2 원본 DB → Vector Index 적재(색인) 타이밍 & 방식

### 4.2.1 적재 타이밍(운영 권장)
- **초기 Backfill(1회):** 과거 SCC 전체를 배치로 임베딩/색인
- **증분 Incremental(상시):** 변경분만 주기적으로 반영
  - 권장: 1~5분 단위(준실시간) 또는 1시간/일 단위 배치
  - 하이브리드 권장: 신규/핫 이력은 5분 단위, 정합성/수정 반영은 야간 배치

### 4.2.2 적재 방식(권장: 워터마크 폴링 + 업서트, Idempotent)
1) 원본 DB에서 `updated_at`(없으면 created/answered 타임스탬프) 기준으로
   `last_watermark` 이후 변경분을 조회
2) 레코드를 임베딩 문서로 변환(QA 페어/청크 생성) + 메타데이터 부착
3) `content_hash`(예: SHA256)로 변경 감지
4) Vector 테이블에 **업서트**
   - 키 예시: `(Incident_ID, text_type, chunk_id, model)` 또는 별도 `embedding_id`
   - hash가 동일하면 skip, 다르면 re-embed 후 update

### 4.2.3 삭제/비활성 처리
- 원본에서 삭제되거나 검색 제외 대상으로 판단되면
  - 물리 삭제 또는 `is_active=false` 소프트 삭제(권장)

### 4.2.4 실패/재시도(운영 필수)
- 임베딩 실패 시 재시도 큐(또는 작업 테이블)로 분리
- 상태값 예시: `pending/processing/done/failed` + `last_error` + `retry_count`


---

## 5. 설계 시 고려해야 할 Edge Case

1. **버전별 상이성:** v2.0에서 해결된 방식이 v3.0에서는 적용되지 않을 수 있음을 인지할 것.
2. **커스텀 코드 파악:** 코비젼 제품 특성상 사이트별 커스터마이징이 많으므로, '표준 제품'과 '사이트별 특이사항'을 분리해서 사고할 것.
3. **보안 민감도:** 개인정보(이름, 전화번호)나 DB 접속 정보가 답변에 노출되지 않도록 필터링 기능을 내재화할 것.

---

## 6. AI 코어에게 주는 특수 명령어 (System Prompts)
> "너는 코비젼의 10년치 유지보수 데이터를 머릿속에 넣고 있는 설계자다. 질문이 들어오면 우선 '이 문제가 과거에 발생한 적이 있는가?'를 Vector DB에서 검색하고, 만약 없다면 제품의 로직(Logic)상 발생할 수 있는 원인을 역추적하여 추론하라."
---

## 7. 운영 기본값 (Initial Policy)

아래 항목은 AI 코어 1차 운영 시 적용할 기본 정책이며, 운영 로그 기반으로 주기적으로 튜닝한다.

### 7.1 Type A/B/C 분류 기준 (룰 + LLM 혼합)

**분류 우선순위**
1. 룰 기반 분류를 먼저 수행한다.
2. 룰로 확정되지 않는 경우에만 LLM 분류를 수행한다.
3. LLM 분류 confidence가 0.65 미만이면 단정 답변 대신 확인 질문을 1회 수행한다.

**룰 기반 시작 기준**
- **Type A (Simple Q&A):** 설정, 메뉴 위치, 사용법, 기능 설명, 권한 설정 안내
- **Type B (Issue Matching):** "오류", "에러", "실패", "안됨", "예외", "로그" 등 장애/증상 기반 문의
- **Type C (Unsolved/New):** 데이터 유실, 장애 확산, 보안 사고, 권한 침해, 서비스 중단, 과거 이력 미매칭

### 7.2 Retrieval 가중치 기본값

최종 점수는 아래 가중합으로 계산한다.

`score = 0.55 * semantic_similarity + 0.25 * resolved_weight + 0.15 * version_match + 0.05 * recency`

**상태 가중치 (`resolved_weight`)**
- resolved: 1.0
- workaround: 0.6
- unknown: 0.3
- failed: 0.0

**버전 가중치 (`version_match`)**
- exact version: 1.0
- same major: 0.7
- adjacent minor: 0.4
- mismatch: 0.1

**응답 정책 임계값**
- score >= 0.75: 높은 신뢰도로 조치안 제시
- 0.55 <= score < 0.75: 보수적 조치안 + 추가 확인 항목 제시
- score < 0.55: Type C 흐름(원인 가설 + 진단 정보 수집)으로 전환

### 7.3 최종 답변 고정 템플릿

모든 기술지원 답변은 아래 섹션 순서를 기본으로 한다.

1. **분류 결과:** Type A/B/C
2. **진단 요약:** 현재 증상에 대한 1~2문장 요약
3. **근거:** 참조한 티켓/매뉴얼/버전 정보
4. **조치안:** Step 1, Step 2, Step 3
5. **검증 방법:** 조치 성공/실패 판별 기준
6. **주의사항:** 보안/데이터/운영 리스크

Type C의 경우 마지막에 아래 항목을 추가한다.
- **추가 수집 정보:** 재현 경로, 로그 키워드, 환경정보(OS/DB/버전)

### 7.4 PII/보안 필터 차단 레벨

**L1 (개발/내부 테스트)**
- 개인정보(이름, 전화번호, 이메일) 마스킹
- 민감정보 탐지 중심, 차단 최소화

**L2 (운영 기본값)**
- L1 + 비밀정보(API Key, DB 계정/비밀번호, 토큰) 차단
- 위험 SQL(직접 수정/삭제) 자동 실행 유도 금지
- 기본 응답에서 민감 파라미터는 마스킹 후 제시

**L3 (고보안 고객)**
- L2 + DB 직접 수정 가이드 원천 차단
- 특정 명령/스크립트 출력은 관리자 승인 시만 허용
- 응답 로그 감사 항목 강화(누가/언제/무엇을 요청했는지)

**권장 운영값**
- 기본 운영: **L2**
- 신규 고객 온보딩 초기: **L3** 검토 후 완화

## 8. MVP 최소 아키텍처 (Directory / Module / API)

본 섹션은 "AI 코어 단독 서비스"를 기준으로, 외부 웹서비스와 분리된 상태에서 독립 구동/검증 가능한 최소 운영 구성을 정의한다.

- 1차 단계는 웹서비스 프롬프트 연동을 보류하고, Postman/curl 기반 API 검증을 우선한다.
- 2차 단계에서 외부 웹서비스 연동을 진행한다.

### 8.1 디렉터리 구조 (권장)

```text
coviAI-core/
  src/
    app.ts
    server.ts
    config/
      env.ts
      logger.ts
      security.ts
    api/
      routes/
        health.route.ts
        chat.route.ts
        retrieval.route.ts
        admin.route.ts
      schemas/
        chat.schema.ts
        retrieval.schema.ts
    core/
      classifier/
        classifyIntent.ts
      orchestrator/
        chatOrchestrator.ts
      prompt/
        systemPrompt.ts
        answerTemplate.ts
      guardrails/
        piiFilter.ts
        securityFilter.ts
    rag/
      ingest/
        chunker.ts
        embeddingWorker.ts
      retrieval/
        hybridSearch.ts
        reranker.ts
      repository/
        vectorRepository.ts
        incidentRepository.ts
    infra/
      db/
        pgPool.ts
        redisClient.ts
      llm/
        openaiClient.ts
      queue/
        jobQueue.ts
      observability/
        tracing.ts
        metrics.ts
    types/
      chat.ts
      incident.ts
  docs/
    openapi.yaml
  tests/
    e2e/
    integration/
```

### 8.2 모듈 책임 (최소)

- `api/routes`: 인증/입력검증/응답코드만 담당. 비즈니스 로직 금지.
- `core/classifier`: Type A/B/C 분류. (Rule 우선, 애매하면 LLM)
- `core/orchestrator`: 분류 -> 검색 -> 생성 -> 필터 -> 템플릿 포맷 순서 제어.
- `core/guardrails`: PII/보안 정책(L1/L2/L3) 강제.
- `rag/ingest`: 문서/이력 데이터 청킹, 임베딩 생성, 색인.
- `rag/retrieval`: hybrid 검색(BM25+Vector), 점수 결합, 재정렬.
- `rag/repository`: DB 접근 추상화(SQL/pgvector/OpenSearch 교체 지점).
- `infra/llm`: OpenAI Responses API 호출 및 스트리밍 래퍼.
- `infra/queue`: 비동기 작업(재색인, 배치 임베딩, 백필).
- `infra/observability`: trace id, latency, token usage, error rate 수집.

### 8.3 HTTP API 명세 (MVP)

#### 1) Health
- `GET /health`
- 목적: 프로세스/DB/LLM 의존성 상태 확인
- 응답 예시:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "dependencies": {
    "db": "ok",
    "llm": "ok",
    "vector": "ok"
  }
}
```

#### 2) Chat (Sync)
- `POST /chat`
- 목적: 단건 질의응답
- 요청 예시:

```json
{
  "sessionId": "s-123",
  "userId": "u-100",
  "tenantId": "t-1",
  "query": "전자결재 반려 후 재기안 경로 알려줘",
  "context": {
    "productVersion": "3.0.4",
    "os": "linux",
    "db": "postgres"
  },
  "policyLevel": "L2",
  "retrievalScope": "all"
}
```

- `retrievalScope` 선택값:
  - `all`: 매뉴얼 + SCC 이력 통합 검색(기본값)
  - `manual`: 매뉴얼 인덱스만 검색
  - `scc`: SCC 이력 인덱스만 검색

- 응답 예시:

```json
{
  "type": "A",
  "answer": {
    "summary": "...",
    "evidence": [
      { "source": "manual", "id": "M-102", "score": 0.82 }
    ],
    "actions": ["Step 1 ...", "Step 2 ..."],
    "verification": ["..."],
    "caution": ["..."]
  },
  "debug": {
    "retrievalScore": 0.78,
    "versionMatch": "exact",
    "traceId": "tr-abc"
  }
}
```

#### 3) Chat (Streaming)
- `POST /chat/stream` (SSE)
- 목적: 토큰 스트리밍 응답
- 이벤트 타입: `meta`, `token`, `done`, `error`

#### 4) Retrieval Debug
- `POST /retrieval/search`
- 목적: 검색 결과만 점검(운영 관리자/내부 QA)
- 요청: `query`, `k`, `productVersion`, `filters`
- 응답: 후보 문서 리스트 + 결합 점수 + 랭킹 사유

#### 5) Ingest Trigger (관리자)
- `POST /admin/ingest`
- 목적: 문서/이력 재색인 작업 enqueue
- 요청: `source`, `mode(full|delta)`
- 응답: `jobId`, `accepted`

#### 6) 독립 테스트 체크리스트 (Postman/curl)
- `GET /health`로 기동 상태 확인
- `POST /chat`에 `retrievalScope=all|manual|scc` 각각 요청하여 응답 형식/근거 소스 확인
- `POST /retrieval/search`로 검색 후보/점수 분포 확인

### 8.4 공통 정책 (MVP 기본)

- 인증: 내부망이면 API Key, 외부 연동이면 JWT + mTLS 권장.
- 멱등성: `x-idempotency-key` 지원(재시도 안전성).
- 타임아웃: LLM 30s, retrieval 3s, 전체 35s.
- 재시도: 네트워크 오류/429에 대해 지수 백오프 2회.
- 로깅: 요청 원문 저장 금지, PII 마스킹 후 저장.
- 버전: URL prefix는 강제하지 않는다. 필요 시 `x-api-version` 헤더로 호환 정책을 관리한다.

### 8.5 MVP 기술 스택 (확정 권장)

- Language: TypeScript (Node.js 20+)
- Framework: Fastify
- LLM: OpenAI Responses API
- Vector: PostgreSQL + pgvector (초기), 필요 시 OpenSearch 확장
- Queue: Redis + BullMQ
- Observability: OpenTelemetry + Prometheus/Grafana
- Docs: OpenAPI(Swagger)

### 8.6 단계별 구현 우선순위

1. `health`, `chat(sync)` 먼저 완성 후 Postman/curl로 독립 검증 (가장 작은 폐쇄 루프)
2. Type A/B/C 분류 + 고정 템플릿 결합
3. retrieval debug API로 품질 튜닝
4. streaming(SSE) 추가
5. ingest/admin + queue 분리
6. 외부 웹서비스 프롬프트 연동
7. 관측성/보안 레벨 고도화

## 9. MVP 구현 일정 (2주 / 4주 옵션)

본 일정은 "AI 코어 단독 서비스" MVP를 빠르게 검증하기 위한 권장안이다.

### 9.1 2주 압축안 (PoC 성격)

#### Week 1 - Core Loop 완성
- 목표: `질의 -> 분류 -> 검색 -> 생성 -> 응답` 최소 폐쇄 루프 동작
- 작업:
- Fastify 기반 `GET /health`, `POST /chat` 구현
  - Type A/B/C 분류기(룰 우선) 1차 적용
  - OpenAI Responses API 연동(비스트리밍)
  - pgvector 스키마 + 기본 인덱스 + Top-k 검색
  - 고정 답변 템플릿(7.3) 적용
- 산출물:
  - 동작 가능한 API 서버
  - 샘플 데이터 100~300건 인덱싱
  - Postman/Swagger로 재현 가능한 테스트 컬렉션

#### Week 2 - 운영 최소요건
- 목표: 실제 웹서비스 연동 가능한 안정성 확보
- 작업:
- `POST /chat/stream`(SSE) 추가
- `POST /retrieval/search` 디버그 API 추가
  - PII/보안 필터 L2 기본 적용
  - Redis + BullMQ로 ingest 작업 비동기화
  - 구조화 로그 + traceId + 지표(latency/error/token) 수집
- 산출물:
  - 외부 웹서비스 연동 가이드
  - 장애 대응용 로그/메트릭 대시보드 초안
  - Known Issues 문서

### 9.2 4주 운영안 (실서비스 준비)

#### Week 1 - Foundation
- API 골격, 인증(API Key/JWT), 공통 에러 핸들링, OpenAPI 문서화

#### Week 2 - Retrieval 품질
- 하이브리드 검색(BM25+Vector), 점수 결합(7.2), 버전 매칭 강화
- Retrieval 평가셋 구축(정답 질의 50~100개)

#### Week 3 - Safety & Reliability
- PII/보안 L2 완성, L3 옵션 스위치
- 재시도/타임아웃/서킷브레이커, rate limit 적용
- 운영 배포 파이프라인(스테이징 포함) 정리

#### Week 4 - Stabilization
- 부하 테스트(k6 등) 및 병목 개선
- 응답 품질 A/B 비교, 프롬프트/검색 가중치 튜닝
- 운영 인수 문서(런북, 장애 매뉴얼, 롤백 절차) 마무리

### 9.3 단계별 완료 기준 (Definition of Done)

- 기능:
- `/health`, `/chat`, `/chat/stream` 정상 동작
  - Type A/B/C 분류 + 고정 템플릿 응답 100%
- 품질:
  - 핵심 질의셋 기준 정답 포함률(Top-3) 목표치 달성
  - 치명 보안 이슈 0건, PII 마스킹 누락 0건
- 운영:
  - 장애 추적 가능한 trace/log/metrics 확보
  - 재기동/배포/롤백 절차 문서화

### 9.4 리스크와 대응

- RDS/네트워크 접근 제한:
  - 대응: 로컬/스테이징 대체 DB + 연결 헬스체크 분리
- 검색 품질 불안정:
  - 대응: Retrieval Debug API 기반 점수/필터 튜닝 루프 운영
- 프롬프트 드리프트:
  - 대응: 답변 템플릿 고정 + 회귀 테스트셋 주기 실행

### 9.5 바로 확정할 실행 파라미터

1. 일정 선택: `2주 PoC` 또는 `4주 운영안`
2. 초기 데이터 범위: 매뉴얼만 / 매뉴얼+이력
3. 보안 레벨 시작값: `L2`(권장) 또는 `L3`
4. 벡터 스토어 시작점: `pgvector`(권장) 또는 `OpenSearch`
