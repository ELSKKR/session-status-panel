import { expect, test } from 'claude-code/testing'

import {
  AMBER,
  isStatus,
  mergeEntry,
  parseUserData,
  pickEntry,
  sortRows,
  statusColor,
  statusLabel,
  visibleRows,
} from '../hooks/lib/model'
import type { Row } from '../hooks/lib/model'

function makeRow(sessionId: string, lastActive: number): Row {
  return { sessionId, name: sessionId, cwd: null, lastActive, git: { kind: 'notGit' }, familyIds: [] }
}

test('同一個對話的複本共用資料：自己沒標過就用複本標過的；自己有標過就用自己的', async () => {
  const data = parseUserData({
    old: { status: 'paused', note: '舊的備註', hidden: false },
    fresh: { status: 'unmarked', note: '', hidden: false, lastSeen: 5 },
    own: { status: 'finished', note: '自己的', hidden: false },
  })
  const resumed: Row = { ...makeRow('fresh', 9), familyIds: ['old'] }
  expect(pickEntry(data, resumed).note).toBe('舊的備註')
  expect(pickEntry(data, resumed).status).toBe('paused')

  const marked: Row = { ...makeRow('own', 9), familyIds: ['old'] }
  expect(pickEntry(data, marked).note).toBe('自己的')

  const nothing: Row = { ...makeRow('none', 9), familyIds: ['also-none'] }
  expect(pickEntry(data, nothing).status).toBe('unmarked')
})

test('複本裡有一份被隱藏，最近的那份也算隱藏', async () => {
  const data = parseUserData({ old: { status: 'finished', note: '', hidden: true } })
  const rows: Row[] = [{ ...makeRow('fresh', 9), familyIds: ['old'] }, makeRow('other', 8)]
  expect(visibleRows(rows, data, false).map(row => row.sessionId)).toEqual(['other'])
})

test('四種手動狀態的文字與顏色：開發中藍、暫停琥珀、結束綠、未標記灰', async () => {
  expect(statusLabel('unmarked')).toBe('未標記')
  expect(statusLabel('developing')).toBe('開發中')
  expect(statusLabel('paused')).toBe('開發暫停')
  expect(statusLabel('finished')).toBe('開發結束')
  expect(statusColor('developing')).toBe('blue')
  expect(statusColor('paused')).toBe(AMBER)
  expect(statusColor('finished')).toBe('green')
  expect(statusColor('unmarked')).toBe('gray')
})

test('isStatus 只接受四種狀態', async () => {
  expect(isStatus('paused')).toBe(true)
  expect(isStatus('whatever')).toBe(false)
})

test('讀回 $.store 的資料：格式不對的欄位用預設值，不會壞掉', async () => {
  expect(parseUserData(undefined)).toEqual({})
  expect(parseUserData('oops')).toEqual({})
  const parsed = parseUserData({
    a: { status: 'paused', note: '卡住', hidden: true, lastSeen: 123 },
    b: { status: 'bogus', note: 5 },
    c: 'not an object',
  })
  expect(parsed.a).toEqual({ status: 'paused', note: '卡住', hidden: true, lastSeen: 123 })
  expect(parsed.b).toEqual({ status: 'unmarked', note: '', hidden: false })
  expect(parsed.c).toBeUndefined()
})

test('更新一筆：只改指定欄位，其他筆與其他欄位不動，不修改原物件', async () => {
  const before = parseUserData({ a: { status: 'developing', note: 'x', hidden: false } })
  const after = mergeEntry(before, 'a', { note: 'y' })
  expect(after.a).toEqual({ status: 'developing', note: 'y', hidden: false })
  expect(before.a.note).toBe('x')

  const created = mergeEntry(after, 'b', { hidden: true })
  expect(created.b).toEqual({ status: 'unmarked', note: '', hidden: true })
  expect(created.a).toEqual(after.a)
})

test('排序：最近活動的在上；同時間依編號，結果固定', async () => {
  const sorted = sortRows([makeRow('old', 1), makeRow('new', 9), makeRow('mid', 5)])
  expect(sorted.map(row => row.sessionId)).toEqual(['new', 'mid', 'old'])
  const ties = sortRows([makeRow('b', 5), makeRow('a', 5)])
  expect(ties.map(row => row.sessionId)).toEqual(['a', 'b'])
})

test('隱藏：預設不顯示已隱藏的列；打開開關後全部顯示；隱藏不影響其他資料', async () => {
  const rows = [makeRow('a', 3), makeRow('b', 2), makeRow('c', 1)]
  const data = parseUserData({ b: { status: 'finished', note: '備註', hidden: true } })
  expect(visibleRows(rows, data, false).map(row => row.sessionId)).toEqual(['a', 'c'])
  expect(visibleRows(rows, data, true).map(row => row.sessionId)).toEqual(['a', 'b', 'c'])
  expect(data.b.note).toBe('備註')
})
