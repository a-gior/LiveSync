import * as crypto from "crypto";
import { stat, createReadStream } from "fs";
import { FileNodeSource, getFileNodeInfo } from "../FileNode";
import { getRemoteFileContentHash } from "./sftpOperations";
import { BaseNodeType } from "../BaseNode";

export function generateHashFile(
  name: string,
  size: number,
  modifiedTime: Date,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${name}${size}${modifiedTime.toISOString()}`);
  return hash.digest("hex");
}

export async function generateHash(
  filePath: string,
  fileSource: FileNodeSource,
  fileType: BaseNodeType,
  fileContentHash: string = "",
) {
  if (!filePath) {
    console.log("Empty parameters passed to generateHash");
    return "";
  }

  const relativePath = getFileNodeInfo(filePath)!.relativePath;

  if (!relativePath && relativePath !== "") {
    throw new Error(
      `Could not find relative path for file ${filePath} (source: ${fileSource})`,
    );
  }

  if (fileType === BaseNodeType.file && fileContentHash === "") {
    if (fileSource === FileNodeSource.local) {
      fileContentHash = await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => {
          resolve(hash.digest("hex"));
        });
        stream.on("error", (err) => {
          reject(err);
        });
      });
    } else {
      fileContentHash = (await getRemoteFileContentHash(filePath)) || "";
    }
  }

  const hash = crypto.createHash("sha256");
  // console.log(`Creating hash with fileContentHash: ${fileContentHash}`);
  hash.update(`${relativePath}${fileType}${fileContentHash}`);
  const filehash = hash.digest("hex");

  return filehash;
}

export function generateHash2(
  fullPath: string,
  fileType: BaseNodeType,
  fileContentHash: string,
) {
  const relativePath = getFileNodeInfo(fullPath)!.relativePath;
  const hash = crypto.createHash("sha256");
  // console.log(`Creating hash with fileContentHash: ${fileContentHash}`);
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
