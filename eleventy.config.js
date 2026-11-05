import { HtmlBasePlugin } from "@11ty/eleventy";
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
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addFilter("absoluteUrl", (url) => absoluteUrl(url));
  eleventyConfig.addFilter("yesNo", (value) => (value ? "Yes" : "No"));
  eleventyConfig.addFilter("metricLabel", (key) => METRIC_LABELS[key] || key);
  eleventyConfig.addFilter("withNotes", (items) =>
    (items || []).filter(
      (item) => item && (item.background || item.facts || item.why || item.arch_impact || (item.links && item.links.length)),
    ),
  );

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
