import * as fs from "fs";

export async function saveToFile(data: any, filePath: string): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function loadFromFile<T>(filePath: string): Promise<T> {
  const data = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(data) as T;
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
