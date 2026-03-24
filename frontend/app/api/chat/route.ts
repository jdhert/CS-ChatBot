import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

    // Use streaming endpoint
    const response = await fetch(`${baseUrl}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(errorText, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    // Check if backend returned JSON (security blocked, no match, etc.)
    const contentType = response.headers.get("content-type")
    if (contentType?.includes("application/json")) {
      // Pass through JSON response as-is
      return new Response(response.body, {
        headers: {
          "Content-Type": "application/json",
        },
      })
    }

    // Stream the response
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
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
