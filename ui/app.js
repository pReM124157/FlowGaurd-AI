const screens = [
  ["onboarding", "Onboarding"],
  ["overview", "Overview"],
  ["cash", "Cash Position"],
  ["payments", "Payments & Settlements"],
  ["reconciliation", "Reconciliation"],
  ["receivables", "Receivables"],
  ["forecast", "Forecast"],
  ["twin", "Financial Digital Twin"],
  ["controller", "AI Controller"],
  ["risks", "Risks / Anomalies"],
  ["audit", "Audit History"],
  ["settings", "Settings"],
];

const FINANCIAL_STATE_LABELS = ["ACTUAL", "USER_DECLARED", "PENDING", "FORECAST", "PREDICTED", "SIMULATED", "DEMO DATA"];
const state = { screen: "overview", data: {}, me: null };

const nav = document.querySelector("#nav");
const screen = document.querySelector("#screen");
const title = document.querySelector("#screen-title");
const rolePill = document.querySelector("#role-pill");
const freshness = document.querySelector("#freshness");

for (const [id, label] of screens) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => loadScreen(id));
  button.dataset.screen = id;
  nav.append(button);
}

init();

async function init() {
  try {
    state.me = await api("/api/me");
  } catch (error) {
    await api("/api/session/live-login");
    state.me = await api("/api/me");
  }
  rolePill.textContent = state.me.user.role;
  const requested = location.hash.replace("#", "");
  const initial = state.me.onboarding?.stage !== "READY" && state.me.dataLabel !== "DEMO DATA" ? "onboarding" : requested;
  await loadScreen(screens.some(([id]) => id === initial) ? initial : "overview");
}

async function loadScreen(id) {
  state.screen = id;
  if (location.hash.replace("#", "") !== id) history.replaceState(null, "", `#${id}`);
  document.querySelectorAll(".nav button").forEach((button) => button.setAttribute("aria-current", button.dataset.screen === id ? "page" : "false"));
  title.textContent = screens.find((screenItem) => screenItem[0] === id)?.[1] ?? "FlowGuard";
  freshness.textContent = "Updated now";
  screen.innerHTML = `<div class="panel"><h2>Loading</h2><p class="muted">Checking authoritative FlowGuard APIs...</p></div>`;
  try {
    await render(id);
  } catch (error) {
    if (error.code === "FG_ONBOARDING_REQUIRED") {
      await renderOnboarding(error.onboarding ?? (await api("/api/onboarding")).onboarding);
      return;
    }
    screen.innerHTML = errorState(error.message);
  }
}

async function render(id) {
  if (id === "onboarding") return renderOnboarding((await api("/api/onboarding")).onboarding);
  if (id === "overview") return renderOverview(await api("/api/overview"));
  if (id === "cash") return renderCash(await api("/api/cash-position"));
  if (id === "payments") return renderPayments(await api("/api/payments"), await api("/api/settlements"));
  if (id === "reconciliation") return renderReconciliation(await api("/api/reconciliation"));
  if (id === "receivables") return renderReceivables(await api("/api/receivables"));
  if (id === "forecast") return renderForecast(await api("/api/forecast"));
  if (id === "twin") return renderTwin(await api("/api/scenarios", { method: "POST", body: "{}" }));
  if (id === "controller") return renderController();
  if (id === "risks") return renderRisks(await api("/api/risks"));
  if (id === "audit") return renderAudit(await api("/api/audit"));
  if (id === "settings") return renderSettings(await api("/api/settings"));
}

