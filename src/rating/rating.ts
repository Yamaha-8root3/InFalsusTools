import songsCsv from '../data/songs.csv?raw'
import levelsCsv from '../data/defaultLevels.csv?raw'
import constCsv from '../data/customChartConstant.csv?raw'

import { FIELDS, accOf, emptyEntry, loadScores, saveScore, scoreOf, sumNotes } from './scores.ts'
import type { BreakKey, Mode, ScoreEntry } from './scores.ts'
import { overall, potential } from './calc.ts'

const DIFFS = ['MIN', 'EVO', 'ULT', 'FBD'] as const
type Diff = typeof DIFFS[number]

type ColKey = 'title' | 'artist' | 'chapter' | 'diff' | 'level' | 'score' | 'rate'
type Dir = 'ascending' | 'descending'

// 列定義: 列追加はここに1行足す
interface Col {
  key: ColKey;
  label: string;
  num?: boolean;
  text: (r: Row) => string;
  node?: (r: Row) => Node;
  sub?: { key: ColKey; label: string };
  cls?: string;
}

const COLS: Col[] = [
  {
    key: 'title', label: 'Title', sub: {key: 'artist', label: 'Artist'}, text: r => r.title, node: r => {
      const wrap = document.createElement('div')
      const main = document.createElement('div')
      main.textContent = r.title
      const sub = document.createElement('div')
      sub.className = 'sub'
      sub.textContent = r.artist
      wrap.append(main, sub)
      return wrap
    }
  },
  {key: 'chapter', label: 'Chapter', cls: 'col-chapter', text: r => r.chapter},
  {key: 'diff', label: 'Diff', cls: 'tight', text: r => r.diff},
  {key: 'level', label: 'Lv', cls: 'tight', text: r => r.level?.toString() ?? '?'},
  {key: 'score', label: 'Best Score', num: true, text: r => r.score?.toLocaleString() ?? '–'},
  {key: 'rate', label: 'Rating', num: true, text: r => r.rate?.toFixed(2) ?? '–'},
]

interface Row {
  id: number
  title: string
  artist: string
  chapter: string
  diff: Diff
  level: number | null     // "?" -> null
  constant: number | null  // customChartConstant（現状すべて空）
  score: number | null     // IndexedDB 結合予定
  rate: number | null      // レート計算実装後
}


// --- CSV ---
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++
        } else q = false
      } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell);
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell);
      cell = '';
      rows.push(row);
      row = []
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row)
  }
  const [head, ...body] = rows
  return body
    .filter(r => r.length > 1 || r[0])
    .map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])))
}

const toNum = (v: string): number | null => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const key = (title: string, artist: string) => `${title}\t${artist}`

// 3CSVを Title+Artist で結合し、曲×難易度の行にする（空欄=譜面なし）
function buildRows(): Row[] {
  const levels = new Map(parseCsv(levelsCsv).map(r => [key(r.Title, r.Artist), r]))
  const consts = new Map(parseCsv(constCsv).map(r => [key(r.Title, r.Artist), r]))
  const out: Row[] = []
  for (const s of parseCsv(songsCsv)) {
    const k = key(s.Title, s.Artist)
    const lv = levels.get(k)
    if (!lv) {
      console.warn('no level:', s.Title);
      continue
    }
    const cc = consts.get(k)
    for (const d of DIFFS) {
      if ((lv[d] ?? '') === '') continue
      out.push({
        id: Number(s.id), title: s.Title, artist: s.Artist, chapter: s.Chapter,
        diff: d, level: toNum(lv[d]), constant: toNum(cc?.[d] ?? ''),
        score: null, rate: null,
      })
    }
  }
  return out
}

// --- state ---
const scores = new Map<string, ScoreEntry>()
let inputMode: Mode = 'score'
let shown: Row[] = []
const rowKey = (r: Row) => `${r.id}:${r.diff}`


const ONE_PER_SONG = false

const syncScore = (r: Row) => {
  const e = scores.get(rowKey(r))
  r.score = e ? scoreOf(e) : null
  r.rate = potential(r.score, r.constant ?? r.level, e?.cleared ?? false)
}


