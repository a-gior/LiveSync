// Define a DTO for the configuration message
export interface ConfigurationMessage {
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
