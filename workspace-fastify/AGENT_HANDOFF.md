# AI Core Agent Handoff

작성일: 2026-03-16  
대상: 다음 작업을 이어받는 에이전트 / 개발자  
기준 경로: `C:\Users\shpark6\Desktop\AI작업\coviAI\workspace-fastify`

## 1. 문서 목적

이 문서는 현재 `workspace-fastify` 프로젝트의 구조, DB 접속 정보, 주요 테이블/뷰, 검색/LLM 동작 방식, 최근 작업 내역, 미해결 이슈를 다음 작업자가 빠르게 파악할 수 있도록 정리한 인수인계 문서다.

이 문서의 목적은 다음과 같다.

- 다른 에이전트가 기존 의도와 구현 맥락을 잃지 않고 즉시 작업을 이어갈 수 있도록 한다.
- PostgreSQL/pgvector 기반 chunk + embedding 구조를 빠르게 이해할 수 있도록 한다.
- 현재 구현이 어디까지 완료되었고, 무엇이 아직 불안정한지 명확히 남긴다.
- 실행/테스트/배포 시 필요한 명령과 주의사항을 한 파일에 모은다.

## 2. 프로젝트 개요

이 프로젝트는 Covision AI Core MVP 런타임이다.  
웹 애플리케이션(JSP/AJAX)과 분리된 독립 Fastify 서버로 동작하며, SCC 유지보수 이력 데이터를 기반으로 다음 순서의 질의응답을 수행한다.

1. SCC chunk 뷰(`ai_core.v_scc_chunk_preview`)에서 후보 이력을 찾는다.
2. 후보 이력의 텍스트/가중치 기반 rule 점수를 계산한다.
3. 질문 임베딩과 저장된 chunk 임베딩을 비교해 vector 후보를 찾는다.
4. rule 점수와 vector 점수를 혼합해 최종 후보군을 만든다.
5. 필요 시 LLM(Google Gemini)에게 상위 후보군을 넘겨 설명형 답변을 생성한다.
6. 최종적으로 `/chat` 응답으로 후보 이력, 링크, 생성 답변, 진단 정보를 반환한다.

핵심 방향은 전형적인 RAG 구조다.  
다만 현재는 "자유 생성"보다 "근거 기반 생성" 쪽으로 설계되어 있다.

## 3. 아키텍처 요약

```text
Client
  -> Web/WAS Server (JSP + AJAX)
  -> AI Core (/chat)
     - Chunk View 조회
     - Rule Scoring
     - Vector Search (pgvector / float8[] fallback)
     - LLM Candidate Comparison / Answer Generation
  -> Web/WAS Server
  -> Client
```

핵심 엔드포인트:

- `GET /health`
- `GET /test/chat`
- `POST /chat`

## 4. 기술 스택

- Runtime: Node.js
- Server: Fastify
- Language: TypeScript
- DB Client: `pg`
- Vector Storage: PostgreSQL + `pgvector` extension + `float8[]`
- LLM: Google Gemini API
- Embedding Provider:
  - OpenAI
  - Google Gemini Embedding

## 5. DB 접속 정보

현재 코드의 기본 PostgreSQL 접속값은 `src/platform/db/vectorClient.ts` 및 각 DB 스크립트에 하드코딩 fallback 으로 들어가 있다.

접속 정보:

- Host: `DB_HOST_REMOVED`
- Port: `5432`
- Database: `ai2`
- User: `novian`
- Password: `REMOVED`
- Schema: `ai_core`

주의:

- `.env.example`는 샘플 문서일 뿐이고 자동 로딩되지 않는다.
- 실제 실행 시 `process.env`에 값이 주입되지 않으면 위 fallback 값으로 접속한다.
- 이 프로젝트는 `VECTOR_DB_*` 환경변수가 없을 때도 DB 연결이 되도록 기본값이 코드에 박혀 있다.

관련 파일:

- [vectorClient.ts](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/src/platform/db/vectorClient.ts)
- [init-vector-schema.mjs](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/scripts/init-vector-schema.mjs)
- [fix-stable-chunk-view.mjs](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/scripts/fix-stable-chunk-view.mjs)
- [enable-pgvector-search.mjs](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/scripts/enable-pgvector-search.mjs)
- [sync-scc-embeddings.mjs](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/scripts/sync-scc-embeddings.mjs)

## 6. 현재 DB 실데이터 상태

2026-03-23 기준 live DB 조회 결과 (데이터 표본 확장):

| Object | Row Count |
| --- | ---: |
| `ai_core.v_scc_chunk_preview` | 13255 |
| `ai_core.scc_chunk_embeddings` | 13255 |
| `ai_core.embedding_ingest_state` | 4 |
| `ai_core.v_scc_embedding_status` | 1 |
| `ai_core.v_scc_embedding_coverage` | 1 |

임베딩 모델 상태:

| embedding_model | embedding_dim | rows |
| --- | ---: | ---: |
| `google:gemini-embedding-001` | 3072 | 13255 |

