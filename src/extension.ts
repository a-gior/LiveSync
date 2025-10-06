// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { logInfoMessage } from "./managers/LogManager";
import { CommandRegistrar } from "./services/CommandRegistrar";
import { WorkspaceConfigManager } from "./managers/WorkspaceConfigManager";
import { migrateStorageSchema } from "./services/WorkspaceJsonStore";
import { initConfigErrorSuppressor } from "./storage/ConfigErrorSuppressor";
import { initLastSelectedWorkspace } from "./storage/LastSelectedWorkspace";

import { DefaultDiffEngine } from "@domain/diff/DiffEngine";
import { SyncStateManager } from "@app/SyncStateManager";
import { ExperimentalTreeProvider } from "@presentation/tree/ExperimentalTreeProvider";
import { FileMeta } from "@domain/types";
import { buildLocalIndex } from '@infra/persistence/LocalIndexBuilder';
import { FileEventBridge } from "@presentation/events/FileEventBridge";
import { JsonRemoteSnapshot } from "./infrastructure/remote/RemoteSnapshot";
import { FolderStateStore } from "./presentation/tree/FolderStateStore";
import { ProgressService } from "./presentation/statusbar/ProgressService";
import { report } from "node:process";

export let configManager: WorkspaceConfigManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage("LiveSync extension activating...");
  // await migrateStorageSchema(context);
  
  // initConfigErrorSuppressor(context);
  // initLastSelectedWorkspace(context);
  
  // // Register file status decoration provider
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider));

  // // Initialize managers
  // configManager = new WorkspaceConfigManager(context);
  // await configManager.loadConfigs();
  // await TreeViewManager.initialize(context);
  // CommandRegistrar.register(context, TreeViewManager.diffProvider);
  
  // EventManager.initialize(context, TreeViewManager.diffProvider);
  // StatusBarManager.init(context);
  // StatusBarManager.createPermanentIcon();

  logInfoMessage("LiveSync extension activated.");
  


  // Build the core for the experimental view.
  const diffEngine = new DefaultDiffEngine();
  const stateManager = new SyncStateManager(diffEngine);
  const remoteSnapshot = new JsonRemoteSnapshot();
  const progress = new ProgressService();
  context.subscriptions.push({ dispose: () => progress.dispose() });

  const initialFolders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? [];
  const workspaceIds: string[] = initialFolders.map((f) => f.uri.fsPath);

  const folderStateStore = new FolderStateStore(context.workspaceState);
  const provider = new ExperimentalTreeProvider(stateManager, workspaceIds, folderStateStore);
  const treeView = vscode.window.createTreeView('livesyncExperimental', { treeDataProvider: provider });
  context.subscriptions.push(treeView);

  // Optional: focus view command (clicked from status bar)
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.focusExperimentalView', async () => {
      const firstWorkspaceId = workspaceIds[0];
      if (!firstWorkspaceId) {
        vscode.window.showInformationMessage('LiveSync: no workspace to focus.');
        return;
      }

      const rootNode = provider.getWorkspaceNode(firstWorkspaceId);
      if (!rootNode) {
        return;
      }

      try {
        await treeView.reveal(rootNode, { expand: true, select: false });
      } catch {
        // ignore reveal errors (e.g., view not visible yet)
      }
    })
  );

  // Track expand/collapse → persist folder state
  treeView.onDidExpandElement((e) => {
    const node: any = e.element;
    if (node.kind === 'entry') {
      folderStateStore.setOpen(node.workspaceId, node.path, true);
    }
  });
  treeView.onDidCollapseElement((e) => {
    const node: any = e.element;
    if (node.kind === 'entry') {
      folderStateStore.setOpen(node.workspaceId, node.path, false);
    }
  });

  // Open-file command
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.openFile', async (fsPath: string) => {
      const uri = vscode.Uri.file(fsPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  // Live events
  const bridge = new FileEventBridge(stateManager);
  bridge.register(context.subscriptions);

  // Build Local Index (wrap with status bar + window progress)
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.experimental.indexLocal', async () => {
      const folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        vscode.window.showWarningMessage('No workspace folders open.');
        return;
      }

      await vscode.window.withProgress(
        {
          title: 'LiveSync: Building local index…',
          location: vscode.ProgressLocation.Notification, // was Window
          cancellable: true
        },
        async (progress, token) => {
          const total = folders.length;
          let processed = 0;

          for (const folder of folders) {
            if (token.isCancellationRequested) { break; }
            processed += 1;

            const prefix = `${folder.name} (${processed}/${total})`;
            let last = 0;

            const localIndex = await buildLocalIndex(folder, {
              token,
              concurrency: 4,
              progress: (done, count) => {
                if (done - last > 25 || done === count) {
                  last = done;
                  const msg = `${prefix} — ${done}/${count}`;
                  progress.report({ message: msg });
                }
              }
            });

            stateManager.setLocalIndex(folder.uri.fsPath, localIndex);
          }

          if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('LiveSync: Local index cancelled.');
          } else {
            vscode.window.showInformationMessage('LiveSync: Local index built.');
          }
        }
      );
    })
  );

  // Remote: load snapshot
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.experimental.remote.load', async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        vscode.window.showWarningMessage('No workspace folders open.');
        return;
      }

      await progress.withTask('Loading remote', async (report: (arg0: string) => void) => {
        await vscode.window.withProgress(
          { title: 'LiveSync: Loading remote snapshot…', location: vscode.ProgressLocation.Window },
          async () => {
            let i = 0;
            for (const folder of folders) {
              i += 1;
              const msg = `${folder.name} (${i}/${folders.length})`;
              report(msg);
              const wsId = folder.uri.fsPath;
              const remoteIndex = await remoteSnapshot.load(wsId);
              stateManager.setRemoteIndex(wsId, remoteIndex);
            }
            vscode.window.showInformationMessage('LiveSync: Remote snapshot loaded.');
          }
        );
      });
    })
  );

  // Remote: save snapshot from local (parity helper)
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.experimental.remote.saveFromLocal', async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        vscode.window.showWarningMessage('No workspace folders open.');
        return;
      }

      await progress.withTask('Saving remote', async (report: (arg0: string) => void) => {
        await vscode.window.withProgress(
          { title: 'LiveSync: Saving remote snapshot…', location: vscode.ProgressLocation.Window },
          async () => {
            let i = 0;
            for (const folder of folders) {
              i += 1;
              const msg = `${folder.name} (${i}/${folders.length})`;
              report(msg);

              const wsId = folder.uri.fsPath;
              // expose a getter to avoid peeking internals
              const localIndex: Map<string, FileMeta> = (stateManager as any).getLocalIndex
                ? (stateManager as any).getLocalIndex(wsId)
                : new Map(); // add a real getter in SyncStateManager if not present

              await remoteSnapshot.save(wsId, localIndex);
              stateManager.setRemoteIndex(wsId, localIndex);
            }
            vscode.window.showInformationMessage('LiveSync: Remote snapshot saved.');
          }
        );
      });
    })
  );

  // Apply change for a single entry to the remote snapshot (JSON backend for now)
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.experimental.node.applyToRemote', async (node: any) => {
      // When invoked from the tree context menu, VS Code passes the tree element
      if (!node || node.kind !== 'entry') {
        vscode.window.showInformationMessage('LiveSync: no file selected.');
        return;
      }

      const workspaceId: string = node.workspaceId;
      const relPath: string = node.path;

      const diff = stateManager.getDiffEntry(workspaceId, relPath);
      if (!diff) {
        vscode.window.showWarningMessage('LiveSync: no diff available for this item.');
        return;
      }

      if (diff.type === 'folder') {
        vscode.window.showInformationMessage('LiveSync: folder actions coming soon. Select a file instead.');
        return;
      }

      if (diff.status === 'added' || diff.status === 'modified') {
        const localMeta = stateManager.getLocalMeta(workspaceId, relPath);
        if (!localMeta) {
          vscode.window.showWarningMessage('LiveSync: local file metadata not found.');
          return;
        }
        // Update remote index in-memory
        stateManager.applyRemote({
          workspaceId,
          type: 'modify',      // use 'modify' to cover create/overwrite
          path: relPath,
          meta: localMeta
        });
      } else if (diff.status === 'removed') {
        stateManager.applyRemote({
          workspaceId,
          type: 'delete',
          path: relPath
        });
      } else {
        vscode.window.showInformationMessage('LiveSync: nothing to apply for this item.');
        return;
      }

      // Persist the remote snapshot
      await remoteSnapshot.save(workspaceId, stateManager.getRemoteIndex(workspaceId));
      vscode.window.showInformationMessage('LiveSync: remote updated.');
    })
  );


  return { context };
}

export function deactivate() {
  logInfoMessage("Deactivating LiveSync extension...");
}
