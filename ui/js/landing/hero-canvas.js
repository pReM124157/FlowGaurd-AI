/**
 * FlowGuard Hero Canvas — Live Financial Simulation
 * Cinematic sequence: Cash events → Curve → Risk forming → FlowGuard catches it
 */

import { formatINR, flashCashEvent } from '../motion/number.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initHeroCanvas(canvasId, footerIds = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Resize canvas to container
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * devicePixelRatio;
    canvas.height = (prefersReducedMotion ? 200 : 300) * devicePixelRatio;
    canvas.style.width  = rect.width + 'px';
    canvas.style.height = (prefersReducedMotion ? 200 : 300) + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  resize();
  window.addEventListener('resize', resize);

  // ── State ──────────────────────────────────────────────────────
  const W = () => canvas.width / devicePixelRatio;
  const H = () => canvas.height / devicePixelRatio;

  let cashBalance = 2480000; // ₹24.8L
  const events = [
    { amount:  180000, label: 'Settlement',  delay: 1200 },
    { amount: -320000, label: 'Payroll',     delay: 2800 },
    { amount:  460000, label: 'Receivable',  delay: 4200 },
    { amount:  -72000, label: 'Refunds',     delay: 5600 },
    { amount: -380000, label: 'Vendor Pay',  delay: 7000 },
  ];

  // 30-day projection data points (indices 0–29, index 14 = risk day)
  const projPoints = [];
  let currentBalance = cashBalance;
  for (let i = 0; i < 30; i++) {
    const trend = i < 14 ? -18000 : -38000; // steeper decline after day 14
    currentBalance += trend + (Math.random() - 0.5) * 20000;
    projPoints.push(Math.max(currentBalance, 0));
  }

  const RISK_THRESHOLD = 300000; // ₹3L buffer
  let phase  = 0; // 0=idle, 1=events, 2=curve, 3=risk, 4=catch
  let phaseT = 0;
  let eventsShown = 0;
  let displayBalance = cashBalance;
  let curveProgress = 0;
  let riskAlpha = 0;
  let catchAlpha = 0;
  let lastTime = 0;

  // Colors
  const C = {
    bg:         '#FFFFFF',
    grid:       'rgba(15,14,12,0.04)',
    axis:       'rgba(15,14,12,0.08)',
    curveSafe:  '#1A6B5A',
    curveRisk:  '#C0392B',
    threshold:  'rgba(192,57,43,0.2)',
    threshLine: 'rgba(192,57,43,0.35)',
    label:      'rgba(15,14,12,0.4)',
    ink:        '#0F0E0C',
    balText:    '#0F0E0C',
  };

  function drawGrid() {
    const w = W(), h = H();
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let y = 0; y < 5; y++) {
      const yy = (h * 0.15) + (h * 0.7) * (y / 4);
      ctx.beginPath();
      ctx.moveTo(48, yy);
      ctx.lineTo(w - 16, yy);
      ctx.stroke();
    }
  }

  function mapY(value, w, h) {
    const maxVal = cashBalance * 1.1;
    const minVal = -50000;
    const range  = maxVal - minVal;
    const yTop   = h * 0.12;
    const yBot   = h * 0.85;
    return yTop + ((maxVal - value) / range) * (yBot - yTop);
  }

  function drawCurve(progress) {
    const w = W(), h = H();
    const count = Math.ceil(progress * projPoints.length);
    if (count < 2) return;

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = 48 + ((w - 64) * i) / (projPoints.length - 1);
      const y = mapY(projPoints[i], w, h);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    // Gradient stroke: green → red based on threshold crossing
    const riskDay = projPoints.findIndex(v => v < RISK_THRESHOLD);
    const riskX = riskDay > 0 ? 48 + ((w - 64) * riskDay) / (projPoints.length - 1) : w;
    const grad = ctx.createLinearGradient(48, 0, Math.min(riskX, w - 64), 0);
    grad.addColorStop(0, C.curveSafe);
    grad.addColorStop(1, progress > 0.5 && riskDay > 0 ? C.curveRisk : C.curveSafe);

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawThreshold() {
    const w = W(), h = H();
    const ty = mapY(RISK_THRESHOLD, w, h);
    ctx.save();
    ctx.strokeStyle = C.threshLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(48, ty);
    ctx.lineTo(w - 16, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = C.label;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('Liquidity buffer', 52, ty - 5);
    ctx.restore();
  }

  function drawRiskZone(alpha) {
    if (alpha <= 0) return;
    const w = W(), h = H();
    const riskDay = projPoints.findIndex(v => v < RISK_THRESHOLD);
    if (riskDay < 0) return;
    const rx = 48 + ((w - 64) * riskDay) / (projPoints.length - 1);
    const ty = mapY(RISK_THRESHOLD, w, h);

    ctx.save();
    ctx.globalAlpha = alpha * 0.15;
    ctx.fillStyle = C.curveRisk;
    ctx.fillRect(rx, ty, w - rx - 16, h * 0.85 - ty);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawCatchLabel(alpha) {
    if (alpha <= 0) return;
    const w = W(), h = H();
    const riskDay = projPoints.findIndex(v => v < RISK_THRESHOLD);
    if (riskDay < 0) return;
    const rx = 48 + ((w - 64) * riskDay) / (projPoints.length - 1);
    const ry = mapY(projPoints[riskDay], w, h);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Dot
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.curveRisk;
    ctx.fill();

    // Label box
    const bx = rx - 60, by = ry - 56;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 12;
    roundRect(ctx, bx, by, 130, 46, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(192,57,43,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = C.curveRisk;
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillText('FlowGuard detected', bx + 10, by + 14);
    ctx.fillStyle = '#0F0E0C';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillText('₹3.1L shortfall · Sep 14', bx + 10, by + 32);

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawBalance() {
    const w = W(), h = H();
    ctx.fillStyle = C.balText;
    ctx.font = '700 22px Inter, sans-serif';
    ctx.fillText(formatINR(displayBalance), 48, 38);
    ctx.fillStyle = C.label;
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillText('Available Cash', 48, 54);
  }

  function draw(timestamp) {
    const dt = Math.min(timestamp - lastTime, 50);
    lastTime = timestamp;
    const w = W(), h = H();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    drawGrid();

    if (phase >= 1) {
      // Show events flash
      if (eventsShown < events.length && timestamp > events[eventsShown]?.delay) {
        const ev = events[eventsShown];
        displayBalance += ev.amount;
        const wrap = canvas.parentElement.parentElement;
        flashCashEvent(wrap, ev.amount, ev.label);
        eventsShown++;

        // Update footer
        const balEl = document.getElementById(footerIds.balance);
        if (balEl) balEl.textContent = formatINR(displayBalance);
      }
    }

    if (phase >= 2) {
      curveProgress = Math.min(curveProgress + 0.004, 1);
      drawThreshold();
      drawCurve(curveProgress);
    }

    if (phase >= 3) {
      riskAlpha = Math.min(riskAlpha + 0.02, 1);
      drawRiskZone(riskAlpha);
    }

    if (phase >= 4) {
      catchAlpha = Math.min(catchAlpha + 0.025, 1);
      drawCatchLabel(catchAlpha);
    }

    drawBalance();
    requestAnimationFrame(draw);
  }

  if (prefersReducedMotion) {
    // Static snapshot
    curveProgress = 1; riskAlpha = 1; catchAlpha = 1; phase = 4;
    drawGrid(); drawThreshold(); drawCurve(1); drawRiskZone(1); drawCatchLabel(1); drawBalance();
    return;
  }

  // Phase timeline
  setTimeout(() => { phase = 1; }, 400);
  setTimeout(() => { phase = 2; }, 2500);
  setTimeout(() => { phase = 3; }, 5000);
  setTimeout(() => { phase = 4; }, 7500);

  lastTime = performance.now();
  requestAnimationFrame(draw);
}
