'use client'

import { useState, useEffect, useRef } from 'react'
import { useIndexedDB } from '@/lib/useIndexedDB'

interface VoiceMemo {
  id: string
  date: string
  time: string
  text: string
  audioUrl: string
}

export default function Home() {
  const db = useIndexedDB()
  const [memos, setMemos] = useState<VoiceMemo[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingSource, setRecordingSource] = useState<string>('スマホ標準レコーダー')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'date' | 'text'>('text')
  const [quickFilter, setQuickFilter] = useState<'today' | 'week' | 'month' | 'all'>('today')
  const [isOnline, setIsOnline] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const localDate = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const localTime = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}`
  }

  useEffect(() => {
    loadMemos()
    const saved = localStorage.getItem('recordingSource')
    if (saved) {
      setRecordingSource(saved)
    }

    const handleOnline = () => {
      setIsOnline(true)
      setTimeout(() => syncPendingMemos(), 500)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)

    syncPendingMemos()
  }, [db.isReady])

  const loadMemos = async () => {
    try {
      if (!navigator.onLine) {
        const localMemos = await db.getMemos()
        setMemos(
          localMemos.map((m) => ({
            id: m.id,
            date: m.date,
            time: m.time,
            text: m.text,
            audioUrl: '',
          }))
        )
        return
      }

      const response = await fetch('/api/memos')
      const data = await response.json()
      setMemos(data)
    } catch (error) {
      console.error('Failed to load memos:', error)
      const localMemos = await db.getMemos()
      setMemos(
        localMemos.map((m) => ({
          id: m.id,
          date: m.date,
          time: m.time,
          text: m.text,
          audioUrl: '',
        }))
      )
    }
  }

  const syncPendingMemos = async () => {
    if (!navigator.onLine || !db.isReady) return

    const unsynced = await db.getUnsyncedMemos()
    for (const memo of unsynced) {
      try {
        const formData = new FormData()
        formData.append('audio', memo.audioBlob)
        formData.append('text', memo.text)

        const response = await fetch('/api/memos', {
          method: 'POST',
          body: formData,
        })

        if (response.ok) {
          await db.markAsSynced(memo.id)
        }
      } catch (error) {
        console.error('Failed to sync memo:', memo.id, error)
      }
    }
    loadMemos()
  }

  const deleteMemo = async (id: string) => {
    if (!confirm('このメモを削除しますか？')) return

    try {
      const response = await fetch(`/api/memos/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadMemos()
      }
    } catch (error) {
      console.error('Failed to delete memo:', error)
    }
  }

  const selectSource = (source: string) => {
    setRecordingSource(source)
    localStorage.setItem('recordingSource', source)
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        await transcribeAndSave(audioBlob)
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch (error) {
      console.error('Failed to start recording:', error)
      alert('マイクへのアクセスが許可されていません')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const transcribeAndSave = async (audioBlob: Blob) => {
    setIsTranscribing(true)

    const now = new Date()
    const date = localDate(now)
    const time = localTime(now)
    const id = `memo_${Date.now()}`

    // 録音停止と同時にDownloadsフォルダに保存
    const ext = audioBlob.type.includes('mp4') ? 'mp4'
              : audioBlob.type.includes('ogg') ? 'ogg'
              : 'webm'
    const url = URL.createObjectURL(audioBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}.${ext}`
    a.click()
    URL.revokeObjectURL(url)

    // 録音停止と同時にDBに保存（文字起こし前）
    if (!navigator.onLine) {
      await db.saveMemo({ id, date, time, text: '[文字起こし中...]', audioBlob, synced: false, createdAt: Date.now() })
      loadMemos()
      setIsTranscribing(false)
      return
    }

    const saveFormData = new FormData()
    saveFormData.append('id', id)
    saveFormData.append('date', date)
    saveFormData.append('time', time)
    saveFormData.append('text', '[文字起こし中...]')
    try {
      const res = await fetch('/api/memos', { method: 'POST', body: saveFormData })
      if (!res.ok) throw new Error('save failed')
    } catch {
      await db.saveMemo({ id, date, time, text: '[文字起こし中...]', audioBlob, synced: false, createdAt: Date.now() })
    }
    loadMemos()

    // 文字起こし → 完了後にテキスト更新
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, `audio.${ext}`)

      const response = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const data = await response.json()
      const text = data.text || '[文字起こしに失敗しました]'

      await fetch(`/api/memos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    } catch (error) {
      console.error('Transcription error:', error)
      await fetch(`/api/memos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '[文字起こしエラー]' }),
      }).catch(() => {})
    } finally {
      setIsTranscribing(false)
      loadMemos()
    }
  }

  const importPixelWatchFiles = async (files: FileList) => {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/') || f.name.endsWith('.m4a'))
    if (audioFiles.length === 0) return

    setImportProgress({ current: 0, total: audioFiles.length })

    for (let i = 0; i < audioFiles.length; i++) {
      setImportProgress({ current: i + 1, total: audioFiles.length })
      const file = audioFiles[i]

      // ファイルの録音日時をIDに使い重複を防ぐ
      const recorded = new Date(file.lastModified)
      const id = `memo_pw_${file.lastModified}`
      const date = localDate(recorded)
      const time = localTime(recorded)

      try {
        const formData = new FormData()
        formData.append('audio', file, file.name)

        const response = await fetch('/api/transcribe', { method: 'POST', body: formData })
        const data = await response.json()
        const text = data.text || '[文字起こしに失敗しました]'

        const saveResponse = await fetch('/api/memos', {
          method: 'POST',
          body: (() => { const fd = new FormData(); fd.append('id', id); fd.append('audio', file); fd.append('text', text); fd.append('date', date); fd.append('time', time); return fd })(),
        })
        if (!saveResponse.ok && saveResponse.status !== 409) {
          console.error('Failed to save:', file.name)
        }
      } catch (error) {
        console.error('Failed to import file:', file.name, error)
      }
    }

    setImportProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    loadMemos()
  }

  const startEditing = (memo: VoiceMemo) => {
    setEditingId(memo.id)
    setEditText(memo.text)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditText('')
  }

  const extractNewWords = (oldText: string, newText: string): string[] => {
    const oldWords = new Set(oldText.split(/[\s、。！？,.!?\n]+/).filter((w) => w.length >= 2))
    const newWords = newText.split(/[\s、。！？,.!?\n]+/).filter((w) => w.length >= 2)
    return [...new Set(newWords.filter((w) => !oldWords.has(w)))]
  }

  const saveMemoText = async (id: string) => {
    try {
      const oldText = memos.find((m) => m.id === id)?.text || ''
      const response = await fetch(`/api/memos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      })
      if (response.ok) {
        const newWords = extractNewWords(oldText, editText)
        if (newWords.length > 0) {
          fetch('/api/vocab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: newWords }),
          })
        }
        setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, text: editText } : m)))
        cancelEditing()
      }
    } catch (error) {
      console.error('Failed to update memo:', error)
    }
  }

  const exportToCSV = () => {
    const rows = filterMemos().map((m) => [
      m.date,
      m.time,
      `"${m.text.replace(/"/g, '""')}"`,
    ])
    const csv = [['日付', '時刻', 'テキスト'], ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `koememo_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filterMemos = () => {
    const today = localDate(new Date())
    const weekAgo = localDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))
    const monthPrefix = today.slice(0, 7)

    if (!searchQuery) {
      switch (quickFilter) {
        case 'today': return memos.filter(m => m.date === today)
        case 'week':  return memos.filter(m => m.date >= weekAgo)
        case 'month': return memos.filter(m => m.date.startsWith(monthPrefix))
        case 'all':   return memos
      }
    }

    if (searchType === 'date') {
      if (searchQuery.includes('~')) {
        const [from, to] = searchQuery.split('~').map(s => s.trim())
        return memos.filter(m => m.date >= from && m.date <= to)
      }
      return memos.filter(m => m.date.includes(searchQuery))
    }

    const terms = searchQuery.trim().split(/\s+/).filter(Boolean)
    return memos.filter(m => terms.every(term => m.text.includes(term)))
  }

  const filteredMemos = filterMemos()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">koememo2</h1>
            <div className="flex gap-3 items-center">
              {!isOnline && (
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                  オフラインモード
                </span>
              )}
              <select
                value={recordingSource}
                onChange={(e) => selectSource(e.target.value)}
                className="text-xl border-none bg-transparent cursor-pointer focus:outline-none"
              >
                <option value="スマホ標準レコーダー">🎙️</option>
                <option value="Pixel Watch">⌚</option>
              </select>
            </div>
          </div>

          {/* Recording / Import UI */}
          {recordingSource === 'Pixel Watch' ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is not in standard types
                webkitdirectory=""
                className="hidden"
                onChange={(e) => e.target.files && importPixelWatchFiles(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!!importProgress}
                className={`w-full py-4 px-6 rounded-lg font-bold text-white text-lg transition ${
                  importProgress ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {importProgress
                  ? `⏳ 処理中... ${importProgress.current} / ${importProgress.total}`
                  : '📂 録音ファイルを選択（複数可）'}
              </button>
              {importProgress && (
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                className={`w-full py-4 px-6 rounded-lg font-bold text-white text-lg transition ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                    : isTranscribing
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {isTranscribing
                  ? '⏳ 文字起こし中...'
                  : isRecording
                    ? '● 録音中...をタップして終了'
                    : '🎙️ 録音を開始'}
              </button>
              {isTranscribing && (
                <p className="text-sm text-gray-500 text-center mt-3">
                  音声を再生して文字起こしを処理しています...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Search Section */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          {/* クイックフィルター */}
          {!searchQuery && (
            <div className="flex gap-1 mb-3">
              {(['today', 'week', 'month', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setQuickFilter(f)}
                  className={`flex-1 py-1 text-sm rounded transition ${
                    quickFilter === f
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'today' ? '今日' : f === 'week' ? '今週' : f === 'month' ? '今月' : 'すべて'}
                </button>
              ))}
            </div>
          )}
          {/* 検索 */}
          <div className="flex gap-2 mb-2">
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value as any)}
              className="px-2 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="text">全文</option>
              <option value="date">日付</option>
            </select>
            <input
              type="text"
              placeholder={
                searchType === 'date'
                  ? '2026-06 または 2026-06-01~2026-06-30'
                  : 'スペース区切りでAND検索'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="px-3 py-2 text-gray-600 hover:text-gray-900">✕</button>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={exportToCSV}
              disabled={filteredMemos.length === 0}
              className="text-xs px-3 py-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded transition"
            >
              CSV出力 ({filteredMemos.length}件)
            </button>
          </div>
        </div>

        {/* Memos List */}
        <div className="space-y-3">
          {filteredMemos.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
              {memos.length === 0
                ? '音声メモはまだありません。録音を開始してください。'
                : '検索結果がありません。'}
            </div>
          ) : (
            filteredMemos.map((memo) => (
              <div
                key={memo.id}
                className="bg-white rounded-lg shadow-sm p-4 hover:shadow-md transition"
              >
                <p className="text-sm font-semibold text-gray-600 mb-1">
                  {memo.date} {memo.time}
                </p>
                {editingId === memo.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full border border-blue-400 rounded-lg p-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={4}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2 justify-end">
                      <button
                        onClick={cancelEditing}
                        className="text-xs px-3 py-1 text-gray-600 hover:text-gray-900 border border-gray-300 rounded transition"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => saveMemoText(memo.id)}
                        className="text-xs px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded transition"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-3">
                    <p
                      className="text-gray-800 flex-1 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
                      onClick={() => startEditing(memo)}
                    >
                      {memo.text}
                    </p>
                    <div className="flex gap-1 flex-shrink-0">
                      {memo.audioUrl && (
                        <audio controls src={`/api/audio/${memo.id}`} className="h-7 w-28" />
                      )}
                      <button
                        onClick={() => startEditing(memo)}
                        className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteMemo(memo.id)}
                        className="text-xs px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
