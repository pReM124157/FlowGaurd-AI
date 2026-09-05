/* CSP-safe resilience controller for onboarding navigation. */
let activeStep = Number(document.querySelector('.ob-screen.active')?.dataset.step ?? 1);
let isTransitioning = false;

async function resumeSavedOnboarding() {
  try {
    const response = await fetch('/api/onboarding', { credentials: 'same-origin' });
    if (!response.ok) return;
    const payload = await response.json();
    const stage = payload?.onboarding?.stage;
    if (stage === 'READY') {
      window.location.replace('/pages/dashboard.html');
      return;
    }
    // DATA_VALIDATION is the final saved-questionnaire stage for older
    // accounts. Go to the workspace rather than replaying an old reveal.
    if (stage === 'DATA_VALIDATION') {
      window.location.replace('/pages/dashboard.html');
      return;
    }
    if (stage === 'INITIAL_CALCULATION') {
      window.location.replace(payload.assessment ? '/pages/reveal.html' : '/pages/calculate.html');
    }
  } catch {
    // The normal onboarding form remains available if the session cannot load.
  }
}

void resumeSavedOnboarding();

function moveTo(step, backwards = false) {
  const current = document.querySelector('.ob-screen.active');
  const next = document.querySelector(`.ob-screen[data-step="${step}"]`);
  if (!next || current === next || isTransitioning) return;

  isTransitioning = true;
  const enterClass = backwards ? 'enter-left' : 'enter-right';
  const exitClass = backwards ? 'exit-right' : 'exit-left';
  current?.classList.add(exitClass);
  current?.classList.remove('active');
  next.classList.add(enterClass);

  requestAnimationFrame(() => {
    next.classList.add('active');
    next.classList.remove(enterClass);
    window.scrollTo(0, 0);
  });

  activeStep = step;
  const counter = document.getElementById('ob-step-counter');
  const progress = document.getElementById('ob-progress');
  const rail = document.querySelectorAll('.ob-step-rail i');
  if (counter) counter.textContent = `${String(step).padStart(2, '0')} / 08`;
  rail.forEach((item, index) => item.classList.toggle('is-active', index < step));
  if (progress) progress.style.width = `${((step - 1) / 7) * 100}%`;
  window.setTimeout(() => {
    current?.classList.remove(exitClass);
    isTransitioning = false;
    next.querySelector('input, button')?.focus();
  }, 640);
}

function error(id, visible) { document.getElementById(id)?.classList.toggle('show', visible); }

document.querySelectorAll('.ob-choices').forEach((container) => {
  container.addEventListener('click', (event) => {
    const choice = event.target.closest('.ob-choice');
    if (!choice) return;
    const multi = container.getAttribute('aria-multiselectable') === 'true';
    if (multi) choice.classList.toggle('selected');
    else {
      container.querySelectorAll('.ob-choice').forEach((item) => item.classList.remove('selected'));
      choice.classList.add('selected');
    }
    if (container.id === 'industry-choices') {
      const other = document.getElementById('industry-other');
      if (other) other.style.display = choice.dataset.value === 'other' ? 'block' : 'none';
    }
  });
});

[['has-payroll', 'payroll-detail'], ['has-vendors', 'vendor-detail'], ['has-loans', 'loan-detail']].forEach(([toggle, detail]) => {
  document.getElementById(toggle)?.addEventListener('change', (event) => { document.getElementById(detail).style.display = event.target.checked ? 'block' : 'none'; });
});
document.querySelectorAll('[id^="back-"]').forEach((button) => button.addEventListener('click', () => moveTo(Math.max(1, activeStep - 1), true)));

document.getElementById('btn-1')?.addEventListener('click', () => { const valid = Boolean(document.getElementById('org-name')?.value.trim()); error('q1-err', !valid); if (valid) moveTo(2); });
document.getElementById('btn-2')?.addEventListener('click', () => { const selected = document.querySelector('#industry-choices .ob-choice.selected'); const valid = Boolean(selected) && (selected.dataset.value !== 'other' || Boolean(document.getElementById('industry-other')?.value.trim())); error('q2-err', !valid); if (valid) moveTo(3); });
document.getElementById('btn-3')?.addEventListener('click', () => { const valid = Boolean(document.querySelector('#payment-choices .ob-choice.selected')); error('q3-err', !valid); if (valid) moveTo(4); });
document.getElementById('btn-4')?.addEventListener('click', () => moveTo(5));
document.getElementById('btn-5')?.addEventListener('click', () => moveTo(6));
document.getElementById('skip-5')?.addEventListener('click', () => moveTo(6));
document.getElementById('btn-6')?.addEventListener('click', () => moveTo(7));
document.getElementById('btn-7')?.addEventListener('click', () => { const valid = Boolean(document.querySelector('#terms-choices .ob-choice.selected')); error('q7-err', !valid); if (valid) moveTo(8); });
document.querySelectorAll('.ob-conn-card').forEach((card) => card.addEventListener('click', () => {
  // A visual selection is not a financial connection. Keep this explicit until
  // the corresponding provider/import flow has completed.
  card.classList.toggle('selected');
  card.querySelector('.ob-conn-status').textContent = card.classList.contains('selected')
    ? 'Selected — connection required'
    : '';
}));

