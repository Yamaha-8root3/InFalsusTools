export type Mode = 'score' | 'breakdown'

export interface ScoreEntry {
  key: string // `${id}:${diff}`
  mode: Mode
  score: number | null
  exactPlus: number | null
  exact: number | null
  near: number | null
  brk: number | null
  cleared: boolean
}

export const FIELDS = [
  {k: 'exactPlus', label: 'Exact+'},
  {k: 'exact', label: 'Exact'},
  {k: 'near', label: 'Near'},
  {k: 'brk', label: 'Break'},
] as const
export type BreakKey = typeof FIELDS[number]['k']

const DB = 'infalsus-rating'
const STORE = 'scores'

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const rq = indexedDB.open(DB, 1)
  rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, {keyPath: 'key'})
  rq.onsuccess = () => res(rq.result)
  rq.onerror = () => rej(rq.error)
})
const dbp = open()

export async function loadScores(): Promise<Map<string, ScoreEntry>> {
  const db = await dbp
  return new Promise((res, rej) => {
    const rq = db.transaction(STORE).objectStore(STORE).getAll()
    rq.onsuccess = () => res(new Map((rq.result as ScoreEntry[])
      .map(e => [e.key, { ...e, cleared: e.cleared ?? false }])))
    rq.onerror = () => rej(rq.error)
  })
}

export async function saveScore(e: ScoreEntry): Promise<void> {
  const db = await dbp
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(e)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export const emptyEntry = (key: string, mode: Mode): ScoreEntry =>
  ({ key, mode, cleared: false, score: null, exactPlus: null, exact: null, near: null, brk: null })


export const sumNotes = (e: ScoreEntry) =>
  (e.exactPlus ?? 0) + (e.exact ?? 0) + (e.near ?? 0) + (e.brk ?? 0)

// Exact+ = 1e8/N+1, Exact = 1e8/N, Near = 1e8/N/2, Break = 0
export function scoreOf(e: ScoreEntry): number | null {
  if (e.mode === 'score') return e.score
  const n = sumNotes(e)
  if (n === 0) return null
  const p = e.exactPlus ?? 0
  return Math.floor((100_000_000 / n) * (p + (e.exact ?? 0) + (e.near ?? 0) / 2) + p)
}

// ACC: Exact+/Exact=100%, Near=50% / X-ACC: Exact+=101%
export function accOf(e: ScoreEntry): { acc: number; xacc: number } | null {
  const n = sumNotes(e)
  if (e.mode !== 'breakdown' || n === 0) return null
  const p = e.exactPlus ?? 0, x = e.exact ?? 0, nr = e.near ?? 0
  return { acc: ((p + x + nr / 2) / n) * 100, xacc: ((1.01 * p + x + nr / 2) / n) * 100 }
}