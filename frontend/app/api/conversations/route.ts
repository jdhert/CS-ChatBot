import { NextRequest } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userKey = searchParams.get("userKey") ?? ""
  const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL

  try {
    const res = await fetch(
      `${baseUrl}/conversations?userKey=${encodeURIComponent(userKey)}&limit=50`,
      { cache: "no-store" }
    )
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ rows: [] }, { status: 200 })
  }
}
