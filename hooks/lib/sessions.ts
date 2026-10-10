import type { EditedFile } from './gitState'

/** 「最近用過」的範圍：72 小時 */
export const WINDOW_MS = 72 * 60 * 60 * 1000

export type SessionInfo = {
  sessionId: string
  filePath: string
  title: string | null
  cwd: string | null
  /** 紀錄檔裡最後一則使用者／助理訊息的時間；沒有訊息就是 null */
  lastMessageMs: number | null
}

export type TranscriptFile = {
  sessionId: string
  filePath: string
  mtimeMs: number
}

// 讀每個紀錄檔的最後 1 MiB，取最後一筆 customTitle、一筆 cwd、最後一則使用者／助理訊息的時間。
// 紀錄檔最大有 85 MB，而 $.fs.read 讀不了超過 4 MiB 的檔，所以改用 PowerShell；
// 最新標題離檔尾不到 30 KB（118 個檔實測，與整檔結果 0 筆不符）。
// 不能用檔案修改時間判斷「最近用過」：app 會自己重寫紀錄檔（例如重新寫入標題），舊 session 的修改時間會被更新。
// cwd 只認前面是逗號的那種（訊息本身的欄位）：auto mode 會另外記一筆 "git_state":{"cwd":"/c/..."}，路徑寫法不同，會讓同一個對話的複本對不上。
// 腳本不能含雙引號（Windows 傳參數時會被吃掉），雙引號一律寫成 \x22；檔案路徑從標準輸入一行一個傳入。
export const TAIL_SCRIPT = String.raw`[Console]::OutputEncoding=[Text.Encoding]::UTF8
foreach ($p in $input) { $title=''; $cwd=''; $last=''; try { $f=[IO.File]::Open($p,'Open','Read','ReadWrite'); try { $n=[Math]::Min(1048576,$f.Length); $null=$f.Seek(-$n,'End'); $b=New-Object byte[] $n; $r=$f.Read($b,0,$n); $t=[Text.Encoding]::UTF8.GetString($b,0,$r) } finally { $f.Close() }; $m=[regex]::Matches($t,'\x22customTitle\x22:\x22((?:[^\x22\\]|\\.)*)\x22'); if ($m.Count -gt 0) { $title=$m[$m.Count-1].Groups[1].Value }; $c=[regex]::Match($t,',\x22cwd\x22:\x22((?:[^\x22\\]|\\.)*)\x22'); if ($c.Success) { $cwd=$c.Groups[1].Value }; $lines=$t.Split([char]10); for ($i=$lines.Length-1; $i -ge 0; $i--) { if ([regex]::IsMatch($lines[$i],'\x22type\x22:\x22(?:user|assistant)\x22')) { $q=[regex]::Match($lines[$i],'\x22timestamp\x22:\x22([^\x22]+)\x22'); if ($q.Success) { $last=$q.Groups[1].Value; break } } } } catch {}; Write-Output ($p + [char]9 + $title + [char]9 + $cwd + [char]9 + $last) }`

// 讀整個紀錄檔，找出這個 session 用 Edit／Write／MultiEdit／NotebookEdit 改過的檔案，與每個檔案最後一次被改的時間。
// 每行輸出：紀錄檔路徑、時間、檔案路徑，以 Tab 分隔。逐行讀取，不會一次把整個檔載進記憶體。
export const EDITS_SCRIPT = String.raw`[Console]::OutputEncoding=[Text.Encoding]::UTF8
$rx=[regex]'\x22name\x22:\x22(?:Edit|Write|MultiEdit|NotebookEdit)\x22,\x22input\x22:\{.{0,300}?\x22(?:file_path|notebook_path)\x22:\x22((?:[^\x22\\]|\\.)*)\x22'
$tx=[regex]'\x22timestamp\x22:\x22([^\x22]+)\x22'
foreach ($p in $input) { $best=@{}; try { $fs=[IO.File]::Open($p,'Open','Read','ReadWrite'); $sr=New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8); while ($null -ne ($line=$sr.ReadLine())) { if ($line.IndexOf('tool_use') -lt 0) { continue }; $ms=$rx.Matches($line); if ($ms.Count -eq 0) { continue }; $ts=''; $t=$tx.Match($line); if ($t.Success) { $ts=$t.Groups[1].Value }; foreach ($m in $ms) { $f=$m.Groups[1].Value; if (-not $best.ContainsKey($f) -or $best[$f] -lt $ts) { $best[$f]=$ts } } }; $sr.Close() } catch {}; foreach ($k in $best.Keys) { Write-Output ($p + [char]9 + $best[$k] + [char]9 + $k) } }`

