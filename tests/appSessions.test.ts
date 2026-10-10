import { expect, test } from 'claude-code/testing'

import { appLink, buildAppIdMap, listRecentAppSessionFiles, parseAppSession } from '../hooks/lib/appSessions'

const BS = String.fromCharCode(92)

test('解析 app session 檔：取出 app 編號、紀錄檔編號、最近活動時間', async () => {
  const text = JSON.stringify({
    sessionId: 'local_aaaaaaaa',
    cliSessionId: 'bbbbbbbb',
    lastActivityAt: 1791459021203,
    title: 'Session 工作狀態面板',
  })
  expect(parseAppSession(text)).toEqual({ appId: 'local_aaaaaaaa', cliSessionId: 'bbbbbbbb', lastActivityAt: 1791459021203 })
})

test('解析 app session 檔：缺欄位、空字串、壞掉的 JSON、不是物件都回傳 null', async () => {
  expect(parseAppSession(JSON.stringify({ sessionId: 'local_x' }))).toBeNull()
  expect(parseAppSession(JSON.stringify({ sessionId: '', cliSessionId: 'a' }))).toBeNull()
  expect(parseAppSession('{ not json')).toBeNull()
  expect(parseAppSession('"just a string"')).toBeNull()
  // 沒有 lastActivityAt 時當作 0
  expect(parseAppSession(JSON.stringify({ sessionId: 'local_x', cliSessionId: 'c' }))?.lastActivityAt).toBe(0)
})

test('紀錄檔編號 → app 編號：同一個紀錄檔編號出現兩次時取最近活動的', async () => {
  const map = buildAppIdMap([
    { appId: 'local_old', cliSessionId: 'cli-1', lastActivityAt: 100 },
    { appId: 'local_new', cliSessionId: 'cli-1', lastActivityAt: 300 },
    { appId: 'local_other', cliSessionId: 'cli-2', lastActivityAt: 200 },
  ])
  expect(map.get('cli-1')).toBe('local_new')
  expect(map.get('cli-2')).toBe('local_other')
  expect(map.get('cli-3')).toBeUndefined()
})

test('app 連結格式', async () => {
  expect(appLink('local_aaaaaaaa')).toBe('claude://claude.ai/epitaxy/local_aaaaaaaa')
})

test('只列出兩層資料夾下、最近更新過的 local_*.json', async () => {
  const root = ['C:', 'AppData', 'Claude', 'claude-code-sessions'].join(BS)
  const listing: Record<string, { name: string; kind: string; mtimeMs: number }[]> = {
    [root]: [{ name: 'acct', kind: 'dir', mtimeMs: 0 }, { name: 'stray.txt', kind: 'file', mtimeMs: 0 }],
    [[root, 'acct'].join(BS)]: [{ name: 'org', kind: 'dir', mtimeMs: 0 }],
    [[root, 'acct', 'org'].join(BS)]: [
      { name: 'local_new.json', kind: 'file', mtimeMs: 500 },
      { name: 'local_old.json', kind: 'file', mtimeMs: 50 },
      { name: 'archived-sessions.idx', kind: 'file', mtimeMs: 500 },
    ],
  }
  const list = async (path: string) => listing[path] ?? []
  const files = await listRecentAppSessionFiles(list, root, 100)
  expect(files).toEqual([[root, 'acct', 'org', 'local_new.json'].join(BS)])
})
