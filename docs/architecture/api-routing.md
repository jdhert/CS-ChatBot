# 운영 API 라우팅 규칙

## 기준 구조

현재 운영 환경은 `Docker Compose + Nginx` 구조이며, 브라우저의 `/api/*` 요청은 Next.js가 아니라 `backend` 컨테이너로 직접 전달됩니다.

핵심 설정:

```nginx
location /api/ {
    proxy_pass http://backend/;
}
```

즉 브라우저 기준 경로와 실제 백엔드 경로의 관계는 다음과 같습니다.

| 브라우저 호출 경로 | Nginx 전달 경로 | 실제 백엔드 엔드포인트 |
| --- | --- | --- |
| `/api/chat/stream` | `/chat/stream` | `POST /chat/stream` |
| `/api/retrieval/search` | `/retrieval/search` | `POST /retrieval/search` |
| `/api/admin/logs` | `/admin/logs` | `GET /admin/logs` |
| `/api/feedback` | `/feedback` | `POST /feedback` |
| `/api/conversations` | `/conversations` | `GET /conversations` |
| `/api/conversations/:sessionId` | `/conversations/:sessionId` | `DELETE /conversations/:sessionId` |
| `/api/conversations/:sessionId/messages` | `/conversations/:sessionId/messages` | `GET /conversations/:sessionId/messages` |
| `/health` | `/health` | `GET /health` |

## 운영 기준 프론트 호출 규칙

프론트 코드는 반드시 **운영 nginx가 직접 백엔드로 넘겨도 문제가 없는 경로**를 사용해야 합니다.

### 사용해야 하는 경로

- `/api/chat/stream`
- `/api/retrieval/search`
- `/api/admin/logs`
- `/api/feedback`
- `/api/conversations`
- `/api/conversations/:sessionId`
- `/api/conversations/:sessionId/messages`

### 사용하면 안 되는 경로

아래 경로는 로컬 Next 프록시 관점에서는 그럴듯해 보여도, 현재 운영 구조에서는 잘못 연결되거나 의미가 달라집니다.

- `/api/chat`
  - 운영에서는 backend `/chat`로 직접 전달됨
  - 프론트가 SSE를 기대하면 응답 계약이 깨질 수 있음
- `/api/logs`
  - 운영에서는 backend `/logs`로 전달되지만, 실제 백엔드 경로는 `/admin/logs`
- `/api/search`
  - 현재 운영 검색 디버그 엔드포인트는 `/retrieval/search` 기준

## `frontend/app/api/*`의 역할

`frontend/app/api/*` 경로는 **로컬 dev 환경에서만 보조 프록시**로 유지합니다.

운영 환경에서는 Nginx가 먼저 `/api/*`를 가로채서 backend로 보내기 때문에, Next route handler는 사실상 우회됩니다.

따라서 `frontend/app/api/*`를 만들 때도 다음 원칙을 지켜야 합니다.

1. 브라우저 경로와 운영 백엔드 경로의 계약을 그대로 유지한다.
2. 운영에서 우회되더라도 동일한 의미를 갖는 경로만 둔다.
3. 운영 라우팅과 다른 별도 추상 경로(`/api/chat`, `/api/logs`, `/api/search`)는 만들지 않는다.

## 회귀 방지 체크리스트

프론트에서 API 경로를 수정할 때는 아래를 같이 확인합니다.

1. `nginx/nginx.conf` 기준으로 `/api/*`가 어디로 라우팅되는지 확인
2. 브라우저 호출 경로가 운영에서 backend 실제 엔드포인트와 1:1로 대응되는지 확인
3. 로컬 Next dev 프록시가 있더라도 운영에서 우회될 수 있음을 전제로 검토
4. 스트리밍 응답인지 JSON 응답인지 계약이 바뀌지 않는지 확인

## 권장 아키텍처 방향

현재 운영 기준에서는 아래 원칙을 유지합니다.

- 운영 표준: **Nginx가 `/api/*`를 backend로 직접 전달**
- 프론트 표준: **운영 호환 경로만 호출**
- Next `app/api/*`: **로컬 개발 편의용 보조 프록시만 유지**

이 규칙을 벗어나는 API 경로 변경은 운영 회귀 위험이 높습니다.
