import { type NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

interface RouteParams {
  params: Promise<{
    documentId: string
  }>
}

// Dev proxy only. In production, nginx forwards /api/manual/documents/* directly to backend /manual/documents/*.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { documentId } = await params
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
    const response = await fetch(`${baseUrl}/manual/documents/${encodeURIComponent(documentId)}`, {
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
      })
    }

    const headers = new Headers()
    const contentType = response.headers.get("content-type")
    const contentDisposition = response.headers.get("content-disposition")
    if (contentType) headers.set("Content-Type", contentType)
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition)

    return new Response(response.body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "MANUAL_DOCUMENT_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }
}
