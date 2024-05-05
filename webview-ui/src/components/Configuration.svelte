<!-- Configuration.svelte -->
<script lang="ts">
    import { onMount } from 'svelte';
	import { provideVSCodeDesignSystem, vsCodeButton, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
	import { vscode } from "./../utilities/vscode";

    
	provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());
</script>

