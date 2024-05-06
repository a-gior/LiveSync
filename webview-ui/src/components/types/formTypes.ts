export interface Form {
  title: string;
  formGroups: FormGroup[];
  hasSubmitButton: boolean;
}

export interface FormGroup {
  title?: string;
  visible?: boolean;
  fields: FormField[];
}

export interface FormField {
  name: string;
  label?: string;
  type: string;
  value: string;
  files?: FileList;
  required: boolean;
  options?: { label: string; value: string }[]; // Added options property for radio buttons
  validationCallback?: CallableFunction;
  visible: boolean;
  htmlElement?: HTMLElement;
}