async function renderOnboarding(onboardingState) {
  const payload = await api("/api/onboarding");
  const onboardingData = onboardingState ?? payload.onboarding;
  const stage = onboardingData.stage;
  title.textContent = "Financial Onboarding";
  freshness.textContent = "Resume saved";
  screen.innerHTML = `
    ${dataBanner(payload.dataLabel)}
    <section class="panel onboarding-flow">
      <h2>Set up financial control</h2>
      <div class="stepper">${payload.onboarding.requiredStages.map((item) => `<span class="${item === stage ? "current" : ""}">${escapeHtml(item.replaceAll("_", " "))}</span>`).join("")}</div>
      ${stage === "BUSINESS_PROFILE" ? businessProfileForm() : ""}
      ${stage === "RISK_PREFERENCES" ? riskPreferencesForm(onboardingData.businessProfile) : ""}
      ${stage === "DATA_CONNECTIONS" ? dataConnectionsForm() : ""}
      ${stage === "DATA_VALIDATION" ? validationPanel(onboardingData.readinessAudit) : ""}
      ${stage === "INITIAL_CALCULATION" ? initialCalculationPanel(onboardingData.readinessAudit, payload.assessment) : ""}
      ${stage === "READY" ? readyPanel(payload.assessment) : ""}
    </section>
    <section class="panel"><h2>Explore demo company</h2><p class="muted">Use this only to view synthetic buildathon records. Live organizations do not inherit these records.</p><button class="button secondary" id="demo-company" type="button">Explore Demo Company</button></section>
  `;
  bindOnboarding(stage);
  document.querySelector("#demo-company")?.addEventListener("click", async () => {
    await api("/api/session/demo-login");
    location.hash = "#overview";
    location.reload();
  });
}

function renderOverview(data) {
  if (data.dataState === "EMPTY") {
    screen.innerHTML = onboarding(data);
    return;
  }
  const m = data.metrics;
  if (!m) {
    screen.innerHTML = onboarding({ ...data, dataState: "EMPTY" });
    return;
  }
  const alertSummary = data.activeAlerts ?? { critical: 0, high: 0, warning: 0 };
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <div class="grid">
      ${metric("Available Cash", m.availableCash, `Payments updated ${fresh(data.freshness?.payments)}`)}
      ${metric("Pending Settlement", m.pendingSettlement, "Gateway settlement queue")}
      ${metric("30-Day Forecast", m.forecast30Day, "Baseline forecast")}
      ${metric("Receivables", m.receivables, "Open expected cash")}
      ${metric("At-Risk Receivables", m.atRiskReceivables, `${Math.round(m.atRiskReceivables.probabilityLate * 100)}% late probability`)}
      <article class="metric"><span class="label">Cash Runway</span><span class="amount">${m.cashRunway.days} days</span>${badge(m.cashRunway.state)}<p class="muted">Forecast horizon remaining</p></article>
      <article class="metric"><span class="label">Reconciliation Health</span><span class="amount">${Math.round(m.reconciliationHealth.rate * 100)}%</span>${badge(m.reconciliationHealth.state)}<p class="muted">${m.reconciliationHealth.exceptions} exception open</p></article>
    </div>
    <section class="panel"><h2>Active Alerts</h2><div class="grid compact-alerts">
      <article class="metric"><span class="label">Critical</span><span class="amount">${alertSummary.critical}</span><span class="state state-simulated">CRITICAL</span></article>
      <article class="metric"><span class="label">High</span><span class="amount">${alertSummary.high}</span><span class="state state-pending">HIGH</span></article>
      <article class="metric"><span class="label">Warning</span><span class="amount">${alertSummary.warning}</span><span class="state state-forecast">WARNING</span></article>
    </div></section>
    <section class="panel"><h2>Financial Timeline</h2>${timeline(data.timeline ?? [])}</section>
    <section class="panel"><h2>Financial Condition</h2><p>FlowGuard separates actual bank cash from pending settlement, forecast receivables, predicted risk, and simulated outcomes. No UI number is authoritatively calculated in the browser.</p></section>
  `;
}

function renderCash(data) {
  if (data.dataState === "EMPTY") {
    screen.innerHTML = onboarding(data);
    return;
  }
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <div class="grid">
      ${metric("Bank Cash", { ...data.actualBankCash, state: data.labels.actualBankCash }, "Bank credits posted")}
      ${metric("Pending Settlements", { ...data.pendingSettlements, state: data.labels.pendingSettlements }, "Not bank cash yet")}
      ${metric("Expected Receivables", { ...data.expectedReceivables, state: data.labels.expectedReceivables }, "Invoice cash not confirmed")}
    </div>
    <section class="panel"><h2>Cash State Boundary</h2><p class="muted">Actual, pending, and forecast values are intentionally not blended into a single ambiguous total.</p></section>
  `;
}

