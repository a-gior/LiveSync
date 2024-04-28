import { SFTPError } from "../sftpErrorDTO";

// Define a DTO for the configuration message
export interface ErrorsMessage {
    command: string;
    errors: SFTPError[];
}