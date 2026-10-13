export type ManualStatus = 'unmarked' | 'developing' | 'paused' | 'finished'

/**
 * 這個 session 自己的 git 狀態（不是整個資料夾的）：
 * - ok：session 改過的檔案裡，有沒有已經被 commit、被 push
 * - noChanges：這個 session 沒有改過這個 git 專案裡的檔案
 * - notGit / missingFolder：資料夾不是 git 專案，或已不存在
 */
export type GitState =
  | { kind: 'ok'; isCommitted: boolean; hasUpstream: boolean; isPushed: boolean }
  | { kind: 'noChanges' }
  | { kind: 'notGit' }
  | { kind: 'missingFolder' }

/** 使用者在 $.store 留下的資料：手動狀態、備註、是否追蹤、session 啟動時登記的時間 */
export type UserEntry = {
  status: ManualStatus
  note: string
  /** 改版前的「隱藏」；現在改看 tracked，只用來判斷舊資料 */
  hidden: boolean
  /** 使用者回答過「要追蹤嗎」才有值；沒有值時由 isTracked 推斷 */
  tracked?: boolean
  lastSeen?: number
}

export type UserData = Record<string, UserEntry>

/** 面板上的一列（掃描出來的資料，不含使用者資料） */
export type Row = {
  sessionId: string
  name: string
  cwd: string | null
  lastActive: number
  git: GitState
  /** 同一個對話被還原／分支出來的其他複本的 sessionId（面板上只留最近的那一份） */
  familyIds: string[]
  /** 桌面版 app 的 session 編號（local_…），用來切到該 session；找不到是 null */
  appId: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-status-panel': {
      rows: Row[]
      user: UserData
      showHidden: boolean
      /** 掃描中的提示或失敗原因；空字串表示沒有訊息 */
      message: string
      /** 按下 commit 類按鈕後，各列顯示的提示（key 是紀錄檔編號）；重新整理時清掉 */
      notices: Record<string, string>
      /** 正在編輯的那一列的紀錄檔編號；空字串表示沒有 */
      editing: string
    }
  }
}
