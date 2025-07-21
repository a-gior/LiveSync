import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ExtensionContext, Uri } from 'vscode';
import { FileNode } from '../utilities/FileNode';
import { ComparisonFileNode, ComparisonStatus } from '../utilities/ComparisonFileNode';
import {
  COMPARE_FILES_JSON,
  FOLDERS_STATE_JSON,
  JSON_SCHEMA_VERSION,
  REMOTE_FILES_JSON,
  SAVE_DIR
} from '../utilities/constants';
import { debounce } from '../utilities/debounce';
import { FolderState } from '../utilities/types';
import { logInfoMessage } from '../managers/LogManager';

export async function migrateStorageSchema(context: ExtensionContext): Promise<void> {
  const stored = context.globalState.get<number>('livesync.jsonSchemaVersion', 1);

  if (stored < JSON_SCHEMA_VERSION) {
    try {
        // Remove the entire SAVE_DIR folder and all its contents
        await fs.promises.rm(SAVE_DIR, { recursive: true, force: true });
        logInfoMessage(`Clearing saved data (schema ${stored} → ${JSON_SCHEMA_VERSION}) due to new storage architecture`);
    } catch (err) {
        // ignore errors—force:true covers non-existence
    }

    await context.globalState.update('livesync.jsonSchemaVersion', JSON_SCHEMA_VERSION);
  }
}

/**
 * Manages persistent JSON storage for a single workspace folder.
 *
 * Each instance holds:
 *  - a single FileNode tree root,
 *  - a single ComparisonFileNode tree root,
 *  - a simple folder-state object.
 *
 * It loads/saves them to JSON files under a per-workspace subdirectory of SAVE_DIR.
 */
export class WorkspaceJsonStore {
    /** Root of the remote FileNode tree for this workspace */
    private _remoteFileRoot?: FileNode;
    /** Root of the comparison FileNode tree for this workspace */
    private _comparisonFileRoot?: ComparisonFileNode;
    /** Expand/collapse state by relative path for this workspace */
    private _folderStates?: FolderState;

    private readonly baseDir: string;

    constructor(workspaceFolderUri: Uri) {
        // derive a per-workspace subfolder in SAVE_DIR by hashing its fsPath
        const hash = crypto.createHash('sha256').update(workspaceFolderUri.fsPath).digest('hex'); // 64-bit identifier
        this.baseDir = path.join(SAVE_DIR, hash);
    }

    public get remoteFileRoot() {
        if(!this._remoteFileRoot) {
            throw new Error(`No remote file data found for ${this.baseDir}`);
        }

        return this._remoteFileRoot;
    }

    public set remoteFileRoot(node: FileNode) {
        this._remoteFileRoot = node;
        this._saveJson(REMOTE_FILES_JSON,    this._remoteFileRoot);
    }

    public get comparisonFileRoot() {
        if(!this._comparisonFileRoot) {
            throw new Error(`No comparison data found for ${this.baseDir}`);
        }

        return this._comparisonFileRoot;
    }

    public set comparisonFileRoot(node: ComparisonFileNode) {
        this._comparisonFileRoot = node;
        this._saveJson(COMPARE_FILES_JSON,    this._comparisonFileRoot);
    }

    public get folderStates() {
        if(!this._folderStates) {
            throw new Error(`No folders state data found for ${this.baseDir}`);
        }

        return this._folderStates;
    }

    /** Load both roots and the folder-state for this workspace. */
    public async loadAll(): Promise<void> {
        await fs.promises.mkdir(this.baseDir, { recursive: true });

        // load the two tree roots
        this._remoteFileRoot     = await this._loadJson<FileNode>(REMOTE_FILES_JSON, FileNode);
        this._comparisonFileRoot = await this._loadJson<ComparisonFileNode>(COMPARE_FILES_JSON, ComparisonFileNode);

        // reuse loadJson for folder‐state (no need for a separate method)
        this._folderStates = (await this._loadJson<FolderState>(FOLDERS_STATE_JSON)) ?? {};
    }