/** 把 JSON 字串裡的跳脫字元還原（\\ 變 \、\" 變 "）；壞掉的字串原樣回傳 */
export function decodeJsonString(raw: string): string {
  try {
    return JSON.parse('"' + raw + '"')
  } catch {
    return raw
  }
}

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '')
  if (parts.length === 0) {
    return ''
  }
  return parts[parts.length - 1]
}

export function sessionIdFromPath(filePath: string): string {
  const name = lastSegment(filePath)
  return name.replace(/\.jsonl$/, '')
}

export function folderName(cwd: string): string {
  return lastSegment(cwd)
}

function parseTime(text: string): number | null {
  if (text === '') {
    return null
  }
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) {
    return null
  }
  return ms
}

/** 讀檔尾腳本輸出的一行：路徑、標題、cwd、最後訊息時間，以 Tab 分隔 */
export function parseTailLine(line: string): SessionInfo | null {
  const trimmed = line.replace(/\r$/, '')
  if (trimmed === '') {
    return null
  }
  const parts = trimmed.split('\t')
  if (parts.length < 4) {
    return null
  }
  let title: string | null = null
  if (parts[1] !== '') {
    title = decodeJsonString(parts[1])
  }
  let cwd: string | null = null
  if (parts[2] !== '') {
    cwd = decodeJsonString(parts[2])
  }
  return {
    sessionId: sessionIdFromPath(parts[0]),
    filePath: parts[0],
    title,
    cwd,
    lastMessageMs: parseTime(parts[3]),
  }
}

/** 讀整檔腳本輸出的一行：路徑、時間、被改的檔案路徑，以 Tab 分隔 */
export function parseEditLine(line: string): { sessionId: string; edit: EditedFile } | null {
  const trimmed = line.replace(/\r$/, '')
  if (trimmed === '') {
    return null
  }
  const parts = trimmed.split('\t')
  if (parts.length < 3) {
    return null
  }
  const editedAtMs = parseTime(parts[1])
  if (editedAtMs === null) {
    return null
  }
  return { sessionId: sessionIdFromPath(parts[0]), edit: { path: decodeJsonString(parts[2]), editedAtMs } }
}

/** 面板上顯示的名稱：側邊欄標題 → 資料夾名稱 → session 編號前 8 碼 */
export function pickName(info: SessionInfo): string {
  if (info.title !== null && info.title !== '') {
    return info.title
  }
  if (info.cwd !== null) {
    const name = folderName(info.cwd)
    if (name !== '') {
      return name
    }
  }
  return info.sessionId.slice(0, 8)
}

/**
 * 最近活動時間：最後一則訊息的時間與 lastSeen（session 啟動時登記）取較晚者；兩者都沒有就是 0。
 * 不用檔案修改時間，因為 app 會自己重寫紀錄檔。
 */
export function lastActiveAt(lastMessageMs: number | null, lastSeen: number | undefined): number {
  let result = 0
  if (lastMessageMs !== null) {
    result = lastMessageMs
  }
  if (lastSeen !== undefined && lastSeen > result) {
    result = lastSeen
  }
  return result
}

export function isRecent(lastActive: number, now: number): boolean {
  return now - lastActive <= WINDOW_MS
}

export type Copy = {
  sessionId: string
  title: string | null
  cwd: string | null
  lastActive: number
}

/**
 * 還原（resume）或分支（fork）出來的 session，會把舊對話整份複製到新的紀錄檔，標題與資料夾都相同。
 * 同標題、同資料夾視為同一個對話的複本，只留最近活動的一份；其他複本的編號記在 familyIds。
 * 沒有標題的 session 不合併（沒有可靠的依據）。標題相同但資料夾不同的（例如每天排程各在自己的 worktree）也不合併。
 */
