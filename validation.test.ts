import { describe, expect, it } from 'vitest';
import { FormData, INITIAL_DATA } from './types';
import { INITIAL_UPLOADS, MAX_FILE_SIZE, Uploads, validateForm } from './validation';

const TODAY = '2026-10-12';

const fakeFile = (name: string, type: string, size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const VALID_DATA: FormData = {
  ...INITIAL_DATA,
  fullName: 'Singh, Anoop',
  fatherName: 'Raj Singh',
  motherName: 'Priya Singh',
  dob: '1990-05-20',
  gender: 'Male',
  maritalStatus: 'Single',
  passportNumber: 'Z1234567',
  passportIssueDate: '2020-01-15',
  passportExpiryDate: '2030-01-14',
  placeOfBirth: 'Delhi',
  nationality: 'Indian',
  mobileNumber: '+91 98765 43210',
  email: 'anoop@example.com',
  address: '12 MG Road',
  city: 'Delhi',
  state: 'Delhi',
  pincode: '110001',
  emergencyName: 'Raj Singh',
  emergencyPhone: '+91 91234 56789',
  purposeOfTravel: 'Tourism',
  travelDate: '2027-03-01',
  lengthOfStay: '2 weeks',
  stayAddress: 'Hilton, New York',
  usContactName: 'John Smith',
  usContactPhone: '+1 (212) 555-0100',
  traveledBefore: 'No',
  visaRefused: 'No',
  currentStatus: 'Homemaker',
  travelCompanions: 'Alone',
  arrested: { answer: 'No', details: '' },
  immigrationViolation: { answer: 'No', details: '' },
  visaCanceled: { answer: 'No', details: '' },
  healthRisks: { answer: 'No', details: '' },
  declaration: true,
};

const VALID_UPLOADS: Uploads = {
  ...INITIAL_UPLOADS,
  passportFront: fakeFile('front.pdf', 'application/pdf'),
  passportBack: fakeFile('back.jpg', 'image/jpeg'),
  photo: fakeFile('photo.jpg', 'image/jpeg'),
};

const errorsFor = (data: Partial<FormData>, uploads: Partial<Uploads> = {}) =>
  validateForm({ ...VALID_DATA, ...data }, { ...VALID_UPLOADS, ...uploads }, TODAY);

describe('validateForm', () => {
  it('accepts a fully valid form', () => {
    expect(errorsFor({})).toEqual({});
  });

  it('flags every required field on an empty form, starting with the first field', () => {
    const errors = validateForm(INITIAL_DATA, INITIAL_UPLOADS, TODAY);
    expect(Object.keys(errors)[0]).toBe('fullName');
    for (const key of ['email', 'travelDate', 'currentStatus', 'arrested', 'passportFront', 'photo', 'declaration']) {
      expect(errors).toHaveProperty(key);
    }
    expect(errors).not.toHaveProperty('oldPassports');
  });

  it('treats whitespace-only values as empty', () => {
    expect(errorsFor({ city: '   ' }).city).toBe('This field is required');
  });

  it('validates name characters', () => {
    expect(errorsFor({ fatherName: 'R4j' })).toHaveProperty('fatherName');
    expect(errorsFor({ fatherName: "D'Souza-Pereira Jr." })).not.toHaveProperty('fatherName');
  });

  it('validates email, phone, pincode and passport formats', () => {
    expect(errorsFor({ email: 'anoop@example' })).toHaveProperty('email');
    expect(errorsFor({ mobileNumber: '12345' })).toHaveProperty('mobileNumber');
    expect(errorsFor({ mobileNumber: '98765-43210' })).not.toHaveProperty('mobileNumber');
    expect(errorsFor({ pincode: '1100' })).toHaveProperty('pincode');
    expect(errorsFor({ passportNumber: 'Z 123 4567' })).toHaveProperty('passportNumber');
  });

  it('rejects an emergency number equal to the applicant number', () => {
    expect(errorsFor({ emergencyPhone: '+91-98765-43210' })).toHaveProperty('emergencyPhone');
  });

  it('checks date ordering', () => {
    expect(errorsFor({ dob: '2027-01-01' }).dob).toMatch(/future/);
    expect(errorsFor({ dob: '1890-01-01' })).toHaveProperty('dob');
    expect(errorsFor({ passportIssueDate: '1989-01-01' }).passportIssueDate).toMatch(/date of birth/);
    expect(errorsFor({ passportExpiryDate: '2019-12-31' }).passportExpiryDate).toMatch(/after the issue date/);
    expect(errorsFor({ passportExpiryDate: '2026-10-01' }).passportExpiryDate).toMatch(/expired/);
    expect(errorsFor({ passportExpiryDate: '2027-02-01' }).passportExpiryDate).toMatch(/travel date/);
    expect(errorsFor({ travelDate: TODAY }).travelDate).toMatch(/future/);
  });

  it('requires follow-up answers only when they apply', () => {
    expect(errorsFor({ traveledBefore: 'Yes' })).toHaveProperty('travelDates');
    expect(errorsFor({ traveledBefore: 'No', travelDates: '' })).not.toHaveProperty('travelDates');
    expect(errorsFor({ visaRefused: 'Yes' })).toHaveProperty('previousVisaDetails');
    expect(errorsFor({ travelCompanions: 'With family' })).toHaveProperty('companionNames');
    expect(errorsFor({ maritalStatus: 'Married' })).toHaveProperty('spouseName');
    expect(errorsFor({ maritalStatus: 'Single' })).not.toHaveProperty('spouseName');
  });

  it('validates employment details for the chosen status', () => {
    const errors = errorsFor({
      currentStatus: 'Employed',
      employerName: 'Acme',
      jobTitle: 'Engineer',
      employerAddress: 'Bengaluru',
      monthlySalary: '50k',
      employmentStartDate: '2027-01-01',
    });
    expect(errors.monthlySalary).toMatch(/numbers/);
    expect(errors.employmentStartDate).toMatch(/future/);
    expect(errorsFor({ currentStatus: 'Self-employed', annualIncome: '12,00,000' })).not.toHaveProperty('annualIncome');
    expect(errorsFor({ currentStatus: 'Student' })).toHaveProperty('schoolName');
  });

  it('requires details for security questions answered Yes', () => {
    expect(errorsFor({ arrested: { answer: 'Yes', details: ' ' } })).toHaveProperty(['arrested.details']);
    expect(errorsFor({ arrested: { answer: 'Yes', details: 'Traffic fine, 2015' } })).toEqual({});
  });

  it('checks upload type and size', () => {
    expect(errorsFor({}, { photo: fakeFile('photo.pdf', 'application/pdf') }).photo).toMatch(/image/);
    expect(errorsFor({}, { passportFront: fakeFile('a.docx', 'application/msword') })).toHaveProperty('passportFront');
    expect(errorsFor({}, { previousVisa: fakeFile('v.jpg', 'image/jpeg', MAX_FILE_SIZE + 1) }).previousVisa).toMatch(/5 MB/);
  });

  it('requires the declaration', () => {
    expect(errorsFor({ declaration: false })).toHaveProperty('declaration');
  });
});
