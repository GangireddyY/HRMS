<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AppLogo } from '@/shared/components';
import { BRANCHES } from '../showcase';

/**
 * Mind map of everything HRMS covers: a radar hub → lifecycle stages and platform → modules / capabilities.
 * It draws itself in, then features one item at a time (hover, click or focus an item to feature it);
 * the radar beam turns to the featured branch.
 */
const W = 1100;
const H = 520;
const HUB = { x: W / 2, y: H / 2 };
const RADAR_R = 84;
const STAGE_X = { left: 352, right: W - 352 };
const LEAF_EDGE = { left: 246, right: W - 246 };
const ROW = 36;
const GROUP_GAP = 14;
const INTERVAL_MS = 2600;
const LEFT = ['hire', 'onboard', 'manage', 'pay', 'platform'];
/** Beam trail: wedges fading out behind the leading edge (degrees each). */
const TRAIL = Array.from({ length: 9 }, (_, k) => ({ from: -(k + 1) * 7, to: -k * 7, opacity: 0.42 * (1 - k / 9) }));

const chipWidth = (label: string, perChar = 7.3, padding = 44) => Math.round(label.length * perChar + padding);
const connector = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
};
/** Point on a circle around the hub; angles are clockwise from 12 o'clock. */
const onCircle = (angle: number, r: number) => {
  const rad = (angle * Math.PI) / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
};
const wedge = (from: number, to: number, r: number) => {
  const a = onCircle(from, r);
  const b = onCircle(to, r);
  return `M0 0 L${a.x} ${a.y} A${r} ${r} 0 0 1 ${b.x} ${b.y} Z`;
};

/** Leaves stacked per side and centred vertically; each branch sits at the middle of its leaves. */
function layoutSide(side: 'left' | 'right') {
  const branches = BRANCHES.filter((b) => LEFT.includes(b.key) === (side === 'left'));
  const rows = branches.reduce((n, b) => n + b.leaves.length, 0);
  let y = (H - (rows * ROW + (branches.length - 1) * GROUP_GAP)) / 2 + ROW / 2;
  const dir = side === 'left' ? -1 : 1;
  return branches.map((branch) => {
    const leaves = branch.leaves.map((leaf) => {
      const width = chipWidth(leaf.label);
      const at = { ...leaf, y, width, x: side === 'left' ? LEAF_EDGE.left - width : LEAF_EDGE.right };
      y += ROW;
      return at;
    });
    y += GROUP_GAP;
    const by = (leaves[0]!.y + leaves[leaves.length - 1]!.y) / 2;
    const width = chipWidth(branch.label, 8, 52);
    const bx = STAGE_X[side];
    const inner = bx - (dir * width) / 2;
    const outer = bx + (dir * width) / 2;
    // Each branch leaves the radar from a blip on its rim, facing the branch.
    const angle = (Math.atan2(bx - HUB.x, -(by - HUB.y)) * 180) / Math.PI;
    const blip = onCircle(angle, RADAR_R);
    const out = onCircle(angle, RADAR_R + 45);
    return {
      ...branch,
      x: bx,
      y: by,
      width,
      angle,
      blip,
      trunk: `M${HUB.x + blip.x} ${HUB.y + blip.y} C${HUB.x + out.x} ${HUB.y + out.y} ${inner - dir * 45} ${by} ${inner} ${by}`,
      leaves: leaves.map((l) => ({ ...l, path: connector(outer, by, LEAF_EDGE[side], l.y) })),
    };
  });
}

const branches = [...layoutSide('left'), ...layoutSide('right')].sort((a, b) => BRANCHES.findIndex((x) => x.key === a.key) - BRANCHES.findIndex((x) => x.key === b.key));
/** Every leaf in reading order (lifecycle first, then the platform). */
const items = branches.flatMap((branch) => branch.leaves.map((leaf) => ({ leaf, branch })));

const active = ref(0);
const paused = ref(false);
const reducedMotion = ref(false);
const current = computed(() => items[active.value]!);

function feature(key: string) {
  active.value = items.findIndex((i) => i.leaf.key === key);
}

