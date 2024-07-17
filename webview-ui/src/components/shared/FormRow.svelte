<script lang="ts">
    import type { FormField } from '../types/formTypes';
    import { onMount } from "svelte";
    import { errorDisplayer } from "./../../utilities/errorDisplayer";
    import RadioList from './RadioList.svelte';
    import InputFile from './InputFile.svelte';

    export let formField: FormField;
    export let inputType = "text";
    export let node;
    let inputElement;
    let options = formField.options;

    onMount(() => {
        if (inputElement && inputType !== 'select') {
            inputElement.type = inputType;
        }

        if(options && formField.value === '') {
            // Set the default value based on the options' default field if value is empty
            const defaultOption = options.find(option => option.default);
            if (defaultOption) {
                formField.value = defaultOption.value;
            }
        }
    });

    function isValid(event, validationCallback: CallableFunction) {
        if (validationCallback && !validationCallback(event.target)) {
            errorDisplayer.display(event.target, "top", "Invalid format");
        }
    }

    $: if (inputType === 'select' && options && formField.value) {
        let selectElement = inputElement;
        if (selectElement) {
            console.log("formField.value: ", formField.value);
            selectElement.value = formField.value;
        }
    }

</script>

<form-row bind:this={node}>
    {#if inputType === 'checkbox' && options} <!-- Checkbox input -->
        {#each options as option}
            <label>
                <input type="checkbox" id={option.value} name={formField.name} bind:value={option.value} required={formField.required}/>
                {option.label}
            </label>
        {/each}
    {:else if inputType === 'radio' && options} <!-- Radio input -->
        <RadioList {options} on:change bind:selectedRadio={formField.value} />
    {:else if inputType === 'select' && options} <!-- Select input -->
        {#if options}
        <label>
            {formField.label}:
            <select bind:this={inputElement} id={formField.name} name={formField.name} bind:value={formField.value} required={formField.required} on:change={e => isValid(e, formField.validationCallback)}>
            {#each options as option}
                <option value={option.value}>{option.label}</option>
            {/each}
            </select>
        </label>
            
        {/if}
    {:else if inputType === 'file'} <!-- File input -->
        <InputFile {formField} bind:files={formField.files}/>
    {:else} <!-- Default input type -->
        {#if formField.label}
            <label for={formField.name}>{formField.label}:</label>
        {/if}
        <input bind:this={inputElement} id={formField.name} name={formField.name} bind:value={formField.value} required={formField.required} on:change={e => isValid(e, formField.validationCallback)} />
    {/if}
</form-row>

<style>
    form-row {
        display: block;
        padding-left: 5px;
        margin-bottom: 20px;
    }
</style>
