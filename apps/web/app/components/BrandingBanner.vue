<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
import type { HeroVariant } from '~/composables/useHeroImage';
// Deployment header image (useHeroImage): renders nothing when none is set.
// `variant` picks the course-list image, which falls back to the home one. The
// course list's own image is an illustration of 12:5 (2.4:1); the home image,
// also shown on the course list when it has none of its own, is 3:1.
const props = defineProps<{ variant?: HeroVariant }>();
const { heroImage, heroImageAlt, hasOwnImage } = useHeroImage(props.variant ?? 'home');
</script>

<template>
  <div
    v-if="heroImage"
    class="branding-banner"
    :class="{ 'branding-banner--courses': hasOwnImage && variant === 'courses' }"
  >
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
.branding-banner--courses img {
  aspect-ratio: 12 / 5;
}
@media (max-width: 40rem) {
  .branding-banner img,
  .branding-banner--courses img {
    aspect-ratio: 2 / 1;
  }
}
</style>
