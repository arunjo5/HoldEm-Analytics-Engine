import { NextResponse } from 'next/server'

export async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<{ data?: any; error?: NextResponse }> {
  // reject on declared size before buffering the whole body
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    return { error: NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
  }
  const raw = await request.text()
  if (raw.length > maxBytes) {
    return { error: NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
  }
  try {
    return { data: raw ? JSON.parse(raw) : {} }
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
}
