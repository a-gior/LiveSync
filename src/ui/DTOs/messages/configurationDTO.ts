import { Message } from "./messageDTO";

// Define a DTO for the configuration message
export interface ConfigurationMessage extends Message {
  command: string;
  configuration: {
    hostname: string;
    port: number;
    username: string;
    authMethod?: string;
    password: string;
    sshKey: string | null; // Optional SSH key
  };
}
