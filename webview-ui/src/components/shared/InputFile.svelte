<script lang="ts">
	/*
		A never-ending reactive statement will occur if you add `bind:this={inputs[i]}` to the radio input below.
		
		Things that fix the problem:
			- non-keyed each instead of keyed
			- setting `_options` inside of `buildOptions` instead of setting it in the reactive statement
	*/
    export let formField;
	export let files;

</script>

<input-input>
		<label>
			{#if formField.label}{formField.label}{/if}
			<input type="file" id={formField.name} name={formField.name} bind:files />
		</label>
</input-input>

<style>
</style>
