import { HtmlBasePlugin } from "@11ty/eleventy";
import { excerpt } from "./lib/excerpt.js";
import {
  detailCards,
  githubSummary,
  hasField,
  defaultWave,
  hasWaveSplit,
  hotFromItems,
  linkLabel,
  ownerType,
  remainderNews,
  selectHot,
  statusItems,
  tocGroups,
  waveItems,
  withNotes,
} from "./lib/pages-parity.js";
import { absoluteUrl, site } from "./lib/site.js";

const METRIC_LABELS = {
  news: "News",
  finsec: "Finsec",
  papers: "Papers",
  gh_rising: "GitHub rising",
  gh_newcomers: "GitHub newcomers",
  home_related: "Home-related",
  news_featured: "Featured news",
  papers_featured: "Featured papers",
  gh_featured: "Featured GitHub",
  decisions: "Decisions",
};

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);
  eleventyConfig.addPassthroughCopy({
    "src/css": "css",
    "src/js": "js",
    "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2": "fonts/inter-latin-wght-normal.woff2",
    "node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2": "fonts/inter-latin-ext-wght-normal.woff2",
  });
  eleventyConfig.addFilter("excerpt", (value, max = 150) => excerpt(value, max));
  eleventyConfig.addFilter("absoluteUrl", (url) => absoluteUrl(url));
  eleventyConfig.addFilter("yesNo", (value) => (value ? "Yes" : "No"));
  eleventyConfig.addFilter("metricLabel", (key) => METRIC_LABELS[key] || key);
  eleventyConfig.addFilter("withNotes", (items) => withNotes(items));
  eleventyConfig.addFilter("tocGroups", (items, kind) => tocGroups(items, kind));
  eleventyConfig.addFilter("hotThisWave", (briefing) => selectHot(briefing));
  eleventyConfig.addFilter("detailCards", (items) => detailCards(items));
  eleventyConfig.addFilter("remainderNews", (items) => remainderNews(items));
  eleventyConfig.addFilter("hotFromItems", (items) => hotFromItems(items));
  eleventyConfig.addFilter("waveItems", (items, bucket) => waveItems(items, bucket));
  eleventyConfig.addFilter("hasWaveSplit", (briefing) => hasWaveSplit(briefing));
  eleventyConfig.addFilter("defaultWave", (briefing) => defaultWave(briefing));
  eleventyConfig.addFilter("statusItems", (briefing) => statusItems(briefing));
  eleventyConfig.addFilter("hasField", (rows, key) => hasField(rows, key));
  eleventyConfig.addFilter("ownerType", (value) => ownerType(value));
  eleventyConfig.addFilter("linkLabel", (value) => linkLabel(value));
  eleventyConfig.addFilter("githubSummary", (meta) => githubSummary(meta));

  return {
    pathPrefix: site.pathPrefix,
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
}
