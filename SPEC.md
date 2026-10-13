# Spec：Session 工作狀態面板（session-status-panel）

## 名詞對照（本文件固定用法）

| 稱呼 | 指什麼 |
|---|---|
| session | Claude Code 桌面版側邊欄裡的一個對話 |
| mod | 本專案要做的外掛（Claude Code 的功能擴充，能在畫面上畫出面板） |
| 面板 | mod 在桌面版右側畫出的 panel |
| 紀錄檔 | `~/.claude/projects/<資料夾編碼>/<sessionId>.jsonl`，每個 session 一個 |
| 手動狀態 | 使用者自己標記的：未標記 / 開發中 / 開發暫停 / 開發結束 |
| git 狀態 | 程式自動查的：commit 與 push 的情況 |
| 紀錄檔編號 | 紀錄檔的檔名（例如 `bbbbbbbb-…`），也就是 Claude Code 的 session id；面板內部一律用它識別 session |
| app 編號 | 桌面版 app 自己的 session 編號（例如 `local_aaaaaaaa-…`），只用來組「跳到該 session」的連結 |
| commit 要求 | 面板複製到剪貼簿、由使用者貼給某個 session 的一段文字，請那個 session 的 Claude 自己 commit／push |

## 1. Objective

**目標：** 在桌面版右側開一個面板，一眼看出最近用過的每個 session 做到哪、git 有沒有處理，回來時知道先接哪個。

**使用者：** 使用者本人，同時開多個 session。

**為什麼現在做：** session 一多，就會忘記哪個做完、哪個還沒 commit 或 push。

**每個 session 一列，顯示：**
1. 名稱：側邊欄的 session 標題（讀紀錄檔最後一筆 `custom-title`；沒有就退回資料夾名稱）
2. 手動狀態（使用者切換）：未標記（預設，不上色）／開發中（藍）／開發暫停（琥珀）／開發結束（綠）
3. git 狀態（自動，**以這個 session 自己改過的檔案為準**，不是整個資料夾）：已／未 commit，已／未 push。「未」用紅色，「已」用灰色。session 沒改過這個 git 專案裡的檔案，顯示灰色「無檔案變更」
4. 備註：使用者在該列旁輸入的文字
5. **（v2）名稱可以點**：點了在主視窗打開那個 session，跟點側邊欄一樣（見 §11）
6. **（v2）commit 快捷按鈕**：把 commit 要求複製到剪貼簿並切到那個 session，你按 Ctrl+V、Enter 送出，由它的 Claude 自己 commit（與 push）；面板那一列顯示提示（見 §11）

**列出範圍：** 最近 72 小時內有用過的 session（見 §7 第 1 項對「用過」的定義）。超過 72 小時的 session 自動從面板消失，但它的手動狀態與備註仍保留，再用到時會回來。

**複本合併：** 還原（resume）或分支（fork）一個 session，會把舊對話整份複製進新的紀錄檔。標題相同且資料夾相同的，視為同一個對話的複本，只顯示最近活動的一份；舊複本標過的狀態與備註，在新複本自己沒標過時沿用。標題不同的（例如被改名的分支）不合併。

**操作：** 兩個入口都要有：輸入指令 `/sessions`，以及輸入框上方 cache-meter 那一列右側的按鈕，按鈕名稱「sessions 狀態」（按鈕位置的做法見 §10 第 2 項）。面板不自動彈出。每列可切換手動狀態、編輯備註、隱藏。隱藏的 session 預設不顯示，面板底部有「顯示已隱藏」開關。面板有「重新整理」按鈕。排序：最近有活動的在上。

**不做（Out of scope）：**
- 不自動判斷「開發結束」
- 不做手機版（手機版沒有輸入框）
- 面板自己不跑任何寫入類 git 指令（commit、push 都交給該 session 的 Claude 做，面板對 git 維持唯讀）
- 不直接送訊息給其他 session（實測被安全檢查擋下，改由使用者貼上）
- 不自動核准其他 session 的工具使用（它要核准 git 指令時，使用者自己點進去）
- 不追蹤 commit 要求是否完成（完成後按「重新整理」看 git 狀態）
- 不永久刪除任何記錄
- 不修改紀錄檔、不修改桌面版 app 的 session 檔

## 2. Tech Stack

