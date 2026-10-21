<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Privacy notice of the controller (for Aurora, the Aurora Foundation): the text
// `privacy.<lang>.md` of the branding directory. Its URL goes into the SAML
// federation metadata (Data Protection Code of Conduct). See useLegalPage.
const page = await useLegalPage('privacy');
</script>

<template>
  <LegalPage v-bind="page" />
</template>