function toggle(r: Row) {
  state.expanded = state.expanded === rowKey(r) ? null : rowKey(r)
  render()
  if (state.expanded) focusDetail()
}

function focusDetail() {
  const el = tbody.querySelector<HTMLInputElement>('tr.detail .panel:not([hidden]) input')
  el?.focus()
  el?.select()
  el?.closest('tr')?.scrollIntoView({ block: 'nearest' })
}

function goNext(r: Row): boolean {
  const next = shown[shown.findIndex(x => rowKey(x) === rowKey(r)) + 1]
  if (!next) return false
  state.expanded = rowKey(next)
  render()
  focusDetail()
  return true
}

function field(f: 'score' | BreakKey, label: string, v: number | null): HTMLLabelElement {
  const lab = document.createElement('label')
  lab.className = 'fld'
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '0'
  input.step = '1'
  input.inputMode = 'numeric'
  input.dataset.f = f
  input.value = v === null ? '' : String(v)
  lab.append(label, input)
  return lab
}

// settings

const SETTINGS_KEY = 'rating.settings'
interface Saved { diffs?: string[]; chapters?: string[]; hidden?: string[] }

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
    const old = localStorage.getItem('rating.hiddenCols') // 旧キーからの移行
    return old ? { hidden: JSON.parse(old) } : null
  } catch { return null }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      diffs: [...state.diffs], chapters: [...state.chapters], hidden: [...hidden],
    }))
  } catch { /* ignore */ }
}

const DEFAULTS = {
  diffs: ["ULT", "FBD"] as Diff[],        // 例: ['ULT', 'FBD']（空 = 全難易度）
  chapters: ["InFalsus","Arc 1.0","Arc 2.0","Arc 2.5"] as string[],   // 例: ['Arc 4.0']（空 = 全Chapter）
  hidden: [] as ColKey[],     // 例: ['chapter']（非表示にする列）
  min: null as number | null, // null = 下限なし
  max: null as number | null,
  sort: null as { key: ColKey; dir: Dir } | null, // 例: { key: 'level', dir: 'descending' }
}

const all = buildRows()
const chapters = [...new Set(all.map(r => r.chapter))] // 出現順
const saved = loadSaved()
const isNew = saved === null
const init: Saved = saved ?? { diffs: DEFAULTS.diffs, chapters: DEFAULTS.chapters, hidden: DEFAULTS.hidden }
const hidden = new Set<ColKey>(COLS.map(c => c.key).filter(k => init.hidden?.includes(k)))
const state = {
  q: '',
  diffs: new Set<Diff>(DIFFS.filter(d => init.diffs?.includes(d))),
  chapters: new Set<string>(chapters.filter(c => init.chapters?.includes(c))),
  min: isNew ? DEFAULTS.min : null,
  max: isNew ? DEFAULTS.max : null,
  sort: isNew ? DEFAULTS.sort : null,
  expanded: null as string | null,
}

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!
const qInput = $<HTMLInputElement>('#q')
const minInput = $<HTMLInputElement>('#lv-min')
const maxInput = $<HTMLInputElement>('#lv-max')
const headRow = $<HTMLTableRowElement>('#head')
const tbody = $<HTMLTableSectionElement>('#songs tbody')
const countEl = $<HTMLElement>('#count')
const emptyEl = $<HTMLElement>('#empty')
const sortKey = $<HTMLSelectElement>('#sort-key')
const sortDir = $<HTMLButtonElement>('#sort-dir')
const chapterMenu = $<HTMLDetailsElement>('#chapter-menu')

const norm = (s: string) => s.normalize('NFKC').toLowerCase()
const visible = () => COLS.filter(c => !hidden.has(c.key))

