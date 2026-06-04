import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const MEMOS_DIR = path.join(process.cwd(), '.data/memos')

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const audioPath = path.join(MEMOS_DIR, `${id}.wav`)

    const audioBuffer = await fs.readFile(audioPath)

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `inline; filename="${id}.wav"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Failed to serve audio:', error)
    return NextResponse.json(
      { error: 'Audio file not found' },
      { status: 404 }
    )
  }
}
