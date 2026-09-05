const $ = (id) => document.getElementById(id);
async function api(path, options) { const response = await fetch(path, { credentials: "same-origin", ...options }); if (!response.ok) throw new Error("Request failed"); return response.json(); }
let webhookUrl = `${location.origin}/webhooks/razorpay`;
async function refreshRazorpayStatus() {
  try {
    const status = await api("/api/razorpay/oauth/status");
    webhookUrl = status.webhookUrl || webhookUrl;
    $("webhook-url").textContent = webhookUrl;
    $("webhook-note").textContent = status.webhookReady
      ? "This endpoint verifies Razorpay signatures before any ledger event is accepted."
      : "Deploy over public HTTPS before Razorpay can deliver webhook events.";
    $("razorpay-connect").disabled = !status.configured;
    $("razorpay-connect").textContent = status.connected ? "Reconnect Razorpay" : "Connect Razorpay";
    $("razorpay-sync").hidden = !status.connected;
    $("razorpay-test-payment").hidden = !status.testModeConfigured;
    if (status.connected) $("razorpay-status").textContent = `Connected${status.accountId ? ` to account ${status.accountId}` : ""}${status.lastSyncedAt ? ` · last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : " · ready to sync"}.`;
    else if (!status.configured) $("razorpay-status").textContent = "Razorpay OAuth will be available after this deployment has its Partner credentials and secure token storage configured.";
    else $("razorpay-status").textContent = "No Razorpay account is connected yet.";
  } catch { $("razorpay-status").textContent = "Unable to read Razorpay connection status."; }
}
$("razorpay-connect").onclick = () => {
  if (!$("razorpay-consent").checked) { $("razorpay-status").textContent = "Confirm consent before connecting Razorpay."; return; }
  location.assign("/api/razorpay/oauth/start");
};
$("razorpay-sync").onclick = async () => {
  $("razorpay-status").textContent = "Syncing Razorpay payments...";
  try { const result = await api("/api/razorpay/oauth/sync", { method: "POST" }); $("razorpay-status").textContent = `${result.ingestedEvents} ledger events imported from ${result.syncedPayments} Razorpay payments.`; }
  catch { $("razorpay-status").textContent = "Sync failed. Reconnect Razorpay or check the server connection status."; }
};
$("razorpay-test-payment").onclick = async () => {
  if (!$("razorpay-consent").checked) { $("razorpay-status").textContent = "Confirm consent before starting a test payment."; return; }
  try {
    $("razorpay-status").textContent = "Creating secure Razorpay test order...";
    const checkout = await api("/api/razorpay/test-checkout", { method: "POST" });
    await loadRazorpayCheckout();
    const payment = new window.Razorpay({
      key: checkout.keyId,
      amount: checkout.amountMinor,
      currency: checkout.currency,
      name: "FlowGuard",
      description: "Webhook verification payment",
      order_id: checkout.orderId,
      notes: { flowguard_organization_id: checkout.organizationId, flowguard_source: "test_checkout" },
      handler: () => { $("razorpay-status").textContent = "Payment completed. Razorpay is delivering the signed webhook now..."; setTimeout(refreshRazorpayStatus, 4_000); },
      modal: { ondismiss: () => { if (!$("razorpay-status").textContent.includes("completed")) $("razorpay-status").textContent = "Test payment was cancelled."; } },
      theme: { color: "#0d9073" },
    });
    payment.open();
  } catch { $("razorpay-status").textContent = "Unable to start the test payment. Confirm Razorpay Test Mode keys are configured in Render."; }
};
$("copy-webhook").onclick = async () => { await navigator.clipboard?.writeText(webhookUrl); $("copy-webhook").textContent = "Copied"; };
refreshRazorpayStatus();

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

const providerDialog = $("provider-dialog");
$("provider-dialog-close").onclick = () => providerDialog.close();
const providers = {
  BANK: ["Setu", "Decentro", "FinBox", "Other approved provider"],
  ACCOUNTING: ["Zoho Books", "QuickBooks Online", "Tally", "Other approved provider"],
};
let selectedKind = "BANK";
document.querySelectorAll(".configure-provider").forEach((button) => {
  button.onclick = () => {
    selectedKind = button.dataset.kind;
    $("provider-kind-label").textContent = selectedKind === "BANK" ? "BANK DATA" : "ACCOUNTING DATA";
    $("provider-title").textContent = selectedKind === "BANK" ? "Configure a bank feed" : "Configure your accounting ledger";
    $("provider-copy").textContent = selectedKind === "BANK" ? "Choose the provider your organization has approved for read-only balance and transaction access." : "Choose the accounting system that should provide invoices and receivables.";
    $("provider-select").innerHTML = providers[selectedKind].map((provider) => `<option value="${provider}">${provider}</option>`).join("");
    providerDialog.showModal();
  };
});
$("provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = $("provider-select").value;
  const status = selectedKind === "BANK" ? $("bank-status") : $("accounting-status");
  try {
    await api("/api/connections/configure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: selectedKind, provider }) });
    status.textContent = `${provider} selected. Secure server configuration is required before live data can sync.`;
    providerDialog.close();
  } catch { status.textContent = "Unable to save this provider selection."; }
});
