<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Accessibility statement: the text `accessibility.<lang>.md` of the branding
// directory (docs/production/accessibility-statement.md is the model). See useLegalPage.
const page = await useLegalPage('accessibility');
</script>

<template>
  <LegalPage v-bind="page" />
</template>
