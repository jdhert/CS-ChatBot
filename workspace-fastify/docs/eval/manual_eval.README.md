# Manual Evaluation Set

사용자 매뉴얼 검색 MVP를 반복 검증하기 위한 평가셋입니다.

## 파일

- `manual_eval_set.seed.json`: 매뉴얼 how-to 질의 seed
- `manual_retrieval.latest.json`: `npm run eval:manual` 실행 결과 산출물

## 평가 기준

각 항목은 기본적으로 다음 조건을 검증합니다.

- `bestChunkType`이 기대한 `expectedBestChunkType`과 일치하는지
- `manualCandidates[0]`가 존재하는지
- Top1 매뉴얼 후보 점수가 `minManualScore` 이상인지
- 지정된 경우 Top1 후보의 `product`가 `expectedProduct` 또는 `acceptedProducts`와 일치하는지
- 지정된 경우 Top1 후보의 `title`이 `expectedTitleIncludes` 또는 `acceptedTitleIncludes` 중 하나를 포함하는지
- `expectedBestChunkType=manual_clarification`인 경우 `expectedClarificationReason`과 `manualError`가 일치하는지

섹션 단위 정답은 문서 chunk 분할에 따라 흔들릴 수 있으므로 MVP 단계에서는 진단 정보로만 남깁니다.

## 기대 타입

- `manual`: 도메인과 기능이 충분히 구체적이어서 매뉴얼 답변을 바로 내려도 되는 케이스
- `manual_clarification`: 질문이 너무 넓어 잘못된 매뉴얼 화면으로 확정하지 말고 추가 질문을 해야 하는 케이스
- `null`: 매뉴얼 답변으로 처리하지 않아야 하는 negative 케이스

## 실행

```powershell
cd workspace-fastify
npm run eval:manual
```

일부 항목만 확인하려면:

```powershell
npm run eval:manual -- --ids MEV-001,MEV-003
```

운영 Google embedding 쿼터 보호를 위해 필요하면 지연 시간을 지정합니다.

```powershell
$env:MANUAL_EVAL_DELAY_MS="1500"
npm run eval:manual
```

## 운영 해석

- `bestChunkTypeHit`이 낮으면 매뉴얼 guard 또는 도메인 판정 정책이 흔들린 것입니다.
- `manualBestHit`이 낮으면 how-to 매뉴얼 우선 정책 또는 매뉴얼 임베딩 품질을 확인합니다.
- `clarificationHit`이 낮으면 모호 질의 guard가 누락되었거나 과도하게 약해진 것입니다.
- `productHit`이 낮으면 유사한 제품 문서 간 충돌이 있는지 확인합니다.
- `titleHit`이 낮으면 질의 표현을 보강하거나 매뉴얼 chunk 정제/동의어 확장을 검토합니다.
