import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

    const response = await fetch(`${baseUrl}/retrieval/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const data = await response.json()
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "SEARCH_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
