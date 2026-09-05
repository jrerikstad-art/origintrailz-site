/**
 * Patch index.html for scroll-driven hero (from Claude scroll-walk design).
 */
import fs from 'node:fs';

const path = 'c:/dev/origintrailz-site/index.html';
let html = fs.readFileSync(path, 'utf8');

const newCss = `  /* ───────── SCROLL HERO (walk the fog) ───────── */
  /* Fixed world; page scrolls. Interaction is the product verb. */
  #world{position:fixed;inset:0;z-index:0;background:#cfd8e0}
  #world canvas{display:block;width:100%;height:100%}
  .scroll-panels{position:relative;z-index:1;pointer-events:none}
  .scroll-panel{
    min-height:100svh;display:flex;align-items:center;
    padding:110px 8vw 48px;max-width:640px;
  }
  .scroll-panel > div{
    background:rgba(250,247,242,.84);backdrop-filter:blur(6px);
    border-radius:16px;padding:28px 30px;pointer-events:auto;
    box-shadow:0 8px 28px var(--shadow);
  }
  .scroll-panel h1{
    font-family:'Lora',serif;font-weight:600;letter-spacing:-.025em;
    font-size:clamp(34px,5.5vw,64px);line-height:1.06;color:var(--ink);max-width:14ch;
  }
  .scroll-panel h1 em{font-style:italic;color:var(--accent)}
  .scroll-panel h2{
    font-family:'Lora',serif;font-weight:600;font-size:clamp(24px,3.5vw,36px);
    line-height:1.15;margin:0 0 .4em;
  }
  .scroll-panel p{font-size:16px;line-height:1.6;color:var(--ink-soft);margin:0 0 1.1em}
  .scroll-eyebrow{
    font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;
    color:var(--accent);margin-bottom:14px;
  }
  .scroll-cta{display:flex;gap:12px;flex-wrap:wrap}
  #scrollCounter{
    position:fixed;top:84px;right:22px;z-index:3;pointer-events:none;
    background:rgba(255,255,255,.9);border-radius:22px;padding:8px 14px;
    font-size:12px;font-weight:600;color:var(--ink-soft);box-shadow:0 2px 10px var(--shadow);
  }
  #scrollCounter b{color:var(--accent);font-variant-numeric:tabular-nums}
  #scrollHandover{
    position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3;
    background:rgba(28,25,23,.92);color:#fff;padding:12px 22px;border-radius:999px;
    font-size:13px;font-weight:500;opacity:0;transition:opacity .5s ease;pointer-events:none;
  }
  #scrollHandover.on{opacity:1}
  #scrollLoading{
    position:fixed;inset:0;z-index:40;display:grid;place-items:center;
    background:var(--cream);transition:opacity .6s ease;
  }
  #scrollLoading.done{opacity:0;pointer-events:none}
  #scrollLoading .bar{width:220px;height:3px;background:rgba(28,25,23,.1);
    border-radius:2px;overflow:hidden;margin-top:14px}
  #scrollLoading .bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s ease}
  /* Opaque rest of site sits above the fixed world */
  section, footer{position:relative;z-index:2;background:var(--cream)}
  .btn{
    display:inline-flex;align-items:center;gap:8px;
    padding:15px 30px;border-radius:30px;text-decoration:none;
    font-size:15px;font-weight:600;transition:transform .15s,opacity .15s,box-shadow .15s;
    border:none;cursor:pointer;
  }
  .btn:active{transform:scale(.97)}
  .btn-primary{background:var(--ink);color:var(--cream);box-shadow:0 6px 22px rgba(28,25,23,.22)}
  .btn-primary:hover{opacity:.88}
  .btn-ghost{background:rgba(255,255,255,.8);color:var(--ink-soft);box-shadow:0 2px 10px var(--shadow)}
  .btn-ghost:hover{color:var(--accent)}
`;

const cssStart = html.indexOf('  /* ───────── HERO / FOG ───────── */');
const cssEnd = html.indexOf('  /* ───────── SECTIONS ───────── */');
if (cssStart < 0 || cssEnd < 0) throw new Error('css markers');
html = html.slice(0, cssStart) + newCss + '\n' + html.slice(cssEnd);

const newHero = `<!-- ───────── SCROLL HERO: walk the fog ───────── -->
<div id="world" aria-hidden="true"></div>
<div id="scrollCounter"><b id="scrollCells">0</b> cells revealed</div>
<div id="scrollHandover">Take the controls — drag to look, scroll to zoom</div>
<div id="scrollLoading">
  <div style="text-align:center">
    <div style="font-family:Lora,serif;font-size:1.4rem;font-weight:600">Origin<em style="font-style:italic;color:var(--accent)">trailz</em></div>
    <div class="bar"><i id="scrollLoadBar"></i></div>
  </div>
</div>
<div class="scroll-panels">
  <section class="scroll-panel">
    <div>
      <div class="scroll-eyebrow">Your own private treasure map</div>
      <h1>The map of <em>everywhere</em> you've ever been.</h1>
      <p>Origintrailz covers the world in fog. As you walk, your map reveals itself — street by street, trail by trail — and stays revealed forever.</p>
      <div class="scroll-cta">
        <a class="btn btn-primary" href="#pricing">Start 7 days free</a>
        <a class="btn btn-ghost" href="#how">See how it works</a>
      </div>
    </div>
  </section>
  <section class="scroll-panel">
    <div>
      <h2>Scroll, and walk it yourself.</h2>
      <p>This is real terrain from the Origintrailz world — not a diorama. Keep scrolling and the fog opens along the path. The visitor performs the product's core verb before paying anything.</p>
    </div>
  </section>
  <section class="scroll-panel">
    <div>
      <h2>Revealed stays revealed.</h2>
      <p>Scroll back up and the fog does not return. That is the contract: discovery is monotonic, the same as on your phone.</p>
    </div>
  </section>
  <section class="scroll-panel">
    <div>
      <h2>Then take the controls.</h2>
      <p>At the end of the walk the page hands the world to you — drag to look, scroll to zoom. Orbit is the reward, not the pitch.</p>
    </div>
  </section>
</div>

`;

const heroStart = html.indexOf('<!-- ───────── HERO: the fog you wipe away ───────── -->');
const heroEnd = html.indexOf('<!-- ───────── HOW IT WORKS ───────── -->');
if (heroStart < 0 || heroEnd < 0) throw new Error('hero markers');
html = html.slice(0, heroStart) + newHero + html.slice(heroEnd);

const fogStart = html.indexOf('<script>\n(function(){\n  /* WEB.1 FOG.VISUAL.TRUTH');
const fogEnd = html.indexOf('<script type="module" src="/hero.js"></script>');
if (fogStart < 0 || fogEnd < 0) throw new Error('fog script markers');
const scrollObserve = `<script>
(function(){
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.14 });
  document.querySelectorAll('.reveal-on-scroll').forEach(el => io.observe(el));
})();
</script>
`;
html = html.slice(0, fogStart) + scrollObserve + html.slice(fogEnd);

fs.writeFileSync(path, html);
console.log('patched index.html for scroll hero');
