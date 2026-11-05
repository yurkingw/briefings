export default {
  layout: "base.njk",
  pagination: {
    data: "briefings.weekly",
    size: 1,
    alias: "briefing",
  },
  permalink(data) {
    if (!data.briefing?.week) return false;
    return `/weekly/${data.briefing.week}/`;
  },
};
