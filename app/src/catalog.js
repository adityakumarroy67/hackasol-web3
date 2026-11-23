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
