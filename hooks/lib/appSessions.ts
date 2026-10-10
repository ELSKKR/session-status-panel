/**
 * 桌面版 app 為每個 session 存一個檔：%APPDATA%\Claude\claude-code-sessions\<帳號>\<組織>\local_<app 編號>.json，
 * 裡面有 app 編號（sessionId）與紀錄檔編號（cliSessionId）。面板用它把紀錄檔編號換成 app 編號，
 * 再組成 claude:// 連結，讓 app 切到那個 session。
 */

export type AppSession = {
  appId: string
  cliSessionId: string
  lastActivityAt: number
}

/** 解析一個 app session 檔的內容；格式不對或缺欄位回傳 null */
export function parseAppSession(text: string): AppSession | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const fields = data as Record<string, unknown>
  if (typeof fields.sessionId !== 'string' || typeof fields.cliSessionId !== 'string') {
    return null
  }
  if (fields.sessionId === '' || fields.cliSessionId === '') {
    return null
  }
  let lastActivityAt = 0
  if (typeof fields.lastActivityAt === 'number') {
    lastActivityAt = fields.lastActivityAt
  }
  return { appId: fields.sessionId, cliSessionId: fields.cliSessionId, lastActivityAt }
}

/** 紀錄檔編號 → app 編號。同一個紀錄檔編號出現在兩個 app session 時，取最近活動的那個 */
export function buildAppIdMap(sessions: AppSession[]): Map<string, string> {
  const best = new Map<string, AppSession>()
  for (const session of sessions) {
    const current = best.get(session.cliSessionId)
    if (current === undefined || session.lastActivityAt > current.lastActivityAt) {
      best.set(session.cliSessionId, session)
    }
  }
  const result = new Map<string, string>()
  for (const [cliSessionId, session] of best) {
    result.set(cliSessionId, session.appId)
  }
  return result
}

/** 讓桌面版 app 切到某個 session 的連結 */
export function appLink(appId: string): string {
  return 'claude://claude.ai/epitaxy/' + appId
}

export type ListTool = (path: string) => Promise<{ name: string; kind: string; mtimeMs: number }[]>

/**
 * 列出 claude-code-sessions 底下（兩層資料夾）修改時間在 sinceMs 之後的 app session 檔。
 * 只看最近更新過的檔，避免每次重新整理都讀全部（實測 201 個、共 15 MB）。
 */
export async function listRecentAppSessionFiles(list: ListTool, root: string, sinceMs: number): Promise<string[]> {
  let separator = '/'
  if (root.includes('\\')) {
    separator = '\\'
  }
  const files: string[] = []
  const accounts = await list(root).catch(() => [])
  for (const account of accounts) {
    if (account.kind !== 'dir') {
      continue
    }
    const accountPath = root + separator + account.name
    const orgs = await list(accountPath).catch(() => [])
    for (const org of orgs) {
      if (org.kind !== 'dir') {
        continue
      }
      const orgPath = accountPath + separator + org.name
      const entries = await list(orgPath).catch(() => [])
      for (const entry of entries) {
        if (entry.kind !== 'file' || !entry.name.startsWith('local_') || !entry.name.endsWith('.json')) {
          continue
        }
        if (entry.mtimeMs >= sinceMs) {
          files.push(orgPath + separator + entry.name)
        }
      }
    }
  }
  return files
}
