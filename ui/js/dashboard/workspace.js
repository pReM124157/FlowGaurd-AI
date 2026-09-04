const page = document.body.dataset.page;

const config = {
  cash: { index: '02', title: 'Cash, without guesswork.', lede: 'See the cash position your evidence supports. Declared context stays visible until a bank source verifies it.', view: 'Your cash evidence, in one place.', labels: ['Available cash', 'Pending settlements', 'Liquidity buffer'] },
  forecast: { index: '03', title: 'The next 90 days, made legible.', lede: 'Your declared obligations create the starting view. Verified sources progressively sharpen the financial picture.', view: 'Forecast confidence starts with traceable inputs.', labels: ['30-day position', 'Low-cash date', 'Confidence range'] },
  receivables: { index: '04', title: 'Know what should arrive next.', lede: 'Bring invoices and payment history together to see receivables as evidence, not optimism.', view: 'Collections need a reliable source.', labels: ['Outstanding', 'Overdue', 'Collections priority'] },
  reconciliation: { index: '05', title: 'Every rupee should have a reason.', lede: 'Trace the path from payment to fee, tax, settlement, and credit with a clear evidence trail.', view: 'Reconciliation begins when two sources meet.', labels: ['Settlement health', 'Matched value', 'Unmatched value'] },
  scenarios: { index: '06', title: 'Test the move before you make it.', lede: 'Run deterministic scenarios on your model. Simulations remain separate from live financial state.', view: 'A scenario needs a verified baseline.', labels: ['Baseline', 'Scenario impact', 'Recommended response'] },
  connections: { index: '07', title: 'Connect what you trust.', lede: 'Each source earns its place in the picture. FlowGuard keeps declared context separate as live evidence arrives.', view: 'Build a source trail that stays auditable.', labels: ['Bank accounts', 'Payment sources', 'Receivables systems'] },
  risks: { index: '08', title: 'Risk deserves evidence.', lede: 'FlowGuard surfaces material risk only when deterministic inputs support it. Missing data remains visible as missing.', view: 'No verified risk is waiting right now.', labels: ['Open risks', 'Exposure', 'Next review'] },
  ask: { index: '09', title: 'Ask what the evidence can answer.', lede: 'FlowGuard grounds each response in the financial sources available to your organization.', view: 'A better question starts with better evidence.', labels: ['Suggested questions', 'Evidence', 'Freshness'] },
};

const esc = (value) => String(value).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
const money = (value) => Number.isSafeInteger(value)
  ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100)
  : 'Not enough data';

async function get(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) throw new Error('Request unavailable');
  return response.json();
}

function navigation() {
  const links = ['cash', 'forecast', 'receivables', 'reconciliation', 'scenarios', 'connections', 'risks', 'ask'];
  return `<nav class="workspace-nav" aria-label="Financial workspace"><a href="dashboard.html">Overview</a>${links.map((key) => `<a class="${key === page ? 'active' : ''}" href="${key === 'ask' ? 'ask-flowguard' : key}.html">${key === 'ask' ? 'Ask FlowGuard' : key[0].toUpperCase() + key.slice(1)}</a>`).join('')}</nav>`;
}

function rail() {
  const primary = ['cash', 'forecast', 'receivables', 'reconciliation', 'scenarios', 'connections'];
  const intelligence = ['risks', 'ask'];
  const label = (key) => key === 'ask' ? 'Ask FlowGuard' : key[0].toUpperCase() + key.slice(1);
  const href = (key) => `${key === 'ask' ? 'ask-flowguard' : key}.html`;
  const link = (key) => `<a class="${key === page ? 'active' : ''}" href="${href(key)}">${label(key)}</a>`;
  document.body.insertAdjacentHTML('afterbegin', `<aside class="workspace-rail" aria-label="Product navigation">
    <a class="workspace-brand" href="dashboard.html"><span class="workspace-brand-mark">FG</span>FlowGuard</a>
    <nav><p>CONTROL CENTER</p><a href="dashboard.html">Overview</a>${primary.map(link).join('')}<p>INTELLIGENCE</p>${intelligence.map(link).join('')}</nav>
    <button class="workspace-account" id="workspace-logout"><span id="workspace-account-initial">F</span><b id="workspace-account-name">FlowGuard</b><small id="workspace-account-meta">OWNER · Sign out</small></button>
  </aside>`);
}

