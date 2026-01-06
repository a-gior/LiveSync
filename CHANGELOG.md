# 📢 LiveSync Changelog

All notable changes to this project will be documented in this file.


## [1.1.1] - Improved Migration from v1.0.9 to v1.1.x 🛠️

### Fixed
- Fixed extension failing to activate after upgrading and restarting
- Added window reload prompt after migration to ensure new views load correctly
- Added timeout handling to migration prompts to prevent activation from hanging

## [1.1.0] - Complete Architecture Overhaul 🏗️⚡

### 🎉 Major Changes

- **Complete code rewrite** from scratch with clean hexagonal architecture for better maintainability and testability
- **Multi-workspace support** — Each workspace folder can now have its own independent LiveSync configuration
- **Configuration migration** — Settings automatically moved from `.vscode/settings.json` to `.vscode/livesync.json` on first activation (no manual action required)
- **Comprehensive test suite** — 395+ automated tests (unit, integration, E2E) ensuring stability and reliability

### 🎨 UI Improvements

- **Enhanced status bar** — Three status items showing config, notifications, and real-time progress
- **Auto-refresh on tree updates** — Differences refresh automatically when files change

### 🎯 Enhanced Features

- **Interactive conflict resolution** — Smart detection with three resolution options (download, upload, ignore)
- **Check-only mode** — New `check` action mode that detects conflicts and informs without taking action
- **Persistent conflict ignore list** — Suppress warnings for specific files you don't want to sync

### 🔧 Revamped New VSCode Settings (removed old ones)

- `livesync.openMode` — Choose how configuration opens (prompt, UI panel, or JSON file)
- `livesync.refreshOnConfigSave` — Auto-refresh differences after saving configuration
- `livesync.statusBar.visibleItems` — Control which status bar items are shown
- `livesync.index.concurrency` — Configure parallel hashing workers (1-32)

### 🐛 Fixed

- Event deduplication preventing race conditions between VS Code events and FileSystemWatcher
- Cache persistence file locking during rapid file saves
- Memory leaks from improper event listener cleanup
- Numerous edge cases with empty directories, symlinks, and special characters

### 💡 Improvements

- Better error messages with actionable suggestions and links to documentation
- Enhanced logging with detailed operation traces and performance metrics
- Real-time configuration validation with helpful error messages
- Improved network error handling with automatic connection recovery
- More consistent and reliable sync state management

## [1.0.9] - Tree Commands & Sync State Update 🛠️

### Fixed
- Tree view actions now only show the right commands for each file or folder based on its status. 
- Remote sync state is saved more reliably—no more phantom “changes detected” alerts or unexpected pop-ups.  
- Status now accurately reflect what happened locally and on the server, eliminating mismatches in the comparison tree.

### Added
- New “Delete” option for folders that have been added or removed, letting you clean up entire directories right from the tree.  

## [1.0.8] - Move & Rename Fix 🛠️

### Fixed
- Files and folders that are moved or renamed are properly handled.

## [1.0.7] - File Node Comparison Fix & Enhancements 🛠️

### Fixed
- Fix file-nodes comparison logic so that children are always included and statuses correctly propagated in recursive comparisons. :contentReference
- Fix status-bar message output to display accurate sync progress and error indicators. 

## [1.0.6] - Workspace Warning ⚠️

### Added
- Warning displayed when opening a multi-root workspace to indicate that only single-root workspaces are currently supported (multi-root support coming in v1.1.0)

## [1.0.5] - Stability & UI Improvements 🛡️✨

### Fixed
- Renaming or moving files and folders now correctly updates their status and synchronizes changes  
- Creating or deleting a folder now triggers sync as expected  
- No error was shown on extension startup if configuration was invalid; now a clear message appears when connection details are wrong  
- Configuration panel now opens properly with prefilled parameters 

### Improvements
- Sync events and commands are now processed sequentially, preventing conflicts during rapid changes  
- Status bar now shows clearer messages with progress during sync operations  
- Faster local scanning

## [1.0.4] - Performance & Status Fixes 🏎️

### Improvements

Significantly faster local file listing that skips ignored folders and shows real-time progress in the status bar

LiveSync tree now updates file statuses immediately when files are saved or other events occur

## [1.0.3] - Editor Integration & Tree View Improvements ✨

### Added
- Commands to Upload, Download, Show Diff and Refresh directly from the editor’s right-click menu  
- Delete actions for new or removed files in the LiveSync tree view  
- “Expand Changed” command to expand all files and folders with differences at once  
- “Don’t show again” option on the configuration-warning popup when LiveSync isn’t set up  
- Open files in the editor by clicking them in the LiveSync tree view  

### Changed
- Folder status now marked **unchanged** only if **all** children are unchanged; otherwise marked **modified**  
- Tree view now refreshes individual files and folders reliably, including root-level files on save  

### Fixed
- Inconsistent ordering of items in the tree view  
- Status not updating correctly after renaming or moving files  

### Improvements
- Much faster comparisons for large directories  
- SSH listing skips “Permission denied” paths without aborting the operation  
- Clear informational messages during loading and when no differences are found  

## [1.0.2] - Docs & Ignore Logic Fix 📚🛠

### 📚 Documentation

- Major improvements to the README for clarity, quickstart, and usability.
- Better explanation of the Tree View, configuration panel, and common actions.

## [1.0.1] - Improved Ignore Logic 🧹

### 🛠 Fixes & Improvements

- Improved folder ignore behavior: folders added to the ignore list now properly exclude all subfiles and subfolders.
- Glob patterns still work as expected — this update just improves plain folder-name handling.

---

## [1.0.0] - Initial Release 🚀

### 🎉 Features

- **Real-time Synchronization** → Keep your local and remote folders in sync.
- **Tree View with Diff Status** → See changes at a glance with file status indicators.
- **Customizable Event Actions** → Configure how file events (create, save, delete, move, etc.) are handled.
- **Explorer Context Menu Integration** → Right-click files/folders in the VS Code Explorer to sync manually.
- **Webview Configuration Panel** → Easily configure LiveSync settings via an intuitive UI.
- **File Ignoring via Patterns** → Define glob patterns to exclude specific files/folders from sync.
- **Commands in Explorer & Tree View** → Right-click menu options or use icons to:
  - **Upload** or **Download** files and folders.
  - **Refresh differences** in the tree view.
  - **Show diff** between local and remote files.

### 🛠 Improvements & Fixes

- Optimized SFTP/SSH connection handling.
- Improved performance for large folders.
- Enhanced logging for better debugging.

---

📌 **Got feedback or found a bug?**  
Report it here: [GitHub Issues](https://github.com/a-gior/LiveSync/issues)
