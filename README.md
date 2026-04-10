# LiveSync

**LiveSync** is a Visual Studio Code extension that lets you **instantly sync your local workspace with a remote folder over SSH/SFTP** — with **real-time difference tracking**, **conflict detection**, **customizable sync events**, and an **intuitive visual interface**.

It's perfect for developers working with remote servers or any SSH-accessible machine.  
No more manual uploads, terminal back-and-forth, or wondering if a file is out of sync.

---

## ⚡ Features at a Glance

- 🟢 **Live Difference View** – Visualize what's changed between local and remote at a glance.
- 🔁 **Two-Way Sync Options** – Choose whether to sync on file create, save, delete, move, etc.
- ⚙️ **Flexible Event Rules** – Set each event to trigger `check`, `upload`, `download`, or do nothing.
- ⚠️ **Conflict Detection** – Automatically warns when uploading/downloading could overwrite changes on either side.
- 📂 **Folder & File Sync** – Manually upload/download files, entire directories, or the whole workspace.
- 🗑️ **Remote Delete** – Delete files or folders on the remote directly from the tree view.
- 🧩 **Ignore Patterns** – Use glob-style rules to exclude `node_modules`, `.git`, etc.
- 🖱️ **Context Menu Integration** – Sync directly from the file explorer via right-click.
- 🌲 **Tree/List Views** – Choose how to visualize and act on changed files.
- 🎛️ **Visual Configuration Panel** – Set up without touching JSON files (but you still can).
- 🎨 **Multi-Workspace** – Independent configs per workspace folder.

---

## 🚀 Quick Start

### 1. Install the Extension

