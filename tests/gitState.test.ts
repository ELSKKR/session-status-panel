import { expect, test } from 'claude-code/testing'

import { gitLabels, judgeSession, normalizePath, parseCommitLog, parseFileList, relativeTo } from '../hooks/lib/gitState'
import type { Commit, RepoFacts } from '../hooks/lib/gitState'

const SEP = String.fromCharCode(92)
const TOP = 'C:/work/repo'

function repo(commits: Commit[], unpushed: string[], hasUpstream: boolean, present: string[] = ['a.ts', 'b.ts']): RepoFacts {
  return { toplevel: TOP, commits, unpushed: new Set(unpushed), hasUpstream, present: new Set(present) }
}

test('git 管得到的檔案清單：解析 ls-files -z，轉小寫斜線', async () => {
  const stdout = 'Docs/A.md\0b.ts\0\0'
  expect([...parseFileList(stdout)].sort()).toEqual(['b.ts', 'docs/a.md'])
  expect(parseFileList('').size).toBe(0)
})

test('被 .gitignore 排除的檔案不算未 commit：只改了被排除的檔案是「無檔案變更」', async () => {
  // present（git 管得到的檔案）裡沒有 ignored.md，也沒有任何 commit 動過它
  const facts = repo([commit('c1', 100, ['a.ts'])], [], true)
  expect(judgeSession([{ path: 'C:/work/repo/ignored.md', editedAtMs: 90_000 }], facts)).toEqual({ kind: 'noChanges' })

  // 同時改了被排除的檔案和已 commit 的檔案：被排除的不影響，結果是已 commit、已 push
  const mixed = judgeSession(
    [{ path: 'C:/work/repo/ignored.md', editedAtMs: 90_000 }, { path: 'C:/work/repo/a.ts', editedAtMs: 91_000 }],
    facts,
  )
  expect(mixed).toEqual({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true })
})

test('新增還沒 git add 的檔案（未追蹤、沒被排除）仍算未 commit；已追蹤但被刪除還沒 commit 也算', async () => {
  const facts = repo([], [], true, ['new-file.ts', 'deleted-but-tracked.ts'])
  expect(judgeSession([{ path: 'C:/work/repo/new-file.ts', editedAtMs: 90_000 }], facts)).toEqual({
    kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false,
  })
  expect(judgeSession([{ path: 'C:/work/repo/deleted-but-tracked.ts', editedAtMs: 90_000 }], facts)).toEqual({
    kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false,
  })
})

function commit(hash: string, seconds: number, files: string[]): Commit {
  return { hash, committedAtMs: seconds * 1000, files }
}

test('路徑比對：不分大小寫、斜線與反斜線視為相同；不在專案內回傳 null', async () => {
  expect(normalizePath(['C:', 'Work', 'Repo', 'A.MD'].join(SEP))).toBe('c:/work/repo/a.md')
  expect(relativeTo(TOP, ['C:', 'work', 'repo', 'docs', 'A.md'].join(SEP))).toBe('docs/a.md')
  expect(relativeTo(TOP + '/', 'C:/WORK/repo/x.ts')).toBe('x.ts')
  expect(relativeTo(TOP, 'C:/work/repo-other/x.ts')).toBeNull()
  expect(relativeTo(TOP, 'C:/elsewhere/x.ts')).toBeNull()
})

test('解析 git log：每個 commit 的雜湊、時間（毫秒）與檔案；檔名轉小寫', async () => {
  const stdout = '\x01aaa111 1000\nDocs/A.md\nb.ts\n\n\x01bbb222 2000\nc.ts\n'
  expect(parseCommitLog(stdout)).toEqual([
    { hash: 'aaa111', committedAtMs: 1_000_000, files: ['docs/a.md', 'b.ts'] },
    { hash: 'bbb222', committedAtMs: 2_000_000, files: ['c.ts'] },
  ])
  expect(parseCommitLog('')).toEqual([])
})

test('session 改過的檔案都在 commit 裡且已 push：已 commit、已 push', async () => {
  const facts = repo([commit('c1', 100, ['a.ts', 'b.ts'])], [], true)
  const state = judgeSession(
    [{ path: 'C:/work/repo/a.ts', editedAtMs: 90_000 }, { path: 'C:/work/repo/b.ts', editedAtMs: 95_000 }],
    facts,
  )
  expect(state).toEqual({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true })
})