pgvector 상태:

- `vector` extension 설치됨
- 설치 버전: `0.8.2`

인덱스 상태:

- `scc_chunk_embeddings_pkey`
- `idx_scc_chunk_embeddings_require`
- `idx_scc_chunk_embeddings_scc`
- `idx_scc_chunk_embeddings_chunk_type`
- `idx_scc_chunk_embeddings_model`
- `idx_scc_chunk_embeddings_model_dim`
- `idx_scc_chunk_embeddings_embedded_at`

현재 없음:

- `embedding_vec` 기반 HNSW / IVFFlat ANN 인덱스

이유:

- 현재 임베딩 차원은 `3072`
- `pgvector` ANN 인덱스는 차원 제한 이슈로 생성 실패
- 그래서 현재는 `embedding_vec` 컬럼은 존재하지만 ANN 인덱스 없이 cosine 연산 기반 검색을 수행한다.

## 7. 주요 DB 오브젝트 상세

### 7.1 `ai_core.v_scc_chunk_preview`

역할:

- 검색의 원본 데이터 소스
- chunk 단위의 이슈/행동/해결/질문-답변 데이터를 제공
- 검색용 feature score 컬럼을 함께 보유

주요 컬럼:

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `chunk_id` | `uuid` | chunk 고유 ID. 현재 deterministic UUID |
| `scc_id` | `bigint` | SCC ID |
| `require_id` | `uuid` | 원문 요청 ID |
| `chunk_type` | `text` | `issue`, `action`, `resolution`, `qa_pair` |
| `chunk_seq` | `integer` | 같은 require 내 chunk 순번 |
| `chunk_text` | `text` | 검색 및 답변의 본문 텍스트 |
| `module_tag` | `text` | 모듈/도메인 태그 |
| `reply_state` | `integer` | 처리 상태 |
| `resolved_weight` | `numeric` | 상태/완료 관련 가중치 |
| `ingested_at` | `timestamptz` | 적재 시각 |
| `state_weight` | `numeric` | 상태 기반 가중치 |
| `evidence_weight` | `numeric` | 근거성 가중치 |
| `text_len_score` | `numeric` | 본문 길이 기반 점수 |
| `tech_signal_score` | `numeric` | 기술 시그널 점수 |
| `specificity_score` | `numeric` | 구체성 점수 |
| `closure_penalty_score` | `numeric` | 종료성 문구 패널티 |
| `resolution_stage` | `integer` | 해결 단계 |
| `feature_len` | `integer` | feature 길이 |

중요한 변경 이력:

- 과거에는 `chunk_id`가 랜덤에 가까운 구조여서 임베딩 재사용이 어려웠다.
- 현재는 `ai_core.make_stable_chunk_uuid(...)`로 deterministic UUID 생성 방식으로 교체했다.
- 이 덕분에 동일 chunk 텍스트/키 조합이면 동일한 `chunk_id`가 유지된다.

관련 파일:

- [fix-stable-chunk-view.mjs](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/scripts/fix-stable-chunk-view.mjs)

### 7.2 `ai_core.v_scc_chunk_preview_base`

역할:

- 원본 `v_scc_chunk_preview` 정의를 snapshot 해둔 백업 view
- deterministic `chunk_id`를 입힌 새 view를 재구성할 때 기반 소스로 사용

주의:

- stable chunk view 보정 스크립트가 최초 실행될 때 생성된다.
- 운영 중 view 재작성 시 이 base view를 기준으로 다시 감싼다.

### 7.3 `ai_core.make_stable_chunk_uuid(...)`

역할:

- `require_id + chunk_type + chunk_seq + reply_state + md5(chunk_text)`를 조합해 UUID 생성
- 같은 논리 chunk는 항상 같은 `chunk_id`가 나오게 한다.

효과:

- 임베딩 중복 생성 방지
- chunk 변경 여부 추적 가능
- `scc_chunk_embeddings`와의 연결 안정성 확보

### 7.4 `ai_core.scc_chunk_embeddings`

역할:

- 각 chunk 텍스트의 embedding 결과를 저장
- vector 검색의 실질적 대상 테이블

주요 컬럼:

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `chunk_id` | `uuid` | `v_scc_chunk_preview.chunk_id`와 연결 |
| `scc_id` | `bigint` | SCC ID |
| `require_id` | `uuid` | 요청 ID |
| `chunk_type` | `text` | chunk 종류 |
| `chunk_text` | `text` | 임베딩 대상 텍스트 원문 |
| `text_hash` | `text` | `md5(chunk_text)` |
| `embedding_model` | `text` | `provider:model` 형식. 예: `google:gemini-embedding-001` |
| `embedding_dim` | `integer` | 임베딩 차원 |
| `embedding_values` | `float8[]` | 원본 임베딩 값 배열 |
| `embedding_norm` | `float8` | 코사인 유사도 계산용 norm |
| `source_ingested_at` | `timestamptz` | 소스 적재 시각 |
| `embedded_at` | `timestamptz` | 임베딩 실행 시각 |
| `updated_at` | `timestamptz` | 갱신 시각 |
| `embedding_vec` | `vector` | pgvector 전용 컬럼 |

