# ❓ Frequently Asked Questions (FAQ)

Common questions about LiveSync. If your question isn't here, open an [issue on GitHub](https://github.com/a-gior/LiveSync/issues).

---

## 🔹 How do I configure LiveSync?

Open the Command Palette (`Ctrl+Shift+P`) and run **LiveSync: Configure Workspace**, or click the LiveSync icon in the status bar. You can also edit `.vscode/livesync.json` manually.

See [⚙️ Configuration](https://github.com/a-gior/LiveSync/wiki/%E2%9A%99%EF%B8%8FConfiguration) for full details.

---

## 🔹 What authentication methods are supported?

- **Password** – Enter your SSH username and password.
- **SSH Key** – Leave the password blank and point `privateKeyPath` to your private key file.

See [🔐 SSH Key Authentication](https://github.com/a-gior/LiveSync/wiki/%F0%9F%94%90-Using-SSH-Key-Authentication) for a step-by-step guide.

---

## 🔹 What's the difference between `check`, `check&save`, and `save`?

- `save` – Uploads immediately with no questions asked.
- `check` – Checks for a conflict and shows a notification, but does **not** transfer anything.
- `check&save` – Checks for a conflict first; if one is detected, asks you what to do before uploading.

See [⚡ Event Handling](https://github.com/a-gior/LiveSync/wiki/%E2%9A%A1Event-Handling-&-Sync-Configuration) for all available actions.

---

## 🔹 What happens when a conflict is detected?

A dialog appears showing what the conflict is (e.g. "Remote file was modified") with these options:

- **Proceed** – Go ahead with the operation
- **Show Diff** – Compare local and remote before deciding
- **Ignore** – Proceed without the conflict check
- **Cancel** – Abort

The dialog auto-cancels after 15 seconds if you don't respond, so it won't block your workflow.

---

## 🔹 How do I exclude files or folders from sync?

Add patterns to `ignoreList` in `.vscode/livesync.json`:

```json
"ignoreList": [".git", "node_modules", "*.log", "dist/"]
```

These use glob syntax. Ignored files are never uploaded, downloaded, or shown as differences.

---

## 🔹 Can I manually upload or download?

Yes. Use:

- **Right-click in the Explorer** → Upload / Download
- **LiveSync Tree View** → Use the inline icons
- **Command Palette** (`Ctrl+Shift+P`) → search for LiveSync commands

---

## 🔹 Can I sync my entire workspace at once?

Yes. In the **Tree View toolbar**, use the upload or download workspace buttons to bulk-sync everything. Only files that differ from the remote are transferred.

---

## 🔹 Can I delete files on the remote?

Yes, but remote deletion is controlled by `actionOnDelete`.

Set `actionOnDelete` to `delete` or `check&delete` in your LiveSync config. Once enabled, deleting a file locally can propagate that deletion to the remote, and the **Delete** action in the **Tree View** uses the same delete flow.

If `actionOnDelete` is `none` or `check`, LiveSync will not delete the remote file.

---

## 🔹 What is the "base" index used for?

LiveSync maintains three indexes: **local**, **remote**, and **base**. The base index records the remote state that LiveSync last confirmed through its own actions, such as uploading, downloading, or deleting a file. In other words, it tracks the last known remote version of the files LiveSync interacted with, so conflict detection can tell when the remote changed afterward and warn you before an action would overwrite those changes.

---

## 🔹 How do I keep the remote index up to date?

The remote index is updated immediately for any file LiveSync interacts with through an event or command, such as upload, download, delete, or conflict checks. For other files, LiveSync refreshes the remote index by scanning the server in the background based on `livesync.remoteIndex.autoRefreshInterval` (default: every 10 minutes). You can also trigger a full refresh manually from the Tree View or via the Command Palette: **LiveSync: Refresh Remote Index**.

---

## 🔹 Where are the logs?

Open the Command Palette and run **LiveSync: Show Logs**. You can also open the **Output** tab next to **Debug Console** and **Terminal**, then select **LiveSync** from the dropdown. The output panel shows connection events, file operations, and error details.

---

## 🔹 LiveSync isn't working as expected. What should I try?

1. Run **LiveSync: Show Logs** to check for errors.
2. Run **LiveSync: Test Connection** to verify your SSH connection.
3. Check that `.vscode/livesync.json` exists and is correctly filled in.
4. Try **LiveSync: Refresh Remote Index** to force a fresh scan of the remote.
5. Restart VS Code if changes aren't taking effect.

---

## 💬 Still need help?

Open an [issue on GitHub](https://github.com/a-gior/LiveSync/issues) and describe what's happening. 🚀
