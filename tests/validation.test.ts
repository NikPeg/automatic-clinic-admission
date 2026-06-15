import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone,
  normalizeDob,
  normalizeFutureDate,
  looksLikeName,
  reconstructSpelledName,
} from "../lib/validation.ts";
import { IntakeSchema, applicableRequiredFields } from "../lib/schema.ts";

test("normalizePhone formats 10 digits and strips a leading 1", () => {
  assert.equal(normalizePhone("4155550142"), "(415) 555-0142");
  assert.equal(normalizePhone("415-555-0142"), "(415) 555-0142");
  assert.equal(normalizePhone("+1 (415) 555-0142"), "(415) 555-0142");
  assert.equal(normalizePhone("my number is 415.555.0142"), "(415) 555-0142");
});

test("normalizePhone rejects wrong-length input", () => {
  assert.equal(normalizePhone("555-0142"), null);
  assert.equal(normalizePhone("12345678901234"), null);
});

test("normalizeDob accepts real past dates in many shapes", () => {
  assert.equal(normalizeDob("05/14/1990"), "05/14/1990");
  assert.equal(normalizeDob("5/4/1990"), "05/04/1990");
  assert.equal(normalizeDob("12-31-1985"), "12/31/1985");
  assert.equal(normalizeDob("06 03 2002"), "06/03/2002"); // spaces
  assert.equal(normalizeDob("1990-05-14"), "05/14/1990"); // ISO
  assert.equal(normalizeDob("May 14, 1990"), "05/14/1990"); // month name
  assert.equal(normalizeDob("14th May 1990"), "05/14/1990"); // ordinal + name
});

test("normalizeDob rejects impossible and future dates", () => {
  assert.equal(normalizeDob("02/30/1990"), null); // no Feb 30
  assert.equal(normalizeDob("32 02 2002"), null); // no day 32 / month 32
  assert.equal(normalizeDob("13/01/1990"), null); // no month 13
  assert.equal(normalizeDob("01/01/3000"), null); // future
  assert.equal(normalizeDob("not a date"), null);
});

test("normalizeFutureDate accepts today/future, rejects past", () => {
  const today = new Date();
  const todayStr = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;
  assert.equal(normalizeFutureDate(todayStr), todayStr); // today is OK
  assert.equal(normalizeFutureDate(`12/31/${today.getFullYear() + 1}`), `12/31/${today.getFullYear() + 1}`);
  assert.equal(normalizeFutureDate("01/01/2000"), null); // past
  assert.equal(normalizeFutureDate("whenever"), null); // unparseable
});

test("looksLikeName accepts names, rejects numbers and symbols", () => {
  assert.ok(looksLikeName("Jane"));
  assert.ok(looksLikeName("O'Brien"));
  assert.ok(looksLikeName("Anne-Marie"));
  assert.ok(!looksLikeName("123"));
  assert.ok(!looksLikeName("J"));
  assert.ok(!looksLikeName("@#$"));
});

test("reconstructSpelledName joins spelled-out letters", () => {
  assert.equal(reconstructSpelledName("J A N E"), "Jane");
  assert.equal(reconstructSpelledName("d-o-e"), "Doe");
  assert.equal(reconstructSpelledName("J. A. N. E."), "Jane");
  assert.equal(reconstructSpelledName("Jane"), null); // not spelled out
});

test("IntakeSchema accepts a complete valid intake", () => {
  const ok = IntakeSchema.safeParse({
    fullName: "Jane Doe",
    reasonForVisit: "Annual physical",
    dob: "05/14/1990",
    mobilePhone: "(415) 555-0142",
    preferredDate: `12/31/${new Date().getFullYear() + 1}`,
    hasInsurance: false,
    patientType: "New",
  });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
});

test("IntakeSchema rejects a bad name and a bad date", () => {
  const res = IntakeSchema.safeParse({
    fullName: "123",
    reasonForVisit: "Cough",
    dob: "not a date",
    mobilePhone: "(415) 555-0142",
    preferredDate: `12/31/${new Date().getFullYear() + 1}`,
    hasInsurance: true,
    patientType: "Established",
  });
  assert.ok(!res.success);
  const paths = res.error!.issues.map((i) => i.path.join("."));
  assert.ok(paths.includes("fullName"));
  assert.ok(paths.includes("dob"));
});

test("applicableRequiredFields returns the 7 essentials", () => {
  const fields = applicableRequiredFields({});
  assert.equal(fields.length, 7);
  assert.ok(fields.some((f) => f.key === "reasonForVisit"));
});
