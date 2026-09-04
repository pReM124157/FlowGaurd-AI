/**
 * FLOWGUARD ULTRA-KINETIC TIER-0.0001% MOTION ENGINE
 * 60fps Aurora Fluid Field, Multi-Harmonic Neon Oscilloscope,
 * Particle Spark Generators, 3D Magnetic Physics, and Live Interactive Digital Twin.
 */

export function initFullBleedStory() {
  initAuroraFluidCanvas();
  initNeonOscilloscope();
  initCustomMagneticCursor();
  initHeaderObserver();
  initPipelineLaserBeams();
  initCounterAnimations();
  initLiveInteractiveDigitalTwin();
  init3DPerspectiveParallax();
}

/* ── 1. Interactive Aurora Fluid Mesh & Glow Orbs (60fps Canvas) ───────── */
function initAuroraFluidCanvas() {
  let canvas = document.getElementById('bg-kinetic-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'bg-kinetic-canvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:0;';
    document.body.prepend(canvas);
  }
  const ctx = canvas.getContext('2d');
  let w, h;
  let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, tx: window.innerWidth / 2, ty: window.innerHeight / 2 };

  function resize() {
    w = canvas.width = window.innerWidth * window.devicePixelRatio;
    h = canvas.height = window.innerHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  window.addEventListener('mousemove', (e) => {
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
  }, { passive: true });

  // Floating ambient neon light blobs
  const orbs = [
    { x: 0.2, y: 0.3, r: 320, color: 'rgba(18, 120, 91, 0.18)', vx: 0.0008, vy: 0.0006 },
    { x: 0.8, y: 0.25, r: 280, color: 'rgba(38, 194, 150, 0.14)', vx: -0.0007, vy: 0.0009 },
    { x: 0.5, y: 0.7, r: 350, color: 'rgba(200, 134, 18, 0.08)', vx: 0.0005, vy: -0.0007 },
    { x: 0.85, y: 0.8, r: 300, color: 'rgba(217, 56, 41, 0.09)', vx: -0.0009, vy: -0.0005 },
  ];

  // Particle constellation
  const particles = Array.from({ length: 65 }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    size: Math.random() * 2.2 + 0.8,
    pulse: Math.random() * Math.PI * 2,
  }));

  let t = 0;
  function render() {
    t += 0.02;
    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;

    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);

    // Draw ambient glowing orbs
    orbs.forEach(orb => {
      orb.x += orb.vx;
      orb.y += orb.vy;
      if (orb.x < 0.1 || orb.x > 0.9) orb.vx *= -1;
      if (orb.y < 0.1 || orb.y > 0.9) orb.vy *= -1;

      const ox = orb.x * width + Math.sin(t + orb.r) * 40 + (mouse.x - width / 2) * 0.05;
      const oy = orb.y * height + Math.cos(t + orb.r) * 40 + (mouse.y - height / 2) * 0.05;

      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, orb.r);
      grad.addColorStop(0, orb.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, orb.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw subtle grid
    ctx.strokeStyle = 'rgba(18, 120, 91, 0.04)';
    ctx.lineWidth = 1;
    const step = 64;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw kinetic connected particles
    particles.forEach((p, i) => {
      p.pulse += 0.04;
      p.x += p.vx + Math.sin(t + i) * 0.3;
      p.y += p.vy + Math.cos(t + i) * 0.3;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      // Mouse push / pull
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 150) {
        p.x -= (dx / dist) * (150 - dist) * 0.08;
        p.y -= (dy / dist) * (150 - dist) * 0.08;
      }

      const alpha = 0.25 + Math.sin(p.pulse) * 0.2;
      ctx.fillStyle = `rgba(38, 194, 150, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // Lines between close particles
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const pDist = Math.hypot(p2.x - p.x, p2.y - p.y);
        if (pDist < 95) {
          ctx.strokeStyle = `rgba(18, 120, 91, ${(1 - pDist / 95) * 0.12})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    });

    requestAnimationFrame(render);
  }
  render();
}

