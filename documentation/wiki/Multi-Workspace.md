# 🗂️ Multi-Workspace Setup

LiveSync supports **multi-root workspaces** — VS Code workspaces that contain more than one folder. Each folder gets its own independent connection and sync configuration.

---

## How It Works

When your workspace has only **one folder**, LiveSync behaves as normal: the diff tree shows that folder's files, and configuration applies to it directly.

When your workspace has **two or more folders**, LiveSync activates a **Workspace Picker** panel in the sidebar, above the diff tree. This panel lists all your workspace folders so you can switch between them and view each one's diffs independently.

Each folder:
- Has its own `.vscode/livesync.json` — connection details and sync settings are completely separate.
- Has its own remote index and diff state.
- Can point to a different server, a different remote path, or use different event rules.

---

## The Workspace Picker

When multi-root mode is active, a second panel called **LiveSync Workspaces** appears in the sidebar. It shows all your workspace folders with a status icon:

| Icon | Meaning |
|---|---|
| ✅ | Config found and connection valid |
| ⚠️ | Config found but there's an error (e.g. bad credentials) |
| 🚫 | No `livesync.json` config found for this folder |

Click on any workspace folder to make it the **active** one. The diff tree will update to show that folder's files, and actions like Upload/Download will apply to it. Your selection is remembered between VS Code sessions.

📸 _Example:_  
![LiveSync Workspaces View](https://github.com/a-gior/LiveSync/raw/main/documentation/screenshots/livesync_multiworkspace_view.png)

---

## Status Bar Health States

In the VS Code status bar, LiveSync also shows a workspace health indicator in the bottom-left corner. Hovering it displays the state of each configured workspace so you can quickly spot which ones are connected correctly and which ones need attention.

📸 _Example:_  
![LiveSync Multi-Workspace Status States](https://github.com/a-gior/LiveSync/raw/main/documentation/screenshots/livesync_multiworkspace_states.png)

---

## Configuring Each Folder

To configure a specific folder:

1. Open the Command Palette → **LiveSync: Configure Workspace**.
2. LiveSync will ask you to pick which folder to configure.
3. Fill in the connection details and save.

Each folder stores its config in its own `.vscode/livesync.json`, so the files don't interfere with each other.

---

## Refreshing All Workspaces

In the **LiveSync Workspaces** view toolbar, the ![Refresh all icon](./assets/codicons/sync.svg) **Refresh All** button appears when multi-root mode is active. It refreshes the diff view for every configured workspace folder at once.

To refresh a single folder, select it in the Workspace Picker first and then use the regular **Refresh** button.

---

## Adding or Removing Folders

If you add a new folder to your workspace while LiveSync is running, it will automatically appear in the Workspace Picker. If the folder already has a `.vscode/livesync.json`, LiveSync will validate it immediately and update the status icon.

Removing a folder from the workspace clears it from the Workspace Picker and its sync state is discarded.

---

## Tips

- A folder with no `livesync.json` is shown with a 🚫 icon but doesn't cause any errors — LiveSync simply ignores it until you configure it.
- You don't need all folders to connect to the same server. Each can point anywhere.
- The `livesync.remoteIndex.autoRefreshInterval` setting applies to all configured workspace folders independently.
