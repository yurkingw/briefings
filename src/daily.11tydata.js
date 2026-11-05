export default {
  layout: "base.njk",
  pagination: {
    data: "briefings.daily",
    size: 1,
    alias: "briefing",
  },
  permalink(data) {
    if (!data.briefing?.date) return false;
    return `/daily/${data.briefing.date}/`;
  },
};
