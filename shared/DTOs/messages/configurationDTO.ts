import { Message } from "./messageDTO";

export interface ConfigurationMessage extends Message {
  command: string;
  configuration: {
    hostname: string;
    port: number;
    username: string;
    authMethod?: string;
    password?: string;
    sshKey?: string; // Optional SSH key
  };
}
