/**
 * FlowGuard — Provenance Model
 *
 * Every metric in the system carries a provenance tag so the UI
 * can accurately represent the source and reliability of data.
 * USER_DECLARED values are NEVER promoted to ACTUAL.
 */

export const Provenance = Object.freeze({
  /** Value confirmed from a live, verified connected data source */
  ACTUAL: 'ACTUAL',
  /** Manually entered by the user during onboarding or profile setup */
  USER_DECLARED: 'USER_DECLARED',
  /** Awaiting data ingestion — source connected but not yet synced */
  PENDING: 'PENDING',
  /** Model-generated projection based on historical patterns */
  FORECAST: 'FORECAST',
  /** Machine-learning inference from partial signals */
  PREDICTED: 'PREDICTED',
  /** Demo / what-if scenario — never real financial data */
  SIMULATED: 'SIMULATED',
});

/**
 * Create a typed metric value object.
 * @param {*} value        - The numeric or string value (null if unavailable)
 * @param {string} provenance - One of Provenance.*
 * @param {object} [opts]
 * @param {string} [opts.source]     - Canonical source identifier (e.g. 'quickbooks', 'csv_import')
 * @param {string|null} [opts.asOf]  - ISO timestamp of when the value was last updated
 * @param {boolean} [opts.reliable]  - If false, UI must render "Not enough data" rather than the value
 * @returns {MetricValue}
 */
export function createMetric(value, provenance, opts = {}) {
  if (!Object.values(Provenance).includes(provenance)) {
    throw new Error(`Invalid provenance: ${provenance}`);
  }
  const reliable = opts.reliable !== undefined ? opts.reliable : value !== null;
  return Object.freeze({
    value,
    provenance,
    source:   opts.source  ?? null,
    asOf:     opts.asOf    ?? null,
    reliable,
  });
}

/**
 * A metric with no data. UI MUST render "Not enough data".
 * @param {string} [reason]
 */
export function noDataMetric(reason = 'No data source connected') {
  return createMetric(null, Provenance.PENDING, { reliable: false, source: reason });
}

/**
 * A pending metric: source is connected but data has not arrived yet.
 */
export function pendingMetric(source) {
  return createMetric(null, Provenance.PENDING, { reliable: false, source });
}

/**
 * A simulated metric for the Demo Company.
 * Value is populated but clearly SIMULATED — never shown as real.
 */
export function simulatedMetric(value, source = 'demo_synthetic') {
  return createMetric(value, Provenance.SIMULATED, { source, reliable: true });
}

/**
 * Is this provenance type considered "reliable" enough to show in
 * a live financial dashboard without additional disclaimers?
 */
export function isReliableForDashboard(provenance) {
  return [Provenance.ACTUAL, Provenance.FORECAST, Provenance.PREDICTED].includes(provenance);
}

/**
 * Returns CSS class name for a provenance badge.
 */
export function provenanceBadgeClass(provenance) {
  const map = {
    [Provenance.ACTUAL]:        'badge-actual',
    [Provenance.USER_DECLARED]: 'badge-user-declared',
    [Provenance.PENDING]:       'badge-pending',
    [Provenance.FORECAST]:      'badge-forecast',
    [Provenance.PREDICTED]:     'badge-predicted',
    [Provenance.SIMULATED]:     'badge-simulated',
  };
  return map[provenance] ?? 'badge-pending';
}

/**
 * Human-readable label for a provenance type.
 */
export function provenanceLabel(provenance) {
  const map = {
    [Provenance.ACTUAL]:        'Actual',
    [Provenance.USER_DECLARED]: 'User Declared',
    [Provenance.PENDING]:       'Pending',
    [Provenance.FORECAST]:      'Forecast',
    [Provenance.PREDICTED]:     'Predicted',
    [Provenance.SIMULATED]:     'Demo Data',
  };
  return map[provenance] ?? provenance;
}
