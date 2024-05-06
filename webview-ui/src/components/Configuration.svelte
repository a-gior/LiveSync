<!-- Configuration.svelte -->
<script lang="ts">
    import { onMount } from 'svelte';
	import { provideVSCodeDesignSystem, vsCodeButton, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
	import { vscode } from "./../utilities/vscode";
    import type { Form, FormGroup } from './types/formTypes';
    import { inputValidator } from '../utilities/inputValidator';

    import GenericForm from './shared/GenericForm.svelte';
    import Footer from './configuration/Footer.svelte';
    
    import { ConfigurationMessage } from '@shared/DTOs/messages/configurationDTO';
    import { ConfigurationState } from '@shared/DTOs/states/configurationState';
    
	provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    function checkAuthMethod(event) {
        form["formGroups"][0]["fields"][4]["visible"] = (event.target.value === "auth-password");
        form["formGroups"][0]["fields"][5]["visible"] = (event.target.value === "auth-sshKey");
        form = form;
    }

    function setInitialConfiguration(config: ConfigurationMessage['configuration']) {

        console.log("setInitialConfiguration", config);
        // Check if initialState is not null or undefined
        if (config) {
            // Access configuration values from initialState
            const confState: ConfigurationState = { config: config };
            vscode.setState(confState);
            const { hostname, port, username, authMethod, password, sshKey } = config;

            // Set the initial values of the form fields
            form.formGroups[0].fields[0].value = hostname;
            form.formGroups[0].fields[1].value = port.toString();
            form.formGroups[0].fields[2].value = username;
            form.formGroups[0].fields[4].value = password;
        }
    }

    // Create the form object
    let form: Form = {
        title: "Remote Server Configuration",
        hasSubmitButton: false,
        formGroups: [
            {
                visible: true,
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
        ]
    };
    
    window.addEventListener("message", function (event) {
        console.log("Received postMessage", event);
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

    onMount(() => {
        const previousState: {} = vscode.getState();
        if (previousState && Object.keys(previousState).length > 0) {
            // Use a type assertion to inform TypeScript about the type of config
            const confState = previousState as ConfigurationState;
            console.log("Configuration: OnMount", confState);

            // Now you can safely access the config property
            setInitialConfiguration(confState.config);
        }

    });

</script>

<configuration-container>
    <GenericForm bind:form on:change={checkAuthMethod}/>
    <Footer bind:form/>
</configuration-container>

<style>
    configuration-container {
        width: 90%;
        margin-left: 2%;
    }
</style>