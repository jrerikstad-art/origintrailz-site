/**
 * Landing page scroll hero — preload frozen snapshot, walk on scroll, orbit at end.
 */
import { HeroWorld } from './heroWorld';
import { panelsScrollToProgress } from './routeWalk';
import { BERGURA_A_ROUTE, ORIGIN_E, ORIGIN_N, SNAPSHOT_WORLD_BASE } from './routeConfig';

function boot() {
  const container = document.getElementById('world');
  if (!container) {
    console.warn('[otz-scroll] missing #world');
    return;
  }

  const world = new HeroWorld({
    worldBase: SNAPSHOT_WORLD_BASE,
    route: BERGURA_A_ROUTE,
    originE: ORIGIN_E,
    originN: ORIGIN_N,
    container,
    exaggeration: 1.3,
  });

  const bar = document.getElementById('scrollLoadBar');
  const loading = document.getElementById('scrollLoading');
  const cells = document.getElementById('scrollCells');
  const handover = document.getElementById('scrollHandover');
  const panels = document.querySelector('.scroll-panels') as HTMLElement | null;

  container.addEventListener('hero:handover', () => {
    handover?.classList.add('on');
  });
  container.addEventListener('hero:story', () => {
    handover?.classList.remove('on');
  });

  document.getElementById('heroZoomIn')?.addEventListener('click', () => world.zoomBy(0.85));
  document.getElementById('heroZoomOut')?.addEventListener('click', () => world.zoomBy(1.18));

  world.start();

  void world
    .preload((done, total) => {
      if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    })
    .then(() => {
      loading?.classList.add('done');
      console.info('[otz-scroll] stats', world.stats);
      if (world.stats.tilesFailed > 0) {
        console.error('[otz-scroll] snapshot tilesFailed=', world.stats.tilesFailed);
      }
    })
    .catch((e) => {
      console.error('[otz-scroll] preload failed', e);
      loading?.classList.add('done');
    });

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!panels) return;
      const rect = panels.getBoundingClientRect();
      const panelsTop = window.scrollY + rect.top;
      const p = panelsScrollToProgress({
        scrollY: window.scrollY,
        viewportH: window.innerHeight,
        panelsTop,
        panelsHeight: panels.offsetHeight,
      });
      world.onPanelsProgress(p);
      if (cells) cells.textContent = world.stats.cellsRevealed.toLocaleString();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

boot();
