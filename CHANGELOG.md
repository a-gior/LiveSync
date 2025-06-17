# 📢 LiveSync Changelog

All notable changes to this project will be documented in this file.

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

## 🗺️ Future Plans

- Fixing potential bugs and improving stability.
- Listening to user feedback to refine and enhance the extension.

---

📌 **Got feedback or found a bug?**  
Report it here: [GitHub Issues](https://github.com/a-gior/LiveSync/issues)
