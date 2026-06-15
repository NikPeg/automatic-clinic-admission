"use client";

// `insured` rows only appear once the patient says they have insurance.
const FIELDS: { key: string; label: string; insured?: boolean }[] = [
  { key: "fullName", label: "Full name" },
  { key: "reasonForVisit", label: "Reason for visit" },
  { key: "dob", label: "Date of birth" },
  { key: "mobilePhone", label: "Phone" },
  { key: "preferredDate", label: "Preferred date" },
  { key: "hasInsurance", label: "Insurance" },
  { key: "insuranceCarrier", label: "Insurance carrier", insured: true },
  { key: "insuranceMemberId", label: "Member ID", insured: true },
  { key: "insuranceGroupNumber", label: "Group number", insured: true },
  { key: "patientType", label: "Patient type" },
];

function display(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function IntakeForm({
  form,
  confirmation,
}: {
  form: Record<string, unknown>;
  confirmation: string | null;
}) {
  // Insurance-detail rows apply only when the patient has insurance.
  const visible = FIELDS.filter((f) => !f.insured || form.hasInsurance === true);
  const filled = visible.filter((f) => form[f.key] != null && form[f.key] !== "").length;
  const pct = Math.round((filled / visible.length) * 100);

  return (
    <section className="h-full overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold">Patient intake</h2>
          <p className="text-xs text-[var(--color-muted)]">Fills in as the conversation goes</p>
        </div>
        <span className="text-xs font-medium tabular-nums text-[var(--color-muted)]">
          {filled} / {visible.length}
        </span>
      </div>

      <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="divide-y divide-[var(--color-line)]">
        {visible.map((f) => {
          const v = form[f.key];
          const has = v != null && v !== "";
          return (
            <div key={f.key} className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-sm text-[var(--color-muted)]">{f.label}</dt>
              {has ? (
                <dd key={display(v)} className="field-in flex items-center gap-2 text-sm font-medium tabular-nums">
                  <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
                  {display(v)}
                </dd>
              ) : (
                <dd className="text-sm text-slate-300">—</dd>
              )}
            </div>
          );
        })}
      </dl>

      {confirmation && (
        <div className="field-in mt-5 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-4">
          <p className="text-xs font-medium text-[var(--color-accent)]">Appointment booked</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">Confirmation {confirmation}</p>
        </div>
      )}
    </section>
  );
}
