const form = document.getElementById('configurationForm');
const hostnameInput = document.getElementById('hostname');
const portInput = document.getElementById('port');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const sshKeyInput = document.getElementById('sshKey');
const errorMessages = document.getElementById('errorMessages');

let isFormValid = false;

function toggleAuthMethod() {
    var authMethod = document.getElementById('auth-method').value;
    if (authMethod === 'password') {
      document.getElementById('password-input').style.display = 'block';
      document.getElementById('ssh-input').style.display = 'none';
    } else if (authMethod === 'ssh') {
      document.getElementById('password-input').style.display = 'none';
      document.getElementById('ssh-input').style.display = 'block';
    }
}

function saveForms(event) {
    event.preventDefault(); // Prevent form submission

    // Validate input
    const authMethod = document.getElementById('auth-method').value;
    isFormValid = true; // Clear previous error messages

    if (!isValidHostname(hostnameInput.value)) {
        displayError(hostnameInput, 'Invalid hostname');
    }

    if (!isValidPort(portInput.value)) {
        displayError(portInput, 'Invalid port');
    }

    if (!isValidUsername(usernameInput.value)) {
        displayError(usernameInput, 'Invalid username');
    }

    if (authMethod === 'password') {
        if (!isValidPassword(passwordInput.value)) {
            displayError(passwordInput, 'Invalid password');
        }
    } else {
        const sshKeyFile = sshKeyInput.files[0];
        const reader = new FileReader();
    
        reader.onload = function(event) {
            const sshKeyContent = event.target.result;
            if (!isValidSSHKey(sshKeyContent)) {
                displayError(sshKeyInput, 'Invalid SSH Key');
            }
        };
            
        reader.onerror = function(event) {
            displayError(sshKeyInput, 'Error reading SSH key file');
        };

        reader.readAsText(sshKeyFile);
            
    }

    if (isFormValid) {
        // Proceed with form submission or other actions
        console.log('Form submitted successfully');
    } else {
        console.log('Form not submitted, validation failed');
    }
}

function isValidHostname(hostname) {
    // Check if hostname is a valid domain name or IP address
    // Example validation: regular expression for hostname or IP address format
    const hostnameRegex = /^(?:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|localhost|(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}))$/;
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
    return username.trim().length > 6;
}

function isValidPassword(password) {
    // Implement password validation logic (e.g., strength requirements)
    // Example validation: check for minimum length
    return password.length >= 8;
}

function isValidSSHKey(sshKey) {
    // Check if SSH key has the expected format
    const sshKeyRegex = /^(ssh-(rsa|dsa|ed25519)\s+[A-Za-z0-9+/]+[=]{0,2}\s+\S+)$/;
    return sshKeyRegex.test(sshKey);
}

function displayError(elem, message) {
    if (elem.previousElementSibling && elem.previousElementSibling.classList.contains('error-message')) {
        // Error message already exists, do not create another one
        return;
    }
    isFormValid = false;

    const errorMessage = document.createElement('div');
    errorMessage.textContent = message;
    errorMessage.classList.add('error-message');
    elem.parentNode.insertBefore(errorMessage, elem); // Insert error message before the element
    
    // Add input-error class to highlight the input field
    elem.classList.add('input-error');

    // Remove the error message after 5 seconds
    setTimeout(() => {
        errorMessage.remove();
        elem.classList.remove('input-error');
    }, 3000);
}