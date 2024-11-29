import { Message } from "./Message";

export interface FileEventActionsMessage extends Message {
  command: string;
  actions: {
    actionOnUpload: string;
    actionOnDownload: string;
    actionOnSave: string;
    actionOnCreate: string;
    actionOnDelete: string;
    actionOnMove: string;
  };
}
