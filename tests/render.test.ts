import { expect, test } from 'claude-code/testing'

import type {} from '../types'

const PANE = { component: 'Pane', requestId: 'session-status-panel', props: {} } as const

const ROWS = [
  { sessionId: 'a-new', name: '股票分析爬蟲', cwd: 'C:\\x\\a', lastActive: 300, familyIds: [], git: { kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false } },
  { sessionId: 'b-mid', name: 'Unity 戰鬥系統', cwd: 'C:\\x\\b', lastActive: 200, familyIds: [], git: { kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: false } },
  { sessionId: 'c-old', name: 'vibe-coding 實驗', cwd: 'C:\\x\\c', lastActive: 100, familyIds: [], git: { kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true } },
  { sessionId: 'd-hid', name: '被隱藏的 session', cwd: null, lastActive: 50, familyIds: [], git: { kind: 'notGit' } },
]

const USER = {
  'a-new': { status: 'developing', note: '等 API key', hidden: false },
  'b-mid': { status: 'paused', note: '', hidden: false },
  'c-old': { status: 'finished', note: '可以封存', hidden: false },
  'd-hid': { status: 'finished', note: '', hidden: true },
}

test('面板：每列顯示名稱、手動狀態與顏色、git 狀態與顏色；已隱藏的預設不畫；有「重新整理」', async ($, on) => {
  // 測試環境沒有 $.state，用記憶體代替
  const values = new Map<string, unknown>([
    ['rows', ROWS],
    ['user', USER],
    ['showHidden', false],
    ['message', ''],
    ['notices', {}],
  ])
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: 1 } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-status-panel', surface, ...PANE })

    expect(await ui.find({ type: 'Text', text: /^股票分析爬蟲$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Unity 戰鬥系統$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^vibe-coding 實驗$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /被隱藏的 session/ })).toBeUndefined()

    const developing = await ui.find({ type: 'Text', text: /開發中/ })
    expect(developing?.props.color).toBe('blue')
    const paused = await ui.find({ type: 'Text', text: /開發暫停/ })
    expect(paused?.props.color).toBe('#E0A526')
    const finished = await ui.find({ type: 'Text', text: /開發結束/ })
    expect(finished?.props.color).toBe('green')

    // 未 commit、未 push 是紅色；已 commit、已 push 是灰色
    const notCommitted = await ui.find({ type: 'Text', text: /^未 commit$/ })
    expect(notCommitted?.props.color).toBe('red')
    const committed = await ui.find({ type: 'Text', text: /^已 commit$/ })
    expect(committed?.props.color).toBe('gray')
    const pushed = await ui.find({ type: 'Text', text: /^已 push$/ })
    expect(pushed?.props.color).toBe('gray')

    expect(await ui.find({ type: 'Button', props: { label: '重新整理' } })).toBeDefined()
    await ui.unmount()
  }
})

test('面板：打開「顯示已隱藏」後，被隱藏的列也會畫出來，按鈕變成「取消隱藏」', async ($, on) => {
  const values = new Map<string, unknown>([
    ['rows', ROWS],
    ['user', USER],
    ['showHidden', true],
    ['message', ''],
    ['notices', {}],
  ])
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: 1 } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-status-panel', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /被隱藏的 session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /（未追蹤）/ })).toBeDefined()
    await ui.unmount()
  }
})

test('面板：沒有資料時顯示說明文字；掃描中的訊息會顯示', async ($, on) => {
  const values = new Map<string, unknown>([
    ['rows', []],
    ['user', {}],
    ['showHidden', false],
    ['message', ''],
    ['notices', {}],
  ])
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: 1 } }))

  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /最近 72 小時沒有追蹤中的 session/ })).toBeDefined()
  await ui.unmount()

  values.set('message', '掃描中…')
  const scanning = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await scanning.find({ type: 'Text', text: /掃描中/ })).toBeDefined()
  expect(await scanning.find({ type: 'Text', text: /沒有追蹤中的 session/ })).toBeUndefined()
  await scanning.unmount()
})