    /** Persist both roots and the folder-state for this workspace. */
    public async saveAll(): Promise<void> {
        await fs.promises.mkdir(this.baseDir, { recursive: true });
        await Promise.all([
            this._saveJson(REMOTE_FILES_JSON,     this._remoteFileRoot),
            this._saveJson(COMPARE_FILES_JSON,    this._comparisonFileRoot),
            this._saveJson(FOLDERS_STATE_JSON,    this._folderStates)
        ]);
    }

    /** Read (or initialize) the folder-state JSON for this workspace. */
    public async loadFolderStates(): Promise<void> {
        const filePath = this._getJsonPath(FOLDERS_STATE_JSON);
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            const content = await fs.promises.readFile(filePath, 'utf8');
            this._folderStates = JSON.parse(content) as FolderState;
        } catch {
            this._folderStates = {};
        }
    }

    /** Write the folder-state object to disk. */
    public async saveFolderStates(): Promise<void> {
        const filePath = this._getJsonPath(FOLDERS_STATE_JSON);
        const json     = JSON.stringify(this._folderStates, null, 2);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, json, 'utf8');
    }

    /** Update a single expand/collapse flag and schedule a save. */
    public updateFolderState(relativePath: string, isExpanded: boolean): void {
        if (isExpanded) {
            this._folderStates![relativePath] = true;
        } else {
            delete this._folderStates![relativePath];
        }
        this._saveFolderStatesDebounced();
    }

    /** Recursively expand folders containing changes, then save immediately. */
    public async expandChangedFoldersRecursive(
        rootNodes: ComparisonFileNode
    ): Promise<void> {
        const state = this._folderStates!;
        const markChanged = (node: ComparisonFileNode): boolean => {
            let changed = node.status !== ComparisonStatus.unchanged;
            if (node.isDirectory()) {
                for (const child of node.children.values()) {
                    if (markChanged(child)) {changed = true;}
                }
                if (changed) {state[node.relativePath] = true;}
            }
            return changed;
        };
        for (const root of rootNodes.children.values()) {markChanged(root);}
        await this.saveFolderStates();
    }

    /** Clear all expand/collapse flags and persist. */
    public async clearFolderStates(): Promise<void> {
        this._folderStates = {};
        await this.saveFolderStates();
    }

    public findRemoteNode(relativePath: string): FileNode {
        if (!this._remoteFileRoot) {
            throw new Error('Remote root is not loaded');
        }
        const parts = this._normalizeParts(relativePath);
        return this._lookupNode(this._remoteFileRoot, parts);
    }

    public findComparisonNode(relativePath: string): ComparisonFileNode {
        if (!this._comparisonFileRoot) {
            throw new Error('Comparison root is not loaded');
        }
        const parts = this._normalizeParts(relativePath);
        return this._lookupNode(this._comparisonFileRoot, parts);
    }

    /**
     * Replace the entire comparison tree or just a branch.
     */
    public async updateComparison(
        newNode: ComparisonFileNode
        ): Promise<void> {
        // If they want to replace the root itself:
        if (newNode.relativePath === '' || newNode.relativePath === '.') {
            this.comparisonFileRoot = newNode;
        } else {
            if (!this._comparisonFileRoot) {
                throw new Error('comparisonFileRoot not loaded');
            }
            this._patchSubtree(this._comparisonFileRoot, newNode.relativePath, newNode);
        }
        await this._saveJson(COMPARE_FILES_JSON, this._comparisonFileRoot);
    }

    /**
     * Replace the entire remote tree or just a branch.
     */
    public async updateRemote(
        newNode: FileNode
        ): Promise<void> {
        if (newNode.relativePath === '' || newNode.relativePath === '.') {
            this.remoteFileRoot = newNode;
        } else {
            if (!this._remoteFileRoot) {
                throw new Error('remoteFileRoot not loaded');
            }
            this._patchSubtree(this._remoteFileRoot, newNode.relativePath, newNode);
            await this._saveJson(REMOTE_FILES_JSON, this._remoteFileRoot);
        }
    }

    /** Remove exactly one branch under the comparison root. */
    public async removeComparisonSubtree(
        relativePath: string
        ): Promise<void> {
        if (!this._comparisonFileRoot) {
            throw new Error('comparisonFileRoot not loaded');
        }
        this._removeSubtree(this._comparisonFileRoot, relativePath);
        await this._saveJson(COMPARE_FILES_JSON, this._comparisonFileRoot);
    }

    /**
     * Load a JSON file containing a single object of type T,
     * optionally passing it through a constructor.
     */
    private async _loadJson<T>(
        fileName: string,
        NodeConstructor?: new (data: any) => T
    ): Promise<T | undefined> {
        const filePath = this._getJsonPath(fileName);
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            const content = await fs.promises.readFile(filePath, 'utf8');
            const data    = JSON.parse(content);
            return NodeConstructor ? new NodeConstructor(data) : (data as T);
        } catch {
            return undefined;
        }
    }

    /**
     * Save a single object T to its JSON file.
     * If `value` is undefined, writes an empty file (or you could delete it).
     */
    private async _saveJson<T>(
        fileName: string,
        value: T | undefined
    ): Promise<void> {
        const filePath = this._getJsonPath(fileName);
        const json     = value === undefined ? '{}' : JSON.stringify(value, null, 2);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, json, 'utf8');
    }

    /** Debounced wrapper around saveFolderStates(). */
    private _saveFolderStatesDebounced = debounce(
        () => this.saveFolderStates(),
        500
    );

    /** Compute the full disk path under baseDir for a given JSON filename. */
    private _getJsonPath(fileName: string): string {
        return path.join(this.baseDir, fileName);
    }

    /**
     * Recursively traverse a FileNode or ComparisonFileNode hierarchy,
     * throwing if any segment is missing or you try to descend into a file.
     */
    private _lookupNode<T extends FileNode | ComparisonFileNode>(
        node: T,
        parts: string[]
    ): T {
        // base case: no more segments, this is our node
        if (parts.length === 0) {
            return node;
        }

        // if it's not a directory, we can't go deeper
        if (!node.isDirectory()) {
            throw new Error(
                `Cannot traverse into non-directory node "${node.relativePath}"`
            );
        }

        const [head, ...rest] = parts;
        const child = node.children.get(head) as T | undefined;

        if (!child) {
            throw new Error(
                `Path segment "${head}" not found under "${node.relativePath}"`
            );
        }

        // recurse
        return this._lookupNode(child, rest);
    }

    /**
     * Walks `root.children` down to parent of `relativePath` and
     * replaces the named leaf with `newNode`.
     *
     * root and newNode must be the *same* concrete class (both FileNode or both ComparisonFileNode),
     * so T is never a union here.
     */
    private _patchSubtree<T extends FileNode | ComparisonFileNode>(
        root: T,
        relativePath: string,
        newNode: T
        ): void {
        const parts = this._normalizeParts(relativePath); 

        // so here parts.length >= 1
        const leaf = parts.pop()!;
        const parent = this._lookupNode<T>(root, parts) as T;

        if (!parent.isDirectory()) {
            throw new Error(`Cannot replace under non-directory "${parent.relativePath}"`);
        }

        const children = parent.children as Map<string, T>; 
        children.set(leaf, newNode);
    }

    /** Helper to delete a branch. */
    private _removeSubtree<T extends FileNode|ComparisonFileNode>(
        root: T,
        relativePath: string
        ) {
        const parts = this._normalizeParts(relativePath);
        if (parts.length === 0) {
            throw new Error('Use the setter to remove the whole root');
        }

        const leafName   = parts.pop()!;
        const parentNode = this._lookupNode(root, parts);
        if (!parentNode.isDirectory()) {
            throw new Error(`Cannot delete under non-directory "${parentNode.relativePath}"`);
        }
        parentNode.children.delete(leafName);
    }

    /** Split `"a/b/c"` (or `"."`) into path segments. */
    private _normalizeParts(rel: string): string[] {
        if (!rel || rel === '.') {
            return [];
        }
        return rel.split('/').filter(p => p.length > 0);
    }
}
