/* CSP-safe reveal fallback for server-authenticated onboarding. */
const revealValues = ['Not connected', 'Needs live data', 'Not connected', 'Declared during onboarding'];
const revealSources = ['Connect a bank source to verify cash', 'Forecast begins after a bank connection', 'Connect receivables to calculate', 'Your declared operating context'];

async function showFinancialReveal() {
  for (let index = 0; index < 4; index += 1) {
    const card = document.getElementById(`card-${index}`);
    const value = document.getElementById(`val-${index}`);
    const source = document.getElementById(`src-${index}`);
    if (value) {
      value.textContent = revealValues[index];
      if (index > 1) value.classList.add('no-data');
    }
    if (source) source.textContent = revealSources[index];
    card?.classList.add('revealed');
    await new Promise((resolve) => window.setTimeout(resolve, 240));
  }
  // Onboarding information is contextual, not an actual cash balance. Read it
  // from the authenticated server record rather than treating browser storage
  // as the source of truth.
  try {
    const response = await fetch('/api/onboarding', { credentials: 'same-origin' });
    if (response.ok) {
      const payload = await response.json();
      const profile = payload?.onboarding?.businessProfile?.value;
      if (profile) {
        const formatMinor = (amountMinor) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amountMinor || 0) / 100);
        const context = [
          profile.industryType,
          profile.payrollAmountMinor ? `Payroll ${formatMinor(profile.payrollAmountMinor)}` : '',
          profile.minimumLiquidityBufferMinor ? `Liquidity preference ${formatMinor(profile.minimumLiquidityBufferMinor)}` : '',
        ].filter(Boolean).join(' · ');
        const contextValue = document.getElementById('val-3');
        const contextSource = document.getElementById('src-3');
        if (contextValue) { contextValue.textContent = profile.organizationName || 'Onboarding context saved'; contextValue.classList.remove('no-data'); }
        if (contextSource) contextSource.textContent = context || 'Declared business operating context';
      }
    }
  } catch { /* Context is optional; financial values remain source-gated. */ }
  document.getElementById('reveal-alert')?.classList.add('revealed');
  document.getElementById('reveal-actions')?.classList.add('revealed');
}

showFinancialReveal();

// Older sessions may have reached the reveal while the previous server-side
// rule still considered a missing bank source "incomplete". Finalize once more
// at the handoff so the dashboard can never route this button back to setup.
document.getElementById('open-dashboard-btn')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const button = event.currentTarget;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/onboarding/initial-calculation', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('Unable to complete onboarding');
    window.location.assign(button.href);
  } catch {
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    window.location.assign(button.href);
  }
});
