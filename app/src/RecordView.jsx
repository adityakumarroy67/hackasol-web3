// Shows a decrypted (FHIR-shaped) medical record in plain words.
export default function RecordView({ record }) {
  const of = (type) => record.entry.filter((e) => e.resource.resourceType === type).map((e) => e.resource);
  const procedure = of("Procedure")[0];
  const coding = procedure?.code?.coding?.[0];
  return (
    <dl className="record">
      <dt>Patient</dt><dd>{of("Patient")[0]?.name?.[0]?.text ?? "—"}</dd>
      <dt>Diagnosis</dt><dd>{of("Condition")[0]?.code?.text ?? "—"}</dd>
      <dt>Procedure</dt><dd>{coding ? `${coding.display} (code ${coding.code})` : "—"}</dd>
      <dt>Date</dt><dd>{procedure?.performedDateTime ?? "—"}</dd>
      <dt>Prescriptions</dt><dd>{of("MedicationRequest").map((m) => m.medicationCodeableConcept?.text).join(", ") || "—"}</dd>
      <dt>Issued by</dt><dd>{of("Organization")[0]?.name ?? "—"}</dd>
    </dl>
  );
}