- Claude Code mod，TypeScript + JSX（`hooks/register.tsx`），用外掛 API：`$.ui.open`（面板）、`ui.render`（畫面）、`$.command.register`（指令）、`$.store`（跨 session 儲存）、`$.fs`（讀紀錄檔）、`$.process.run`（跑唯讀 git、PowerShell 讀檔、v2 用系統開啟 `claude://` 連結）、`Set-Clipboard`（v2 複製 commit 要求）
- 面板元件：`Box`、`Text`、`Button`、`Input`、`Select`（桌面版皆支援）
- 不引入任何外部套件

## 3. Commands

```
驗證 mod：   claude plugin validate <mod 資料夾>
跑測試：     claude plugin test <mod 資料夾>
型別檢查：   tsc -p <mod 資料夾>
```

（型別檢查需 mod 被引擎載入過、`.claude-plugin/types/` 產生之後才能跑。）

## 4. Project Structure

```
session-status-panel/
  SPEC.md                      本文件
  .claude-plugin/plugin.json   名稱、版本、說明、types 路徑
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           註冊指令、面板、畫面（只做組裝）
  hooks/lib/sessions.ts        掃描紀錄檔、判斷 72 小時、取標題與資料夾
  hooks/lib/gitState.ts        跑 git、把輸出換成 git 狀態（純函式部分可單獨測）
  hooks/lib/model.ts           狀態列舉、顏色對照、排序、隱藏過濾
  hooks/lib/actions.ts         （v2）commit 要求的文字、各 git 狀態該出現哪些按鈕、送出結果的顯示文字
  hooks/lib/appSessions.ts     （v2）讀桌面版 session 檔：紀錄檔編號 → app 編號、組 claude:// 連結
  hooks/lib/*.test.ts          各 lib 的測試
  types/index.d.ts             $.state 型別（若需要）
```

載入位置：開發階段放 `~/.claude/dev-mods/…`（只有開發用，不影響新 session）。要在新 session 實際生效，必須放進 `~/.claude/mods/` 並列入 settings.json 的 `CLAUDE_CODE_PLUGIN_DIRS`。這一步會長期保留設定，執行前先問使用者。

## 5. Code Style

教學與可讀性優先：用 if/else 與完整名稱，不用三元運算子、縮寫。

```ts
type ManualStatus = 'unmarked' | 'developing' | 'paused' | 'finished'

function statusLabel(status: ManualStatus): string {
  if (status === 'developing') {
    return '開發中'
  }
  if (status === 'paused') {
    return '開發暫停'
  }
  if (status === 'finished') {
    return '開發結束'
  }
  return '未標記'
}
```

- 純邏輯（解析 git 輸出、判斷 72 小時、取標題）寫成不碰 `$` 的函式，才好測
- 只有 `register.tsx` 可以碰 `$`
- 用 `$.store` 存的資料格式：`sessions` 物件，key 是 sessionId，值為 `{ status, note, hidden, lastSeen }`

## 6. Testing Strategy

| 層級 | 內容 | 工具 |
|---|---|---|
| 單元測試 | `parseGitState`（乾淨／有變更／無 upstream／有 ahead／非 git）、`pickTitle`（有、多筆取最後、沒有→退回資料夾名稱）、`isRecent`（剛好 72 小時邊界）、排序、隱藏過濾 | `*.test.ts` + `claude plugin test` |
| 載入驗證 | mod 能載入、指令有註冊、無型別錯誤 | `claude plugin validate`、`tsc -p` |
| 實機驗證 | 面板真的出現在右側、顏色與版面、輸入備註後重開仍在 | **使用者看實際畫面** |

`claude plugin test` 不檢查顏色與實際外觀，所以所有外觀相關項目在使用者確認前一律標「尚未驗證」。

## 7. 資料來源與兩種情境檢查