test('已 commit 但那個 commit 還沒 push：已 commit、未 push', async () => {
  const facts = repo([commit('c1', 100, ['a.ts'])], ['c1'], true)
  const state = judgeSession([{ path: 'C:/work/repo/a.ts', editedAtMs: 90_000 }], facts)
  expect(state).toEqual({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: false })
})

test('session 改了檔案之後都沒有 commit 動過它：未 commit、未 push', async () => {
  // 檔案只在 session 改它「之前」被 commit 過，之後沒有
  const facts = repo([commit('c0', 50, ['a.ts'])], [], true)
  const state = judgeSession([{ path: 'C:/work/repo/a.ts', editedAtMs: 90_000 }], facts)
  expect(state).toEqual({ kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false })
})

test('別的 session 的未 commit 變更不影響：這個 session 的修改已被 commit 就算已 commit', async () => {
  // a.ts 在 session 改完後被 commit（c1）。之後別人又改了 a.ts 但沒 commit，工作目錄是髒的，但不在 commit 紀錄裡，不影響判斷
  const facts = repo([commit('c1', 100, ['a.ts'])], [], true)
  const state = judgeSession([{ path: 'C:/work/repo/a.ts', editedAtMs: 99_000 }], facts)
  expect(state).toEqual({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true })
})

test('多個檔案只要有一個沒 commit，整個 session 就是未 commit；同一秒內先改後 commit 算已 commit', async () => {
  const facts = repo([commit('c1', 100, ['a.ts'])], [], true)
  const mixed = judgeSession(
    [{ path: 'C:/work/repo/a.ts', editedAtMs: 99_500 }, { path: 'C:/work/repo/b.ts', editedAtMs: 99_000 }],
    facts,
  )
  expect(mixed).toEqual({ kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false })
  // 編輯在 100.4 秒，commit 時間 100 秒（只到秒）：同一秒，算已 commit
  const sameSecond = judgeSession([{ path: 'C:/work/repo/a.ts', editedAtMs: 100_400 }], facts)
  expect(sameSecond.kind === 'ok' && sameSecond.isCommitted).toBe(true)
})

test('沒有 upstream：已 commit 也算未 push；沒改過這個專案的檔案：無檔案變更', async () => {
  const noRemote = repo([commit('c1', 100, ['a.ts'])], [], false)
  expect(judgeSession([{ path: 'C:/work/repo/a.ts', editedAtMs: 90_000 }], noRemote)).toEqual({
    kind: 'ok', isCommitted: true, hasUpstream: false, isPushed: false,
  })
  expect(judgeSession([{ path: 'C:/elsewhere/x.md', editedAtMs: 1 }], noRemote)).toEqual({ kind: 'noChanges' })
  expect(judgeSession([], noRemote)).toEqual({ kind: 'noChanges' })
})

test('顯示文字與顏色：未＝紅、已＝灰', async () => {
  const labels = gitLabels({ kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false })
  expect(labels.commitText).toBe('未 commit')
  expect(labels.commitColor).toBe('red')
  expect(labels.pushText).toBe('未 push')
  expect(labels.pushColor).toBe('red')

  const done = gitLabels({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true })
  expect(done.commitText).toBe('已 commit')
  expect(done.commitColor).toBe('gray')
  expect(done.pushText).toBe('已 push')
  expect(done.pushColor).toBe('gray')
})

test('沒有遠端時 push 文字附註；無檔案變更、非 git、資料夾不存在各有灰色說明', async () => {
  const noRemote = gitLabels({ kind: 'ok', isCommitted: true, hasUpstream: false, isPushed: false })
  expect(noRemote.pushText).toBe('未 push（無遠端）')

  expect(gitLabels({ kind: 'noChanges' }).commitText).toBe('無檔案變更')
  expect(gitLabels({ kind: 'noChanges' }).commitColor).toBe('gray')
  expect(gitLabels({ kind: 'notGit' }).commitText).toBe('非 git')
  expect(gitLabels({ kind: 'notGit' }).pushText).toBe('')
  expect(gitLabels({ kind: 'missingFolder' }).commitText).toBe('資料夾不存在')
})
