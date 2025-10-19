import { workspace, ExtensionContext, WorkspaceFolder, Uri, window, commands } from "vscode";
import * as path from 'path';
import { logErrorMessage, logInfoMessage } from "./LogManager";
import { CONFIG_FILE_NAME, DEFAULT_WORKSPACE_CONFIG } from "../utilities/constants";
import { FileNodeSource } from "../utilities/FileNode";
import { normalizePath, PathPair } from "../utilities/fileUtils/filePathUtils";
import { StatusBarManager } from "./StatusBarManager";
import { refreshDifferences } from "../utilities/fileUtils/fileDiff";
import { WorkspaceConfig } from "../services/WorkspaceConfig";
import { WorkspaceEventsManager } from "./WorkspaceEventsManager";
import { handleConfigError, WorkspaceConfigError } from "../errors/WorkspaceConfigError";

export enum WorkspaceType {
    SingleRoot,
    MultiRoot,
}

export function getConfigPath(folder: WorkspaceFolder): Uri {
    return Uri.joinPath(folder.uri, '.vscode', CONFIG_FILE_NAME);
}

export class WorkspaceConfigManager {

    private _context: ExtensionContext;
    private _workspaceType: WorkspaceType | null = null;
    private _workspaceConfigs: Map<string, WorkspaceConfig> = new Map();
    private _pathsByHost     = new Map<string, Set<string>>();
    private _events: WorkspaceEventsManager;
    
    constructor(context: ExtensionContext) {
        this._context = context;
        this.detectWorkspaceType();

        this._events = new WorkspaceEventsManager();
        this._context.subscriptions.push(this._events);

        // Folder added
        this._events.onFolderAdded(folder => {
            this.safeLoadConfigAction(folder, async () => {
                await this.loadConfig(folder);
                refreshDifferences(folder);
            });
        });

        // Folder removed
        this._events.onFolderRemoved(folder => {
            this.removeConfig(folder.uri);
        });

        // Config created
        this._events.onConfigCreated(uri => {
            this.safeLoadConfigAction(uri, async folder => {
                await this.loadConfigByUri(folder.uri);
                refreshDifferences(folder);
            });
        });

        // Config changed
        this._events.onConfigChanged(uri => {
            this.safeLoadConfigAction(uri, async folder => {
                this.removeConfig(folder.uri);
                await this.loadConfigByUri(folder.uri);
                await refreshDifferences(folder);
            });
        });

        // Config deleted
        this._events.onConfigDeleted(uri => {
        this.removeConfigForUri(uri);
        });
    }

    private async safeLoadConfigAction(
        target: Uri | WorkspaceFolder,
        action: (folder: WorkspaceFolder) => Promise<void>
    ) {
        const folder = target instanceof Uri ? workspace.getWorkspaceFolder(target) : target;
        if(!folder) {
            logErrorMessage(`No workspace folder found for ${target instanceof Uri ? target.fsPath : 'no uri'}`);
            return;
        }

        await action(folder).catch(err => {
            const where = folder?.uri.fsPath ?? folder?.uri.toString() ?? 'no workspace folder';
            // Last arg 'true' preserved from your original
            try {
                handleConfigError(err, where, true);
            } catch (e) {
                // Fall back to console to avoid unhandled rejection
                console.error('WorkspaceConfigManager error:', err);
            }
        });
    }

    private set workspaceType(type: WorkspaceType) {
        this._workspaceType = type;
        commands.executeCommand('setContext', 'livesync.multiRoot', type === WorkspaceType.MultiRoot );
    }

    public get workspaceConfigs(): Map<string, WorkspaceConfig> {
        return this._workspaceConfigs;
    }

    private async _processFolder(folder: WorkspaceFolder): Promise<void> {
        this.detectWorkspaceType();

        const configUri = getConfigPath(folder);
        try {
            await workspace.fs.stat(configUri);
        } catch {
            StatusBarManager.markErrored(folder.uri.fsPath.toString(), 'No config found');
            return;
        }

        // As long as the config exists, we create and register it
        let instance: WorkspaceConfig;
        try {
            instance = await WorkspaceConfig.create(folder);
        } catch (err: any) {
            logErrorMessage(`Failed to read/parse config for ${folder.name}: ${err.message || err}`);
            return;
        }
        this._registerConfig(folder, instance);

        if (!instance.isValid) {
            throw new WorkspaceConfigError(folder, `Invalid Config - ${instance.error}`);
        }

        try {
            await instance.connectionService.ensureReachable();
        } catch (err: any) {
            instance.error = `${err.message}`;
            throw new WorkspaceConfigError(folder, `${err.message}`);
        }
        
    }

