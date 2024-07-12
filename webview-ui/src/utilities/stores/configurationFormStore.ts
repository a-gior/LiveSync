import {
  get,
  writable,
  Writable,
  Readable,
  derived,
  readable,
} from "svelte/store";
import type { Form } from "../../components/types/formTypes";
import GenericForm from "../../components/shared/GenericForm.svelte";
import IgnoreList from "../../components/configuration/IgnoreList.svelte";
import { vscode } from "../vscode";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";

class ConfigurationFormStore {
  public remoteServerConfigFormStore: Writable<Form>;
  public pairFolderFormStore: Writable<Form>;
  public fileEventActionsStore: Writable<Form>;
  public patternsStore: Writable<string[]>;

  public tabsStore: Readable<
    { id: string; label: string; component: any; props: any }[]
  >;
  public activeTabStore: Writable<string>;

  constructor() {
    this.remoteServerConfigFormStore = writable();
    this.pairFolderFormStore = writable();
    this.fileEventActionsStore = writable();
    this.patternsStore = writable();

    this.tabsStore = readable();
    this.activeTabStore = writable();

    this.setTabsAsDerivedStore();

    // Bind the method to the instance
    this.savePairFolders = this.savePairFolders.bind(this);
    this.saveRemoteServerConfiguration =
      this.saveRemoteServerConfiguration.bind(this);
    this.checkAuthMethod = this.checkAuthMethod.bind(this);
    this.saveFileEventActions = this.saveFileEventActions.bind(this);
    this.saveIgnoreList = this.saveIgnoreList.bind(this);
  }

  setTabsAsDerivedStore() {
    this.tabsStore = derived(
      [
        this.remoteServerConfigFormStore,
        this.pairFolderFormStore,
        this.patternsStore,
        this.fileEventActionsStore,
      ],
      ([
        $remoteServerConfigFormData,
        $pairFolderFormData,
        $patterns,
        $fileEventActions,
      ]) => {
        if (
          $remoteServerConfigFormData &&
          $pairFolderFormData &&
          $fileEventActions &&
          $patterns
        ) {
          return [
            {
              id: $remoteServerConfigFormData.id,
              label: $remoteServerConfigFormData.title,
              component: GenericForm,
              props: {
                formDataStore: this.remoteServerConfigFormStore,
                onChange: this.checkAuthMethod,
                onSubmit: this.saveRemoteServerConfiguration,
              },
            },
            {
              id: $pairFolderFormData.id,
              label: $pairFolderFormData.title,
              component: GenericForm,
              props: {
                formDataStore: this.pairFolderFormStore,
                onSubmit: this.savePairFolders,
              },
            },
            {
              id: "ignore-list",
              label: "Ignore List",
              component: IgnoreList,
              props: {
                patternsStore: this.patternsStore,
                onSaveIgnoreList: this.saveIgnoreList,
              },
            },
            {
              id: $fileEventActions.id,
              label: $fileEventActions.title,
              component: GenericForm,
              props: {
                formDataStore: this.fileEventActionsStore,
                onSubmit: this.saveFileEventActions,
              },
            },
          ];
        }
        return [];
      },
    );
  }

  setRemoteServerConfigFormData(data: Form) {
    this.remoteServerConfigFormStore.set(data);
  }

  setPairFolderFormData(data: Form) {
    this.pairFolderFormStore.set(data);
  }

  setFileEventActions(data: Form) {
    this.fileEventActionsStore.set(data);
  }

  setPatterns(patterns: string[]) {
    this.patternsStore.set(patterns);
  }

  setActiveTab(tab: string) {
    this.activeTabStore.set(tab);
  }

  getRemoteServerConfigFormData() {
    return get(this.remoteServerConfigFormStore);
  }

  getPairFolderFormData() {
    return get(this.pairFolderFormStore);
  }

  getFileEventActions() {
    return get(this.fileEventActionsStore);
  }

  getPatterns() {
    return get(this.patternsStore);
  }

  getTabs() {
    return get(this.tabsStore);
  }

  getActiveTab() {
    return get(this.activeTabStore);
  }

  savePairFolders() {
    const pairFoldersMessage: FullConfigurationMessage = {
      command: "updateConfiguration",
      pairedFolders: Object.entries(
        this.getPairFolderFormData().formGroups,
      ).map(([, form]): PairFoldersMessage["paths"] => ({
        localPath: form.fields[0].value,
        remotePath: form.fields[1].value,
      })),
    };

    const currentState: ConfigurationState = vscode.getState();
    vscode.setState({
      ...currentState,
      pairedFolders: pairFoldersMessage.pairedFolders,
    });
    vscode.postMessage(pairFoldersMessage);
  }

  saveRemoteServerConfiguration() {
    const sshKeyInput =
      this.getRemoteServerConfigFormData().formGroups[
        "remote-server-form-group-0"
      ].fields[5];
    const configurationMessage: FullConfigurationMessage = {
      command: "updateConfiguration",
      configuration: {
        hostname:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[0].value,
        port: parseInt(
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[1].value,
        ),
        username:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[2].value,
        authMethod:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[3].value,
        password:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[4].value,
        sshKey: sshKeyInput.files ? (sshKeyInput.files[0] as any).path : null,
      },
    };
    const currentState: ConfigurationState = vscode.getState();

    vscode.setState({
      ...currentState,
      configuration: configurationMessage.configuration,
    });
    vscode.postMessage(configurationMessage);
  }

  saveFileEventActions() {
    const actions = {
      actionOnSave:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[0].value,
      actionOnCreate:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[1].value,
      actionOnDelete:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[2].value,
      actionOnMove:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[3].value,
    };
    const fileEventActionsMessage: FullConfigurationMessage = {
      command: "updateConfiguration",
      fileEventActions: actions,
    };
    const currentState: ConfigurationState = vscode.getState();

    vscode.setState({
      ...currentState,
      fileEventActions: actions,
    });
    vscode.postMessage(fileEventActionsMessage);
  }

  saveIgnoreList() {
    const ignoreListMessage: FullConfigurationMessage = {
      command: "updateConfiguration",
      ignoreList: get(this.patternsStore),
    };
    const currentState: ConfigurationState = vscode.getState();

    vscode.setState({
      ...currentState,
      ignoreList: ignoreListMessage.ignoreList,
    });
    vscode.postMessage(ignoreListMessage);
  }

  checkAuthMethod(event) {
    this.remoteServerConfigFormStore.update((remoteServerConfigFormData) => {
      remoteServerConfigFormData.formGroups[
        "remote-server-form-group-0"
      ].fields[4].visible = event.target.value === "auth-password";
      return remoteServerConfigFormData;
    });
    this.remoteServerConfigFormStore.update((remoteServerConfigFormData) => {
      remoteServerConfigFormData.formGroups[
        "remote-server-form-group-0"
      ].fields[5].visible = event.target.value === "auth-sshKey";
      return remoteServerConfigFormData;
    });
  }
}

export const configurationFormStore = new ConfigurationFormStore();
