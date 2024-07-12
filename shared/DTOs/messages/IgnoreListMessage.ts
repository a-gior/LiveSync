import { Message } from "./Message";

export interface IgnoreListMessage extends Message {
  command: string;
  ignoreList: string[];
}
