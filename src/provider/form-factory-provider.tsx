import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { type FormField, type FormSchema, type SessionMode } from '../types';
import { EncounterFormProcessor } from '../processors/encounter/encounter-form-processor';
import {
  type LayoutType,
  useLayoutType,
  type OpenmrsResource,
  showSnackbar,
  showToast,
  type ToastDescriptor,
} from '@openmrs/esm-framework';
import { type FormProcessorConstructor } from '../processors/form-processor';
import { type FormContextProps } from './form-provider';
import { processPostSubmissionActions, validateForm } from './form-factory-helper';
import { useTranslation } from 'react-i18next';
import { usePostSubmissionActions } from '../hooks/usePostSubmissionActions';
import { reportError } from '../utils/error-utils';

interface FormFactoryProviderContextProps {
  patient: fhir.Patient;
  sessionMode: SessionMode;
  sessionDate: Date;
  formJson: FormSchema;
  formProcessors: Record<string, FormProcessorConstructor>;
  layoutType: LayoutType;
  workspaceLayout: 'minimized' | 'maximized';
  visit: OpenmrsResource;
  location: OpenmrsResource;
  provider: OpenmrsResource;
  registerForm: (formId: string, context: FormContextProps) => void;
  setCurrentPage: (page: string) => void;
  handleConfirmQuestionDeletion?: (question: Readonly<FormField>) => Promise<void>;
}

interface FormFactoryProviderProps {
  patient: fhir.Patient;
  sessionMode: SessionMode;
  sessionDate: Date;
  formJson: FormSchema;
  workspaceLayout: 'minimized' | 'maximized';
  location: OpenmrsResource;
  provider: OpenmrsResource;
  visit: OpenmrsResource;
  children: React.ReactNode;
  formSubmissionProps: {
    isSubmitting: boolean;
    setIsSubmitting: (isSubmitting: boolean) => void;
    onSubmit: (data: any) => void;
    onError: (error: any) => void;
    handleClose: () => void;
  };
  setCurrentPage: (page: string) => void;
  handleConfirmQuestionDeletion?: (question: Readonly<FormField>) => Promise<void>;
}

const FormFactoryProviderContext = createContext<FormFactoryProviderContextProps | undefined>(undefined);

export const FormFactoryProvider: React.FC<FormFactoryProviderProps> = ({
  patient,
  sessionMode,
  sessionDate,
  formJson,
  workspaceLayout,
  location,
  provider,
  visit,
  children,
  formSubmissionProps,
  setCurrentPage,
  handleConfirmQuestionDeletion,
}) => {
  const { t } = useTranslation();
  const rootForm = useRef<FormContextProps>();
  const subForms = useRef<Record<string, FormContextProps>>({});
  const layoutType = useLayoutType();
  const { isSubmitting, setIsSubmitting, onSubmit, onError, handleClose } = formSubmissionProps;
  const postSubmissionHandlers = usePostSubmissionActions(formJson.postSubmissionActions);

  const abortController = new AbortController();

  const registerForm = useCallback((formId: string, context: FormContextProps) => {
    if (!rootForm.current) {
      rootForm.current = context;
    } else {
      subForms.current[formId] = context;
    }
  }, []);

  // TODO: Manage and load processors from the registry
  const formProcessors = useRef<Record<string, FormProcessorConstructor>>({
    EncounterFormProcessor: EncounterFormProcessor,
  });

  useEffect(() => {
    if (isSubmitting) {
      // TODO: find a dynamic way of managing the form processing order
      const forms = [rootForm.current, ...Object.values(subForms.current)];
      // validate all forms
      const isValid = forms.every((formContext) => validateForm(formContext));
      if (isValid) {
        Promise.all(forms.map((formContext) => formContext.processor.processSubmission(formContext, abortController)))
          .then(async (results) => {
            formSubmissionProps.setIsSubmitting(false);
            if (sessionMode === 'edit') {
              showSnackbar({
                title: t('updatedRecord', 'Record updated'),
                subtitle: t('updatedRecordDescription', 'The patient encounter was updated'),
                kind: 'success',
                isLowContrast: true,
              });
            } else {
              showSnackbar({
                title: t('createdRecord', 'Record created'),
                subtitle: t('createdRecordDescription', 'A new encounter was created'),
                kind: 'success',
                isLowContrast: true,
              });
            }
            if (postSubmissionHandlers) {
              await processPostSubmissionActions(postSubmissionHandlers, results, patient, sessionMode, t);
            }
            if (onSubmit) {
              onSubmit(results);
            } else {
              handleClose();
            }
          })
          .catch((toastErrorObject: ToastDescriptor) => {
            setIsSubmitting(false);
            showToast(toastErrorObject);
          });
      } else {
        setIsSubmitting(false);
      }
    }
    return () => {
      abortController.abort();
    };
  }, [isSubmitting]);

  return (
    <FormFactoryProviderContext.Provider
      value={{
        patient,
        sessionMode,
        sessionDate,
        formJson,
        formProcessors: formProcessors.current,
        layoutType,
        workspaceLayout,
        visit,
        location,
        provider,
        registerForm,
        setCurrentPage,
        handleConfirmQuestionDeletion,
      }}>
      {formProcessors.current && children}
    </FormFactoryProviderContext.Provider>
  );
};

export const useFormFactory = () => {
  const context = useContext(FormFactoryProviderContext);
  if (!context) {
    throw new Error('useFormFactoryContext must be used within a FormFactoryProvider');
  }
  return context;
};