// フィルタ→ソート（ソートなし時は CSV の曲順）
function view(): Row[] {
  const q = norm(state.q)
  const rs = all.filter(r =>
    (!q || norm(`${r.title} ${r.artist}`).includes(q)) &&
    (state.diffs.size === 0 || state.diffs.has(r.diff)) &&
    (state.chapters.size === 0 || state.chapters.has(r.chapter)) &&
    (state.min === null || (r.level !== null && r.level >= state.min)) &&
    (state.max === null || (r.level !== null && r.level <= state.max)))
  const s = state.sort
  if (!s) return rs
  const dir = s.dir === 'ascending' ? 1 : -1
  return rs.sort((a, b) => {
    if (s.key === 'level' || s.key === 'score' || s.key === 'rate') {
      const x = a[s.key], y = b[s.key]
      if (x === y) return 0
      if (x === null) return 1 // null は常に末尾
      if (y === null) return -1
      return (x - y) * dir
    }
    let c = 0
    switch (s.key) {
      case 'diff':
        c = DIFFS.indexOf(a.diff) - DIFFS.indexOf(b.diff);
        break
      case 'chapter':
        c = chapters.indexOf(a.chapter) - chapters.indexOf(b.chapter);
        break
      case 'title':
        c = a.title.localeCompare(b.title, 'ja');
        break
      case 'artist':
        c = a.artist.localeCompare(b.artist, 'ja');
        break
    }
    return c * dir
  })
}

// none -> ascending -> descending -> none
function cycleSort(k: ColKey) {
  const cur = state.sort
  if (!cur || cur.key !== k) state.sort = {key: k, dir: 'ascending'}
  else if (cur.dir === 'ascending') state.sort = {key: k, dir: 'descending'}
  else state.sort = null
  render()
}

function sortBtn(key: ColKey, label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.dataset.key = key
  b.textContent = label
  b.addEventListener('click', () => cycleSort(key))
  return b
}

function renderHead() {
  headRow.replaceChildren(...visible().map(c => {
    const th = document.createElement('th')
    th.className = [c.num ? 'num' : '', c.cls ?? ''].join(' ').trim()
    th.append(sortBtn(c.key, c.label))
    if (c.sub) th.append(' / ', sortBtn(c.sub.key, c.sub.label))
    return th
  }))
}


function rowEl(r: Row, cols: Col[]): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.dataset.k = rowKey(r)
  tr.tabIndex = 0
  tr.setAttribute('aria-expanded', String(state.expanded === rowKey(r)))
  tr.addEventListener('click', () => toggle(r))
  tr.addEventListener('keydown', e => {
    if (e.key === 'Enter') toggle(r)
  })
  for (const c of cols) {
    const td = document.createElement('td')
    td.dataset.label = c.label
    td.className = [c.num ? 'num' : '', c.key === 'title' ? 'title' : '', c.cls ?? ''].join(' ').trim()
    if (c.key === 'diff') {
      const span = document.createElement('span')
      span.className = 'diff'
      span.dataset.d = r.diff
      span.textContent = r.diff
      td.append(span)
    } else if (c.node) td.append(c.node(r))
    else td.textContent = c.text(r)
    if (c.key === 'rate') mark(td, rankMap.get(rowKey(r)))
    tr.append(td)
  }
  return tr
}

