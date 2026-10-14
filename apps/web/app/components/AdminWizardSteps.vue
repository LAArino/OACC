<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Step navigation of the course wizard: an ordered list of buttons, the current
// one marked `aria-current="step"`. Steps beyond `reachable` are disabled (new
// records are filled in order); steps with errors say so in text.
const props = defineProps<{
  label: string;
  steps: readonly string[];
  current: number;
  reachable: number;
  invalid?: readonly number[];
}>();
const emit = defineEmits<{ select: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <nav class="admin-steps" :aria-label="props.label">
    <ol>
      <li v-for="(step, index) in props.steps" :key="step">
        <button
          type="button"
          class="admin-steps__step"
          :class="{
            'admin-steps__step--current': index === props.current,
            'admin-steps__step--invalid': props.invalid?.includes(index),
          }"
          :aria-current="index === props.current ? 'step' : undefined"
          :disabled="index > props.reachable"
          @click="emit('select', index)"
        >
          <span class="admin-steps__number">{{ index + 1 }}</span>
          {{ step }}
          <span v-if="props.invalid?.includes(index)" class="admin-steps__flag">
            {{ t('admin.wizard.hasErrors') }}
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
