import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

// Dev proxy only. In production, nginx forwards /api/feedback directly to backend /feedback.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

    const response = await fetch(`${baseUrl}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const text = await response.text()
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "FEEDBACK_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}