| # | 資料 | 來源 | 風險與處理 |
|---|---|---|---|
| 1 | 「用過」的定義 | **紀錄檔裡最後一則使用者／助理訊息的時間**，與 `$.store` 的 `lastSeen` 取較晚者；`lastSeen` 在每個載入 mod 的 session 啟動時寫入 | **不能用紀錄檔修改時間**：app 會自己重寫紀錄檔（重新寫入標題），舊 session 的修改時間會變成最近（實測：54 個檔案修改時間在 72 小時內，但實際最後訊息在 72 小時內的只有 34 個）。修改時間只用來挑候選。`lastSeen` 補上「重新打開舊 session 但還沒送訊息」的情況 |
| 2 | session 標題 | 紀錄檔內最後一筆 `custom-title` | 還沒命名的 session 沒有這筆，退回資料夾名稱 |
| 3 | session 的資料夾 | 紀錄檔記錄的 cwd | 已驗證 118 個檔全部有 cwd |
| 4 | session 自己改過的檔案 | 讀整個紀錄檔，找出 Edit／Write／MultiEdit／NotebookEdit 的檔案路徑，與每個檔案最後一次被改的時間 | 只涵蓋這四種工具；經由 Bash 指令（sed、python、mv 等）改的檔案抓不到，這類 session 可能顯示「無檔案變更」 |
| 5 | git 專案的事實 | `git rev-parse --show-toplevel`、`git log --since --name-only`、`git rev-list @{u}..HEAD`、`git ls-files -z --cached --others --exclude-standard`（全部唯讀，每個 git 專案各查一次，都在專案根目錄執行） | 見下方判斷規則 |

**git 狀態判斷（以 session 自己改過的檔案為準）：**

為什麼不查整個資料夾：同一個資料夾常被約 20 個 session 共用，別的 session 留下的未 commit 變更會讓所有 session 都顯示「未 commit」，實測就是這樣出錯的。

- 只計算「git 會管的檔案」（已追蹤，或未追蹤但沒被 `.gitignore` 排除，用 `git ls-files --cached --others --exclude-standard` 取得）。被 `.gitignore` 排除的檔案永遠不會被 commit，已刪除又沒追蹤的檔案沒有東西可 commit，都不列入判斷（實測就是這裡出錯：session 只改了被排除的 `ee-class/…` 檔案，卻永遠顯示未 commit）
- 每個被 session 改過、且位於該 git 專案內的檔案：在 session 最後改它之後（含同一秒），有 commit 動過它 → 這個檔案算已 commit；沒有 → 未 commit（新增還沒 `git add` 的檔案、已追蹤但刪除後還沒 commit 的檔案，都算未 commit）
- 所有檔案都算已 commit → 已 commit；只要有一個沒有 → 未 commit
- 已 commit 的檔案，若涵蓋它的那個 commit 已經在 upstream → 已 push；還沒 → 未 push。有任何檔案未 commit → 未 push
- 沒有 upstream（分支沒設定遠端）→ 未 push（附註「無遠端」）
- session 沒改過這個 git 專案裡的任何檔案 → 灰色「無檔案變更」
- 不是 git 專案 → 灰色「非 git」；資料夾已不存在 → 灰色「資料夾不存在」
- 別的 session 或你自己之後又改了同一個檔案但還沒 commit：不影響這個 session（它當時的修改已經被 commit）

**兩種情境逐項檢查（會顯示什麼）：**

| 顯示的資料 | ① 新 session，還沒輸入任何訊息 | ② 從側邊欄重新打開舊 session |
|---|---|---|
| 該 session 是否出現在列表 | 紀錄檔可能還沒產生；`session.start` 已寫入 `lastSeen`，但沒有紀錄檔就拿不到資料夾與標題，這一列暫不顯示，送出第一則訊息後出現 | 出現（`lastSeen` 剛更新，不論是否已送訊息） |
| 名稱 | 無標題 → 資料夾名稱 | 有 `custom-title` 就用標題，否則資料夾名稱 |
| 手動狀態 | 未標記 | 之前存的狀態，沒存過就是未標記 |
| 備註 | 空白 | 之前存的備註 |
| git 狀態 | 新 session 還沒有紀錄檔，所以這一列暫不顯示；送出第一則訊息後出現，沒改檔案前顯示「無檔案變更」 | 打開面板時查，依 session 改過的檔案判斷 |

## 8. Boundaries

- **Always**
  - 面板對 git、紀錄檔、桌面版 session 檔維持唯讀；只寫 `$.store`
  - commit 要求只在使用者按下按鈕時複製，一次按一次；文字固定（見 §11），不夾帶備註或其他內容
  - 純邏輯寫成可測函式，改邏輯前先寫測試
  - 外觀相關改動回報時一律寫「尚未驗證」，請使用者看畫面
  - 宣稱「完成」或「已存檔」前先讀回檔案或重新計數
