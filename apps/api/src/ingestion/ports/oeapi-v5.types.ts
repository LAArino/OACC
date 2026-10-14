// SPDX-License-Identifier: EUPL-1.2
/** Subset of OEAPI v5.0 resources read by the harvester (spec §6.2.3–6.2.4). */

export interface LanguageTypedString {
  language: string;
  value: string;
}

export interface OeapiV5Page<T> {
  pageSize: number;
  pageNumber: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  items: T[];
}

export interface OeapiV5Organization {
  organizationId: string;
  primaryCode: { codeType: string; code: string };
  organizationType: string;
  name: LanguageTypedString[];
}

export interface OeapiV5AcademicSession {
  academicSessionId: string;
  academicSessionType?: string;
  name: LanguageTypedString[];
  startDate: string;
  endDate: string;
}

export interface OeapiV5Course {
  courseId: string;
  primaryCode?: { codeType: string; code: string };
  name: LanguageTypedString[];
  abstract?: LanguageTypedString[];
  description?: LanguageTypedString[];
  admissionRequirements?: LanguageTypedString[];
  assessment?: LanguageTypedString[];
  learningOutcomes?: LanguageTypedString[][];
  studyLoad?: { studyLoadUnit: string; value: number };
  fieldsOfStudy?: string;
  level?: string;
  link?: string;
  teachingLanguage?: string;
  modeOfDelivery?: string[];
}

export interface OeapiV5Offering {
  offeringId: string;
  primaryCode?: { codeType: string; code: string };
  startDate?: string;
  endDate?: string;
  enrollStartDate?: string;
  enrollEndDate?: string;
  teachingLanguage?: string;
  modeOfDelivery?: string[];
  maxNumberStudents?: number;
  enrolledNumberStudents?: number;
  pendingNumberStudents?: number;
  link?: string;
  academicSession?: OeapiV5AcademicSession | string;
}
