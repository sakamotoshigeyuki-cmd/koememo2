import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const rows = await sql`SELECT audio_url FROM memos WHERE id = ${id}`
    const audioUrl = rows[0]?.audio_url

    if (!audioUrl) {
      return NextResponse.json({ error: 'Audio not found' }, { status: 404 })
    }

    const response = await fetch(audioUrl)
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') || 'audio/webm'
    const audioBuffer = await response.arrayBuffer()

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Failed to serve audio:', error)
    return NextResponse.json({ error: 'Audio not found' }, { status: 404 })
  }
}
