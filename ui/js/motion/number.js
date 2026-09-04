/**
 * FlowGuard Number Animation System
 * CountUp × NumberTransition × Indian number formatting
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Format a number in Indian currency style.
 * e.g. 2480000 → "₹24.8L"
 */
export function formatINR(value, opts = {}) {
  const { compact = true, symbol = '₹', decimals = 1 } = opts;
  if (!compact) {
    return symbol + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}${symbol}${(abs / 10000000).toFixed(decimals)}Cr`;
  if (abs >= 100000)   return `${sign}${symbol}${(abs / 100000).toFixed(decimals)}L`;
  if (abs >= 1000)     return `${sign}${symbol}${(abs / 1000).toFixed(decimals)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

/**
 * Ease out cubic.
 */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

/**
 * CountUp — animates a number from 0 to target.
 * @param {HTMLElement} el
 * @param {number} target
 * @param {object} opts
 */
export function CountUp(el, target, opts = {}) {
  if (!el) return;
  const { duration = 1200, format = formatINR, delay = 0, from = 0 } = opts;

  if (prefersReducedMotion) {
    el.textContent = format(target);
    return;
  }

  setTimeout(() => {
    const start   = performance.now();
    const diff    = target - from;
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased  = easeOutCubic(progress);
      el.textContent = format(from + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = format(target);
    }
    requestAnimationFrame(tick);
  }, delay);
}

/**
 * NumberTransition — smoothly transitions between two values.
 * Shows brief fade when value changes.
 */
export class NumberTransition {
  constructor(el, initialValue, opts = {}) {
    this.el = el;
    this.value = initialValue;
    this.format = opts.format || formatINR;
    this.el.textContent = this.format(initialValue);
    this.el.classList.add('num-transition');
  }

  update(newValue, direction = 'up') {
    const { el } = this;
    el.classList.add('updating');
    setTimeout(() => {
      this.value = newValue;
      el.textContent = this.format(newValue);
      el.classList.remove('updating');
    }, 150);
  }
}

/**
 * Animate a cash event (e.g. +₹1.8L settlement) appearing on screen.
 */
export function flashCashEvent(container, amount, label) {
  const el = document.createElement('div');
  const isPositive = amount >= 0;
  el.style.cssText = `
    position:absolute;
    font-family:'Inter',sans-serif;
    font-size:13px;
    font-weight:600;
    color:${isPositive ? '#1A6B5A' : '#C0392B'};
    background:${isPositive ? 'rgba(26,107,90,0.1)' : 'rgba(192,57,43,0.08)'};
    border:1px solid ${isPositive ? 'rgba(26,107,90,0.2)' : 'rgba(192,57,43,0.15)'};
    padding:4px 10px;
    border-radius:20px;
    white-space:nowrap;
    opacity:0;
    transform:translateY(0);
    transition:opacity 300ms ease,transform 600ms ease,top 600ms ease;
    top:${20 + Math.random() * 60}%;
    ${Math.random() > 0.5 ? 'left' : 'right'}:${8 + Math.random() * 20}%;
    pointer-events:none;
  `;
  el.textContent = `${isPositive ? '+' : ''}${formatINR(amount)} ${label}`;
  container.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-24px)';
      setTimeout(() => el.remove(), 600);
    }, 2000);
  });
}