export function groupCopies<T extends Copy>(items: T[]): { winner: T; familyIds: string[] }[] {
  const groups = new Map<string, T[]>()
  const result: { winner: T; familyIds: string[] }[] = []
  for (const item of items) {
    if (item.title === null || item.title === '' || item.cwd === null) {
      result.push({ winner: item, familyIds: [] })
      continue
    }
    const key = item.title + '\u0000' + item.cwd.toLowerCase()
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, [item])
    } else {
      existing.push(item)
    }
  }
  for (const members of groups.values()) {
    const sorted = [...members].sort((left, right) => right.lastActive - left.lastActive)
    result.push({ winner: sorted[0], familyIds: sorted.slice(1).map(member => member.sessionId) })
  }
  return result
}

/**
 * 一個對話的改檔紀錄 = 它所有複本的改檔紀錄合起來。
 * /clear（例如 handoff）會換一個新的紀錄檔，新檔不含 /clear 之前的對話，只讀最新那份會漏掉之前改過的檔案。
 */
export function familyEdits(edits: Map<string, EditedFile[]>, winnerId: string, familyIds: string[]): EditedFile[] {
  const result: EditedFile[] = []
  for (const id of [winnerId, ...familyIds]) {
    result.push(...(edits.get(id) ?? []))
  }
  return result
}

/** 由某個紀錄檔路徑推出 projects 資料夾（上兩層） */
export function projectsDirOf(transcriptPath: string): string {
  const separator = transcriptPath.includes('\\') ? '\\' : '/'
  const parts = transcriptPath.split(separator)
  return parts.slice(0, -2).join(separator)
}

export type ListTool = (path: string) => Promise<{ name: string; kind: string; mtimeMs: number }[]>

/** 列出 projects 底下所有紀錄檔與修改時間。只讀目錄，不讀檔案內容 */
export async function listTranscripts(list: ListTool, projectsDir: string): Promise<TranscriptFile[]> {
  let separator = '/'
  if (projectsDir.includes('\\')) {
    separator = '\\'
  }
  const result: TranscriptFile[] = []
  const folders = await list(projectsDir)
  for (const folder of folders) {
    if (folder.kind !== 'dir') {
      continue
    }
    const entries = await list(projectsDir + separator + folder.name).catch(() => [])
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl')) {
        continue
      }
      const filePath = projectsDir + separator + folder.name + separator + entry.name
      result.push({ sessionId: sessionIdFromPath(entry.name), filePath, mtimeMs: entry.mtimeMs })
    }
  }
  return result
}

export type RunTool = (argv: string[], init: { stdin: string; timeoutMs: number }) => Promise<{ stdout: string }>

/** 一次叫起一個 PowerShell，讀完所有指定紀錄檔的標題、cwd、最後訊息時間 */
export async function readTails(run: RunTool, filePaths: string[]): Promise<SessionInfo[]> {
  if (filePaths.length === 0) {
    return []
  }
  try {
    const result = await run(['powershell', '-NoProfile', '-Command', TAIL_SCRIPT], {
      stdin: filePaths.join('\n') + '\n',
      timeoutMs: 30000,
    })
    const infos: SessionInfo[] = []
    for (const line of result.stdout.split('\n')) {
      const info = parseTailLine(line)
      if (info !== null) {
        infos.push(info)
      }
    }
    return infos
  } catch {
    return []
  }
}

/** 一次叫起一個 PowerShell，讀完所有指定紀錄檔，回傳每個 session 改過的檔案 */
export async function readEdits(run: RunTool, filePaths: string[]): Promise<Map<string, EditedFile[]>> {
  const bySession = new Map<string, EditedFile[]>()
  if (filePaths.length === 0) {
    return bySession
  }
  try {
    const result = await run(['powershell', '-NoProfile', '-Command', EDITS_SCRIPT], {
      stdin: filePaths.join('\n') + '\n',
      timeoutMs: 120000,
    })
    for (const line of result.stdout.split('\n')) {
      const parsed = parseEditLine(line)
      if (parsed === null) {
        continue
      }
      const list = bySession.get(parsed.sessionId)
      if (list === undefined) {
        bySession.set(parsed.sessionId, [parsed.edit])
      } else {
        list.push(parsed.edit)
      }
    }
  } catch {
    return bySession
  }
  return bySession
}
