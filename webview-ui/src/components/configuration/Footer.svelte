<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
    import { Form } from "../types/formTypes";
	import { vscode } from "./../../utilities/vscode";
    import { inputValidator } from "../../utilities/inputValidator";
    
    import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
    import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
    import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
    import IgnoreList from "./IgnoreList.svelte";
    

	provideVSCodeDesignSystem().register(vsCodeButton());
    export let remoteServerConfigFormData: Form;
    export let pairFolderFormData: Form;
    export let fileEventActions: Form;
    export let patterns: string[];

    function saveForms() {
        if (inputValidator.areValidInputs(remoteServerConfigFormData)) {
            // Proceed with form submission or other actions
            sendConfiguration("updateConfiguration");
            console.log("Form submitted successfully");
        } else {
            console.log("Form not submitted, validation failed");
        }
    }

    function testConnection() {
        // Perform validation checks
        if (inputValidator.areValidInputs(remoteServerConfigFormData)) {
            // Proceed with form submission or other actions
            sendConfiguration("testConnection");
            console.log("Valid inputs, we send the test connection");
        } else {
            console.log("Inputs not valid");
        }
    }
    
    function sendConfiguration(cmd: string) {
        
        const currentHostname = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value;
        const currentPort = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value;
        const currentUsername = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value;
        const currentAuthMethod = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[3].value;
        const currentPassword = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value;
        const sshKeyInput = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5];

        const currentConfig = {
            hostname: currentHostname,
            port: Number(currentPort),
            username: currentUsername,
            authMethod: currentAuthMethod,
            password: currentPassword,
            // sshKey: form.formGroups[0].fields[5].value, //htmlElement.querySelector("input[type='file']").files[0].path, // sshKeyInput?.files[0].path
            sshKey: sshKeyInput.files ? (sshKeyInput.files[0] as any).path : null, 
        };

        const currentPairedFolders = Object.entries(pairFolderFormData.formGroups).map(([key, form]): PairFoldersMessage["paths"] => ({
            localPath: form.fields[0].value,
            remotePath: form.fields[1].value
        }))

        const currentActionOnUpload =  fileEventActions.formGroups["file-event-actions-form-group-0"].fields[0].value;
        const currentActionOnSave =  fileEventActions.formGroups["file-event-actions-form-group-0"].fields[1].value;
        const currentActionOnCreate =  fileEventActions.formGroups["file-event-actions-form-group-0"].fields[2].value;
        const currentActionOnDelete =  fileEventActions.formGroups["file-event-actions-form-group-0"].fields[3].value;
        const currentActionOnMove =  fileEventActions.formGroups["file-event-actions-form-group-0"].fields[4].value;

        const currentFileEventActions = {
            actionOnUpload: currentActionOnUpload,
            actionOnSave: currentActionOnSave,
            actionOnCreate: currentActionOnCreate,
            actionOnDelete: currentActionOnDelete,
            actionOnMove: currentActionOnMove
        }

        const confState: ConfigurationState = { 
            configuration: currentConfig,
            pairedFolders: currentPairedFolders,
            fileEventActions: currentFileEventActions,
            ignoreList: patterns
        };

        const configurationMessage: FullConfigurationMessage = {
            command: cmd,
            ...confState
        };
        
        vscode.setState(confState);

        vscode.postMessage(configurationMessage);
    }
  </script>
  

  <footer-container>
    <vscode-button id="test-connection-button" on:click={testConnection}>Test Connection</vscode-button>
    <vscode-button class="save-button" on:click={saveForms}>Save</vscode-button>
  </footer-container>
  
  <style>
    vscode-button {
        margin: 0 5px;
    }

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