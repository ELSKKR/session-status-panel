import type { GitState } from '../../types'

/**
 * commit 快捷按鈕。面板不能直接送訊息給別的 session（自動權限模式的安全檢查會擋下沒有使用者要求的送出，
 * 切成預設模式也一樣，實測 isDelivered 都是 false），所以改成：把 commit 要求複製到剪貼簿、
 * 讓 app 切到那個 session，由使用者貼上送出。面板自己不跑任何寫入類 git 指令。
 */

export type ActionKind = 'commit' | 'commitAndPush' | 'push'

export type ActionButton = {
  kind: ActionKind
  label: string
}

const PREFIX = '（sessions 狀態面板送來的要求）'

const COMMIT_TEXT =
  PREFIX +
  '請把你在這個 session 用工具改過的檔案 commit：只 git add 你自己改過的檔案，不要 add 其他 session 的變更；commit 訊息依實際修改內容撰寫。'

/** 每個按鈕要複製的文字（SPEC §11.2，逐字固定） */
export function requestText(kind: ActionKind): string {
  if (kind === 'commit') {
    return COMMIT_TEXT + '這次不要 push。'
  }
  if (kind === 'commitAndPush') {
    return COMMIT_TEXT + 'commit 完成後，push 到目前分支的遠端。'
  }
  return PREFIX + '請把這個 session 已經 commit 的內容 push 到目前分支的遠端；不要 commit 新的變更。'
}

/** 依 git 狀態決定要出現哪些按鈕（SPEC §11.2 的對照表） */
export function actionsFor(git: GitState): ActionButton[] {
  if (git.kind !== 'ok') {
    return []
  }
  if (!git.isCommitted) {
    if (git.hasUpstream) {
      return [
        { kind: 'commit', label: 'commit' },
        { kind: 'commitAndPush', label: 'commit & push' },
      ]
    }
    // 沒有遠端，push 一定失敗，不顯示含 push 的按鈕
    return [{ kind: 'commit', label: 'commit' }]
  }
  if (!git.isPushed && git.hasUpstream) {
    return [{ kind: 'push', label: 'push' }]
  }
  return []
}

/** 按下後該列顯示的提示 */
export function noticeText(kind: ActionKind, hasLink: boolean): string {
  let name = 'commit'
  if (kind === 'commitAndPush') {
    name = 'commit & push'
  } else if (kind === 'push') {
    name = 'push'
  }
  if (hasLink) {
    return '已複製 ' + name + ' 要求，已切到該 session：按 Ctrl+V、Enter 送出'
  }
  return '已複製 ' + name + ' 要求：請自己打開該 session，按 Ctrl+V、Enter 送出'
}

/** PowerShell 的單引號字串：裡面的單引號要寫兩次 */
function quote(text: string): string {
  return "'" + text.replace(/'/g, "''") + "'"
}

/**
 * 組出要給 PowerShell 執行的指令：可選擇先把文字放進剪貼簿，再讓 app 打開連結。
 * 只用單引號字串，不含雙引號（Windows 傳參數時會吃掉雙引號）。
 */
export function openScript(link: string | null, clipboardText: string | null): string {
  const parts: string[] = []
  if (clipboardText !== null) {
    parts.push('Set-Clipboard -Value ' + quote(clipboardText))
  }
  if (link !== null) {
    parts.push('Start-Process ' + quote(link))
  }
  return parts.join('; ')
}
