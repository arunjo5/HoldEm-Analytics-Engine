import { NextResponse } from 'next/server'

// Read a request body as JSON, rejecting anything larger than `maxBytes`.
// Returns { data } on success, or { error } with a ready-to-return response.
// Guards against storage-exhaustion abuse: a legit save is a few KB, so the
// caps here are generous for real use but kill multi-MB junk payloads.
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