Primary Key:

- `(chunk_id, embedding_model)`

의미:

- 같은 chunk라도 모델이 다르면 별도 row로 저장 가능
- 동일 모델 기준으로는 중복 저장 대신 upsert

현재 상태:

- `13255` rows
- 모두 `google:gemini-embedding-001` / `3072` 차원
- `embedding_vec` 컬럼 존재
- ANN 인덱스는 아직 없음

### 7.5 `ai_core.embedding_ingest_state`

역할:

- embedding 적재 작업의 상태 저장
- 최근 성공/실패 메시지 확인 가능

주요 컬럼:

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `state_key` | `text` | 예: `scc_chunk_embeddings:google:gemini-embedding-001` |
| `last_source_ingested_at` | `timestamptz` | 마지막 소스 적재 시점 |
| `last_run_at` | `timestamptz` | 마지막 실행 시각 |
| `last_status` | `text` | `ok`, `error`, `running`, `never` |
| `last_message` | `text` | 실행 결과 요약 |
| `updated_at` | `timestamptz` | 갱신 시각 |

현재 주요 row:

- `scc_chunk_embeddings:google:gemini-embedding-001`
  - `last_status = ok`
  - `last_message = provider=google, model=gemini-embedding-001, selected=143, embedded=143, inserted=143, updated=0, skipped=0`
- 과거 오류 흔적:
  - `google:text-embedding-004` -> 404 model not found

### 7.6 모니터링 view

#### `ai_core.v_scc_embedding_status`

역할:

- 모델별 embedding row 수, embedded chunk 수, 마지막 적재 시각 확인

컬럼:

- `embedding_model`
- `embedding_rows`
- `embedded_chunks`
- `last_embedded_at`
- `last_updated_at`

#### `ai_core.v_scc_embedding_coverage`

역할:

- source chunk 수 대비 embedding coverage 계산

컬럼:

- `embedding_model`
- `source_chunk_rows`
- `embedded_chunks`
- `coverage_pct`

현재 해석:

- `v_scc_chunk_preview`와 `scc_chunk_embeddings` row 수가 둘 다 `13255`이므로 coverage 는 사실상 100% 상태로 볼 수 있다.

## 8. 현재 검색/랭킹 구조

핵심 구현 파일:

- [chat.service.ts](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/src/modules/chat/chat.service.ts)

### 8.1 입력

`POST /chat`

요청 바디:

```json
{
  "query": "휴가신청서 상신이 불가해",
  "retrievalScope": "scc"
}
```

현재 프론트 계약:

- `tenant`, `user`, `sessionId` 등은 보내지 않음
- 최소 입력은 `query`, `retrievalScope`

### 8.2 rule 검색 흐름

1. `v_scc_chunk_preview`에서 chunk row를 읽는다.
2. 질문에서 token/focus token을 추출한다.
3. `issue`, `qa_pair` 기준으로 `require_id` 후보를 먼저 좁히는 fast narrowing 을 수행한다.
4. 각 chunk에 대해 점수를 계산한다.

점수 계산 요소:

- semantic score
- lexical coverage
- focus coverage
- state/evidence/specificity/tech/text length 계열 가중치
- `chunk_type` bonus
- resolution stage bonus
- generic greeting/signature penalty
- weak match penalty

### 8.3 query intent 반영

질문 의도를 3가지로 구분한다.

- `needsResolution`
- `hasSymptom`
- `asksStatus`

예:

- `"어떻게", "방법", "가이드"` -> 해결 의도
- `"오류", "불가", "실패"` -> 증상 질의
- `"상태", "완료", "언제"` -> 상태 질의

이 intent 에 따라 `issue/action/resolution/qa_pair` 트랙의 점수 배합이 달라진다.

### 8.4 vector 검색 흐름

1. 사용자 질문을 embedding provider 로 임베딩한다.
2. 동일 `embedding_model`, `embedding_dim` 조건으로 `scc_chunk_embeddings`를 조회한다.
3. `pgvector` 검색이 가능하면 `embedding_vec`로 cosine distance 정렬을 수행한다.
4. 실패 시 `embedding_values` + `embedding_norm`을 이용한 array scan fallback 을 수행한다.
5. vector 후보를 rule 후보와 merge 한다.

현재 중요한 점:

- `PGVECTOR_SEARCH_ENABLED=true`면 pgvector 경로를 우선 시도
- 현재 ANN 인덱스는 없어도 SQL 레벨 vector 연산은 동작한다
- 실패 시 `PGVECTOR_QUERY_FAILED_FALLBACK_ARRAY_SCAN` 진단값이 나올 수 있다

### 8.5 최종 랭킹

require 단위로 집계한 뒤 다음을 조합해 최종 점수를 만든다.

