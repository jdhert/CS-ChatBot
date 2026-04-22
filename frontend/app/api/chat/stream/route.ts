import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

// Dev proxy only. In production, nginx forwards /api/chat/stream directly to backend /chat/stream.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

    const response = await fetch(`${baseUrl}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    const setCookie = response.headers.get("set-cookie")

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          ...(setCookie ? { "Set-Cookie": setCookie } : {}),
        },
      })
    }

    const contentType = response.headers.get("content-type")
    if (contentType?.includes("application/json")) {
      return new Response(response.body, {
        headers: {
          "Content-Type": "application/json",
          ...(setCookie ? { "Set-Cookie": setCookie } : {}),
        },
      })
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...(setCookie ? { "Set-Cookie": setCookie } : {}),
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "AI_CORE_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }
}
