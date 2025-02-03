import * as crypto from "crypto";
import { stat, createReadStream } from "fs";
import { FileNodeSource } from "../FileNode";
import { getRemoteFileContentHash } from "./sftpOperations";
import { BaseNodeType } from "../BaseNode";
import { getRelativePath } from "./filePathUtils";
import { logErrorMessage } from "../../managers/LogManager";

export async function generateHash(filePath: string, fileSource: FileNodeSource, fileType: BaseNodeType, fileContentHash: string = "") {
  if (fileType === BaseNodeType.file && fileContentHash === "") {
    if (fileSource === FileNodeSource.local) {
      fileContentHash = await new Promise<string>((resolve) => {
        const hash = crypto.createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => {
          resolve(hash.digest("hex"));
        });
        stream.on("error", (err) => {
          // reject(err);
          logErrorMessage(`<generateHash> Error reading file: ${err.message}`);
          resolve(""); // Return an empty string if there's an error (unhashable files like .asar, for instance)
        });
      });
    } else {
      fileContentHash = (await getRemoteFileContentHash(filePath)) || "";
    }
  }

  return generateNodeHash(filePath, fileType, fileContentHash);
}

export function generateNodeHash(fullPath: string, fileType: BaseNodeType, fileContentHash: string) {
  const relativePath = getRelativePath(fullPath);
  const hash = crypto.createHash("sha256");

  hash.update(`${relativePath}${fileType}${fileContentHash}`);
  const filehash = hash.digest("hex");

  return filehash;
}

export async function getLocalFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if the path is a directory
    stat(filePath, (err, stats) => {
      if (err) {
        return reject(`Error reading file stats: ${err.message}`);
      }

      if (stats.isDirectory()) {
        return resolve("");
      }

      const hash = crypto.createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));

      stream.on("end", () => {
        const fileHash = hash.digest("hex");
        resolve(fileHash);
      });

      stream.on("error", (err) => {
        reject(`Error reading file: ${err.message}`);
      });
    });
  });
}