/* ── 2. Multi-Harmonic Neon Oscilloscope & Sparks (Hero Waveform) ───────── */
function initNeonOscilloscope() {
  const svg = document.getElementById('hero-edge-svg');
  if (!svg) return;

  // Create sparks container inside SVG
  let sparksGroup = document.getElementById('laser-sparks-group');
  if (!sparksGroup) {
    sparksGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    sparksGroup.id = 'laser-sparks-group';
    svg.appendChild(sparksGroup);
  }

  // Laser head
  let laserDot = document.getElementById('laser-head-dot');
  if (!laserDot) {
    laserDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    laserDot.id = 'laser-head-dot';
    laserDot.setAttribute('r', '6');
    laserDot.setAttribute('fill', '#26C296');
    laserDot.setAttribute('filter', 'drop-shadow(0 0 12px #26C296)');
    svg.appendChild(laserDot);
  }

  let laserHalo = document.getElementById('laser-head-halo');
  if (!laserHalo) {
    laserHalo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    laserHalo.id = 'laser-head-halo';
    laserHalo.setAttribute('r', '18');
    laserHalo.setAttribute('fill', 'rgba(38, 194, 150, 0.25)');
    svg.appendChild(laserHalo);
  }

  // Secondary harmonic wave
  let harmonicPath = document.getElementById('hero-harmonic-curve');
  if (!harmonicPath) {
    harmonicPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    harmonicPath.id = 'hero-harmonic-curve';
    harmonicPath.setAttribute('fill', 'none');
    harmonicPath.setAttribute('stroke', 'rgba(38, 194, 150, 0.2)');
    harmonicPath.setAttribute('stroke-width', '2');
    harmonicPath.setAttribute('stroke-dasharray', '4,4');
    svg.insertBefore(harmonicPath, svg.firstChild);
  }

  const sparks = Array.from({ length: 8 }, () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', '2');
    el.setAttribute('fill', '#26C296');
    sparksGroup.appendChild(el);
    return { el, x: 0, y: 0, vx: 0, vy: 0, life: 0 };
  });

  let progress = 0;
  let tickerNum = 2480000;
  const tickerEl = document.querySelector('.ticker-value');

  function updateWave() {
    const w = window.innerWidth;
    const h = 220;
    
    const startY = h * 0.32;
    const p1X = w * 0.25;
    const p1Y = h * 0.28;
    const p2X = w * 0.50;
    const p2Y = h * 0.40;
    const p3X = w * 0.75;
    const p3Y = h * 0.78;
    const p4X = w * 1.05;
    const p4Y = h * 0.86;

    const d = `M 0,${startY} C ${p1X*0.6},${startY} ${p1X*0.8},${p1Y} ${p1X},${p1Y} C ${w*0.38},${p1Y} ${w*0.42},${p2Y} ${p2X},${p2Y} C ${w*0.62},${p2Y} ${w*0.68},${p3Y} ${p3X},${p3Y} C ${w*0.88},${p3Y} ${w*0.95},${p4Y} ${p4X},${p4Y}`;
    const dHarmonic = `M 0,${startY+10} C ${p1X*0.6},${startY-8} ${p1X*0.8},${p1Y+12} ${p1X},${p1Y-6} C ${w*0.38},${p1Y+15} ${w*0.42},${p2Y-10} ${p2X},${p2Y+8} C ${w*0.62},${p2Y-12} ${w*0.68},${p3Y+10} ${p3X},${p3Y-5} C ${w*0.88},${p3Y+12} ${w*0.95},${p4Y-8} ${p4X},${p4Y+5}`;

    const path = document.getElementById('hero-main-curve');
    if (path) path.setAttribute('d', d);
    if (harmonicPath) harmonicPath.setAttribute('d', dHarmonic);

    // Dynamic Event Pills
    positionPill('pill-1', w * 0.20, h * 0.26, 600);
    positionPill('pill-2', w * 0.38, h * 0.38, 1100);
    positionPill('pill-3', w * 0.55, h * 0.50, 1600);
    positionPill('pill-4', w * 0.75, h * 0.76, 2100);
  }

  function positionPill(id, left, top, delay) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    setTimeout(() => el.classList.add('is-active'), delay);
  }

  updateWave();
  window.addEventListener('resize', updateWave, { passive: true });

  // 60fps Laser Animation loop
  function loop() {
    const path = document.getElementById('hero-main-curve');
    if (path) {
      const len = path.getTotalLength();
      progress = (progress + 0.0035) % 1;
      const pt = path.getPointAtLength(progress * len);

      laserDot.setAttribute('cx', pt.x);
      laserDot.setAttribute('cy', pt.y);
      laserHalo.setAttribute('cx', pt.x);
      laserHalo.setAttribute('cy', pt.y);

      const color = progress > 0.65 ? '#D93829' : progress > 0.45 ? '#C88612' : '#26C296';
      laserDot.setAttribute('fill', color);
      laserDot.setAttribute('filter', `drop-shadow(0 0 14px ${color})`);
      laserHalo.setAttribute('fill', color === '#D93829' ? 'rgba(217, 56, 41, 0.25)' : 'rgba(38, 194, 150, 0.25)');

      // Emit sparks
      sparks.forEach(s => {
        if (s.life <= 0) {
          s.x = pt.x;
          s.y = pt.y;
          s.vx = (Math.random() - 0.5) * 4;
          s.vy = (Math.random() - 0.5) * 4;
          s.life = 1;
          s.el.setAttribute('fill', color);
        } else {
          s.x += s.vx;
          s.y += s.vy;
          s.life -= 0.05;
          s.el.setAttribute('cx', s.x);
          s.el.setAttribute('cy', s.y);
          s.el.setAttribute('opacity', s.life);
        }
      });
    }

    // Micro live ticker fluctuation
    if (Math.random() < 0.03 && tickerEl) {
      tickerNum += (Math.random() - 0.48) * 120;
      tickerEl.textContent = `₹${(tickerNum / 100000).toFixed(2)}L ACTIVE`;
    }

    requestAnimationFrame(loop);
  }
  loop();
}

