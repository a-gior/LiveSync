<script lang="ts">
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeCheckbox,
    } from "@vscode/webview-ui-toolkit";
    import type { Form } from "../types/formTypes";
    import FormRow from "./FormRow.svelte";
    import CloseIcon from "@resources/icons/close.svelte";
    import { get, Writable } from "svelte/store";

    export let formDataStore: Writable<Form>;
    export let onSubmit: CallableFunction = null;
    export let onChange: CallableFunction = null;

    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    function handleSubmit(event) {
        console.log("Form submitted, source: ", event.srcElement);
        if (onSubmit) {
            onSubmit(event);
        }
    }

    function handleChange(event) {
        console.log("Input Changed, source", event.srcElement);
        if (onChange) {
            onChange(event);
        }
    }

    function removeFormGroup(event) {
        const formGroupId = event.target.closest('form-group').getAttribute('id');
        delete get(formDataStore).formGroups[formGroupId];
        formDataStore = formDataStore;
    }

    function addNewGroup() {
        const index = Object.keys(get(formDataStore).formGroups).length;

        formDataStore.update(formData => {
            return {
                ...formData,
                formGroups: {
                    ...formData.formGroups,
                    [`form-group-${index}`]: {
                        ...formData.newFormGroupTemplate,
                    },
                }
            };  
        });
    }
</script>

<generic-form>
    {#if get(formDataStore)}
        <form id={get(formDataStore).id} on:submit|preventDefault={handleSubmit}>
            {#each Object.entries(get(formDataStore).formGroups) as [formGroupId, formGroup] (formGroupId)}
                {#if formGroup.visible}
                    <form-group id={formGroupId}>

                        {#if formGroup.deletable}
                            <close-icon on:click={removeFormGroup} ><CloseIcon /></close-icon>
                        {/if}

                        {#if formGroup.title}
                            <h3>{formGroup.title}</h3>
                        {/if}
                        {#if formGroup.fields}
                            {#each formGroup.fields as formField}
                                {#if formField.visible && formField.name && formField.type}
                                    <FormRow
                                        bind:formField
                                        inputType={formField.type}
                                        on:change={handleChange}
                                        bind:node={formField.htmlElement}
                                    />
                                {/if}
                            {/each}
                        {/if}
                    </form-group>
                {/if}
            {/each}
            {#if get(formDataStore).canAddFormGroups}
                <vscode-button type="button" on:click={addNewGroup}>Add</vscode-button>
            {/if}
            {#if get(formDataStore).hasSubmitButton}
                <vscode-button type="submit">
                    {#if get(formDataStore).submitButtonName}
                        {get(formDataStore).submitButtonName}
                    {:else}
                        Submit
                    {/if}
                </vscode-button>
            {/if}
        </form>
    {/if}
</generic-form>

<style>
    close-icon {
        width: 10px;
        height: 10px;
        float: right;
        cursor: pointer;
    }

    generic-form {
        display: block;
        /* padding: 10px;
        margin-top: 1%;
        border: 1px solid #969696; */
    }

    vscode-button[type="submit"] {
        margin-top: 15px;
    }
</style>
