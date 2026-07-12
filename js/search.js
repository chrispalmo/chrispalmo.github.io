"use strict";

(function initializeSiteSearch(document, window) {
  const root = document.querySelector("[data-site-search]");
  const core = window.PalmoSearchCore;
  if (!root || !core) return;

  const openButtons = [...document.querySelectorAll("[data-search-open]")];
  const backdrop = root.querySelector("[data-search-backdrop]");
  const dialog = root.querySelector(".site-search__dialog");
  const closeButton = root.querySelector("[data-search-close]");
  const dialogInput = root.querySelector("[data-search-input]");
  const dialogStatus = root.querySelector("[data-search-status]");
  const dialogResults = root.querySelector("[data-search-results]");
  const dialogClear = root.querySelector("[data-search-clear]");
  const menuInput = document.querySelector("[data-search-input-menu]");
  const menuStatus = document.querySelector("[data-search-status-menu]");
  const menuResults = document.querySelector("[data-search-results-menu]");
  const menuClear = document.querySelector("[data-search-clear-menu]");
  const narrowQuery = window.matchMedia("(max-width: 766px)");

  let documents = null;
  let loadPromise = null;
  let activeResult = -1;
  let returnFocus = null;
  let lastQuery = "";
  let activeSurface = "dialog";
  let focusToken = 0;
  let suppressMenuFocusOpen = false;
  let escapeDismissArmed = false;
  // Empty unload listener opts the page out of bfcache while search is open,
  // so Back after following a result is a clean load (no open-sheet flicker).
  let bfcacheBlocker = null;

  if (!backdrop || !dialog || !closeButton || !dialogInput || !dialogStatus || !dialogResults) return;

  function usesMenuDropdown() {
    return (
      document.documentElement.dataset.searchMobile === "menu-dropdown" &&
      narrowQuery.matches
    );
  }

  function searchIsOpen() {
    return (
      !backdrop.hidden ||
      document.documentElement.classList.contains("has-search-open") ||
      (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen())
    );
  }

  function shouldDismissOnEscape() {
    return (
      searchIsOpen() ||
      document.activeElement === dialogInput ||
      document.activeElement === menuInput
    );
  }

  function setResultsNavMode(mode) {
    if (dialogResults) dialogResults.dataset.searchNav = mode;
    if (menuResults) menuResults.dataset.searchNav = mode;
  }

  function blockBfcacheWhileSearchOpen() {
    if (bfcacheBlocker) return;
    bfcacheBlocker = function palmoSearchBfcacheBlocker() {};
    window.addEventListener("unload", bfcacheBlocker);
  }

  function allowBfcacheAfterSearchClose() {
    if (!bfcacheBlocker) return;
    window.removeEventListener("unload", bfcacheBlocker);
    bfcacheBlocker = null;
  }

  function surface() {
    if (activeSurface === "menu" && menuInput && menuStatus && menuResults) {
      return {
        kind: "menu",
        input: menuInput,
        status: menuStatus,
        results: menuResults,
        linkClass: "menu__search-result-link",
        activeClass: "menu__search-result-link--active",
        itemClass: "menu__search-result",
        topClass: "menu__search-result-top",
        titleClass: "menu__search-result-title",
        typeClass: "menu__search-result-type",
        snippetClass: "menu__search-result-snippet",
        idPrefix: "site-search-menu-result",
      };
    }
    return {
      kind: "dialog",
      input: dialogInput,
      status: dialogStatus,
      results: dialogResults,
      linkClass: "site-search__result-link",
      activeClass: "site-search__result-link--active",
      itemClass: "site-search__result",
      topClass: "site-search__result-top",
      titleClass: "site-search__result-title",
      typeClass: "site-search__result-type",
      snippetClass: "site-search__result-snippet",
      idPrefix: "site-search-result",
    };
  }

  function setStatus(message) {
    const current = surface();
    current.status.textContent = message || "";
    current.status.hidden = !message;
  }

  function loadIndex() {
    if (documents) return Promise.resolve(documents);
    if (loadPromise) return loadPromise;
    const searchOpen = !backdrop.hidden || (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen());
    if (searchOpen) setStatus("Loading search index…");
    loadPromise = fetch("/search-index.json", {
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        documents = (payload.documents || []).map(core.prepareDocument);
        if (!backdrop.hidden || (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen())) {
          // Leave whatever status runQuery will set next; clear the loading line if idle.
          if (!dialogInput.value.trim() && !(menuInput && menuInput.value.trim())) setStatus("");
        } else {
          setStatus("");
        }
        return documents;
      })
      .catch((error) => {
        loadPromise = null;
        console.error("[palmo-search]", error);
        if (!backdrop.hidden || (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen())) {
          setStatus("Search is temporarily unavailable. Normal site navigation still works.");
        }
        throw error;
      });
    return loadPromise;
  }

  function clearResults() {
    const current = surface();
    current.results.replaceChildren();
    activeResult = -1;
    current.input.removeAttribute("aria-activedescendant");
    if (current.kind === "menu") {
      current.results.hidden = true;
    }
  }

  function resultTypeLabel(type) {
    return {
      article: "Article",
      category: "Category",
      home: "Home",
      listing: "Archive",
      page: "Page",
      tag: "Tag",
    }[type] || "Page";
  }

  function createResult(result, index) {
    const current = surface();
    const item = document.createElement("li");
    item.className = current.itemClass;
    item.setAttribute("role", "option");
    item.id = `${current.idPrefix}-${index}`;
    const link = document.createElement("a");
    link.className = current.linkClass;
    link.href = result.document.url;
    link.dataset.searchResult = "";

    const top = document.createElement("span");
    top.className = current.topClass;
    const title = document.createElement("span");
    title.className = current.titleClass;
    title.innerHTML = core.highlightMatches(result.document.title, lastQuery);
    const type = document.createElement("span");
    type.className = current.typeClass;
    type.textContent = resultTypeLabel(result.document.type);
    top.append(title, type);

    const snippet = document.createElement("span");
    snippet.className = current.snippetClass;
    snippet.innerHTML = core.highlightMatches(result.snippet, lastQuery);
    link.append(top, snippet);
    item.append(link);
    return item;
  }

  function clearActiveResult() {
    const current = surface();
    activeResult = -1;
    current.input.removeAttribute("aria-activedescendant");
    current.results.querySelectorAll("[data-search-result]").forEach((link) => {
      link.classList.remove(current.activeClass);
      if (link.parentElement) link.parentElement.setAttribute("aria-selected", "false");
    });
  }

  function updateActiveResult(nextIndex) {
    const current = surface();
    const links = [...current.results.querySelectorAll("[data-search-result]")];
    if (!links.length) return;
    // Keyboard nav suppresses CSS :hover highlights until the pointer moves again.
    setResultsNavMode("keyboard");
    activeResult = (nextIndex + links.length) % links.length;
    links.forEach((link, index) => {
      link.classList.toggle(current.activeClass, index === activeResult);
      link.parentElement.setAttribute("aria-selected", String(index === activeResult));
    });
    const active = links[activeResult];
    current.input.setAttribute("aria-activedescendant", active.parentElement.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function syncMenuSearchChrome() {
    const hasQuery = !!(menuInput && menuInput.value.length > 0);
    const menuOpen = !!(window.__palmoMenu && window.__palmoMenu.isOpen());
    const active = usesMenuDropdown() && menuOpen && hasQuery;
    document.documentElement.classList.toggle("has-menu-search-query", active);
    if (usesMenuDropdown()) measureToolbarBand();
  }

  function measureToolbarBand() {
    const toolbar = document.querySelector(".menu__toolbar");
    const toolbarBand = toolbar ? Math.ceil(toolbar.getBoundingClientRect().height) : 44;
    document.documentElement.style.setProperty("--sd-toolbar-band", `${toolbarBand}px`);
    document.documentElement.style.setProperty("--sd-logo-band", "0px");
  }

  function setupStickyToolbar() {
    // Brand lives in the grey toolbar on narrow menu-dropdown, so the whole
    // header can stick without a separate logo band / IntersectionObserver.
    narrowQuery.addEventListener("change", () => {
      migrateSearchForViewport();
    });
    window.addEventListener("resize", () => {
      if (usesMenuDropdown()) measureToolbarBand();
    });
    if (usesMenuDropdown()) measureToolbarBand();
  }

  function searchSessionIsOpen() {
    return (
      !backdrop.hidden ||
      document.documentElement.classList.contains("has-search-open") ||
      document.documentElement.classList.contains("has-menu-search-query")
    );
  }

  // Keep an open search session alive across the 766px breakpoint by moving
  // query + results between the wide dialog and narrow menu surfaces.
  function migrateSearchForViewport() {
    if (!searchSessionIsOpen()) {
      if (narrowQuery.matches && usesMenuDropdown()) measureToolbarBand();
      return;
    }

    const query =
      (activeSurface === "menu" && menuInput ? menuInput.value : dialogInput.value) ||
      (menuInput && menuInput.value) ||
      dialogInput.value ||
      lastQuery ||
      "";

    if (usesMenuDropdown()) {
      backdrop.hidden = true;
      backdrop.setAttribute("hidden", "");
      dialogInput.setAttribute("aria-expanded", "false");
      dialogInput.value = "";
      dialogInput.removeAttribute("aria-activedescendant");
      dialogInput.blur();
      syncClearButton(dialogInput, dialogClear);
      dialogResults.replaceChildren();
      dialogStatus.textContent = "";
      dialogStatus.hidden = true;

      activeSurface = "menu";
      if (menuInput) menuInput.value = query;
      if (window.__palmoMenu) window.__palmoMenu.open(true);
      document.documentElement.classList.add("has-search-open");
      blockBfcacheWhileSearchOpen();
      syncClearButton(menuInput, menuClear);
      syncMenuSearchChrome();
      focusSearchInput(menuInput);
      runQuery();
      measureToolbarBand();
      return;
    }

    suppressMenuFocusOpen = true;
    if (window.__palmoMenu) window.__palmoMenu.close(true);
    document.documentElement.classList.remove("has-menu-search-query");
    if (menuInput) {
      menuInput.value = "";
      menuInput.removeAttribute("aria-activedescendant");
      menuInput.blur();
      syncClearButton(menuInput, menuClear);
    }
    if (menuResults) {
      menuResults.replaceChildren();
      menuResults.hidden = true;
    }

    activeSurface = "dialog";
    dialogInput.value = query;
    backdrop.hidden = false;
    backdrop.removeAttribute("hidden");
    document.documentElement.classList.add("has-search-open");
    blockBfcacheWhileSearchOpen();
    dialogInput.setAttribute("aria-expanded", "true");
    syncClearButton(dialogInput, dialogClear);
    focusSearchInput(dialogInput);
    runQuery();
    window.requestAnimationFrame(() => {
      suppressMenuFocusOpen = false;
    });
  }

  function syncClearButton(input, button) {
    if (!button) return;
    button.hidden = !(input && input.value.length > 0);
  }

  function runQuery() {
    const current = surface();
    const query = current.input.value.trim();
    lastQuery = query;
    if (current.kind === "menu") {
      syncMenuSearchChrome();
      syncClearButton(menuInput, menuClear);
    } else {
      syncClearButton(dialogInput, dialogClear);
    }
    clearResults();
    if (!query) {
      setStatus("");
      return;
    }
    if (!documents) {
      loadIndex().then(runQuery).catch(() => {});
      return;
    }

    const results = core.rankDocuments(documents, query);
    if (!results.length) {
      setStatus(`No results for “${query}”. Try fewer or different words.`);
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => fragment.append(createResult(result, index)));
    current.results.append(fragment);
    if (current.kind === "menu") current.results.hidden = false;
    setStatus(`${results.length} result${results.length === 1 ? "" : "s"} for “${query}”.`);
  }

  function focusSearchInput(input) {
    if (!input) return;
    const token = ++focusToken;
    const menuList = input.closest(".menu__list");
    // Ensure layout has applied open styles before focusing (visibility/opacity flips).
    if (menuList) void menuList.offsetHeight;
    input.focus({ preventScroll: true });
    // Re-assert after paint so open animations / layout don't steal focus.
    // Keep this inside the same turn's follow-ups; avoid setTimeout (iOS drops gesture).
    window.requestAnimationFrame(() => {
      if (token !== focusToken) return;
      if (document.activeElement !== input) input.focus({ preventScroll: true });
    });
  }

  function openDialog() {
    if (!backdrop.hidden) return;
    activeSurface = "dialog";
    returnFocus = document.activeElement;
    backdrop.hidden = false;
    document.documentElement.classList.add("has-search-open");
    blockBfcacheWhileSearchOpen();
    dialogInput.setAttribute("aria-expanded", "true");
    focusSearchInput(dialogInput);
    loadIndex().catch(() => {});
  }

  function closeDialog(options = {}) {
    const restoreFocus = options.restoreFocus !== false;
    const fullyClosed =
      backdrop.hidden && !document.documentElement.classList.contains("has-search-open");
    if (fullyClosed && !options.force) return;
    focusToken += 1;
    backdrop.hidden = true;
    backdrop.setAttribute("hidden", "");
    document.documentElement.classList.remove("has-search-open");
    dialogInput.setAttribute("aria-expanded", "false");
    dialogInput.value = "";
    dialogInput.removeAttribute("aria-activedescendant");
    syncClearButton(dialogInput, dialogClear);
    activeSurface = "dialog";
    clearResults();
    setStatus("");
    setResultsNavMode("pointer");
    allowBfcacheAfterSearchClose();
    if (restoreFocus && returnFocus && typeof returnFocus.focus === "function") {
      returnFocus.focus();
    } else {
      dialogInput.blur();
    }
  }

  function openMenuSearch() {
    activeSurface = "menu";
    suppressMenuFocusOpen = false;
    // Immediate open so the field is focusable in this user-gesture turn (iOS).
    if (window.__palmoMenu) window.__palmoMenu.open(true);
    document.documentElement.classList.add("has-search-open");
    blockBfcacheWhileSearchOpen();
    syncMenuSearchChrome();
    if (menuInput) {
      focusSearchInput(menuInput);
      loadIndex().then(() => runQuery()).catch(() => {});
    }
  }

  function closeMenuSearch() {
    focusToken += 1;
    suppressMenuFocusOpen = true;
    activeSurface = "menu";
    document.documentElement.classList.remove("has-search-open");
    document.documentElement.classList.remove("has-menu-search-query");
    if (window.__palmoMenu) window.__palmoMenu.close();
    if (menuInput) {
      menuInput.value = "";
      syncClearButton(menuInput, menuClear);
      menuInput.blur();
    }
    clearResults();
    setStatus("");
    activeSurface = "dialog";
    allowBfcacheAfterSearchClose();
    window.requestAnimationFrame(() => {
      suppressMenuFocusOpen = false;
    });
  }

  window.__palmoCloseMenuSearch = closeMenuSearch;

  function openSearch() {
    if (usesMenuDropdown()) {
      openMenuSearch();
      return;
    }
    openDialog();
  }

  function closeSearch() {
    if (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen()) {
      closeMenuSearch();
      return;
    }
    closeDialog();
  }

  // Silent reset for pageload / bfcache restore. Do not close on result click —
  // that races navigation. Clean the frozen page on pagehide instead (instant,
  // no menu transition) so Back restores an already-closed UI.
  function resetSearchUi(options = {}) {
    const fromBfcache = options.fromBfcache === true;
    focusToken += 1;
    suppressMenuFocusOpen = true;
    returnFocus = null;
    activeResult = -1;
    activeSurface = "dialog";
    lastQuery = "";
    escapeDismissArmed = false;

    backdrop.hidden = true;
    backdrop.setAttribute("hidden", "");
    document.documentElement.classList.remove("has-search-open");
    document.documentElement.classList.remove("has-menu-search-query");
    document.documentElement.classList.remove("palmo-bfcache-restore");

    dialogInput.setAttribute("aria-expanded", "false");
    dialogInput.value = "";
    dialogInput.removeAttribute("aria-activedescendant");
    dialogInput.blur();
    syncClearButton(dialogInput, dialogClear);
    dialogResults.replaceChildren();
    dialogStatus.textContent = "";
    dialogStatus.hidden = true;

    if (menuInput) {
      menuInput.value = "";
      menuInput.removeAttribute("aria-activedescendant");
      menuInput.blur();
      syncClearButton(menuInput, menuClear);
    }
    if (menuResults) {
      menuResults.replaceChildren();
      menuResults.hidden = true;
    }
    if (menuStatus) {
      menuStatus.textContent = "";
      menuStatus.hidden = true;
    }

    // Always force-close the menu with no transition so bfcache never stores
    // an open/animating narrow search sheet.
    if (window.__palmoMenu) window.__palmoMenu.close(true);
    const menuList = document.querySelector("[data-menu-list]") || document.querySelector(".menu__list");
    const menuBtn = document.querySelector(".menu__btn");
    if (menuList) menuList.classList.remove("menu__list--active", "menu__list--transition");
    if (menuBtn) {
      menuBtn.classList.remove("menu__btn--active");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.setAttribute("aria-label", "Open menu");
    }
    setResultsNavMode("pointer");
    // Force style flush so the bfcache snapshot stores the closed UI.
    if (menuList) void menuList.offsetHeight;

    // Never drop the unload blocker during pagehide — its presence is what
    // keeps this page out of bfcache when the user followed a search result.
    if (!options.leavingPage) {
      allowBfcacheAfterSearchClose();
    }

    if (fromBfcache) {
      // bfcache may restore focus into the search field after pageshow; keep
      // the focus→open path suppressed briefly so it cannot reopen the sheet.
      window.setTimeout(() => {
        suppressMenuFocusOpen = false;
      }, 400);
    } else {
      window.requestAnimationFrame(() => {
        suppressMenuFocusOpen = false;
      });
    }
  }

  function dismissSearchFromEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    escapeDismissArmed = true;
    // Blur before close so WebKit/Blink cannot apply "cancel edit / clear field"
    // to a focused input and leave an empty open dialog.
    if (document.activeElement === dialogInput || document.activeElement === menuInput) {
      document.activeElement.blur();
    }
    if (usesMenuDropdown() && window.__palmoMenu && window.__palmoMenu.isOpen()) {
      closeMenuSearch();
    } else {
      closeDialog({ restoreFocus: false, force: true });
    }
    window.requestAnimationFrame(() => {
      if (!backdrop.hidden || document.documentElement.classList.contains("has-search-open")) {
        closeDialog({ restoreFocus: false, force: true });
      }
      escapeDismissArmed = false;
    });
  }

  function isEscapeKey(event) {
    return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
  }

  function handleInputKeydown(event) {
    const current = surface();
    if (isEscapeKey(event)) {
      // Always dismiss on first Escape — never clear-then-close.
      dismissSearchFromEvent(event);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveResult(activeResult + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveResult(activeResult - 1);
    } else if (event.key === "Enter" && activeResult >= 0) {
      const active = current.results.querySelectorAll("[data-search-result]")[activeResult];
      if (active) {
        event.preventDefault();
        active.click();
      }
    }
  }

  function handleDialogTab(event) {
    if (event.key !== "Tab") return;
    const focusable = [
      closeButton,
      dialogInput,
      ...dialogResults.querySelectorAll("[data-search-result]"),
    ].filter((element) => {
      if (element.hidden) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  openButtons.forEach((button) => button.addEventListener("click", openSearch));
  closeButton.addEventListener("click", closeDialog);
  dialogInput.addEventListener("input", () => {
    activeSurface = "dialog";
    // UA may clear the field on Escape even after preventDefault; finish dismiss.
    if (escapeDismissArmed) {
      closeDialog({ restoreFocus: false, force: true });
      return;
    }
    runQuery();
  });
  if (dialogClear) {
    dialogClear.addEventListener("click", () => {
      dialogInput.value = "";
      activeSurface = "dialog";
      runQuery();
      focusSearchInput(dialogInput);
    });
  }
  dialogInput.addEventListener(
    "keydown",
    (event) => {
      activeSurface = "dialog";
      handleInputKeydown(event);
    },
    true
  );
  if (menuInput) {
    menuInput.addEventListener("input", () => {
      activeSurface = "menu";
      if (escapeDismissArmed) {
        closeMenuSearch();
        return;
      }
      runQuery();
    });
    menuInput.addEventListener(
      "keydown",
      (event) => {
        activeSurface = "menu";
        handleInputKeydown(event);
      },
      true
    );
    menuInput.addEventListener("focus", () => {
      if (suppressMenuFocusOpen) return;
      activeSurface = "menu";
      if (window.__palmoMenu && !window.__palmoMenu.isOpen()) window.__palmoMenu.open(true);
      syncMenuSearchChrome();
      loadIndex().catch(() => {});
    });
  }
  if (menuClear) {
    menuClear.addEventListener("click", () => {
      if (!menuInput) return;
      menuInput.value = "";
      activeSurface = "menu";
      runQuery();
      focusSearchInput(menuInput);
    });
  }

  function bindResultPointerClear(resultsEl) {
    if (!resultsEl) return;
    // Require real pointer movement. pointerover alone can fire from
    // scrollIntoView while arrowing, which would wipe keyboard selection.
    resultsEl.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      if (!(event.movementX || event.movementY)) return;
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest("[data-search-result]")) return;
      setResultsNavMode("pointer");
      if (activeResult >= 0) clearActiveResult();
    });
  }
  bindResultPointerClear(dialogResults);
  bindResultPointerClear(menuResults);
  setResultsNavMode("pointer");

  document.querySelectorAll("[data-menu-toggle]").forEach((menuToggle) => {
    menuToggle.addEventListener("click", () => {
      // menu.js is deferred before search.js, so it toggles first in this turn.
      if (!(window.__palmoMenu && window.__palmoMenu.isOpen())) {
        focusToken += 1;
        suppressMenuFocusOpen = true;
        if (menuInput) menuInput.value = "";
        activeSurface = "menu";
        clearResults();
        setStatus("");
        document.documentElement.classList.remove("has-search-open");
        document.documentElement.classList.remove("has-menu-search-query");
        activeSurface = "dialog";
        queueMicrotask(() => {
          suppressMenuFocusOpen = false;
        });
        return;
      }
      // Snap open without the legacy visibility/scaleY gate so focus works now.
      if (window.__palmoMenu) window.__palmoMenu.open(true);
      document.documentElement.classList.add("has-search-open");
      blockBfcacheWhileSearchOpen();
      syncMenuSearchChrome();
      if (menuInput && (usesMenuDropdown() || menuInput.offsetParent !== null)) {
        activeSurface = "menu";
        focusSearchInput(menuInput);
        loadIndex().catch(() => {});
      }
    });
  });

  function isApplePlatform() {
    const uaDataPlatform = window.navigator.userAgentData && window.navigator.userAgentData.platform;
    const platform = uaDataPlatform || window.navigator.platform || "";
    const ua = window.navigator.userAgent || "";
    return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X|iPhone|iPad|iPod/i.test(ua);
  }

  const applePlatform = isApplePlatform();
  const shortcutLabel = applePlatform ? "⌘K" : "Ctrl+K";
  document.querySelectorAll(".site-search__trigger .site-search__shortcut").forEach((node) => {
    node.textContent = shortcutLabel;
  });

  function isSearchShortcut(event) {
    if (event.key.toLowerCase() !== "k") return false;
    if (event.altKey || event.shiftKey) return false;
    // Mac: ⌘K only. PC: Ctrl+K only.
    if (applePlatform) return event.metaKey && !event.ctrlKey;
    return event.ctrlKey && !event.metaKey;
  }

  dialog.addEventListener("keydown", handleDialogTab);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeDialog();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (isSearchShortcut(event)) {
        event.preventDefault();
        openSearch();
        return;
      }
      if (isEscapeKey(event) && shouldDismissOnEscape()) {
        dismissSearchFromEvent(event);
        return;
      }
      if (!typing && event.key === "/" && backdrop.hidden) {
        event.preventDefault();
        openSearch();
      }
    },
    true
  );

  // Backup: some WebKit/Blink builds clear the field on Escape after keydown.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isEscapeKey(event) || !shouldDismissOnEscape()) return;
      dismissSearchFromEvent(event);
    },
    true
  );
  document.addEventListener(
    "keyup",
    (event) => {
      if (!isEscapeKey(event)) return;
      if (!shouldDismissOnEscape()) return;
      dismissSearchFromEvent(event);
    },
    true
  );

  setupStickyToolbar();
  resetSearchUi();

  // Keep departing pages out of bfcache while search is open (unload blocker),
  // and scrub any restored open-sheet state on pageshow/freeze/resume.
  window.addEventListener("pagehide", () => resetSearchUi({ leavingPage: true }), true);
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) document.documentElement.classList.add("palmo-bfcache-restore");
      resetSearchUi({ fromBfcache: event.persisted });
    },
    true
  );
  document.addEventListener("freeze", () => resetSearchUi({ leavingPage: true }));
  document.addEventListener("resume", () => {
    document.documentElement.classList.add("palmo-bfcache-restore");
    resetSearchUi({ fromBfcache: true });
  });

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => loadIndex().catch(() => {}), { timeout: 2500 });
  }
})(document, window);
