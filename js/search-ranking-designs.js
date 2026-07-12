"use strict";

(function exposeRankingDesigns(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PalmoSearchRankingDesigns = api;
})(typeof window !== "undefined" ? window : null, function createRankingDesigns() {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeFields(baselineFields, overrides) {
    const fields = clone(baselineFields);
    for (const [name, parts] of Object.entries(overrides || {})) {
      fields[name] = { ...fields[name], ...parts };
    }
    return fields;
  }

  function mergeTypeBoosts(baselineBoosts, overrides) {
    return { ...baselineBoosts, ...overrides };
  }

  /**
   * Four sharp presets. Design 1 === production DEFAULT_RANKING (Recommended).
   */
  function buildDesigns(baseline) {
    return [
      {
        id: 1,
        name: "Recommended",
        blurb:
          "Articles + About first. Moderate fuzzy. Meta/listings are title-only in the index.",
        config: clone(baseline),
      },
      {
        id: 2,
        name: "Title-first",
        blurb: "Titles dominate — useful for jumping to tag/category hubs by name.",
        config: {
          ...clone(baseline),
          shortTitleExactFactor: 1.1,
          titleExact: 1400,
          titlePrefix: 900,
          titleIncludes: 600,
          titleSubsequence: 80,
          headingsIncludes: 0,
          contentIncludes: 0,
          tokenSubsequenceFallback: 15,
          fuzzyLenMid: 4,
          typeBoosts: mergeTypeBoosts(baseline.typeBoosts, {
            article: 10,
            page: 40,
            tag: 50,
            category: 20,
            home: 10,
            listing: -40,
          }),
          fields: mergeFields(baseline.fields, {
            title: { exact: 240, prefix: 190, fuzzy: 90, penalty: 20 },
            headings: { exact: 0, prefix: 0, fuzzy: 0, penalty: 0 },
            content: { exact: 8, prefix: 0, fuzzy: 0, penalty: 0 },
          }),
        },
      },
      {
        id: 3,
        name: "Typo-forgiving",
        blurb: "More aggressive fuzzy (from length 3). Use when typos are common.",
        config: {
          ...clone(baseline),
          fuzzyLenMid: 3,
          fuzzyLenHigh: 6,
          fuzzyEditsMid: 1,
          fuzzyEditsHigh: 2,
          fields: mergeFields(baseline.fields, {
            title: { exact: 170, prefix: 130, fuzzy: 150, penalty: 8 },
            headings: { exact: 100, prefix: 70, fuzzy: 90, penalty: 6 },
            content: { exact: 90, prefix: 65, fuzzy: 75, penalty: 5 },
          }),
        },
      },
      {
        id: 4,
        name: "Strict",
        blurb: "Exact/prefix only — typos and short subsequences usually return nothing.",
        config: {
          ...clone(baseline),
          fuzzyLenMid: 8,
          fuzzyLenHigh: 12,
          fuzzyEditsMid: 0,
          fuzzyEditsHigh: 1,
          titleSubsequence: 0,
          tokenSubsequenceFallback: 0,
          subsequenceMinLength: 8,
          fields: mergeFields(baseline.fields, {
            title: { exact: 200, prefix: 160, fuzzy: 0, penalty: 40 },
            headings: { exact: 100, prefix: 80, fuzzy: 0, penalty: 40 },
            content: { exact: 80, prefix: 55, fuzzy: 0, penalty: 40 },
          }),
        },
      },
    ];
  }

  return { buildDesigns };
});