    public async loadConfig(folder: WorkspaceFolder): Promise<void> {
        await this._processFolder(folder);
    }

    public async loadConfigs(): Promise<void> {
        for (const folder of workspace.workspaceFolders ?? []) {
            try {
                await this.loadConfig(folder);
            } catch (err: any) {
                StatusBarManager.markErrored(folder.uri.fsPath.toString(), err.message);
            }
        }
    }

    /**
     * Given a Uri to a config JSON, find its workspace folder and load it.
     */
    public async loadConfigByUri(uri: Uri): Promise<void> {
        const folder      = workspace.getWorkspaceFolder(uri);
        if (!folder) {
            logErrorMessage(`No workspace folder found for config at ${uri.fsPath}`);
            return;
        }
        await this.loadConfig(folder);
    }
    
    /**
     * Returns true if cfg was added, false if it conflicted and was skipped.
     * Logs a config‐error on conflict.
     */
    private _registerConfig(folder: WorkspaceFolder, cfg: WorkspaceConfig) {
        const host = cfg.connectionSettings!.hostname;
        const remotePath   = cfg.remotePath!.trim();

        let set = this._pathsByHost.get(host);
        if (!set) {
            set = new Set<string>();
            this._pathsByHost.set(host, set);
        }

        for (const existing of set) {
            if( existing === "") {continue;}
            
            if(existing === remotePath || remotePath.startsWith(existing + '/') || existing.startsWith(remotePath + '/')) {
                throw new WorkspaceConfigError(folder, 
                    `Conflict - "${folder.name}" remote path conflicts with an existing config`);
            }
        }

        // no conflicts → register
        set.add(remotePath);
        this._workspaceConfigs.set(folder.uri.fsPath, cfg);
        logInfoMessage(`Registered config for "URI: ${folder.uri}, ${folder.name}" → host=${host}, remotePath=${remotePath}`);
    }

    /** Remove a folder’s config by its URI string key */
    public removeConfig(uri: Uri): void {
        this.detectWorkspaceType();

        const cfg = this._workspaceConfigs.get(uri.fsPath);
        if(!cfg) {return;}

        const host = cfg.connectionSettings!.hostname;
        let rp   = cfg.remotePath!.trim();
        const set = this._pathsByHost.get(host);
        if (set) {
            set.delete(rp);
            // if no more paths for this host, drop the host entry altogether
            if (set.size === 0) {
                this._pathsByHost.delete(host);
            }
        }

        this._workspaceConfigs.delete(uri.fsPath);
        logInfoMessage(`Removed config for folder ${uri.fsPath}`);
    }

    /**
     * Remove a config based on the config-file Uri.
     * Derives the folder, then drops its entry.
     */
    public removeConfigForUri(uri: Uri): void {
        const folder      = workspace.getWorkspaceFolder(uri);
        if (!folder) {
           logErrorMessage(`No workspace folder found for ${uri.fsPath}`);
           return;
        }
        this.removeConfig(folder.uri);
    }