test('操作：選手動狀態、輸入備註、按隱藏，都會寫回狀態並存進 $.store', async ($, on) => {
  const values = new Map<string, unknown>([
    ['rows', ROWS],
    ['user', USER],
    ['showHidden', false],
    ['message', ''],
    ['notices', {}],
  ])
  // 記憶體版的 $.state：每次寫入版本加一，讀到的版本要跟著變，update 才不會一直當作被別人改過
  const versions = new Map<string, number>()
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key) ?? null, version: versions.get(e.key) ?? 1 } }))
  on('state.set', async (_$, e) => {
    const current = versions.get(e.key) ?? 1
    if (e.ifVersion !== undefined && e.ifVersion !== current) {
      return { value: { isSet: false, version: current } }
    }
    versions.set(e.key, current + 1)
    values.set(e.key, e.value)
    return { value: { isSet: true, version: current + 1 } }
  })

  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })

  // 平常看不到選單與輸入框，按「編輯」才展開
  expect(await ui.find({ type: 'Select', key: 'status:a-new' })).toBeUndefined()
  expect(await ui.find({ type: 'Input', key: 'note:a-new' })).toBeUndefined()
  await ui.press({ plugin: 'session-status-panel', key: 'edit:a-new' })
  expect(values.get('editing')).toBe('a-new')
  await ui.unmount()

  const editA = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await editA.select({ plugin: 'session-status-panel', key: 'status:a-new', value: 'finished' })
  await editA.unmount()
  expect((values.get('user') as Record<string, { status: string }>)['a-new'].status).toBe('finished')

  values.set('editing', 'b-mid')
  const editB = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await editB.input({ plugin: 'session-status-panel', key: 'note:b-mid', text: '卡在動畫狀態機', kind: 'submit' })
  expect((values.get('user') as Record<string, { note: string }>)['b-mid'].note).toBe('卡在動畫狀態機')

  await editB.unmount()

  values.set('editing', 'c-old')
  const editC = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await editC.press({ plugin: 'session-status-panel', key: 'track:c-old' })
  const afterHide = values.get('user') as Record<string, { tracked: boolean; note: string }>
  expect(afterHide['c-old'].tracked).toBe(false)
  expect(afterHide['c-old'].note).toBe('可以封存')

  await editC.unmount()
})

