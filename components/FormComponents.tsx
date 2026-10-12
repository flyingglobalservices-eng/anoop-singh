import React, { ComponentProps, ReactNode } from 'react';

// Wrapper for a form section (The Card)
interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  isActive?: boolean;
}

export const SectionCard = ({ 
  title, 
  description, 
  children,
  isActive 
}: SectionCardProps) => (
  <div className={`bg-white rounded-lg border border-gray-300 shadow-sm mb-4 overflow-hidden transition-all duration-200 ${isActive ? 'ring-2 ring-purple-200 border-purple-500' : ''}`}>
    <div className={`h-2 ${isActive ? 'bg-purple-600' : 'bg-transparent'}`}></div>
    <div className="p-6">
      <h2 className="text-2xl font-normal text-gray-900 mb-2">{title}</h2>
      {description && <p className="text-sm text-gray-600 mb-6">{description}</p>}
      <div className="space-y-6">
        {children}
      </div>
    </div>
  </div>
);

// Inline validation message
const ErrorMessage = ({ id, error }: { id?: string; error?: string }) =>
  error ? (
    <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1 text-xs text-red-600 flex items-center">
      <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
      {error}
    </p>
  ) : null;

const errorAria = (id: string | undefined, error?: string) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error && id ? `${id}-error` : undefined,
});

const borderClass = (error?: string) =>
  error ? 'border-red-500 focus:border-red-600' : 'border-gray-300 focus:border-purple-600';

// Basic Input
interface InputProps extends ComponentProps<'input'> {
  label: string;
  error?: string;
}
export const Input = ({ label, required, className, error, id, ...props }: InputProps) => (
  <div className="group">
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <input
      id={id}
      required={required}
      className={`w-full px-0 py-2 border-b ${borderClass(error)} focus:outline-none focus:ring-0 bg-transparent transition-colors placeholder-gray-400 text-gray-900 ${className || ''}`}
      {...errorAria(id, error)}
      {...props}
    />
    <div className="h-0.5 bg-purple-600 scale-x-0 group-focus-within:scale-x-100 transition-transform origin-left"></div>
    <ErrorMessage id={id} error={error} />
  </div>
);

// TextArea
interface TextAreaProps extends ComponentProps<'textarea'> {
  label: string;
  error?: string;
}
export const TextArea = ({ label, required, className, rows = 1, error, id, ...props }: TextAreaProps) => (
  <div className="group">
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <textarea
      id={id}
      required={required}
      {...errorAria(id, error)}
      className={`w-full px-0 py-2 border-b ${borderClass(error)} focus:outline-none focus:ring-0 bg-transparent transition-colors placeholder-gray-400 text-gray-900 resize-y min-h-[40px] ${className || ''}`}
      rows={rows}
      {...props}
    />
    <div className="h-0.5 bg-purple-600 scale-x-0 group-focus-within:scale-x-100 transition-transform origin-left"></div>
    <ErrorMessage id={id} error={error} />
  </div>
);

// Select
interface SelectProps extends ComponentProps<'select'> {
  label: string;
  options: string[];
  error?: string;
}
export const Select = ({ label, options, required, className, error, id, ...props }: SelectProps) => (
  <div className="group">
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <select
      id={id}
      required={required}
      {...errorAria(id, error)}
      className={`w-full px-0 py-2 border-b ${borderClass(error)} focus:outline-none focus:ring-0 bg-transparent transition-colors text-gray-900 ${className || ''}`}
      {...props}
    >
      <option value="" disabled>Choose</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
    <ErrorMessage id={id} error={error} />
  </div>
);

// Radio Group
interface RadioGroupProps {
  label: string;
  name: string;
  options: string[];
  value: string | null;
  onChange: (val: string) => void;
  required?: boolean;
  error?: string;
  id?: string;
}
export const RadioGroup = ({ label, name, options, value, onChange, required, error, id }: RadioGroupProps) => (
  <div className="py-2" id={id} tabIndex={-1} role="radiogroup" aria-labelledby={id ? `${id}-label` : undefined} {...errorAria(id, error)}>
    <p id={id ? `${id}-label` : undefined} className="block text-sm font-medium text-gray-700 mb-3">
      {label} {required && <span className="text-red-500">*</span>}
    </p>
    <div className="space-y-3">
      {options.map((opt) => (
        <label key={opt} className="flex items-center space-x-3 cursor-pointer">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${value === opt ? 'border-purple-600' : error ? 'border-red-500' : 'border-gray-400'}`}>
            {value === opt && <div className="w-2.5 h-2.5 rounded-full bg-purple-600"></div>}
          </div>
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={(e) => onChange(e.target.value)}
            className="hidden"
          />
          <span className="text-gray-700">{opt}</span>
        </label>
      ))}
    </div>
    <ErrorMessage id={id} error={error} />
  </div>
);

// File Upload (Styled)
interface FileUploadProps extends Omit<ComponentProps<'input'>, 'onChange'> {
  label: string;
  error?: string;
  file?: File | null;
  onFileChange?: (file: File | null) => void;
}
export const FileUpload = ({ label, required, className, error, id, file, onFileChange, ...props }: FileUploadProps) => (
  <div className="py-3" id={id} tabIndex={-1}>
    <p className="block text-sm font-medium text-gray-700 mb-2">
      {label} {required && <span className="text-red-500">*</span>}
    </p>
    <div className="flex items-center space-x-3">
        <label className={`cursor-pointer bg-white border ${error ? 'border-red-500' : 'border-gray-300'} hover:bg-gray-50 text-purple-600 font-medium py-2 px-4 rounded shadow-sm transition-colors text-sm flex items-center ${className || ''}`}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            Add File
            <input
              type="file"
              className="hidden"
              aria-label={label}
              {...errorAria(id, error)}
              onChange={e => onFileChange?.(e.target.files?.[0] ?? null)}
              {...props}
            />
        </label>
        <span className="text-xs text-gray-500 truncate">{file ? file.name : 'No file chosen'}</span>
    </div>
    <ErrorMessage id={id} error={error} />
  </div>
);

// Checkbox (Declaration)
export const Checkbox = ({ label, checked, onChange, required, error, id }: { label: string; checked: boolean; onChange: (c: boolean) => void; required?: boolean; error?: string; id?: string }) => (
  <div id={id} tabIndex={-1}>
    <label className="flex items-start space-x-3 cursor-pointer py-2">
        <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-purple-600 border-purple-600' : error ? 'border-red-500' : 'border-gray-400'}`}>
             {checked && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
        </div>
        <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} {...errorAria(id, error)} />
        <span className="text-sm text-gray-700">{label} {required && <span className="text-red-500">*</span>}</span>
    </label>
    <ErrorMessage id={id} error={error} />
  </div>
)