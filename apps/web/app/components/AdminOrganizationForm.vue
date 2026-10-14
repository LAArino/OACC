<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Fields of an organization (spec §2.1 step 1; Guide A step 4): identity (slug,
// type, partner, parent), names, identifiers (SCHAC home organization, IdP
// alias, Erasmus code, PIC, external id) and settings (time zone, languages,
// contacts). The page owns validation and saving; `errors` maps field names
// (see utils/organizationForm.ts) to messages.
import type { OrganizationForm } from '~/utils/organizationForm';
import { nameField, ORG_TYPES, organizationFieldId } from '~/utils/organizationForm';

const props = withDefaults(
  defineProps<{
    creating: boolean;
    errors: Record<string, string>;
    parentOptions: readonly { value: string; label: string }[];
    busy?: boolean;
    submitLabel: string;
  }>(),
  { busy: false },
);
const form = defineModel<OrganizationForm>({ required: true });
const emit = defineEmits<{ submit: [] }>();
const { t } = useI18n();
const fid = organizationFieldId;
const err = (field: string) => props.errors[field] ?? null;

const typeOptions = computed(() =>
  ORG_TYPES.map((v) => ({ value: v, label: t(`admin.organizations.types.${v}`) })),
);
const parents = computed(() => [
  { value: '', label: t('admin.organizations.noParent') },
  ...props.parentOptions,
]);
const timezones = computed(() =>
  timeZoneOptions([form.value.default_timezone, 'Europe/Brussels']).map((z) => ({
    value: z,
    label: z,
  })),
);

function addName() {
  form.value.names.push({ lang: '', text: '' });
  void nextTick(() =>
    document.getElementById(fid(nameField(form.value.names.length - 1, 'lang')))?.focus(),
  );
}
function removeName(index: number) {
  form.value.names.splice(index, 1);
  void nextTick(() => document.getElementById(fid('add-name'))?.focus());
}
</script>

<template>
  <form class="admin-form" novalidate @submit.prevent="emit('submit')">
    <fieldset class="admin-fieldset">
      <legend>{{ t('admin.organizations.sections.identity') }}</legend>
      <AdminInputField
        :id="fid('slug')"
        v-model="form.slug"
        :maxlength="40"
        :required="props.creating"
        :disabled="!props.creating"
        :label="t('admin.organizations.fields.slug')"
        :hint="
          props.creating
            ? t('admin.organizations.hints.slug')
            : t('admin.organizations.hints.slugImmutable')
        "
        :error="err('slug')"
      />
      <div class="admin-form__row">
        <AdminInputField
          :id="fid('org_type')"
          v-model="form.org_type"
          as="select"
          :options="typeOptions"
          :label="t('admin.organizations.fields.type')"
          :error="err('org_type')"
        />
        <AdminInputField
          :id="fid('parent_id')"
          v-model="form.parent_id"
          as="select"
          :options="parents"
          :label="t('admin.organizations.fields.parent')"
          :hint="t('admin.organizations.hints.parent')"
          :error="err('parent_id')"
        />
      </div>
      <AdminFieldError :id="`${fid('is_partner')}-error`" :message="err('is_partner')" />
      <p class="admin-check">
        <input
          :id="fid('is_partner')"
          v-model="form.is_partner"
          type="checkbox"
          :aria-describedby="
            [`${fid('is_partner')}-hint`, err('is_partner') ? `${fid('is_partner')}-error` : '']
              .filter(Boolean)
              .join(' ')
          "
          :aria-invalid="err('is_partner') ? 'true' : undefined"
        />
        <label :for="fid('is_partner')">{{ t('admin.organizations.fields.isPartner') }}</label>
      </p>
      <p :id="`${fid('is_partner')}-hint`" class="admin-hint">
        {{ t('admin.organizations.hints.isPartner') }}
      </p>
    </fieldset>

    <fieldset class="admin-fieldset">
      <legend>{{ t('admin.organizations.sections.names') }}</legend>
      <AdminInputField
        :id="fid(nameField(0, 'text'))"
        v-model="form.names[0]!.text"
        :maxlength="500"
        required
        lang="en"
        :label="t('admin.organizations.fields.nameEn')"
        :error="err(nameField(0, 'text'))"
      />
      <template v-for="(row, index) in form.names" :key="index">
        <div v-if="index > 0" class="admin-form__row admin-name-row">
          <AdminInputField
            :id="fid(nameField(index, 'lang'))"
            v-model="row.lang"
            :maxlength="35"
            required
            :label="t('admin.organizations.fields.nameLang', { n: index })"
            :hint="t('admin.organizations.hints.nameLang')"
            :error="err(nameField(index, 'lang'))"
          />
          <AdminInputField
            :id="fid(nameField(index, 'text'))"
            v-model="row.text"
            :maxlength="500"
            required
            :lang="row.lang || undefined"
            :label="t('admin.organizations.fields.nameText', { n: index })"
            :error="err(nameField(index, 'text'))"
          />
          <p class="admin-name-row__remove">
            <button type="button" class="button button--secondary" @click="removeName(index)">
              {{ t('admin.organizations.removeName', { n: index }) }}
            </button>
          </p>
        </div>
      </template>
      <p>
        <button
          :id="fid('add-name')"
          type="button"
          class="button button--secondary"
          @click="addName"
        >
          {{ t('admin.organizations.addName') }}
        </button>
      </p>
    </fieldset>

    <fieldset class="admin-fieldset">
      <legend>{{ t('admin.organizations.sections.identifiers') }}</legend>
      <div class="admin-form__row">
        <AdminInputField
          :id="fid('schac_home_organization')"
          v-model="form.schac_home_organization"
          :maxlength="253"
          :label="t('admin.organizations.fields.schac')"
          :hint="t('admin.organizations.hints.schac')"
          :error="err('schac_home_organization')"
        />
        <AdminInputField
          :id="fid('keycloak_idp_alias')"
          v-model="form.keycloak_idp_alias"
          :maxlength="40"
          :label="t('admin.organizations.fields.idpAlias')"
          :hint="t('admin.organizations.hints.idpAlias')"
          :error="err('keycloak_idp_alias')"
        />
      </div>
      <div class="admin-form__row">
        <AdminInputField
          :id="fid('erasmus_code')"
          v-model="form.erasmus_code"
          :maxlength="40"
          :label="t('admin.organizations.fields.erasmusCode')"
          :error="err('erasmus_code')"
        />
        <AdminInputField
          :id="fid('pic')"
          v-model="form.pic"
          inputmode="numeric"
          :maxlength="9"
          :label="t('admin.organizations.fields.pic')"
          :hint="t('admin.organizations.hints.pic')"
          :error="err('pic')"
        />
      </div>
      <AdminInputField
        :id="fid('ext_id')"
        v-model="form.ext_id"
        :maxlength="200"
        :label="t('admin.organizations.fields.extId')"
        :hint="t('admin.organizations.hints.extId')"
        :error="err('ext_id')"
      />
    </fieldset>

    <fieldset class="admin-fieldset">
      <legend>{{ t('admin.organizations.sections.settings') }}</legend>
      <div class="admin-form__row">
        <AdminInputField
          :id="fid('country_code')"
          v-model="form.country_code"
          :maxlength="2"
          :label="t('admin.organizations.fields.country')"
          :hint="t('admin.organizations.hints.country')"
          :error="err('country_code')"
        />
        <AdminInputField
          :id="fid('default_timezone')"
          v-model="form.default_timezone"
          as="select"
          :options="timezones"
          required
          :label="t('admin.organizations.fields.timezone')"
          :hint="t('admin.organizations.hints.timezone')"
          :error="err('default_timezone')"
        />
      </div>
      <AdminInputField
        :id="fid('ui_languages')"
        v-model="form.ui_languages"
        required
        :label="t('admin.organizations.fields.uiLanguages')"
        :hint="t('admin.organizations.hints.uiLanguages')"
        :error="err('ui_languages')"
      />
      <AdminInputField
        :id="fid('contact_email')"
        v-model="form.contact_email"
        type="email"
        inputmode="email"
        :maxlength="320"
        :label="t('admin.organizations.fields.contactEmail')"
        :error="err('contact_email')"
      />
      <div class="admin-form__row">
        <AdminInputField
          :id="fid('website_url')"
          v-model="form.website_url"
          type="url"
          inputmode="url"
          :maxlength="2048"
          :label="t('admin.organizations.fields.website')"
          :error="err('website_url')"
        />
        <AdminInputField
          :id="fid('logo_url')"
          v-model="form.logo_url"
          type="url"
          inputmode="url"
          :maxlength="2048"
          :label="t('admin.organizations.fields.logo')"
          :error="err('logo_url')"
        />
      </div>
    </fieldset>

    <p class="admin-actions">
      <button type="submit" class="button" :disabled="props.busy">
        {{ props.submitLabel }}
      </button>
    </p>
  </form>
</template>
