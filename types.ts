export type WorkStatus = 'Employed' | 'Self-employed' | 'Student' | 'Homemaker' | 'Retired';

export interface SecurityQuestion {
  answer: 'Yes' | 'No' | null;
  details: string;
}

export interface FormData {
  // Section 1: Personal
  fullName: string;
  fatherName: string;
  motherName: string;
  dob: string;
  gender: string;
  maritalStatus: string;
  passportNumber: string;
  passportIssueDate: string;
  passportExpiryDate: string;
  placeOfBirth: string;
  nationality: string;

  // Section 2: Contact
  mobileNumber: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  emergencyName: string;
  emergencyPhone: string;

  // Section 3: Travel
  purposeOfTravel: string;
  travelDate: string;
  lengthOfStay: string;
  stayAddress: string;
  usContactName: string;
  usContactPhone: string;
  traveledBefore: 'Yes' | 'No' | null;
  travelDates: string;
  visaRefused: 'Yes' | 'No' | null; // Mapped to "Have you applied for a US visa earlier?" in prompt, but logically usually refers to refusal. Correcting to prompt: "Have you applied for a US visa earlier?"
  previousVisaDetails: string;

  // Section 4: Work/Study
  currentStatus: WorkStatus | '';
  // Employed
  employerName: string;
  jobTitle: string;
  employerAddress: string;
  monthlySalary: string;
  employmentStartDate: string;
  // Self-employed
  businessName: string;
  natureOfBusiness: string;
  businessAddress: string;
  annualIncome: string;
  businessStartDate: string;
  // Student
  schoolName: string;
  courseProgram: string;
  schoolStartDate: string;

  // Section 5: Family
  spouseName: string;
  spouseDob: string;
  spouseOccupation: string;
  travelCompanions: 'Alone' | 'With family' | null;
  companionNames: string;

  // Section 6: Security
  arrested: SecurityQuestion;
  immigrationViolation: SecurityQuestion;
  visaCanceled: SecurityQuestion;
  healthRisks: SecurityQuestion;

  // Final
  declaration: boolean;
}

export const INITIAL_DATA: FormData = {
  fullName: '',
  fatherName: '',
  motherName: '',
  dob: '',
  gender: '',
  maritalStatus: '',
  passportNumber: '',
  passportIssueDate: '',
  passportExpiryDate: '',
  placeOfBirth: '',
  nationality: '',
  mobileNumber: '',
  email: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  emergencyName: '',
  emergencyPhone: '',
  purposeOfTravel: '',
  travelDate: '',
  lengthOfStay: '',
  stayAddress: '',
  usContactName: '',
  usContactPhone: '',
  traveledBefore: null,
  travelDates: '',
  visaRefused: null,
  previousVisaDetails: '',
  currentStatus: '',
  employerName: '',
  jobTitle: '',
  employerAddress: '',
  monthlySalary: '',
  employmentStartDate: '',
  businessName: '',
  natureOfBusiness: '',
  businessAddress: '',
  annualIncome: '',
  businessStartDate: '',
  schoolName: '',
  courseProgram: '',
  schoolStartDate: '',
  spouseName: '',
  spouseDob: '',
  spouseOccupation: '',
  travelCompanions: null,
  companionNames: '',
  arrested: { answer: null, details: '' },
  immigrationViolation: { answer: null, details: '' },
  visaCanceled: { answer: null, details: '' },
  healthRisks: { answer: null, details: '' },
  declaration: false,
};