/**
 * FlowGuard Motion Primitives
 * Spring physics × Scroll-triggered reveals × Reduced-motion safe
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Intersection Observer factory ────────────────────────────────
export function createRevealObserver(opts = {}) {
  const { threshold = 0.15, rootMargin = '0px 0px -60px 0px', once = true } = opts;
  return new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        if (once) obs.unobserve(entry.target);
      }
    });
  }, { threshold, rootMargin });
}

/**
 * Attach scroll-reveal to all elements matching selector.
 */
export function revealOnScroll(selector, opts = {}) {
  const obs = createRevealObserver(opts);
  document.querySelectorAll(selector).forEach(el => obs.observe(el));
  return obs;
}

/**
 * FadeUp — translates from below + fades in.
 */
export function FadeUp(el, delayMs = 0) {
  if (!el) return;
  if (prefersReducedMotion) { el.style.opacity = '1'; return; }
  el.style.opacity = '0';
  el.style.transform = 'translateY(28px)';
  el.style.transition = `opacity 700ms cubic-bezier(0.22,1,0.36,1) ${delayMs}ms,
                          transform 700ms cubic-bezier(0.22,1,0.36,1) ${delayMs}ms`;
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
}

/**
 * MaskReveal — clip-path slide-in from bottom.
 */
export function MaskReveal(el, delayMs = 0) {
  if (!el || prefersReducedMotion) { if (el) el.style.opacity = '1'; return; }
  el.style.clipPath = 'inset(100% 0 0 0)';
  el.style.transition = `clip-path 800ms cubic-bezier(0.22,1,0.36,1) ${delayMs}ms`;
  requestAnimationFrame(() => {
    el.style.clipPath = 'inset(0% 0 0 0)';
  });
}

/**
 * StaggerGroup — animate children with stagger delay.
 */
export function StaggerGroup(parent, baseDelay = 0, gapMs = 80) {
  if (!parent) return;
  [...parent.children].forEach((child, i) => FadeUp(child, baseDelay + i * gapMs));
}

/**
 * ScaleIn — scale from 0.94 + fade.
 */
export function ScaleIn(el, delayMs = 0) {
  if (!el || prefersReducedMotion) { if (el) el.style.opacity = '1'; return; }
  el.style.opacity = '0';
  el.style.transform = 'scale(0.94)';
  el.style.transition = `opacity 500ms cubic-bezier(0.22,1,0.36,1) ${delayMs}ms,
                          transform 500ms cubic-bezier(0.34,1.56,0.64,1) ${delayMs}ms`;
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  });
}

/**
 * Page transition — dark overlay in/out.
 */
export function navigateTo(url, delayMs = 320) {
  if (prefersReducedMotion) { window.location.href = url; return; }
  let overlay = document.getElementById('page-transition');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'page-transition';
    document.body.appendChild(overlay);
  }
  overlay.style.cssText = `
    position:fixed;inset:0;background:#0A0A0B;z-index:9999;
    opacity:0;pointer-events:none;
    transition:opacity ${delayMs}ms cubic-bezier(0.4,0,0.2,1);
  `;
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'all';
    setTimeout(() => { window.location.href = url; }, delayMs + 40);
  });
}

/**
 * Intercept all internal <a> tags for smooth page transitions.
 */
export function initPageTransitions() {
  if (prefersReducedMotion) return;
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return;
    if (a.target === '_blank') return;
    e.preventDefault();
    navigateTo(href);
  });
}
