"use strict";

/**
 * Development-only search ranking design tool.
 * Serve-only; also gated to localhost.
 */
(function initializeSearchAlgorithmTool(window, document) {
  if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) return;

  const root = document.querySelector("[data-search-algorithm-tool]");
  const core = window.PalmoSearchCore;
  const designsApi = window.PalmoSearchRankingDesigns;
  if (!root || !core || !designsApi) return;

  const STORAGE_KEY = "palmo:design-tool:search-algorithm:v2";
  const baseline = core.DEFAULT_RANKING;
  const DESIGNS = designsApi.buildDesigns(baseline);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const FIXTURES = [
    "about",
    "Consultant",
    "contact",
    "react",
    "raect",
    "rct",
    "selenuim",
    "typr",
    "typing",
    "hoc",
    "clipchamp",
    "bookmarklet",
    "human readable",
    "github pages",
    "sql csv",
    "chris",
    "wpm",
    "powershell",
    "useContext",
  ];

  const SCALAR_CONTROLS = [
    { key: "resultLimit", label: "Result limit", min: 3, max: 20, step: 1 },
    { key: "fuzzyLenMid", label: "Fuzzy mid length ≥", min: 2, max: 10, step: 1 },
    { key: "fuzzyLenHigh", label: "Fuzzy high length ≥", min: 4, max: 14, step: 1 },
    { key: "fuzzyEditsMid", label: "Fuzzy mid edits", min: 0, max: 2, step: 1 },
    { key: "fuzzyEditsHigh", label: "Fuzzy high edits", min: 0, max: 3, step: 1 },
    { key: "titleExact", label: "Title exact bonus", min: 0, max: 2000, step: 20 },
    { key: "titlePrefix", label: "Title prefix bonus", min: 0, max: 1200, step: 10 },
    { key: "titleIncludes", label: "Title includes bonus", min: 0, max: 800, step: 10 },
    { key: "titleSubsequence", label: "Title subsequence bonus", min: 0, max: 800, step: 10 },
    { key: "headingsIncludes", label: "Headings includes", min: 0, max: 500, step: 10 },
    { key: "descriptionIncludes", label: "Description includes", min: 0, max: 400, step: 10 },
    { key: "contentIncludes", label: "Content includes", min: 0, max: 300, step: 10 },
    { key: "tokenSubsequenceFallback", label: "Token subsequence fallback", min: 0, max: 300, step: 5 },
    { key: "subsequenceMinLength", label: "Subsequence min length", min: 1, max: 10, step: 1 },
    { key: "subsequenceMaxSpanFactor", label: "Subsequence span factor", min: 1, max: 8, step: 0.5 },
    { key: "shortTitleExactFactor", label: "Short-title exact factor", min: 0, max: 1.5, step: 0.05 },
  ];

  const TYPE_CONTROLS = [
    { key: "article", label: "type: article", min: -150, max: 150, step: 5 },
    { key: "page", label: "type: page", min: -150, max: 150, step: 5 },
    { key: "tag", label: "type: tag", min: -150, max: 150, step: 5 },
    { key: "category", label: "type: category", min: -150, max: 150, step: 5 },
    { key: "home", label: "type: home", min: -150, max: 150, step: 5 },
    { key: "listing", label: "type: listing", min: -150, max: 150, step: 5 },
  ];

  const FIELD_PARTS = [
    { key: "exact", label: "exact", max: 300 },
    { key: "prefix", label: "prefix", max: 250 },
    { key: "fuzzy", label: "fuzzy", max: 200 },
    { key: "penalty", label: "penalty", max: 50 },
  ];

  let designIndex = 0;
  let config = clone(DESIGNS[0].config);
  let dragging = null;

  const handle = root.querySelector("[data-sat-handle]");
  const select = root.querySelector("[data-sat-select]");
  const prevBtn = root.querySelector("[data-sat-prev]");
  const nextBtn = root.querySelector("[data-sat-next]");
  const blurb = root.querySelector("[data-sat-blurb]");
  const controls = root.querySelector("[data-sat-controls]");
  const fixtures = root.querySelector("[data-sat-fixtures]");
  const copyBtn = root.querySelector("[data-sat-copy]");
  const resetBtn = root.querySelector("[data-sat-reset]");
  const collapseBtn = root.querySelector("[data-sat-collapse]");

  DESIGNS.forEach((design) => {
    const option = document.createElement("option");
    option.value = String(design.id);
    option.textContent = `Design ${design.id}: ${design.name}`;
    select.append(option);
  });

  FIXTURES.forEach((query) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sat__chip";
    button.textContent = query;
    button.addEventListener("click", () => {
      const dialogInput = document.querySelector("[data-search-input]");
      const menuInput = document.querySelector("[data-search-input-menu]");
      const narrow = window.matchMedia("(max-width: 766px)").matches;
      if (narrow && menuInput) {
        if (window.__palmoMenu && !window.__palmoMenu.isOpen()) window.__palmoMenu.open();
        menuInput.value = query;
        menuInput.dispatchEvent(new Event("input", { bubbles: true }));
        menuInput.focus();
      } else if (dialogInput) {
        const openBtn = document.querySelector(".site-search__trigger--sidebar");
        if (openBtn && document.querySelector("[data-search-backdrop]")?.hidden) {
          openBtn.click();
        }
        dialogInput.value = query;
        dialogInput.dispatchEvent(new Event("input", { bubbles: true }));
        dialogInput.focus();
      }
      applyAndRerun();
    });
    fixtures.append(button);
  });

  function renderControls() {
    controls.replaceChildren();

    const scalarGroup = document.createElement("div");
    scalarGroup.className = "sat__group";
    scalarGroup.innerHTML = '<h3 class="sat__group-title">Global bonuses</h3>';
    SCALAR_CONTROLS.forEach((control) => {
      scalarGroup.append(makeSlider(control.key, control.label, config[control.key], control));
    });
    controls.append(scalarGroup);

    const typeGroup = document.createElement("div");
    typeGroup.className = "sat__group";
    typeGroup.innerHTML = '<h3 class="sat__group-title">Type boosts</h3>';
    TYPE_CONTROLS.forEach((control) => {
      typeGroup.append(
        makeSlider(`typeBoosts.${control.key}`, control.label, config.typeBoosts[control.key], control)
      );
    });
    controls.append(typeGroup);

    Object.keys(config.fields).forEach((field) => {
      const group = document.createElement("div");
      group.className = "sat__group";
      group.innerHTML = `<h3 class="sat__group-title">Field: ${field}</h3>`;
      FIELD_PARTS.forEach((part) => {
        group.append(
          makeSlider(
            `fields.${field}.${part.key}`,
            part.label,
            config.fields[field][part.key],
            { min: 0, max: part.max, step: 1 }
          )
        );
      });
      controls.append(group);
    });
  }

  function makeSlider(path, label, value, meta) {
    const row = document.createElement("label");
    row.className = "sat__row";
    const name = document.createElement("span");
    name.className = "sat__label";
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.step = String(meta.step || 1);
    input.value = String(value);
    input.dataset.path = path;
    const readouts = document.createElement("span");
    readouts.className = "sat__value";
    readouts.textContent = String(value);
    input.addEventListener("input", () => {
      const next = Number(input.value);
      readouts.textContent = String(next);
      setPath(path, next);
      markCustom();
      applyAndRerun();
    });
    row.append(name, input, readouts);
    return row;
  }

  function setPath(path, value) {
    const parts = path.split(".");
    if (parts.length === 1) {
      config[parts[0]] = value;
      return;
    }
    if (parts[0] === "typeBoosts") {
      config.typeBoosts[parts[1]] = value;
      return;
    }
    config.fields[parts[1]][parts[2]] = value;
  }

  function markCustom() {
    root.dataset.customized = "true";
  }

  function applyAndRerun() {
    core.setRankingConfig(config);
    if (window.__palmoSearch && typeof window.__palmoSearch.rerun === "function") {
      window.__palmoSearch.rerun();
    }
    persist();
  }

  function setDesign(index, { resetCustom = true } = {}) {
    designIndex = (index + DESIGNS.length) % DESIGNS.length;
    const design = DESIGNS[designIndex];
    config = clone(design.config);
    select.value = String(design.id);
    blurb.textContent = design.blurb;
    if (resetCustom) delete root.dataset.customized;
    renderControls();
    applyAndRerun();
  }

  function clampPanelPosition() {
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - Math.min(rect.width, 120));
    const maxTop = Math.max(8, window.innerHeight - 48);
    const left = parseFloat(root.style.left);
    const top = parseFloat(root.style.top);
    if (!Number.isFinite(left) || left < 0 || left > maxLeft) {
      root.style.left = "1rem";
      root.style.right = "auto";
    }
    if (!Number.isFinite(top) || top < 0 || top > maxTop) {
      root.style.top = "1rem";
    }
  }

  function persist() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          designId: DESIGNS[designIndex].id,
          config,
          left: root.style.left || "",
          top: root.style.top || "",
          collapsed: root.classList.contains("sat--collapsed"),
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      const index = DESIGNS.findIndex((design) => design.id === saved.designId);
      if (index >= 0) designIndex = index;
      if (saved.config) {
        core.setRankingConfig(saved.config);
        config = core.getRankingConfig();
      }
      if (saved.left) root.style.left = saved.left;
      if (saved.top) root.style.top = saved.top;
      if (saved.collapsed) root.classList.add("sat--collapsed");
      clampPanelPosition();
      select.value = String(DESIGNS[designIndex].id);
      blurb.textContent = DESIGNS[designIndex].blurb;
      renderControls();
      applyAndRerun();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function copyPayload() {
    const payload = {
      tool: "search-algorithm",
      designId: DESIGNS[designIndex].id,
      designName: DESIGNS[designIndex].name,
      customized: root.dataset.customized === "true",
      ranking: config,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy for agent";
      }, 1200);
    } catch (_) {
      window.prompt("Copy ranking JSON", text);
    }
  }

  select.addEventListener("change", () => {
    const index = DESIGNS.findIndex((design) => String(design.id) === select.value);
    if (index >= 0) setDesign(index);
  });
  prevBtn.addEventListener("click", () => setDesign(designIndex - 1));
  nextBtn.addEventListener("click", () => setDesign(designIndex + 1));
  copyBtn.addEventListener("click", copyPayload);
  resetBtn.addEventListener("click", () => {
    core.resetRankingConfig();
    setDesign(designIndex);
  });
  collapseBtn.addEventListener("click", () => {
    root.classList.toggle("sat--collapsed");
    persist();
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = {
      offsetX: event.clientX - root.getBoundingClientRect().left,
      offsetY: event.clientY - root.getBoundingClientRect().top,
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    root.style.left = `${Math.max(8, event.clientX - dragging.offsetX)}px`;
    root.style.top = `${Math.max(8, event.clientY - dragging.offsetY)}px`;
    root.style.right = "auto";
  });
  handle.addEventListener("pointerup", () => {
    dragging = null;
    clampPanelPosition();
    persist();
  });
  window.addEventListener("resize", clampPanelPosition);

  if (!restore()) setDesign(0);
  else clampPanelPosition();
  root.hidden = false;
  root.style.visibility = "visible";
  // Recover from stale off-screen session positions once layout settles.
  window.requestAnimationFrame(clampPanelPosition);
})(window, document);
