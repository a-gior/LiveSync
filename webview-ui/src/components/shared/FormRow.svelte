<script lang="ts">

    import type { FormField } from '../types/formTypes';
    import { onMount } from "svelte";
    import { errorDisplayer } from "./../../utilities/errorDisplayer";
    import RadioList from './RadioList.svelte';
    import InputFile from './InputFile.svelte';
    
    export let formField: FormField;
    export let inputType= "text";
    export let node;
    let inputElement;
    
    onMount(() => {
        if(inputElement) {
            inputElement.type = inputType;
        }
    });

    function isValid(event, validationCallback: CallableFunction) {
        if(!validationCallback(event.target)) {
            errorDisplayer.display(event.target, "top", "Invalid format");
        } 
    }
    
    let options = formField.options;
</script>

<form-row bind:this={node}>
    
    <div class="form-separator"></div>
    
    {#if inputType === 'checkbox' && options} <!-- TODO: NOT TESTED, PROBABLY DONT WORK -->
        {#each options as option}
            <label>
                <input type="checkbox" id={option.value} name={formField.name} bind:value={option.value} required={formField.required}/>
                {option.label}
            </label>
        {/each}
    {:else if inputType === 'radio' && options}
        <RadioList {options} on:change bind:selectedRadio={formField.value} />
    {:else if inputType === 'select' && options} <!-- TODO: NOT TESTED, PROBABLY DONT WORK -->
        {#if options}
            <select id={formField.name} name={formField.name} bind:value={formField.value} required={formField.required} on:change={e => isValid(e, formField.validationCallback)}>
                {#each options as option}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        {/if}
    {:else if inputType === 'file'}
        <InputFile {formField} bind:files={formField.files}/>
    {:else}
    
        {#if formField.label}
            <label for={formField.name}>{formField.label}:</label>
        {/if}
        <input bind:this={inputElement} id={formField.name} name={formField.name} bind:value={formField.value} required={formField.required} on:change={e => isValid(e, formField.validationCallback)} />
    {/if}
</form-row>

<style>
    form-row {
        padding-left: 15px;
    }

</style>