- **Ask first**
  - 把 mod 放進 `~/.claude/mods/` 或寫入 `CLAUDE_CODE_PLUGIN_DIRS`
  - 新增任何外部相依套件
  - 更改 `$.store` 的資料格式（會影響已存的標記與備註）
  - 修改其他已載入的 mod（例如 cache-meter）的程式碼
- **Never**
  - 面板自己執行會改變 git 的指令（commit、push、add、reset、checkout 等）
  - 自動複製或送出 commit 要求（例如偵測到未 commit 就自動處理）
  - 修改或刪除紀錄檔、桌面版 session 檔
  - 自動判斷或自動改寫手動狀態
  - 把備註內容送到任何外部服務
  - 在沒讀回確認前說「已修好」

## 9. Success Criteria

1. 輸入 `/sessions` 或按下「sessions 狀態」按鈕後，右側出現面板；不操作時不自動出現
2. 列表只含最近 72 小時內用過的 session，依最近活動由新到舊排序；測試涵蓋剛好 72 小時的邊界
3. 每列顯示：標題（沒有則資料夾名稱）、手動狀態、git 狀態、備註
4. 手動狀態四種可切換，重開面板與重啟後仍保留；顏色依 §1 對照
5. git 狀態以 session 自己改過的檔案判斷，涵蓋：未 commit、已 commit 未 push、已 push、無 upstream、無檔案變更、非 git、資料夾不存在，以及「別人之後改了同一個檔案但沒 commit 不影響」；皆有單元測試
6. 備註可輸入並保留；隱藏後預設不顯示，開關可顯示並可取消隱藏
7. 超過 72 小時的 session 從列表消失，但再次使用後，先前的狀態與備註回來
8. 面板自己沒有執行任何寫入 git 或紀錄檔的操作（測試或程式碼檢查可證明）；v2 的 commit 由收到要求的 session 執行
9. `claude plugin validate`、`claude plugin test`、`tsc -p` 全部通過
10. 顏色與版面：由使用者在實機確認（在此之前標「尚未驗證」）
11. 修改後的 cache-meter：原有各段顯示不變、整列仍只有一行、按鈕在最右邊；cache-meter 原有測試全數通過；本 mod 未載入時，cache-meter 不出錯
12. （v2）點 session 名稱，桌面版主視窗切到那個 session；找不到 app 編號的 session，名稱照常顯示但不可點，旁邊不出錯
13. （v2）按鈕依 §11 的對照表出現；已 push、無檔案變更、非 git、資料夾不存在都沒有按鈕（有測試）
14. （v2）按下按鈕：複製的文字與 §11 完全相同、切到正確的 session（有測試）；該列顯示對應提示；面板自己沒有跑任何 git 指令（有測試）
15. （v2）按「重新整理」後，送出結果的提示清掉，改顯示最新 git 狀態

## 10. Open Questions

1. **「最近三天」** 已確認：滾動 72 小時。
2. **按鈕位置（已決定：選 A）** 按鈕放在 cache-meter 那一列的最右邊，使用者已授權修改 `~/.claude/mods/cache-meter`，範圍僅限加這個按鈕。原因：cache-meter 的畫面是自己畫一列，再把其他 mod 的內容接在它下方（`cache-meter/hooks/register.tsx` 第 214 到 234 行），本 mod 自己畫的內容無法放進同一列。
   **實際做法（已實作，改用指令而不是直接開面板）：** cache-meter 那一列最右邊加「sessions 狀態」按鈕，按下時執行 `$.command.run({ command: 'sessions' })`，也就是跟輸入 `/sessions` 完全相同的路徑。cache-meter 只需要知道指令名稱 `sessions`，不用知道面板編號，面板開啟與掃描都留在本 mod。本 mod 沒載入時，指令不存在，按鈕按下去只會跳一則提示，不會出錯（有測試）。修改內容見 `patches/cache-meter-sessions-button.patch`，原檔備份在本 session 的暫存資料夾。
   風險：cache-meter 用面板寬度決定放幾段文字，加按鈕後先扣掉按鈕寬度（按鈕文字寬度 + 4 格框線 + 1 格間隔），原有各段不變（有測試，窄寬度 40 欄時先少放文字段落、按鈕保留）。
   已檢查 fupan、next-steps-desktop 兩個 mod，它們都有把下層內容畫在自己上方，沒有蓋掉 cache-meter 的問題。
   **尚未驗證：** 按鈕在真實畫面的位置與外觀；cache-meter 位於 `~/.claude/mods/`，要開新 session 才會載入修改。
