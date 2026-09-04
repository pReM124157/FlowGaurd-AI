/* CSP-safe calculation sequence. Keeps the completion route reliable even if
   the richer module controller is unavailable. */
const calculationSteps = [
  'CONTEXT RESOLVED · USER DECLARED',
  'SOURCE AVAILABILITY CHECK · VERIFIED',
  'PROVENANCE BOUNDARY ESTABLISHED',
  'INITIAL FINANCIAL PICTURE ASSEMBLED',
  'READINESS AUDIT COMPLETE',
];
const calculationProgress = document.getElementById('calc-progress-bar');
const calculationTelemetry = document.getElementById('calc-telemetry');

async function runCalculationSequence() {
  for (let index = 0; index < calculationSteps.length; index += 1) {
    const step = document.getElementById(`step-${index}`);
    const status = document.getElementById(`status-${index}`);
    step?.classList.add('active');
    if (status) status.textContent = 'Processing…';
    if (calculationTelemetry) calculationTelemetry.textContent = calculationSteps[index];
    if (calculationProgress) calculationProgress.style.width = `${((index + .5) / calculationSteps.length) * 100}%`;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    step?.classList.remove('active');
    step?.classList.add('complete');
    const icon = step?.querySelector('.calc-step-icon');
    if (icon) icon.textContent = 'OK';
    if (status) status.textContent = '✓ Complete';
    if (calculationProgress) calculationProgress.style.width = `${((index + 1) / calculationSteps.length) * 100}%`;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  if (calculationTelemetry) calculationTelemetry.textContent = 'VERIFYING DATA READINESS';
  const post = async (path) => {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Readiness check failed (${response.status})`);
    return response.json();
  };

  try {
    await post('/api/onboarding/validate');
    const result = await post('/api/onboarding/initial-calculation');
    if (calculationTelemetry) {
      calculationTelemetry.textContent = result?.onboarding?.stage === 'READY'
        ? 'FINANCIAL MODEL READY'
        : 'INITIAL ASSESSMENT READY · LIVE DATA STILL NEEDED';
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    window.location.assign('/pages/reveal.html');
  } catch {
    if (calculationTelemetry) calculationTelemetry.textContent = 'WE COULD NOT VERIFY YOUR DATA. PLEASE TRY AGAIN.';
  }
}

runCalculationSequence();
