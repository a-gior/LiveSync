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

class ConfigurationFormStore {
  public remoteServerConfigFormStore: Writable<Form>;
  public fileEventActionsStore: Writable<Form>;
  public patternsStore: Writable<string[]>;

  public tabsStore: Readable<
    { id: string; label: string; component: any; props: any }[]
  >;
  public activeTabStore: Writable<string>;

  constructor() {
    this.remoteServerConfigFormStore = writable();
    this.fileEventActionsStore = writable();
    this.patternsStore = writable();

    this.tabsStore = readable();
    this.activeTabStore = writable();

    this.setTabsAsDerivedStore();

    // Bind the method to the instance
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
        this.patternsStore,
        this.fileEventActionsStore,
      ],
      ([$remoteServerConfigFormData, $patterns, $fileEventActions]) => {
        if ($remoteServerConfigFormData && $fileEventActions && $patterns) {
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

  saveRemoteServerConfiguration() {
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
        privateKeyPath:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[5].value,
        passphrase:
          this.getRemoteServerConfigFormData().formGroups[
            "remote-server-form-group-0"
          ].fields[6].value,
      },
      remotePath:
        this.getRemoteServerConfigFormData().formGroups[
          "remote-server-form-group-0"
        ].fields[7].value,
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
      actionOnUpload:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[0].value,
      actionOnDownload:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[1].value,
      actionOnSave:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[2].value,
      actionOnCreate:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[3].value,
      actionOnDelete:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[4].value,
      actionOnMove:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[5].value,
      actionOnOpen:
        this.getFileEventActions().formGroups["file-event-actions-form-group-0"]
          .fields[6].value,
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
      remoteServerConfigFormData.formGroups[
        "remote-server-form-group-0"
      ].fields[6].visible = event.target.value === "auth-sshKey";
      return remoteServerConfigFormData;
    });
  }
}

export const configurationFormStore = new ConfigurationFormStore();
