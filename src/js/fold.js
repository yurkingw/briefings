export const FOLD_STEP = 5;

export function nextFoldCount(shown, total, step = FOLD_STEP) {
  const safeTotal = Math.max(0, total);
  const next = Math.min(Math.max(0, shown) + step, safeTotal);
  return { shown: next, more: next < safeTotal };
}

export function bindArchiveFolds(root = document) {
  root.querySelectorAll("[data-fold]").forEach((list) => {
    const more = list.parentElement && list.parentElement.querySelector(".more");
    if (!more) return;
    const rows = () => [...list.querySelectorAll(".entry")];
    let shown = Math.min(FOLD_STEP, rows().length);
    if (shown >= rows().length) more.hidden = true;
    more.addEventListener("click", () => {
      const items = rows();
      const page = nextFoldCount(shown, items.length);
      for (let index = shown; index < page.shown; index += 1) {
        items[index].classList.add("is-open");
      }
      shown = page.shown;
      if (!page.more) more.hidden = true;
    });
  });
}

if (typeof document !== "undefined") bindArchiveFolds();