test('session 啟動：註冊 /sessions 指令，並把這個 session 的 lastSeen 存進 $.store', async ($, on) => {
  const registered: string[] = []
  const stored = new Map<string, unknown>()
  on('command.register', async (_$, e) => {
    registered.push(e.name)
    return { value: undefined }
  })
  // 代替引擎自己的 session.start 處理
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-123' }))
  on('clock.now', async () => ({ value: 5000 }))
  on('store.get', async (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', async (_$, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  // 從沒寫過的狀態：引擎回 undefined、版本 0，atom 就用初始值
  on('state.get', async () => ({ value: { value: undefined, version: 0 } }))
  on('state.set', async () => ({ value: { isSet: true, version: 1 } }))

  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  expect(registered).toContain('sessions')
  const saved = stored.get('sessions') as Record<string, { lastSeen?: number; status: string }>
  expect(saved['sess-123'].lastSeen).toBe(5000)
  expect(saved['sess-123'].status).toBe('unmarked')
})

test('重新整理：用最後訊息時間判斷最近、合併複本、以 session 自己改過的檔案判斷 git 狀態', async ($, on) => {
  const HOUR = 60 * 60 * 1000
  const NOW = Date.parse('2026-10-08T10:00:00Z')
  const BS = String.fromCharCode(92)
  const TAB = String.fromCharCode(9)
  const PROJECTS = ['C:', 'home', '.claude', 'projects'].join(BS)
  // 紀錄檔裡的路徑是 JSON 跳脫過的（反斜線兩個）
  const escapedRepo = ['C:', 'home', 'repo'].join(BS + BS)
  const escapedFile = ['C:', 'home', 'repo', 'a.md'].join(BS + BS)
  const iso = (ms: number) => new Date(ms).toISOString()

  const values = new Map<string, unknown>()
  const versions = new Map<string, number>()
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key), version: versions.get(e.key) ?? 0 } }))
  on('state.set', async (_$, e) => {
    const next = (versions.get(e.key) ?? 0) + 1
    versions.set(e.key, next)
    values.set(e.key, e.value)
    return { value: { isSet: true, version: next } }
  })
  on('clock.now', async () => ({ value: NOW }))
  on('env.get', async (_$, e) => {
    if (e.name === 'USERPROFILE') {
      return { value: ['C:', 'home'].join(BS) }
    }
    return { value: undefined }
  })
  on('fs.exists', async () => ({ value: true }))
  on('fs.list', async (_$, e) => {
    // 路徑只比結尾
    if (e.path.endsWith('projects')) {
      return { value: [{ name: 'folder-a', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    }
    // 四個紀錄檔的修改時間都是最近（app 重寫過），但實際最後訊息時間不同
    const entry = (name: string) => ({ name, kind: 'file', size: 10, mtimeMs: NOW - 1 * HOUR, isLink: false })
    return { value: [entry('fresh-id.jsonl'), entry('copy-old.jsonl'), entry('stale-id.jsonl'), entry('other-id.jsonl')] }
  })

  const tails: Record<string, { title: string; lastMessageMs: number }> = {
    'fresh-id': { title: '復盤 mod 設計', lastMessageMs: NOW - 2 * HOUR },
    'copy-old': { title: '復盤 mod 設計', lastMessageMs: NOW - 10 * HOUR },
    'stale-id': { title: '三天前的 session', lastMessageMs: NOW - 100 * HOUR },
    'other-id': { title: '只聊天沒改檔', lastMessageMs: NOW - 3 * HOUR },
  }
  const gitCommands: string[] = []
  const editedPaths: string[] = []
  on('process.run', async (_$, e) => {
    const result = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[0] === 'powershell') {
      const script = e.argv[3]
      const paths = (e.init?.stdin ?? '').split('\n').filter(path => path !== '')
      if (script.includes('customTitle')) {
        const lines = paths.map(path => {
          const id = path.split(BS).pop()?.replace('.jsonl', '') ?? ''
          const tail = tails[id]
          return [path, tail.title, escapedRepo, iso(tail.lastMessageMs)].join(TAB)
        })
        return result(lines.join('\n') + '\n')
      }
      // 只有 fresh-id 改過檔案，a.md 最後在 NOW - 2h 被改
      const lines: string[] = []
      for (const path of paths) {
        editedPaths.push(path)
        if (path.includes('fresh-id')) {
          lines.push([path, iso(NOW - 2 * HOUR), escapedFile].join(TAB))
        }
      }
      return result(lines.join('\n') + '\n')
    }
    gitCommands.push(e.argv.filter(arg => !arg.startsWith('--since') && arg !== '-c' && arg !== 'core.quotepath=false')[1])
    if (e.argv[1] === 'rev-parse') {
      return result('C:/home/repo\n')
    }
    if (e.argv.includes('log')) {
      // 在 NOW - 1.5h 有一個 commit 動過 a.md（晚於 session 最後改它的時間）
      const seconds = Math.floor((NOW - 1.5 * HOUR) / 1000)
      return result('\x01abc123 ' + seconds + '\nA.md\n')
    }
    if (e.argv.includes('ls-files')) {
      // git 管得到的檔案（以 NUL 分隔）：a.md 在裡面
      return result('A.md\0notes.txt\0')
    }
    // rev-list @{u}..HEAD：abc123 還沒 push
    return result('abc123\n')
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))

  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await ui.press({ plugin: 'session-status-panel', key: 'refresh' })

  type SavedRow = { sessionId: string; name: string; cwd: string; familyIds: string[]; git: { kind: string; isCommitted?: boolean; isPushed?: boolean } }
  const rows = values.get('rows') as SavedRow[]
  const bySession = new Map(rows.map(row => [row.sessionId, row]))

  // 三天前才有最後訊息的 stale-id 不出現（即使它的紀錄檔剛被改過）；copy-old 併入 fresh-id
  expect(rows.map(row => row.sessionId).sort()).toEqual(['fresh-id', 'other-id'])
  const fresh = bySession.get('fresh-id')
  expect(fresh?.name).toBe('復盤 mod 設計')
  expect(fresh?.familyIds).toEqual(['copy-old'])
  expect(fresh?.cwd).toBe(['C:', 'home', 'repo'].join(BS))
  // 檔案是 session 改的，之後有 commit 動過它，但那個 commit 還沒 push
  expect(fresh?.git).toEqual({ kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: false })
  // 沒改過檔案的 session：不管資料夾裡別人的變更
  expect(bySession.get('other-id')?.git).toEqual({ kind: 'noChanges' })

  // 複本也要讀（/clear 後之前的改檔在舊紀錄檔裡）；三天前的 session 不讀
  expect(editedPaths.length).toBe(3)
  expect(editedPaths.some(path => path.includes('copy-old'))).toBe(true)
  expect(editedPaths.some(path => path.includes('stale-id'))).toBe(false)
  // 只跑了讀取類的 git 指令，且每個 git 專案只跑一次
  expect([...new Set(gitCommands)].sort()).toEqual(['log', 'ls-files', 'rev-list', 'rev-parse'])
  expect(gitCommands.filter(command => command === 'log').length).toBe(1)
  expect(values.get('message')).toBe('')
  await ui.unmount()
})

