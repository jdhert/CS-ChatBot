import { type NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

interface RouteParams {
  params: Promise<{
    documentId: string
    chunkId: string
  }>
}

// Dev proxy only. In production, nginx forwards /api/manual/previews/* directly to backend /manual/previews/*.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { documentId, chunkId } = await params
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
    const response = await fetch(
      `${baseUrl}/manual/previews/${encodeURIComponent(documentId)}/${encodeURIComponent(chunkId)}`,
      { cache: "no-store" },
    )

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
      })
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": response.headers.get("cache-control") ?? "private, max-age=300",
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "MANUAL_PREVIEW_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }
}