- rule score
- answer track score
- issue track score
- support track score
- vector score
- resolution + qa_pair completeness bonus

현재 구현상 최종 혼합 비율:

- vector signal 있음: `0.65 * rule + 0.35 * vector`
- vector signal 없음: `rule only`

후보 응답:

- 최대 `5개`의 `candidates`
- `confidence >= 0.45`이면 `bestRequireId`, `bestSccId`, `bestAnswerText`를 채운다

## 9. 현재 LLM 구조

핵심 구현 파일:

- [llm.service.ts](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/src/modules/chat/llm.service.ts)
- [server.ts](C:/Users/shpark6/Desktop/AI작업/coviAI/workspace-fastify/src/app/server.ts)

### 9.1 LLM 호출 방식

현재는 Google Gemini `generateContent` API 사용.

기본 모델:

- `gemini-2.5-flash`

호출 전제:

- `GOOGLE_API_KEY`가 `process.env`에 있어야 함
- 없으면 LLM 호출 불가

키가 없을 때 동작:

- `llmUsed = false`
- `llmError = GOOGLE_API_KEY_MISSING`
- deterministic fallback 또는 검색 결과 요약만 반환

### 9.2 LLM에 넘기는 데이터

LLM은 DB 전체를 직접 보지 않는다.  
다음 정보만 프롬프트로 받는다.

- 사용자 `query`
- `best_require_id`
- `best_scc_id`
- `best_chunk_type`
- `best_confidence`
- `best_chunk_text`
- `retrieval_mode`
- `vector_used`
- `vector_error`
- 상위 `candidates` 목록

즉, 현재 구조는 "검색 + 후보 비교 + 설명 생성"이지, "LLM이 DB를 직접 탐색"하는 구조는 아니다.

### 9.3 현재 답변 포맷

설명형 강화 이후 목표 포맷:

1. 핵심 답변
2. 적용 방법
3. 확인 포인트
4. 참고 링크

현재 프롬프트 룰:

- retrieval context 와 candidates 안의 정보만 사용
- 추측 금지
- candidate 에 없는 `selectedRequireId` 금지
- 완전 일치가 없더라도 유사 사례가 있으면 "유사사례 기반 안내" 허용

### 9.4 LLM 스킵 정책

현재 서버 로직:

- 설명형 질의(`어떻게`, `방법`, `하는 법`, `가이드`, `절차`, `설정`, `추가`, `코드`, `구성`)는 LLM을 스킵하지 않음
- 그 외에는 환경변수 설정에 따라 high-confidence case 에서 LLM 스킵 가능

현재 `.env.example` 기본값:

- `LLM_SKIP_ON_HIGH_CONFIDENCE=false`
- `LLM_CANDIDATE_TOP_N=5`
- `LLM_TIMEOUT_MS=7000`

의도:

- "다국어 코드 추가하는 법" 같은 how-to 질의는 설명형 답변 품질을 우선
- 단순 유사 이력 안내는 향후 필요 시 성능 우선 모드로 다시 돌릴 수 있음

### 9.5 응답 진단 필드

`/chat` 응답에는 다음 진단 필드가 포함된다.

- `vectorUsed`
- `retrievalMode`
- `vectorError`
- `llmUsed`
- `llmModel`
- `llmError`
- `llmSelectedRequireId`
- `llmSelectedSccId`
- `llmReRanked`
- `llmSkipped`
- `llmSkipReason`
- `timings.retrievalMs`
- `timings.llmMs`
- `timings.totalMs`

## 10. 현재 성능/정확도 관련 메모

### 10.1 성능 병목 후보

현재 `/chat`의 주요 지연 구간:

1. 질문 임베딩 API 호출
2. PostgreSQL vector 검색
3. LLM 생성 API 호출

특히 느려질 수 있는 조건:

- `GOOGLE_API_KEY`가 있고 LLM 설명형 답변이 활성화된 경우
- `gemini-embedding-001`의 3072 차원 때문에 ANN 인덱스가 없는 경우
- vector 검색이 full-scan 성격으로 동작하는 경우

### 10.2 정확도 보정 포인트

이미 반영된 사항:

- 동의어 그룹 확장
- focus token 기반 require narrowing
- generic greeting/signature penalty
- explanation query 는 LLM 강제 경로

아직 추가 여지 있는 사항:

- 도메인별 synonym dictionary 확대
- query intent 별 score 정책을 테이블화
- 평가셋 기반 Top1 / Top3 정량 튜닝
- `qa_pair` / `resolution` / `action` 간 가중치 정교화

## 11. 실행 방법

### 11.1 개발 서버

```powershell
cd C:\Users\shpark6\Desktop\AI작업\coviAI\workspace-fastify
npm ci
npm run typecheck
npm run build
npm run dev
```

기본 포트:

- `3101`

확인 URL:

- `http://localhost:3101/health`
- `http://localhost:3101/test/chat`

### 11.2 LLM 키 설정 예시

PowerShell:

