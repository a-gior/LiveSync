# ⚡ Event Handling & Sync Configuration

LiveSync lets you define exactly what should happen when you interact with files — save, create, delete, move, or open. Each event can be configured independently.

---

## 📋 Available Events

| Event | When it triggers |
|---|---|
| `actionOnSave` | A file is saved locally |
| `actionOnCreate` | A new file or folder is created locally |
| `actionOnDelete` | A file or folder is deleted locally |
| `actionOnMove` | A file or folder is renamed or moved locally |
| `actionOnOpen` | A file is opened in the editor |
| `actionOnUpload` | You manually trigger an upload from the tree view or explorer |
| `actionOnDownload` | You manually trigger a download from the tree view or explorer |

---

## ⚙️ Available Actions

Each setting accepts `none` or `check`, plus the action that matches that event:

| Event | Valid values |
|---|---|
| `actionOnSave` | `none`, `check`, `save`, `check&save` |
| `actionOnCreate` | `none`, `check`, `create`, `check&create` |
| `actionOnDelete` | `none`, `check`, `delete`, `check&delete` |
| `actionOnMove` | `none`, `check`, `move`, `check&move` |
| `actionOnOpen` | `none`, `check`, `download`, `check&download` |
| `actionOnUpload` | `none`, `check`, `upload`, `check&upload` |
| `actionOnDownload` | `none`, `check`, `download`, `check&download` |

| Value | What it does |
|---|---|
| `none` | Ignore the event |
| `check` | Only check for a conflict — no sync action is performed |
| `<action>` | Perform the matching action immediately, with no conflict check |
| `check&<action>` | Check for a conflict first — if one is found, ask before proceeding |

> **Tip:** `check&...` is the safest choice for most events. If you do not want deletions to propagate automatically, use `none` for `actionOnDelete`.

---

## ⚠️ Conflict Detection

When a `check&` action detects a potential conflict, a dialog appears with the conflict details and the following options:

- **Proceed** – Go ahead with the operation anyway
- **Show Diff** – Open a side-by-side diff to review the differences (when available)
- **Ignore** – Skip the conflict check and proceed silently
- **Cancel** – Abort the operation

The dialog times out automatically after **15 seconds** and cancels.

### What counts as a conflict?

- **Uploading/Saving** → The remote file was modified since your last sync
- **Downloading** → Your local file was modified since your last sync
- **Creating** → A file with the same name already exists on the remote
- **Deleting** → The remote file was modified since your last sync
- **Moving** → The destination already exists on the remote
- **Opening** → The remote file differs from the local one

---

## 🛠️ How to Configure

### Option 1: Configuration Panel

1. Open the Command Palette (`Ctrl+Shift+P`) and run **LiveSync: Configure Workspace**.
2. Go to the **File Event Actions** section.
3. Select the desired action for each event from the dropdowns.
4. Click **Save**.

📸 _Example:_  
![Configuration Panel - File Events](https://github.com/a-gior/LiveSync/raw/main/documentation/screenshots/configuration_panel_file_events.png)

### Option 2: Edit `.vscode/livesync.json` directly

```json
{
  "actionOnSave": "check&save",
  "actionOnCreate": "check&create",
  "actionOnDelete": "none",
  "actionOnMove": "check&move",
  "actionOnOpen": "check&download",
  "actionOnUpload": "check&upload",
  "actionOnDownload": "check&download"
}
```

---

## 💡 Recommended Settings

If you want to stay safe but avoid too many interruptions:

```json
{
  "actionOnSave": "check&save",
  "actionOnCreate": "check&create",
  "actionOnDelete": "none",
  "actionOnMove": "check&move",
  "actionOnOpen": "check&download",
  "actionOnUpload": "check&upload",
  "actionOnDownload": "check&download"
}
```

If you want fully automatic sync with no prompts:

```json
{
  "actionOnSave": "save",
  "actionOnCreate": "create",
  "actionOnDelete": "none",
  "actionOnMove": "move",
  "actionOnOpen": "download",
  "actionOnUpload": "upload",
  "actionOnDownload": "download"
}
```

---

## 🔗 Related Pages

- [⚙️ Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%99%EF%B8%8FConfiguration)
- [📂 Using the Tree View](https://github.com/a-gior/LiveSync/wiki/%F0%9F%93%82-Using-the-Tree-View)
