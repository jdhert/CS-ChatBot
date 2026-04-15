# CoviAI - CS AI Core

코비전 CS AI Core 운영 저장소입니다.  
현재 서비스는 Oracle VM 환경에서 `Next.js + Fastify + PostgreSQL(pgvector)` 조합으로 동작하며, SCC 이력 기반 Hybrid RAG와 사용자 매뉴얼 기반 보조 응답을 함께 제공합니다.

## 서비스 주소
- 운영 URL: `https://csbotservice.com`
- Health Check: `https://csbotservice.com/health`
- 검색 페이지: `https://csbotservice.com/search`
- 운영 로그: `https://csbotservice.com/logs`

## 현재 운영 구조
- Frontend: Next.js App Router, React 19, Tailwind CSS
- Backend: Fastify, TypeScript, SSE 스트리밍 응답
- Database: PostgreSQL 16 + pgvector
- LLM: Google Gemini 2.5 Flash
- Embedding: Google Gemini Embedding 2
- Reverse Proxy: Nginx
- Infra: Oracle Cloud VM + Docker Compose
- CI/CD: GitHub Actions -> GHCR -> Oracle VM 배포

## 핵심 기능
- Hybrid 검색: 규칙 기반 + 벡터 검색 결합
- SSE 채팅 응답: `/api/chat/stream`
- 대화 이력 서버 저장 및 복원
- 대화 제목/검색/그룹핑/삭제 동기화
- 관리자 운영 로그 대시보드
- 사용자 피드백 수집 및 통계 집계
- 사용자 매뉴얼 기반 보조 응답
- 매뉴얼 화면 미리보기(Preview) 연동
- 대화 내보내기: TXT / Markdown / PDF

## 최근 반영 사항

### 2026-04-15
- 대화 내보내기 메뉴를 `PDF 3종 + 기타 2종` 구조로 단순화
- PDF 템플릿을 `응답 / 운영 / 보고` 용도로 분리
- PDF 결과물 내부 시각 차이를 더 크게 조정
  - 사용자용: 밝은 상담 결과지 스타일
  - 운영자용: 진단 리포트 스타일
  - 보고용: 브리핑 문서 스타일
- PDF 카드 아이콘/톤/보조 라벨 차별화 강화
- 루트 `README.md` 한글 인코딩 깨짐 정리

### 2026-04 중순까지 누적 반영
- 운영 API 경로를 Oracle VM 배포 구조 기준으로 정렬
- `/logs` 운영 페이지 고도화 및 배포 메타데이터 표시
- Rate Limit 운영 모니터링 추가
- Embedding 커버리지 모니터링 추가
- 사용자 매뉴얼 MVP 연결 및 평가 스크립트 추가
- 매뉴얼 preview 생성/coverage 리포트 스크립트 추가
- 답변 카드 구조 재정리 및 매뉴얼 전용 UI 추가
- 모바일 화면 UX, 빈 상태 화면, 내보내기 메뉴 UX 개선

## 사용자 매뉴얼(MVP) 구조
현재 1차 MVP는 사용자 매뉴얼 `.docx` 문서를 기반으로 동작합니다.

### 운영 VM 권장 경로
- 원본 문서: `~/coviAI/manuals/user`
- PDF 변환본: `~/coviAI/manuals/pdf`
- Preview 이미지: `~/coviAI/manuals/preview`

### 관련 스크립트
- 매뉴얼 임베딩 동기화
  - `npm run ingest:sync:user-manual -- --source-dir ../manuals/user --batch-size 50 --max-batches 8`
- 매뉴얼 preview 생성
  - `npm run manual:preview:generate -- --source-dir ../manuals/user --pdf-dir ../manuals/pdf --preview-dir ../manuals/preview`
- preview coverage 확인만 수행
  - `npm run manual:preview:generate -- --coverage-only --preview-dir ../manuals/preview`
- 매뉴얼 평가
  - `npm run eval:manual`

### 운영 VM 선행 설치 패키지
매뉴얼 preview 생성을 위해 VM에 아래 패키지가 필요합니다.

```bash
sudo apt-get install -y libreoffice poppler-utils fonts-noto-cjk
```

## 개발 실행

### Frontend
```bash
cd frontend
npm ci
npm run dev
```

### Backend
```bash
cd workspace-fastify
npm ci
npm run dev
```

## 배포
`main` 브랜치에 push 하면 GitHub Actions가 실행되고, 정상 완료 시 Oracle VM에 자동 반영됩니다.

배포 확인 포인트:
- GitHub Actions 실행 상태
- `https://csbotservice.com/health`
- `/logs` 페이지의 배포 메타데이터
- production smoke 결과

## 문서 위치
- 백엔드 상세 README: [workspace-fastify/README.md](./workspace-fastify/README.md)
- 운영 API 라우팅 문서: [docs/architecture/api-routing.md](./docs/architecture/api-routing.md)
- 평가 산출물: `workspace-fastify/docs/eval`

## 주의 사항
- `stor/`, `db_export/` 등 운영 보조 디렉터리는 Git 추적 대상이 아닐 수 있으므로 커밋 전에 범위를 반드시 확인합니다.
- 운영 환경 기준 검증이 우선이며, Oracle VM에 반영된 상태를 `/health`, `/logs`, smoke 평가로 확인합니다.
- 매뉴얼 preview 이미지가 없으면 매뉴얼 답변은 나오더라도 화면 미리보기는 표시되지 않습니다.