function renderPayments(paymentsData, settlementsData) {
  if (paymentsData.dataState === "EMPTY") {
    screen.innerHTML = onboarding(paymentsData);
    return;
  }
  const firstPayment = paymentsData.payments[0]?.id;
  screen.innerHTML = `
    ${dataBanner(paymentsData.dataLabel)}
    <div class="split">
      <section class="panel"><h2>Payments</h2>${table(["Payment", "Order", "Amount", "Status"], paymentsData.payments.map((p) => [p.id, p.orderId, amount(p.amount), p.status]))}</section>
      <section class="panel"><h2>Lineage</h2><div id="lineage" class="timeline"><div>${firstPayment ? `Selecting ${escapeHtml(firstPayment)}...` : "No payment selected."}</div></div></section>
    </div>
    <section class="panel"><h2>Settlements & Bank Credits</h2>${table(["Settlement", "Expected Net", "Bank Credits"], settlementsData.settlements.map((s) => [s.id, amount(s.expectedNet), settlementsData.bankTransactions.filter((b) => b.settlementId === s.id).map((b) => b.id).join(", ")]))}</section>
  `;
  if (firstPayment) {
    api(`/api/payments/${encodeURIComponent(firstPayment)}/lineage`).then((lineage) => {
      document.querySelector("#lineage").innerHTML = lineage.lineage.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
    });
  }
}

function renderReconciliation(data) {
  if (data.dataState === "EMPTY") {
    screen.innerHTML = onboarding(data);
    return;
  }
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>Exceptions</h2>${table(["Settlement", "Status", "Expected", "Actual", "Variance", "Confidence"], data.results.map((r) => [r.settlementId ?? "n/a", r.status, moneyMinor(r.expectedAmountMinor), moneyMinor(r.actualAmountMinor), moneyMinor(r.differenceMinor), `${Math.round(r.confidence * 100)}%`]))}</section>
  `;
}

function renderReceivables(data) {
  if (data.dataState === "EMPTY") {
    screen.innerHTML = onboarding(data);
    return;
  }
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>Open Receivables</h2>${table(["Invoice", "Customer", "Amount", "Paid", "Due", "Late Probability"], data.invoices.map((i) => [i.id, i.customerId, amount(i.amount), amount(i.paidAmount), i.dueAt.slice(0, 10), `${Math.round(data.risk.probabilityLate * 100)}%`]))}</section>
    <section class="panel"><h2>Risk Drivers</h2><div class="timeline">${data.risk.drivers.map((driver) => `<div>${escapeHtml(driver)}</div>`).join("")}</div></section>
  `;
}

function renderForecast(data) {
  if (data.dataState === "EMPTY") {
    screen.innerHTML = onboarding(data);
    return;
  }
  const days = data.forecast.days.filter((_, index) => index < 10 || index === 29);
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>30-Day Forecast</h2>${table(["Date", "Expected Inflow", "Expected Outflow", "Closing Cash", "80% Range"], days.map((d) => [d.date, amount(d.expectedInflow), amount(d.expectedOutflow), amount(d.closingCash), `${amount(d.lower80)} - ${amount(d.upper80)}`]))}</section>
  `;
}

function renderTwin(data) {
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <div class="scenario-banner">SIMULATION MODE · No authoritative financial records are being changed.</div>
    <div class="grid">
      ${metric("Baseline Minimum Cash", { ...data.scenario.baseline.minimumBalance, state: "FORECAST" }, "Before scenario")}
      ${metric("Scenario Minimum Cash", { ...data.scenario.modified.minimumBalance, state: "SIMULATED" }, "Marketing spend scenario")}
      ${metric("Difference", { ...data.scenario.differenceMinimumCash, state: "SIMULATED" }, `Seed ${data.scenario.seed}`)}
    </div>
  `;
}

