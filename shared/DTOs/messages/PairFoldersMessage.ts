import { Message } from "./Message";

// Define a DTO for the configuration message
export interface PairFoldersMessage extends Message {
  command: string;
  paths: {
    localPath: string;
    remotePath: string;
  };
}