const rupeesToMinor = (value) => Math.max(0, Math.round(Number(value || 0) * 100));
const selectedValues = (selector) => [...document.querySelectorAll(`${selector} .ob-choice.selected`)].map((item) => item.dataset.value);

async function saveDeclaredOnboardingContext() {
  const organizationName = document.getElementById('org-name')?.value.trim() || 'My business';
  const industryChoice = document.querySelector('#industry-choices .ob-choice.selected');
  const industryType = industryChoice?.dataset.value === 'other'
    ? (document.getElementById('industry-other')?.value.trim() || 'other')
    : (industryChoice?.dataset.value || 'other');
  const payrollEnabled = Boolean(document.getElementById('has-payroll')?.checked);
  const vendorEnabled = Boolean(document.getElementById('has-vendors')?.checked);
  const loanEnabled = Boolean(document.getElementById('has-loans')?.checked);
  const payrollAmountMinor = payrollEnabled ? rupeesToMinor(document.getElementById('payroll-amount')?.value) : 0;
  const vendorAmountMinor = vendorEnabled ? rupeesToMinor(document.getElementById('vendor-amount')?.value) : 0;
  const loanAmountMinor = loanEnabled ? rupeesToMinor(document.getElementById('loan-amount')?.value) : 0;
  const payrollSchedule = document.querySelector('#payroll-schedule .ob-choice.selected')?.dataset.value || 'monthly';
  const receivableTerms = document.querySelector('#terms-choices .ob-choice.selected')?.dataset.value;
  const receivableTermsDays = Number.isFinite(Number(receivableTerms)) ? Number(receivableTerms) : 30;
  const selectedConnections = new Set([...document.querySelectorAll('.ob-conn-card.selected')].map((item) => item.dataset.source));

  const currentCashInput = document.getElementById('current-cash')?.value;
  const revenueChannels = selectedValues('#payment-choices');
  const cashPressureSources = selectedValues('#pressure-choices');
  const profile = {
    organizationName,
    industryType,
    revenueChannels,
    cashPressureSources,
    connectionRequests: [...selectedConnections],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    currency: 'INR',
    ...(currentCashInput ? { currentCashMinor: rupeesToMinor(currentCashInput) } : {}),
    payrollAmountMinor,
    payrollSchedule,
    minimumLiquidityBufferMinor: rupeesToMinor(document.getElementById('liquidity-buffer')?.value),
    receivableTermsDays,
    recurringObligations: [
      ...(vendorAmountMinor ? [{ label: 'Vendor payments', amountMinor: vendorAmountMinor, cadence: 'monthly' }] : []),
      ...(payrollAmountMinor ? [{ label: 'Payroll', amountMinor: payrollAmountMinor, cadence: payrollSchedule }] : []),
    ],
    financingObligations: loanAmountMinor ? [{ lender: 'Declared loan repayment', amountMinor: loanAmountMinor, cadence: 'monthly' }] : [],
    notificationPreferences: { inAppEnabled: true, emailEnabled: true, minimumSeverity: 'WARNING' },
  };
  const riskPreferences = {
    lateReceivableProbability: cashPressureSources.includes('late_payments') ? 0.35 : 0.15,
    materialAmountMinor: Math.max(rupeesToMinor(document.getElementById('liquidity-buffer')?.value), 10_000),
    feeRateUpperBound: 0.03,
    concentrationThreshold: 0.5,
  };
  const dataConnections = {
    // Selection is a request to connect, never a completed integration.
    razorpay: selectedConnections.has('razorpay') ? 'NOT_CONNECTED' : 'SKIPPED',
    bank: selectedConnections.has('bank') ? 'NOT_CONNECTED' : 'SKIPPED',
    receivables: selectedConnections.has('invoices') ? 'NOT_CONNECTED' : 'SKIPPED',
  };
  const post = async (path, body) => {
    let response = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.status === 401) {
      await fetch('/api/session/live-login', { credentials: 'same-origin' });
      response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    }
    if (!response.ok) throw new Error(`Unable to save onboarding (${response.status})`);
  };
  await post('/api/onboarding/business-profile', profile);
  await post('/api/onboarding/risk-preferences', riskPreferences);
  await post('/api/onboarding/data-connections', dataConnections);
}

document.getElementById('btn-8')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const button = event.currentTarget;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Saving your financial context…';
  try {
    try {
      const meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) await fetch('/api/session/live-login', { credentials: 'same-origin' });
    } catch {
      await fetch('/api/session/live-login', { credentials: 'same-origin' });
    }
    await saveDeclaredOnboardingContext();
    window.location.assign('/pages/calculate.html');
  } catch (saveError) {
    console.error('Onboarding context save failed', saveError);
    button.disabled = false;
    button.textContent = originalText;
    window.location.assign('/pages/calculate.html');
  }
});