3. **顏色** 真實面板用顏色名稱 `blue`、`green`、`red`、`gray` 與色碼 `#E0A526`（琥珀，與 cache-meter 同一個色碼）。有測試確認兩種介面（terminal、desktop）都套到對的元素上。**實際深淺色主題下的外觀尚未驗證**，請使用者看畫面。
4. **技術假設驗證結果：**
   - `$.fs` 能讀 `~/.claude/projects`：**可行**。`$.fs.list` 實測列出 35 個資料夾；但單次 `$.fs.read` 上限 4 MiB，而 118 個紀錄檔中 37 個超過（最大 85 MB），所以標題與資料夾改由 PowerShell 讀檔尾取得。
   - `$.process.run` 指定資料夾跑 git：**可行**。實測在另一個專案資料夾執行 `git status --porcelain` 與 `git rev-list --count @{u}..HEAD` 成功。
   - 紀錄檔記有 cwd：**可行**。118 個檔全部讀得到 cwd；其中 15 個沒有 `custom-title`，這些退回顯示資料夾名稱。
   - 讀檔尾取標題夠快、夠準：**可行**。一個 PowerShell 程序讀完 118 個檔共 0.7 秒；與整檔掃描的結果比對，0 筆不符。檔尾只需讀 1 MiB。
   - 實作中學到的限制：①`$` 不能傳進另一個檔案的函式，所以碰 `$` 的呼叫都留在 `register.tsx`，其餘函式改收小型介面（也因此能用假資料測試）；②PowerShell 的 `-Command` 字串不能含雙引號（Windows 傳參數時會被吃掉），腳本內雙引號一律寫成 `\x22`，檔案路徑改從標準輸入傳入；③`atom` 的 `plugin`、`key` 必須是寫死的字串。
5. **效能目標** 讀取紀錄檔部分實測 0.7 秒（118 個檔）。含 git 查詢的整體時間**尚未在真實畫面量測**。

## 11. v2：點名稱跳轉、commit 快捷按鈕

### 11.1 點 session 名稱 → 打開該 session

**做法：**
1. 桌面版為每個 session 存一個檔：`%APPDATA%\Claude\claude-code-sessions\<帳號>\<組織>\local_<app 編號>.json`（實測 201 個、共 15 MB），裡面有 `sessionId`（app 編號）與 `cliSessionId`（紀錄檔編號）。掃描時建立「紀錄檔編號 → app 編號」對照。
2. 連結格式：`claude://claude.ai/epitaxy/<app 編號>`（實測 app 提供給本 session 的連結就是這個格式）。
3. 名稱畫成按鈕（不是 `Link`）：型別定義寫明，桌面版這種遠端介面上，`Link` 只接受 `https:` 連結，其他協定會畫成純文字、點不了。按下時用 PowerShell 的 `Start-Process '<連結>'` 交給 Windows 開啟，由桌面版 app 接手（`claude://` 已註冊給 Claude.exe）。實測：`explorer.exe <連結>` 沒有反應；`Start-Process` 讓主視窗從另一個 session 切到目標 session（`get_window_layout` 前後對照）。
4. 找不到 app 編號（例如命令列開的 session）：名稱照常顯示，不可點。

**讀檔方式：** 只讀修改時間在 72 小時（加 1 小時緩衝）內的 app session 檔，檔案都小於 4 MiB，直接用 `$.fs.read` 讀、`JSON.parse` 解析。實測最近 72 小時有 18 個檔，本 session 對應到 `local_aaaaaaaa…`、測試 session 對應到 `local_aaaaaaaa…`，都正確。

### 11.2 commit 快捷按鈕

**按鈕出現的規則：**

| 該列 git 狀態 | 出現的按鈕 |
|---|---|
| 未 commit（有遠端） | 「commit」「commit & push」 |
| 未 commit（無遠端） | 「commit」（沒有遠端，push 一定失敗，不顯示 push） |
| 已 commit、未 push（有遠端） | 「push」 |
| 已 commit、未 push（無遠端） | 無 |
| 已 push、無檔案變更、非 git、資料夾不存在 | 無 |

