import { assert } from "./errors.js";

export function positiveInteger(value, field) {
  const text = typeof value === "number" ? String(value) : value;
  assert(typeof text === "string" && /^[1-9]\d*$/.test(text), 400, `invalid_${field}`, `${field} must be a positive integer.`);
  const number = Number(text);
  assert(Number.isSafeInteger(number), 400, `invalid_${field}`, `${field} must be a positive integer.`);
  return number;
}

export function nonNegativeInteger(value, field, defaultValue, maximum) {
  if (value === undefined) return defaultValue;
  assert(typeof value === "string" && /^\d+$/.test(value), 400, `invalid_${field}`, `${field} must be a non-negative integer.`);
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number <= maximum, 400, `invalid_${field}`, `${field} is out of range.`);
  return number;
}