function detailEl(r: Row, span: number): HTMLTableRowElement {
  const k = rowKey(r)
  const entry = scores.get(k) ?? emptyEntry(k, inputMode)
  const tr = document.createElement('tr')
  tr.className = 'detail'
  const td = document.createElement('td')
  td.colSpan = span
  const form = document.createElement('div')
  form.className = 'score-form'

  const seg = document.createElement('div')
  seg.className = 'seg'
  for (const m of ['score', 'breakdown'] as const) {
    const lab = document.createElement('label')
    const rd = document.createElement('input')
    rd.type = 'radio'
    rd.name = `mode-${k}`
    rd.value = m
    rd.checked = entry.mode === m
    lab.append(rd, m === 'score' ? 'Score' : 'Breakdown')
    seg.append(lab)
  }

  // クリア/未クリア
  const clr = document.createElement('label')
  clr.className = 'chip'
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.dataset.c = '1'
  cb.checked = entry.cleared
  const cs = document.createElement('span')
  cs.textContent = 'Clear'
  clr.append(cb, cs)

  const pScore = document.createElement('div')
  pScore.className = 'panel'
  pScore.append(field('score', 'Score', entry.score))
  const pBreak = document.createElement('div')
  pBreak.className = 'panel'
  pBreak.append(...FIELDS.map(f => field(f.k, f.label, entry[f.k])))
  const out = document.createElement('div')
  out.className = 'calc'

  const show = () => {
    pScore.hidden = entry.mode !== 'score'
    pBreak.hidden = entry.mode !== 'breakdown'
    const s = scoreOf(entry)
    const a = accOf(entry)
    const p = potential(s, r.constant ?? r.level, entry.cleared)
    const items = entry.mode === 'breakdown'
      ? [`Notes ${sumNotes(entry)}`, `Score ${s?.toLocaleString() ?? '–'}`,
        `ACC ${a ? a.acc.toFixed(2) + '%' : '–'}`, `X-ACC ${a ? a.xacc.toFixed(2) + '%' : '–'}`]
      : []
    const cc = r.constant ?? r.level
    const why = cc === null ? ' (Lv ?)' : ''
    items.push(`Potential ${p?.toFixed(3) ?? '–'}${why}`)
    out.replaceChildren(...items.map(t => {
      const sp = document.createElement('span')
      sp.textContent = t
      return sp
    }))
  }

  const read = () => {
    for (const i of form.querySelectorAll<HTMLInputElement>('input[data-f]')) {
      const n = i.valueAsNumber
      entry[i.dataset.f as 'score' | BreakKey] = Number.isNaN(n) ? null : Math.max(0, Math.floor(n))
    }
  }

  // 保存。一覧のセルは直接更新（再描画するとフォーカスが外れるため）
  const commit = () => {
    read()
    scores.set(k, entry)
    syncScore(r)
    saveScore(entry).catch(e => console.warn('save failed', e))
    const prev = tr.previousElementSibling
    const setCell = (label: string, text: string) => {
      const c = prev?.querySelector(`td[data-label="${label}"]`)
      if (c) c.textContent = text
    }
    setCell('Best Score', r.score?.toLocaleString() ?? '–')
    setCell('Rating', r.rate?.toFixed(2) ?? '–')
    updateOverall()
    show()
  }

  form.addEventListener('input', () => { read(); show() }) // 入力中は表示のみ更新
  form.addEventListener('change', e => {
    const t = e.target as HTMLInputElement
    if (t.type === 'radio') { entry.mode = t.value as Mode; inputMode = entry.mode }
    else if (t.type === 'checkbox') entry.cleared = t.checked
    commit()
  })

  form.addEventListener('keydown', e => {
    const t = e.target
    if (!(t instanceof HTMLInputElement) || t.type !== 'number') return
    if (e.key === 'Escape') { commit(); state.expanded = null; render(); return }
    const inputs = [...form.querySelectorAll<HTMLInputElement>('.panel:not([hidden]) input')]
    const i = inputs.indexOf(t)
    const last = i === inputs.length - 1
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!last) inputs[i + 1].focus()
      else { commit(); goNext(r) }
    } else if (e.key === 'Tab' && !e.shiftKey && last) {
      commit()
      if (goNext(r)) e.preventDefault()
    }
  })

  show()
  form.append(seg, clr, pScore, pBreak, out)
  td.append(form)
  tr.append(td)
  return tr
}
function syncSort() {
  const s = state.sort
  for (const b of headRow.querySelectorAll<HTMLElement>('button[data-key]'))
    b.dataset.sort = s && s.key === b.dataset.key ? s.dir : 'none'
  for (const th of headRow.querySelectorAll<HTMLElement>('th'))
    th.setAttribute('aria-sort', s && th.querySelector(`[data-key="${s.key}"]`) ? s.dir : 'none')
  sortKey.value = s?.key ?? ''
  sortDir.textContent = s?.dir === 'descending' ? '▼' : '▲'
}

const lvs = all.flatMap(r => (r.level === null ? [] : [r.level]))
const LV_MIN = Math.floor(Math.min(...lvs))
const LV_MAX = Math.ceil(Math.max(...lvs))
const LV_STEP = lvs.every(Number.isInteger) ? 1 : 0.1
const minR = $<HTMLInputElement>('#lv-min-r')
const maxR = $<HTMLInputElement>('#lv-max-r')
const dual = $<HTMLElement>('#lv-dual')

for (const el of [minInput, maxInput, minR, maxR]) {
  el.min = String(LV_MIN);
  el.max = String(LV_MAX);
  el.step = String(LV_STEP)
}

