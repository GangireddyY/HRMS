import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';

interface FloatingOptions {
  /** Gap between anchor and panel in px. */
  offset?: number;
  /** Fixed panel width; defaults to the anchor width. */
  width?: number;
  /** Upper bound for the panel height before it scrolls. */
  maxHeight?: number;
}

/**
 * Positions a teleported panel (fixed) under its anchor, flipping above when there is not enough
 * room below, and keeps it aligned while the page scrolls or resizes. Teleporting avoids clipping
 * by `overflow-hidden` cards and scroll containers.
 */
export function useFloating(anchor: Ref<HTMLElement | null>, open: Ref<boolean>, options: FloatingOptions = {}) {
  const offset = options.offset ?? 6;
  const maxHeight = options.maxHeight ?? 320;
  const style = ref<Record<string, string>>({});
  const placement = ref<'bottom' | 'top'>('bottom');

  function update(): void {
    const el = anchor.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - rect.bottom - offset - 8;
    const above = rect.top - offset - 8;
    placement.value = below < Math.min(maxHeight, 220) && above > below ? 'top' : 'bottom';
    const width = options.width ?? rect.width;
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const room = placement.value === 'bottom' ? below : above;
    style.value = {
      position: 'fixed',
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(140, Math.min(maxHeight, room))}px`,
      ...(placement.value === 'bottom' ? { top: `${rect.bottom + offset}px` } : { bottom: `${vh - rect.top + offset}px` }),
    };
  }

  function listen(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('scroll', update, true);
    window[method]('resize', update);
  }

  watch(open, async (isOpen) => {
    if (isOpen) {
      await nextTick();
      update();
      listen(true);
    } else {
      listen(false);
    }
  });
  onBeforeUnmount(() => listen(false));

  return { style, placement, update };
}

/** Closes when a pointer goes down outside every given element. */
export function useOutsideClose(elements: Ref<HTMLElement | null>[], open: Ref<boolean>, close: () => void) {
  function onPointerDown(e: PointerEvent): void {
    const target = e.target as Node;
    if (!elements.some((el) => el.value?.contains(target))) close();
  }
  watch(open, (isOpen) => {
    if (isOpen) document.addEventListener('pointerdown', onPointerDown, true);
    else document.removeEventListener('pointerdown', onPointerDown, true);
  });
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true));
}
