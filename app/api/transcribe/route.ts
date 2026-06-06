import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function getVocabPrompt(): Promise<string> {
  try {
    const [vocabRows, correctionRows] = await Promise.all([
      sql`SELECT word FROM vocab_hints ORDER BY created_at DESC LIMIT 30`,
      sql`SELECT correct FROM corrections ORDER BY count DESC LIMIT 20`,
    ])
    const parts = [
      ...vocabRows.map((r) => r.word),
      ...correctionRows.map((r) => r.correct),
    ]
    return [...new Set(parts)].join('、')
  } catch {
    return ''
  }
}

async function getCorrections(): Promise<{ wrong: string; correct: string }[]> {
  try {
    const rows = await sql`SELECT wrong, correct FROM corrections ORDER BY count DESC LIMIT 200`
    return rows as { wrong: string; correct: string }[]
  } catch {
    return []
  }
}

function applyCorrections(text: string, corrections: { wrong: string; correct: string }[]): string {
  let result = text
  for (const { wrong, correct } of corrections) {
    result = result.split(wrong).join(correct)
  }
  return result
}

async function transcribeWithGoogle(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY

  if (!apiKey) {
    console.error('Google Cloud API key not found in environment')
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('GOOGLE')))
    return '[Google Cloud APIキーが設定されていません]'
  }

  const base64Audio = audioBuffer.toString('base64')

  try {
    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            encoding: 'LINEAR16',
            languageCode: 'ja-JP',
            sampleRateHertz: 16000,
            audioChannelCount: 1,
          },
          audio: {
            content: base64Audio,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = await response.json()
      console.error('Google Speech API error:', error)
      return '[Google Cloud APIエラー: ' + (error.error?.message || '不明なエラー') + ']'
    }

    const result = await response.json()
    const transcript = result.results
      ?.map((r: any) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim()

    return transcript || '[音声が認識できませんでした]'
  } catch (error) {
    console.error('Transcription error:', error)
    return '[文字起こしエラー]'
  }
}

async function transcribeWithOpenAI(audioFile: File): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return '[OpenAI APIキーが設定されていません]'
  }

  const prompt = await getVocabPrompt()
  const formData = new FormData()
  formData.append('file', audioFile, audioFile.name || 'audio.webm')
  formData.append('model', 'whisper-1')
  formData.append('language', 'ja')
  if (prompt) formData.append('prompt', prompt)

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      console.error('OpenAI API error:', await response.text())
      return '[OpenAI APIエラー]'
    }

    const result = await response.json()
    return result.text || '[音声が認識できませんでした]'
  } catch (error) {
    console.error('OpenAI transcription error:', error)
    return '[文字起こしエラー]'
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      )
    }

    let text: string

    if (process.env.OPENAI_API_KEY) {
      text = await transcribeWithOpenAI(audioFile)
    } else if (process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY) {
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer())
      text = await transcribeWithGoogle(audioBuffer)
    } else {
      text = '[APIキーが設定されていません。.env.localを確認してください]'
    }

    const corrections = await getCorrections()
    if (corrections.length > 0) {
      text = applyCorrections(text, corrections)
    }

    return NextResponse.json({ text })
  } catch (error) {
    console.error('Failed to transcribe:', error)
    return NextResponse.json(
      { error: 'Transcription failed', text: '[処理エラー]' },
      { status: 500 }
    )
  }
}
