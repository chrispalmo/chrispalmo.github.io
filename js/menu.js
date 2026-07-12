'use strict';

(function iifeMenu(document, window, undefined) {
	var menuBtn = document.querySelector('.menu__btn');
	var menuToggles = document.querySelectorAll('[data-menu-toggle]');
	var menu = document.querySelector('[data-menu-list]') || document.querySelector('.menu__list');
	var backdrop = document.querySelector('[data-menu-backdrop]');

	function setBackdrop(expanded) {
		if (!backdrop) return;
		if (expanded) {
			backdrop.hidden = false;
			backdrop.removeAttribute('hidden');
		} else {
			backdrop.hidden = true;
			backdrop.setAttribute('hidden', '');
		}
	}

	function setExpanded(expanded, immediate) {
		if (!menuBtn || !menu) return;
		menu.classList.toggle('menu__list--active', expanded);
		if (immediate) {
			menu.classList.remove('menu__list--transition');
		} else {
			menu.classList.add('menu__list--transition');
		}
		menuBtn.classList.toggle('menu__btn--active', expanded);
		menuBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
		menuBtn.setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
		setBackdrop(expanded);
	}

	function toggleMenu() {
		var open = menuBtn.getAttribute('aria-expanded') === 'true';
		setExpanded(!open, false);
	}

	function removeMenuTransition() {
		this.classList.remove('menu__list--transition');
	}

	if (menuBtn && menu) {
		menuToggles.forEach(function (toggle) {
			toggle.addEventListener('click', toggleMenu, false);
		});
		menu.addEventListener('transitionend', removeMenuTransition, false);
	}

	if (backdrop) {
		backdrop.addEventListener('click', function () {
			if (typeof window.__palmoCloseMenuSearch === 'function') {
				window.__palmoCloseMenuSearch();
				return;
			}
			setExpanded(false, false);
		}, false);
	}

	window.__palmoMenu = {
		open: function () { setExpanded(true, false); },
		close: function (immediate) { setExpanded(false, immediate === true); },
		isOpen: function () {
			return !!(menuBtn && menuBtn.getAttribute('aria-expanded') === 'true');
		},
	};
}(document, window));
