import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

  try {
    const response = await fetch(`${baseUrl}/conversations/${encodeURIComponent(sessionId)}/messages`, {
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
        error: "CONVERSATION_MESSAGES_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      },
      { status: 200 },
    )
  }
}
