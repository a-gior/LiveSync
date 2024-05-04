const form = document.getElementById("configurationForm");
const hostnameInput = document.getElementById("hostname");
const portInput = document.getElementById("port");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const sshKeyInput = document.getElementById("ssh-key");
const errorMessages = document.getElementById("errorMessages");

const vscode = acquireVsCodeApi();
let isFormValid = false;

// Set saved config if exists
const previousState = vscode.getState();
let config = previousState && previousState.config;
if (config) {
  this.setInitialConfiguration(config);
}

function toggleAuthMethod() {
  const authMethod = document.querySelector(
    'input[name="auth-method"]:checked',
  );
  if (authMethod.value === "password") {
    document.getElementById("password-input").style.display = "block";
    document.getElementById("ssh-input").style.display = "none";
  } else if (authMethod.value === "ssh") {
    document.getElementById("password-input").style.display = "none";
    document.getElementById("ssh-input").style.display = "block";
  }
}

function saveForms(event) {
  event.preventDefault(); // Prevent form submission

  // Perform validation checks
  if (areValidInputs()) {
    // Proceed with form submission or other actions
    vscode.setState({ config: getCurrentConfig() });
    sendConfiguration("updateConfiguration");
    console.log("Form submitted successfully");
  } else {
    console.log("Form not submitted, validation failed");
  }
}

function testConnection() {
  // Clear previous error messages
  errorMessages.innerHTML = "";

  // Perform validation checks
  if (areValidInputs()) {
    // Proceed with form submission or other actions
    sendConfiguration("testConnection");
    console.log("Valid inputs, we send the test connection");
  } else {
    console.log("Inputs not valid");
  }
}

function sendConfiguration(cmd) {
  const configurationMessage = {
    command: cmd,
    configuration: getCurrentConfig(),
  };
  vscode.postMessage(configurationMessage);
}

function areValidInputs() {
  // Validate input
  const authMethod = document.querySelector(
    'input[name="auth-method"]:checked',
  );
  isFormValid = true; // Clear previous error messages

  if (!isValidHostname(hostnameInput.value)) {
    displayError(hostnameInput, "Invalid hostname");
  }

  if (!isValidPort(portInput.value)) {
    displayError(portInput, "Invalid port");
  }

  if (!isValidUsername(usernameInput.value)) {
    displayError(usernameInput, "Invalid username");
  }

  if (authMethod.value === "password") {
    if (!isValidPassword(passwordInput.value)) {
      displayError(passwordInput, "Invalid password");
    }
  } else {
    const sshKeyFile = sshKeyInput.files[0];
    const reader = new FileReader();

    reader.onload = function (event) {
      const sshKeyContent = event.target.result;
      if (!isValidSSHKey(sshKeyContent)) {
        displayError(sshKeyInput, "Invalid SSH Key");
      }
    };

    reader.onerror = function () {
      displayError(sshKeyInput, "Error reading SSH key file");
    };

    console.log("SSHKey Input: ", sshKeyInput.files[0]);
    reader.readAsText(sshKeyFile);
  }

  if (isFormValid) {
    return true;
  }

  return false;
}

function isValidHostname(hostname) {
  // Check if hostname is a valid domain name or IP address
  // Example validation: regular expression for hostname or IP address format
  const hostnameRegex =
    /^(?:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}))$/;
  return hostnameRegex.test(hostname);
}

function isValidPort(port) {
  // Check if port is a valid number within the range 1-65535
  const portNumber = parseInt(port);
  return !isNaN(portNumber) && portNumber >= 1 && portNumber <= 65535;
}

function isValidUsername(username) {
  // Implement validation logic for username
  // Example validation: check for length or specific characters
  return username.trim().length >= 6;
}

function isValidPassword(password) {
  // Implement password validation logic (e.g., strength requirements)
  // Example validation: check for minimum length
  return password.length >= 6;
}

function isValidSSHKey(sshKey, isPublic = false) {
  // Check if SSH key has the expected format
  if (isPublic) {
    const sshKeyRegex =
      /^(ssh-(rsa|dsa|ed25519)\s+[A-Za-z0-9+/]+[=]{0,2}\s+\S+)$/;
  } else {
    const sshKeyRegex =
      /^-----BEGIN\s(?:RSA|DSA|EC|OPENSSH)\sPRIVATE\sKEY-----(?:[\s\S]*?)-----END\s(?:RSA|DSA|EC|OPENSSH)\sPRIVATE\sKEY-----$/m;
  }
  return sshKeyRegex.test(sshKey);
}

function displayError(elem, message) {
  if (
    elem.previousElementSibling &&
    elem.previousElementSibling.classList.contains("error-message")
  ) {
    // Error message already exists, do not create another one
    return;
  }
  isFormValid = false;

  const errorMessage = document.createElement("div");
  errorMessage.textContent = message;
  errorMessage.classList.add("error-message");
  elem.parentNode.insertBefore(errorMessage, elem); // Insert error message before the element

  // Add input-error class to highlight the input field
  elem.classList.add("input-error");

  // Remove the error message after 5 seconds
  setTimeout(() => {
    errorMessage.remove();
    elem.classList.remove("input-error");
  }, 3000);
}

window.addEventListener("message", function (event) {
  // Get initial state from the webview's state
  const data = event.data;

  switch (data.command) {
    case "setInitialConfiguration":
      setInitialConfiguration(data.configuration);
      break;
    case "showNotif":
      break;
    case "showError":
      break;
  }
});

function getCurrentConfig() {
  const authMethod = document.querySelector(
    'input[name="auth-method"]:checked',
  );
  return {
    hostname: hostnameInput.value,
    port: portInput.value,
    username: usernameInput.value,
    authMethod: authMethod?.value ?? null,
    password: passwordInput?.value ?? null,
    sshKey: sshKeyInput?.files[0].path ?? null,
  };
}

function setInitialConfiguration(config) {
  // Check if initialState is not null or undefined
  if (config) {
    // Access configuration values from initialState
    vscode.setState({ config: config });
    const { hostname, port, username, authMethod, password, sshKey } = config;

    // Set the initial values of the form fields
    hostnameInput.value = hostname;
    portInput.value = port;
    usernameInput.value = username;
    switch (authMethod) {
      case "password":
        document.getElementById("auth-password").checked = true;
        break;
      case "ssh":
        document.getElementById("auth-ssh").checked = true;
        break;
    }
    passwordInput.value = password ?? "";
  }

  // Initial call to show/hide inputs based on default selection
  toggleAuthMethod();
}
