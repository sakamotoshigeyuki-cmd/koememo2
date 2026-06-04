import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const MEMOS_DIR = path.join(process.cwd(), '.data/memos')

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const jsonPath = path.join(MEMOS_DIR, `${id}.json`)
    const audioPath = path.join(MEMOS_DIR, `${id}.wav`)

    await fs.unlink(jsonPath).catch(() => {})
    await fs.unlink(audioPath).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete memo:', error)
    return NextResponse.json(
      { error: 'Failed to delete memo' },
      { status: 500 }
    )
  }
}
