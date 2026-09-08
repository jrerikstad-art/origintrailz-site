import { HeroWorld } from './heroWorld';
import { BERGURA_A_ROUTE } from './routeConfig';

async function boot() {
  const container = document.getElementById('world');
  if (!container) return;
  const preview = container.dataset.mode === 'preview';
  const loading = document.getElementById('scrollLoading');
  const bar = document.getElementById('scrollLoadBar');
  const status = document.getElementById('heroStatus');
  const exploreButton = document.getElementById('heroExplore');
  const panels = document.querySelector<HTMLElement>('.scroll-panels');
  const events = new AbortController();
  let exploring = false;
  let exploreScrollY = 0;
  let world: HeroWorld | undefined;
  const progress = () => {
    if (!panels) return 0;
    const start = window.scrollY + panels.getBoundingClientRect().top;
    const length = Math.max(1, panels.offsetHeight - window.innerHeight);
    return Math.max(0, Math.min(1, (window.scrollY - start) / (length * .88)));
  };
  const onScroll = () => {
    // Scrolling is always an exit, never a wheel-zoom trap. Reveal stays intact.
    if (exploring && Math.abs(window.scrollY - exploreScrollY) > 2) world?.setExploring(false);
    world?.onScroll(progress());
  };
  try {
    world = new HeroWorld({ container, route: BERGURA_A_ROUTE, preview,
      onModeChange: active => {
        exploring = active; exploreScrollY = window.scrollY;
        document.body.classList.toggle('hero-exploring', active);
        if (panels) panels.inert = active;
        exploreButton?.setAttribute('aria-pressed', String(active));
        if (exploreButton) exploreButton.textContent = active ? 'Back to page' : 'Explore freely';
      },
      onStatus: message => { if (status) status.textContent = message; },
    });
    // A visitor may scroll while the asset loads. Retain that progress.
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    onScroll();
    const signal = events.signal;
    document.getElementById('heroZoomIn')?.addEventListener('click', () => world?.zoom(.85), { signal });
    document.getElementById('heroZoomOut')?.addEventListener('click', () => world?.zoom(1 / .85), { signal });
    document.getElementById('heroReset')?.addEventListener('click', () => world?.resetView(), { signal });
    exploreButton?.addEventListener('click', () => world?.setExploring(!exploring), { signal });
    addEventListener('keydown', event => {
      if (event.key === 'Escape' && exploring) { world?.setExploring(false); exploreButton?.focus(); }
    }, { signal });
    await world.preload((done, total) => {
      if (bar) bar.style.width = `${Math.round(100 * done / Math.max(total, 1))}%`;
    });
    loading?.classList.add('done');
    if (status) status.textContent = preview ? 'Drag to rotate · Shift-drag to pan · + / − to zoom' :
      'Scroll to reveal · drag to rotate · Explore freely to move the ball';
    container.dataset.ready = 'true';
    document.querySelectorAll<HTMLButtonElement>('#heroControls button').forEach(button => { button.disabled = false; });
    const visibility = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      document.getElementById('heroControls')?.toggleAttribute('hidden', !visible);
      document.getElementById('scrollHandover')?.toggleAttribute('hidden', !visible);
    });
    if (panels) visibility.observe(panels);
    addEventListener('pagehide', event => {
      if (event.persisted) return;
      visibility.disconnect(); events.abort(); world?.dispose();
      removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll);
    });
  } catch (error) {
    console.error('[origintrailz-header] load failed', error);
    world?.dispose();
    events.abort();
    removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll);
    loading?.classList.add('failed');
    loading?.setAttribute('role', 'status');
    if (status) status.textContent = 'The 3D map could not load. You can still explore the page.';
    const message = document.getElementById('heroLoadMessage');
    if (message) message.textContent = 'The 3D map could not load. Refresh to retry, or continue down the page.';
  }
}

void boot();
