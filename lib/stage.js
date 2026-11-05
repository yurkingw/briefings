export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isoWeekId(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`date must be YYYY-MM-DD, got ${date}`);
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const dayOfYear = (utc - yearStart) / 86400000 + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function selectStage(briefings, now = new Date()) {
  const date = shanghaiDate(now);
  const week = isoWeekId(date);
  const daily = (briefings.daily || []).find((item) => item.date === date) || null;
  const weekly = (briefings.weekly || []).find((item) => item.week === week) || null;
  return { date, week, daily, weekly };
}
