/**
 * Synthetic long title for EN full-title checks.
 * Test data only. Do not copy into content/ reports.
 */
const cjk = "甲乙丙丁戊己庚辛壬癸";
const chinese = Array.from({ length: 6 }, () => cjk).join("");
const latin = "A".repeat(120);

export const SYNTHETIC_LONG_TITLE = `合成测例，。《》;:!?—-_/()${chinese}${latin}（完）`;

export function syntheticTitleStats(title = SYNTHETIC_LONG_TITLE) {
  const chars = [...title];
  const cjkCount = chars.filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  const latinRun = title.match(/[A-Za-z]{120,}/);
  return {
    title,
    cjkCount,
    latinRun: latinRun ? latinRun[0].length : 0,
    hasPunctuation: /[，。《》;:!?—\-_()/]/.test(title),
  };
}