// ---- v2：點名稱跳轉、commit 快捷按鈕 ----
const V2_ROWS = [
  { sessionId: 'dirty', name: '還沒 commit 的', cwd: null, lastActive: 300, familyIds: [], appId: 'local_dirty',
    git: { kind: 'ok', isCommitted: false, hasUpstream: true, isPushed: false } },
  { sessionId: 'ahead', name: '還沒 push 的', cwd: null, lastActive: 200, familyIds: [], appId: null,
    git: { kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: false } },
  { sessionId: 'clean', name: '都處理好了', cwd: null, lastActive: 100, familyIds: [], appId: 'local_clean',
    git: { kind: 'ok', isCommitted: true, hasUpstream: true, isPushed: true } },
]

function v2State(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const values = new Map<string, unknown>([
    ['rows', V2_ROWS],
    ['user', { dirty: { tracked: true }, ahead: { tracked: true }, clean: { tracked: true } }],
    ['showHidden', false],
    ['message', ''],
    ['notices', {}],
  ])
  const versions = new Map<string, number>()
  on('state.get', async (_$, e) => ({ value: { value: values.get(e.key), version: versions.get(e.key) ?? 1 } }))
  on('state.set', async (_$, e) => {
    const next = (versions.get(e.key) ?? 1) + 1
    versions.set(e.key, next)
    values.set(e.key, e.value)
    return { value: { isSet: true, version: next } }
  })
  const ran: string[][] = []
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { values, ran }
}

test('名稱：有 app 編號的畫成按鈕，按下讓 app 切到該 session；沒有的仍是文字', async ($, on) => {
  const { ran } = v2State(on)
  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Button', props: { label: '還沒 commit 的' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^還沒 push 的$/ })).toBeDefined()

  await ui.press({ plugin: 'session-status-panel', key: 'open:dirty' })
  expect(ran.length).toBe(1)
  expect(ran[0][0]).toBe('powershell')
  expect(ran[0][3]).toBe("Start-Process 'claude://claude.ai/epitaxy/local_dirty'")
  await ui.unmount()
})

test('commit 類按鈕依 git 狀態出現：未 commit → commit、commit & push；未 push → push；已 push → 沒有', async ($, on) => {
  v2State(on)
  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'commit:dirty' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'commitAndPush:dirty' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'push:dirty' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'push:ahead' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'commit:ahead' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'commit:clean' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'push:clean' })).toBeUndefined()
  await ui.unmount()
})

