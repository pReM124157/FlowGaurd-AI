/* Dependency-free scroll timelines: every state is calculated from scroll, so reverse scroll reverses the film. */
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const between = (n, a, b) => clamp((n - a) / (b - a));
const smooth = n => n * n * (3 - 2 * n);
const lerp = (a, b, n) => a + (b - a) * n;
const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function initCinematicOrchestrator() { new LandingFilm().init(); }

class LandingFilm {
  constructor() { this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; this.w = innerWidth; this.h = innerHeight; this.y = scrollY; }
  init() {
    const $ = id => document.getElementById(id);
    this.e = { header: document.querySelector('.fg-header'), track: $('reconciliation-film-track'), title: $('recon-hero-title'), rail: $('recon-rail-group'), packet: $('recon-money-packet'), amount: $('recon-main-amount-val'), status: $('recon-status-subtitle'), fee: $('recon-fee-fragment'), tax: $('recon-tax-fragment'), mismatch: $('recon-mismatch-climax'), mismatchVal: $('recon-mismatch-val'), finalState: $('recon-final-state'), resolution: $('recon-resolution'), scan: $('recon-scan-laser'), radar: $('recon-radar'), broken: $('recon-broken-segment'), lineage: $('recon-lineage-tree'), final: $('recon-final-copy'), expected: $('recon-expected-path'), actual: $('recon-actual-path'), hero: $('hero-stage'), heroCurve: $('hero-main-curve'), revenue: $('revenue-split-stage'), revenueValue: $('giant-rev-num'), forecast: $('forecast-curve-stage'), forecastCurve: $('forecast-live-curve'), forecastActual: $('forecast-actual-curve'), forecastArea: $('forecast-area'), forecastTag: document.querySelector('.forecast-risk-tag'), marker: $('risk-marker-sep14'), planTrack: $('plan-film-track'), plan: $('plan-stage'), product: $('live-product-stage'), philosophy: $('philosophy-monument-stage'), finalStage: $('final-hero-stage') };
    this.addHeroDot(); this.bindHeroPresence();
    [this.e.expected, this.e.actual, this.e.forecastCurve, this.e.forecastActual].forEach(path => { if (path?.getTotalLength) { path.dataset.length = path.getTotalLength(); path.style.strokeDasharray = path.dataset.length; } });
    addEventListener('scroll', () => { this.y = scrollY; this.render(); }, { passive: true });
    addEventListener('resize', () => { this.w = innerWidth; this.h = innerHeight; this.render(); }, { passive: true });
    this.bindSandbox(); document.documentElement.classList.toggle('reduced-motion', this.reduced); this.render();
  }
  bindHeroPresence() {
    const hero = this.e.hero;
    if (!hero) return;
    requestAnimationFrame(() => document.documentElement.classList.add('hero-motion-ready'));
    const cursor = { x: 0, y: 0 };
    hero.addEventListener('pointermove', event => {
      if (this.reduced || innerWidth < 760) return;
      const rect = hero.getBoundingClientRect();
      cursor.x = ((event.clientX - rect.left) / rect.width - .5) * 2;
      cursor.y = ((event.clientY - rect.top) / rect.height - .5) * 2;
      hero.style.setProperty('--hero-pointer-x', cursor.x.toFixed(3));
      hero.style.setProperty('--hero-pointer-y', cursor.y.toFixed(3));
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--hero-pointer-x', '0');
      hero.style.setProperty('--hero-pointer-y', '0');
    });
  }
  addHeroDot() { const svg = document.getElementById('hero-edge-svg'); if (!svg) return; const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '6'); dot.setAttribute('fill', '#26C296'); dot.setAttribute('filter', 'drop-shadow(0 0 10px #26C296)'); svg.append(dot); this.e.heroDot = dot; }
  bindSandbox() { let cash = 8.24; const set = (d, message, color) => { cash = Math.max(0, cash + d); const value = document.getElementById('prod-live-cash-val'); const pill = document.getElementById('prod-live-status-pill'); if (value) value.textContent = `₹${cash.toFixed(2)}L`; if (pill) { pill.textContent = message; pill.style.color = color; } }; document.getElementById('prod-live-settle-btn')?.addEventListener('click', () => set(2, 'DEFICIT RESOLVED · PROJECTION SOLVENT', '#26C296')); document.getElementById('prod-live-expense-btn')?.addEventListener('click', () => set(-1.5, 'CRITICAL DEFICIT · BUFFER TIGHT', '#FF5442')); }
  section(section, travel = 1) { if (!section) return 0; const r = section.getBoundingClientRect(); return clamp((-r.top + this.h * .72) / (r.height + this.h * travel)); }
  render() { this.header(); if (this.reduced) return this.staticFallback(); this.hero(); this.reconciliation(); this.revenue(); this.forecast(); this.plan(); this.product(); this.closing(); }
  header() { const h = this.e.header; if (!h) return; h.classList.toggle('is-scrolled', this.y > 30); h.classList.toggle('is-dark', [...document.querySelectorAll('.dark-stage,.dark-stage-2,#reconciliation-film-track')].some(s => { const r = s.getBoundingClientRect(); return r.top <= 64 && r.bottom >= 64; })); }
  hero() { const p = this.section(this.e.hero, .25), curve = this.e.heroCurve, dot = this.e.heroDot; if (curve && dot) { const point = curve.getPointAtLength(curve.getTotalLength() * clamp(p * 1.25)); const color = p > .64 ? '#D93829' : p > .42 ? '#C88612' : '#26C296'; dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y); dot.setAttribute('fill', color); } document.querySelectorAll('.graph-event-pill').forEach((x, i) => { const q = smooth(between(p, i * .1, .38 + i * .1)); x.style.opacity = q; x.style.transform = `translate3d(0,${lerp(28, -8, q)}px,0) scale(${lerp(.88, 1, q)})`; }); }
  point(t) { const u = 1 - clamp(t), x0 = this.w * .12, x1 = this.w * .3, x2 = this.w * .7, x3 = this.w * .88, y0 = 130, y1 = 65, y2 = 195, y3 = 130; return { x: u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3, y: u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3 }; }
  place(t, scale = 1) { const p = this.point(t), el = this.e.packet; if (el) el.style.transform = `translate3d(${p.x}px,calc(45vh + ${p.y - 130}px),0) translate(-50%,-50%) scale(${scale})`; }
  reconciliation() {
    const total = Math.max(1, this.e.track.offsetHeight - this.h);
    const rawProgress = (this.y - this.e.track.offsetTop) / total;
    const p = clamp(rawProgress), opening = smooth(between(p, 0, .1)), reveal = smooth(between(p, .04, .16)), travel = between(p, .10, .72), branch = smooth(between(p, .66, .74)), mismatchIn = smooth(between(p, .85, .93)), diagnose = smooth(between(p, .96, .97)), exit = smooth(between(p, .99, 1)), e = this.e;
    /* Native document scroll supplies the timeline distance; this class pins
       only the visible stage, and naturally works in reverse as raw progress
       returns from 1 to 0. */
    e.track.classList.toggle('is-native-pinned', rawProgress >= 0 && rawProgress < 1);
    e.track.classList.toggle('is-complete', rawProgress >= 1);
    /* Keep the opening on its optical centre. The handoff is a calm crossfade,
       never a title that flies into the navigation or leaves a blank stage. */
    const titleOut = smooth(between(p, .08, .20));
    e.title.style.opacity = 1 - titleOut; e.title.style.transform = `scale(${lerp(1.025,.96,titleOut)})`; e.title.style.filter = 'none'; e.title.style.clipPath = 'none';
    const money = e.title.querySelector('.recon-title-money'), move = e.title.querySelector('.recon-title-move'), step = e.title.querySelector('.recon-title-step'), moveIn = smooth(between(p,.08,.2)), stepIn = smooth(between(p,.16,.28));
    /* Never enter the pinned scene with no readable visual anchor. */
    if (money) { money.style.opacity = '1'; money.style.transform = 'none'; }
    if (move) { move.style.opacity = '1'; move.style.transform = 'none'; move.style.clipPath = 'none'; }
    if (step) { step.style.opacity = '1'; step.style.clipPath = 'none'; step.style.backgroundPosition = `${lerp(100,0,stepIn)}% 50%`; }
    /* The route exits before the mismatch arrives. These deliberate windows
       prevent a screenshot from ever containing every state at once. */
    const isolate = smooth(between(p, .74, .85));
    /* Hold the completed ₹600 reveal for a full deliberate scroll beat. */
    const mismatchOut = smooth(between(p, .96, .97));
    const clean = smooth(between(p, .96, .97));
    /* The conclusion has a dedicated final scroll beat: it enters quickly,
       then remains fully opaque for the remaining 8.5% of the timeline. */
    const resolutionIn = smooth(between(p, .97, .985));
    e.rail.style.opacity = Math.max(.24, reveal) * (1 - isolate) * (1 - exit); e.rail.style.transform = `translateY(calc(-50% + ${lerp(18,64,exit)}px))`; e.packet.style.opacity = Math.max(.12, reveal) * (1 - smooth(between(p,.70,.76))); this.place(travel, lerp(.9,1,reveal));
    let value = 50000, text = 'CUSTOMER PAYMENT · CAPTURED', color = '#fff'; if (p >= .4 && p < .51) { value = lerp(50000,49000,smooth(between(p,.4,.51))); text = 'RAZORPAY · FEE APPLIED'; } else if (p >= .51 && p < .61) { value = lerp(49000,48820,smooth(between(p,.51,.61))); text = 'TAX WITHHOLDING · APPLIED'; } else if (p >= .61 && p < .72) { value = 48820; text = 'EXPECTED SETTLEMENT · VERIFIED'; color = '#26C296'; } else if (p >= .72) { value = 48220; text = 'ACTUAL BANK CREDIT · RECEIVED'; color = '#FF5442'; } e.amount.textContent = inr(value); e.amount.style.color = color; e.status.textContent = text;
    this.fragment(e.fee,.39,between(p,.4,.54),'−₹1,000','GATEWAY FEE · 2%'); this.fragment(e.tax,.54,between(p,.51,.64),'−₹180','TAX WITHHOLDING'); e.fee.style.opacity = Number(e.fee.style.opacity) * (1 - isolate); e.tax.style.opacity = Number(e.tax.style.opacity) * (1 - isolate);
    document.querySelectorAll('.recon-trail').forEach((path, i) => { path.style.strokeDashoffset = String((p * 420 + i * 90) % 360); });
    [e.expected,e.actual].forEach(path => { if (path) { path.style.opacity = branch * (1 - isolate); path.style.strokeDashoffset = path.dataset.length * (1 - branch); } });
    e.mismatch.style.opacity = mismatchIn * (1 - mismatchOut); e.mismatch.style.transform = `scale(${lerp(.82,1,mismatchIn)})`; e.mismatchVal.textContent = inr(600 * mismatchIn);
    e.scan.style.opacity = diagnose * (1 - resolutionIn); e.scan.style.transform = `translateX(${lerp(-100,0,diagnose)}%)`; e.radar.style.opacity = diagnose * (1 - resolutionIn); e.radar.style.transform = `scale(${lerp(.35,.76,diagnose)})`;
    e.broken.style.opacity = diagnose * (1 - clean); e.broken.style.transform = `translate(-50%,${lerp(18,0,diagnose)}px)`; e.lineage.style.opacity = diagnose * (1 - clean); e.lineage.style.transform = `translateY(${lerp(34,0,diagnose)}px)`;
    e.finalState.style.opacity = '0'; e.resolution.style.opacity = resolutionIn; e.resolution.style.transform = `translateY(${lerp(22,0,resolutionIn)}px)`; e.final.style.opacity = '0';
  }
  fragment(el, x, p, value, label) { if (!el) return; p = smooth(p); el.style.opacity = p; el.style.transform = `translate3d(${this.w * x}px,calc(45vh + ${lerp(-14,72,p)}px),0) translate(-50%,-50%)`; el.querySelector('.fragment-val').textContent = value; el.querySelector('.fragment-label').textContent = label; }
  revenue() { const p = this.section(this.e.revenue,.15), q = smooth(between(p,.12,.58)); this.e.revenueValue.textContent = `₹${lerp(0,42.7,q).toFixed(1)}L`; document.querySelectorAll('.stream-box').forEach((x,i) => { const a = smooth(between(p,.22+i*.09,.58+i*.09)); x.style.opacity = a; x.style.transform = `translate3d(${lerp(i%2?110:-110,0,a)}px,${lerp(34,0,a)}px,0)`; x.style.setProperty('--fill', `${a*100}%`); }); }
  forecast() { const p = this.section(this.e.forecast,.25), q = smooth(between(p,.15,.72)), e = this.e; if (e.forecastCurve) e.forecastCurve.style.strokeDashoffset = e.forecastCurve.dataset.length * (1-q); if (e.forecastActual) e.forecastActual.style.strokeDashoffset = e.forecastActual.dataset.length * (1-smooth(between(p,.08,.36))); if (e.forecastArea) e.forecastArea.style.opacity = String(q * .95); const marker = smooth(between(p,.62,.82)); if (e.marker) { e.marker.style.opacity = marker; e.marker.style.transform = `scale(${lerp(.25,1.45,marker)})`; e.marker.style.transformOrigin = '748px 163px'; } if (e.forecastTag) { e.forecastTag.style.opacity = marker; e.forecastTag.style.transform = `translateY(${lerp(10,0,marker)}px)`; } document.querySelectorAll('.forecast-beat').forEach((beat,i) => { const a = smooth(between(p,.10+i*.09,.42+i*.09)); beat.style.opacity = a; beat.style.transform = `translate3d(0,${lerp(42,0,a)}px,0)`; }); const needle = document.querySelector('.forecast-day-needle'); if (needle) needle.style.setProperty('--needle-x', `${lerp(8,89,smooth(between(p,.14,.8)))}%`); }
  plan() {
    const track = this.e.planTrack; if (!track) return;
    const total = Math.max(1, track.offsetHeight - this.h), raw = (this.y - track.offsetTop) / total, p = clamp(raw);
    track.classList.toggle('is-native-pinned', raw >= 0 && raw < 1);
    track.classList.toggle('is-complete', raw >= 1);
    const title = document.querySelector('.plan-title-block'), risk = document.querySelector('.route-risk'), solve = document.querySelector('.route-solve'), transfer = document.querySelector('.decision-transfer');
    const titleIn = smooth(between(p,.04,.18)); if (title) { title.style.opacity = titleIn; title.style.transform = `translateY(${lerp(24,0,titleIn)}px)`; }
    const riskIn = smooth(between(p,.15,.38)); if (risk) { risk.style.opacity = riskIn; risk.style.transform = `translateX(${lerp(-72,0,riskIn)}px)`; }
    const solveIn = smooth(between(p,.35,.62)); if (solve) { solve.style.opacity = solveIn; solve.style.transform = `translateX(${lerp(72,0,solveIn)}px)`; }
    const transferIn = smooth(between(p,.30,.54)); if (transfer) { transfer.style.opacity = transferIn; transfer.style.transform = `scaleY(${lerp(.25,1,transferIn)})`; }
    document.querySelectorAll('.decision-action').forEach((action,i) => { const a = smooth(between(p,.54+i*.08,.72+i*.08)); action.style.opacity = a; action.style.transform = `translateY(${lerp(18,0,a)}px)`; });
  }
  product() { const p=this.section(this.e.product,.2),a=smooth(between(p,.08,.7)),frame=document.getElementById('product-takeover-frame'); if(frame){frame.style.opacity=a;frame.style.transform=`perspective(1000px) rotateX(${lerp(9,0,a)}deg) scale(${lerp(.9,1,a)})`;} document.querySelectorAll('.mock-kpi-card').forEach((x,i)=>{const q=smooth(between(p,.3+i*.07,.62+i*.07));x.style.opacity=q;x.style.transform=`translateY(${lerp(30,0,q)}px)`;}); }
  closing() { const p=this.section(this.e.philosophy,.1); document.querySelectorAll('.monument-line').forEach((x,i)=>{const q=smooth(between(p,.16+i*.12,.58+i*.12));x.style.opacity=q;x.style.transform=`translateX(${lerp(70,0,q)}px)`;}); const q=smooth(between(this.section(this.e.finalStage,.1),.12,.7)),title=document.getElementById('final-title'); if(title){title.style.opacity=q;title.style.transform=`scale(${lerp(.88,1,q)})`;}}
  staticFallback() { const e=this.e; e.title.style.cssText='opacity:1;transform:none;filter:none;clip-path:none'; e.rail.style.opacity=.25; e.packet.style.opacity=0; this.place(.56); e.amount.textContent='₹48,820'; e.status.textContent='EXPECTED SETTLEMENT · VERIFIED'; e.mismatch.style.opacity=0; e.mismatchVal.textContent='₹600'; e.lineage.style.opacity=0; e.final.style.opacity=0; e.finalState.style.opacity=0; e.resolution.style.opacity=1; [e.expected,e.actual].forEach(x=>{if(x){x.style.opacity=.25;x.style.strokeDashoffset=0;}}); }
}
