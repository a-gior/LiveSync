<!-- Configuration.svelte -->
<script lang="ts">
    import { onMount } from 'svelte';
    import { provideVSCodeDesignSystem, vsCodeButton, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
    import { vscode } from "./../utilities/vscode";
    import type { Form, FormGroup } from './types/formTypes';
    import { inputValidator } from '../utilities/inputValidator';

    import GenericForm from './shared/GenericForm.svelte';
    import Footer from './configuration/Footer.svelte';
    
    import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
    import { ConfigurationState } from '@shared/DTOs/states/ConfigurationState';
    import { utils } from 'src/utilities/utils';
    import { PairFoldersMessage } from '@shared/DTOs/messages/PairFoldersMessage';
    import { FullConfigurationMessage } from '@shared/DTOs/messages/FullConfigurationMessage';
    import { FileEventActionsMessage } from '@shared/DTOs/messages/FileEventActionsMessage';
    
    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    // Form data definitions
    let remoteServerConfigFormData: Form = {
        title: "Remote Server Configuration",
        hasSubmitButton: true,
        id: "remote-server-form-data",
        formGroups: {
            "remote-server-form-group-0": {
                visible: true,
                deletable: false,
                fields: [
                    { name: 'host', label: 'Host', type: 'text', required: true, value: '', visible: true, validationCallback: inputValidator.isValidHostname },
                    { name: 'port', label: 'Port', type: 'number', required: true, value: '', visible: true, validationCallback: inputValidator.isValidPort },
                    { name: 'username', label: 'Username', type: 'text', required: true, value: '', visible: true, validationCallback: inputValidator.isValidUsername },
                    {
                        name: 'authMethod',
                        type: 'radio',
                        required: true,
                        value: 'auth-password',
                        visible: true,
                        options: [
                            { label: 'Password', value: 'auth-password' },
                            { label: 'SSH Key', value: 'auth-sshKey' }
                        ]
                    },
                    { name: 'password', label: 'Password', type: 'password', required: true, value: '', visible: true, validationCallback: inputValidator.isValidPassword },
                    { name: 'sshKey', label: 'SSH Key', type: 'file', required: true, value: '', visible: false, validationCallback: inputValidator.isValidSSHKey }
                ]
            }
        }
    };

    let pairFolderFormData: Form = {
        title: "Paired Folders",
        hasSubmitButton: true,
        submitButtonName: "Validate",
        id: "pair-folder-form-data",
        formGroups: {}
    };

    let fileEventActions: Form = {
        title: "File Handling Actions",
        hasSubmitButton: true,
        submitButtonName: "Validate",
        id: "file-event-actions-form-data",
        formGroups: {
            "file-event-actions-form-group-0": {
                visible: true,
                deletable: false,
                fields: [
                    { name: 'actionOnSave', label: 'ActionOnSave', type: 'select', required: true, value: '', visible: true, options: [
                        {label: "check", value: "check"},
                        {label: "check&save", value: "check&save", default: true},
                        {label: "save", value: "save"},
                        {label: "none", value: "none"}
                    ]},
                    { name: 'actionOnCreate', label: 'ActionOnCreate', type: 'select', required: true, value: '', visible: true, options: [
                        {label: "check", value: "check"},
                        {label: "check&create", value: "check&create", default: true},
                        {label: "create", value: "create"},
                        {label: "none", value: "none"}
                    ]},
                    { name: 'actionOnDelete', label: 'ActionOnDelete', type: 'select', required: true, value: '', visible: true, options: [
                        {label: "check", value: "check"},
                        {label: "check&delete", value: "check&delete", default: true},
                        {label: "delete", value: "delete"},
                        {label: "none", value: "none"}
                    ]},
                    { name: 'actionOnMove', label: 'ActionOnMove', type: 'select', required: true, value: '', visible: true, options: [
                        {label: "check", value: "check"},
                        {label: "check&move", value: "check&move", default: true},
                        {label: "move", value: "move"},
                        {label: "none", value: "none"}
                    ]}
                ]
            }
        }
    };

    // Function to add new pair folders
    function newPairFolders() {
        const index = Object.keys(pairFolderFormData.formGroups).length;
        pairFolderFormData = {
            ...pairFolderFormData,
            formGroups: {
                ...pairFolderFormData.formGroups,
                ["pair-folder-form-group-"+index]: {
                    visible: true,
                    deletable: true,
                    fields: [
                        { name: 'localFolder', label: 'Select a local folder', type: 'text', required: true, value: '', visible: true, validationCallback: inputValidator.isValidPath},
                        { name: 'remoteFolder', label: 'Select a remote folder', type: 'text', required: true, value: '', visible: true, validationCallback: inputValidator.isValidPath}
                    ]
                }
            }
        };
    }

    // Function to check authentication method and set visibility
    function checkAuthMethod(event) {
        remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].visible = (event.target.value === "auth-password");
        remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5].visible = (event.target.value === "auth-sshKey");
    }

    // Function to set initial configuration state
    function setInitialConfiguration(confState: ConfigurationState) {
        vscode.setState(confState);

        if(confState.configuration) {
            const { hostname, port, username, authMethod, password, sshKey } = confState.configuration;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value = hostname;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value = port.toString();
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value = username;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value = password;
        }
        
        if(confState.pairedFolders) {
            let i = 0;
            for(const pairedFolder of confState.pairedFolders) {
                newPairFolders();
                pairFolderFormData.formGroups["pair-folder-form-group-"+i].fields[0].value = pairedFolder.localPath;
                pairFolderFormData.formGroups["pair-folder-form-group-"+i].fields[1].value = pairedFolder.remotePath;
                i++;
            }
        }
        
        if(confState.fileEventActions) {
            let i = 0;
            const { actionOnSave, actionOnCreate, actionOnDelete, actionOnMove} = confState.fileEventActions;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[0].value = actionOnSave;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[1].value = actionOnCreate;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[2].value = actionOnDelete;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[3].value = actionOnMove;
        }
    }

    // Function to save paired folders configuration
    function savePairFolders(event) {
        const pairFoldersMessage: FullConfigurationMessage = {
            command: "updateConfiguration",
            pairedFolders: Object.entries(pairFolderFormData.formGroups).map(([key, form]): PairFoldersMessage["paths"] => ({
                localPath: form.fields[0].value,
                remotePath: form.fields[1].value
            }))
        };

        const currentState: ConfigurationState = vscode.getState();
        vscode.setState({ ...currentState, pairedFolders: pairFoldersMessage.pairedFolders });
        vscode.postMessage(pairFoldersMessage);
    }

    function saveRemoteServerConfiguration(event) {
        const sshKeyInput = remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5];
        const configurationMessage: FullConfigurationMessage = {
            command: "updateConfiguration",
            configuration: {
                hostname: remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value,
                port: parseInt(remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value),
                username: remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value,
                authMethod: remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[3].value,
                password: remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value,
                sshKey: sshKeyInput.files ? (sshKeyInput.files[0] as any).path : null
            }
        };
        const currentState: ConfigurationState = vscode.getState();

        // Update State with new remote server configuration and send postMessage
        vscode.setState({...currentState, configuration: configurationMessage.configuration});
        vscode.postMessage(configurationMessage);
    }

    function saveFileEventActions(event) {
        const fileEventActionsMessage: FileEventActionsMessage = {
            command: "updateConfiguration",
            actions: {
                actionOnSave: fileEventActions.formGroups["file-event-actions-form-group-0"].fields[0].value,
                actionOnCreate: fileEventActions.formGroups["file-event-actions-form-group-0"].fields[1].value,
                actionOnDelete: fileEventActions.formGroups["file-event-actions-form-group-0"].fields[2].value,
                actionOnMove: fileEventActions.formGroups["file-event-actions-form-group-0"].fields[3].value
            }
        };
        const currentState: ConfigurationState = vscode.getState();

        // Update State with new file event actions and send postMessage
        vscode.setState({...currentState, fileEventActions: fileEventActionsMessage.actions});
        vscode.postMessage(fileEventActionsMessage);
    }

    // Handle incoming messages from VS Code
    window.addEventListener("message", function (event) {
        const data = event.data;
        switch (data.command) {
            case "setInitialConfiguration":
                const configState: ConfigurationState = {
                    configuration: data.configuration,
                    pairedFolders: data.pairedFolders,
                    fileEventActions: data.fileEventActions
                };
                setInitialConfiguration(configState);
                break;
            case "showNotif":
                // Handle notification
                break;
            case "showError":
                // Handle error
                break;
        }
    });

    // On component mount, set initial state
    onMount(() => {
        const previousState: ConfigurationState = vscode.getState();
        if (previousState && Object.keys(previousState).length > 0) {
            setInitialConfiguration(previousState);
        }
    });
</script>

<configuration-container>
    <main>
        <GenericForm bind:formData={remoteServerConfigFormData} on:change={checkAuthMethod} onSubmit={saveRemoteServerConfiguration} />
        <GenericForm bind:formData={pairFolderFormData} onSubmit={savePairFolders}/>
        <GenericForm bind:formData={fileEventActions} onSubmit={saveFileEventActions} />
    </main>
    <Footer bind:remoteServerConfigFormData bind:pairFolderFormData bind:fileEventActions on:click={newPairFolders} />
</configuration-container>

<style>
    configuration-container {
        width: 90%;
        margin-left: 2%;
    }

    configuration-container main {
        margin-bottom: 5%;
    }
</style>
