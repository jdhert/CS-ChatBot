# AI Core Architect Guideline (Alias)

본 파일명은 호환용 별칭입니다.

- 최신 기준 문서: `AI_Core_Architect_Guideline_UPDATED.md`
- 본문 변경/운영 정책은 위 파일을 단일 소스로 관리합니다.

이번 반영 사항 요약:

- AI 코어를 독립 서비스로 우선 구동하고 Postman/curl 검증을 선행
- Chat 요청에 `retrievalScope`(`all` | `manual` | `scc`) 명시
- API 경로는 `/health`, `/chat`, `/chat/stream`, `/retrieval/search`, `/admin/ingest` 기준
- 웹서비스 프롬프트 연동은 2차 단계로 후순위 배치
