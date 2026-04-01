import { type NextRequest, NextResponse } from "next/server"

const BACKEND_BASE = process.env.BACKEND_INTERNAL_URL ?? "http://backend:3101"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const params = new URLSearchParams()
  for (const [k, v] of searchParams.entries()) params.set(k, v)

  try {
    const res = await fetch(`${BACKEND_BASE}/admin/logs?${params.toString()}`, {
      cache: "no-store",
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "백엔드에 연결할 수 없습니다." }, { status: 502 })
  }
}
