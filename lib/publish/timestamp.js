import { fail } from "./errors.js";

const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;

export function parseUpdatedAt(value) {
  if (typeof value !== "string" || !STAMP.test(value)) throw fail(10, "bad_timestamp");
  const match = STAMP.exec(value);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const sign = match[7] === "-" ? -1 : 1;
  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetMinute > 59) {
    throw fail(10, "bad_timestamp");
  }
  const offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  if (offsetMinutes > 14 * 60 || offsetMinutes < -12 * 60) throw fail(10, "bad_timestamp");
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw fail(10, "bad_timestamp");
  }
  return { raw: value, instantMs: utc.getTime() - offsetMinutes * 60 * 1000 };
}
