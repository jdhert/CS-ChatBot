import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
  const userKey = request.nextUrl.searchParams.get("userKey")

  const query = new URLSearchParams()
  if (userKey) {
    query.set("userKey", userKey)
  }

  const suffix = query.toString() ? `?${query.toString()}` : ""

  try {
    const response = await fetch(
      `${baseUrl}/conversations/${encodeURIComponent(sessionId)}${suffix}`,
      {
        method: "DELETE",
        headers: {
          ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}),
        },
        cache: "no-store",
      },
    )

    const text = await response.text()
    const setCookie = response.headers.get("set-cookie")
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        ...(setCookie ? { "Set-Cookie": setCookie } : {}),
      },
    })
  } catch (error) {
    return Response.json(
      {
        error: "CONVERSATION_DELETE_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
  const userKey = request.nextUrl.searchParams.get("userKey")

  const query = new URLSearchParams()
  if (userKey) {
    query.set("userKey", userKey)
  }

  const suffix = query.toString() ? `?${query.toString()}` : ""

  try {
    const body = await request.text()
    const response = await fetch(
      `${baseUrl}/conversations/${encodeURIComponent(sessionId)}${suffix}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
          ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}),
        },
        body,
        cache: "no-store",
      },
    )

    const text = await response.text()
    const setCookie = response.headers.get("set-cookie")
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        ...(setCookie ? { "Set-Cookie": setCookie } : {}),
      },
    })
  } catch (error) {
    return Response.json(
      {
        error: "CONVERSATION_UPDATE_PROXY_FAILED",
        message: error instanceof Error ? error.message : "Unknown proxy error",
      },
      { status: 500 },
    )
  }
}
