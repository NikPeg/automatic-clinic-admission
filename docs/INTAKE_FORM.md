# Patient Intake Form — Fields & Validation

The intake is tailored for **US clinics** and conducted in **English**, **by voice** — the
patient speaks each answer and it arrives as a transcript (see [SPEC.md](SPEC.md)). Fields
are grouped into the five sections shown on the right-hand panel. The conversation collects
**required** fields first; optional fields are asked only if time/flow allows or the patient
volunteers them.

Because answers are transcribed speech, the agent must tolerate homophones, run-on numbers,
and mishearings: confirm low-confidence values by reading them back, and capture proper
nouns / IDs carefully (see the spell-by-letter rule below).

A shared **Zod schema** (`lib/schema.ts`) is the single source of truth for these fields
— used both for the model's structured extraction and for client-side form validation.

## 1. Demographics

| Field                 | Req | Format / values                         | Validation & re-ask behavior |
| --------------------- | --- | --------------------------------------- | ---------------------------- |
| Legal first name      | ✓   | Letters, spaces, `-`, `'`               | If it doesn't look like a name → **ask to spell letter by letter**, reconstruct, read back. |
| Middle name           |     | Same as above                           | Optional; "none" accepted.   |
| Legal last name       | ✓   | Same as above                           | Same spell-by-letter rule.   |
| Preferred name        |     | Free text                               | Optional.                    |
| Date of birth         | ✓   | `MM/DD/YYYY`                            | Real date, not in the future, plausible age. Bad format → re-ask with the example. |
| Sex assigned at birth | ✓   | Male / Female                           | Map synonyms; ask if unclear.|
| Gender identity       |     | Free text / decline                     | Optional.                    |
| SSN (last 4)          |     | 4 digits                                | **Optional & sensitive** — never required, never logged. |

## 2. Contact

| Field                  | Req | Format / values                          | Validation & re-ask behavior |
| ---------------------- | --- | ---------------------------------------- | ---------------------------- |
| Mobile phone           | ✓   | `(XXX) XXX-XXXX` (10 digits)             | Normalize digits to US format; bad → re-ask with example. |
| Email                  | ✓   | RFC-style email                          | Basic email validation.      |
| Preferred contact      |     | Phone / Email / Text                     | Optional.                    |
| Street address         | ✓   | Free text                                |                              |
| Apt / Unit             |     | Free text                                | Optional.                    |
| City                   | ✓   | Free text                                |                              |
| State                  | ✓   | 2-letter US state/territory (e.g. `CA`)  | Must be a valid USPS code (50 states + DC + territories). |
| ZIP code               | ✓   | `#####` or `#####-####`                  | 5 digits, or ZIP+4.          |

## 3. Insurance (US-specific)

| Field                   | Req | Format / values                                   | Notes |
| ----------------------- | --- | ------------------------------------------------- | ----- |
| Has insurance?          | ✓   | Yes / No                                          | "No" → branch to **Self-pay**, skip the rest. |
| Insurance type          | ✓*  | Private / Medicare / Medicaid / Tricare / Self-pay | *Required if insured. |
| Carrier                 | ✓*  | e.g. Aetna, Blue Cross Blue Shield, UnitedHealthcare, Cigna, Kaiser | Free text; suggest common carriers. |
| Member / Subscriber ID  | ✓*  | Alphanumeric                                      | As printed on the card. |
| Group number            |     | Alphanumeric                                      | Optional. |
| Policy holder           | ✓*  | Self / Spouse / Parent / Other                    | If not Self, ask holder name + DOB + relationship. |

## 4. Visit details

| Field                    | Req | Format / values                          | Notes |
| ------------------------ | --- | ---------------------------------------- | ----- |
| Reason for visit         | ✓   | Free text (chief complaint)              | Brief description of the problem. |
| Patient type             | ✓   | New / Established                        | |
| Preferred provider/dept  |     | Free text                                | e.g. Family Medicine, Pediatrics, Cardiology. |
| Preferred date / time    | ✓   | Free text or date                        | "Next Tuesday afternoon" is fine — capture intent. |
| Referral from PCP?       |     | Yes / No (+ referring physician)         | Optional. |
| Preferred pharmacy       |     | Name + location                          | Optional. |

## 5. Emergency contact & consents

| Field                       | Req | Format / values                  | Notes |
| --------------------------- | --- | -------------------------------- | ----- |
| Emergency contact name      | ✓   | Free text                        | |
| Emergency contact relation  | ✓   | Free text                        | |
| Emergency contact phone     | ✓   | `(XXX) XXX-XXXX`                 | Same phone validation. |
| Primary care physician      |     | Free text                        | Optional. |
| Preferred language          |     | Free text (default English)      | |
| Interpreter needed?         |     | Yes / No                         | Optional. |
| HIPAA acknowledgement        | ✓   | Acknowledged                     | Must be explicitly acknowledged. |
| Consent to treat            | ✓   | Agreed                           | Must be explicitly agreed. |

## Progress counting

The progress indicator (`N / total`) counts **required** fields only. The Submit button
activates when every required field is confirmed. Optional fields don't block submission.

## Cross-cutting rules

- **Names:** anything that doesn't read as a name (numbers, gibberish, single letters,
  obvious non-names, or a low-confidence transcript) triggers the **spell-by-letter**
  clarification — the patient says the letters aloud — before it is accepted, then it's read
  back for confirmation. The same applies to IDs/spellings that must be exact.
- **Formats:** dates, phones, and ZIPs are normalized to the canonical US format shown
  above; on failure the assistant re-asks with a concrete example.
- **Corrections:** a patient can correct any earlier field at any time; the form updates
  in place and the change is reflected on the right panel.
- **Sensitive data:** SSN last-4 is optional and never logged; insurance IDs are treated
  as sensitive. See [SPEC.md](SPEC.md) §8.
