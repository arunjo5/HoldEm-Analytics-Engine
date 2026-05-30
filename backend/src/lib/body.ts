import { NextResponse } from 'next/server'

// Read + JSON-parse a body, rejecting anything over maxBytes (413).
export async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<{ data?: any; error?: NextResponse }> {
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
