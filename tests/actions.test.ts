import { expect, test } from 'claude-code/testing'

import { actionsFor, noticeText, openScript, requestText } from '../hooks/lib/actions'

test('按鈕對照表：未 commit 有遠端 → commit、commit & push', async () => {
  const buttons = actionsFor({ kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false })
  expect(buttons.map(button => button.label)).toEqual(['commit', 'commit & push'])
})

test('按鈕對照表：未 commit 無遠端 → 只有 commit', async () => {
  const buttons = actionsFor({ kind: 'ok', isCommitted: false, hasUpstream: false, isPushed: false })
  expect(buttons.map(button => button.label)).toEqual(['commit'])
})

test('按鈕對照表：已 commit 未 push 有遠端 → push；無遠端 → 沒有按鈕', async () => {
  expect(actionsFor({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: false }).map(button => button.label)).toEqual(['push'])
  expect(actionsFor({ kind: 'ok', isCommitted: true, hasUpstream: false, isPushed: false })).toEqual([])
})

test('按鈕對照表：已 push、無檔案變更、非 git、資料夾不存在 → 沒有按鈕', async () => {
  expect(actionsFor({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true })).toEqual([])
  expect(actionsFor({ kind: 'noChanges' })).toEqual([])
  expect(actionsFor({ kind: 'notGit' })).toEqual([])
  expect(actionsFor({ kind: 'missingFolder' })).toEqual([])
})

test('複製的文字與 SPEC §11.2 逐字相同', async () => {
  const prefix = '（sessions 狀態面板送來的要求）'
  const commit = prefix + '請把你在這個 session 用工具改過的檔案 commit：只 git add 你自己改過的檔案，不要 add 其他 session 的變更；commit 訊息依實際修改內容撰寫。'
  expect(requestText('commit')).toBe(commit + '這次不要 push。')
  expect(requestText('commitAndPush')).toBe(commit + 'commit 完成後，push 到目前分支的遠端。')
  expect(requestText('push')).toBe(prefix + '請把這個 session 已經 commit 的內容 push 到目前分支的遠端；不要 commit 新的變更。')
  // 不能含雙引號（Windows 傳參數時會被吃掉）
  expect(requestText('commit').includes('"')).toBe(false)
})

test('按下後的提示：有連結時說已切過去，沒有時請使用者自己打開', async () => {
  expect(noticeText('commit', true)).toBe('已複製 commit 要求，已切到該 session：按 Ctrl+V、Enter 送出')
  expect(noticeText('commitAndPush', true)).toBe('已複製 commit & push 要求，已切到該 session：按 Ctrl+V、Enter 送出')
  expect(noticeText('push', false)).toBe('已複製 push 要求：請自己打開該 session，按 Ctrl+V、Enter 送出')
})

test('PowerShell 指令：先放剪貼簿再開連結；單引號寫兩次；不含雙引號', async () => {
  expect(openScript('claude://claude.ai/epitaxy/local_x', null)).toBe("Start-Process 'claude://claude.ai/epitaxy/local_x'")
  expect(openScript(null, "it's")).toBe("Set-Clipboard -Value 'it''s'")
  const both = openScript('claude://claude.ai/epitaxy/local_x', requestText('commit'))
  expect(both.startsWith("Set-Clipboard -Value '（sessions")).toBe(true)
  expect(both.endsWith("; Start-Process 'claude://claude.ai/epitaxy/local_x'")).toBe(true)
  expect(both.includes('"')).toBe(false)
})
