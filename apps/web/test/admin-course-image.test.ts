// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// The course image card of the wizard [DL 27]: `PUT`/`PATCH`/`DELETE …/image`
// with a signed-in administrator (useAuth mocked) and the admin API answered by
// a fake `$fetch` (helpers/admin.ts).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCourseEditor from '../app/components/AdminCourseEditor.vue';
import AdminCourseImage from '../app/components/AdminCourseImage.vue';
import CoursePage from '../app/pages/(admin)/admin/courses/[id]/index.vue';
import type { AdminCourse } from '../app/types/admin';
import {
  createFakeFetch,
  type FakeRequest,
  fixtures,
  ORG_ID,
  problem,
  type Route,
} from './helpers/admin';
import { COURSE_ID, course, courseImage, history, reference } from './helpers/adminCourses';
import { axeViolations } from './helpers/catalogue';

const net = vi.hoisted(() => ({
  fetch: undefined as
    | undefined
    | (((...args: unknown[]) => unknown) & {
        create: (...args: unknown[]) => unknown;
      }),
}));
mockNuxtImport('$fetch', () =>
  Object.assign((...args: unknown[]) => net.fetch!(...args), {
    create: (...args: unknown[]) => net.fetch!.create(...args),
  }),
);

const auth = vi.hoisted(() => ({ signedIn: true, token: 'token-0', count: 0 }));
mockNuxtImport('useAuth', () => () => ({
  user: { value: null },
  isAuthenticated: {
    get value() {
      return auth.signedIn;
    },
  },
  accessToken: {
    get value() {
      return auth.signedIn ? auth.token : undefined;
    },
  },
  login: async () => undefined,
  logout: async () => undefined,
  handleCallback: async () => '/en/admin',
}));

const ME = 'GET /api/admin/v1/me';
const PUBLIC_REFERENCE = 'GET /api/public/v1/reference';
const REFERENCE = `GET /api/admin/v1/organizations/${ORG_ID}/reference`;
const COURSE = `GET /api/admin/v1/courses/${COURSE_ID}`;
const HISTORY = `GET /api/admin/v1/courses/${COURSE_ID}/history`;
const PUT_IMAGE = `PUT /api/admin/v1/courses/${COURSE_ID}/image`;
const PATCH_IMAGE = `PATCH /api/admin/v1/courses/${COURSE_ID}/image`;
const DELETE_IMAGE = `DELETE /api/admin/v1/courses/${COURSE_ID}/image`;
const SM_URL = `http://localhost:3000/media/courses/${COURSE_ID}/3f9a1c0d2b4e6a81.sm.webp`;

const ok =
  (body: unknown, status = 200): Route =>
  () => ({ status, body: structuredClone(body) });

let calls: FakeRequest[] = [];
function serve(routes: Record<string, Route>) {
  const fake = createFakeFetch({
    [ME]: ok(fixtures.me(['partner_admin'])),
    [PUBLIC_REFERENCE]: ok(fixtures.reference),
    [REFERENCE]: ok(reference()),
    [COURSE]: ok(course()),
    [HISTORY]: ok(history()),
    ...routes,
  });
  calls = fake.calls;
  net.fetch = fake.fetch;
}
const callsTo = (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key);
const imageCalls = () => calls.filter((c) => c.url.endsWith('/image'));

beforeEach(() => {
  auth.signedIn = true;
  auth.token = `token-${++auth.count}`;
  serve({});
});
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountCard(props: { course: AdminCourse; harvested?: boolean }) {
  const w = await mountSuspended(AdminCourseImage, { props, attachTo: document.body });
  mounted.push(w);
  await flushPromises();
  return w;
}
async function mountPage(component: unknown, route: string) {
  const w = await mountSuspended(component as never, { route, attachTo: document.body });
  mounted.push(w);
  await flushPromises();
  return w;
}
type Wrapper = Awaited<ReturnType<typeof mountCard>> | Awaited<ReturnType<typeof mountPage>>;

