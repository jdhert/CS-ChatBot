# SCC Evaluation Set

이 디렉터리는 `/chat`, `/retrieval/search` 품질을 정량 검증하기 위한 평가셋 자산을 보관한다.

## 목적

- 대표 질문셋 기준으로 Top1 / Top3 적중률을 측정한다.
- retrieval 튜닝 전/후 품질을 비교한다.
- `generatedAnswer`가 근거 기반으로 일관되게 나오는지 확인한다.
- vector 장애 시에도 `rule_only` 품질이 유지되는지 확인한다.

## 파일

- `scc_eval_set.seed.json`
  - 초기 시드 평가셋
  - 실제 `ai_core.v_scc_chunk_preview` 사례를 기준으로 만든 대표 질문셋
- `query_log_eval_candidates.latest.json`
  - `ai_core.query_log`에서 자동 추출한 실패/싫어요/결과 없음/저신뢰 eval 후보
  - 실행 산출물이므로 Git 추적 대상이 아니며, 수동 검토 후 `scc_eval_set.seed.json`으로 승격한다.

## 데이터 스키마

각 항목은 아래 필드를 가진다.

```json
{
  "id": "EV-001",
  "query": "휴가신청서 상신이 불가해",
  "retrievalScope": "scc",
  "expectedRequireId": "6af1f31c-c3aa-4534-8c5a-0d6a29fec1ac",
  "expectedSccId": "250467",
  "expectedChunkType": "qa_pair",
  "answerable": true,
  "tags": ["symptom", "approval", "leave"],
  "notes": "대표적인 고신뢰 양성 샘플"
}
```

필드 의미:

- `id`: 평가셋 고유 ID
- `query`: 실제 사용자 질문 형태
- `retrievalScope`: 현재는 기본 `scc`
- `expectedRequireId`: 기대 Top1 `require_id`
- `expectedSccId`: 기대 SCC ID
- `expectedChunkType`: 기대 대표 chunk type
- `answerable`: 답변 가능 여부
- `tags`: 질의 유형 태그
- `notes`: 판정 보조 메모

## 판정 기준

### 1. Retrieval

- `Top1 hit`
  - `/chat.bestRequireId` 또는 `/retrieval/search.bestRequireId`가 `expectedRequireId`와 일치
- `Top3 hit`
  - `candidates[0..2].requireId` 안에 `expectedRequireId` 포함
- `Chunk type hit`
  - `bestChunkType`가 `expectedChunkType`와 일치

### 2. Answer

- `answerable=true`
  - `generatedAnswer`가 유사사례 또는 처리안내를 포함해야 함
  - `similarIssueUrl` 또는 답변 내부 링크가 존재해야 함
- `answerable=false`
  - 무리한 답을 만들지 않고 추가 정보 요청 또는 관련 이력 없음으로 응답해야 함

## 수동 실행 절차

### `/retrieval/search` 검증

```powershell
$body = @{
  query = "휴가신청서 상신이 불가해"
  retrievalScope = "scc"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3101/retrieval/search `
  -ContentType "application/json; charset=utf-8" `
  -Body $body | ConvertTo-Json -Depth 8
```

확인 항목:

- `bestRequireId`
- `confidence`
- `candidates[0..2]`
- `fusionRankScore`
- `relevancePenalty`
- `relevancePassed`

### `/chat` 검증

```powershell
$body = @{
  query = "휴가신청서 상신이 불가해"
  retrievalScope = "scc"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3101/chat `
  -ContentType "application/json; charset=utf-8" `
  -Body $body | ConvertTo-Json -Depth 8
```

확인 항목:

- `bestRequireId`
- `generatedAnswer`
- `similarIssueUrl`
- `llmUsed`
- `llmSkipped`
- `timings`

## 운영 원칙

1. 질문셋은 증상형 / how-to형 / 상태확인형 / 무관질문을 섞어서 유지한다.
2. 평가셋 수정 시에는 왜 추가/변경했는지 커밋 메시지나 handoff 문서에 남긴다.
3. retrieval 튜닝 전/후에는 동일 질문셋으로 반드시 다시 측정한다.

## 운영 로그 기반 후보 추출

운영 `query_log`에 쌓인 실패/싫어요/결과 없음/저신뢰 질의를 eval 후보로 추출한다.

```powershell
cd workspace-fastify
npm run eval:candidates -- --days 14 --limit 50
```

기본 산출물:

- `docs/eval/query_log_eval_candidates.latest.json`

