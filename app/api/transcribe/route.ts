import { NextRequest, NextResponse } from 'next/server'

async function transcribeWithGoogle(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY

  if (!apiKey) {
    console.error('Google Cloud API key not found in environment')
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

async function transcribeWithOpenAI(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return '[OpenAI APIキーが設定されていません]'
  }

  const formData = new FormData()
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' })
  formData.append('file', audioBlob, 'audio.wav')
  formData.append('model', 'whisper-1')

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

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer())

    let text: string

    if (process.env.NEXT_PUBLIC_GOOGLE_API_KEY) {
      text = await transcribeWithGoogle(audioBuffer)
    } else if (process.env.OPENAI_API_KEY) {
      text = await transcribeWithOpenAI(audioBuffer)
    } else {
      text = '[APIキーが設定されていません。.env.localを確認してください]'
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
