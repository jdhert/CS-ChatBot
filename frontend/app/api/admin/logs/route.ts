import { type NextRequest, NextResponse } from "next/server"

const DEFAULT_AI_CORE_URL = "http://127.0.0.1:3101"

// Dev proxy only. In production, nginx forwards /api/admin/logs directly to backend /admin/logs.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const params = new URLSearchParams()
  for (const [k, v] of searchParams.entries()) params.set(k, v)

  try {
    const baseUrl = process.env.AI_CORE_BASE_URL ?? DEFAULT_AI_CORE_URL
    const res = await fetch(`${baseUrl}/admin/logs?${params.toString()}`, {
      cache: "no-store",
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "백엔드에 연결할 수 없습니다." }, { status: 502 })
  }
}