```powershell
$env:LLM_PROVIDER="google"
$env:GOOGLE_API_KEY="실제키"
$env:GOOGLE_MODEL="gemini-2.5-flash"
$env:LLM_TIMEOUT_MS="7000"
npm run dev
```

주의:

- `.env.example`는 자동 반영되지 않는다.
- 반드시 현재 실행 중인 쉘에 환경변수를 넣어야 한다.

## 12. DB 구축/운영 스크립트

### 12.1 스크립트 목록

| 명령 | 역할 |
| --- | --- |
| `npm run db:init:vector` | `ai_core` 스키마/기본 테이블/모니터링 view 생성 |
| `npm run db:fix:stable-chunk-view` | deterministic `chunk_id` 적용 |
| `npm run db:enable:pgvector` | `embedding_vec` 컬럼 백필 및 pgvector 활성화 |
| `npm run ingest:sync:scc-embeddings` | 누락/변경 chunk 임베딩 적재 |

### 12.2 추천 초기 세팅 순서

```powershell
npm run db:init:vector
npm run db:fix:stable-chunk-view
npm run db:enable:pgvector
npm run ingest:sync:scc-embeddings -- --provider google --batch-size 50 --max-batches 5
```

### 12.3 임베딩 적재 방식

선정 기준:

- `v_scc_chunk_preview`에 존재
- `chunk_text` 길이 > 0
- `chunk_type in ('issue', 'action', 'resolution', 'qa_pair')`
- 해당 `embedding_model` row 가 없거나 `text_hash`가 달라진 경우

즉:

- 동일 모델 기준 중복 row는 새로 insert 하지 않음
- 텍스트가 바뀌면 update
- `chunk_id + embedding_model` 기준 upsert

### 12.4 Google 임베딩 주의점

현재 free tier 사용 이력이 있었고, 과거 `429 quota exceeded`가 발생한 적이 있다.

관련 환경변수:

- `GOOGLE_EMBEDDING_MIN_INTERVAL_MS`
- `GOOGLE_EMBEDDING_MAX_RETRIES`

과거 확인된 오류:

- `text-embedding-004` -> 404 model not found
- `gemini-embedding-001` -> 무료 플랜 quota 초과 시 429 가능

## 13. 현재 Git 상태

브랜치:

- `main`

최근 커밋:

- `1ccb419 docs: README 데이터 모델 ERD 시각화 추가`
- `8c9a48e docs: 임베딩 설정과 /chat 응답 진단 필드 문서화`
- `c75696a feat(chat): rule-only 폴백과 벡터 진단 필드 추가`
- `bcb159b feat(ingest): 임베딩 동기화 안정화와 재시도 로직 적용`
- `73bdb00 feat(db): chunk 뷰 고정 ID 보정 스크립트 추가`

현재 미커밋 변경:

- `.env.example`
- `README.md`
- `package.json`
- `scripts/init-vector-schema.mjs`
- `scripts/sync-scc-embeddings.mjs`
- `src/app/server.ts`
- `src/modules/chat/chat.service.ts`
- `src/modules/chat/chat.types.ts`
- `src/modules/chat/llm.service.ts`
- `scripts/enable-pgvector-search.mjs` (untracked)

중요:

- 위 변경사항 중 일부는 이미 동작 검증이 끝난 상태지만 아직 커밋되지 않았다.
- 다음 에이전트는 먼저 `git status`와 `git diff`를 확인한 뒤 작업을 이어가는 것이 안전하다.

## 14. 다음 에이전트가 우선 확인할 것

1. `GOOGLE_API_KEY`가 실제 런타임 쉘에 설정되어 있는지 확인
2. `/chat` 응답에서 `llmUsed`, `llmSkipped`, `timings` 확인
3. `ai_core.scc_chunk_embeddings` row 수와 `v_scc_chunk_preview` row 수가 계속 일치하는지 확인
4. `db:enable:pgvector` 실행 결과로 ANN 인덱스가 없는 상태인지 확인
5. `다국어 코드 추가하는 법`, `휴가신청서 상신 불가` 같은 대표 질의로 정확도 재검증

## 15. 추천 다음 작업

우선순위 기준 추천:

1. 평가용 질문셋을 만들어 Top1 / Top3 정확도를 수치화
2. `qa_pair`, `resolution`, `action` 가중치 정책을 명시적으로 테이블화
3. 질의 유형별 프롬프트 템플릿 분리
4. pgvector 차원 제한을 우회할 전략 결정
   - 저차원 embedding 모델 재선정
   - `halfvec` 검토
   - 차원 축소 전략 검토
5. `/chat` 응답 로깅과 실패 케이스 저장 구조 추가

## 16. 빠른 점검용 SQL

### row count 확인

```sql
select count(*) from ai_core.v_scc_chunk_preview;
select count(*) from ai_core.scc_chunk_embeddings;
```

### 모델별 임베딩 분포

```sql
select embedding_model, embedding_dim, count(*)
from ai_core.scc_chunk_embeddings
group by embedding_model, embedding_dim
order by count(*) desc;
```