const buttonTexts = (w: Wrapper) => w.findAll('button').map((b) => b.text());
const button = (w: Wrapper, text: string) => {
  const found = w.findAll('button').find((b) => b.text() === text);
  if (!found) throw new Error(`No button "${text}" in: ${buttonTexts(w).join(' | ')}`);
  return found;
};
async function click(w: Wrapper, text: string) {
  await button(w, text).trigger('click');
  await flushPromises();
}
const byId = (w: Wrapper, id: string) => w.find(`[id="${id}"]`);

function imageFile(name = 'river.jpg', type = 'image/jpeg', size?: number): File {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}
async function choose(w: Wrapper, file: File) {
  const input = byId(w, 'course-image-file');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
}

describe('AdminCourseImage', () => {
  it('offers an upload when the course has no image', async () => {
    const w = await mountCard({ course: course() });
    expect(w.find('h3').text()).toBe('Image');
    expect(w.text()).toContain('This course has no image yet.');
    expect(w.find('img').exists()).toBe(false);
    expect(buttonTexts(w)).toEqual(['Upload image']);
    const input = byId(w, 'course-image-file');
    expect(input.attributes()).toMatchObject({
      type: 'file',
      name: 'file',
      accept: 'image/jpeg,image/png,image/webp',
      'aria-describedby': 'course-image-file-hint',
    });
    expect(w.find('label[for="course-image-file"]').text()).toBe('Image file');
    expect(byId(w, 'course-image-file-hint').text()).toContain('JPEG, PNG or WebP, at most 5 MB');
    expect(w.find('label[for="course-image-alt"]').text()).toContain('Alternative text (English)');
    expect(byId(w, 'course-image-alt').attributes('aria-required')).toBe('true');
    expect(byId(w, 'course-image-decorative').attributes('aria-describedby')).toBe(
      'course-image-decorative-hint',
    );
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('previews the current image with its text, credit and source', async () => {
    const w = await mountCard({ course: course({ image: courseImage() }) });
    const img = w.find('figure img');
    expect(img.attributes()).toMatchObject({
      src: SM_URL,
      alt: 'Students measuring a river with GPS receivers',
      width: '1600',
      height: '900',
    });
    const facts = w.find('figure dl').text();
    expect(facts).toContain('Students measuring a river with GPS receivers');
    expect(facts).toContain('Photo: URV, CC BY 4.0');
    expect(facts).toContain('1600 × 900 pixels');
    expect(facts).toContain('Uploaded file');
    expect((byId(w, 'course-image-alt').element as HTMLInputElement).value).toBe(
      'Students measuring a river with GPS receivers',
    );
    expect((byId(w, 'course-image-credit').element as HTMLInputElement).value).toBe(
      'Photo: URV, CC BY 4.0',
    );
    expect(buttonTexts(w)).toEqual(['Replace image', 'Save text', 'Remove image']);
    // Nothing changed yet.
    expect(button(w, 'Save text').attributes('disabled')).toBeDefined();
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('shows a decorative image with an empty alt and a CSV source', async () => {
    const w = await mountCard({
      course: course({
        image: courseImage({
          alt: {},
          decorative: true,
          credit: null,
          source_url: 'https://www.urv.cat/img/river.jpg',
        }),
      }),
      harvested: true,
    });
    expect(w.find('figure img').attributes('alt')).toBe('');
    expect(w.find('figure dl').text()).toContain('Decorative image (no alternative text)');
    expect(w.find('figure dl').text()).toContain(
      'Fetched from https://www.urv.cat/img/river.jpg (CSV upload)',
    );
    expect(w.text()).toContain('Images are never harvested');
    expect((byId(w, 'course-image-decorative').element as HTMLInputElement).checked).toBe(true);
    expect(byId(w, 'course-image-alt').attributes('disabled')).toBeDefined();
  });

  it('checks the file and the alternative text before any request', async () => {
    const w = await mountCard({ course: course() });
    await click(w, 'Upload image');
    expect(byId(w, 'course-image-file-error').text()).toContain('Choose an image file.');
    expect(byId(w, 'course-image-alt-error').text()).toContain(
      'Enter the alternative text, or tick “Decorative image”.',
    );
    expect(document.activeElement?.id).toBe('course-image-file');
    expect(byId(w, 'course-image-file').attributes('aria-describedby')).toBe(
      'course-image-file-hint course-image-file-error',
    );

    await choose(w, imageFile('anim.gif', 'image/gif'));
    expect(byId(w, 'course-image-file-error').text()).toContain(
      'Choose a JPEG, PNG or WebP image.',
    );
    await choose(w, imageFile('huge.png', 'image/png', 5 * 1024 * 1024 + 1));
    expect(byId(w, 'course-image-file-error').text()).toContain('larger than 5 MB');
    await click(w, 'Upload image');

    await choose(w, imageFile());
    expect(w.find('#course-image-file-error').exists()).toBe(false);
    await byId(w, 'course-image-credit').setValue('x'.repeat(301));
    await click(w, 'Upload image');
    expect(document.activeElement?.id).toBe('course-image-alt');
    expect(byId(w, 'course-image-credit-error').text()).toContain('Use at most 300 characters.');
    expect(imageCalls()).toEqual([]);
  });

  it('disables and clears the alternative text of a decorative image', async () => {
    const w = await mountCard({ course: course() });
    await byId(w, 'course-image-alt').setValue('A river');
    await byId(w, 'course-image-decorative').setValue(true);
    await flushPromises();
    const alt = byId(w, 'course-image-alt');
    expect((alt.element as HTMLInputElement).value).toBe('');
    expect(alt.attributes('disabled')).toBeDefined();
    expect(alt.attributes('aria-required')).toBeUndefined();
    await byId(w, 'course-image-decorative').setValue(false);
    await flushPromises();
    expect((byId(w, 'course-image-alt').element as HTMLInputElement).value).toBe('A river');
  });

  it('uploads the file as multipart, reads the course again and announces it', async () => {
    const stored = courseImage();
    serve({
      [PUT_IMAGE]: ok(stored),
      [COURSE]: ok(course({ image: stored })),
    });
    const w = await mountCard({ course: course() });
    const file = imageFile();
    await choose(w, file);
    await byId(w, 'course-image-alt').setValue('  A river  ');
    await byId(w, 'course-image-credit').setValue('Photo: URV');
    await click(w, 'Upload image');

    const [put] = callsTo(PUT_IMAGE);
    expect(put!.body).toBeInstanceOf(FormData);
    const form = put!.body as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('river.jpg');
    expect(form.get('alt_en')).toBe('A river');
    expect(form.get('decorative')).toBe('false');
    expect(form.get('credit')).toBe('Photo: URV');
    expect(put!.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer /) });
    expect(callsTo(COURSE)).toHaveLength(1);
    expect(w.emitted('changed')).toEqual([[course({ image: stored })]]);
    const status = w.find('.admin-message[role="status"]');
    expect(status.text()).toBe('Image uploaded.');
    expect(document.activeElement).toBe(status.element);
    expect((byId(w, 'course-image-file').element as HTMLInputElement).value).toBe('');
  });

  it('sends a decorative image without alternative text', async () => {
    serve({ [PUT_IMAGE]: ok(courseImage({ alt: {}, decorative: true })) });
    const w = await mountCard({ course: course() });
    await choose(w, imageFile('pattern.webp', 'image/webp'));
    await byId(w, 'course-image-decorative').setValue(true);
    await click(w, 'Upload image');
    const form = callsTo(PUT_IMAGE)[0]!.body as FormData;
    expect(form.has('alt_en')).toBe(false);
    expect(form.get('decorative')).toBe('true');
    expect(form.has('credit')).toBe(false);
  });

  it('saves changed text with PATCH only when something changed', async () => {
    const stored = courseImage({ alt: { en: 'Old text', ca: 'Text antic' } });
    serve({ [PATCH_IMAGE]: ok({ ...stored, alt: { en: 'New text', ca: 'Text antic' } }) });
    const w = await mountCard({ course: course({ image: stored }) });
    await byId(w, 'course-image-alt').setValue('New text');
    await byId(w, 'course-image-credit').setValue('');
    expect(button(w, 'Save text').attributes('disabled')).toBeUndefined();
    await click(w, 'Save text');
    expect(callsTo(PATCH_IMAGE).map((c) => c.body)).toEqual([
      { alt: { en: 'New text', ca: 'Text antic' }, decorative: false, credit: null },
    ]);
    expect(w.find('.admin-message[role="status"]').text()).toBe('Image text saved.');
    expect(callsTo(PUT_IMAGE)).toEqual([]);
  });

  it('removes the image only after the confirmation', async () => {
    serve({ [DELETE_IMAGE]: () => ({ status: 204, body: undefined }) });
    const w = await mountCard({ course: course({ image: courseImage() }) });
    await click(w, 'Remove image');
    const dialog = w.find('dialog');
    expect(dialog.attributes('open')).toBeDefined();
    expect(dialog.text()).toContain('Remove the image?');
    expect(dialog.text()).toContain('The image of TEST-101 is deleted from OACC');
    await w.find('[data-confirm="no"]').trigger('click');
    await flushPromises();
    expect(callsTo(DELETE_IMAGE)).toEqual([]);

    await click(w, 'Remove image');
    await w.find('[data-confirm="yes"]').trigger('click');
    await flushPromises();
    expect(callsTo(DELETE_IMAGE)).toHaveLength(1);
    expect(callsTo(COURSE)).toHaveLength(1);
    expect(w.find('.admin-message[role="status"]').text()).toBe('Image removed.');
  });

  it('explains a refused upload through the problem component', async () => {
    serve({
      [PUT_IMAGE]: () => ({ status: 413, body: problem(413, 'oecp.media.too_large') }),
    });
    const w = await mountCard({ course: course() });
    await choose(w, imageFile());
    await byId(w, 'course-image-alt').setValue('A river');
    await click(w, 'Upload image');
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain('The image could not be saved.');
    expect(alert.text()).toContain('The image is larger than 5 MB. Choose a smaller file.');
    expect(alert.text()).toContain('oecp.media.too_large');
    expect(document.activeElement).toBe(alert.element);
    expect(w.emitted('changed')).toBeUndefined();
    expect(callsTo(COURSE)).toEqual([]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('course wizard: image card', () => {
  async function reviewStep(w: Wrapper) {
    await click(w, '4 Review and status');
  }

  it('sits in the Review step of an existing course and keeps unsaved edits', async () => {
    const stored = courseImage();
    let current = course();
    serve({
      [PUT_IMAGE]: () => {
        current = course({ image: stored });
        return { status: 200, body: structuredClone(stored) };
      },
      [COURSE]: () => ({ status: 200, body: structuredClone(current) }),
    });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    // An unsaved edit in step 1.
    await byId(w, 'course-ects').setValue('7.5');
    await reviewStep(w);
    expect(w.find('.admin-course-image h3').text()).toBe('Image');
    expect(callsTo(HISTORY)).toHaveLength(1);
    await choose(w, imageFile());
    await byId(w, 'course-image-alt').setValue('A river');
    await click(w, 'Upload image');
    expect(callsTo(PUT_IMAGE)).toHaveLength(1);
    // The page shows the new image and reads the history again.
    expect(w.find('.admin-course-image figure img').attributes('src')).toBe(SM_URL);
    expect(callsTo(COURSE)).toHaveLength(2);
    expect(callsTo(HISTORY)).toHaveLength(2);
    await click(w, '1 Basics');
    expect((byId(w, 'course-ects').element as HTMLInputElement).value).toBe('7.5');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('asks to save a new course first', async () => {
    const w = await mountSuspended(AdminCourseEditor, {
      props: { orgId: ORG_ID, reference: reference(), course: null },
    });
    mounted.push(w);
    // The Review step of a new course (reached after the three validated steps).
    (w.vm as unknown as { step: number }).step = 3;
    await flushPromises();
    expect(w.find('#course-step-heading').text()).toBe('Step 4 of 4: Review and status');
    const card = w.find('[aria-labelledby="course-image-heading"]');
    expect(card.find('h3').text()).toBe('Image');
    expect(card.text()).toContain(
      'Save the course first: the image can be added once the course exists.',
    );
    expect(w.find('#course-image-file').exists()).toBe(false);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});
