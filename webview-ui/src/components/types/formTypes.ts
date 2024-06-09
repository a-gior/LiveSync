export interface Form {
  id: string;
  title: string;
  formGroups: { [id: string]: FormGroup };
  hasSubmitButton: boolean;
  submitButtonName?: string;
}

export interface FormGroup {
  title?: string;
  visible?: boolean;
  fields: FormField[];
  deletable?: boolean;
}

export interface FormField {
  name: string;
  label?: string;
  placeholder?: string;
  type: string;
  value: string;
  files?: FileList;
  required: boolean;
  options?: { label: string; value: string }[]; // Added options property for radio buttons
  validationCallback?: CallableFunction;
  visible: boolean;
  htmlElement?: HTMLElement;
}
