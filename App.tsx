import React, { useMemo, useState } from 'react';
import { SectionCard, Input, Select, RadioGroup, TextArea, FileUpload, Checkbox } from './components/FormComponents';
import { FormData, INITIAL_DATA, SecurityQuestion } from './types';
import { validateForm, INITIAL_UPLOADS, UploadKey, Uploads } from './validation';

// Icons
const ClearIcon = () => (
  <svg className="w-5 h-5 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
);

export default function App() {
  const [data, setData] = useState<FormData>(INITIAL_DATA);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [uploads, setUploads] = useState<Uploads>(INITIAL_UPLOADS);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Bumped on clear so uncontrolled file inputs are remounted empty
  const [formKey, setFormKey] = useState(0);

  const errors = useMemo(() => validateForm(data, uploads), [data, uploads]);
  const errorCount = Object.keys(errors).length;

  const touch = (field: string) => {
    setTouched(prev => (prev.has(field) ? prev : new Set(prev).add(field)));
  };

  // Errors show once a field has been visited, or for every field after a submit attempt
  const errorFor = (field: string) => (submitAttempted || touched.has(field) ? errors[field] : undefined);
  const fieldState = (field: string) => ({ id: field, error: errorFor(field) });
  const inputState = (field: string) => ({ ...fieldState(field), onBlur: () => touch(field) });

  // Generic change handler
  const handleChange = (field: keyof FormData, value: any) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  // For radios, selects and checkboxes, a choice counts as visiting the field
  const handleChoice = (field: keyof FormData, value: any) => {
    handleChange(field, value);
    touch(field);
  };

  const handleUpload = (key: UploadKey, file: File | null) => {
    setUploads(prev => ({ ...prev, [key]: file }));
    touch(key);
  };

  // Security question handler
  const handleSecurityChange = (field: keyof FormData, type: 'answer' | 'details', value: any) => {
    setData(prev => {
        const currentQ = prev[field] as SecurityQuestion;
        return {
            ...prev,
            [field]: { ...currentQ, [type]: value }
        };
    });
    if (type === 'answer') touch(field);
  };

  const clearForm = () => {
    if(window.confirm('Are you sure you want to clear the form? This will remove all data.')) {
        setData(INITIAL_DATA);
        setUploads(INITIAL_UPLOADS);
        setTouched(new Set());
        setSubmitAttempted(false);
        setFormKey(k => k + 1);
        window.scrollTo(0, 0);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitAttempted(true);
      const firstError = Object.keys(errors)[0];
      if (firstError) {
          const el = document.getElementById(firstError);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el?.focus({ preventScroll: true });
          return;
      }
      console.log('Form Submitted:', data, uploads);
      alert('Form submitted successfully! Check console for data object.');
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Header Banner */}
      <div className="h-40 bg-purple-700 flex items-end justify-center shadow-md">
         {/* Placeholder for banner image if needed, or just color */}
      </div>

      <div className="max-w-3xl mx-auto -mt-20 px-4">
        
        {/* Title Card */}
        <div className="bg-white rounded-lg border-t-8 border-t-purple-700 border border-gray-300 shadow-sm mb-4">
            <div className="p-6">
                <h1 className="text-3xl font-normal text-gray-900 mb-4">DS-160 Information Form (For US Visa Processing)</h1>
                <p className="text-sm text-gray-600 mb-2">Please fill this form carefully. These details will be used to complete your DS-160 application.</p>
                <div className="border-t border-gray-200 mt-4 pt-2">
                    <p className="text-xs text-red-500">* Indicates required question</p>
                </div>
            </div>
        </div>

        <form key={formKey} onSubmit={handleSubmit} noValidate className="space-y-4">

            {/* SECTION 1: PERSONAL INFORMATION */}
            <div onClick={() => setActiveSection(1)}>
                <SectionCard title="Section 1: Personal Information" isActive={activeSection === 1}>
                    <Input label="Full Name (as per passport)" placeholder="Surname, Given Names" value={data.fullName} onChange={e => handleChange('fullName', e.target.value)} {...inputState('fullName')} required />
                    <Input label="Father's Name" value={data.fatherName} onChange={e => handleChange('fatherName', e.target.value)} {...inputState('fatherName')} required />
                    <Input label="Mother's Name" value={data.motherName} onChange={e => handleChange('motherName', e.target.value)} {...inputState('motherName')} required />
                    <Input label="Date of Birth" type="date" value={data.dob} onChange={e => handleChange('dob', e.target.value)} {...inputState('dob')} required />
                    
                    <RadioGroup 
                        label="Gender" 
                        name="gender" 
                        options={['Male', 'Female', 'Other']} 
                        value={data.gender} 
                        onChange={val => handleChoice('gender', val)}
                        {...fieldState('gender')}
                        required
                    />
                    
                    <Select 
                        label="Marital Status"
                        options={['Single', 'Married', 'Divorced', 'Widowed']}
                        value={data.maritalStatus}
                        onChange={e => handleChoice('maritalStatus', e.target.value)}
                        {...fieldState('maritalStatus')}
                        required
                    />

                    <Input label="Passport Number" value={data.passportNumber} onChange={e => handleChange('passportNumber', e.target.value)} {...inputState('passportNumber')} required />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input label="Passport Issue Date" type="date" value={data.passportIssueDate} onChange={e => handleChange('passportIssueDate', e.target.value)} {...inputState('passportIssueDate')} required />
                        <Input label="Passport Expiry Date" type="date" value={data.passportExpiryDate} onChange={e => handleChange('passportExpiryDate', e.target.value)} {...inputState('passportExpiryDate')} required />
                    </div>

                    <Input label="Place of Birth" value={data.placeOfBirth} onChange={e => handleChange('placeOfBirth', e.target.value)} {...inputState('placeOfBirth')} required />
                    <Input label="Nationality" value={data.nationality} onChange={e => handleChange('nationality', e.target.value)} {...inputState('nationality')} required />
                </SectionCard>
            </div>

            {/* SECTION 2: CONTACT DETAILS */}
            <div onClick={() => setActiveSection(2)}>
                <SectionCard title="Section 2: Contact Details" isActive={activeSection === 2}>
                    <Input label="Mobile Number" type="tel" value={data.mobileNumber} onChange={e => handleChange('mobileNumber', e.target.value)} {...inputState('mobileNumber')} required />
                    <Input label="Email Address" type="email" value={data.email} onChange={e => handleChange('email', e.target.value)} {...inputState('email')} required />
                    <TextArea label="Full Residential Address" value={data.address} onChange={e => handleChange('address', e.target.value)} {...inputState('address')} required />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label="City" value={data.city} onChange={e => handleChange('city', e.target.value)} {...inputState('city')} required />
                        <Input label="State" value={data.state} onChange={e => handleChange('state', e.target.value)} {...inputState('state')} required />
                        <Input label="Pincode" value={data.pincode} onChange={e => handleChange('pincode', e.target.value)} {...inputState('pincode')} required />
                    </div>
                    <Input label="Emergency Contact Name" value={data.emergencyName} onChange={e => handleChange('emergencyName', e.target.value)} {...inputState('emergencyName')} required />
                    <Input label="Emergency Contact Number" type="tel" value={data.emergencyPhone} onChange={e => handleChange('emergencyPhone', e.target.value)} {...inputState('emergencyPhone')} required />
                </SectionCard>
            </div>

            {/* SECTION 3: TRAVEL INFORMATION */}
            <div onClick={() => setActiveSection(3)}>
                <SectionCard title="Section 3: Travel Information" isActive={activeSection === 3}>
                    <Select 
                        label="Purpose of Travel"
                        options={['Tourism', 'Business', 'Student', 'Medical', 'Others']}
                        value={data.purposeOfTravel}
                        onChange={e => handleChoice('purposeOfTravel', e.target.value)}
                        {...fieldState('purposeOfTravel')}
                        required
                    />
                    <Input label="Intended Travel Date" type="date" value={data.travelDate} onChange={e => handleChange('travelDate', e.target.value)} {...inputState('travelDate')} required />
                    <Input label="Expected Length of Stay" placeholder="e.g. 2 weeks" value={data.lengthOfStay} onChange={e => handleChange('lengthOfStay', e.target.value)} {...inputState('lengthOfStay')} required />
                    <TextArea label="Where will you stay in the USA? (Hotel/Home address)" value={data.stayAddress} onChange={e => handleChange('stayAddress', e.target.value)} {...inputState('stayAddress')} required />
                    <Input label="Contact Person in USA (Name)" value={data.usContactName} onChange={e => handleChange('usContactName', e.target.value)} {...inputState('usContactName')} required />
                    <Input label="Contact Person Phone Number" type="tel" value={data.usContactPhone} onChange={e => handleChange('usContactPhone', e.target.value)} {...inputState('usContactPhone')} required />

                    <RadioGroup 
                        label="Have you traveled to the USA before?" 
                        name="traveledBefore" 
                        options={['Yes', 'No']} 
                        value={data.traveledBefore} 
                        onChange={val => handleChoice('traveledBefore', val)}
                        {...fieldState('traveledBefore')}
                        required
                    />
                    {data.traveledBefore === 'Yes' && (
                        <TextArea label="Provide dates of travel" placeholder="e.g. June 2019, Dec 2022" value={data.travelDates} onChange={e => handleChange('travelDates', e.target.value)} {...inputState('travelDates')} required />
                    )}

                    <RadioGroup 
                        label="Have you applied for a US visa earlier?" 
                        name="visaRefused" 
                        options={['Yes', 'No']} 
                        value={data.visaRefused} 
                        onChange={val => handleChoice('visaRefused', val)}
                        {...fieldState('visaRefused')}
                        required
                    />
                    {data.visaRefused === 'Yes' && (
                        <TextArea label="When and what type" placeholder="e.g. B1/B2 in 2018" value={data.previousVisaDetails} onChange={e => handleChange('previousVisaDetails', e.target.value)} {...inputState('previousVisaDetails')} required />
                    )}
                </SectionCard>
            </div>

            {/* SECTION 4: WORK / STUDY DETAILS */}
            <div onClick={() => setActiveSection(4)}>
                <SectionCard title="Section 4: Work / Study Details" isActive={activeSection === 4}>
                    <Select 
                        label="Current Status"
                        options={['Employed', 'Self-employed', 'Student', 'Homemaker', 'Retired']}
                        value={data.currentStatus}
                        onChange={e => handleChoice('currentStatus', e.target.value)}
                        {...fieldState('currentStatus')}
                        required
                    />

                    {data.currentStatus === 'Employed' && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-4">
                            <h3 className="text-sm font-semibold text-purple-800 uppercase tracking-wider">Employment Details</h3>
                            <Input label="Employer Name" value={data.employerName} onChange={e => handleChange('employerName', e.target.value)} {...inputState('employerName')} required />
                            <Input label="Job Title" value={data.jobTitle} onChange={e => handleChange('jobTitle', e.target.value)} {...inputState('jobTitle')} required />
                            <TextArea label="Employer Address" value={data.employerAddress} onChange={e => handleChange('employerAddress', e.target.value)} {...inputState('employerAddress')} required />
                            <Input label="Monthly Salary" value={data.monthlySalary} onChange={e => handleChange('monthlySalary', e.target.value)} {...inputState('monthlySalary')} required />
                            <Input label="Employment Start Date" type="date" value={data.employmentStartDate} onChange={e => handleChange('employmentStartDate', e.target.value)} {...inputState('employmentStartDate')} required />
                        </div>
                    )}

                    {data.currentStatus === 'Self-employed' && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-4">
                            <h3 className="text-sm font-semibold text-purple-800 uppercase tracking-wider">Business Details</h3>
                            <Input label="Business Name" value={data.businessName} onChange={e => handleChange('businessName', e.target.value)} {...inputState('businessName')} required />
                            <Input label="Nature of Business" value={data.natureOfBusiness} onChange={e => handleChange('natureOfBusiness', e.target.value)} {...inputState('natureOfBusiness')} required />
                            <TextArea label="Business Address" value={data.businessAddress} onChange={e => handleChange('businessAddress', e.target.value)} {...inputState('businessAddress')} required />
                            <Input label="Annual Income" value={data.annualIncome} onChange={e => handleChange('annualIncome', e.target.value)} {...inputState('annualIncome')} required />
                            <Input label="Business Start Date" type="date" value={data.businessStartDate} onChange={e => handleChange('businessStartDate', e.target.value)} {...inputState('businessStartDate')} required />
                        </div>
                    )}

                    {data.currentStatus === 'Student' && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-4">
                             <h3 className="text-sm font-semibold text-purple-800 uppercase tracking-wider">Education Details</h3>
                            <Input label="School/College Name" value={data.schoolName} onChange={e => handleChange('schoolName', e.target.value)} {...inputState('schoolName')} required />
                            <Input label="Course/Program" value={data.courseProgram} onChange={e => handleChange('courseProgram', e.target.value)} {...inputState('courseProgram')} required />
                            <Input label="Start Date" type="date" value={data.schoolStartDate} onChange={e => handleChange('schoolStartDate', e.target.value)} {...inputState('schoolStartDate')} required />
                        </div>
                    )}
                </SectionCard>
            </div>

            {/* SECTION 5: FAMILY INFORMATION */}
            <div onClick={() => setActiveSection(5)}>
                <SectionCard title="Section 5: Family Information" isActive={activeSection === 5}>
                     {/* Logic: Only ask spouse details if Married? Prompt implies list them anyway, but logically only needed if married. I'll show them always but user might leave blank if single, OR conditionally show based on Sec 1. Let's conditionally show based on Section 1 Marital Status for better UX. */}
                     {data.maritalStatus === 'Married' && (
                         <>
                            <Input label="Spouse Name" value={data.spouseName} onChange={e => handleChange('spouseName', e.target.value)} {...inputState('spouseName')} required />
                            <Input label="Spouse Date of Birth" type="date" value={data.spouseDob} onChange={e => handleChange('spouseDob', e.target.value)} {...inputState('spouseDob')} required />
                            <Input label="Spouse Occupation" value={data.spouseOccupation} onChange={e => handleChange('spouseOccupation', e.target.value)} {...inputState('spouseOccupation')} required />
                            <div className="my-4 border-b border-gray-200"></div>
                         </>
                     )}
                     
                     <RadioGroup 
                        label="Are you travelling alone or with family?" 
                        name="travelCompanions" 
                        options={['Alone', 'With family']} 
                        value={data.travelCompanions} 
                        onChange={val => handleChoice('travelCompanions', val)}
                        {...fieldState('travelCompanions')}
                        required
                    />
                    {data.travelCompanions === 'With family' && (
                        <TextArea label="Names of accompanying members" value={data.companionNames} onChange={e => handleChange('companionNames', e.target.value)} {...inputState('companionNames')} required />
                    )}
                </SectionCard>
            </div>

            {/* SECTION 6: SECURITY & BACKGROUND */}
            <div onClick={() => setActiveSection(6)}>
                <SectionCard title="Section 6: Security & Background" description="Answer the following questions. If yes, explain in the box." isActive={activeSection === 6}>
                     {[
                         { id: 'arrested', label: "Have you ever been arrested, convicted, or involved in criminal activity?" },
                         { id: 'immigrationViolation', label: "Have you ever violated US immigration laws?" },
                         { id: 'visaCanceled', label: "Have you ever had a US visa refused or canceled?" },
                         { id: 'healthRisks', label: "Do you have any communicable diseases or public health risks?" }
                     ].map((q) => (
                         <div key={q.id} className="pb-4 mb-4 border-b border-gray-100 last:border-0">
                             <RadioGroup 
                                label={q.label}
                                name={q.id}
                                options={['Yes', 'No']}
                                value={(data[q.id as keyof FormData] as SecurityQuestion).answer}
                                onChange={val => handleSecurityChange(q.id as keyof FormData, 'answer', val)}
                                {...fieldState(q.id)}
                                required
                             />
                             {(data[q.id as keyof FormData] as SecurityQuestion).answer === 'Yes' && (
                                 <TextArea 
                                    label="Please explain details" 
                                    value={(data[q.id as keyof FormData] as SecurityQuestion).details}
                                    onChange={e => handleSecurityChange(q.id as keyof FormData, 'details', e.target.value)}
                                    {...inputState(`${q.id}.details`)}
                                    required
                                 />
                             )}
                         </div>
                     ))}
                </SectionCard>
            </div>

            {/* SECTION 7: DOCUMENT UPLOAD */}
            <div onClick={() => setActiveSection(7)}>
                 <SectionCard title="Section 7: Document Upload" description="Images or PDFs, up to 5 MB each." isActive={activeSection === 7}>
                    <FileUpload label="Upload Passport Front Page" accept="image/*,.pdf" file={uploads.passportFront} onFileChange={f => handleUpload('passportFront', f)} {...fieldState('passportFront')} required />
                    <FileUpload label="Upload Passport Back Page" accept="image/*,.pdf" file={uploads.passportBack} onFileChange={f => handleUpload('passportBack', f)} {...fieldState('passportBack')} required />
                    <FileUpload label="Upload Latest Photograph (US Visa Requirements)" accept="image/*" file={uploads.photo} onFileChange={f => handleUpload('photo', f)} {...fieldState('photo')} required />
                    <FileUpload label="Upload Old Passports (Optional)" accept="image/*,.pdf" file={uploads.oldPassports} onFileChange={f => handleUpload('oldPassports', f)} {...fieldState('oldPassports')} />
                    <FileUpload label="Upload Previous US Visa (if any)" accept="image/*,.pdf" file={uploads.previousVisa} onFileChange={f => handleUpload('previousVisa', f)} {...fieldState('previousVisa')} />
                 </SectionCard>
            </div>

            {/* FINAL DECLARATION */}
            <div onClick={() => setActiveSection(8)}>
                 <SectionCard title="Final Declaration" isActive={activeSection === 8}>
                     <Checkbox 
                        label="I confirm that all the information provided is true and correct."
                        checked={data.declaration}
                        onChange={checked => handleChoice('declaration', checked)}
                        {...fieldState('declaration')}
                        required
                     />
                 </SectionCard>
            </div>

            {submitAttempted && errorCount > 0 && (
                <div role="alert" className="bg-red-50 border border-red-300 text-red-700 text-sm rounded-lg px-4 py-3">
                    Please fix {errorCount} {errorCount === 1 ? 'error' : 'errors'} highlighted above before submitting.
                </div>
            )}

            {/* Footer Actions */}
            <div className="flex justify-between items-center py-6 px-1">
                <button 
                    type="button" 
                    onClick={clearForm}
                    className="flex items-center text-purple-700 font-medium hover:bg-purple-50 px-4 py-2 rounded transition-colors"
                >
                    <span className="mr-2"><ClearIcon /></span>
                    Clear form
                </button>
                <button 
                    type="submit" 
                    className="bg-purple-700 hover:bg-purple-800 text-white font-medium px-8 py-2.5 rounded shadow-sm transition-colors"
                >
                    Submit
                </button>
            </div>

        </form>

        <div className="text-center text-xs text-gray-500 pb-8 mt-8">
            This is a mock application for demonstration purposes. Never submit real sensitive data to untrusted sites.
        </div>

      </div>
    </div>
  );
}