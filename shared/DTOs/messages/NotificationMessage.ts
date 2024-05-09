import { Message } from "./Message";

// Define a DTO for the configuration message
export interface NotificationMessage extends Message {
  command: string;
  msg: string;
}
