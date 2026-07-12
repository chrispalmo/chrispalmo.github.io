"use strict";

(function exposeSearchCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PalmoSearchCore = api;
})(typeof window !== "undefined" ? window : null, function createSearchCore() {
  const RANKING = {
    resultLimit: 10,
    fuzzyLenMid: 4,
    fuzzyLenHigh: 8,
    fuzzyEditsMid: 1,
    fuzzyEditsHigh: 1,
    titleExact: 1000,
    titlePrefix: 650,
    titleIncludes: 380,
    titleSubsequence: 220,
    headingsIncludes: 240,
    descriptionIncludes: 0,
    contentIncludes: 180,
    tokenSubsequenceFallback: 55,
    subsequenceMinLength: 3,
    subsequenceMaxSpanFactor: 3,
    shortTitleExactFactor: 0.28,
    typeBoosts: {
      article: 80,
      page: 110,
      tag: -110,
      category: -50,
      home: -30,
      listing: -130,
    },
    fields: {
      title: { exact: 170, prefix: 130, fuzzy: 100, penalty: 16 },
      headings: { exact: 120, prefix: 90, fuzzy: 60, penalty: 12 },
      description: { exact: 0, prefix: 0, fuzzy: 0, penalty: 0 },
      content: { exact: 100, prefix: 75, fuzzy: 55, penalty: 8 },
    },
  };

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    return normalize(value).split(" ").filter(Boolean);
  }

  function boundedDistance(a, b, limit) {
    if (a === b) return 0;
    if (!a || !b || Math.abs(a.length - b.length) > limit) return limit + 1;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    let previousPrevious = null;

    for (let row = 1; row <= a.length; row++) {
      const current = [row];
      let rowMinimum = row;
      for (let column = 1; column <= b.length; column++) {
        const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
        let value = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          substitution
        );
        if (
          previousPrevious &&
          row > 1 &&
          column > 1 &&
          a[row - 1] === b[column - 2] &&
          a[row - 2] === b[column - 1]
        ) {
          value = Math.min(value, previousPrevious[column - 2] + 1);
        }
        current[column] = value;
        rowMinimum = Math.min(rowMinimum, value);
      }
      if (rowMinimum > limit) return limit + 1;
      previousPrevious = previous;
      previous = current;
    }

    return previous[b.length];
  }

  function fuzzyLimit(token) {
    if (token.length >= RANKING.fuzzyLenHigh) return RANKING.fuzzyEditsHigh;
    if (token.length >= RANKING.fuzzyLenMid) return RANKING.fuzzyEditsMid;
    return 0;
  }

  function prepareDocument(document) {
    const prepared = {
      ...document,
      _title: normalize(document.title),
      _description: normalize(document.description),
      _headings: normalize((document.headings || []).join(" ")),
      _content: normalize(document.content),
    };
    prepared._titleTokens = tokenize(prepared._title);
    prepared._headingTokens = tokenize(prepared._headings);
    prepared._descriptionTokens = tokenize(prepared._description);
    prepared._contentTokens = tokenize(prepared._content);
    return prepared;
  }

  function isPrefixMatch(queryToken, token) {
    if (token.startsWith(queryToken)) return true;
    // Reverse prefix only for short stem extensions (react → reacts), not const → consultant.
    if (token.length < 4) return false;
    if (!queryToken.startsWith(token)) return false;
    return queryToken.length - token.length <= 2;
  }

  function bestTokenScore(queryToken, fieldTokens, weights) {
    let best = 0;
    const limit = fuzzyLimit(queryToken);
    for (const token of fieldTokens) {
      if (token === queryToken) best = Math.max(best, weights.exact);
      else if (isPrefixMatch(queryToken, token)) {
        best = Math.max(best, weights.prefix);
      } else if (limit > 0) {
        const distance = boundedDistance(queryToken, token, limit);
        if (distance <= limit) {
          best = Math.max(best, weights.fuzzy - distance * weights.penalty);
        }
      }
      if (best === weights.exact) break;
    }
    return best;
  }

  function fieldWeightList() {
    const fields = RANKING.fields;
    return [
      ["_titleTokens", fields.title],
      ["_headingTokens", fields.headings],
      ["_descriptionTokens", fields.description],
      ["_contentTokens", fields.content],
    ];
  }

  /**
   * Compact subsequence: chars of needle appear in order within a limited span.
   * Returns true when a match exists whose inclusive span is
   * <= max(needle.length * factor, needle.length + 2).
   */
  function compactSubsequenceMatch(haystack, needle) {
    if (!needle) return true;
    if (!haystack) return false;
    if (needle.length < RANKING.subsequenceMinLength) return false;

    const maxSpan = Math.max(
      needle.length * RANKING.subsequenceMaxSpanFactor,
      needle.length + 2
    );

    for (let start = 0; start < haystack.length; start++) {
      if (haystack[start] !== needle[0]) continue;
      let qi = 1;
      let end = start;
      for (let i = start + 1; i < haystack.length && qi < needle.length; i++) {
        if (haystack[i] === needle[qi]) {
          qi += 1;
          end = i;
        }
        if (i - start + 1 > maxSpan) break;
      }
      if (qi === needle.length && end - start + 1 <= maxSpan) return true;
    }
    return false;
  }

  function scoreDocument(prepared, query) {
    const normalizedQuery = normalize(query);
    const queryTokens = tokenize(normalizedQuery);
    if (!normalizedQuery || queryTokens.length === 0) return 0;

    const titleCompact = prepared._title.replace(/\s+/g, "");
    const queryCompact = normalizedQuery.replace(/\s+/g, "");

    let score = 0;
    if (prepared._title === normalizedQuery) {
      const exactBonus =
        prepared._titleTokens.length <= 1
          ? Math.round(RANKING.titleExact * RANKING.shortTitleExactFactor)
          : RANKING.titleExact;
      score += exactBonus;
    } else if (prepared._title.startsWith(normalizedQuery)) score += RANKING.titlePrefix;
    else if (prepared._title.includes(normalizedQuery)) score += RANKING.titleIncludes;
    else if (compactSubsequenceMatch(titleCompact, queryCompact)) {
      score += RANKING.titleSubsequence;
    }

    if (prepared._headings.includes(normalizedQuery)) score += RANKING.headingsIncludes;
    if (prepared._description.includes(normalizedQuery)) {
      score += RANKING.descriptionIncludes;
    }
    if (prepared._content.includes(normalizedQuery)) score += RANKING.contentIncludes;

    for (const queryToken of queryTokens) {
      let tokenScore = 0;
      for (const [field, weights] of fieldWeightList()) {
        tokenScore = Math.max(
          tokenScore,
          bestTokenScore(queryToken, prepared[field], weights)
        );
      }
      if (
        tokenScore === 0 &&
        compactSubsequenceMatch(titleCompact, queryToken)
      ) {
        tokenScore = RANKING.tokenSubsequenceFallback;
      }
      if (tokenScore === 0) return 0;
      score += tokenScore;
    }

    const typeBoost = RANKING.typeBoosts[prepared.type];
    if (typeof typeBoost === "number") score += typeBoost;

    return score;
  }

  function createSnippet(document, query, length = 180) {
    const content = String(document.content || "");
    if (!content) return String(document.description || "");
    const normalizedContent = normalize(content);
    const tokens = tokenize(query);
    let index = -1;

    for (const token of tokens) {
      index = normalizedContent.indexOf(token);
      if (index >= 0) break;
    }

    if (index < 0) return String(document.description || content).slice(0, length).trim();

    const start = Math.max(0, index - Math.floor(length * 0.3));
    const end = Math.min(content.length, start + length);
    const prefix = start > 0 ? "\u2026" : "";
    const suffix = end < content.length ? "\u2026" : "";
    return `${prefix}${content.slice(start, end).trim()}${suffix}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function foldChar(char) {
    return String(char || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function highlightMatches(text, query) {
    const source = String(text || "");
    if (!source) return "";
    const tokens = tokenize(query);
    if (!tokens.length) return escapeHtml(source);

    const matched = new Array(source.length).fill(false);
    const lower = source.toLowerCase();
    let usedSubstring = false;

    // Prefer contiguous token spans so "Consultant" marks the whole word,
    // not a greedy letter-by-letter subsequence earlier in the sentence.
    for (const token of tokens) {
      let from = 0;
      while (from < lower.length) {
        const at = lower.indexOf(token, from);
        if (at < 0) break;
        usedSubstring = true;
        for (let i = at; i < at + token.length; i++) matched[i] = true;
        from = at + token.length;
      }
    }

    if (!usedSubstring) {
      const queryChars = normalize(query).replace(/\s+/g, "");
      if (queryChars) {
        let qi = 0;
        for (let i = 0; i < source.length && qi < queryChars.length; i++) {
          if (foldChar(source[i]) === queryChars[qi]) {
            matched[i] = true;
            qi += 1;
          }
        }
        if (qi < queryChars.length) matched.fill(false);
      }
    }

    let html = "";
    let open = false;
    for (let i = 0; i < source.length; i++) {
      if (matched[i] && !open) {
        html += '<mark class="site-search__match">';
        open = true;
      } else if (!matched[i] && open) {
        html += "</mark>";
        open = false;
      }
      html += escapeHtml(source[i]);
    }
    if (open) html += "</mark>";
    return html;
  }

  function rankDocuments(documents, query, limit) {
    const resultLimit =
      limit == null || Number.isNaN(Number(limit))
        ? RANKING.resultLimit
        : Number(limit);
    return documents
      .map((document) => {
        const prepared = document._title ? document : prepareDocument(document);
        return {
          document,
          score: scoreDocument(prepared, query),
          snippet: createSnippet(document, query),
        };
      })
      .filter((result) => result.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          String(a.document.title).localeCompare(String(b.document.title))
      )
      .slice(0, resultLimit);
  }

  return {
    boundedDistance,
    compactSubsequenceMatch,
    createSnippet,
    escapeHtml,
    highlightMatches,
    normalize,
    prepareDocument,
    rankDocuments,
    scoreDocument,
    tokenize,
  };
});
