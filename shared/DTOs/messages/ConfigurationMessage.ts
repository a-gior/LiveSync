import { ConnectionSettings } from "../config/ConnectionSettings";
import { Message } from "./Message";

// DTO that represents a message that contains the configuration of a connection.
export interface ConfigurationMessage extends Message {
  command: string;
  configuration: ConnectionSettings;
}