- Open **VS Code**
- Go to **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`)
- Search for **LiveSync**
- Click **Install**

### 2. Set Up Your Connection

- Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Run: `LiveSync: Configure Workspace`
- Fill in your SSH/SFTP info
- Click **Test Connection** → then **Save**

📸 _Example:_  
![LiveSync Configuration Panel](./documentation/screenshots/configuration_panel_remote_server.png)

### 3. Start Syncing

- Open the **LiveSync Tree View** in the sidebar
- Right-click a file or folder → **Upload**, **Download**, **Show Diff**, or **Delete**
- Toggle between tree/list view, hide unchanged files, or refresh diffs

📸 _Example:_  
![LiveSync Tree View](./documentation/screenshots/tree_view_folder_unchanged.png)

---

## ⚙️ Configuration Options

LiveSync is configured per workspace folder, either through a visual interface or a dedicated JSON file.

### Option 1: Use the Configuration Command (Recommended)

The configuration panel is the easiest way to get started — no need to edit files manually.

**How to access it:**

- Open the Command Palette → `LiveSync: Configure Workspace`
- Or click the **LiveSync icon** in the status bar (bottom-left corner)

📸 _Example:_  
![LiveSync Status Bar Icon](./documentation/screenshots/status_bar_livesync_config.png)

If you are working in a **multi-root workspace**, LiveSync will first ask you to select the workspace folder you want to configure.

After that, LiveSync will open either:
- the visual configuration panel (webview), or
- the raw configuration file (`.vscode/livesync.json`)

This behavior is controlled by the VS Code setting `livesync.openMode`:
- `prompt` – ask each time (default)
- `ui` – always open the visual panel
- `json` – always open the JSON file directly

---

### Option 2: Manual `.vscode/livesync.json` Setup

LiveSync stores its workspace configuration in `.vscode/livesync.json`. You can create or edit it manually:

```json
{
  "hostname": "your.server.com",
  "port": 22,
  "username": "your-username",
  "password": "your-password",
  "privateKeyPath": "/path/to/private/key",
  "passphrase": "",
  "remotePath": "/remote/path/to/sync",

  "actionOnSave": "check&save",
  "actionOnCreate": "check",
  "actionOnDelete": "check",
  "actionOnMove": "check&move",
  "actionOnOpen": "check&download",
  "actionOnUpload": "check&upload",
  "actionOnDownload": "check&download",

  "ignoreList": [
    ".vscode",
    ".svn",
    ".git"
  ]
}
```

### VS Code Extension Settings

These settings live in your VS Code user or workspace settings (not `livesync.json`):

| Setting | Default | Description |
|---|---|---|
| `livesync.openMode` | `prompt` | How `Configure Workspace` opens: `prompt`, `ui`, or `json` |
| `livesync.refreshOnConfigSave` | `true` | Auto-refresh differences after saving a config file |
| `livesync.remoteIndex.autoRefreshInterval` | `10` | How often (in minutes) to refresh the remote index in the background |
| `livesync.statusBar.visibleItems` | `[messages, permanent, progress, errors]` | Which status bar items to show |
| `livesync.index.concurrency` | `4` | Number of parallel operations during indexing |
| `livesync.view.recentlyResolvedRetentionMs` | `800` | How long (ms) a just-resolved item stays visible before disappearing |

---

## 🌳 Tree View Features

LiveSync's Tree View helps you **visualize and manage file differences** between local and remote folders.

### File Status Icons

| Icon | Status | Description |
|---|---|---|
| **A** | Added | File exists locally only |
| **M** | Modified | File exists on both sides but content differs |
| **U** | Unchanged | File is identical on both sides |
| **R** | Removed | File exists on remote only |

### Available Actions

- **📄 View Diffs** – Click a file to see the local vs. remote difference
- **⬆ Upload / ⬇ Download** – Right-click files or folders to sync manually
- **⬆⬆ Upload Workspace / ⬇⬇ Download Workspace** – Bulk sync the entire workspace
- **🗑️ Delete** – Remove a file or folder from the remote
- **🔄 Refresh Differences** – Re-scan the current project to update the diff view
- **📁 Tree vs. List View** – Choose how you browse files (hierarchical or flat)
- **👁 Hide/Show Unchanged Files** – Clean up the view for faster triaging
- **📉 Collapse All** – Quickly collapse the entire folder tree

---

## 🗂️ Multi-Workspace Support

LiveSync supports **multi-root workspaces** — VS Code workspaces with more than one folder open at the same time.

When you have multiple folders, a **Workspace Picker** panel appears in the sidebar. Each folder:
- Has its own independent `.vscode/livesync.json` (separate server, separate remote path, separate sync rules)
- Shows a status icon: ✅ connected, ⚠️ config error, 🚫 no config

Click a folder in the Workspace Picker to make it active — the diff tree updates to show that folder's files. Your selection is remembered between sessions.

The **Refresh All** button in the Tree View toolbar refreshes every configured workspace at once.

---

## ⚠️ Conflict Detection

When an action could overwrite changes, LiveSync warns you before proceeding. A dialog appears with the conflict details and options:

- **Proceed** – Go ahead with the operation
- **Show Diff** – Open a side-by-side diff first (when applicable)
- **Ignore** – Skip this check and proceed silently
- **Cancel** – Abort the operation

Conflicts are detected for all operations: save, create, delete, move, open, upload, and download. For example:
- Uploading a file when the **remote was modified** since your last sync
- Downloading a file when your **local copy was modified** since your last sync
- Creating a file when it **already exists** on the remote

The dialog times out after 15 seconds and automatically cancels to avoid blocking the queue indefinitely.

---

## 💡 Tips & Troubleshooting

- Works best with stable SSH/SFTP connections (slow networks may cause delays)
- You can mix event-based and manual sync as needed
- If something isn't syncing right, check the **Output Panel**: run `LiveSync: Show Logs` from the Command Palette
- Use `LiveSync: Refresh Remote Index` to manually force a fresh scan of the remote server

---

## 📣 Contribute or Report Issues

Found a bug or have a feature idea?  
Open an issue on GitHub: [LiveSync Issues](https://github.com/a-gior/LiveSync/issues)

---

## 📌 License

This extension is licensed under the GPL-3 License.  
See [LICENSE](./LICENSE) for details.

---
