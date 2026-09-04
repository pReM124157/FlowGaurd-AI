const byId = (id) => document.getElementById(id);
let savedBusinessProfile;

function money(value) {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);
}

function metricNote(id, text) { byId(`${id}-note`).textContent = text; }

function stateLabel(state) {
  const labels = { ACTUAL: '● ACTUAL · Bank verified', PENDING: '● PENDING', DECLARED: '◌ DECLARED · Provided by you', ESTIMATED: '◇ ESTIMATED · Calculated from your inputs', FORECAST: '↗ FORECAST', PREDICTED: '↗ PREDICTED', SIMULATED: '◇ SIMULATED', UNKNOWN: 'UNKNOWN' };
  return labels[state] || 'UNKNOWN';
}

function renderMoneyMetric(id, metric, fallback) {
  const value = metric?.amountMinor;
  byId(id).textContent = Number.isSafeInteger(value) ? money(value) : fallback;
  metricNote(id, metric ? `${stateLabel(metric.state)} · ${metric.note || ''}` : fallback);
}

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) throw new Error('Request unavailable');
  return response.json();
}

async function hydrateControlCenter() {
  try {
    const me = await api('/api/me');
    const name = me.user.displayName || me.user.email.split('@')[0];
    byId('account-name').textContent = name;
    byId('account-initial').textContent = name[0].toUpperCase();
    byId('account-meta').textContent = `${me.user.role || 'OWNER'} · ${me.organization?.name || 'FlowGuard'} · Account menu`;
    byId('account-email').textContent = me.user.email;
    byId('account-organization').textContent = me.organization?.name || 'FlowGuard';
    byId('account-role').textContent = me.user.role || 'OWNER';
    savedBusinessProfile = me.onboarding?.businessProfile?.value || {
      organizationName: me.organization?.name || name,
      industryType: 'Other',
      timezone: me.organization?.timezone || 'Asia/Kolkata',
      currency: 'INR',
      payrollAmountMinor: 0,
      payrollSchedule: 'MONTHLY',
      minimumLiquidityBufferMinor: 0,
      receivableTermsDays: 0,
      recurringObligations: [],
      financingObligations: [],
      notificationPreferences: { inAppEnabled: true, emailEnabled: true, minimumSeverity: 'WARNING' },
    };
    byId('freshness').textContent = 'Updated just now · server verified';
    let overview;
    try { overview = await api('/api/overview'); } catch { overview = null; }
    if (!overview?.metrics) return;
    const cashMetric = overview.metrics.availableCash;
    const positionMetric = overview.metrics.forecast30Day;
    const runwayMetric = overview.metrics.cashRunway;
    renderMoneyMetric('available-cash', cashMetric, 'Not enough data');
    const hasPosition = Number.isSafeInteger(positionMetric?.amountMinor);
    if (hasPosition) {
      byId('forecast-label').textContent = '30-DAY POSITION';
      renderMoneyMetric('forecast-position', positionMetric, 'Not enough data');
    } else if (overview.metrics.obligations30Day?.amountMinor !== undefined) {
      byId('forecast-label').textContent = '30-DAY OBLIGATIONS';
      renderMoneyMetric('forecast-position', overview.metrics.obligations30Day, 'Not enough data');
    }
    if (Number.isSafeInteger(runwayMetric?.days)) {
      byId('runway-label').textContent = 'RUNWAY';
      byId('runway').textContent = `${runwayMetric.days} days`;
      metricNote('runway', `${stateLabel(runwayMetric.state)} · ${runwayMetric.note || ''}`);
    } else if (overview.metrics.liquidityBuffer?.amountMinor !== undefined) {
      byId('runway-label').textContent = 'LIQUIDITY BUFFER';
      byId('runway').textContent = money(overview.metrics.liquidityBuffer.amountMinor);
      metricNote('runway', `${stateLabel(overview.metrics.liquidityBuffer.state)} · ${overview.metrics.liquidityBuffer.note || ''}`);
    } else {
      byId('runway-label').textContent = 'RUNWAY';
      byId('runway').textContent = 'Not enough data';
      metricNote('runway', 'Needs declared cash and operating costs');
    }
    const hasDeclaredBaseline = overview.dataState === 'DECLARED';
    const hasActualCash = cashMetric?.state === 'ACTUAL';
    byId('control-status').textContent = hasActualCash
      ? 'LIVE FINANCIAL INTELLIGENCE'
      : hasDeclaredBaseline ? 'DECLARED OPERATING BASELINE' : 'FINANCIAL READINESS';
    byId('condition').textContent = hasActualCash
      ? 'Your liquidity is being watched in real time.'
      : hasDeclaredBaseline ? 'Your declared operating baseline is active.' : 'No financial evidence is connected yet.';
    byId('subcondition').textContent = hasActualCash
      ? 'FlowGuard is reconciling verified sources against your operating model.'
      : hasDeclaredBaseline
        ? 'Based on what you told us. Connect a bank to verify cash and progressively reconcile every figure.'
        : 'Connect a bank, accounting ledger, or payment source. FlowGuard will show only what the evidence supports.';
    if (hasDeclaredBaseline) {
      byId('position-heading').textContent = 'Your operating model is ready to verify.';
      byId('position-copy').textContent = 'Declared values are preserved for audit, then reconciled—not added again—when bank and payment data arrives.';
    }
    const alerts = (overview.activeAlerts?.critical || 0) + (overview.activeAlerts?.high || 0) + (overview.activeAlerts?.warning || 0);
    if (alerts) {
      byId('attention-list').innerHTML = `<div class="attention-item"><i></i><div><b>${alerts} verified item${alerts === 1 ? '' : 's'} need attention</b><small>Open the relevant financial workflow to inspect deterministic evidence.</small></div><span>Review →</span></div>`;
    }
  } catch {
    byId('freshness').textContent = 'Server session required';
  }
}