/** The beam always turns clockwise, so the rotation accumulates instead of wrapping. */
const beamRotation = ref(items[0]!.branch.angle);
watch(current, (next, prev) => {
  beamRotation.value += (next.branch.angle - prev.branch.angle + 360) % 360;
});

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reducedMotion.value) return;
  timer = setInterval(() => {
    if (!paused.value) active.value = (active.value + 1) % items.length;
  }, INTERVAL_MS);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <!-- Scales to the space it is given (the parent sets the height on large screens), keeping its proportions. -->
  <div class="flex min-h-0 flex-col" @mouseenter="paused = true" @mouseleave="paused = false" @focusin="paused = true" @focusout="paused = false">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMinYMid meet"
      class="h-full max-h-[560px] min-h-0 w-full flex-1 overflow-visible"
      role="group"
      aria-label="Everything HRMS covers"
    >
      <!-- Connectors -->
      <g fill="none" stroke-linecap="round">
        <template v-for="(branch, bi) in branches" :key="`c-${branch.key}`">
          <path
            :d="branch.trunk"
            pathLength="1"
            stroke-dasharray="1"
            stroke-width="1.75"
            :class="['animate-draw transition-colors duration-500', branch.key === current.branch.key ? 'stroke-hero-accent/70' : 'stroke-hero-ink/20']"
            :style="{ animationDelay: `${bi * 70}ms` }"
          />
          <path
            v-for="leaf in branch.leaves"
            :key="`c-${leaf.key}`"
            :d="leaf.path"
            pathLength="1"
            stroke-dasharray="1"
            stroke-width="1.25"
            :class="['animate-draw transition-colors duration-500', branch.key === current.branch.key ? 'stroke-hero-accent/50' : 'stroke-hero-ink/15']"
            :style="{ animationDelay: `${300 + bi * 70}ms` }"
          />
        </template>
        <!-- Flow along the featured path -->
        <path :d="current.branch.trunk" stroke-width="2.25" stroke-dasharray="4 8" class="animate-flow stroke-hero-accent" />
        <path :d="current.leaf.path" stroke-width="2.25" stroke-dasharray="4 8" class="animate-flow stroke-hero-accent" />
      </g>

      <!-- Leaves -->
      <template v-for="(branch, bi) in branches" :key="`l-${branch.key}`">
        <g
          v-for="leaf in branch.leaves"
          :key="leaf.key"
          role="button"
          tabindex="0"
          :aria-label="`${leaf.label}: ${leaf.description}`"
          :aria-pressed="leaf.key === current.leaf.key"
          class="animate-[fade-in_500ms_ease-out_both] cursor-pointer outline-none"
          :style="{ animationDelay: `${450 + bi * 70}ms` }"
          @mouseenter="feature(leaf.key)"
          @focus="feature(leaf.key)"
          @click="feature(leaf.key)"
        >
          <rect
            :x="leaf.x"
            :y="leaf.y - 14"
            :width="leaf.width"
            height="28"
            rx="14"
            stroke-width="1"
            :class="[
              'transition-colors duration-500',
              leaf.key === current.leaf.key
                ? 'fill-hero-solid stroke-hero-solid'
                : branch.key === current.branch.key
                  ? 'fill-hero-panel stroke-hero-accent/60'
                  : branch.kind === 'platform'
                    ? 'fill-hero-panel stroke-hero-ink/25 [stroke-dasharray:3_4]'
                    : 'fill-hero-panel stroke-hero-ink/15',
            ]"
          />
          <component
            :is="leaf.icon"
            :x="leaf.x + 11"
            :y="leaf.y - 7"
            :size="14"
            :class="leaf.key === current.leaf.key ? 'text-hero-on-solid' : branch.kind === 'platform' ? 'text-emerald-600 dark:text-emerald-300' : 'text-hero-accent'"
          />
          <text
            :x="leaf.x + 31"
            :y="leaf.y + 4.5"
            font-size="13"
            font-weight="500"
            :class="['transition-colors duration-500', leaf.key === current.leaf.key ? 'fill-hero-on-solid' : 'fill-hero-ink/80']"
          >
            {{ leaf.label }}
          </text>
        </g>
      </template>

      <!-- Branches -->
      <g
        v-for="(branch, bi) in branches"
        :key="`b-${branch.key}`"
        class="animate-[fade-in_400ms_ease-out_both]"
        :style="{ animationDelay: `${150 + bi * 70}ms` }"
        aria-hidden="true"
      >
        <rect
          :x="branch.x - branch.width / 2"
          :y="branch.y - 17"
          :width="branch.width"
          height="34"
          rx="17"
          stroke-width="1.25"
          :class="['transition-colors duration-500', branch.key === current.branch.key ? 'fill-hero-solid stroke-hero-solid' : 'fill-hero-panel stroke-hero-ink/25']"
        />
        <component
          :is="branch.icon"
          :x="branch.x - branch.width / 2 + 13"
          :y="branch.y - 8"
          :size="16"
          :class="branch.key === current.branch.key ? 'text-hero-on-solid' : 'text-hero-accent'"
        />
        <text
          :x="branch.x - branch.width / 2 + 35"
          :y="branch.y + 5"
          font-size="14"
          font-weight="600"
          :class="['transition-colors duration-500', branch.key === current.branch.key ? 'fill-hero-on-solid' : 'fill-hero-ink/85']"
        >
          {{ branch.label }}
        </text>
      </g>

      <!-- Radar hub -->
      <g :transform="`translate(${HUB.x} ${HUB.y})`" aria-hidden="true">
        <circle :r="RADAR_R" stroke-width="1.25" class="fill-hero-panel stroke-hero-ink/25" />
        <circle :r="RADAR_R * 0.66" fill="none" stroke-width="1" stroke-dasharray="2 5" class="stroke-hero-ink/20" />
        <circle :r="RADAR_R * 0.36" fill="none" stroke-width="1" class="stroke-hero-ink/15" />
        <path :d="`M${-RADAR_R} 0 H${RADAR_R} M0 ${-RADAR_R} V${RADAR_R}`" stroke-width="1" class="stroke-hero-ink/10" />
        <circle :r="RADAR_R" class="animate-radar-pulse fill-none stroke-hero-accent/50 [transform-box:fill-box] [transform-origin:center]" stroke-width="1.5" />
        <circle :r="RADAR_R" class="animate-radar-pulse fill-none stroke-hero-accent/50 [transform-box:fill-box] [transform-origin:center] [animation-delay:-1.6s]" stroke-width="1.5" />

        <!-- Sweep beam, turned to the featured branch -->
        <g class="transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)]" :style="{ transform: `rotate(${beamRotation}deg)`, transformOrigin: '0 0' }">
          <path v-for="(t, k) in TRAIL" :key="k" :d="wedge(t.from, t.to + 0.5, RADAR_R)" :fill-opacity="t.opacity" class="fill-hero-accent" />
          <line x1="0" y1="0" x2="0" :y2="-RADAR_R" stroke-width="2" stroke-linecap="round" class="stroke-hero-solid" />
        </g>

        <!-- One blip per branch; the featured one pings -->
        <g v-for="branch in branches" :key="`blip-${branch.key}`" :transform="`translate(${branch.blip.x} ${branch.blip.y})`">
          <circle v-if="branch.key === current.branch.key" r="9" class="animate-ping fill-hero-accent/40 [transform-box:fill-box] [transform-origin:center]" />
          <circle
            :r="branch.key === current.branch.key ? 5 : 3.5"
            :class="['transition-all duration-500', branch.key === current.branch.key ? 'fill-hero-solid' : 'fill-hero-ink/35']"
          />
        </g>

        <circle r="26" class="fill-hero-panel stroke-hero-ink/15" stroke-width="1" />
        <AppLogo :size="36" x="-18" y="-18" />
        <text :y="RADAR_R + 22" text-anchor="middle" font-size="14" font-weight="700" class="fill-hero-ink">HRMS</text>
        <text :y="RADAR_R + 38" text-anchor="middle" font-size="11" font-weight="500" class="fill-hero-ink/60">One workspace</text>
      </g>
    </svg>

    <!-- Featured item -->
    <div class="mt-4 flex min-h-[52px] shrink-0 items-start gap-3 short:mt-2" aria-live="off">
      <Transition mode="out-in" enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0 translate-y-1" leave-active-class="transition duration-150" leave-to-class="opacity-0">
        <div :key="current.leaf.key" class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[0_8px_20px_-8px_var(--brand-500)]">
            <component :is="current.leaf.icon" :size="18" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-base font-semibold">
              {{ current.leaf.label }} <span class="font-medium text-hero-ink/50">· {{ current.branch.label }}</span>
            </p>
            <p class="text-sm text-hero-ink/70">{{ current.leaf.description }}</p>
          </div>
        </div>
      </Transition>
      <span class="ms-auto shrink-0 pt-1 text-xs font-medium text-hero-ink/50 tabular-nums">{{ String(active + 1).padStart(2, '0') }} / {{ items.length }}</span>
    </div>
  </div>
</template>