/* ── 3. Custom Magnetic Cursor Light ────────────────────────────────────── */
function initCustomMagneticCursor() {
  let light = document.getElementById('fg-magnetic-spotlight');
  if (!light) {
    light = document.createElement('div');
    light.id = 'fg-magnetic-spotlight';
    light.style.cssText = `
      position: fixed;
      width: 450px;
      height: 450px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(38, 194, 150, 0.08) 0%, rgba(38, 194, 150, 0) 70%);
      pointer-events: none;
      z-index: 1;
      transform: translate(-50%, -50%);
      transition: opacity 300ms ease;
    `;
    document.body.appendChild(light);
  }

  let lx = window.innerWidth / 2, ly = window.innerHeight / 2;
  window.addEventListener('mousemove', (e) => {
    lx += (e.clientX - lx) * 0.15;
    ly += (e.clientY - ly) * 0.15;
    light.style.left = `${e.clientX}px`;
    light.style.top = `${e.clientY}px`;
  }, { passive: true });
}

/* ── 4. 3D Perspective Tilt Physics ────────────────────────────────────── */
function init3DPerspectiveParallax() {
  const cards = document.querySelectorAll('.pipeline-card-node, .stream-box, .forecast-interactive-board, .plan-column-box, .xray-stream-cell, .full-product-mock-frame, .mock-kpi-card');

  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      
      const rx = ((y - cy) / cy) * -8;
      const ry = ((x - cx) / cx) * 8;

      card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(8px)`;
      card.style.boxShadow = `0 24px 64px rgba(0,0,0,0.12), 0 0 0 1px rgba(38, 194, 150, 0.25)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0)';
      card.style.boxShadow = '';
    });
  });
}

/* ── 5. Glowing Sequential Pipeline Wave ───────────────────────────────── */
function initPipelineLaserBeams() {
  const nodes = document.querySelectorAll('.pipeline-card-node');
  if (!nodes.length) return;

  let current = 0;
  setInterval(() => {
    nodes.forEach((n, i) => {
      if (i === current) {
        n.classList.add('is-pulsing-flow');
      } else {
        n.classList.remove('is-pulsing-flow');
      }
    });
    current = (current + 1) % nodes.length;
  }, 750);
}

