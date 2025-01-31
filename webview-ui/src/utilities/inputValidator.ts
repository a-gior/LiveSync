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
    return usernameInput.value.trim().length >= 4;
  };

  isValidPassword = (passwordInput: HTMLInputElement): boolean => {
    // Implement password validation logic (e.g., strength requirements)
    // Example validation: check for minimum length
    return passwordInput.value.length >= 6;
  };

  isValidPath = (pathInput: HTMLInputElement): boolean => {
    // Regular expression to match Windows, Linux, relative, and home directory (~) paths
    const pathRegex =
      /^(?:[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)*|~\/(?:[^/]+\/?)*|\/(?:[^/]+\/?)*|[^/\\:*?"<>|\r\n]+(?:\/[^/\\:*?"<>|\r\n]*)*)$/;

    return pathRegex.test(pathInput.value);
  };

  areValidInputs(form: Form): boolean {
    let isValid = true;

    for (const [, formGroup] of Object.entries(form.formGroups)) {
      for (const formField of formGroup.fields) {
        // Clear any previous error message
        if (formField.htmlElement) {
          const existingError = formField.htmlElement.querySelector(".error-message");
          if (existingError) {
            existingError.remove();
          }
        }

        // Check required and visible fields
        if (formField.visible && formField.required && !formField.value && !formField.files) {
          // Add error message
          errorDisplayer.display(formField.htmlElement, `${formField.name} is required.`);
          isValid = false;
          continue;
        }

        // Check custom validation callback
        if (formField.htmlElement && formField.validationCallback) {
          const htmlInputElement = formField.htmlElement.querySelector("input");
          if (!formField.validationCallback(htmlInputElement)) {
            // Add error message
            errorDisplayer.display(formField.htmlElement, `${formField.name} failed validation.`);
            isValid = false;
            continue;
          }
        }
      }
    }

    return isValid;
  }
}

export const inputValidator = new InputValidator();
