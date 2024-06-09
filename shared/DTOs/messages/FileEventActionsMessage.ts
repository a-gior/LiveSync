import { Message } from "./Message";

export interface FileEventActionsMessage extends Message {
  command: string;
  actions: {
    actionOnSave: string;
    actionOnCreate: string;
    actionOnDelete: string;
    actionOnMove: string;
  };
}
