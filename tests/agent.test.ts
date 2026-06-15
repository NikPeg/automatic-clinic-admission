/**
 * Tests for the deterministic agent logic. The `validate` node does NOT call the
 * model (only `extract` does), so by pre-setting `extracted` we can exercise the
 * spell/confirm, date, phone-yes/no and review flows without any network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, reviewDecision, nextField } from "../lib/agent/nodes.ts";
import { buildGraph } from "../lib/agent/graph.ts";
import type { Extracted, IntakeStateType } from "../lib/agent/state.ts";

/** Build a full state with sensible defaults, overridden by `p`. */
function st(p: Partial<IntakeStateType>): IntakeStateType {
  return {
    messages: [],
    form: {},
    currentField: null,
    status: "collecting",
    userInput: null,
    assistantMessage: null,
    clarification: null,
    pending: null,
    confirmation: null,
    extracted: null,
    decision: null,
    ...p,
  } as IntakeStateType;
}

const ex = (e: Extracted): Extracted => e;
const FUTURE = `12/31/${new Date().getFullYear() + 1}`;

test("nextField walks the 7 fields, name first", () => {
  assert.equal(nextField({})?.key, "fullName");
  assert.equal(nextField({ fullName: "Jane Doe" })?.key, "reasonForVisit");
});

test("phone 'yes' uses the caller number — no digits dictated", () => {
  const r = validate(st({ currentField: "mobilePhone", userInput: "yes, this phone is fine" }));
  assert.equal(r.form?.mobilePhone, "(415) 555-0142");
  assert.equal(r.clarification, null);
});

test("phone 'no' asks for the number", () => {
  const r = validate(st({ currentField: "mobilePhone", userInput: "no, use my cell" }));
  assert.equal(r.form, undefined);
  assert.equal(r.clarification?.kind, "ask_phone_digits");
});

test("phone digit stage normalizes the dictated number", () => {
  const r = validate(
    st({
      currentField: "mobilePhone",
      clarification: { kind: "ask_phone_digits", fieldKey: "mobilePhone" },
      userInput: "415 555 0199",
      extracted: ex({ provided: true, value: "415-555-0199" }),
    }),
  );
  assert.equal(r.form?.mobilePhone, "(415) 555-0199");
});

test("phone: a number said directly at the yes/no stage is accepted", () => {
  const r = validate(st({ currentField: "mobilePhone", userInput: "you can reach me at 415 555 0123" }));
  assert.equal(r.form?.mobilePhone, "(415) 555-0123");
});

test("DOB rejects an impossible date (no model can 'fix' it)", () => {
  const r = validate(
    st({ currentField: "dob", userInput: "32 02 2002", extracted: ex({ provided: true, value: "32 02 2002" }) }),
  );
  assert.equal(r.form, undefined);
  assert.equal(r.clarification?.kind, "reask");
});

test("DOB accepts a real past date", () => {
  const r = validate(
    st({ currentField: "dob", userInput: "06/02/2002", extracted: ex({ provided: true, value: "06/02/2002" }) }),
  );
  assert.equal(r.form?.dob, "06/02/2002");
});

test("appointment date: explicit date is accepted without confirmation", () => {
  const r = validate(
    st({ currentField: "preferredDate", userInput: FUTURE, extracted: ex({ provided: true, value: FUTURE, explicit: true }) }),
  );
  assert.equal(r.form?.preferredDate, FUTURE);
  assert.equal(r.clarification, null);
});

test("appointment date: a relative date is read back to confirm", () => {
  const r = validate(
    st({ currentField: "preferredDate", userInput: "next Friday", extracted: ex({ provided: true, value: FUTURE, explicit: false }) }),
  );
  assert.equal(r.form, undefined);
  assert.equal(r.clarification?.kind, "confirm_date");
  assert.equal(r.pending, FUTURE);
});

test("appointment date: a past date is rejected", () => {
  const r = validate(
    st({ currentField: "preferredDate", userInput: "01/01/2000", extracted: ex({ provided: true, value: "01/01/2000", explicit: true }) }),
  );
  assert.equal(r.form, undefined);
  assert.equal(r.clarification?.kind, "reask");
});

test("name: spelled-out letters become a name awaiting confirmation", () => {
  const r = validate(
    st({ currentField: "fullName", clarification: { kind: "spell_name", fieldKey: "fullName" }, userInput: "n i k" }),
  );
  assert.equal(r.pending, "Nik");
  assert.equal(r.clarification?.kind, "confirm_name");
});

test("name: 'yes' at confirmation commits the pending name", () => {
  const r = validate(
    st({ currentField: "fullName", clarification: { kind: "confirm_name", fieldKey: "fullName" }, pending: "Nik", userInput: "yes" }),
  );
  assert.equal(r.form?.fullName, "Nik");
  assert.equal(r.clarification, null);
});

test("review: a plain 'yes' books immediately (no model call)", async () => {
  const r = await reviewDecision(st({ status: "reviewing", userInput: "yes, that's correct" }));
  assert.equal(r.decision, "submit");
});

test("after booking, a reply ends with a farewell — no re-asking a field", async () => {
  const graph = buildGraph();
  const res = await graph.invoke(
    st({ status: "confirmed", currentField: "patientType", userInput: "no", confirmation: "CLN-123", form: { fullName: "John Doe" } }),
  );
  assert.equal(res.status, "done");
  assert.doesNotMatch(res.assistantMessage ?? "", /new patient|date of birth|phone|reason for/i);
  assert.match(res.assistantMessage ?? "", /take care|all set|booked/i);
});
