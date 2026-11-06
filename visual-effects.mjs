// Presentation only: no persistence, calendar decisions, or optimistic marks.
export function createVisualEffects(root, header) {
  const ns = 'http://www.w3.org/2000/svg';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const contours = new Map();
  const pending = new Map();
  let currentMember = null;
  const observer = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (target === header) {
        document.documentElement.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
      } else size(target);
    }
  });
  function size(card) {
    const contour = contours.get(card);
    if (!contour) return;
    const { width, height } = card.getBoundingClientRect();
    const radius = Math.max(0, parseFloat(getComputedStyle(card).borderTopLeftRadius) - .5);
    contour.rect.setAttribute('width', Math.max(0, width - 1));
    contour.rect.setAttribute('height', Math.max(0, height - 1));
    contour.rect.setAttribute('rx', radius);
    contour.rect.setAttribute('ry', radius);
  }
  function cancel(card) {
    contours.get(card)?.animation?.cancel();
    const contour = contours.get(card);
    if (contour) contour.animation = null;
  }
  function draw(card) {
    const contour = contours.get(card);
    if (!contour || reduced.matches) return;
    cancel(card);
    size(card);
    contour.animation = contour.rect.animate(
      [{ strokeDashoffset: '1000' }, { strokeDashoffset: '0' }],
      { duration: 380, easing: 'cubic-bezier(.2,.65,.3,1)' },
    );
    const animation = contour.animation;
    animation.onfinish = () => {
      if (contour.animation === animation) { animation.cancel(); contour.animation = null; }
    };
  }
  reduced.addEventListener('change', () => {
    if (reduced.matches) contours.forEach((_, card) => cancel(card));
  });
  if (header) observer.observe(header);
  return {
    identity(memberId) {
      if (currentMember !== memberId) {
        pending.clear();
        contours.forEach((_, card) => cancel(card));
      }
      currentMember = memberId;
    },
    resetCards() {
      pending.clear();
      contours.forEach((_, card) => { cancel(card); observer.unobserve(card); });
      contours.clear();
    },
    attach(card) {
      const svg = document.createElementNS(ns, 'svg');
      svg.classList.add('selection-outline');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const rect = document.createElementNS(ns, 'rect');
      for (const [key, value] of Object.entries({ x: '.5', y: '.5', pathLength: '1000', fill: 'none', 'vector-effect': 'non-scaling-stroke' })) rect.setAttribute(key, value);
      svg.append(rect); card.append(svg);
      contours.set(card, { rect, animation: null });
      observer.observe(card);
    },
    sync(card, selected) {
      if (!selected) cancel(card);
      if (selected && pending.get(card.dataset.date) === currentMember) {
        pending.delete(card.dataset.date);
        draw(card);
      }
    },
    confirmed(date, memberId, added) {
      if (memberId !== currentMember) return;
      const card = root.querySelector(`.day[data-date="${date}"]`);
      if (!added) { pending.delete(date); if (card) cancel(card); return; }
      if (card?.classList.contains('is-selected')) draw(card);
      else pending.set(date, memberId);
    },
  };
}
