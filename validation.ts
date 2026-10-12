import { FormData, SecurityQuestion } from './types';

export type UploadKey = 'passportFront' | 'passportBack' | 'photo' | 'oldPassports' | 'previousVisa';
export type Uploads = Record<UploadKey, File | null>;

export const INITIAL_UPLOADS: Uploads = {
  passportFront: null,
  passportBack: null,
  photo: null,
  oldPassports: null,
  previousVisa: null,
};

// Keys are form field names; security details use "<question>.details".
// Insertion order follows the form so the first key is the topmost error.
export type FormErrors = Record<string, string>;

export const SECURITY_QUESTIONS = ['arrested', 'immigrationViolation', 'visaCanceled', 'healthRisks'] as const;

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const NAME_RE = /^[\p{L}][\p{L} .,'-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{7,15}$/;
const PINCODE_RE = /^\d{6}$/;
const PASSPORT_RE = /^[A-Z0-9]{6,9}$/i;
const AMOUNT_RE = /^\d{1,3}(,?\d{2,3})*(\.\d{1,2})?$/;

// Local date as YYYY-MM-DD, comparable with <input type="date"> values.
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const yearsBefore = (isoDate: string, years: number) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return toISODate(new Date(y - years, m - 1, d));
};

export function validateForm(data: FormData, uploads: Uploads, today: string = toISODate(new Date())): FormErrors {
  const errors: FormErrors = {};
  const set = (field: string, message: string) => {
    if (!errors[field]) errors[field] = message;
  };
  const filled = (v: string | null) => typeof v === 'string' && v.trim() !== '';

  const required = (field: keyof FormData, message = 'This field is required') => {
    const value = data[field];
    if (!filled(value as string | null)) set(field, message);
    return filled(value as string | null);
  };
  const name = (field: keyof FormData) => {
    if (required(field) && !NAME_RE.test((data[field] as string).trim())) {
      set(field, 'Use letters, spaces and . , \' - only');
    }
  };
  const phone = (field: keyof FormData) => {
    if (required(field) && !PHONE_RE.test((data[field] as string).replace(/[\s()-]/g, ''))) {
      set(field, 'Enter a valid phone number (7–15 digits, optional + country code)');
    }
  };
  const amount = (field: keyof FormData) => {
    if (required(field) && !AMOUNT_RE.test((data[field] as string).trim())) {
      set(field, 'Enter an amount in numbers only, e.g. 50000');
    }
  };
  const pastDate = (field: keyof FormData, label: string) => {
    if (required(field) && (data[field] as string) > today) set(field, `${label} cannot be in the future`);
  };
  const startDate = (field: keyof FormData) => {
    pastDate(field, 'Start date');
    if (!errors[field] && data.dob && (data[field] as string) <= data.dob) {
      set(field, 'Start date must be after your date of birth');
    }
  };

  // Section 1: Personal
  name('fullName');
  name('fatherName');
  name('motherName');
  pastDate('dob', 'Date of birth');
  if (!errors.dob && data.dob < yearsBefore(today, 120)) set('dob', 'Enter a valid date of birth');
  required('gender', 'Please select your gender');
  required('maritalStatus', 'Please select your marital status');
  if (required('passportNumber') && !PASSPORT_RE.test(data.passportNumber.trim())) {
    set('passportNumber', 'Passport number must be 6–9 letters or digits, no spaces');
  }
  pastDate('passportIssueDate', 'Issue date');
  if (!errors.passportIssueDate && data.dob && data.passportIssueDate < data.dob) {
    set('passportIssueDate', 'Issue date cannot be before your date of birth');
  }
  if (required('passportExpiryDate')) {
    if (data.passportIssueDate && data.passportExpiryDate <= data.passportIssueDate) {
      set('passportExpiryDate', 'Expiry date must be after the issue date');
    } else if (data.passportExpiryDate <= today) {
      set('passportExpiryDate', 'Your passport has expired');
    } else if (data.travelDate && data.passportExpiryDate <= data.travelDate) {
      set('passportExpiryDate', 'Passport must be valid beyond your intended travel date');
    }
  }
  required('placeOfBirth');
  name('nationality');

  // Section 2: Contact
  phone('mobileNumber');
  if (required('email') && !EMAIL_RE.test(data.email.trim())) set('email', 'Enter a valid email address');
  required('address');
  required('city');
  required('state');
  if (required('pincode') && !PINCODE_RE.test(data.pincode.trim())) set('pincode', 'Pincode must be 6 digits');
  name('emergencyName');
  phone('emergencyPhone');
  if (!errors.emergencyPhone && !errors.mobileNumber &&
      data.emergencyPhone.replace(/\D/g, '') === data.mobileNumber.replace(/\D/g, '')) {
    set('emergencyPhone', 'Emergency contact number must differ from your own number');
  }

  // Section 3: Travel
  required('purposeOfTravel', 'Please select the purpose of travel');
  if (required('travelDate') && data.travelDate <= today) set('travelDate', 'Travel date must be in the future');
  required('lengthOfStay');
  required('stayAddress');
  name('usContactName');
  phone('usContactPhone');
  required('traveledBefore', 'Please select an option');
  if (data.traveledBefore === 'Yes') required('travelDates', 'Please provide your previous travel dates');
  required('visaRefused', 'Please select an option');
  if (data.visaRefused === 'Yes') required('previousVisaDetails', 'Please provide previous visa details');

  // Section 4: Work / Study
  required('currentStatus', 'Please select your current status');
  if (data.currentStatus === 'Employed') {
    required('employerName');
    required('jobTitle');
    required('employerAddress');
    amount('monthlySalary');
    startDate('employmentStartDate');
  } else if (data.currentStatus === 'Self-employed') {
    required('businessName');
    required('natureOfBusiness');
    required('businessAddress');
    amount('annualIncome');
    startDate('businessStartDate');
  } else if (data.currentStatus === 'Student') {
    required('schoolName');
    required('courseProgram');
    startDate('schoolStartDate');
  }

  // Section 5: Family
  if (data.maritalStatus === 'Married') {
    name('spouseName');
    pastDate('spouseDob', 'Date of birth');
    required('spouseOccupation');
  }
  required('travelCompanions', 'Please select an option');
  if (data.travelCompanions === 'With family') required('companionNames', 'Please list the accompanying members');

  // Section 6: Security
  for (const q of SECURITY_QUESTIONS) {
    const { answer, details } = data[q] as SecurityQuestion;
    if (!answer) set(q, 'Please select an option');
    else if (answer === 'Yes' && !filled(details)) set(`${q}.details`, 'Please explain the details');
  }

  // Section 7: Uploads
  const file = (key: UploadKey, isRequired: boolean, imageOnly = false) => {
    const f = uploads[key];
    if (!f) {
      if (isRequired) set(key, 'Please upload this document');
      return;
    }
    const isImage = f.type.startsWith('image/');
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (imageOnly ? !isImage : !(isImage || isPdf)) {
      set(key, imageOnly ? 'Upload an image file (JPG or PNG)' : 'Upload an image or PDF file');
    } else if (f.size > MAX_FILE_SIZE) {
      set(key, 'File must be 5 MB or smaller');
    }
  };
  file('passportFront', true);
  file('passportBack', true);
  file('photo', true, true);
  file('oldPassports', false);
  file('previousVisa', false);

  // Final
  if (!data.declaration) set('declaration', 'You must confirm the declaration before submitting');

  return errors;
}
