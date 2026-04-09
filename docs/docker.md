# Docker 배포 가이드

## 운영 환경 구조

```
사용자 브라우저
  ↓ HTTPS (443)
Nginx (SSL 종료 / 리버스 프록시)
  ├─→ /api/*  → Backend  (Fastify:3101)
  └─→ /*      → Frontend (Next.js:3000)
              ↓
         PostgreSQL 16 + pgvector
         (Oracle Cloud VM 로컬 DB)
```

**운영 도메인:** https://csbotservice.com  
**서버:** Oracle Cloud VM (Ubuntu 22.04, 1GB RAM + 4GB Swap)

---

## CI/CD 자동 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 빌드 및 배포합니다.

```
git push origin main
  └─ [build] GitHub Actions에서 이미지 빌드 → ghcr.io 푸시
  └─ [deploy] VM SSH → docker pull → docker compose up -d
```

**수동 배포가 필요한 경우에만 아래 명령어를 사용하세요.**

---

## 수동 배포 (VM에서)

### 최초 설치

```bash
# 1. 코드 클론
git clone https://github.com/jdhert/CS-ChatBot.git ~/coviAI
cd ~/coviAI

# 2. .env 파일 생성
cat > .env << 'EOF'
GOOGLE_API_KEY=your-google-api-key
GOOGLE_MODEL=gemini-2.5-flash-lite
VECTOR_DB_HOST=VM_HOST_REMOVED
VECTOR_DB_PORT=5432
VECTOR_DB_NAME=ai2
VECTOR_DB_USER=novian
VECTOR_DB_PASSWORD=REMOVED
PGVECTOR_SEARCH_ENABLED=true
QUERY_REWRITE_ENABLED=true
EOF

# 3. SSL 인증서 발급 (최초 1회)
sudo apt install certbot
sudo certbot certonly --standalone -d csbotservice.com -d www.csbotservice.com

# 4. Docker 실행
docker compose --env-file .env up -d --build
```

### 업데이트 배포

```bash
cd ~/coviAI
git pull origin main
docker compose --env-file .env build   # 이미지 빌드 (기존 서비스 유지)
docker compose --env-file .env up -d --no-build  # 컨테이너 교체 (~10초 단절)
```

---

## 환경변수

### 필수

| 변수 | 설명 |
|------|------|
| `GOOGLE_API_KEY` | Google Gemini API 키 |

### 주요 설정 (기본값으로 동작)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GOOGLE_MODEL` | `gemini-2.5-flash-lite` | LLM 모델 |
| `VECTOR_DB_HOST` | `VM_HOST_REMOVED` | DB 호스트 |
| `PGVECTOR_SEARCH_ENABLED` | `true` | pgvector 검색 사용 |
| `QUERY_REWRITE_ENABLED` | `true` | 쿼리 리라이팅 |
| `LLM_MAX_OUTPUT_TOKENS` | `1536` | LLM 최대 출력 토큰 |
| `LLM_SKIP_ON_HIGH_CONFIDENCE` | `true` | 고신뢰도 시 LLM 스킵 |
| `LLM_SKIP_MIN_CONFIDENCE` | `0.75` | LLM 스킵 최소 신뢰도 |
| `LLM_TIMEOUT_MS` | `10000` | LLM 타임아웃 (ms) |
| `LLM_CANDIDATE_TOP_N` | `3` | LLM 전달 후보 수 |

### 속도 최적화 (VM .env에 추가 권장)

```env
LLM_MAX_OUTPUT_TOKENS=800
LLM_TIMEOUT_MS=8000
LLM_CANDIDATE_TOP_N=3
LLM_SKIP_ON_HIGH_CONFIDENCE=true
LLM_SKIP_MIN_CONFIDENCE=0.75
```

---

## 서비스 관리

```bash
# 상태 확인
docker compose ps

# 로그 확인
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx

# 헬스체크
curl http://localhost/health

# 재시작
docker compose restart backend
docker compose restart nginx

# 완전 종료
docker compose down
```

---

## SSL 인증서

Let's Encrypt 인증서는 90일마다 갱신이 필요합니다.

```bash
# 수동 갱신 (Docker 내리고 갱신 후 재시작)
cd ~/coviAI
docker compose down
sudo certbot renew
docker compose --env-file .env up -d
```

**자동 갱신 cron 설정:**

```bash
sudo crontab -e
# 매월 1일 새벽 3시 자동 갱신
0 3 1 * * cd /home/ubuntu/coviAI && docker compose down && certbot renew --quiet && docker compose --env-file .env up -d
```

---

## 트러블슈팅

### 백엔드 응답 없음

```bash
docker compose logs backend --tail 50
curl http://localhost:3101/health
```

### Nginx 502 Bad Gateway

```bash
# backend/frontend 헬스체크 통과 전 nginx가 먼저 뜨는 경우
docker compose restart nginx

# Nginx 설정 확인
docker compose exec nginx nginx -t
```

### SSL 인증서 오류

```bash
# 인증서 만료 확인
sudo certbot certificates

# 인증서 경로 확인 (컨테이너 마운트)
ls /etc/letsencrypt/live/csbotservice.com/
```

### Docker 이미지 pull 실패 (ghcr.io)

```bash
# GitHub Container Registry 로그인
echo "GITHUB_PAT" | docker login ghcr.io -u USERNAME --password-stdin

# 또는 로컬 빌드로 대체
docker compose --env-file .env up -d --build
```

### 메모리 부족 (1GB VM)

```bash
# 메모리 / Swap 확인
free -h

# 미사용 이미지 정리
docker image prune -f
docker system prune -f
```

---

## 보안 체크리스트

- [x] 환경변수로 민감 정보 관리 (`.env` 파일)
- [x] `.env` 파일 `.gitignore` 등록
- [x] Non-root 사용자로 컨테이너 실행
- [x] 불필요한 포트 노출 제거 (`expose` vs `ports`)
- [x] HTTPS 적용 (Let's Encrypt / Nginx SSL)
- [x] HTTP → HTTPS 자동 리다이렉트
- [x] HSTS 헤더 적용
- [x] Oracle Cloud Security List 방화벽 설정 (80/443 오픈)
- [ ] API Rate Limiting (`@fastify/rate-limit` 미적용)
- [ ] 정기적인 이미지 취약점 스캔

---

## 변경 이력

### 2026-04-09 (최신)
- ✅ Oracle Cloud VM 이관 완료 반영
- ✅ CI/CD GitHub Actions 파이프라인 섹션 추가
- ✅ SSL/Let's Encrypt 운영 절차 추가
- ✅ 속도 최적화 환경변수 가이드 추가
- ✅ AWS/K8s 마이그레이션 섹션 제거 (Oracle Cloud로 완료)

### 2026-04-02
- ✅ 대화 이력 DB 영속화 관련 환경변수 추가

### 2026-03-25
- ✅ 초기 Docker 배포 가이드 작성
