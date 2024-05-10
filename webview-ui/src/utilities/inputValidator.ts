import { Form } from "../components/types/formTypes";
import { errorDisplayer } from "./errorDisplayer";

class InputValidator {
  isValidHostname = (hostnameInput: HTMLInputElement): boolean => {
    // Check if hostname is a valid domain name or IP address
    // Example validation: regular expression for hostname or IP address format
    const hostnameRegex =
      /^(?:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}))$/;
    return hostnameRegex.test(hostnameInput.value);
  };

  isValidPort = (portInput: HTMLInputElement): boolean => {
    // Check if port is a valid number within the range 1-65535
    const portNumber = parseInt(portInput.value);
    return !isNaN(portNumber) && portNumber >= 1 && portNumber <= 65535;
  };

  isValidUsername = (usernameInput: HTMLInputElement): boolean => {
    // Implement validation logic for username
    // Example validation: check for length or specific characters
    return usernameInput.value.trim().length >= 6;
  };

  isValidPassword = (passwordInput: HTMLInputElement): boolean => {
    // Implement password validation logic (e.g., strength requirements)
    // Example validation: check for minimum length
    return passwordInput.value.length >= 6;
  };

  isValidPath = (pathInput: HTMLInputElement): boolean => {
    // Regular expression to match a path Windows/Linux
    const pathRegex =
      /^(?:[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*|(?:\/(?:[^/]+\/)*[^/]+)?)$/;
    return pathRegex.test(pathInput.value);
  };

  isValidSSHKey = (
    sshKeyInput: HTMLInputElement,
    isPublic = false,
  ): Promise<boolean> => {
    // Check if SSH key has the expected format
    let sshKeyRegex: RegExp;
    if (isPublic) {
      sshKeyRegex = /^(ssh-(rsa|dsa|ed25519)\s+[A-Za-z0-9+/]+[=]{0,2}\s+\S+)$/;
    } else {
      sshKeyRegex =
        /^-----BEGIN\s(?:RSA|DSA|EC|OPENSSH)\sPRIVATE\sKEY-----(?:[\s\S]*?)-----END\s(?:RSA|DSA|EC|OPENSSH)\sPRIVATE\sKEY-----$/m;
    }

    const sshKeyFile = sshKeyInput.files[0];
    const reader = new FileReader();

    reader.onerror = function () {
      errorDisplayer.display(sshKeyInput, "top", "Error reading SSH key file");
    };

    reader.readAsText(sshKeyFile);

    return new Promise((resolve, reject) => {
      reader.onload = () =>
        function (event) {
          const sshKeyContent = String(event.target.result);
          if (typeof sshKeyContent === "string") {
            return resolve(sshKeyRegex.test(sshKeyContent));
          }

          resolve(false);
        };
    });
  };

  areValidInputs(form: Form): boolean {
    for (const [id, formGroup] of Object.entries(form.formGroups)) {
      for (const formField of formGroup.fields) {
        if (
          formField.visible &&
          formField.required &&
          !formField.value &&
          !formField.files
        ) {
          console.log(
            `FormField ${formField.name} is required and visible but has value/files : ${formField.value}`,
            formField.files,
          );
          return false;
        }

        if (formField.htmlElement && formField.validationCallback) {
          let htmlInputElement =
            formField.htmlElement.getElementsByTagName("input")[0];
          if (!formField.validationCallback(htmlInputElement)) {
            console.log("Validation failed on ", htmlInputElement);
            return false;
          }
        }
      }
    }

    return true;
  }
}

export const inputValidator = new InputValidator();
