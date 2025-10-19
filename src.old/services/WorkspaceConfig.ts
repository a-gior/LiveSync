import { workspace, WorkspaceFolder, Uri} from "vscode";
import { WorkspaceConfigFile } from "@shared/DTOs/config/WorkspaceConfig";
import { DEFAULT_WORKSPACE_CONFIG } from "../utilities/constants";
import { ConnectionSettings } from "../DTOs/config/ConnectionSettings";
import { FileEventActions } from "../DTOs/config/FileEventActions";
import { Minimatch } from "minimatch";
import { normalizePath, PathPair } from "../utilities/fileUtils/filePathUtils";
import { WorkspaceJsonStore } from "../services/WorkspaceJsonStore";
import { ConnectionService } from "../services/ConnectionService";
import { clearSuppressedConfigError } from "../storage/ConfigErrorSuppressor";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../managers/LogManager";
import { getConfigPath } from "../managers/WorkspaceConfigManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { WorkspaceConfigError } from "../errors/WorkspaceConfigError";


export class WorkspaceConfig {
    private readonly _folder: WorkspaceFolder;
    private _workspaceConfig: WorkspaceConfigFile;
    private _compiledIgnoreMatchers: Minimatch[] | null = null;
    public readonly jsonStore: WorkspaceJsonStore;
    public readonly connectionService: ConnectionService;

    private _error: string = "";
    
    private constructor(public readonly id: string, folder: WorkspaceFolder, config: WorkspaceConfigFile, connectionService: ConnectionService) {
        this._folder = folder;
        this._workspaceConfig = config;

        this.jsonStore = new WorkspaceJsonStore(folder.uri);
        this.connectionService = connectionService;
    }

    public async initialize() {
        await this.jsonStore.loadAll();
    }

    public get error(): string {
        return this._error;
    }

    public set error(err: string) {
        this._error = err;
    }

    public get folder(): WorkspaceFolder {
        return this._folder;
    }

    /** The folder’s  name */
    public get folderName(): string {
        return this._folder.name;
    }

    /** The raw configuration block (hostname/port/username/etc) */
    public get connectionSettings(): ConnectionSettings {
        const {
            hostname,
            port,
            username,
            password,
            privateKeyPath,
            passphrase,
        } = this._workspaceConfig;

        return { hostname, port, username, password, privateKeyPath, passphrase };
    }

    /** The remotePath value */
    public get remotePath(): WorkspaceConfigFile["remotePath"] {
        return this._workspaceConfig.remotePath;
    }

    /** File-event actions */
    public get fileEventActions(): FileEventActions {
        const {
            actionOnUpload,
            actionOnDownload,
            actionOnSave,
            actionOnCreate,
            actionOnDelete,
            actionOnMove,
            actionOnOpen,
        } = this._workspaceConfig;

        return {actionOnUpload, actionOnDownload, actionOnSave, actionOnCreate, actionOnDelete, actionOnMove, actionOnOpen};
    }
    
    /** The ignore-list of globs/paths */
    public get ignoreList(): string[] {
        return this._workspaceConfig.ignoreList ?? [];
    }

    /** The compiled ignore-list of globs/paths */
    public get compiledIgnoreList(): Minimatch[] {
        if(!this._compiledIgnoreMatchers) {
            
            if (!this._workspaceConfig.ignoreList) {
                throw new WorkspaceConfigError(this._folder, "Invalid Config - Missing ignore list");
            }

            const raw = this._workspaceConfig.ignoreList;
            const expandedGlobs = raw.flatMap((pattern) =>
                pattern.includes("/") || pattern.includes("*")
                ? [pattern]
                : [pattern, `**/${pattern}/**`]
            );

            // we use the Minimatch class directly for typing
            this._compiledIgnoreMatchers = expandedGlobs.map(
                (glob) => new Minimatch(glob, { dot: true, matchBase: true })
            );
        }

        return this._compiledIgnoreMatchers;
    }

