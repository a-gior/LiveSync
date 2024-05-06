<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
    import type { Form } from '../types/formTypes';

    import FormRow from "./FormRow.svelte";
    export let form: Form;

    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

    function handleSubmit(event) {
        console.log("Form submitted", event);
    }
</script>

<generic-form>
{#if form}
    {#if form.title}
        <h2>{form.title}</h2>
    {/if}
    <form on:submit|preventDefault={handleSubmit}>
        {#each form.formGroups as formGroup}
            {#if formGroup.visible}
                {#if formGroup.title}
                    <h3>{formGroup.title}</h3>
                {/if}
                {#if formGroup.fields}
                    {#each formGroup.fields as formField}
                        {#if formField.visible && formField.name && formField.type && formField.required}
                            <FormRow bind:formField inputType={formField.type} on:change bind:node={formField.htmlElement}/>
                        {/if}
                    {/each}
                {/if}
            {/if}
        {/each}
        {#if form.hasSubmitButton}
            <vscode-button type="submit">Submit</vscode-button>
        {/if}
    </form>
{/if}
</generic-form>

<style>
    generic-form {
        display: block;
        padding: 10px;
        margin-top: 1%;
        border: 1px solid #969696;
    }
</style>