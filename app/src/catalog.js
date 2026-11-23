// Fictional procedure codes and insurance plans for the demo.
export const PROCEDURES = [
  { code: 4401, name: "Appendectomy" },
  { code: 4402, name: "Cataract surgery" },
  { code: 5001, name: "Angioplasty" },
  { code: 6101, name: "Knee replacement" },
  { code: 7001, name: "Dialysis session" },
  { code: 8001, name: "Normal delivery" },
  { code: 9999, name: "Cosmetic surgery" },
];
export const procedureName = (code) => PROCEDURES.find((p) => p.code === Number(code))?.name ?? `Procedure ${code}`;

export const PLANS = [
  { name: "Gold", limitRupees: 300000, covered: [4401, 4402, 5001, 6101, 7001, 8001] },
  { name: "Silver", limitRupees: 50000, covered: [4401, 4402, 8001] },
  { name: "Basic", limitRupees: 30000, covered: [4402] },
];

// Common diagnoses (WHO ICD-10) with the procedure usually billed for them. Fictional demo use.
export const DIAGNOSES = [
  { icd: "K35.8", name: "Acute appendicitis", procedure: 4401 },
  { icd: "H25.9", name: "Age-related cataract", procedure: 4402 },
  { icd: "I21.9", name: "Acute myocardial infarction", procedure: 5001 },
  { icd: "M17.1", name: "Primary osteoarthritis of knee", procedure: 6101 },
  { icd: "N18.5", name: "Chronic kidney disease, stage 5", procedure: 7001 },
  { icd: "O80", name: "Single spontaneous delivery", procedure: 8001 },
  { icd: "Z41.1", name: "Cosmetic surgery (elective)", procedure: 9999 },
];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Human-readable policy number shown to people (the on-chain value is only a fingerprint).
export const policyNumber = (p) => `IT-${String(p.policyId).slice(-8)}`;