function shell(current) {
  const container = document.getElementById('workspace');
  container.innerHTML = `${navigation()}<section class="workspace">
    <div class="workspace-intro">
      <div>
        <p class="workspace-index">FLOWGUARD / ${current.index} / ${page.toUpperCase()}</p>
        <h1>${current.title}</h1>
        <p class="lede">${current.lede}</p>
      </div>
      <div class="workspace-orbit" aria-hidden="true">
        <span></span><span></span><span></span>
        <p class="orbit-label">EVIDENCE SEQUENCE</p><strong>${current.index}</strong>
        <div class="orbit-caption"><span>CONTEXT</span><span>SOURCES</span><span>ANSWER</span></div>
      </div>
    </div>
    <div class="workspace-grid">
      <article class="workspace-panel">
        <p class="section-kicker">OPERATING VIEW</p>
        <h2 id="view-title">${current.view}</h2>
        <div id="rows"></div>
        <div class="signal-rack" aria-label="Evidence sequence"><div><i></i><span>Declared operating context</span><small>AVAILABLE</small></div><div><i></i><span>Verified financial sources</span><small>AWAITING</small></div><div><i></i><span>Authoritative assessment</span><small>BUILDING</small></div></div>
        ${page === 'connections' ? '<button class="source-cta" type="button" id="razorpay-sync">Sync Razorpay Test Mode</button><p id="razorpay-sync-status">Your Razorpay credentials remain on the FlowGuard server.</p>' : ''}
        <a class="source-cta" href="connections.html">Connect a verified source</a>
      </article>
      <aside class="workspace-panel">
        <p class="section-kicker">ASK FLOWGUARD</p>
        <h2>Ask about what is real.</h2>
        <p class="lede">Answers name their evidence. When the evidence is missing, FlowGuard says so plainly.</p>
        <form id="question" class="workspace-form"><input maxlength="500" placeholder="Ask about ${page}..." aria-label="Ask FlowGuard"/><button>Ask</button></form>
        <div class="response" id="response">No fabricated figures. Connect the required source to ground an answer.</div>
      </aside>
    </div>
  </section>`;
}

function row(label, metric) {
  const state = metric?.state || 'NOT ENOUGH DATA';
  const value = metric?.days !== undefined ? `${metric.days} days` : money(metric?.amountMinor);
  return `<div class="data-row"><div><b>${esc(label)}</b><small>${esc(metric?.note || 'A verified financial source is required for this view.')}</small></div><div><b>${value}</b><small class="state">${esc(state)}</small></div></div>`;
}

async function hydrate() {
  const current = config[page] || config.cash;
  rail();
  shell(current);
  const rows = document.getElementById('rows');
  try {
    const me = await get('/api/me');
    const name = me.user.displayName || me.user.email.split('@')[0];
    document.getElementById('workspace-account-name').textContent = name;
    document.getElementById('workspace-account-initial').textContent = name[0].toUpperCase();
    document.getElementById('workspace-account-meta').textContent = `${me.user.role || 'OWNER'} · ${me.organization?.name || 'FlowGuard'} · Sign out`;
    const overview = await get('/api/overview');
    const metrics = overview.metrics || {};
    const values = [metrics.availableCash, metrics.forecast30Day || metrics.obligations30Day, metrics.cashRunway || metrics.liquidityBuffer];
    rows.innerHTML = current.labels.map((label, index) => row(label, values[index])).join('');
  } catch {
    rows.innerHTML = current.labels.map((label) => row(label, null)).join('');
  }

  document.getElementById('question').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('input');
    const question = input.value.trim();
    if (!question) return;
    const output = document.getElementById('response');
    output.textContent = 'Checking the available evidence...';
    try {
      const result = await get('/api/controller/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      const insight = result.insight || {};
      const answer = insight.answer || result.answer || 'Not enough data to answer that reliably.';
      const evidence = insight.evidence || result.toolCalls || [];
      output.textContent = `${answer}${evidence.length ? `\n\nEvidence: ${evidence.join(' · ')}` : ''}`;
    } catch {
      output.textContent = 'Not enough verified financial data is available to answer that reliably.';
    }
  });
  document.getElementById('razorpay-sync')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = document.getElementById('razorpay-sync-status');
    button.disabled = true;
    status.textContent = 'Synchronizing captured Razorpay Test Mode payments…';
    try {
      const result = await get('/api/razorpay/direct-sync', { method: 'POST' });
      status.textContent = `${result.syncedPayments} Razorpay payment record(s) checked; ${result.ingestedEvents} ledger event(s) ingested.`;
      const overview = await get('/api/overview');
      const values = [overview.metrics?.availableCash, overview.metrics?.forecast30Day || overview.metrics?.obligations30Day, overview.metrics?.cashRunway || overview.metrics?.liquidityBuffer];
      rows.innerHTML = current.labels.map((label, index) => row(label, values[index])).join('');
    } catch {
      status.textContent = 'Razorpay sync was unavailable. Confirm Test Mode credentials and try again.';
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('workspace-logout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.assign('/');
  });
}

hydrate();