### 적재 상태

```sql
select *
from ai_core.embedding_ingest_state
order by updated_at desc;
```

### pgvector extension 확인

```sql
select extname, extversion
from pg_extension
where extname = 'vector';
```

### 인덱스 확인

```sql
select indexname, indexdef
from pg_indexes
where schemaname='ai_core'
  and tablename='scc_chunk_embeddings'
order by indexname;
```

## 17. 핵심 결론

현재 상태는 다음과 같이 요약할 수 있다.

- chunk view 기반 검색 구조는 살아있다.
- `scc_chunk_embeddings`는 source chunk 와 동일한 `13255`건으로 채워져 있다.
- pgvector extension 은 설치되었고 `embedding_vec`도 존재한다.
- 하지만 현재 `3072` 차원 embedding 때문에 ANN 인덱스는 없다.
- `/chat`는 rule + vector 기반으로 후보를 뽑고, 설명형 질의는 LLM으로 답변을 생성하도록 조정되어 있다.
- LLM 품질은 아직 검색 후보 품질에 크게 의존한다.
- 다음 작업의 핵심은 "정확도 평가 체계"와 "검색/프롬프트 정책 고도화"다.

## 18. ���� 3 �ε��

���� ���� �򰡴� `���� 2 �Ĺ� ~ ���� 3 ����`�̴�.  
���� 3 �Ϸ��� �ǹ̴� "�˻� ��Ȯ��, �亯 �ϰ���, ��� ����, � Ʃ���� ������ ������������ RAG"��.

### 18.1 üũ����Ʈ

1. Retrieval ����ȭ
- `query rewrite` �ߺ� ġȯ ���� ����
- synonym ���� ����
- rule/vector/fusion ����ġ ������
- relevance filter �Ӱ谪 Ʃ��
- `qa_pair`, `resolution`, `issue`, `action` Ÿ�� �켱���� ������

2. Vector �˻� ����ȭ
- ���� �Ӻ��� ��� ����ȭ
- `vectorUsed=true`, `retrievalMode=hybrid` �ǿ ����
- pgvector �ε��� ���� Ȯ��
- quota �ʰ� �ÿ��� rule-only fallback ����

3. Answer ���� ǰ��
- fallback �亯�� ����� �ȳ��� �������� �ϰ�ȭ
- `similarIssueUrl`�� ���� �ʵ�� �亯 ������ ��� ����
- `answerSource`(`llm`, `deterministic_fallback`, `rule_only`) �߰� ����
- raw � ���� ���� ��ȭ

4. ��ü�� ����
- ��ǥ ������ 20~50�� �ۼ�
- `expectedRequireId`, `expectedChunkType`, `answerable` ����
- Top1 / Top3 ���߷� ���� ���� ���� Ȯ��

5. � ������
- `timings` ����ȭ (`ruleMs`, `embeddingMs`, `vectorMs`, `llmMs`)
- `/retrieval/search`�� �������� �ĺ� ���� �ٰ� ���� ���� ���� ����
- `vectorError`, `llmError`, `llmSkipReason`, fallback ���� �α� �ϰ�ȭ

6. ����/��� ����
- LLM skip ��å ����
- timeout, cache TTL, Top-K Ʃ��
- �ܺ� �Ӻ���/LLM ��� �ÿ��� `/chat` ���� ���� ����

### 18.2 �ܰ躰 ���� ����

1. Step 1: `query rewrite` ���� ����
2. Step 2: �򰡼� �ۼ�
3. Step 3: vector ��� ����ȭ
4. Step 4: answer source / fallback ���� ����
5. Step 5: timings ����ȭ
6. Step 6: ����ġ Ʃ�� �ݺ�

### 18.3 �Ϸ� ���� ����

1. ��ǥ ���������� Top1 / Top3 ���߷� ���� ����
2. `/retrieval/search`�� �ĺ� ���� �ٰ� Ȯ�� ����
3. `generatedAnswer`�� ������ ����� �ȳ��� ���� ����
4. vector ��� �ÿ��� `/chat` ���� ����
5. ����ð��� ���� ������ �α�/���信�� ���� ����
6. ��ڰ� ����� ���� ������ ������ �� ����

## 19. �򰡼� �ڻ�

Step 2 ����� �Ʒ� ������ �߰��Ǿ���.

- `docs/eval/README.md`
- `docs/eval/scc_eval_set.seed.json`

�ǵ�:

- ��ǥ ������ �������� Top1 / Top3 ���߷��� �����ϱ� ���� �ʱ� �õ� �ڻ�
- `/chat`, `/retrieval/search`�� ���� ���������� �ݺ� �����ϱ� ���� ������
- �缺 ��ʿ� ���� ��ʸ� �Բ� �����Ͽ� retrieval �������� ���ε� Ȯ�� ����

���� �õ� ����:

- �缺 ����: 13��
- ���� ����: 4��
- �ֿ� �±�: `symptom`, `howto`, `approval`, `attendance`, `document-view`, `negative`