function renderController() {
  screen.innerHTML = `
    <section class="panel controller">
      <h2>AI Controller</h2>
      <p class="muted">The controller can only answer through approved FlowGuard tools. Authoritative numbers remain system-calculated.</p>
      <form id="controller-form">
        <label class="visually-hidden" for="question">Question</label>
        <input id="question" name="question" value="Where did my money go?" maxlength="500" />
        <button class="button" type="submit">Ask</button>
      </form>
      <div id="controller-answer" class="timeline"><div>Ask a finance-control question.</div></div>
    </section>
  `;
  document.querySelector("#controller-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = new FormData(event.target).get("question");
    const panel = document.querySelector("#controller-answer");
    panel.innerHTML = "<div>Checking approved tools...</div>";
    const response = await api("/api/controller/query", { method: "POST", body: JSON.stringify({ question }) });
    const insight = response.insight || {};
    const evidence = insight.evidence || response.toolCalls || [];
    panel.innerHTML = `<div><strong>System-backed answer</strong><br>${escapeHtml(insight.answer || response.answer)}</div><div>Evidence: ${escapeHtml(evidence.join(", ") || "No verified source attached")}</div>`;
  });
}

function renderRisks(data) {
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>Risks</h2>${table(["Severity", "Reason", "Affected Amount", "Source", "Status"], data.risks.map((risk) => [risk.severity, risk.reason, amount(risk.affectedAmount), risk.source, risk.status]))}</section>
  `;
}

function renderAudit(data) {
  if (data.audit.length === 0) {
    screen.innerHTML = `${demoAlert(data.dataLabel)}<section class="panel"><h2>Audit History</h2><p class="muted">No audit events yet.</p></section>`;
    return;
  }
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>Audit History</h2>${table(["Time", "Actor", "Action", "Entity", "Correlation ID"], data.audit.map((event) => [event.timestamp, event.userId, event.action, `${event.entityType}:${event.entityId}`, event.correlationId]))}</section>
  `;
}

