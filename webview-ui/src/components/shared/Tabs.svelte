<script lang="ts">
    import { configurationFormStore } from '../../utilities/stores/configurationFormStore';
    import { onMount } from 'svelte';
  
    export let tabs: { id: string, label: string, component: any, props: any }[] = [];
    let activeTab: string;
    let tabsInitialized = false;
  
    // Initialize tabs and activeTab from the store
    onMount(() => {
      // Use the derived store directly for tabs
      configurationFormStore.tabsStore.subscribe(value => {
        tabs = value;
        if (!tabsInitialized && tabs.length > 0) {
          // Set the active tab to the first tab only the first time tabs are initialized
          configurationFormStore.setActiveTab(tabs[0].id);
          tabsInitialized = true;
        }
      });
      configurationFormStore.activeTabStore.subscribe(value => activeTab = value);
    });
  
    // Function to switch the active tab
    function switchTab(tabName) {
        configurationFormStore.setActiveTab(tabName);
    }
  </script>
  
  <style>
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
    margin-bottom: 10px;
  }

  .tab {
    padding: 10px 15px;
    cursor: pointer;
    border: 1px solid transparent;
    border-bottom: none;
    background-color: var(--vscode-tab-inactiveBackground);
    color: var(--vscode-tab-inactiveForeground);
    transition: background-color 0.3s, color 0.3s;
  }

  .tab.active {
    background-color: var(--vscode-tab-activeBackground);
    color: var(--vscode-tab-activeForeground);
    border-color: var(--vscode-tab-activeBorder);
    /* border-top-color: var(--panel-tab-active-border); */
    border-top-color: var(--button-primary-background);
    border-bottom: 1px solid var(--vscode-editor-background);
  }

  .tab:hover {
    background-color: var(--vscode-tab-hoverBackground);
    color: var(--vscode-tab-hoverForeground);
  }

  .tab-content {
    padding: 10px;
    height: 100%;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    overflow-y: auto; /* Make only this container scrollable when content overflows */
  }

  </style>
  
  <div class="tabs">
    {#each tabs as tab}
      <div
        class:active={activeTab === tab.id}
        class="tab"
        on:click={() => switchTab(tab.id)}
      >
        {tab.label}
      </div>
    {/each}
  </div>
  
  <div class="tab-content">
    {#each tabs as tab}
      {#if activeTab === tab.id}
        <svelte:component this={tab.component} {...tab.props} />
      {/if}
    {/each}
  </div>
  