import { Message } from "./Message";

export interface ConfigurationMessage extends Message {
  command: string;
  configuration: {
    hostname: string;
    port: number;
    username: string;
    authMethod: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
  };
}
