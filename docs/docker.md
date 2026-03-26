# Docker Deployment Guide

## 아키텍처

```
Client (Browser)
  ↓ (port 80)
Nginx (Reverse Proxy)
  ├─→ /api/*     → Backend (Fastify:3101)
  └─→ /*         → Frontend (Next.js:3000)
```

## 사전 준비

### 1. 환경변수 설정

`.env` 파일을 프로젝트 루트에 생성:

```bash
cp .env.example .env
# .env 파일을 열어서 실제 값으로 수정
```

필수 환경변수:
- `GOOGLE_API_KEY`: Google Gemini API 키

### 2. Next.js 설정 확인

`frontend/next.config.js`에 다음 설정 추가:

```javascript
module.exports = {
  output: 'standalone', // Docker 배포를 위한 standalone 빌드
}
```

## 배포 명령어

### 개발 환경

```bash
# 전체 빌드 및 실행
docker-compose up --build

# 백그라운드 실행
docker-compose up -d --build

# 로그 확인
docker-compose logs -f

# 특정 서비스 로그
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f nginx
```

### 프로덕션 환경

```bash
# 프로덕션 빌드
docker-compose -f docker-compose.yml up -d --build

# 상태 확인
docker-compose ps

# 헬스체크
curl http://localhost/health
curl http://localhost/api/health
```

## 서비스 관리

### 중지 및 재시작

```bash
# 중지
docker-compose stop

# 재시작
docker-compose restart

# 특정 서비스만 재시작
docker-compose restart backend

# 완전 종료 (컨테이너 삭제)
docker-compose down

# 볼륨까지 삭제
docker-compose down -v
```

### 스케일링

```bash
# 백엔드 인스턴스 3개로 스케일 아웃
docker-compose up -d --scale backend=3

# Nginx에서 로드밸런싱 자동 처리
```

## 접속 정보

- **Frontend**: http://localhost
- **Backend API**: http://localhost/api
- **Health Check**: http://localhost/health

## CORS 해결

모든 요청이 동일 오리진(`http://localhost`)에서 처리되므로 CORS 문제가 발생하지 않습니다.

Frontend에서 API 호출 시:

```typescript
// ✅ 올바른 방법 (상대 경로)
fetch('/api/chat', { ... })

// ❌ 잘못된 방법 (절대 경로)
fetch('http://localhost:3101/chat', { ... })
```

## 트러블슈팅

### 1. 백엔드 연결 실패

```bash
# 백엔드 로그 확인
docker-compose logs backend

# DB 연결 확인
docker-compose exec backend wget -O- http://localhost:3101/health
```

### 2. 프론트엔드 빌드 실패

```bash
# Next.js 빌드 로그 확인
docker-compose logs frontend

# 컨테이너 내부 접속
docker-compose exec frontend sh
```

### 3. Nginx 프록시 오류

```bash
# Nginx 설정 테스트
docker-compose exec nginx nginx -t

# Nginx 재시작
docker-compose restart nginx

# 로그 확인
docker-compose logs nginx
```

### 4. 포트 충돌

80번 포트가 이미 사용 중인 경우:

```yaml
# docker-compose.yml 수정
nginx:
  ports:
    - "8080:80"  # 8080 포트로 변경
```

## 성능 최적화

### 1. 이미지 크기 최적화

현재 multi-stage build를 사용하여 최소화되어 있습니다.

### 2. 캐싱 활용

빌드 시간 단축을 위해 레이어 캐싱 활용:

```bash
docker-compose build --parallel
```

### 3. 리소스 제한

필요시 `docker-compose.yml`에 리소스 제한 추가:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## 클라우드 마이그레이션 준비

### AWS ECS/Fargate

```bash
# ECR에 이미지 푸시
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-northeast-2.amazonaws.com

docker tag ai-core-backend:latest <account-id>.dkr.ecr.ap-northeast-2.amazonaws.com/ai-core-backend:latest
docker push <account-id>.dkr.ecr.ap-northeast-2.amazonaws.com/ai-core-backend:latest
```

### Kubernetes

```bash
# Helm 차트 또는 kubectl 매니페스트 작성
kubectl apply -f k8s/
```

## 모니터링

### 로그 수집

```bash
# 모든 로그를 파일로 저장
docker-compose logs > logs/deployment.log

# 실시간 로그 스트리밍
docker-compose logs -f --tail=100
```

### 메트릭 수집

Prometheus + Grafana 추가 고려:

```yaml
# docker-compose.yml에 추가
prometheus:
  image: prom/prometheus
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  ports:
    - "9090:9090"

grafana:
  image: grafana/grafana
  ports:
    - "3001:3000"
```

## 보안 체크리스트

- [x] 환경변수를 통한 민감 정보 관리
- [x] .env 파일 `.gitignore`에 추가
- [x] Non-root 사용자로 컨테이너 실행
- [x] 불필요한 포트 노출 제거 (expose vs ports)
- [ ] HTTPS 인증서 적용 (클라우드 마이그레이션 시)
- [ ] 방화벽 규칙 설정
- [ ] 정기적인 이미지 업데이트 및 취약점 스캔
