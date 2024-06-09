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
    
	provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    function checkAuthMethod(event) {
        remoteServerConfigFormData["formGroups"]["remote-server-form-group-0"].fields[4]["visible"] = (event.target.value === "auth-password");
        remoteServerConfigFormData["formGroups"]["remote-server-form-group-0"].fields[5]["visible"] = (event.target.value === "auth-sshKey");
    }

    function setInitialConfiguration(confState: ConfigurationState) {
        vscode.setState(confState);

        if(confState.configuration) {
            // Access configuration values from initialState
            const { hostname, port, username, authMethod, password, sshKey } = confState.configuration;

            // Set the initial values of the form fields
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value = hostname;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value = port.toString();
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value = username;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value = password;
        }
        
        if(confState.pairedFolders) {

            let i = 0;
            for(const pairedFolder of confState.pairedFolders) {
                newPairFolders();
                pairFolderFormData.formGroups["pair-folder-form-group-"+i].fields[0].value = pairedFolder.localPath
                pairFolderFormData.formGroups["pair-folder-form-group-"+i].fields[1].value = pairedFolder.remotePath;
                i++;
            }
        }

    }

    // Create the form object
    let remoteServerConfigFormData: Form = {
        title: "Remote Server Configuration",
        hasSubmitButton: false,
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
        formGroups: {
            // Added dynamically
        }
    }

    function newPairFolders() {
        const index = Object.keys(pairFolderFormData.formGroups).length; // = index + 1 or initialize it to 0

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
    
    window.addEventListener("message", function (event) {
        console.log("Received postMessage", event);
        // Get initial state from the webview's state
        const data = event.data;

        switch (data.command) {
            case "setInitialConfiguration":
                const configState: ConfigurationState = {
                    configuration: data.configuration,
                    pairedFolders: data.pairedFolders
                }
                setInitialConfiguration(configState);
                break;
            case "showNotif":
                break;
            case "showError":
                break;
        }
    });

    onMount(() => {
        const previousState: {} = vscode.getState();
        if (previousState && Object.keys(previousState).length > 0) {
            // Use a type assertion to inform TypeScript about the type of config
            const confState = previousState as ConfigurationState;
            const configState: ConfigurationState = {
                configuration: confState.configuration,
                pairedFolders: confState.pairedFolders
            }
            // Now you can safely access the config property
            setInitialConfiguration(configState);
        }

    });
    
    function savePairFolders(event) {
        pairFolderFormData = pairFolderFormData; 
        const pairFoldersMessage: FullConfigurationMessage = {
            command: "savePairFolders",
            pairedFolders: Object.entries(pairFolderFormData.formGroups).map(([key, form]): PairFoldersMessage["paths"] => ({
                localPath: form.fields[0].value,
                remotePath: form.fields[1].value
            }))
        };
        const currentState: ConfigurationState = vscode.getState();

        // Update State with new paired Folders and send postMessage
        vscode.setState({...currentState, pairedFolders: pairFoldersMessage.pairedFolders});
        vscode.postMessage(pairFoldersMessage);
    }

    $ : {
        console.log(remoteServerConfigFormData["formGroups"]["remote-server-form-group-0"].fields[4]);
        console.log(remoteServerConfigFormData["formGroups"]["remote-server-form-group-0"].fields[5]);
    }
    

</script>

<configuration-container>
    <main>
        <GenericForm bind:formData={remoteServerConfigFormData} on:change={checkAuthMethod}/>
        <GenericForm bind:formData={pairFolderFormData} on:change={checkAuthMethod} onSubmit={savePairFolders}/>
    </main>
    <Footer bind:remoteServerConfigFormData bind:pairFolderFormData on:click={newPairFolders}/>
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