// 4つの入力と state を同期。両端が下限/上限のときはフィルタなし（? のレベルも表示）
function applyLevel(lo: number, hi: number, from: 'lo' | 'hi') {
  lo = Math.min(Math.max(Number.isNaN(lo) ? LV_MIN : lo, LV_MIN), LV_MAX)
  hi = Math.min(Math.max(Number.isNaN(hi) ? LV_MAX : hi, LV_MIN), LV_MAX)
  if (lo > hi) {
    if (from === 'lo') lo = hi; else hi = lo
  }
  minInput.value = minR.value = String(lo)
  maxInput.value = maxR.value = String(hi)
  const pct = (v: number) => `${((v - LV_MIN) / (LV_MAX - LV_MIN)) * 100}%`
  dual.style.setProperty('--lo', pct(lo))
  dual.style.setProperty('--hi', pct(hi))
  const minOnTop = lo >= (LV_MIN + LV_MAX) / 2
  minR.style.zIndex = minOnTop ? '3' : '2'
  maxR.style.zIndex = minOnTop ? '2' : '3'
  state.min = lo <= LV_MIN ? null : lo
  state.max = hi >= LV_MAX ? null : hi
}

const rankMap = new Map<string, 'top' | 'in'>() // 'top' = ×2 の対象、'in' = 枠内（11〜30位）

const mark = (td: Element | null, v?: 'top' | 'in') => {
  td?.classList.toggle('rate-top', v === 'top')
  td?.classList.toggle('rate-in', v === 'in')
}

function paintRank() {
  for (const tr of tbody.querySelectorAll<HTMLTableRowElement>('tr[data-k]'))
    mark(tr.querySelector('td[data-label="Rating"]'), rankMap.get(tr.dataset.k!))
}

function updateOverall() {
  const best = new Map<string, { k: string; rate: number }>()
  for (const r of all) {
    if (r.rate === null) continue
    const g = ONE_PER_SONG ? String(r.id) : rowKey(r)
    const cur = best.get(g)
    if (!cur || r.rate > cur.rate) best.set(g, { k: rowKey(r), rate: r.rate })
  }
  const top = [...best.values()].sort((a, b) => b.rate - a.rate).slice(0, 30)
  rankMap.clear()
  top.forEach((e, i) => rankMap.set(e.k, i < 10 ? 'top' : 'in'))

  const span = (cls: string, text: string) => {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    return s
  }
  $<HTMLElement>('#rating').replaceChildren(
    span('pot-label', 'Potential'),
    span('pot-value', overall(top.map(e => e.rate)).toFixed(4)),
    span('pot-sub', `${top.length} / 30 charts · top 10 ×2`),
  )
  paintRank()
}


function render() {
  const rs = view()
  shown = rs
  const cols = visible()
  tbody.replaceChildren(...rs.flatMap(r => {
    const tr = rowEl(r, cols)
    return state.expanded === rowKey(r) ? [tr, detailEl(r, cols.length)] : [tr]
  }))
  countEl.textContent = `${rs.length} / ${all.length}`
  emptyEl.hidden = rs.length > 0
  syncSort()
}

// チェックボックス式プルダウンの中身を生成
function fillMenu(host: Element, items: { value: string; label: string; checked: boolean }[],
                  onChange: (value: string, on: boolean) => void) {
  host.replaceChildren(...items.map(it => {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = it.value
    input.checked = it.checked
    input.addEventListener('change', () => onChange(it.value, input.checked))
    label.append(input, it.label)
    return label
  }))
}

function updateChapterLabel() {
  const n = state.chapters.size
  chapterMenu.querySelector('summary')!.textContent = n ? `Chapter (${n})` : 'Chapter'
}



// --- init / events ---
sortKey.append(new Option('Default order', ''), ...COLS.map(c => new Option(c.label, c.key)))

fillMenu($('#col-menu .menu-body'),
  COLS.map(c => ({value: c.key, label: c.label, checked: !hidden.has(c.key)})),
  (v, on) => {
    if (on) hidden.delete(v as ColKey); else hidden.add(v as ColKey)
    saveSettings()
    renderHead()
    render()
  })