async function askFlowGuard(question, { automatic = false } = {}) {
  const output = byId('ai-answer');
  output.hidden = false;
  output.textContent = automatic
    ? 'FlowGuard is preparing your first financial insight…'
    : 'FlowGuard is grounding an answer in your saved financial evidence…';
  try {
    const result = await api('/api/controller/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
    const insight = result.insight || {};
    output.innerHTML = '';
    output.append(document.createTextNode(insight.answer || result.answer));
    const detail = document.createElement('small');
    const source = insight.provider === 'gemini' ? 'Gemini synthesis' : 'Deterministic financial analysis';
    detail.textContent = `${source} · Confidence ${Math.round((insight.confidence || .4) * 100)}% · Evidence: ${(insight.evidence || result.toolCalls || []).join(', ') || 'your declared financial context'}`;
    output.append(detail);
  } catch {
    output.textContent = 'FlowGuard could not reach the analysis service. Please try again.';
  }
}

byId('ask-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = byId('ask-input').value.trim();
  if (!question) {
    byId('ask-input').focus();
    return;
  }
  await askFlowGuard(question);
});

const accountMenuTrigger = byId('account-menu-trigger');
const accountMenu = byId('account-menu');
const accountDialog = byId('account-dialog');

function closeAccountMenu() {
  accountMenu.hidden = true;
  accountMenuTrigger.setAttribute('aria-expanded', 'false');
}

accountMenuTrigger.addEventListener('click', (event) => {
  event.stopPropagation();
  const opening = accountMenu.hidden;
  accountMenu.hidden = !opening;
  accountMenuTrigger.setAttribute('aria-expanded', String(opening));
});
byId('account-details-button').addEventListener('click', () => { closeAccountMenu(); accountDialog.showModal(); });
byId('account-dialog-close').addEventListener('click', () => accountDialog.close());
document.addEventListener('click', (event) => { if (!event.target.closest('.account-control')) closeAccountMenu(); });
byId('logout-button').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); window.location.assign('/'); });
const financialInputDialog = byId('financial-input-dialog');
function rupeesToMinor(value) { const amount = Number(String(value).replace(/[^0-9.-]/g, '')); return Number.isFinite(amount) ? Math.round(Math.max(0, amount) * 100) : undefined; }
function minorToRupees(value) { return Number.isSafeInteger(value) ? String(value / 100) : ''; }
byId('edit-financial-inputs').addEventListener('click', () => {
  byId('edit-organization-name').value = savedBusinessProfile.organizationName || '';
  byId('edit-industry').value = savedBusinessProfile.industryType || '';
  byId('edit-current-cash').value = minorToRupees(savedBusinessProfile.currentCashMinor);
  byId('edit-payroll').value = minorToRupees(savedBusinessProfile.payrollAmountMinor);
  byId('edit-buffer').value = minorToRupees(savedBusinessProfile.minimumLiquidityBufferMinor);
  byId('edit-terms').value = savedBusinessProfile.receivableTermsDays ?? 0;
  byId('financial-input-status').textContent = '';
  financialInputDialog.showModal();
});
byId('financial-input-close').addEventListener('click', () => financialInputDialog.close());
byId('financial-input-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!savedBusinessProfile) return;
  const currentCashMinor = rupeesToMinor(byId('edit-current-cash').value);
  const payload = {
    ...savedBusinessProfile,
    organizationName: byId('edit-organization-name').value.trim(),
    industryType: byId('edit-industry').value.trim(),
    ...(currentCashMinor === undefined ? { currentCashMinor: undefined } : { currentCashMinor }),
    payrollAmountMinor: rupeesToMinor(byId('edit-payroll').value) ?? 0,
    minimumLiquidityBufferMinor: rupeesToMinor(byId('edit-buffer').value) ?? 0,
    receivableTermsDays: Number(byId('edit-terms').value),
  };
  const status = byId('financial-input-status');
  status.textContent = 'Saving declared inputs and recalculating...';
  try {
    await api('/api/financial-inputs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    savedBusinessProfile = payload;
    financialInputDialog.close();
    await hydrateControlCenter();
    await askFlowGuard('Summarize my updated financial inputs, identify the most important financial risk, and state the next action needed to improve confidence.', { automatic: true });
  } catch { status.textContent = 'Unable to save these inputs. Check each value and try again.'; }
});
async function initializeControlCenter() {
  await hydrateControlCenter();
  await askFlowGuard('Summarize my saved financial inputs, identify the most important financial risk, and state the next action needed to improve confidence.', { automatic: true });
}

void initializeControlCenter();