    detectWorkspaceType() {
        const folders: readonly WorkspaceFolder[] | undefined = workspace.workspaceFolders;
        const wsFile: Uri | undefined = workspace.workspaceFile;

        if (!folders) {
           throw new Error("No workspace is open at all.");
        }

        // 1. Single-folder (just one folder, no .code-workspace file)
        if (folders.length === 1 && !wsFile) {
            this.workspaceType = WorkspaceType.SingleRoot;
            logInfoMessage(`Detected single-folder workspace: ${folders[0].uri.fsPath}`);
            return;
        }

        // 2. Multi-root untitled (you added folders at runtime, VS Code created an in-memory “Untitled” workspace)
        if (wsFile?.scheme === 'untitled') {
            this.workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Detected untitled multi-root workspace with ${folders.length} folders`);
            return;
        }

        // 3. Multi-root saved (you opened a .code-workspace file from disk)
        if (wsFile?.scheme === 'file' && wsFile.fsPath.endsWith('.code-workspace')) {
            this.workspaceType = WorkspaceType.MultiRoot;
            logInfoMessage(`Detected multi-root workspace (${wsFile.fsPath}) with ${folders.length} folders`);
            return;
        }

        // 4. Edge—unlikely
        throw new Error(`Workspace with ${folders.length} folders; file: ${wsFile?.fsPath.toString()}`);
    }

    public getConfig(folderUri: Uri): WorkspaceConfig {
        const config = this._workspaceConfigs.get(folderUri.fsPath);
        if (!config) {
            const folder = workspace.getWorkspaceFolder(folderUri);
            if (!folder) {
                throw new Error(`No workspace folder found for URI: ${folderUri.fsPath}`);
            }
            const errorMsg = StatusBarManager.getError(folder.uri.fsPath.toString());
            throw new Error(errorMsg);
        }
        return config;
    }

    /** Pick a folder for multi-root, or return single root */
     async pickTargetFolder(): Promise<WorkspaceFolder> {
        const workspaceFolders = workspace.workspaceFolders;

        if (this._workspaceType === WorkspaceType.SingleRoot && workspaceFolders?.length === 1) {
            return workspaceFolders[0];
        }
        const pickedFolder = await window.showWorkspaceFolderPick({
            placeHolder: `Select the folder to place your ${CONFIG_FILE_NAME} in`,
        });

        if (!pickedFolder) {
            throw new Error('Folder selection cancelled');
        }

        return pickedFolder;
    }

    getFolders(): readonly WorkspaceFolder[] {
        return workspace.workspaceFolders ?? [];
    }

    async openJsonConfig(folder: WorkspaceFolder): Promise<void> {
        const configUri = getConfigPath(folder);

        // Ensure the file exists
        try {
            await workspace.fs.stat(configUri);
        } catch {
            // File doesn’t exist yet → create it with defaults
            const content = Buffer.from(
                JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2),
                'utf8'
            );
            try {
                await workspace.fs.writeFile(configUri, content);
                logInfoMessage(
                    `Created default LiveSync config for "${folder.name}".`
                );
            } catch (err: any) {
                logErrorMessage(
                    `Failed to create config file: ${err.message}`
                );
            return;
            }
        }

        // Open it in the text editor
        try {
            const doc = await workspace.openTextDocument(configUri);
            await window.showTextDocument(doc, { preview: false });
        } catch (err: any) {
            window.showErrorMessage(
                `Could not open config file: ${err.message || err}`
            );
        }
    }

    getPathPairs(returnNormalizedPaths: boolean = true): PathPair[] {
        let pathPairs: PathPair[] = [];

        for(const workspaceConfig of this._workspaceConfigs.values()) {
            pathPairs.push(workspaceConfig.getPathPair(returnNormalizedPaths));
        }

        return pathPairs;
    }

    findCorrespondingPath(fullPath: string) {
    
        const normalizedPath = normalizePath(fullPath);
        const pathPairs = this.getPathPairs();

        for( const pathPair of pathPairs) {

            // If the inputPath is a local path
            if (normalizedPath.startsWith(normalizePath(pathPair.localPath))) {
                return path.posix.join(pathPair.remotePath, path.posix.relative(pathPair.localPath, normalizedPath));
            }

            // If the inputPath is a remote path
            if (normalizedPath.startsWith(normalizePath(pathPair.remotePath))) {
                return path.join(pathPair.localPath, path.relative(pathPair.remotePath, normalizedPath));
            }
        }

        throw new Error(`Couldnt find corresponding path of ${fullPath}`);
    }

    getWorkspaceFolderFromPath(fullPath: string, source: FileNodeSource): WorkspaceFolder {
        let localPath: string;
        if(source === FileNodeSource.local) {
            localPath = fullPath;
        } else {
            // remote path
            localPath = this.findCorrespondingPath(fullPath);
        }

        const fileUri = Uri.file(localPath);
        const workspaceFolder = workspace.getWorkspaceFolder(fileUri);
        if(!workspaceFolder) {
            throw new Error(`No workspace found for ${localPath}`);
        }
        return workspaceFolder;
    }
}

