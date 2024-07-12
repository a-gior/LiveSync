<script lang="ts">
  import { writable } from 'svelte/store';
  import { onMount } from 'svelte';

  export let patternsStore = writable<string[]>([]);
  export let onSaveIgnoreList: Function;
  let newPattern = '';

  // Add new pattern to the list
  function addPattern() {
      if (newPattern.trim() !== '') {
        patternsStore.update(patterns => {
            const updatedPatterns = [...patterns, newPattern.trim()];
            newPattern = '';
            return updatedPatterns;
        });
          
        onSaveIgnoreList();
      }
  }

  // Remove pattern from the list
  function removePattern(index) {
      patternsStore.update(patterns => patterns.filter((_, i) => i !== index));

      onSaveIgnoreList();
  }
</script>

<ignore-list>
  <div class="input-group">
      <input
          type="text"
          bind:value={newPattern}
          placeholder="Enter regex pattern"
          on:keydown={(e) => e.key === 'Enter' && addPattern()}
      />
      <button on:click={addPattern}>Add</button>
  </div>
  <ul class="ignore-list">
      {#each $patternsStore as pattern, index}
          <li>
              <span>{pattern}</span>
              <button on:click={() => removePattern(index)}>Remove</button>
          </li>
      {/each}
  </ul>
</ignore-list>

<style>
  ignore-list {
      display: block;
  }

  .input-group {
      display: flex;
      align-items: center;
      padding-left: 5px;
      margin-bottom: 10px;
  }

  .input-group input {
      flex: 1;
      padding: 5px;
      margin-right: 5px;
      box-sizing: border-box;
  }

  .input-group button {
      padding: 5px 10px;
      flex-shrink: 0;
      width: auto;
  }

  .ignore-list {
      list-style-type: none;
      padding: 0;
  }

  .ignore-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px;
      border-bottom: 1px solid #ccc;
  }

  .ignore-list button {
      padding: 5px 10px;
      white-space: nowrap;
      width: auto;
  }
</style>
