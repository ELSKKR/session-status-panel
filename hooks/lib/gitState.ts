import type { GitState } from '../../types'

export type { GitState }

/** session 改過的一個檔案：路徑，與 session 最後一次改它的時間 */
export type EditedFile = {
  path: string
  editedAtMs: number
}

export type Commit = {
  hash: string
  committedAtMs: number
  /** 這個 commit 動到的檔案，相對於 git 專案根目錄 */
  files: string[]
}

/** 一個 git 專案的事實：最近的 commit、還沒 push 的 commit、有沒有 upstream、git 管得到的檔案 */
export type RepoFacts = {
  toplevel: string
  commits: Commit[]
  unpushed: Set<string>
  hasUpstream: boolean
  /**
   * git 會管的檔案（已追蹤，或未追蹤但沒被 .gitignore 排除），相對於專案根目錄。
   * 被排除的檔案永遠不會被 commit，不能算成「未 commit」；已刪除又沒追蹤的檔案也沒有東西可 commit。
   */
  present: Set<string>
}

export type GitLabels = {
  commitText: string
  commitColor: string
  pushText: string
  pushColor: string
}

const PENDING_COLOR = 'red'
const DONE_COLOR = 'gray'

// commit 時間只到秒，編輯時間到毫秒；同一秒內先改後 commit 時要算成「已 commit」，所以多給 999 毫秒
const COMMIT_TIME_SLACK_MS = 999

/** 路徑統一成小寫、斜線，才能比對（Windows 不分大小寫） */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/** 檔案路徑換成相對於 git 專案根目錄的路徑；不在這個專案裡就回傳 null */
export function relativeTo(toplevel: string, path: string): string | null {
  let base = normalizePath(toplevel)
  if (!base.endsWith('/')) {
    base += '/'
  }
  const full = normalizePath(path)
  if (!full.startsWith(base)) {
    return null
  }
  return full.slice(base.length)
}

/**
 * 解析 `git log --name-only --format=%x01%H %ct` 的輸出。
 * 每個 commit 以 \x01 開頭，第一行是「雜湊 提交時間(秒)」，其後每行一個檔案。
 */
export function parseCommitLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const block of stdout.split('\x01')) {
    const lines = block.split('\n').map(line => line.replace(/\r$/, ''))
    const header = lines[0].trim().split(' ')
    if (header.length < 2 || header[0] === '') {
      continue
    }
    const seconds = Number.parseInt(header[1], 10)
    if (Number.isNaN(seconds)) {
      continue
    }
    const files: string[] = []
    for (const line of lines.slice(1)) {
      if (line.trim() !== '') {
        files.push(normalizePath(line.trim()))
      }
    }
    commits.push({ hash: header[0], committedAtMs: seconds * 1000, files })
  }
  return commits
}

/**
 * 判斷「這個 session 自己改過的檔案」有沒有被 commit、被 push。
 * 一個檔案算已 commit：在 session 最後改它之後（含同一秒），有 commit 動過它。
 * 一個檔案算已 push：上面那個 commit（最早的一個）已經不在「還沒 push」的清單裡。
 * 只看 session 自己改過的檔案，所以別的 session 在同一個資料夾留下的未 commit 變更不會算進來。
 */
export function judgeSession(edits: EditedFile[], repo: RepoFacts): GitState {
  const inRepo: { relative: string; editedAtMs: number }[] = []
  for (const edit of edits) {
    const relative = relativeTo(repo.toplevel, edit.path)
    // 被 .gitignore 排除、或已刪除又沒追蹤的檔案，沒有東西可以 commit，不列入判斷
    if (relative !== null && repo.present.has(relative)) {
      inRepo.push({ relative, editedAtMs: edit.editedAtMs })
    }
  }
  if (inRepo.length === 0) {
    return { kind: 'noChanges' }
  }

  const oldestFirst = [...repo.commits].sort((left, right) => left.committedAtMs - right.committedAtMs)
  let isCommitted = true
  let isPushed = repo.hasUpstream
  for (const file of inRepo) {
    let covering: Commit | null = null
    for (const commit of oldestFirst) {
      if (commit.committedAtMs + COMMIT_TIME_SLACK_MS >= file.editedAtMs && commit.files.includes(file.relative)) {
        covering = commit
        break
      }
    }
    if (covering === null) {
      isCommitted = false
      isPushed = false
    } else if (repo.unpushed.has(covering.hash)) {
      isPushed = false
    }
  }
  return { kind: 'ok', isCommitted, hasUpstream: repo.hasUpstream, isPushed }
}

