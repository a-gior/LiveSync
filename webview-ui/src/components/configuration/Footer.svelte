<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
    import { onMount } from "svelte";
    import { Form } from "../types/formTypes";
	import { vscode } from "./../../utilities/vscode";
    import { inputValidator } from "../../utilities/inputValidator";
    
    import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
    import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
    import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
    import { WorkspaceFolder } from "vscode";
    
    const state: ConfigurationState = vscode.getState();

	provideVSCodeDesignSystem().register(vsCodeButton());
    export let remoteServerConfigFormData: Form;
    export let fileEventActions: Form;
    export let patterns: string[];
    export let workspaceFolders: WorkspaceFolder[];
    export let selectedFolder: WorkspaceFolder;

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
        const currentPassword = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[3].value;
        const currentPrivateKeyPath = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value;
        const currentPassphrase = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5].value;
        const currentRemotePath =  remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[6].value;

        const currentConfig: ConfigurationMessage["configuration"] = {
            hostname: currentHostname,
            port: Number(currentPort),
            username: currentUsername,
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
            workspaceFolders: workspaceFolders,
            selectedFolder: selectedFolder
        };

        vscode.setState(confState);
        vscode.postMessage(configurationMessage);
    }

    function loadConfig() {
        const configurationMessage: FullConfigurationMessage = {
            command: "loadConfig",
            workspaceFolders: workspaceFolders,
            selectedFolder: selectedFolder
        };
        vscode.postMessage(configurationMessage);
    }
  </script>
  

  <footer-container>
    {#if workspaceFolders.length > 1}
    <label for="folder-select">Workspace :</label>
    <select id="folder-select" bind:value={selectedFolder.uri} on:change={loadConfig}>
        {#each workspaceFolders as folder}
            <option value={folder.uri}>{folder.name}</option>
        {/each}
    </select>
    {/if}
    <btn-group>
        <vscode-button on:keydown on:click={testConnection}>Test Connection</vscode-button>
        <vscode-button on:keydown on:click={saveForms}>Save</vscode-button>
    </btn-group>
  </footer-container>
  
  <style>
    footer-container label {
        display: inline-flex;
        align-items: center;

        font-weight: 100;
        color: var(--vscode-editor-foreground);

        margin-right: 0.1rem;
        white-space: nowrap;  

        min-width: 6.5rem;
    }

    btn-group {
        margin-left: auto;
        gap: 0.1rem;
    }

    vscode-button {
        margin-left: 1rem;
    }

    footer-container select {
        flex: 0 0 30%;

        /* background & border */
        border: 1px solid #969696;
        border-radius: 2px;
        padding: 0.4rem 1.2rem 0.4rem 0.6rem;

        /* smooth focus transition */
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    /* Styles for the footer container */
    footer-container {
        border-top: 1px solid #969696;
        background-color: var(--vscode-editorGroup-border); /* Background color for the footer */
        padding: 10px 20px; /* Padding for spacing inside the footer */
        text-align: right; /* Aligns the button to the right */
        display: flex;
    }
  </style>