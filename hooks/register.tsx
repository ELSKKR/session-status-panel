import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState, ManualStatus, Row, UserData } from '../types'
import { findToplevel, gitLabels, judgeSession, readRepoFacts } from './lib/gitState'
import type { EditedFile, RepoFacts } from './lib/gitState'
import {
  isStatus,
  mergeEntry,
  parseUserData,
  pickEntry,
  sortRows,
  STATUS_ORDER,
  statusColor,
  statusLabel,
  visibleRows,
} from './lib/model'
import {
  familyEdits,
  groupCopies,
  isRecent,
  lastActiveAt,
  listTranscripts,
  pickName,
  readEdits,
  readTails,
  WINDOW_MS,
} from './lib/sessions'
import { actionsFor, noticeText, openScript, requestText } from './lib/actions'
import type { ActionKind } from './lib/actions'
import { appLink, buildAppIdMap, listRecentAppSessionFiles, parseAppSession } from './lib/appSessions'
import type { AppSession } from './lib/appSessions'

const PANE = 'session-status-panel'
const COMMAND = 'sessions'
const PANE_TITLE = 'sessions 狀態'
// 使用者的標記與備註存在 $.store 的這個 key，所有 session 共用
const STORE_KEY = 'sessions'

const rowsAtom = atom({ plugin: 'session-status-panel', key: 'rows' } as const, [])
const userAtom = atom({ plugin: 'session-status-panel', key: 'user' } as const, {})
const showHiddenAtom = atom({ plugin: 'session-status-panel', key: 'showHidden' } as const, false)
const messageAtom = atom({ plugin: 'session-status-panel', key: 'message' } as const, '')
const noticesAtom = atom({ plugin: 'session-status-panel', key: 'notices' } as const, {})

// 寫入 $.store 一律排隊，一筆做完才做下一筆，避免兩次寫入互相蓋掉
// ponytail: 只排本 session 內的寫入；兩個 session 同一瞬間寫入仍可能蓋掉其中一筆，下次重新整理會讀到實際內容
let writeQueue: Promise<void> = Promise.resolve()

async function saveEntry($: EngineInterface, sessionId: string, patch: Partial<UserData[string]>): Promise<void> {
  await update($, userAtom, data => mergeEntry(data, sessionId, patch))
  writeQueue = writeQueue
    .then(async () => {
      const stored = parseUserData(await $.store.get(STORE_KEY))
      await $.store.set(STORE_KEY, mergeEntry(stored, sessionId, patch))
    })
    .catch(() => undefined)
  await writeQueue
}

/** 找到 Claude Code 存紀錄檔的 projects 資料夾：先看 CLAUDE_CONFIG_DIR，再看使用者家目錄 */
async function findProjectsDir($: EngineInterface): Promise<string> {
  const candidates: string[] = []
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) {
    candidates.push(configDir + '/projects')
  }
  const profile = await $.env.get('USERPROFILE')
  if (profile) {
    candidates.push(profile + '\\.claude\\projects')
  }
  const home = await $.env.get('HOME')
  if (home) {
    candidates.push(home + '/.claude/projects')
  }
  for (const candidate of candidates) {
    const exists = await $.fs.exists(candidate).catch(() => false)
    if (exists) {
      return candidate
    }
  }
  return ''
}

/** 讀桌面版 app 的 session 檔，建立「紀錄檔編號 → app 編號」對照；讀不到就回傳空的對照 */
async function readAppIdMap($: EngineInterface, now: number): Promise<Map<string, string>> {
  const appData = await $.env.get('APPDATA')
  if (!appData) {
    return new Map()
  }
  const root = appData + '\\Claude\\claude-code-sessions'
  // 多給 1 小時，避免剛好在邊界的 session 找不到
  const files = await listRecentAppSessionFiles(path => $.fs.list(path), root, now - WINDOW_MS - 60 * 60 * 1000)
  const sessions: AppSession[] = []
  for (const file of files) {
    const text = await $.fs.read(file).catch(() => '')
    if (typeof text !== 'string') {
      continue
    }
    const parsed = parseAppSession(text)
    if (parsed !== null) {
      sessions.push(parsed)
    }
  }
  return buildAppIdMap(sessions)
}