function renderSettings(data) {
  screen.innerHTML = `
    ${dataBanner(data.dataLabel)}
    <section class="panel"><h2>Connect your financial data</h2><div class="grid">
      <article class="metric"><span class="label">Razorpay</span><span class="amount">Mock</span><button class="button secondary" type="button">Connect</button></article>
      <article class="metric"><span class="label">Bank Transactions</span><span class="amount">CSV</span><button class="button secondary" type="button">Upload</button></article>
      <article class="metric"><span class="label">Receivables</span><span class="amount">CSV</span><button class="button secondary" type="button">Import</button></article>
      <article class="metric"><span class="label">Demo Company</span><span class="amount">Explore</span><button class="button secondary" type="button">Open</button></article>
    </div></section>
    <section class="panel"><h2>Data Connections</h2>${table(["Connection", "Status", "Last Synced"], data.connections.map((connection) => [connection.kind, connection.status, connection.lastSyncedAt ?? "Not connected"]))}</section>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message ?? "Request failed");
    error.code = data.error?.code;
    error.onboarding = data.onboarding;
    throw error;
  }
  return data;
}

function businessProfileForm() {
  return `
    <form id="business-profile-form" class="form-grid">
      <label>Organization name<input name="organizationName" value="Acme Retail Pvt Ltd" required /></label>
      <label>Industry / business type<input name="industryType" value="Retail commerce" required /></label>
      <label>Timezone<input name="timezone" value="Asia/Kolkata" required /></label>
      <label>Currency<select name="currency"><option value="INR">INR</option></select></label>
      <label>Payroll amount<input name="payrollAmountMinor" type="number" value="500000" min="0" required /></label>
      <label>Payroll schedule<input name="payrollSchedule" value="2026-08-29" required /></label>
      <label>Minimum liquidity buffer<input name="minimumLiquidityBufferMinor" type="number" value="200000" min="0" required /></label>
      <label>Typical receivable terms days<input name="receivableTermsDays" type="number" value="30" min="0" required /></label>
      <label>Recurring obligation<input name="recurringObligationLabel" value="Cloud tools" /></label>
      <label>Recurring amount<input name="recurringObligationAmountMinor" type="number" value="40000" min="0" /></label>
      <label>Financing obligation<input name="financingObligationLender" value="Working capital lender" /></label>
      <label>Financing amount<input name="financingObligationAmountMinor" type="number" value="120000" min="0" /></label>
      <label>Minimum notification severity<select name="minimumSeverity"><option>HIGH</option><option>WARNING</option><option>CRITICAL</option></select></label>
      <label class="checkbox"><input name="inAppEnabled" type="checkbox" checked /> In-app alerts</label>
      <label class="checkbox"><input name="emailEnabled" type="checkbox" checked /> Email notifications</label>
      <button class="button" type="submit">Save Business Profile</button>
    </form>
    <p class="muted">These inputs are stored as USER_DECLARED risk configuration, not ACTUAL financial data.</p>
  `;
}

function riskPreferencesForm(profile) {
  return `
    <form id="risk-preferences-form" class="form-grid">
      <label>Late receivable probability threshold<input name="lateReceivableProbability" type="number" value="0.6" min="0" max="1" step="0.05" required /></label>
      <label>Material amount threshold<input name="materialAmountMinor" type="number" value="${profile?.value?.minimumLiquidityBufferMinor ?? 100000}" min="0" required /></label>
      <label>Fee rate upper bound<input name="feeRateUpperBound" type="number" value="0.08" min="0" max="1" step="0.01" required /></label>
      <label>Customer concentration threshold<input name="concentrationThreshold" type="number" value="0.5" min="0" max="1" step="0.05" required /></label>
      <button class="button" type="submit">Save Risk Preferences</button>
    </form>
    <p class="muted">Risk thresholds use USER_DECLARED provenance and tune alerts only.</p>
  `;
}

function dataConnectionsForm() {
  return `
    <form id="data-connections-form" class="form-grid">
      <label>Razorpay data<select name="razorpay"><option value="NOT_CONNECTED">Not connected</option><option value="CONNECTED">Mock connected</option><option value="SKIPPED">Skip for now</option></select></label>
      <label>Bank cash source<select name="bank"><option value="NOT_CONNECTED">Not connected</option><option value="IMPORTED">CSV imported</option><option value="CONNECTED">Connected</option><option value="SKIPPED">Skip for now</option></select></label>
      <label>Receivables source<select name="receivables"><option value="NOT_CONNECTED">Not connected</option><option value="IMPORTED">CSV imported</option><option value="CONNECTED">Connected</option><option value="SKIPPED">Skip for now</option></select></label>
      <button class="button" type="submit">Save Connections</button>
    </form>
    <div class="split">
      <button class="button secondary" id="sample-bank-import" type="button">Import Sample Bank CSV</button>
      <button class="button secondary" id="sample-invoice-import" type="button">Import Sample Receivables CSV</button>
    </div>
  `;
}

function validationPanel(audit) {
  return `
    <p class="muted">FlowGuard must verify a reliable cash source before any dashboard can display Available Cash.</p>
    ${audit ? readinessTable(audit) : ""}
    <button class="button" id="run-validation" type="button">Run Readiness Audit</button>
  `;
}

function initialCalculationPanel(audit, assessment) {
  return `
    ${audit ? readinessTable(audit) : ""}
    ${assessment ? assessmentPanel(assessment) : "<p class=\"muted\">Ready to calculate the first financial assessment.</p>"}
    <button class="button" id="initial-calculation" type="button">Create First Financial Assessment</button>
  `;
}

function readyPanel(assessment) {
  return `
    ${assessment ? assessmentPanel(assessment) : "<p class=\"muted\">Your organization is ready.</p>"}
    <button class="button" id="go-dashboard" type="button">Open Dashboard</button>
  `;
}

function readinessTable(audit) {
  return table(["Metric", "Status", "Label / Reason"], Object.entries(audit.metricReadiness).map(([metricName, item]) => [metricName, item.status, item.label ?? item.reason]));
}

function assessmentPanel(assessment) {
  const obligations = assessment.upcomingObligations ?? [];
  return `
    <div class="grid">
      ${metric("Current Cash", assessment.availableCash, "Requires reliable bank data")}
      ${metric("Receivables", assessment.receivables, "From imported receivables only")}
      <article class="metric"><span class="label">Active Risks</span><span class="amount">${assessment.activeRisks?.length ?? 0}</span>${badge("PREDICTED")}<p class="muted">From deterministic alert engine</p></article>
      <article class="metric"><span class="label">Obligations</span><span class="amount">${obligations.length}</span>${badge("USER_DECLARED")}<p class="muted">Declared for risk configuration</p></article>
    </div>
  `;
}

function bindOnboarding(stage) {
  document.querySelector("#business-profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/api/onboarding/business-profile", { method: "POST", body: JSON.stringify({
      organizationName: stringField(form, "organizationName"),
      industryType: stringField(form, "industryType"),
      timezone: stringField(form, "timezone"),
      currency: stringField(form, "currency"),
      payrollAmountMinor: intField(form, "payrollAmountMinor"),
      payrollSchedule: stringField(form, "payrollSchedule"),
      minimumLiquidityBufferMinor: intField(form, "minimumLiquidityBufferMinor"),
      receivableTermsDays: intField(form, "receivableTermsDays"),
      recurringObligations: [{ label: stringField(form, "recurringObligationLabel"), amountMinor: intField(form, "recurringObligationAmountMinor"), cadence: "MONTHLY" }],
      financingObligations: [{ lender: stringField(form, "financingObligationLender"), amountMinor: intField(form, "financingObligationAmountMinor"), cadence: "MONTHLY" }],
      notificationPreferences: { inAppEnabled: form.has("inAppEnabled"), emailEnabled: form.has("emailEnabled"), minimumSeverity: stringField(form, "minimumSeverity") },
    }) });
    await loadScreen("onboarding");
  });
  document.querySelector("#risk-preferences-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/api/onboarding/risk-preferences", { method: "POST", body: JSON.stringify({
      lateReceivableProbability: numberField(form, "lateReceivableProbability"),
      materialAmountMinor: intField(form, "materialAmountMinor"),
      feeRateUpperBound: numberField(form, "feeRateUpperBound"),
      concentrationThreshold: numberField(form, "concentrationThreshold"),
    }) });
    await loadScreen("onboarding");
  });
  document.querySelector("#data-connections-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/api/onboarding/data-connections", { method: "POST", body: JSON.stringify({
      razorpay: stringField(form, "razorpay"),
      bank: stringField(form, "bank"),
      receivables: stringField(form, "receivables"),
    }) });
    await loadScreen("onboarding");
  });
  document.querySelector("#sample-bank-import")?.addEventListener("click", async () => {
    await api("/api/ingest/bank-csv", { method: "POST", body: JSON.stringify({ rows: [{ date: "2026-08-23T13:00:00.000Z", description: "Opening bank balance", amountMinor: 900000, type: "CREDIT", reference: "ONBOARDING-BANK-1" }] }) });
    await api("/api/onboarding/data-connections", { method: "POST", body: JSON.stringify({ razorpay: "NOT_CONNECTED", bank: "IMPORTED", receivables: "NOT_CONNECTED" }) });
    await loadScreen("onboarding");
  });
  document.querySelector("#sample-invoice-import")?.addEventListener("click", async () => {
    await api("/api/ingest/invoices", { method: "POST", body: JSON.stringify({ rows: [{ customer: "Onboarding Customer", invoiceAmountMinor: 300000, issueDate: "2026-08-23T00:00:00.000Z", dueDate: "2026-09-22T00:00:00.000Z", status: "OPEN", reference: "ONBOARDING-INV-1" }] }) });
    await loadScreen("onboarding");
  });
  document.querySelector("#run-validation")?.addEventListener("click", async () => {
    await api("/api/onboarding/validate", { method: "POST", body: "{}" });
    await loadScreen("onboarding");
  });
  document.querySelector("#initial-calculation")?.addEventListener("click", async () => {
    await api("/api/onboarding/initial-calculation", { method: "POST", body: "{}" });
    await loadScreen("onboarding");
  });
  document.querySelector("#go-dashboard")?.addEventListener("click", () => loadScreen("overview"));
}

function metric(label, value, note) {
  return `<article class="metric"><span class="label">${escapeHtml(label)}</span><span class="amount ${value.amountMinor < 0 ? "negative" : ""}">${amount(value)}</span>${badge(value.state)}<p class="muted">${escapeHtml(note)}</p></article>`;
}

function amount(value) {
  if (!value || value.value) return escapeHtml(value?.value ?? "Not enough data");
  return moneyMinor(value.amountMinor);
}

function moneyMinor(value) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}₹${(abs / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function badge(label) {
  return `<span class="state state-${String(label).toLowerCase()}">${escapeHtml(String(label))}</span>`;
}

function stringField(form, key) {
  return String(form.get(key) ?? "");
}

function intField(form, key) {
  return Number.parseInt(String(form.get(key) ?? "0"), 10);
}

function numberField(form, key) {
  return Number.parseFloat(String(form.get(key) ?? "0"));
}

function table(headers, rows) {
  if (rows.length === 0) return `<p class="muted">No records available.</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function dataBanner(label) {
  if (label === "DEMO DATA") {
    return `<div class="alert"><strong>${escapeHtml(label)}</strong> · Synthetic records only. No production bank or Razorpay connection is claimed.</div>`;
  }
  return `<div class="alert live"><strong>${escapeHtml(label)}</strong> · Calculated from this organization’s authenticated financial event stream.</div>`;
}

function demoAlert(label) {
  return dataBanner(label);
}

function onboarding(data) {
  return `
    ${dataBanner(data.dataLabel)}
    <section class="panel empty-onboarding">
      <h2>Welcome to FlowGuard.</h2>
      <p class="muted">Connect your financial data to calculate your first cash position.</p>
      <div class="grid">
        <button class="button" type="button">Connect Razorpay</button>
        <button class="button secondary" type="button">Import Bank Data</button>
        <button class="button secondary" type="button">Add Receivables</button>
        <button class="button secondary" type="button">Explore Demo</button>
      </div>
    </section>
  `;
}

function timeline(items) {
  if (!items || items.length === 0) return `<p class="muted">No financial activity yet.</p>`;
  return `<div class="timeline">${items.map((item) => `<div><strong>${escapeHtml(item.kind)}</strong> · ${escapeHtml(item.label)}<br><span class="muted">${escapeHtml(item.timestamp)}</span></div>`).join("")}</div>`;
}

function fresh(value) {
  if (!value || value === "never") return "not connected";
  return value;
}

function errorState(message) {
  return `<section class="panel"><h2>Unable to load this view</h2><p class="muted">${escapeHtml(message)}</p></section>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