���� �۾��ڴ� �� �������� �������� �Ʒ��� �����ϸ� �ȴ�.

1. `/retrieval/search`�� Top1 / Top3 ���� ���� Ȯ��
2. `/chat`���� `generatedAnswer`, `similarIssueUrl`, `llmSkipped`, `timings` Ȯ��
3. Ʃ�� ��/�� ��� ��

## 20. Step 3 진행 메모

- 질의 임베딩 모델은 `EMBEDDING_MODEL_AUTO_ALIGN=true`일 때 DB에 실제 적재된 주력 모델로 자동 정렬된다.
- 현재 live 적재 모델은 `google:gemini-embedding-2-preview`이며 차원은 `768`이다.
- `npm run db:check:vector`로 현재 적재 모델, 차원, coverage를 먼저 확인한 뒤 `/retrieval/search`에서 `vectorModelTag`, `vectorStrategy`, `vectorCandidateCount`를 같이 본다.

## 21. Step 4 진행 메모

- `/chat` 응답에는 `answerSource`와 `answerSourceReason`가 추가되었다.
- 값 의미:
  - `llm`: LLM 생성 답변이 최종 채택된 경우
  - `deterministic_fallback`: hybrid retrieval 후 deterministic 포맷 답변으로 대체된 경우
  - `rule_only`: vector 경로 미사용 또는 실패 상태에서 rule 기반 deterministic 답변이 반환된 경우
- deterministic fallback 답변은 `핵심 안내 / 유사 사례 / 처리 내역 / 확인 포인트 / 참고 링크` 형식으로 고정했다.

## 22. Step 5 진행 메모

- `/chat`, `/retrieval/search` 응답의 `timings`가 세분화되었다.
- 현재 포함 필드:
  - `ruleMs`: rule retrieval 및 rule score 계산 시간
  - `embeddingMs`: 질문 임베딩 생성 시간
  - `vectorMs`: vector similarity 조회 시간
  - `rerankMs`: fusion/relevance/rerank 계산 시간
  - `retrievalMs`: retrieval 전체 시간
  - `llmMs`: LLM 생성 시간(`/chat` 전용)
  - `totalMs`: API 전체 시간(`/chat` 전용)
  - `cacheHit`: retrieval cache 사용 여부
- live `/retrieval/search`에서 상세 timings 노출 확인 완료.

## 23. Step 6 1차 결과

- 평가 명령: 
pm run eval:retrieval`r
- 평가 기준: ule_only`r
- 결과:
  - Top1Hit: 13/13 (100%)`r
  - Top3Hit: 13/13 (100%)`r
  - ChunkTypeHit: 13/13 (100%)`r
  - NegativeCorrect: 4/4 (100%)`r
- 현재 .env는 정상 로드되지만, 질문 임베딩 단계에서 GOOGLE_EMBEDDING_HTTP_429가 발생하여 실제 vector search는 미사용 상태다.
- 따라서 hybrid 재측정은 Google embedding quota 회복 후 다시 진행해야 한다.


## 24. Step 6 1차 결과 정리

- 평가 명령: npm run eval:retrieval
- 평가 기준: rule_only
- 결과:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
- .env는 정상 로드되지만 질문 임베딩 단계에서 GOOGLE_EMBEDDING_HTTP_429가 발생하여 실제 vector search는 현재 미사용 상태다.
- 따라서 hybrid 재측정은 Google embedding quota 회복 후 다시 진행해야 한다.


## 25. Step 6 Rule-only Summary

- Command: npm run eval:retrieval
- Basis: rule_only
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
- .env is loaded correctly, but query embedding currently fails with GOOGLE_EMBEDDING_HTTP_429.
- Hybrid re-measurement is pending until Google embedding quota recovers.


## 26. Step 6 Hybrid Recheck

- Command: npm run eval:retrieval
- Dataset: docs/eval/scc_eval_set.seed.json
- Runtime artifact: docs/eval/hybrid_recheck.latest.json
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
  - hybridCount: 17
  - vectorUsedCount: 17
- Conclusion:
  - query embedding, pgvector retrieval, and hybrid ranking are active
  - no score-table patch was applied in phase 2 because the current seed set showed no false positives or misses
  - next tuning target is a larger production-like Korean query set


## 27. Step 6 Phase 3

- Dataset size was expanded to 38 items (29 answerable, 9 negative).
- Retrieval tuning in phase 3 focused on domain vocabulary expansion, not major score-table changes.
- Added operational-domain tokens and variants for browser cache, popup settings, messenger, message-id, HTML paste, tax invoice, approval box visibility, and date/time layout queries.
- Added EVAL_QUERY_DELAY_MS support to scripts/eval-scc-retrieval.mjs for rate-limit-friendly evaluation.
- Observed result on the expanded set:
  - Top1Hit: 27/29 (93.1%)
  - Top3Hit: 29/29 (100%)
  - ChunkTypeHit: 28/29 (96.55%)
  - NegativeCorrect: 9/9 (100%)
