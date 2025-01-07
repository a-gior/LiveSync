<!-- Configuration.svelte -->
<script lang="ts">
    import { onMount } from "svelte";
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeCheckbox,
    } from "@vscode/webview-ui-toolkit";
    import { vscode } from "./../utilities/vscode";
    import type { Form } from "./types/formTypes";
    import { inputValidator } from "../utilities/inputValidator";

    import Tabs from "./shared/Tabs.svelte";
    import Footer from "./configuration/Footer.svelte";

    import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
    
    import { configurationFormStore } from '../utilities/stores/configurationFormStore';

    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    // Form data definitions
    let remoteServerConfigFormData: Form = {
        title: "Remote Server Configuration",
        hasSubmitButton: false,
        id: "remote-server-form-data",
        formGroups: {
            "remote-server-form-group-0": {
                visible: true,
                deletable: false,
                fields: [
                    {
                        name: "host",
                        label: "Host",
                        type: "text",
                        required: true,
                        value: "",
                        visible: true,
                        validationCallback: inputValidator.isValidHostname,
                    },
                    {
                        name: "port",
                        label: "Port",
                        type: "number",
                        required: true,
                        value: "",
                        visible: true,
                        validationCallback: inputValidator.isValidPort,
                    },
                    {
                        name: "username",
                        label: "Username",
                        type: "text",
                        required: true,
                        value: "",
                        visible: true,
                        validationCallback: inputValidator.isValidUsername,
                    },
                    {
                        name: "authMethod",
                        type: "radio",
                        required: true,
                        value: "auth-password",
                        visible: true,
                        options: [
                            { label: "Password", value: "auth-password" },
                            { label: "SSH Key", value: "auth-sshKey" },
                        ],
                    },
                    {
                        name: "password",
                        label: "Password",
                        type: "password",
                        required: true,
                        value: "",
                        visible: true,
                        validationCallback: inputValidator.isValidPassword,
                    },
                    {
                        name: "sshKey",
                        label: "SSH Key",
                        type: "file",
                        required: true,
                        value: "",
                        visible: false,
                        validationCallback: inputValidator.isValidSSHKey,
                    },
                ],
            },
        },
    };

    let pairFolderFormData: Form = {
        title: "Paired Folders",
        hasSubmitButton: false,
        // submitButtonName: "Validate",
        id: "pair-folder-form-data",
        formGroups: {},
        canAddFormGroups: true,
        newFormGroupTemplate: {
            visible: true,
            deletable: true,
            fields: [
                {
                    name: "localFolder",
                    label: "Select a local folder",
                    type: "text",
                    required: true,
                    value: "",
                    visible: true,
                    validationCallback: inputValidator.isValidPath,
                },
                {
                    name: "remoteFolder",
                    label: "Select a remote folder",
                    type: "text",
                    required: true,
                    value: "",
                    visible: true,
                    validationCallback: inputValidator.isValidPath,
                },
            ],
        }
    };

    let fileEventActions: Form = {
        title: "File Handling Actions",
        hasSubmitButton: false,
        // submitButtonName: "Validate",
        id: "file-event-actions-form-data",
        formGroups: {
            "file-event-actions-form-group-0": {
                visible: true,
                deletable: false,
                fields: [
                    {
                        name: "actionOnUpload",
                        label: "Action on upload a file via the icon/command",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&upload",
                                value: "check&upload",
                                default: true,
                            },
                            { label: "upload", value: "upload" },
                            { label: "none", value: "none" },
                        ],
                    },
                    {
                        name: "actionOnDownload",
                        label: "Action on downloading a file via the icon/command",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&download",
                                value: "check&download",
                                default: true,
                            },
                            { label: "download", value: "download" },
                            { label: "none", value: "none" },
                        ],
                    },
                    {
                        name: "actionOnSave",
                        label: "Action on saving a file",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&save",
                                value: "check&save",
                                default: true,
                            },
                            { label: "save", value: "save" },
                            { label: "none", value: "none" },
                        ],
                    },
                    {
                        name: "actionOnCreate",
                        label: "Action on creating a file",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&create",
                                value: "check&create",
                                default: true,
                            },
                            { label: "create", value: "create"},
                            { label: "none", value: "none", default: true},
                        ],
                    },
                    {
                        name: "actionOnDelete",
                        label: "Action on deleting a file",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&delete",
                                value: "check&delete",
                                default: true,
                            },
                            { label: "delete", value: "delete" },
                            { label: "none", value: "none", default: true },
                        ],
                    },
                    {
                        name: "actionOnMove",
                        label: "Action on renaming/moving a file",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&move",
                                value: "check&move",
                                default: true,
                            },
                            { label: "move", value: "move" },
                            { label: "none", value: "none" },
                        ],
                    },
                    {
                        name: "actionOnOpen",
                        label: "Action on opening a file",
                        type: "select",
                        required: true,
                        value: "",
                        visible: true,
                        options: [
                            { label: "check", value: "check" },
                            {
                                label: "check&download",
                                value: "check&download",
                                default: true,
                            },
                            { label: "download", value: "download" },
                            { label: "none", value: "none" },
                        ],
                    }
                ],
            },
        },
    };

    let patterns = [];
    let tabs = [];

    $: configurationFormStore.setRemoteServerConfigFormData(remoteServerConfigFormData);
    $: configurationFormStore.setPairFolderFormData(pairFolderFormData);
    $: {configurationFormStore.setFileEventActions(fileEventActions);console.log("Reactive statement fileEventActions :", fileEventActions);}
    $: configurationFormStore.setPatterns(patterns);

    // Function to add new pair folders
    function newPairFolders() {
        const index = Object.keys(pairFolderFormData.formGroups).length;
        console.log(`<newPairFolders> new PairFolders ${index}`);

        pairFolderFormData = {
            ...pairFolderFormData,
            formGroups: {
                ...pairFolderFormData.formGroups,
                ["pair-folder-form-group-" + index]: {
                    visible: true,
                    deletable: true,
                    fields: [
                        {
                            name: "localFolder",
                            label: "Select a local folder",
                            type: "text",
                            required: true,
                            value: "",
                            visible: true,
                            validationCallback: inputValidator.isValidPath,
                        },
                        {
                            name: "remoteFolder",
                            label: "Select a remote folder",
                            type: "text",
                            required: true,
                            value: "",
                            visible: true,
                            validationCallback: inputValidator.isValidPath,
                        },
                    ],
                },
            },
        };
    }

    // Function to set initial configuration state
    function setInitialConfiguration(confState: ConfigurationState) {
        vscode.setState(confState);

        if (confState.configuration) {
            const { hostname, port, username, authMethod, password, sshKey } =  confState.configuration;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[0].value = hostname;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[1].value = port.toString();
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[2].value = username;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[3].value = authMethod;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[4].value = password;
            remoteServerConfigFormData.formGroups["remote-server-form-group-0"].fields[5].value = sshKey;
        }

        if (confState.pairedFolders) {
            console.log(`<setInitialConfiguration> PairedFolders`, confState.pairedFolders);
            let i = 0;
            for (const pairedFolder of confState.pairedFolders) {
                newPairFolders();
                pairFolderFormData.formGroups[
                    "pair-folder-form-group-" + i
                ].fields[0].value = pairedFolder.localPath;
                pairFolderFormData.formGroups[
                    "pair-folder-form-group-" + i
                ].fields[1].value = pairedFolder.remotePath;
                i++;
            }
        }

        if (confState.fileEventActions) {
            const {
                actionOnUpload,
                actionOnDownload,
                actionOnSave,
                actionOnCreate,
                actionOnDelete,
                actionOnMove,
                actionOnOpen,
            } = confState.fileEventActions;

            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[0].value = actionOnUpload;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[1].value = actionOnDownload;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[2].value = actionOnSave;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[3].value = actionOnCreate;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[4].value = actionOnDelete;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[5].value = actionOnMove;
            fileEventActions.formGroups["file-event-actions-form-group-0"].fields[6].value = actionOnOpen;
        }

        if (confState.ignoreList) {
            patterns = [...confState.ignoreList];
        }
    }

    // Handle incoming messages from VS Code
    window.addEventListener("message", function (event) {
        const data = event.data;
        switch (data.command) {
            case "setInitialConfiguration":
                const configState: ConfigurationState = {
                    configuration: data.configuration,
                    pairedFolders: data.pairedFolders,
                    fileEventActions: data.fileEventActions,
                    ignoreList: data.ignoreList,
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
        
        configurationFormStore.remoteServerConfigFormStore.subscribe(value => remoteServerConfigFormData = value);
        configurationFormStore.pairFolderFormStore.subscribe(value => pairFolderFormData = value);
        configurationFormStore.fileEventActionsStore.subscribe(value => {fileEventActions = value;console.log("subcription fileEventActionsStore", fileEventActions);});
        configurationFormStore.patternsStore.subscribe(value => patterns = value);

        const previousState: ConfigurationState = vscode.getState();
        if (previousState && Object.keys(previousState).length > 0) {
            setInitialConfiguration(previousState);
        }
    });
</script>

<configuration-container>
    <Tabs {tabs}/>
    <Footer
        bind:remoteServerConfigFormData
        bind:pairFolderFormData
        bind:fileEventActions
        bind:patterns
    />
</configuration-container>

<style>
    configuration-container {
        display: flex;
        flex-direction: column;
        height: 100vh; /* Make it take the full viewport height */
        margin: 0;
        overflow: hidden; /* Prevent the whole page from scrolling */
    }
</style>
