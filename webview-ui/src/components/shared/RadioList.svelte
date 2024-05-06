<script lang="ts">
	/*
		A never-ending reactive statement will occur if you add `bind:this={inputs[i]}` to the radio input below.
		
		Things that fix the problem:
			- non-keyed each instead of keyed
			- setting `_options` inside of `buildOptions` instead of setting it in the reactive statement
	*/
	export let options;
	export let selectedRadio = options[0].value;

</script>

<radio-list>
	{#each options as {value, label}}
	<div>
		<label>
			<input type="radio" bind:group={selectedRadio} value={value} on:change />
			{label}
		</label>
	</div>
	{/each}
</radio-list>

<style>
	radio-list input {
		float: right;
		width: 10%;
	}

	radio-list label {
	display: block;
	width: 10%;
	cursor: pointer;
	}

	radio-list label input[type="radio"] {
	cursor: pointer;
	border: none;
	}

	radio-list label:hover {
	color: var(--vscode-button-background);
	}
</style>