/* ── 6. Spring Number Counters on Intersection ──────────────────────────── */
function initCounterAnimations() {
  const elements = [
    { id: 'rev-split-title', target: 42.7, prefix: '₹', suffix: 'L', decimals: 1 },
    { id: 'xray-num-target', target: 27.04, prefix: '₹', suffix: 'L', decimals: 2 }
  ];

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const item = elements.find(c => c.id === entry.target.id);
        if (item) animateNumber(entry.target, item.target, item.prefix, item.suffix, item.decimals);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  elements.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) obs.observe(el);
  });
}

function animateNumber(element, target, prefix = '', suffix = '', decimals = 1) {
  let start = 0;
  const duration = 1500;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Spring cubic ease out
    const ease = 1 - Math.pow(1 - progress, 4);
    const current = (start + (target - start) * ease).toFixed(decimals);
    element.textContent = `${prefix}${current}${suffix}`;

    if (progress < 1) requestAnimationFrame(update);
    else element.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`;
  }
  requestAnimationFrame(update);
}

/* ── 7. Interactive Live Financial Digital Twin Sandbox ─────────────────── */
function initLiveInteractiveDigitalTwin() {
  const cashNum = document.getElementById('sim-cash-num');
  const alertStatus = document.getElementById('sim-alert-status');
  const addSettlementBtn = document.getElementById('btn-sim-settlement');
  const triggerExpenseBtn = document.getElementById('btn-sim-expense');
  let currentCash = 8.24;

  if (addSettlementBtn && cashNum) {
    addSettlementBtn.addEventListener('click', () => {
      currentCash += 2.0;
      cashNum.style.transform = 'scale(1.2) translateY(-4px)';
      cashNum.style.color = '#26C296';
      cashNum.textContent = `₹${currentCash.toFixed(2)}L`;
      
      if (alertStatus) {
        alertStatus.textContent = 'PROJECTION SOLVENT · +₹2.0L SETTLED';
        alertStatus.style.color = '#26C296';
      }

      createRippleBurst(addSettlementBtn);
      setTimeout(() => { cashNum.style.transform = 'scale(1)'; }, 350);
    });
  }

  if (triggerExpenseBtn && cashNum) {
    triggerExpenseBtn.addEventListener('click', () => {
      currentCash = Math.max(currentCash - 1.5, 0.5);
      cashNum.style.transform = 'scale(0.88) translateY(4px)';
      cashNum.style.color = '#FF5442';
      cashNum.textContent = `₹${currentCash.toFixed(2)}L`;

      if (alertStatus) {
        alertStatus.textContent = 'DEFICIT WARNING: BUFFER TIGHT';
        alertStatus.style.color = '#FF5442';
      }

      createRippleBurst(triggerExpenseBtn);
      setTimeout(() => { cashNum.style.transform = 'scale(1)'; }, 350);
    });
  }
}

function createRippleBurst(btn) {
  const ripple = document.createElement('span');
  ripple.style.cssText = `
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: 2px solid rgba(38, 194, 150, 0.8);
    pointer-events: none;
    animation: rippleRing 600ms ease-out forwards;
  `;
  btn.style.position = 'relative';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
}

/* ── 8. Header Dark/Light Switch ────────────────────────────────────────── */
function initHeaderObserver() {
  const header = document.querySelector('.fg-header');
  if (!header) return;

  const darkSections = document.querySelectorAll('.dark-stage, #revenue-split-stage, #plan-stage, #live-product-stage, #philosophy-monument-stage, #final-hero-stage');
  
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    header.classList.toggle('is-scrolled', scrollY > 30);

    let isOverDark = false;
    darkSections.forEach(sec => {
      const rect = sec.getBoundingClientRect();
      if (rect.top <= 60 && rect.bottom >= 60) {
        isOverDark = true;
      }
    });
    header.classList.toggle('is-dark', isOverDark);
  }, { passive: true });
}
