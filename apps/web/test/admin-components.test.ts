// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDropZone from '../app/components/AdminDropZone.vue';
import AdminIssuesTable from '../app/components/AdminIssuesTable.vue';
import AdminRunSummary from '../app/components/AdminRunSummary.vue';
import AdminStatusBadge from '../app/components/AdminStatusBadge.vue';
import type { AdminIssue } from '../app/utils/csvConsole';
import { csvFile, fixtures } from './helpers/admin';
import { axeViolations } from './helpers/catalogue';

const ISSUES: AdminIssue[] = [
  {
    severity: 'error',
    code: 'oecp.csv.invalid_number',
    file: 'courses',
    row: 2,
    column: 'ects',
    message: 'Invalid number',
  },
  {
    severity: 'warning',
    code: 'oecp.csv.no_data_rows',
    file: 'offerings',
    row: 1,
    message: 'File has a header but no rows',
  },
  {
    severity: 'error',
    code: 'oecp.csv.encoding',
    file: 'offerings',
    message: 'File is not valid UTF-8',
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminDropZone', () => {
  const mount = (props: Record<string, unknown> = {}) =>
    mountSuspended(AdminDropZone, { props: { hint: 'Up to two CSV files.', ...props } });

  it('is a keyboard-operable button described by the hint, with a labelled file input', async () => {
    const w = await mount();
    const target = w.find('[role="button"]');
    expect(target.attributes('tabindex')).toBe('0');
    const hint = w.find(`#${target.attributes('aria-describedby')}`);
    expect(hint.text()).toBe('Up to two CSV files.');
    const input = w.find('input[type="file"]');
    expect(input.attributes('accept')).toBe('.csv,text/csv');
    expect(input.attributes('multiple')).toBeDefined();
    expect(w.find(`label[for="${input.attributes('id')}"]`).text()).toBe('Or choose CSV files');
  });

  it('opens the file chooser on Enter, Space and click', async () => {
    const w = await mount();
    const click = vi.spyOn(w.find('input').element as HTMLInputElement, 'click');
    const target = w.find('[role="button"]');
    await target.trigger('keydown', { key: 'Enter' });
    await target.trigger('keydown', { key: ' ' });
    await target.trigger('keydown', { key: 'a' });
    await target.trigger('click');
    expect(click).toHaveBeenCalledTimes(3);
  });

  it('emits the files chosen with the input and clears it', async () => {
    const w = await mount();
    const input = w.find('input').element as HTMLInputElement;
    const file = csvFile('a', 'courses.csv');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await w.find('input').trigger('change');
    expect(w.emitted('select')).toEqual([[[file]]]);
  });

  it('emits dropped files and shows the drag state', async () => {
    const w = await mount();
    const target = w.find('[role="button"]');
    await target.trigger('dragover', { dataTransfer: { dropEffect: 'none' } });
    expect(target.classes()).toContain('admin-dropzone__target--active');
    const files = [csvFile('a', 'a.csv'), csvFile('b', 'b.csv')];
    await target.trigger('drop', { dataTransfer: { files } });
    expect(target.classes()).not.toContain('admin-dropzone__target--active');
    expect(w.emitted('select')).toEqual([[files]]);
  });

  it('ignores input while disabled', async () => {
    const w = await mount({ disabled: true });
    const click = vi.spyOn(w.find('input').element as HTMLInputElement, 'click');
    const target = w.find('[role="button"]');
    expect(target.attributes()).toMatchObject({ tabindex: '-1', 'aria-disabled': 'true' });
    await target.trigger('keydown', { key: 'Enter' });
    await target.trigger('drop', { dataTransfer: { files: [csvFile('a', 'a.csv')] } });
    expect(click).not.toHaveBeenCalled();
    expect(w.emitted('select')).toBeUndefined();
    expect(w.find('input').attributes('disabled')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const w = await mount();
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminIssuesTable', () => {
  const mount = (props: Record<string, unknown> = {}) =>
    mountSuspended(AdminIssuesTable, {
      props: { issues: ISSUES, caption: 'Issues found in your files', ...props },
    });

  it('renders a captioned table with column headers', async () => {
    const w = await mount();
    expect(w.find('caption').text()).toBe('Issues found in your files');
    expect(w.findAll('thead th').map((th) => [th.text(), th.attributes('scope')])).toEqual([
      ['Severity', 'col'],
      ['File', 'col'],
      ['Row', 'col'],
      ['Column', 'col'],
      ['Code', 'col'],
      ['Message', 'col'],
    ]);
    const first = w
      .findAll('tbody tr')[0]!
      .findAll('td')
      .map((td) => td.text());
    expect(first).toEqual([
      'Error',
      'courses.csv',
      '2',
      'ects',
      'oecp.csv.invalid_number',
      'Invalid number',
    ]);
    expect(w.find('[role="status"]').text()).toBe('Showing 3 of 3 issues.');
  });

  it('filters by severity locally', async () => {
    const w = await mount();
    await w.find('select').setValue('warning');
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.find('tbody').text()).toContain('oecp.csv.no_data_rows');
    expect(w.find('[role="status"]').text()).toBe('Showing 1 of 3 issues.');
    await w.find('select').setValue('error');
    expect(w.findAll('tbody tr')).toHaveLength(2);
    expect(w.emitted('update:severity')).toEqual([['warning'], ['error']]);
  });

  it('leaves filtering to the parent in server mode', async () => {
    const w = await mount({ localFilter: false, total: 120, severity: 'error' });
    expect((w.find('select').element as HTMLSelectElement).value).toBe('error');
    await w.find('select').setValue('warning');
    expect(w.findAll('tbody tr')).toHaveLength(3);
    expect(w.emitted('update:severity')).toEqual([['warning']]);
    expect(w.find('[role="status"]').text()).toBe('Showing 3 of 120 issues.');
  });

  it('downloads the CSV report through an object URL', async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob);
      return 'blob:report';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    const w = await mount({ downloadName: 'report.csv' });
    await w.find('button').trigger('click');
    expect(clicked).toEqual(['report.csv']);
    const text = await created[0]!.text();
    expect(text).toContain('file,row,column,severity,code,message');
    expect(text).toContain('offerings,,,error,oecp.csv.encoding,File is not valid UTF-8');
  });

  it('has no download button without a file name, and an empty state', async () => {
    const w = await mount({ issues: [] });
    expect(w.find('button').exists()).toBe(false);
    expect(w.find('table').exists()).toBe(false);
    expect(w.text()).toContain('No issues to show.');
  });

  it('has no axe violations', async () => {
    const w = await mount({ downloadName: 'r.csv' });
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('AdminStatusBadge and AdminRunSummary', () => {
  it.each([
    ['succeeded', 'Succeeded', 'ok'],
    ['failed', 'Failed', 'bad'],
    ['partial', 'Partly succeeded', 'warn'],
    ['queued', 'Queued', 'neutral'],
  ])('labels %s', async (status, label, tone) => {
    const w = await mountSuspended(AdminStatusBadge, { props: { status } });
    expect(w.text()).toBe(label);
    expect(w.classes()).toContain(`admin-badge--${tone}`);
  });

  it('summarizes a run with counters, duration and link', async () => {
    const w = await mountSuspended(AdminRunSummary, {
      props: {
        run: { ...fixtures.run({ error_summary: 'All good' }), upload_object_key: 'org/run' },
        to: '/en/admin/sync-runs/x',
      },
    });
    const pairs = Object.fromEntries(
      w.findAll('dt').map((dt, i) => [dt.text(), w.findAll('dd')[i]!.text()]),
    );
    expect(pairs).toMatchObject({
      Status: 'Succeeded',
      Channel: 'CSV upload',
      Trigger: 'Upload',
      Created: '2',
      Updated: '1',
      Unchanged: '3',
      Rejected: '0',
      Withdrawn: '0',
      'Uploaded files': 'org/run',
      Message: 'All good',
    });
    expect(pairs.Duration).toMatch(/2\.5\s?sec/);
    expect(w.find('a').attributes('href')).toBe('/en/admin/sync-runs/x');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('lists the original CSV file names when the run has them', async () => {
    const w = await mountSuspended(AdminRunSummary, {
      props: {
        run: {
          ...fixtures.run({ files: { courses: 'x.csv', offerings: 'y.csv' } }),
          upload_object_key: 'org/run',
        },
      },
    });
    const files = w.findAll('dt').find((dt) => dt.text() === 'Uploaded files')!;
    const dd = files.element.nextElementSibling as HTMLElement;
    expect([...dd.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Courses (courses.csv): x.csv',
      'Offerings (offerings.csv): y.csv',
    ]);
    expect(w.text()).not.toContain('org/run');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('lists only the files the run has, and falls back to the upload key without names', async () => {
    const one = await mountSuspended(AdminRunSummary, {
      props: { run: fixtures.run({ files: { offerings: 'only-offerings.csv' } }) },
    });
    expect(one.findAll('.admin-run-summary__files li').map((li) => li.text())).toEqual([
      'Offerings (offerings.csv): only-offerings.csv',
    ]);
    const old = await mountSuspended(AdminRunSummary, {
      props: { run: { ...fixtures.run({ files: null }), upload_object_key: 'org/run' } },
    });
    expect(old.find('.admin-run-summary__files').exists()).toBe(false);
    const dd = old.findAll('dt').find((dt) => dt.text() === 'Uploaded files')!.element
      .nextElementSibling as HTMLElement;
    expect(dd.textContent?.trim()).toBe('org/run');
  });
});
