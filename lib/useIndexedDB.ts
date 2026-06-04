import { useEffect, useState } from 'react'

const DB_NAME = 'koememo2'
const DB_VERSION = 1
const STORE_NAME = 'memos'

interface StoredMemo {
  id: string
  date: string
  time: string
  text: string
  audioBlob: Blob
  synced: boolean
  createdAt: number
}

let db: IDBDatabase

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

export const useIndexedDB = () => {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    initDB()
      .then((database) => {
        db = database
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Failed to initialize IndexedDB:', error)
        setIsReady(false)
      })
  }, [])

  const saveMemo = async (memo: StoredMemo): Promise<boolean> => {
    if (!db) return false

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(memo)

      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  }

  const getMemos = async (): Promise<StoredMemo[]> => {
    if (!db) return []

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const memos = request.result as StoredMemo[]
        resolve(memos.sort((a, b) => b.createdAt - a.createdAt))
      }
      request.onerror = () => resolve([])
    })
  }

  const deleteMemo = async (id: string): Promise<boolean> => {
    if (!db) return false

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  }

  const getUnsyncedMemos = async (): Promise<StoredMemo[]> => {
    if (!db) return []

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const memos = request.result as StoredMemo[]
        resolve(memos.filter((m) => !m.synced))
      }
      request.onerror = () => resolve([])
    })
  }

  const markAsSynced = async (id: string): Promise<boolean> => {
    if (!db) return false

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const getRequest = store.get(id)

      getRequest.onsuccess = () => {
        const memo = getRequest.result as StoredMemo
        if (memo) {
          memo.synced = true
          const updateRequest = store.put(memo)
          updateRequest.onsuccess = () => resolve(true)
          updateRequest.onerror = () => resolve(false)
        }
      }
      getRequest.onerror = () => resolve(false)
    })
  }

  return {
    isReady,
    saveMemo,
    getMemos,
    deleteMemo,
    getUnsyncedMemos,
    markAsSynced,
  }
}