    public async addToIgnoreList(...paths: string[]): Promise<void> {
        try {
            const current: string[] = Array.isArray(this._workspaceConfig.ignoreList) ? this._workspaceConfig.ignoreList : [];

            // Filter out any that are already present
            const uniqueNew = paths.filter(p => !current.includes(p));
            if (uniqueNew.length === 0) {
                logErrorMessage(
                `No new paths to add to ignore list.`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
                );
                return;
            }

            // Append & persist via your existing update method
            const updatedList = [...current, ...uniqueNew];
            await this.updateParams({ ignoreList: updatedList });

            logInfoMessage(
                `Added to ignore list:\n  • ${uniqueNew.join('\n  • ')}`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
            );
        } catch (err: any) {
            logErrorMessage(
                `Error adding to ignore list: ${paths.join(', ')}`,
                LOG_FLAGS.ALL,
                err
            );
        }
    }

    /**
     * Merge the given updates into the on-disk JSON,
     * then reload the in-memory config.
     */
    public async updateParams(
    updates: Partial<WorkspaceConfigFile>
    ): Promise<void> {
        const configUri = getConfigPath(this._folder);

        const raw = await workspace.fs.readFile(configUri);
        const existing = JSON.parse(raw.toString()) as WorkspaceConfigFile;

        const merged: WorkspaceConfigFile = {
            ...existing,
            ...updates
        };

        await workspace.fs.writeFile(
            configUri,
            Buffer.from(JSON.stringify(merged, null, 2), 'utf8')
        );

        await this.reload();
    }

    /** Reload from disk into the private `_workspaceConfig` field */
    public async reload(): Promise<void> {
        const configUri: Uri = getConfigPath(this._folder);
        const raw = await workspace.fs.readFile(configUri);
        this._workspaceConfig = JSON.parse(raw.toString());
    }

    /**
     * Async factory method: reads & parses the config, 
     * then returns a fully-initialized instance.
     */
    public static async create(folder: WorkspaceFolder): Promise<WorkspaceConfig> {
        const configFile = getConfigPath(folder);
        let raw: Uint8Array;
        try {
            raw = await workspace.fs.readFile(configFile);
        } catch (err: any) {
            throw new WorkspaceConfigError(folder, "No config found");
        }

        let parsed: WorkspaceConfigFile;
        try {
            parsed = JSON.parse(raw.toString());
        } catch (err: any) {
            throw new WorkspaceConfigError(folder, "Configuration file is not valid JSON");
        }

        
        // Merge user-provided values onto defaults
        const fullConfig: WorkspaceConfigFile = {
            ...DEFAULT_WORKSPACE_CONFIG,
            ...parsed
        };

        const connSvc = new ConnectionService(fullConfig);
        const workspaceConfig = new WorkspaceConfig(folder.uri.fsPath, folder, fullConfig, connSvc);
        connSvc.link(workspaceConfig);
        await workspaceConfig.initialize();
        return workspaceConfig;
    }

    /**
     * Validate that the loaded workspace-config has all required connection
     * settings and at least one auth method (password or privateKeyPath).
     */
    public get isValid(): boolean {
        const cfg = this._workspaceConfig;
        const isSet = (s?: string) => !!(s && s.trim());

        if (!cfg) { 
            return false;
        }

        if (!isSet(cfg.hostname)) {
            this._error = "Missing hostname";
            return false;
        }

        if (!isSet(cfg.username)) {
            this._error = "Missing username";
            return false;
        }

        if (!isSet(cfg.password) && !isSet(cfg.privateKeyPath)) {
            this._error = "Missing authentication: password or private key path required";
            return false;
        }

        if (!isSet(cfg.remotePath)) {
            this._error = "Missing remote path";
            return false;
        }

        if(this.error && this.error.includes("unreachable")) {
            return true; // keep unreachable errors
        }

        // Clear any previous error if valid
        this._error = "";
        clearSuppressedConfigError(this._folder);
        StatusBarManager.clearErrored(this._folder.uri.fsPath.toString());
        return true;
    }


    /**
     * Returns the local filesystem path of this workspace root
     * and its configured remotePath (if any).
     */
    public getPathPair(returnNormalizedPaths: boolean = true): PathPair {

        const localPath = this._folder.uri.fsPath;
        const remotePath = this._workspaceConfig.remotePath;
        if(!remotePath) {
            throw new WorkspaceConfigError(this._folder, `Invalid Config - Missing remote path`);
        }

        if(returnNormalizedPaths) {
            return { localPath: normalizePath(localPath), remotePath: normalizePath(remotePath) };
        }

        return { localPath, remotePath };
    }
}