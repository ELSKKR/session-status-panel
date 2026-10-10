import { expect, test } from 'claude-code/testing'

import {
  decodeJsonString,
  familyEdits,
  folderName,
  groupCopies,
  isRecent,
  lastActiveAt,
  parseEditLine,
  parseTailLine,
  pickName,
  projectsDirOf,
  sessionIdFromPath,
  WINDOW_MS,
} from '../hooks/lib/sessions'

const BS = String.fromCharCode(92)
const TAB = String.fromCharCode(9)

function line(parts: string[]): string {
  return parts.join(TAB)
}

test('JSON 跳脫字元還原：反斜線與引號；壞掉的字串原樣回傳', async () => {
  expect(decodeJsonString(['C:', 'Users', 'User'].join(BS + BS))).toBe(['C:', 'Users', 'User'].join(BS))
  expect(decodeJsonString('say ' + BS + '"hi' + BS + '"')).toBe('say "hi"')
  expect(decodeJsonString('bad ' + BS)).toBe('bad ' + BS)
})

test('由紀錄檔路徑取 sessionId，反斜線與斜線都行', async () => {
  expect(sessionIdFromPath(['C:', 'Users', '.claude', 'projects', 'x', 'abc-123.jsonl'].join(BS))).toBe('abc-123')
  expect(sessionIdFromPath('/home/u/.claude/projects/x/abc-123.jsonl')).toBe('abc-123')
})

test('資料夾名稱取最後一段，結尾有分隔線也行', async () => {
  expect(folderName(['C:', 'Users', 'Documents', 'AI agent 學習環境'].join(BS))).toBe('AI agent 學習環境')
  expect(folderName(['C:', 'Projects', ''].join(BS))).toBe('Projects')
  expect(folderName('')).toBe('')
})

test('讀檔尾輸出一行：有標題有 cwd 有最後訊息時間、沒標題、都沒有', async () => {
  const path = ['C:', 'p', 'x', 'id1.jsonl'].join(BS)
  const escapedCwd = ['C:', 'Users', 'User'].join(BS + BS)
  const withTitle = parseTailLine(line([path, 'Session 工作狀態面板', escapedCwd, '2026-10-08T09:31:29.166Z']))
  expect(withTitle).toEqual({
    sessionId: 'id1',
    filePath: path,
    title: 'Session 工作狀態面板',
    cwd: ['C:', 'Users', 'User'].join(BS),
    lastMessageMs: Date.parse('2026-10-08T09:31:29.166Z'),
  })

  const noTitle = parseTailLine(line([path, '', escapedCwd, '']))
  expect(noTitle?.title).toBeNull()
  expect(noTitle?.lastMessageMs).toBeNull()

  const nothing = parseTailLine(line([path, '', '', '']))
  expect(nothing?.title).toBeNull()
  expect(nothing?.cwd).toBeNull()

  expect(parseTailLine('')).toBeNull()
  expect(parseTailLine(line([path, 'only three', 'fields']))).toBeNull()
})

test('讀整檔輸出一行：session、被改的檔案路徑、最後一次改的時間', async () => {
  const path = ['C:', 'p', 'x', 'id1.jsonl'].join(BS)
  const escapedFile = ['C:', 'repo', 'a.md'].join(BS + BS)
  const parsed = parseEditLine(line([path, '2026-10-08T09:35:26.100Z', escapedFile]))
  expect(parsed).toEqual({
    sessionId: 'id1',
    edit: { path: ['C:', 'repo', 'a.md'].join(BS), editedAtMs: Date.parse('2026-10-08T09:35:26.100Z') },
  })
  expect(parseEditLine(line([path, '', escapedFile]))).toBeNull()
  expect(parseEditLine('')).toBeNull()
})

test('名稱：有標題用標題，沒有就用資料夾名稱，再沒有就用編號前 8 碼', async () => {
  const base = { sessionId: 'abcdef1234', filePath: '', lastMessageMs: null }
  const folder = ['C:', 'a', 'b'].join(BS)
  expect(pickName({ ...base, title: '我的標題', cwd: folder })).toBe('我的標題')
  expect(pickName({ ...base, title: null, cwd: folder })).toBe('b')
  expect(pickName({ ...base, title: null, cwd: null })).toBe('abcdef12')
})