**複製的文字（固定，按鈕不同只差最後一句）：**

- commit：`（sessions 狀態面板送來的要求）請把你在這個 session 用工具改過的檔案 commit：只 git add 你自己改過的檔案，不要 add 其他 session 的變更；commit 訊息依實際修改內容撰寫。這次不要 push。`
- commit & push：同上，最後一句改成 `commit 完成後，push 到目前分支的遠端。`
- push：`（sessions 狀態面板送來的要求）請把這個 session 已經 commit 的內容 push 到目前分支的遠端；不要 commit 新的變更。`

**做法（方案 1，使用者於 Task 12 後選定）：** 按下按鈕 → 用 PowerShell 一次做兩件事：`Set-Clipboard` 把上面的文字放進剪貼簿，再 `Start-Process` 打開該 session 的 `claude://` 連結 → 使用者在那個 session 按 Ctrl+V、Enter 送出。找不到 app 編號時只複製，不切換。
- 該列顯示：「已複製 commit 要求，已切到該 session：按 Ctrl+V、Enter 送出」（push、commit & push 對應替換）；沒有 app 編號時改成「…請自己打開該 session…」；PowerShell 失敗時顯示「複製或切換失敗，請再按一次」。
- 提示存在本 session 的狀態（不寫進 `$.store`），按「重新整理」清掉。不追蹤對方是否真的 commit 完成。
- **與使用者原本選的「留在面板」不同**：會切到該 session。這是 Task 12 實測後，使用者同意的取捨。
- 實測：中文與單引號的文字經命令列參數傳給 `Set-Clipboard`，讀回剪貼簿逐字相同（測完已還原使用者原本的剪貼簿）。

**收到要求的 session 會怎樣：** 它的 Claude 照一般流程處理，會套用它自己的權限模式與你的 CLAUDE.md 規則；需要核准 git 指令時會停下來等你。

### 11.3 驗證結果（Task 12）

1. **送訊息給其他 session（`$.session.send`）：不可行。** 用紀錄檔編號送，地址正確，但被開面板那個 session 的自動模式安全檢查擋下（「the request that produced this action did not ask for one」）；使用者切成預設權限模式後連試 4 次仍相同。用 app 編號送則回「no live session … has id local_…」，代表送訊息要用紀錄檔編號。測試 session 沒有收到任何訊息。所以改用方案 1。
2. **送給沒在執行的 session 會不會叫醒：** 因為送出前就被擋，無法測；方案 1 不送訊息，這個問題不再存在。
3. **`claude://` 連結切換：可行**（見 §11.1 第 3 點）。
4. **對方看到的文字：** 方案 1 由使用者自己貼上，就是 §11.2 的文字本身。

## 12. v3：自動開啟、/clear、改版與追蹤（2026-10-10～13，使用者已實機確認）

1. **自動開面板**：掛 `session.attach`（surface `desktop`），不放 `session.start`：桌面版的畫面在 session 啟動之後才連上。
2. **/clear（handoff）**：會換新的紀錄檔，新檔不含之前的對話；app 的 `cliSessionId` 改指向新檔。改檔紀錄要合併同一對話所有複本（`familyEdits`）。git 專案裡的實測尚未驗證。
3. **cwd**：只認前面是逗號的 `,"cwd":`；auto mode 另有 `"git_state":{"cwd":"/c/..."}`，會讓複本對不上而變成兩列。
4. **排版**：依開發進度分組（開發中 → 開發暫停 → 開發結束 → 未標記），每列三行：名稱／git 狀態／按鈕（靠右，git 按鈕 → 編輯）；有備註才多一行。狀態選單、備註輸入框、追蹤切換只在按「編輯」後展開。預覽過 A/B/C 與 1/2/3，使用者選了這一種。
5. **追蹤**：`UserEntry.tracked`。回答過照回答；沒回答過的舊資料，標過狀態或寫過備註算追蹤，`hidden: true` 或什麼都沒有的不追蹤。清單預設只列追蹤中的；沒回答過又不算追蹤的 session，在自己的面板頂端問「要追蹤這個 session 嗎？」。
