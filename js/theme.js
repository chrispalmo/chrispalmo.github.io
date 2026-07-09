'use strict';

(function iifeTheme(document, window) {
	var STORAGE_KEY = 'palmo-theme';
	var USER_AT_KEY = 'palmo-theme-user-at';
	var SYSTEM_AT_KEY = 'palmo-theme-system-at';
	/* Locked: easings.net easeOutExpo @ 800ms (CSS gate matches) */
	var THEME_MS = 800;
	var root = document.documentElement;
	var toggle = document.querySelector('[data-theme-toggle]');
	var ready = false;
	var gateTimer = null;

	function systemTheme() {
		try {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		} catch (err) {
			return 'dark';
		}
	}

	function readUserAt() {
		try {
			return parseInt(window.localStorage.getItem(USER_AT_KEY), 10) || 0;
		} catch (err) {
			return 0;
		}
	}

	function readSystemAt() {
		try {
			return parseInt(window.localStorage.getItem(SYSTEM_AT_KEY), 10) || 0;
		} catch (err) {
			return 0;
		}
	}

	function readStoredTheme() {
		try {
			var stored = window.localStorage.getItem(STORAGE_KEY);
			return stored === 'light' || stored === 'dark' ? stored : null;
		} catch (err) {
			return null;
		}
	}

	/* System by default; user wins only if their pick is newer than last system change; else dark. */
	function resolveTheme() {
		var system = systemTheme();
		var stored = readStoredTheme();
		var userAt = readUserAt();
		var systemAt = readSystemAt();
		if (stored && userAt > systemAt) {
			return stored;
		}
		if (system === 'light' || system === 'dark') {
			return system;
		}
		return 'dark';
	}

	function persistUserTheme(theme) {
		try {
			window.localStorage.setItem(STORAGE_KEY, theme);
			window.localStorage.setItem(USER_AT_KEY, String(Date.now()));
		} catch (err) {
			/* ignore */
		}
	}

	function persistSystemAt() {
		try {
			window.localStorage.setItem(SYSTEM_AT_KEY, String(Date.now()));
		} catch (err) {
			/* ignore */
		}
	}

	function currentTheme() {
		var attr = root.getAttribute('data-theme');
		if (attr === 'light' || attr === 'dark') {
			return attr;
		}
		return resolveTheme();
	}

	function clearThemeGate() {
		root.classList.remove('is-theme-switching');
		gateTimer = null;
	}

	function openThemeGate() {
		if (!ready) {
			return;
		}
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			return;
		}
		root.classList.add('is-theme-switching');
		if (gateTimer) {
			window.clearTimeout(gateTimer);
		}
		gateTimer = window.setTimeout(clearThemeGate, THEME_MS + 40);
	}

	function applyTheme(theme, persistUser) {
		openThemeGate();
		root.setAttribute('data-theme', theme);
		if (persistUser) {
			persistUserTheme(theme);
		}
		syncToggle(theme);
	}

	function syncToggle(theme) {
		if (!toggle) {
			return;
		}
		var isDark = theme === 'dark';
		toggle.classList.toggle('theme-toggle--toggled', isDark);
		toggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
		toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
		toggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
	}

	function toggleTheme() {
		applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
	}

	function endBoot() {
		root.classList.remove('theme-booting');
		ready = true;
	}

	root.style.setProperty('--theme-toggle__classic--duration', THEME_MS + 'ms');

	applyTheme(resolveTheme(), false);
	window.requestAnimationFrame(function () {
		window.requestAnimationFrame(endBoot);
	});

	if (toggle) {
		toggle.addEventListener('click', toggleTheme, false);
	}

	try {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function onSchemeChange(event) {
			persistSystemAt();
			applyTheme(event.matches ? 'dark' : 'light', false);
		});
	} catch (err) {
		/* older browsers */
	}
}(document, window));