/** 顯示用的文字與顏色：「未」是紅色，「已」是灰色，沒有 git 資訊時也是灰色 */
export function gitLabels(state: GitState): GitLabels {
  if (state.kind === 'noChanges') {
    return { commitText: '無檔案變更', commitColor: DONE_COLOR, pushText: '', pushColor: DONE_COLOR }
  }
  if (state.kind === 'notGit') {
    return { commitText: '非 git', commitColor: DONE_COLOR, pushText: '', pushColor: DONE_COLOR }
  }
  if (state.kind === 'missingFolder') {
    return { commitText: '資料夾不存在', commitColor: DONE_COLOR, pushText: '', pushColor: DONE_COLOR }
  }

  let commitText = '未 commit'
  let commitColor = PENDING_COLOR
  if (state.isCommitted) {
    commitText = '已 commit'
    commitColor = DONE_COLOR
  }

  let pushText = '未 push'
  let pushColor = PENDING_COLOR
  if (state.isPushed) {
    pushText = '已 push'
    pushColor = DONE_COLOR
  } else if (!state.hasUpstream) {
    pushText = '未 push（無遠端）'
  }
  return { commitText, commitColor, pushText, pushColor }
}

/** 查 git 專案需要的兩個能力，由 register.tsx 用 $ 組出來傳入（引擎不允許把 $ 傳進別的檔案） */
export type GitTools = {
  exists: (path: string) => Promise<boolean>
  run: (argv: string[], init: { cwd: string; timeoutMs: number }) => Promise<{ exitCode: number; stdout: string }>
}

/** 資料夾所在的 git 專案根目錄；不是 git 專案回傳 'notGit'，資料夾不存在回傳 'missingFolder' */
export async function findToplevel(tools: GitTools, folder: string): Promise<string | 'notGit' | 'missingFolder'> {
  const exists = await tools.exists(folder).catch(() => false)
  if (!exists) {
    return 'missingFolder'
  }
  try {
    const result = await tools.run(['git', 'rev-parse', '--show-toplevel'], { cwd: folder, timeoutMs: 10000 })
    const top = result.stdout.trim()
    if (result.exitCode !== 0 || top === '') {
      return 'notGit'
    }
    return top
  } catch {
    return 'notGit'
  }
}

/** 讀一個 git 專案從 sinceMs 起的 commit 與還沒 push 的 commit。只執行唯讀的 git 指令 */
export async function readRepoFacts(tools: GitTools, toplevel: string, sinceMs: number): Promise<RepoFacts> {
  const since = new Date(sinceMs).toISOString()
  const log = await tools.run(
    ['git', '-c', 'core.quotepath=false', 'log', '--since=' + since, '--name-only', '--format=%x01%H %ct'],
    { cwd: toplevel, timeoutMs: 20000 },
  )
  const commits = parseCommitLog(log.stdout)

  const unpushed = new Set<string>()
  let hasUpstream = false
  const ahead = await tools.run(['git', 'rev-list', '@{u}..HEAD'], { cwd: toplevel, timeoutMs: 10000 })
  if (ahead.exitCode === 0) {
    hasUpstream = true
    for (const line of ahead.stdout.split('\n')) {
      if (line.trim() !== '') {
        unpushed.add(line.trim())
      }
    }
  }

  // git 會管的檔案：已追蹤的 + 未追蹤但沒被 .gitignore 排除的（-z 以 NUL 分隔，檔名含特殊字元也不會被引號包起來）
  const listing = await tools.run(
    ['git', '-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: toplevel, timeoutMs: 20000 },
  )
  const present = parseFileList(listing.stdout)
  return { toplevel, commits, unpushed, hasUpstream, present }
}

/** 解析 `git ls-files -z` 的輸出（以 NUL 分隔），路徑轉成小寫斜線格式 */
export function parseFileList(stdout: string): Set<string> {
  const files = new Set<string>()
  for (const entry of stdout.split('\0')) {
    if (entry !== '') {
      files.add(normalizePath(entry))
    }
  }
  return files
}
