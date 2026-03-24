# CoviAI - AI Core 챗봇 시스템

코비전 사내 지원 시스템을 위한 AI 기반 질의응답 챗봇 플랫폼

## 📋 프로젝트 개요

CoviAI는 사내 매뉴얼, 이력 데이터, FAQ 등을 기반으로 사용자 질의에 대해 실시간으로 답변을 제공하는 RAG(Retrieval-Augmented Generation) 기반 챗봇 시스템입니다.

## 🏗️ 시스템 아키텍처

### 전체 구조
```
┌─────────────────┐
│  Frontend       │
│  (Next.js)      │ :3000
│  - 챗봇 UI       │
│  - 대화 이력 관리│
└────────┬────────┘
         │ HTTP/SSE
┌────────▼────────┐
│  Backend API    │
│  (Fastify)      │ :3101
│  - 스트리밍 응답 │
│  - RAG 검색      │
└────────┬────────┘
         │
┌────────▼────────┐
│  Database       │
│  (PostgreSQL)   │
│  - 벡터 검색     │
│  - 메타데이터    │
└─────────────────┘
```

### 기술 스택

#### Frontend
- **Framework**: Next.js 16.2.0 (App Router)
- **UI**: React 19, Tailwind CSS
- **상태 관리**: React Hooks
- **저장소**: localStorage (대화 이력 영구 보관)

#### Backend
- **Framework**: Fastify (Node.js)
- **언어**: TypeScript
- **스트리밍**: Server-Sent Events (SSE)
- **데이터베이스**: PostgreSQL + pgvector
- **AI 모델**: Claude API (Anthropic)

## ✨ 주요 기능

### 1. 실시간 스트리밍 응답
- Server-Sent Events (SSE) 기반 실시간 응답 스트리밍
- 타이핑 애니메이션으로 자연스러운 UX 제공
- 청크 단위 점진적 렌더링

### 2. 하이브리드 RAG 검색
- **Rule-based 검색**: 키워드 기반 정확한 매칭
- **Vector 검색**: 시맨틱 유사도 기반 검색 (pgvector)
- **Reranking**: 최종 결과 재정렬로 정확도 향상

### 3. 대화 이력 관리
- localStorage 기반 영구 보관 (최대 50개 대화)
- 날짜별 그룹화 (오늘, 어제, 지난 7일, 이전)
- 대화 제목 자동 생성
- 대화 삭제 및 전환 기능

### 4. 메타데이터 기반 링크 제공
- 유사 이력 바로가기 링크 자동 생성
- 답변 출처 표시 (Manual/SCC)
- 신뢰도(Confidence) 점수 표시

## 🚀 성능 최적화

### 최근 적용된 최적화 (2026-03-23)

#### 문제점
- 초기 질의 응답 시간: ~10초 (ruleMs: 3.4초)
- Focus tokens 경로 사용 시: ~20초 (ruleMs: 9.8초)

#### 해결 방안
1. **Focus tokens 경로 비활성화**
   - 일반적인 토큰 매칭 시 너무 많은 require_ids 반환 (400개)
   - 오히려 성능 저하 발생

2. **ORDER BY 절 제거**
   - 4개 컬럼 정렬이 3.4초 소요
   - 후속 scoring/reranking 단계에서 정렬하므로 불필요
   - LIMIT 500만 사용하여 DB가 최적 인덱스 선택 가능

3. **결과**
   - ruleMs: 3.4초 → **0.3~1.3초** (약 70-90% 개선)
   - 총 응답 시간: ~10초 → **~8초**

#### 성능 측정 로그
```json
{
  "retrievalMs": 1442,
  "timings": {
    "ruleMs": 297,        // 3.4s → 0.3s (90% 개선)
    "embeddingMs": 884,   // 벡터 임베딩 생성
    "vectorMs": 36,       // 벡터 검색
    "rerankMs": 213       // 재정렬
  }
}
```

## 📁 프로젝트 구조

```
coviAI/
├── frontend/                 # Next.js 프론트엔드
│   ├── app/
│   │   ├── page.tsx         # 메인 챗봇 페이지
│   │   └── api/chat/        # API 라우트
│   ├── components/
│   │   └── chatbot/         # 챗봇 UI 컴포넌트
│   └── lib/
│       └── conversations.ts  # 대화 이력 관리
│
├── workspace-fastify/        # Fastify 백엔드
│   ├── src/
│   │   ├── app/
│   │   │   ├── index.ts     # 서버 진입점
│   │   │   └── server.ts    # 라우트 정의
│   │   └── modules/
│   │       └── chat/
│   │           └── chat.service.ts  # RAG 검색 로직
│   └── package.json
│
├── .gitignore
├── package.json
└── README.md
```

## 🔧 설치 및 실행

### 사전 요구사항
- Node.js 18+
- PostgreSQL 15+ (pgvector 확장 설치 필요)
- Anthropic API Key

### 환경 변수 설정
```bash
# settings.env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
ANTHROPIC_API_KEY=your_api_key_here
```

### 설치
```bash
# 전체 의존성 설치
npm install

# 프론트엔드 설치
cd frontend && npm install

# 백엔드 설치
cd workspace-fastify && npm install
```

### 실행
```bash
# 프론트엔드 (포트 3000)
cd frontend
npm run dev

# 백엔드 (포트 3101)
cd workspace-fastify
npm run dev
```

### 접속
- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:3101

## 📊 데이터베이스 스키마

### 주요 뷰: `ai_core.v_scc_chunk_preview`
- `require_id`: 요구사항 ID (UUID)
- `chunk_id`: 청크 ID
- `chunk_text`: 검색 대상 텍스트
- `embedding`: 벡터 임베딩 (pgvector)
- `state_weight`: 상태 가중치
- `resolved_weight`: 해결 여부 가중치
- `evidence_weight`: 증거 가중치
- `specificity_score`: 구체성 점수

## 🔄 RAG 검색 흐름

1. **쿼리 전처리**
   - 사용자 입력 정규화
   - 검색 쿼리 변형 생성 (6가지 변형)

2. **하이브리드 검색**
   - Rule-based: PostgreSQL ILIKE로 키워드 매칭
   - Vector-based: pgvector로 시맨틱 유사도 검색
   - 결과 병합 및 중복 제거

3. **Reranking**
   - Claude API를 통한 relevance 재평가
   - 상위 5개 최종 선택

4. **답변 생성**
   - 선택된 컨텍스트를 프롬프트에 포함
   - Claude API로 스트리밍 답변 생성
   - SSE를 통해 프론트엔드로 전송

## 📈 향후 개선 계획

- [ ] 캐싱 전략 도입 (Redis)
- [ ] 데이터베이스 인덱스 최적화
- [ ] 답변 품질 피드백 시스템
- [ ] 다국어 지원
- [ ] 대화 컨텍스트 유지 (멀티턴)

## 📝 커밋 히스토리

### 2026-03-23
- ✅ 프론트엔드: Next.js 기반 챗봇 UI 구현
- ✅ 백엔드: Fastify 기반 스트리밍 API 구현
- ✅ 성능 최적화: RAG 검색 속도 70-90% 개선

## 📄 라이선스

Copyright (c) 2026 Covision. All rights reserved.

---

**개발 문의**: AI Core Team
