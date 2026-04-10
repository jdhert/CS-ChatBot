import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function GET(request: NextRequest) {
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
  const clientSessionId = request.nextUrl.searchParams.get("clientSessionId")
  const userKey = request.nextUrl.searchParams.get("userKey")
  const limit = request.nextUrl.searchParams.get("limit")
  const includeMessages = request.nextUrl.searchParams.get("includeMessages")

  const params = new URLSearchParams()
  if (clientSessionId) params.set("clientSessionId", clientSessionId)
  if (userKey) params.set("userKey", userKey)
  if (limit) params.set("limit", limit)
  if (includeMessages) params.set("includeMessages", includeMessages)

  try {
    const response = await fetch(`${baseUrl}/conversations?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    })

    const text = await response.text()
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    })
  } catch (error) {
    return Response.json(
      {
        rows: [],
        error: "CONVERSATIONS_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      },
      { status: 200 },
    )
  }
}