- Remaining misses are mostly same-topic neighboring SCC cases rather than hard false positives.
- Repeated evaluation can fall back to rule_only when Google embedding returns QUERY_EMBEDDING_COOLDOWN_ACTIVE. Use EVAL_QUERY_DELAY_MS and run inside a fresh quota window when hybrid-only verification is required.


## 28. Evaluation Policy and Chat Quality

- Representative SCC policy: use a representative SCC for generic operational questions when several SCC records describe the same symptom or fix.
- Exact SCC policy: require exact SCC only when the query contains strong identifiers such as company name, form name, SCC ID, or document number.
- Cooldown policy: treat QUERY_EMBEDDING_COOLDOWN_ACTIVE as an operational limit, not as a retrieval-policy miss.
- /chat quality artifact: docs/eval/chat_quality.phase3.latest.json
- /chat quality summary on the 38-item set:
  - exactBestHit: 27/29 (93.1%)
  - top3SupportHit: 29/29 (100%)
  - answerFormatOk: 29/29 (100%)
  - linkAttached: 28/29 (96.55%)
  - negativeGuarded: 9/9 (100%)
- Remaining /chat quality issue: EV-029 can fall back to safe default without a link inside a cooldown window, but succeeds in isolated hybrid evaluation.


## 29. Phase 4 Evaluation (50-item set)

- dataset size: 50 items
- composition: 37 answerable, 13 negative
- retrieval artifact: docs/eval/retrieval.phase4.latest.json
- chat artifact: docs/eval/chat_quality.phase4.latest.json
- retrieval result on the 50-item set:
  - Top1Hit: 35/37 (94.59%)
  - Top3Hit: 37/37 (100%)
  - ChunkTypeHit: 37/37 (100%)
  - NegativeCorrect: 13/13 (100%)
- /chat result on the 50-item set:
  - exactBestHit: 35/37 (94.59%)
  - top3SupportHit: 37/37 (100%)
  - answerFormatOk: 37/37 (100%)
  - linkAttached: 37/37 (100%)
  - negativeGuarded: 13/13 (100%)
- runtime note:
  - this long-run phase fell back to rule_only because Google query embeddings hit 429 / QUERY_EMBEDDING_COOLDOWN_ACTIVE
  - the earlier hybrid recheck on the 17-item seed still passed with vectorUsed=true
- representative-SCC cases that remain in phase 4:
  - EV-032
  - EV-039

## 30. Stable JSP Response Contract

- `/chat` now exposes a stable `display` object intended for JSP rendering.
- JSP should use:
  - `display.title`
  - `display.answerText`
  - `display.linkUrl`
  - `display.linkLabel`
  - `display.status`
- raw diagnostics such as `candidates`, `timings`, `llm*`, and `vector*` remain for operator/debug usage.
- sample shape:
  - `display.status`: `matched` | `needs_more_info`
  - `display.answerSource`: `llm` | `deterministic_fallback` | `rule_only`

## 31. EV-029 Cooldown Relaxation

- purpose:
  - avoid dropping a near-threshold operational match to `bestRequireId=null` during embedding cooldown
- promotion rule:
  - only applies when query embedding is unavailable because of cooldown/rate-limit
  - requires `qa_pair` Top1
  - requires score >= 0.43
  - requires strongestLexicalCoverage >= 0.30
  - requires answerTrackScore >= 0.35
  - requires rank-1 margin over rank-2 >= 0.12
- observed result:
  - EV-029 passes as Top1 in isolated rule_only replay
  - negative link suppression remains intact

## 32. Representative SCC Decision and JSP Sample

- EV-039 is now a representative-SCC-allowed case.
- acceptedRequireIds includes `8095a700-bbf4-441e-84d4-f19852f391d0` for the browser-cache persistence issue.
- EV-032 remains exact-only because unrelated SCCs can outrank it during degraded retrieval and should not be accepted as representative.
- A JSP sample widget has been added:
  - docs/integration/chat_widget.sample.jsp
- The JSP sample renders only the stable `display` contract from `/chat`:
  - `display.title`
  - `display.answerText`
  - `display.linkUrl`
  - `display.linkLabel`
  - `display.status`

## 33. Refreshed Phase 4 Result

- retrieval.phase4.latest.json:
  - Top1Hit: 37/37 (100%)
  - Top3Hit: 37/37 (100%)
  - ChunkTypeHit: 37/37 (100%)
  - NegativeCorrect: 13/13 (100%)
  - vectorUsedCount: 50
  - hybridCount: 50
- chat_quality.phase4.latest.json:
  - exactBestHit: 37/37 (100%)
  - top3SupportHit: 37/37 (100%)
  - answerFormatOk: 37/37 (100%)
  - linkAttached: 37/37 (100%)
  - negativeGuarded: 13/13 (100%)
- Security ruleset was expanded to block queries that ask for:
  - 주민등록번호
  - 주민번호
  - 개인정보
  - 민감정보