test('按 commit：複製固定文字到剪貼簿、切到該 session、該列顯示提示；面板自己不跑 git', async ($, on) => {
  const { values, ran } = v2State(on)
  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await ui.press({ plugin: 'session-status-panel', key: 'commit:dirty' })

  expect(ran.length).toBe(1)
  expect(ran[0][0]).toBe('powershell')
  const script = ran[0][3]
  expect(script.startsWith("Set-Clipboard -Value '（sessions 狀態面板送來的要求）請把你在這個 session 用工具改過的檔案 commit")).toBe(true)
  expect(script.includes('這次不要 push。')).toBe(true)
  expect(script.endsWith("; Start-Process 'claude://claude.ai/epitaxy/local_dirty'")).toBe(true)
  expect(ran.some(argv => argv[0] === 'git')).toBe(false)

  const notices = values.get('notices') as Record<string, string>
  expect(notices.dirty).toBe('已複製 commit 要求，已切到該 session：按 Ctrl+V、Enter 送出')
  await ui.unmount()

  // 重新畫一次，提示要出現在那一列
  const again = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await again.find({ type: 'Text', text: /已複製 commit 要求/ })).toBeDefined()
  await again.unmount()
})

test('按 push（沒有 app 編號）：只複製文字，提示請使用者自己打開', async ($, on) => {
  const { values, ran } = v2State(on)
  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  await ui.press({ plugin: 'session-status-panel', key: 'push:ahead' })
  expect(ran[0][3].includes('Start-Process')).toBe(false)
  expect(ran[0][3].includes('請把這個 session 已經 commit 的內容 push')).toBe(true)
  const notices = values.get('notices') as Record<string, string>
  expect(notices.ahead).toBe('已複製 push 要求：請自己打開該 session，按 Ctrl+V、Enter 送出')
  await ui.unmount()
})

test('自己這個 session 沒回答過：面板頂端問要不要追蹤，按「追蹤」寫回 tracked', async ($, on) => {
  const { values } = v2State(on)
  values.set('user', {})
  const stored = new Map<string, unknown>()
  on('session.id', async () => ({ value: 'dirty' }))
  on('store.get', async (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', async (_$, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /要追蹤這個 session 嗎/ })).toBeDefined()
  // 未追蹤的列預設不畫
  expect(await ui.find({ type: 'Button', key: 'open:dirty' })).toBeUndefined()
  await ui.press({ plugin: 'session-status-panel', key: 'track-self' })
  expect((values.get('user') as Record<string, { tracked?: boolean }>).dirty.tracked).toBe(true)
  expect((stored.get('sessions') as Record<string, { tracked?: boolean }>).dirty.tracked).toBe(true)
  await ui.unmount()

  const again = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await again.find({ type: 'Text', text: /要追蹤這個 session 嗎/ })).toBeUndefined()
  expect(await again.find({ type: 'Button', key: 'open:dirty' })).toBeDefined()
  await again.unmount()
})

test('依開發進度分組：每組有小標題與數量，每列都有按鈕', async ($, on) => {
  const { values } = v2State(on)
  values.set('user', {
    dirty: { tracked: true, status: 'developing', note: '', hidden: false },
    ahead: { tracked: true, status: 'paused', note: '', hidden: false },
    clean: { tracked: true, status: 'unmarked', note: '', hidden: false },
  })
  const drawn = await $.ui.mount({ plugin: 'session-status-panel', surface: 'desktop', ...PANE })
  expect(await drawn.find({ type: 'Button', key: 'commit:dirty' })).toBeDefined()
  expect(await drawn.find({ type: 'Button', key: 'edit:clean' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /開發中（1）/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /開發暫停（1）/ })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: /未標記（1）/ })).toBeDefined()
  // 排版已定案，不再有切換鈕
  expect(await drawn.find({ type: 'Button', key: 'layout:1' })).toBeUndefined()
  await drawn.unmount()
})
