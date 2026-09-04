const $ = (id) => document.getElementById(id);
async function api(path, options) { const response = await fetch(path, { credentials: "same-origin", ...options }); if (!response.ok) throw new Error("Request failed"); return response.json(); }
$("razorpay-sync").onclick = async () => {
  if (!$("razorpay-consent").checked) { $("razorpay-status").textContent = "Confirm consent before importing payment data."; return; }
  $("razorpay-status").textContent = "Syncing Razorpay...";
  try { const result = await api("/api/razorpay/direct-sync", { method: "POST" }); $("razorpay-status").textContent = `${result.ingestedEvents} ledger events imported from Razorpay.`; }
  catch { $("razorpay-status").textContent = "Sync unavailable. Confirm the server-side Razorpay configuration."; }
};
const webhookUrl = `${location.origin}/webhooks/razorpay`;
$("webhook-url").textContent = webhookUrl;
$("webhook-note").textContent = location.protocol === "https:" ? "This endpoint verifies Razorpay signatures before any ledger event is accepted." : "A public HTTPS deployment is required before Razorpay can deliver events here.";
$("copy-webhook").onclick = async () => { await navigator.clipboard?.writeText(webhookUrl); $("copy-webhook").textContent = "Copied"; };

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
