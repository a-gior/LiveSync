import { FileEventActions } from "../config/FileEventActions";
import { Message } from "./Message";

// DTO that represents a message that contains the actions that should be taken on file events.
export interface FileEventActionsMessage extends Message {
  command: string;
  actions: FileEventActions;
}
