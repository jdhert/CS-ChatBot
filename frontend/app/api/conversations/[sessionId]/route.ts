import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

  try {
    const res = await fetch(`${baseUrl}/conversations/${sessionId}`, {
      method: "DELETE",
    })
    return new Response(null, { status: res.ok ? 204 : res.status })
  } catch {
    return new Response(null, { status: 500 })
  }
}
