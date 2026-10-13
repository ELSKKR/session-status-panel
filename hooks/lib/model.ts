import type { ManualStatus, Row, UserData, UserEntry } from '../../types'

export type { ManualStatus, Row, UserData, UserEntry }

// 與 cache-meter 的琥珀色同一個色碼
export const AMBER = '#E0A526'

export const STATUS_ORDER: ManualStatus[] = ['unmarked', 'developing', 'paused', 'finished']

export function isStatus(value: string): value is ManualStatus {
  return value === 'unmarked' || value === 'developing' || value === 'paused' || value === 'finished'
}

export function statusLabel(status: ManualStatus): string {
  if (status === 'developing') {
    return '開發中'
  }
  if (status === 'paused') {
    return '開發暫停'
  }
  if (status === 'finished') {
    return '開發結束'
  }
  return '未標記'
}

export function statusColor(status: ManualStatus): string {
  if (status === 'developing') {
    return 'blue'
  }
  if (status === 'paused') {
    return AMBER
  }
  if (status === 'finished') {
    return 'green'
  }
  return 'gray'
}

export function defaultEntry(): UserEntry {
  return { status: 'unmarked', note: '', hidden: false }
}

/** 從 $.store 讀回的值要先檢查形狀：格式不對的欄位用預設值，整筆不是物件就略過 */
export function parseUserData(stored: unknown): UserData {
  const result: UserData = {}
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return result
  }
  for (const [sessionId, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const fields = raw as Record<string, unknown>
    const entry = defaultEntry()
    if (typeof fields.status === 'string' && isStatus(fields.status)) {
      entry.status = fields.status
    }
    if (typeof fields.note === 'string') {
      entry.note = fields.note
    }
    if (typeof fields.hidden === 'boolean') {
      entry.hidden = fields.hidden
    }
    if (typeof fields.tracked === 'boolean') {
      entry.tracked = fields.tracked
    }
    if (typeof fields.lastSeen === 'number') {
      entry.lastSeen = fields.lastSeen
    }
    result[sessionId] = entry
  }
  return result
}

/** 回傳新的資料：只改指定那一筆的指定欄位，不修改傳進來的物件 */
export function mergeEntry(data: UserData, sessionId: string, patch: Partial<UserEntry>): UserData {
  let current = data[sessionId]
  if (current === undefined) {
    current = defaultEntry()
  }
  return { ...data, [sessionId]: { ...current, ...patch } }
}

/** 最近活動的在上；同時間依編號排，結果才固定 */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => {
    if (left.lastActive !== right.lastActive) {
      return right.lastActive - left.lastActive
    }
    return left.sessionId.localeCompare(right.sessionId)
  })
}

/**
 * 有沒有在追蹤：使用者回答過就照回答；
 * 沒回答過的（改版前就有的資料）：被隱藏過的不追蹤，標過狀態或寫過備註的算追蹤，其他都不追蹤。
 */
export function isTracked(entry: UserEntry): boolean {
  if (typeof entry.tracked === 'boolean') {
    return entry.tracked
  }
  if (entry.hidden) {
    return false
  }
  return entry.status !== 'unmarked' || entry.note !== ''
}

/** 要不要在這個 session 的面板頂端問「要追蹤嗎」：還沒回答過、而且目前不算追蹤 */
export function shouldAskTracking(entry: UserEntry): boolean {
  return entry.tracked === undefined && !isTracked(entry)
}

/** 預設只顯示追蹤中的列；showHidden 打開時全部顯示 */
export function visibleRows(rows: Row[], data: UserData, showHidden: boolean): Row[] {
  if (showHidden) {
    return rows
  }
  return rows.filter(row => isTracked(pickEntry(data, row)))
}

function hasContent(entry: UserEntry | undefined): entry is UserEntry {
  if (entry === undefined) {
    return false
  }
  return entry.status !== 'unmarked' || entry.note !== '' || entry.hidden || entry.tracked !== undefined
}

/**
 * 這一列該用哪一筆使用者資料：先看自己的 sessionId，沒有內容就看同一個對話的其他複本。
 * 這樣還原舊 session（產生新的 sessionId）之後，之前標的狀態與備註不會不見。
 */
export function pickEntry(data: UserData, row: Row): UserEntry {
  const own = data[row.sessionId]
  if (hasContent(own)) {
    return own
  }
  for (const copyId of row.familyIds) {
    const copy = data[copyId]
    if (hasContent(copy)) {
      return copy
    }
  }
  if (own !== undefined) {
    return own
  }
  return defaultEntry()
}