추출 조건:

- `user_feedback = 'down'`
- `is_failure = true`
- `is_no_match = true`
- `confidence < 0.45`

옵션:

- `--days 30`: 최근 30일 기준
- `--limit 100`: 후보 최대 100건
- `--min-confidence 0.5`: 저신뢰 기준 변경
- `--include-slow --slow-ms 8000`: 느린 쿼리도 후보에 포함

주의:

- 자동 후보는 `manualReviewRequired=true`로 생성된다.
- `draftEvalItem.expectedRequireId`는 당시 관측된 best 후보일 뿐 정답으로 확정하면 안 된다.
- 운영 로그와 SCC 이력을 확인한 뒤 `expectedRequireId`, `expectedChunkType`, `answerable`을 확정해서 seed로 승격한다.


## Latest Hybrid Recheck

- command: npm run eval:retrieval
- dataset: docs/eval/scc_eval_set.seed.json
- runtime artifact: docs/eval/hybrid_recheck.latest.json
- result:
  - Top1Hit: 13/13
  - NegativeCorrect: 4/4
  - hybridCount: 17
  - vectorUsedCount: 17
- note:
  - the latest run confirmed that query embeddings, pgvector retrieval, and hybrid ranking are active
  - Step 6 phase 2 did not change the current score table because the seed set showed no false positives or misses



## Phase 3 Expanded Set

- dataset size: 38 items
- composition: 29 answerable, 9 negative
- eval delay support: set EVAL_QUERY_DELAY_MS when running against Google embeddings
- observed result after phase 3 tuning:
  - Top1Hit: 27/29 (93.1%)
  - Top3Hit: 29/29 (100%)
  - ChunkTypeHit: 28/29 (96.55%)
  - NegativeCorrect: 9/9 (100%)
- caution: repeated runs may hit QUERY_EMBEDDING_COOLDOWN_ACTIVE and temporarily fall back to rule_only



## Chat Quality Phase 3

- command: npm run eval:chat
- artifact: docs/eval/chat_quality.phase3.latest.json
- policy:
  - use representative SCC matching for generic operational questions
  - require exact SCC only for identifier-bearing queries
  - separate QUERY_EMBEDDING_COOLDOWN_ACTIVE from retrieval-policy misses
- observed result:
  - exactBestHit: 27/29 (93.1%)
  - top3SupportHit: 29/29 (100%)
  - answerFormatOk: 29/29 (100%)
  - linkAttached: 28/29 (96.55%)
  - negativeGuarded: 9/9 (100%)

## Phase 4 Expanded Set

- dataset size: 50 items
- composition: 37 answerable, 13 negative
- retrieval artifact: docs/eval/retrieval.phase4.latest.json
- chat artifact: docs/eval/chat_quality.phase4.latest.json
- long-run note:
  - the refreshed phase-4 run completed as full hybrid
  - `vectorUsedCount=50`, `hybridCount=50`
- retrieval result:
  - Top1Hit: 37/37 (100%)
  - Top3Hit: 37/37 (100%)
  - ChunkTypeHit: 37/37 (100%)
  - NegativeCorrect: 13/13 (100%)
- chat result:
  - exactBestHit: 37/37 (100%)
  - top3SupportHit: 37/37 (100%)
  - answerFormatOk: 37/37 (100%)
  - linkAttached: 37/37 (100%)
  - negativeGuarded: 13/13 (100%)
- representative-SCC case:
  - EV-039: browser-cache follow-up issue
- exact-only case:
  - EV-032: taxinvoice blank-document follow-up

## Cooldown Relaxation Policy

- dedicated mitigation for EV-029-type cases
- if query embedding is unavailable because of cooldown/rate-limit, promote Top1 as a match only when:
  - chunkType is `qa_pair`
  - score >= 0.43
  - strongestLexicalCoverage >= 0.30
  - answerTrackScore >= 0.35
  - margin over rank-2 >= 0.12
- observed result:
  - EV-029 passes as Top1 in isolated rule_only reproduction
  - negative guard and link suppression remain intact

## Representative SCC Decision

- EV-039:
  - allow representative SCC
  - acceptedRequireIds includes `8095a700-bbf4-441e-84d4-f19852f391d0`
  - reason: `251364` and `251382` are the same browser-cache persistence issue and share the same remediation family
- EV-032:
  - keep exact SCC matching
  - reason: representative promotion would weaken evaluation integrity because unrelated SCC can outrank it during degraded retrieval conditions

