// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// Shared components of the course wizard.
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import AdminCheckboxGroup from '../app/components/AdminCheckboxGroup.vue';
import AdminConfirm from '../app/components/AdminConfirm.vue';
import AdminErrorSummary from '../app/components/AdminErrorSummary.vue';
import AdminInputField from '../app/components/AdminInputField.vue';
import AdminLanguageTabs from '../app/components/AdminLanguageTabs.vue';
import AdminLifecycleBadge from '../app/components/AdminLifecycleBadge.vue';
import AdminOverrideField from '../app/components/AdminOverrideField.vue';
import AdminWizardSteps from '../app/components/AdminWizardSteps.vue';
import { axeViolations } from './helpers/catalogue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AdminWizardSteps', () => {
  it('marks the current step, disables unreachable ones and flags errors', async () => {
    const w = await mountSuspended(AdminWizardSteps, {
      props: { label: 'Steps', steps: ['A', 'B', 'C'], current: 1, reachable: 1, invalid: [0] },
    });
    const buttons = w.findAll('button');
    expect(w.find('nav').attributes('aria-label')).toBe('Steps');
    expect(buttons.map((b) => b.attributes('aria-current'))).toEqual([
      undefined,
      'step',
      undefined,
    ]);
    expect(buttons[2]!.attributes('disabled')).toBeDefined();
    expect(buttons[0]!.text()).toBe('1 A (has errors)');
    await buttons[0]!.trigger('click');
    expect(w.emitted('select')).toEqual([[0]]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminOverrideField', () => {
  const mount = (props: Record<string, unknown>) =>
    mountSuspended(AdminOverrideField, {
      props: { fieldId: 'f-ects', label: 'ECTS credits', source: '6', ...props },
      slots: {
        default: (slot: { disabled: boolean; describedBy?: string }) =>
          h('input', {
            id: 'f-ects',
            'aria-label': 'ECTS credits',
            disabled: slot.disabled,
            'aria-describedby': slot.describedBy,
          }),
      },
    });

  it('renders the bare control outside overrides mode', async () => {
    const w = await mount({ enabled: false });
    expect(w.find('input').attributes('disabled')).toBeUndefined();
    expect(w.find('.admin-override').exists()).toBe(false);
  });

  it('shows the source value and enables the control with the toggle', async () => {
    const w = await mount({ enabled: true, modelValue: false, stored: true });
    const control = w.find('#f-ects');
    expect(control.attributes('disabled')).toBeDefined();
    expect(control.attributes('aria-describedby')).toBe('f-ects-source');
    expect(w.find('#f-ects-source').text()).toBe("Source value (partner's OEAPI): 6");
    expect(w.find('label[for="f-ects-override"]').text()).toBe('Override ECTS credits');
    expect(w.text()).toContain('Saving reverts this field to the source value.');
    await w.find('#f-ects-override').setValue(true);
    expect(w.emitted('update:modelValue')).toEqual([[true]]);
    await w.setProps({ modelValue: true });
    expect(w.find('#f-ects').attributes('disabled')).toBeUndefined();
    expect(w.find('.admin-badge').text()).toBe('Overridden');
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminConfirm', () => {
  it('resolves to the choice and returns focus to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const w = await mountSuspended(AdminConfirm, { attachTo: document.body });
    const vm = w.vm as unknown as { ask: (o: object) => Promise<boolean> };
    const answer = vm.ask({ title: 'Delete?', message: 'Really?', confirmLabel: 'Delete' });
    await flushPromises();
    const dialog = w.find('dialog');
    expect(dialog.attributes('open')).toBeDefined();
    expect(w.find(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Delete?');
    expect(document.activeElement?.textContent?.trim()).toBe('Go back');
    expect(await axeViolations(w.html())).toEqual([]);
    await w.find('[data-confirm="yes"]').trigger('click');
    expect(await answer).toBe(true);
    expect(document.activeElement).toBe(opener);

    const second = vm.ask({ title: 'Again?', message: 'Sure?', confirmLabel: 'Yes' });
    await flushPromises();
    await w.find('dialog').trigger('cancel');
    expect(await second).toBe(false);
  });
});

describe('AdminCheckboxGroup', () => {
  it('is a labelled fieldset of native checkboxes keeping the options order', async () => {
    const w = await mountSuspended(AdminCheckboxGroup, {
      props: {
        id: 'modes',
        legend: 'Delivery modes',
        hint: 'Choose all that apply.',
        error: 'Choose at least one.',
        options: [
          { value: 'online', label: 'Online' },
          { value: 'hybrid', label: 'Hybrid' },
        ],
        modelValue: ['hybrid'],
      },
    });
    expect(w.find('legend').text()).toBe('Delivery modes');
    expect(w.find('fieldset').attributes('aria-describedby')).toBe('modes-hint modes-error');
    expect(w.find('label[for="modes-0"]').text()).toBe('Online');
    await w.find('#modes-0').setValue(true);
    expect(w.emitted('update:modelValue')).toEqual([[['online', 'hybrid']]]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminInputField', () => {
  it('links its hint and error and marks the control invalid', async () => {
    const w = await mountSuspended(AdminInputField, {
      props: {
        id: 'ects',
        label: 'ECTS credits',
        hint: 'Use a dot.',
        error: 'Enter a number.',
        required: true,
        modelValue: '',
      },
    });
    const input = w.find('input');
    expect(w.find('label').text()).toBe('ECTS credits (required)');
    expect(input.attributes('aria-describedby')).toBe('ects-hint ects-error');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(w.find('#ects-error').text()).toBe('Error: Enter a number.');
    await input.setValue('5');
    expect(w.emitted('update:modelValue')).toEqual([['5']]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminLanguageTabs', () => {
  it('follows the tabs pattern and adds and removes languages', async () => {
    const w = await mountSuspended(AdminLanguageTabs, {
      attachTo: document.body,
      props: {
        id: 'texts',
        label: 'Text languages',
        languages: ['en', 'ca'],
        available: [
          { tag: 'en', label: 'English' },
          { tag: 'ca', label: 'Catalan' },
          { tag: 'es', label: 'Spanish' },
        ],
        required: ['en'],
        modelValue: 'en',
      },
      slots: { default: (p: { lang: string }) => h('p', `Panel ${p.lang}`) },
    });
    const tabs = w.findAll('[role="tab"]');
    expect(w.find('[role="tablist"]').attributes('aria-label')).toBe('Text languages');
    expect(
      tabs.map((t) => [t.text(), t.attributes('aria-selected'), t.attributes('tabindex')]),
    ).toEqual([
      ['English (required)', 'true', '0'],
      ['Catalan', 'false', '-1'],
    ]);
    expect(w.find('[role="tabpanel"]').attributes('aria-labelledby')).toBe('texts-tab-en');
    expect(w.find('[role="tabpanel"]').text()).toContain('Panel en');
    expect(w.findAll('#texts-add option').map((o) => o.text())).toEqual([
      'Choose a language',
      'Spanish',
    ]);
    await tabs[0]!.trigger('keydown', { key: 'End' });
    expect(w.emitted('update:modelValue')).toEqual([['ca']]);
    await w.find('#texts-add').setValue('es');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Add')!
      .trigger('click');
    expect(w.emitted('add')).toEqual([['es']]);
    await w.setProps({ modelValue: 'ca' });
    await w
      .findAll('button')
      .find((b) => b.text() === 'Remove Catalan')!
      .trigger('click');
    expect(w.emitted('remove')).toEqual([['ca']]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminErrorSummary and AdminLifecycleBadge', () => {
  it('lists linked problems in a focused alert', async () => {
    const w = await mountSuspended(AdminErrorSummary, {
      attachTo: document.body,
      props: { heading: 'There is a problem', issues: [{ id: 'f-ects', message: 'ECTS: Enter.' }] },
    });
    expect(w.find('[role="alert"]').element).toBe(document.activeElement);
    expect(w.find('a').attributes('href')).toBe('#f-ects');
    await w.find('a').trigger('click');
    expect(w.emitted('select')).toEqual([['f-ects']]);
    const badge = await mountSuspended(AdminLifecycleBadge, { props: { status: 'withdrawn' } });
    expect(badge.text()).toBe('Withdrawn');
    expect(badge.classes()).toContain('admin-badge--warn');
  });
});
