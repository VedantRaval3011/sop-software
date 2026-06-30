export const CAPSULE_DEPARTMENTS = [
  "QA",
  "QC",
  "Production",
  "Stores",
  "Engineering",
  "HR",
  "Microbiology",
  "R&D",
  "Regulatory Affairs",
  "Accounts",
  "Admin",
  "Purchase",
  "General",
] as const;

export type CapsuleDepartment = (typeof CAPSULE_DEPARTMENTS)[number];
