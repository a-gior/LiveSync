<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
    import { Form } from "../types/formTypes";
	import { vscode } from "./../../utilities/vscode";
    import { inputValidator } from "../../utilities/inputValidator";
    
    import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
    import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
    import IgnoreList from "./IgnoreList.svelte";
    import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
    

	provideVSCodeDesignSystem().register(vsCodeButton());
    export let remoteServerConfigFormData: Form;
    export let fileEventActions: Form;
    export let patterns: string[];

    function saveForms() {
        if (inputValidator.areValidInputs(remoteServerConfigFormData)) {
            // Proceed with form submission or other actions
            sendConfiguration("updateConfiguration");
        } 
    }

    function testConnection() {
        // Perform validation checks
        if (inputValidator.areValidInputs(remoteServerConfigFormData)) {
            // Proceed with form submission or other actions
            sendConfiguration("testConnection");
        }
    }
    
    async function sendConfiguration(cmd: string) {
        const currentHostname = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value;
        const currentPort = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value;
        const currentUsername = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value;
        const currentAuthMethod = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[3].value;
        const currentPassword = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value;
        const currentPrivateKeyPath = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5].value;
        const currentPassphrase = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[6].value;
        const currentRemotePath =  remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[7].value;

        const currentConfig: ConfigurationMessage["configuration"] = {
            hostname: currentHostname,
            port: Number(currentPort),
            username: currentUsername,
            authMethod: currentAuthMethod,
            password: currentPassword,
            privateKeyPath: currentPrivateKeyPath,
            passphrase: currentPassphrase,
        };

        const currentActionOnUpload = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[0].value;
        const currentActionOnDownload = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[1].value;
        const currentActionOnSave = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[2].value;
        const currentActionOnCreate = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[3].value;
        const currentActionOnDelete = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[4].value;
        const currentActionOnMove = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[5].value;
        const currentActionOpen = fileEventActions.formGroups["file-event-actions-form-group-0"].fields[6].value;

        const currentFileEventActions = {
            actionOnUpload: currentActionOnUpload,
            actionOnDownload: currentActionOnDownload,
            actionOnSave: currentActionOnSave,
            actionOnCreate: currentActionOnCreate,
            actionOnDelete: currentActionOnDelete,
            actionOnMove: currentActionOnMove,
            actionOnOpen: currentActionOpen,
        };

        const confState: ConfigurationState = {
            configuration: currentConfig,
            remotePath: currentRemotePath,
            fileEventActions: currentFileEventActions,
            ignoreList: patterns,
        };

        const configurationMessage: FullConfigurationMessage = {
            command: cmd,
            ...confState,
        };

        vscode.setState(confState);
        vscode.postMessage(configurationMessage);
    }

  </script>
  

  <footer-container>
    <vscode-button class="left-button" id="test-connection-button" on:click={testConnection}>Test Connection</vscode-button>
    <vscode-button class="save-button" on:click={saveForms}>Save</vscode-button>
  </footer-container>
  
  <style>
    vscode-button {
        margin: 0 5px;
    }

    footer-container .left-button {
        float: left;
    }

    /* Styles for the footer container */
    footer-container {
        border-top: 1px solid #969696;
        background-color: var(--vscode-editorGroup-border); /* Background color for the footer */
        padding: 10px 20px; /* Padding for spacing inside the footer */
        text-align: right; /* Aligns the button to the right */
    }
  </style>