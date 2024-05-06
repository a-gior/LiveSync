import { ConfigurationMessage } from "../messages/configurationDTO";

export interface ConfigurationState {
  config: ConfigurationMessage["configuration"];
}
