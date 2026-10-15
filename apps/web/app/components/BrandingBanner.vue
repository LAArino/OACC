<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
import type { HeroVariant } from '~/composables/useHeroImage';
// Deployment header image (useHeroImage): renders nothing when none is set.
// `variant` picks the course-list image, which falls back to the home one.
const props = defineProps<{ variant?: HeroVariant }>();
const { heroImage, heroImageAlt } = useHeroImage(props.variant ?? 'home');
</script>

<template>
  <div v-if="heroImage" class="branding-banner">
    <img
      :src="heroImage"
      :alt="heroImageAlt"
      loading="eager"
      fetchpriority="high"
      decoding="async"
    />
  </div>
</template>

<style scoped>
.branding-banner {
  margin: 0 0 1.5rem;
}
/* The box keeps its size before the image loads: no layout shift. */
.branding-banner img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 1;
  object-fit: cover;
  border-radius: var(--radius);
  background: var(--c-surface);
}
@media (max-width: 40rem) {
  .branding-banner img {
    aspect-ratio: 2 / 1;
  }
}
</style>
