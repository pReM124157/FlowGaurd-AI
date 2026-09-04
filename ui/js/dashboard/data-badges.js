/**
 * FlowGuard — Provenance Badge Renderer
 *
 * Renders color-coded badges for each data provenance type.
 * Used on all metric cards to communicate data source confidence.
 */

import { provenanceBadgeClass, provenanceLabel } from '../provenance.js';

/**
 * Render a provenance badge HTML string.
 * @param {string} provenance
 * @returns {string} HTML
 */
export function renderBadge(provenance) {
  const cls   = provenanceBadgeClass(provenance);
  const label = provenanceLabel(provenance);
  return `<span class="badge ${cls}" title="${label} — ${badgeTooltip(provenance)}">${label}</span>`;
}

/**
 * Render a metric card value cell.
 * If the metric is not reliable, renders "Not enough data" instead of fabricating.
 *
 * @param {MetricValue} metric
 * @param {object} [opts]
 * @param {string} [opts.format]    - 'currency' | 'number' | 'percent' | 'raw'
 * @param {string} [opts.currency]  - ISO 4217 currency code
 * @returns {string} HTML
 */
export function renderMetricCell(metric, opts = {}) {
  if (!metric) {
    return `<span class="kpi-value no-data">Not enough data</span>`;
  }

  if (!metric.reliable || metric.value === null) {
    return `<span class="kpi-value no-data" title="${metric.source ?? 'No data source'}">Not enough data</span>`;
  }

  const formatted = formatValue(metric.value, opts);
  const badge     = renderBadge(metric.provenance);
  const freshness = metric.asOf ? `<span class="kpi-freshness">${formatFreshness(metric.asOf)}</span>` : '';

  return `
    <div class="kpi-value">${formatted}</div>
    <div class="kpi-footer">
      ${badge}
      ${freshness}
    </div>
  `;
}

/**
 * Render the data sources freshness bar (top of dashboard).
 * @param {Array} dataSources
 * @returns {string} HTML
 */
export function renderSourcesBar(dataSources) {
  if (!dataSources?.length) {
    return `<div class="data-sources-bar"><span class="text-muted" style="font-size:var(--text-xs)">No data sources connected — metrics unavailable</span></div>`;
  }

  const pills = dataSources.map(src => {
    const staleness = getStaleness(src.lastSyncAt);
    const dotClass  = src.status !== 'connected' ? 'missing' : staleness === 'stale' ? 'stale' : '';
    return `
      <div class="source-pill">
        <span class="source-dot ${dotClass}"></span>
        <span>${src.name}</span>
        <span class="text-muted" style="font-size:10px">${formatFreshness(src.lastSyncAt) ?? 'Never'}</span>
      </div>
    `;
  }).join('');

  return `<div class="data-sources-bar">${pills}</div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(value, opts) {
  const fmt = opts.format ?? 'currency';
  const cur = opts.currency ?? 'USD';
  if (fmt === 'currency') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(value);
  }
  if (fmt === 'percent') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (fmt === 'number') {
    return new Intl.NumberFormat('en-US').format(value);
  }
  return String(value);
}

function formatFreshness(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getStaleness(isoString) {
  if (!isoString) return 'missing';
  const hrs = (Date.now() - new Date(isoString).getTime()) / 3600000;
  return hrs > 24 ? 'stale' : 'fresh';
}

function badgeTooltip(provenance) {
  const tooltips = {
    ACTUAL:        'Value sourced directly from a verified connected integration',
    USER_DECLARED: 'Value entered manually during onboarding — used as context, not financial fact',
    PENDING:       'Source connected but data has not yet arrived',
    FORECAST:      'Projected value based on historical trend analysis',
    PREDICTED:     'Machine-learning inference from available signals',
    SIMULATED:     'Synthetic value for demonstration purposes only',
  };
  return tooltips[provenance] ?? 'Unknown provenance';
}
