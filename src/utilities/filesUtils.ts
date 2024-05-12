import * as path from "path";
import * as fs from "fs";
import { SFTPClient } from "../services/SFTPClient";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { FileMap } from "../types/FileTypes";

import { workspace, window, ViewColumn } from "vscode";

export async function listRemoteFilesRecursive(
  remoteDir: string,
  fileGlob?: any,
): Promise<FileMap> {
  console.log(`Listing ${remoteDir} recursively...`);
  const sftpClient = new SFTPClient();
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  try {
    // Connect to the remote server
    if (workspaceConfiguration.configuration) {
      await sftpClient.connect(workspaceConfiguration.configuration);
    }

    const client = sftpClient.getClient();
    const listDirectory = async (dir: string): Promise<any> => {
      const fileObjects = await client.list(dir.replace(/\\/g, "/"), fileGlob);
      const directoryContents: FileMap = {};

      for (const file of fileObjects) {
        const filePath = path.join(dir, file.name);
        if (file.type === "d") {
          console.log(
            `${new Date(file.modifyTime).toISOString()} PRE ${file.name}`,
          );
          // Recursively list files in subdirectory
          const subfiles = await listDirectory(filePath);
          directoryContents[file.name] = {
            type: "directory",
            size: file.size,
            modifiedTime: new Date(file.modifyTime),
            children: subfiles,
            source: "remote",
          };
        } else {
          console.log(
            `${new Date(file.modifyTime).toISOString()} ${file.size} ${file.name}`,
          );
          directoryContents[file.name] = {
            type: "file",
            size: file.size,
            modifiedTime: new Date(file.modifyTime),
            source: "remote",
            children: [],
          };
        }
      }

      return directoryContents;
    };

    return await listDirectory(remoteDir);
  } catch (error) {
    console.error("Recursive listing failed:", error);
    return {};
  } finally {
    // Disconnect from the remote server
    await sftpClient.disconnect();
  }
}

export async function listLocalFilesRecursive(
  localDir: string,
): Promise<FileMap> {
  console.log(`Listing ${localDir} recursively...`);

  const listDirectory = async (dir: string): Promise<any> => {
    const directoryContents: FileMap = {};

    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(dir, file.name);
      if (file.isDirectory()) {
        console.log(
          `${fs.statSync(filePath).mtime.toISOString()} PRE ${file.name}`,
        );
        // Recursively list files in subdirectory
        const subfiles = await listDirectory(filePath);
        directoryContents[file.name] = {
          type: "directory",
          size: fs.statSync(filePath).size,
          modifiedTime: fs.statSync(filePath).mtime,
          children: subfiles,
          source: "local",
        };
      } else {
        console.log(
          `${fs.statSync(filePath).mtime.toISOString()} ${fs.statSync(filePath).size} ${file.name}`,
        );
        directoryContents[file.name] = {
          type: "file",
          size: fs.statSync(filePath).size,
          modifiedTime: fs.statSync(filePath).mtime,
          source: "local",
          children: [],
        };
      }
    }

    return directoryContents;
  };

  try {
    return await listDirectory(localDir);
  } catch (err) {
    console.error("Recursive listing failed", err);
    return {};
  }
}

// TODO: IMPROVE ALGO
export function compareFileMaps(local: FileMap, remote: FileMap): FileMap {
  const differences: FileMap = {};

  // Check files and directories in the remote FileMap
  for (const remoteName in remote) {
    if (!local.hasOwnProperty(remoteName)) {
      // File or directory exists only in remote
      const remoteItem = remote[remoteName];
      differences[remoteName] = {
        ...remoteItem,
        source: "remote",
        status: "missing",
      };
    } else {
      const remoteItem = remote[remoteName];
      const localItem = local[remoteName];

      // Compare files
      if (remoteItem.type === "file" && localItem.type === "file") {
        if (
          remoteItem.size !== localItem.size ||
          remoteItem.modifiedTime?.getTime() !==
            localItem.modifiedTime?.getTime()
        ) {
          differences[remoteName] = {
            ...remoteItem,
            source: "remote",
            status: "modified",
          };
        }
      }

      // Recursively compare directories
      // if (remoteItem.type === 'directory' && localItem.type === 'directory') {
      //     const subDifferences = compareFileMaps(localItem.children || {}, remoteItem.children || {});
      //     if (Object.keys(subDifferences).length > 0) {
      //         differences[remoteName] = {
      //             ...remoteItem,
      //             source: 'local',
      //             status: 'modified',
      //             children: [subDifferences]
      //         };
      //     }
      // }
    }
  }

  // Check files and directories in the local FileMap
  for (const localName in local) {
    if (!remote.hasOwnProperty(localName)) {
      // File or directory exists only locally
      const localItem = local[localName];
      differences[localName] = {
        ...localItem,
        source: "local",
        status: "missing",
      };
    }
  }

  return differences;
}

export async function showFileDiff(fileMap: FileMap) {
  let diffText = "";

  // Loop through the fileMap and generate diff for each file
  for (const filePath in fileMap) {
    if (fileMap.hasOwnProperty(filePath)) {
      const fileData = fileMap[filePath];

      // If the file is missing in local or remote
      if (fileData.status === "missing" && fileData.source === "local") {
        diffText += `- ${filePath} (Missing in local)\n`;
      } else if (
        fileData.status === "missing" &&
        fileData.source === "remote"
      ) {
        diffText += `- ${filePath} (Missing in remote)\n`;
      } else {
        // Read file contents
        const fileContents = await readFile(filePath);

        // Generate diff for modified files
        diffText += `Diff for: ${filePath}\n`;
        diffText += generateDiff(fileContents, fileContents); // Assuming remote and local contents are the same
      }
    }
  }

  // Show the diff in a new text document
  workspace
    .openTextDocument({ language: "plaintext", content: diffText })
    .then((doc) => {
      window.showTextDocument(doc, { viewColumn: ViewColumn.Active });
    });
}

// Generate diff between oldText and newText
function generateDiff(oldText: string, newText: string): string {
  // Code to generate diff using diff library or any other diffing method
  // Replace this with the appropriate diffing logic based on your requirements
  // This is just a placeholder function
  return `Diff:\nOld: ${oldText}\nNew: ${newText}\n\n`;
}

// Read file contents
function readFile(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    fs.readFile(filePath, "utf-8", (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}
