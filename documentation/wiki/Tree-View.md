# 📂 Using the Tree View

The LiveSync Tree View shows you the **sync state of every file and folder** in your workspace compared to the remote server. From here you can upload, download, delete, compare, and refresh — without leaving VS Code.

---

## 🖥️ Opening the Tree View

The Tree View appears automatically in the **Explorer Panel** once LiveSync is installed and configured.

If it's not visible:

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **View: Open View...**.
3. Find **LiveSync** in the list and click it.

📸 _Example:_  
![LiveSync Tree View](https://github.com/a-gior/LiveSync/raw/main/documentation/screenshots/tree_view_folder_unchanged.png)

---

## 🔍 Understanding File Statuses

Each entry in the tree view shows a status badge:

| Badge | Status | What it means |
|---|---|---|
| **A** | Added | File exists locally, not on the remote |
| **M** | Modified | File exists on both sides but the content differs |
| **U** | Unchanged | File is identical on both sides |
| **R** | Removed | File exists on the remote, not locally |

> Empty folders are also shown and can be uploaded or downloaded.

---

## ⚡ Actions

### File actions (right-click a file)

| Action | Description |
|---|---|
| **Upload** | Send the local file to the remote server |
| **Download** | Fetch the remote file and replace the local one |
| **Show Diff** | Open a side-by-side comparison of local vs. remote |
| **Delete** | Delete the file using the `actionOnDelete` policy |

Upload and download respect the `actionOnUpload` / `actionOnDownload` settings — if those are set to `check&`, a conflict check runs first.

Delete respects `actionOnDelete`. Set it to `delete` or `check&delete` if you want deletions to propagate to the remote.

### Folder actions (right-click a folder)

| Action | Description |
|---|---|
| **Upload Folder** | Upload all files in the folder to the remote |
| **Download Folder** | Download all files in the folder from the remote |
| **Delete Folder** | Delete the folder using the `actionOnDelete` policy |
| **Refresh Differences** | Re-scan this folder localy and remotely and update the diff view |

Folder upload/download only transfers files that are not already **Unchanged** — identical files are skipped.

### Toolbar actions

#### LiveSync Diffs toolbar (top of the Tree View)

| VS Code button | Action |
|---|---|
| ![Eye icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/eye.svg) | Toggle Show/Hide Unchanged Files |
| ![Refresh icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/refresh.svg) | Refresh the current workspace diff |
| ![Upload workspace icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/repo-push.svg) | Upload the entire current workspace |
| ![Download workspace icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/repo-pull.svg) | Download the entire current workspace |
| ![List view icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/list-flat.svg) / ![Tree view icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/list-tree.svg) | Switch between Tree View and List View. The button changes based on the current mode. |

#### LiveSync Workspaces toolbar (multi-root only)

| VS Code button | Action |
|---|---|
| ![Refresh all icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/sync.svg) | Refresh all workspace diffs |

---

## 🔄 Refreshing

LiveSync keeps a local and remote index to calculate differences efficiently. You can refresh in several ways:

- **Refresh** (![Refresh icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/refresh.svg)) – Re-scans the current workspace and updates all diffs.
- **Refresh All** (![Refresh all icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/sync.svg)) – Same but for all workspace folders from the **LiveSync Workspaces** view (multi-root only).
- **Refresh Remote Index** – Forces a fresh scan of the remote server. Useful when files were changed on the server directly. Run it from the Command Palette: `LiveSync: Refresh Remote Index`.

You can also set the remote index to auto-refresh in the background using the `livesync.remoteIndex.autoRefreshInterval` setting (in minutes).

---

## 🌲 Tree View vs. List View

- **Tree View** – Shows files in a hierarchical folder structure. Great for navigating large projects.
- **List View** – Shows all changed files in a flat list. Great for quickly seeing everything that's out of sync.

Switch between them using the ![List view icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/list-flat.svg) or ![Tree view icon](https://github.com/a-gior/LiveSync/raw/main/documentation/wiki/assets/codicons/list-tree.svg) button in the toolbar.

---

## 🔗 Related Pages

- [⚡ Event Handling & Sync Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration)
- [🖱️ Explorer Context Menu Commands](https://github.com/a-gior/LiveSync/wiki/%F0%9F%96%B1%EF%B8%8F-Explorer-Context-Menu-Commands)
