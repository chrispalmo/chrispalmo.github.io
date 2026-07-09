/**
 * palmo.xyz article analytics tracker.
 * Emits PostHog events when window.posthog is available; otherwise no-ops.
 * Loaded on every page; article events only run when [data-analytics-article] exists.
 */
(function () {
  "use strict";

  var RETURN_KEY = "palmo_analytics_return";
  var META_KEYS = [
    "article_id",
    "proposal_id",
    "persona",
    "topic_cluster",
    "funnel_stage",
    "hook_style",
    "technical_depth",
    "content_format",
    "cta_type",
  ];

  function debugEnabled() {
    try {
      return /(?:^|[?&])analytics_debug=1(?:&|$)/.test(window.location.search);
    } catch (e) {
      return false;
    }
  }

  function track(eventName, properties) {
    var props = properties || {};
    try {
      if (debugEnabled()) {
        console.info("[palmo-analytics]", eventName, props);
      }
      if (window.posthog && typeof window.posthog.capture === "function") {
        window.posthog.capture(eventName, props);
      }
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  function readMeta(el) {
    var meta = {};
    if (!el) return meta;
    for (var i = 0; i < META_KEYS.length; i++) {
      var key = META_KEYS[i];
      var attr = "data-" + key.replace(/_/g, "-");
      var val = el.getAttribute(attr);
      if (val != null && val !== "") meta[key] = val;
    }
    return meta;
  }

  function merge(a, b) {
    var out = {};
    var k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  function onceFlags() {
    return Object.create(null);
  }

  function setupArticle(article) {
    var meta = readMeta(article);
    var fired = onceFlags();
    var start = Date.now();
    var engagedMs = 0;
    var lastVisible = document.visibilityState === "visible" ? Date.now() : null;
    var readSent = false;

    track("article_view", meta);

    function markReturnVisit() {
      try {
        var prev = localStorage.getItem(RETURN_KEY);
        if (prev) {
          track("return_visit", merge(meta, { previous_visit_at: prev }));
        }
        localStorage.setItem(RETURN_KEY, new Date().toISOString());
      } catch (e) {
        /* private mode / blocked storage */
      }
    }
    markReturnVisit();

    function scrollPct() {
      var doc = document.documentElement;
      var body = document.body;
      var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
      var height = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        doc.clientHeight,
        doc.scrollHeight,
        doc.offsetHeight
      );
      var win = window.innerHeight || doc.clientHeight;
      var trackable = Math.max(height - win, 1);
      return Math.min(100, Math.round((scrollTop / trackable) * 100));
    }

    function onScroll() {
      var pct = scrollPct();
      var thresholds = [25, 50, 75, 100];
      for (var i = 0; i < thresholds.length; i++) {
        var t = thresholds[i];
        var name = "article_scroll_" + t;
        if (pct >= t && !fired[name]) {
          fired[name] = true;
          track(name, merge(meta, { scroll_percent: t }));
        }
      }
    }

    function accumulateEngagement() {
      if (lastVisible != null) {
        engagedMs += Date.now() - lastVisible;
        lastVisible = Date.now();
      }
    }

    function sendReadTime() {
      if (readSent) return;
      accumulateEngagement();
      if (document.visibilityState === "visible" && lastVisible != null) {
        engagedMs += Date.now() - lastVisible;
        lastVisible = null;
      }
      var seconds = Math.max(0, Math.round(engagedMs / 1000));
      if (seconds < 1 && Date.now() - start < 1000) return;
      readSent = true;
      track(
        "article_read_time",
        merge(meta, {
          read_time_seconds: seconds,
          wall_time_seconds: Math.round((Date.now() - start) / 1000),
        })
      );
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        accumulateEngagement();
        lastVisible = null;
        sendReadTime();
      } else {
        lastVisible = Date.now();
      }
    });
    window.addEventListener("pagehide", sendReadTime);

    return meta;
  }

  function setupCtas(meta) {
    var nodes = document.querySelectorAll("[data-analytics-cta]");
    if (!nodes.length) return;

    var viewed = onceFlags();

    function ctaProps(el) {
      return merge(meta, {
        cta_id: el.getAttribute("data-analytics-cta") || "",
        cta_type:
          el.getAttribute("data-cta-type") || meta.cta_type || "",
      });
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            var id = el.getAttribute("data-analytics-cta") || el;
            if (viewed[id]) return;
            viewed[id] = true;
            track("cta_view", ctaProps(el));
            io.unobserve(el);
          });
        },
        { threshold: 0.5 }
      );
      nodes.forEach(function (el) {
        io.observe(el);
      });
    }

    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-analytics-cta]");
      if (!el) return;
      track("cta_click", ctaProps(el));
    });
  }

  function setupContact(meta) {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-analytics-contact]");
      if (!el) return;
      track(
        "contact_click",
        merge(meta, {
          contact_target: el.getAttribute("href") || el.getAttribute("data-analytics-contact") || "",
        })
      );
    });
  }

  function isOutbound(anchor) {
    if (!anchor || !anchor.href) return false;
    if (anchor.hasAttribute("download")) return false;
    var host = window.location.host;
    try {
      var url = new URL(anchor.href, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      return url.host !== host;
    } catch (e) {
      return false;
    }
  }

  function setupOutbound(meta) {
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a || !isOutbound(a)) return;
      if (a.hasAttribute("data-analytics-cta")) return;
      if (a.hasAttribute("data-analytics-share")) return;
      if (a.hasAttribute("data-analytics-contact")) return;
      track(
        "outbound_link_click",
        merge(meta, {
          href: a.href,
          link_text: (a.textContent || "").trim().slice(0, 120),
        })
      );
    });
  }

  function setupCodeCopy(meta) {
    document.addEventListener("copy", function () {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var node = sel.anchorNode;
      var el = node && node.nodeType === 3 ? node.parentElement : node;
      if (!el || !el.closest) return;
      var code = el.closest("pre, code");
      if (!code) return;
      track("code_copy", meta);
    });
  }

  function setupShare(meta) {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-analytics-share]");
      if (!el) return;
      track(
        "share_click",
        merge(meta, {
          share_channel: el.getAttribute("data-analytics-share") || "",
          href: el.getAttribute("href") || "",
        })
      );
    });
  }

  function init() {
    var article = document.querySelector("[data-analytics-article]");
    var meta = article ? setupArticle(article) : {};
    setupCtas(meta);
    setupContact(meta);
    setupOutbound(meta);
    setupCodeCopy(meta);
    setupShare(meta);
  }

  window.__palmoAnalytics = {
    track: function (eventName, properties) {
      var article = document.querySelector("[data-analytics-article]");
      track(eventName, merge(readMeta(article), properties || {}));
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