test('72 小時：剛好 72 小時算最近，多 1 毫秒就不算', async () => {
  const now = 1_000_000_000_000
  expect(WINDOW_MS).toBe(72 * 60 * 60 * 1000)
  expect(isRecent(now - WINDOW_MS, now)).toBe(true)
  expect(isRecent(now - WINDOW_MS - 1, now)).toBe(false)
  expect(isRecent(now, now)).toBe(true)
})

test('最近活動時間：取最後訊息時間與 lastSeen 較晚者；兩者都沒有就是 0，所以不算最近', async () => {
  const now = 1_000_000_000_000
  expect(lastActiveAt(100, undefined)).toBe(100)
  expect(lastActiveAt(100, 50)).toBe(100)
  expect(lastActiveAt(100, 300)).toBe(300)
  expect(lastActiveAt(null, 300)).toBe(300)
  expect(lastActiveAt(null, undefined)).toBe(0)
  expect(isRecent(lastActiveAt(null, undefined), now)).toBe(false)
})

test('三天前才有最後一則訊息的 session 不算最近，即使紀錄檔最近被 app 重寫過', async () => {
  const now = Date.parse('2026-10-08T09:30:00Z')
  const lastMessage = Date.parse('2026-10-03T14:32:39Z')
  expect(isRecent(lastActiveAt(lastMessage, undefined), now)).toBe(false)
  // 但最近重新打開過（lastSeen 是剛剛），就算最近
  expect(isRecent(lastActiveAt(lastMessage, now - 1000), now)).toBe(true)
})

test('複本合併：同標題同資料夾只留最近的一份，其他複本記在 familyIds', async () => {
  const folder = ['C:', 'repo'].join(BS)
  const groups = groupCopies([
    { sessionId: 'old', title: '復盤 mod 設計', cwd: folder, lastActive: 100 },
    { sessionId: 'newest', title: '復盤 mod 設計', cwd: folder.toUpperCase(), lastActive: 300 },
    { sessionId: 'mid', title: '復盤 mod 設計', cwd: folder, lastActive: 200 },
  ])
  expect(groups.length).toBe(1)
  expect(groups[0].winner.sessionId).toBe('newest')
  expect(groups[0].familyIds).toEqual(['mid', 'old'])
})

test('複本合併：標題不同、資料夾不同、沒有標題的都不合併', async () => {
  const folderA = ['C:', 'repoA'].join(BS)
  const folderB = ['C:', 'repoB'].join(BS)
  const groups = groupCopies([
    { sessionId: 'a1', title: '每日簡報', cwd: folderA, lastActive: 1 },
    { sessionId: 'a2', title: '每日簡報', cwd: folderB, lastActive: 2 },
    { sessionId: 'a3', title: '另一個', cwd: folderA, lastActive: 3 },
    { sessionId: 'n1', title: null, cwd: folderA, lastActive: 4 },
    { sessionId: 'n2', title: null, cwd: folderA, lastActive: 5 },
  ])
  expect(groups.length).toBe(5)
  expect(groups.every(group => group.familyIds.length === 0)).toBe(true)
})

test('/clear 後：新紀錄檔沒有改檔，之前那份改過的檔案仍算在這一列', async () => {
  const edits = new Map([['beforeClear', [{ path: 'a.ts', editedAtMs: 1 }]]])
  expect(familyEdits(edits, 'afterClear', ['beforeClear'])).toEqual([{ path: 'a.ts', editedAtMs: 1 }])
  expect(familyEdits(edits, 'afterClear', [])).toEqual([])
})

test('由紀錄檔路徑推出 projects 資料夾', async () => {
  expect(projectsDirOf(['C:', 'Users', 'User', '.claude', 'projects', 'folder', 'id.jsonl'].join(BS))).toBe(
    ['C:', 'Users', 'User', '.claude', 'projects'].join(BS),
  )
  expect(projectsDirOf('/home/u/.claude/projects/folder/id.jsonl')).toBe('/home/u/.claude/projects')
})