fillMenu($('#chapter-menu .menu-body'),
  chapters.map(c => ({value: c, label: c || '(none)', checked: state.chapters.has(c)})),
  (v, on) => {
    if (on) state.chapters.add(v); else state.chapters.delete(v)
    updateChapterLabel()
    saveSettings()
    render()
  })

qInput.addEventListener('input', () => {
  state.q = qInput.value;
  render()
})

const DIFF_LABEL: Record<Diff, string> = {MIN: 'MIN', EVO: 'EVO', ULT: 'ULT', FBD: 'FBD'} // 表示名はここで変更
$<HTMLElement>('#f-diff').append(...DIFFS.map(d => {
  const label = document.createElement('label')
  label.className = 'chip'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.value = d
  input.checked = state.diffs.has(d)
  const span = document.createElement('span')
  span.textContent = DIFF_LABEL[d]
  label.append(input, span)
  return label
}))
const chips = [...document.querySelectorAll<HTMLInputElement>('#f-diff input')]
for (const c of chips) {
  c.addEventListener('change', () => {
    const d = c.value as Diff
    if (c.checked) state.diffs.add(d); else state.diffs.delete(d)
    saveSettings()
    render()
  })
}

// 狭幅用ソート（thead が非表示のため）
sortKey.addEventListener('change', () => {
  state.sort = sortKey.value
    ? {key: sortKey.value as ColKey, dir: state.sort?.dir ?? 'ascending'}
    : null
  render()
})
sortDir.addEventListener('click', () => {
  if (!state.sort) return
  state.sort = {key: state.sort.key, dir: state.sort.dir === 'ascending' ? 'descending' : 'ascending'}
  render()
})

minR.addEventListener('input', () => {
  applyLevel(+minR.value, +maxR.value, 'lo');
  render()
})
maxR.addEventListener('input', () => {
  applyLevel(+minR.value, +maxR.value, 'hi');
  render()
})
minInput.addEventListener('change', () => {
  applyLevel(minInput.valueAsNumber, +maxR.value, 'lo');
  render()
})
maxInput.addEventListener('change', () => {
  applyLevel(+minR.value, maxInput.valueAsNumber, 'hi');
  render()
})

// メニュー外クリックで閉じる
document.addEventListener('click', e => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.menu'))
    if (!d.contains(e.target as Node)) d.open = false
})

$<HTMLButtonElement>('#reset').addEventListener('click', () => {
  applyDefaults();
  // for (const c of chips) c.checked = false
  // for (const i of chapterMenu.querySelectorAll<HTMLInputElement>('input')) i.checked = false
  // state.diffs.clear();
  // state.chapters.clear();
  // state.sort = null
  // state.expanded = null
  // qInput.value = ''
  // state.q = ''
  // applyLevel(LV_MIN, LV_MAX, 'lo')
  // updateChapterLabel()
  // saveSettings()
  // render()
})

function applyDefaults() {
  state.q = ''
  state.diffs = new Set(DIFFS.filter(d => DEFAULTS.diffs.includes(d)))
  state.chapters = new Set(chapters.filter(c => DEFAULTS.chapters.includes(c)))
  state.min = DEFAULTS.min
  state.max = DEFAULTS.max
  state.sort = DEFAULTS.sort
  state.expanded = null
  hidden.clear()
  for (const k of DEFAULTS.hidden) hidden.add(k)

  qInput.value = ''
  for (const c of chips) c.checked = state.diffs.has(c.value as Diff)
  for (const i of chapterMenu.querySelectorAll<HTMLInputElement>('input')) i.checked = state.chapters.has(i.value)
  for (const i of document.querySelectorAll<HTMLInputElement>('#col-menu input')) i.checked = !hidden.has(i.value as ColKey)
  applyLevel(state.min ?? LV_MIN, state.max ?? LV_MAX, 'lo')
  updateChapterLabel()
  renderHead()
  saveSettings()
  render()
}

applyLevel(LV_MIN, LV_MAX, 'lo')
updateChapterLabel()
renderHead()
loadScores().then(m => {
  for (const [k, e] of m) scores.set(k, e)
  for (const r of all) syncScore(r)
  updateOverall()
  render()
}).catch(e => console.warn('idb load failed', e))
// render()