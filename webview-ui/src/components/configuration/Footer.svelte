<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
    import { Form } from "../types/formTypes";
	import { vscode } from "./../../utilities/vscode";
    import { inputValidator } from "../../utilities/inputValidator";
    
    import { ConfigurationState } from "@shared/DTOs/states/configurationState";

	provideVSCodeDesignSystem().register(vsCodeButton());
    export let form: Form;

    let sshKeyInput = form.formGroups[0].fields[5];
    $: currentConfig = {
        hostname: form.formGroups[0].fields[0].value,
        port: Number(form.formGroups[0].fields[1].value),
        username: form.formGroups[0].fields[2].value,
        authMethod: form.formGroups[0].fields[3].value,
        password: form.formGroups[0].fields[4].value,
        // sshKey: form.formGroups[0].fields[5].value, //htmlElement.querySelector("input[type='file']").files[0].path, // sshKeyInput?.files[0].path
        sshKey: sshKeyInput.files ? (sshKeyInput.files[0] as any).path : null, 
    };

    function saveForms() {
        if (inputValidator.areValidInputs(form)) {
            // Proceed with form submission or other actions
            const confState: ConfigurationState = { config: currentConfig };
            vscode.setState(confState);
            sendConfiguration("updateConfiguration");
            console.log("Form submitted successfully");
        } else {
            console.log("Form not submitted, validation failed");
        }
    }

    function testConnection() {
        // Perform validation checks
        if (inputValidator.areValidInputs(form)) {
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
        configuration: currentConfig,
    };
    vscode.postMessage(configurationMessage);
    }
  </script>
  

  <footer-container>
    <vscode-button id="test-connection-button" on:click={testConnection}>Test Connection</vscode-button>
    <vscode-button class="save-button" on:click={saveForms}>Save</vscode-button>
  </footer-container>
  
  <style>
    
    /* Styles for the footer container */
    footer-container {
    position: fixed; /* Fixed position to keep it at the bottom */
    left: 0;
    right: 0;
    bottom: 0;
    border-top: 1px solid #969696;
    background-color: #1a1a1a; /*var(--vscode-editor-background); TODO: change for vscode color later /* Even darker background color for the footer */
    padding: 10px 20px; /* Padding for spacing inside the footer */
    text-align: right; /* Aligns the button to the right */
    z-index: 1000; /* Ensures the footer is above other content */
    }
  </style>