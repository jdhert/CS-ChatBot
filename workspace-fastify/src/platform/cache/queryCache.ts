/**
 * 인메모리 쿼리 캐시 (Map + TTL)
 *
 * - 동일한 query + scope 조합의 검색 결과를 캐싱
 * - SSE 스트리밍 응답을 위해 전체 텍스트와 메타데이터를 저장
 * - TTL 만료 후 자동 삭제
 */

export interface CachedStreamResult {
  metadata: Record<string, unknown>;
  fullText: string;
  cachedAt: number;
}

interface CacheEntry {
  value: CachedStreamResult;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30분
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry>();

function makeCacheKey(query: string, scope: string): string {
  // 쿼리 정규화: 소문자, 연속 공백 제거
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  return `${scope}::${normalized}`;
}

export function getCachedResult(query: string, scope: string): CachedStreamResult | null {
  const key = makeCacheKey(query, scope);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedResult(
  query: string,
  scope: string,
  value: CachedStreamResult,
  ttlMs = DEFAULT_TTL_MS
): void {
  // 최대 엔트리 초과 시 가장 오래된 항목 제거
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }

  const key = makeCacheKey(query, scope);
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/** 만료된 캐시 항목 정리 (주기적으로 호출) */
export function evictExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}

export function getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: store.size, maxEntries: MAX_ENTRIES, ttlMs: DEFAULT_TTL_MS };
}
