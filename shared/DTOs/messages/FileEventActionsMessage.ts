import { Message } from "./Message";

// DTO that represents a message that contains the actions that should be taken on file events.
export interface FileEventActionsMessage extends Message {
  command: string;
  actions: {
    actionOnUpload: string;
    actionOnDownload: string;
    actionOnSave: string;
    actionOnCreate: string;
    actionOnDelete: string;
    actionOnMove: string;
    actionOnOpen: string;
  };
}
