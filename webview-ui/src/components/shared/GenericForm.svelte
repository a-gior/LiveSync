<script lang="ts">
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeCheckbox,
    } from "@vscode/webview-ui-toolkit";
    import type { Form } from "../types/formTypes";
    import FormRow from "./FormRow.svelte";
    import CloseIcon from "@resources/icons/close.svelte";

    export let formData: Form;
    export let onSubmit: CallableFunction = null;

    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    function handleSubmit(event) {
        console.log("Form submitted, source: ", event.srcElement);
        if (onSubmit) {
            onSubmit(event);
        }
    }

    function removeFormGroup(event) {
        const formGroupId = event.target.closest('form-group').getAttribute('id');
        delete formData.formGroups[formGroupId];
        formData = formData;
    }
</script>

<generic-form>
    {#if formData}
        {#if formData.title}
            <h2>{formData.title}</h2>
        {/if}
        <form id={formData.id} on:submit|preventDefault={handleSubmit}>
            {#each Object.entries(formData.formGroups) as [formGroupId, formGroup] (formGroupId)}
                {#if formGroup.visible}
                    <form-group id={formGroupId}>
                        <div class="form-separator"></div>
                        <vscode-button><close-icon on:click={removeFormGroup} ><CloseIcon /></close-icon></vscode-button>
                        {#if formGroup.title}
                            <h3>{formGroup.title}</h3>
                        {/if}
                        {#if formGroup.fields}
                            {#each formGroup.fields as formField}
                                {#if formField.visible && formField.name && formField.type && formField.required}
                                    <FormRow
                                        bind:formField
                                        inputType={formField.type}
                                        on:change
                                        bind:node={formField.htmlElement}
                                    />
                                {/if}
                            {/each}
                        {/if}
                    </form-group>
                {/if}
            {/each}
            {#if formData.hasSubmitButton}
                <vscode-button type="submit">
                    {#if formData.submitButtonName}
                        {formData.submitButtonName}
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
        float: right;
        cursor: pointer;
    }
    generic-form {
        display: block;
        padding: 10px;
        margin-top: 1%;
        border: 1px solid #969696;
    }

    /* Separator style */
    .form-separator {
        border-bottom: 1px solid #404040; /* Adds a line to separate sections */
        margin-top: 5px;
        margin-bottom: 5px;
    }

    vscode-button[type="submit"] {
        margin-top: 15px;
    }
</style>
