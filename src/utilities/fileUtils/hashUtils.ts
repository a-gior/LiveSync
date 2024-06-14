import * as crypto from "crypto";
import { createReadStream } from "fs";
import { FileEntrySource, FileEntryType } from "../FileEntry";
import { getRelativePath } from "./filePathUtils";
import { getRemoteHash } from "./sftpOperations";

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
  fileSource: FileEntrySource,
  fileType: FileEntryType,
) {
  if (!filePath) {
    console.log("Empty parameters passed to generateHash");
    return "";
  }

  const relativePath = getRelativePath(filePath, fileSource);

  if (!relativePath && relativePath !== "") {
    throw new Error(
      `Could not find relative path for file ${filePath} (source: ${fileSource})`,
    );
  }

  let fileContentHash: string = "";

  if (fileType === FileEntryType.file) {
    if (fileSource === FileEntrySource.local) {
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
      fileContentHash = (await getRemoteHash(filePath)) || "";
    }
  }

  const hash = crypto.createHash("sha256");
  // console.log(`Creating hash with fileContentHash: ${fileContentHash}`);
  hash.update(`${relativePath}${fileType}${fileContentHash}`);
  const filehash = hash.digest("hex");

  return filehash;
}
