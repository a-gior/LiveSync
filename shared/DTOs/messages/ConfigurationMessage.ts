import { Message } from "./Message";

// DTO that represents a message that contains the configuration of a connection.
export interface ConfigurationMessage extends Message {
  command: string;
  configuration: {
    hostname: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
  };
}
