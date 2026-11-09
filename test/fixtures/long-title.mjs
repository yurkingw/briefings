/**
 * Synthetic long title for EN full-title checks.
 * Test data only. Do not copy into content/ reports.
 * Built by concatenation so the exported string cannot stay an unexpanded placeholder.
 */
const cjk = "甲乙丙丁戊己庚辛壬癸";
const chinese = cjk.repeat(6);
const latin = "A".repeat(120);
const punctuation = "，。《》;:!?—-_/()";

export const SYNTHETIC_LONG_TITLE = `合成测例${punctuation}${chinese}${latin}（完）`;

export function syntheticTitleStats(title = SYNTHETIC_LONG_TITLE) {
  const chars = [...title];
  const cjkCount = chars.filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  const latinRun = title.match(/[A-Za-z]{120,}/);
  return {
    title,
    cjkCount,
    latinRun: latinRun ? latinRun[0].length : 0,
    hasPunctuation: /[，。《》;:!?—\-_()/]/.test(title),
    hasPlaceholder: title.includes("${"),
  };
}

const stats = syntheticTitleStats();
if (stats.cjkCount < 60 || stats.latinRun < 120 || !stats.hasPunctuation || stats.hasPlaceholder) {
  throw new Error(`synthetic long title is not expanded: ${JSON.stringify(stats)}`);
}
