import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { text } = await request.json()
    await sql`UPDATE memos SET text = ${text} WHERE id = ${id}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update memo:', error)
    return NextResponse.json({ error: 'Failed to update memo' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await sql`DELETE FROM memos WHERE id = ${id}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete memo:', error)
    return NextResponse.json({ error: 'Failed to delete memo' }, { status: 500 })
  }
}