/** 交給 Windows 的 PowerShell：把文字放進剪貼簿、讓 app 打開連結。回傳是否成功 */
async function runOpenScript($: EngineInterface, link: string | null, clipboardText: string | null): Promise<boolean> {
  const script = openScript(link, clipboardText)
  if (script === '') {
    return false
  }
  try {
    const result = await $.process.run(['powershell', '-NoProfile', '-Command', script], { timeoutMs: 15000 })
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** commit 類按鈕：複製要求到剪貼簿、切到該 session，該列顯示提示。面板自己不跑任何寫入類 git 指令 */
async function requestAction($: EngineInterface, row: Row, kind: ActionKind): Promise<void> {
  let link: string | null = null
  if (typeof row.appId === 'string') {
    link = appLink(row.appId)
  }
  const isDone = await runOpenScript($, link, requestText(kind))
  let notice = noticeText(kind, link !== null)
  if (!isDone) {
    notice = '複製或切換失敗，請再按一次'
  }
  await update($, noticesAtom, notices => ({ ...notices, [row.sessionId]: notice }))
}

/** 重新掃描：最近 72 小時用過的 session、各自的標題與資料夾、各資料夾的 git 狀態 */
async function refresh($: EngineInterface): Promise<void> {
  await update($, messageAtom, () => '掃描中…')
  // 上一輪按鈕留下的提示清掉，改看最新的 git 狀態
  await update($, noticesAtom, () => ({}))
  try {
    const projectsDir = await findProjectsDir($)
    if (projectsDir === '') {
      await update($, messageAtom, () => '找不到 Claude Code 的 projects 資料夾')
      return
    }
    const stored = parseUserData(await $.store.get(STORE_KEY))
    await update($, userAtom, () => stored)

    const now = await $.clock.now()
    const run = (argv: string[], init: { stdin: string; timeoutMs: number }) => $.process.run(argv, init)
    const files = await listTranscripts(path => $.fs.list(path), projectsDir)

    // 檔案修改時間只用來挑候選：app 會自己重寫紀錄檔，所以舊 session 的修改時間也可能是最近。
    // 重新打開的舊 session（lastSeen 是最近）也要算進候選。
    const candidates = files.filter(file => {
      const lastSeen = stored[file.sessionId]?.lastSeen
      return isRecent(lastActiveAt(file.mtimeMs, lastSeen), now)
    })

    // 真正的「最近用過」：最後一則訊息的時間與 lastSeen 取較晚者
    const infos = await readTails(run, candidates.map(file => file.filePath))
    const recent = []
    for (const info of infos) {
      const lastActive = lastActiveAt(info.lastMessageMs, stored[info.sessionId]?.lastSeen)
      if (isRecent(lastActive, now)) {
        recent.push({ ...info, lastActive })
      }
    }

    // 還原／分支／clear 出來的複本只留最近的一份當作一列
    const copies = groupCopies(recent)
    const winners = copies.map(copy => copy.winner)
    // 改檔紀錄要讀全部複本：/clear 後的新紀錄檔不含之前的對話
    // ponytail: resume 的複本含整份舊對話，會重複讀；掃描太慢時再改成只讀 /clear 產生的複本
    const rawEdits = await readEdits(run, recent.map(info => info.filePath))
    const edits = new Map<string, EditedFile[]>()
    for (const copy of copies) {
      edits.set(copy.winner.sessionId, familyEdits(rawEdits, copy.winner.sessionId, copy.familyIds))
    }

    // 每個 session 自己的 git 狀態：先找出每個資料夾所屬的 git 專案
    const gitTools = {
      exists: (path: string) => $.fs.exists(path),
      run: (argv: string[], init: { cwd: string; timeoutMs: number }) => $.process.run(argv, init),
    }
    const folders = new Set<string>()
    for (const winner of winners) {
      if (winner.cwd !== null) {
        folders.add(winner.cwd)
      }
    }
    const toplevelByFolder = new Map<string, string>()
    await Promise.all(
      [...folders].map(async folder => {
        toplevelByFolder.set(folder, await findToplevel(gitTools, folder))
      }),
    )

    // 每個 git 專案只讀一次 commit，從這個專案裡最早的編輯時間讀起
    const earliestEditByRepo = new Map<string, number>()
    for (const winner of winners) {
      if (winner.cwd === null) {
        continue
      }
      const toplevel = toplevelByFolder.get(winner.cwd)
      if (toplevel === undefined || toplevel === 'notGit' || toplevel === 'missingFolder') {
        continue
      }
      const sessionEdits: EditedFile[] = edits.get(winner.sessionId) ?? []
      for (const edit of sessionEdits) {
        const current = earliestEditByRepo.get(toplevel)
        if (current === undefined || edit.editedAtMs < current) {
          earliestEditByRepo.set(toplevel, edit.editedAtMs)
        }
      }
    }
    const factsByRepo = new Map<string, RepoFacts>()
    await Promise.all(
      [...earliestEditByRepo.entries()].map(async ([toplevel, earliest]) => {
        factsByRepo.set(toplevel, await readRepoFacts(gitTools, toplevel, earliest - 60000))
      }),
    )

    const appIdMap = await readAppIdMap($, now)

    const rows: Row[] = []
    for (const copy of copies) {
      const winner = copy.winner
      let git: GitState = { kind: 'notGit' }
      if (winner.cwd !== null) {
        const toplevel = toplevelByFolder.get(winner.cwd)
        if (toplevel === 'missingFolder') {
          git = { kind: 'missingFolder' }
        } else if (toplevel !== undefined && toplevel !== 'notGit') {
          const facts = factsByRepo.get(toplevel)
          if (facts === undefined) {
            git = { kind: 'noChanges' }
          } else {
            git = judgeSession(edits.get(winner.sessionId) ?? [], facts)
          }
        }
      }
      rows.push({
        sessionId: winner.sessionId,
        name: pickName(winner),
        cwd: winner.cwd,
        lastActive: winner.lastActive,
        git,
        familyIds: copy.familyIds,
        appId: appIdMap.get(winner.sessionId) ?? null,
      })
    }
    await update($, rowsAtom, () => rows)
    await update($, messageAtom, () => '')
  } catch (error) {
    await update($, messageAtom, () => '掃描失敗：' + String(error))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: '開啟 sessions 狀態面板' })
    // 登記「這個 session 剛被用過」：重新打開舊 session 但還沒送訊息時，紀錄檔的修改時間不會更新
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    await saveEntry($, sessionId, { lastSeen: now })

    return next(e)
  })

  // 桌面版是 session 啟動後才連上的畫面（session.start 時還沒有它），所以在它連上時開面板；不搶輸入框的焦點
  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    if (opened.isPlaced) {
      void refresh($)
    } else {
      $.ui.toast('sessions 狀態面板沒有自動開啟：' + opened.reason)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
    void refresh($)

    return { text: 'sessions 狀態面板已開啟' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>手機版沒有輸入框，不支援 sessions 狀態面板</Text>
    }
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const rows = await read($, rowsAtom)
    const userData = await read($, userAtom)
    const showHidden = await read($, showHiddenAtom)
    const message = await read($, messageAtom)
    const notices = await read($, noticesAtom)

    const shown = sortRows(visibleRows(rows, userData, showHidden))
    const hiddenCount = rows.length - visibleRows(rows, userData, false).length

    let toggleLabel = '顯示已隱藏（' + hiddenCount + '）'
    if (showHidden) {
      toggleLabel = '收起已隱藏（' + hiddenCount + '）'
    }

    const statusOptions = STATUS_ORDER.map(status => ({ value: status, label: statusLabel(status) }))

    const rowElements = []
    for (const row of shown) {
      // 同一個對話的複本共用資料：自己沒標過，就用複本標過的
      const entry = pickEntry(userData, row)
      const status: ManualStatus = entry.status
      const note = entry.note
      const isHidden = entry.hidden
      const labels = gitLabels(row.git)

      // 名稱：找得到 app 編號就畫成按鈕，按下讓 app 切到那個 session；找不到就是一般文字
      let nameElement = <Text bold wrap="truncate">{row.name}</Text>
      const appId = row.appId
      if (typeof appId === 'string') {
        nameElement = (
          <Button
            key={'open:' + row.sessionId}
            label={row.name}
            plain
            onPress={() => {
              void runOpenScript($, appLink(appId), null)
            }}
          />
        )
      }

      // commit 類按鈕：依 git 狀態決定出現哪些
      const actionElements = []
      for (const action of actionsFor(row.git)) {
        actionElements.push(
          <Button
            key={action.kind + ':' + row.sessionId}
            label={action.label}
            onPress={() => {
              void requestAction($, row, action.kind)
            }}
          />,
        )
      }
      let noticeElement = null
      const notice = notices[row.sessionId]
      if (typeof notice === 'string' && notice !== '') {
        noticeElement = <Text color="blue">{notice}</Text>
      }

      let hideLabel = '隱藏'
      if (isHidden) {
        hideLabel = '取消隱藏'
      }

      rowElements.push(
        <Box key={'row:' + row.sessionId} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            {nameElement}
            <Text color={statusColor(status)}>● {statusLabel(status)}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text color={labels.commitColor}>{labels.commitText}</Text>
            <Text color={labels.pushColor}>{labels.pushText}</Text>
            {actionElements}
          </Box>
          {noticeElement}
          <Select
            key={'status:' + row.sessionId}
            label="狀態"
            options={statusOptions}
            value={status}
            onSelect={value => {
              if (isStatus(value)) {
                void saveEntry($, row.sessionId, { status: value })
              }
            }}
          />
          <Input
            key={'note:' + row.sessionId}
            label="備註"
            placeholder="在這裡寫備註"
            value={note}
            submitLabel="儲存"
            onInput={value => {
              void saveEntry($, row.sessionId, { note: value })
            }}
            onSubmit={value => {
              void saveEntry($, row.sessionId, { note: value })
            }}
          />
          <Button
            key={'hide:' + row.sessionId}
            label={hideLabel}
            dimColor
            onPress={() => {
              void saveEntry($, row.sessionId, { hidden: !isHidden })
            }}
          />
        </Box>,
      )
    }

    let emptyText = ''
    if (shown.length === 0 && message === '') {
      emptyText = '最近 72 小時沒有用過的 session'
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="重新整理" variant="primary" onPress={() => void refresh($)} />
          <Button key="toggle-hidden" label={toggleLabel} onPress={() => void update($, showHiddenAtom, value => !value)} />
        </Box>
        {message !== '' && <Text dimColor>{message}</Text>}
        {emptyText !== '' && <Text dimColor>{emptyText}</Text>}
        {rowElements}
      </Box>
    )
  })
}
