export type FileMap = {
  [name: string]: {
    type: "file" | "directory";
    size: number;
    modifiedTime: Date;
    source: "remote" | "local";
    status?: "modified" | "missing" | "unchanged";
    children: FileMap | {};
  };
};
