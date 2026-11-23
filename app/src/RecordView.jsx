// Shows a decrypted (FHIR-shaped) medical record in plain words.
import { Fragment } from "react";

const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");

export default function RecordView({ record }) {
  const all = (type) => record.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
  const one = (type) => all(type)[0];
  const [p, cond, proc, enc, doc, org, inv] = ["Patient", "Condition", "Procedure", "Encounter", "Practitioner", "Organization", "Invoice"].map(one);
  const blood = all("Observation").find((o) => o.code?.text === "Blood group")?.valueString;
  const coding = proc?.code?.coding?.[0];
  const icd = cond?.code?.coding?.[0]?.code;
  const join = (...parts) => parts.filter(Boolean).join(" · ");

  const rows = [
    ["Patient", join(p?.name?.[0]?.text, p?.gender, p?.birthDate && `born ${p.birthDate}`, blood && `blood group ${blood}`)],
    ["ABHA number", p?.identifier?.[0]?.value],
    ["Contact", join(p?.telecom?.[0]?.value, p?.contact?.[0]?.name?.text && `emergency: ${p.contact[0].name.text}`)],
    ["Admission", enc && `${enc.period.start} → ${enc.period.end ?? "still admitted"}`],
    ["Diagnosis", cond && `${cond.code.text}${icd ? ` (ICD-10 ${icd})` : ""}`],
    ["Procedure", coding && `${coding.display} (code ${coding.code})${proc.performedDateTime ? ` on ${proc.performedDateTime}` : ""}`],
    ["Treating doctor", doc && join(doc.name?.[0]?.text, doc.identifier?.[0]?.value && `Reg. ${doc.identifier[0].value}`)],
    ["Prescriptions", all("MedicationRequest").map((m) => join(m.medicationCodeableConcept?.text, m.dosageInstruction?.[0]?.text)).join("; ")],
    ["Clinical notes", proc?.note?.[0]?.text],
    ["Hospital", org && join(org.name, org.identifier?.[0]?.value && `Reg. ${org.identifier[0].value}`, org.address?.[0]?.city)],
    ["Bill", inv && `${inv.lineItem.map((l) => `${l.chargeItemCodeableConcept.text} ${inr(l.priceComponent[0].amount.value)}`).join(", ")} → total ${inr(inv.totalGross.value)}${inv.identifier ? ` (${inv.identifier[0].value})` : ""}`],
  ].filter(([, v]) => v);

  return <dl className="record">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}
