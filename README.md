# session-status-panel

English: A Claude Code mod with a side panel listing the sessions you used in the last 72 hours, grouped by manual status, with git state and notes. It opens automatically; each session asks once whether to track it. Traditional Chinese UI only for now; English is on the to-do list.

右側面板：列出最近 72 小時用過的 session，依開發進度分組，顯示 git 狀態與備註。開 session 時自動開啟，也可以用 `/sessions` 開啟。

新的 session 預設不追蹤，會在它自己的面板頂端問「要追蹤這個 session 嗎？」；按「追蹤」才會出現在清單上。狀態、備註、追蹤要按每列的「編輯」才會展開。

## 選配：在 cache-meter 加「sessions 狀態」按鈕

如果你也裝了 [cache-meter](https://github.com/ELSKKR/cache-meter)，可以套用 `patches/cache-meter-sessions-button.patch`，在它的那一列加一顆按鈕：

```bash
cd ~/.claude/mods/cache-meter
patch -p1 < ~/.claude/mods/session-status-panel/patches/cache-meter-sessions-button.patch
```

套用前請先備份 cache-meter。

## 安裝

1. 下載到 Claude Code 的 mods 資料夾：

```bash
git clone https://github.com/ELSKKR/session-status-panel.git ~/.claude/mods/session-status-panel
```

2. 在 `~/.claude/settings.json` 的 `CLAUDE_CODE_PLUGIN_DIRS` 加入這個資料夾路徑（會長期保留的設定，改之前請先備份）。
3. 重新開一個新 session。

驗證：`claude plugin test ~/.claude/mods/session-status-panel`

## 授權

MIT
