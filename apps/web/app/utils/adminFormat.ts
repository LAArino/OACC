// SPDX-License-Identifier: EUPL-1.2
// Formatting and download helpers of the admin pages (client-only).

/** Date and time in the UI locale, e.g. "14 Oct 2026, 10:00"; empty for null. */
export function formatAdminDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function unit(locale: string, value: number, name: string, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
    maximumFractionDigits: digits,
  }).format(value);
}

/** A run duration: "850 ms", "12.4 sec", "3 min 05 sec"-style, locale-aware units. */
export function formatAdminDuration(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return unit(locale, ms, 'millisecond');
  if (ms < 60_000) return unit(locale, ms / 1000, 'second', 1);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${unit(locale, minutes, 'minute')} ${unit(locale, seconds, 'second')}`;
}

/** File size in kB/MB (decimal units). */
export function formatAdminBytes(bytes: number, locale: string): string {
  if (bytes < 1000) return unit(locale, bytes, 'byte');
  if (bytes < 1_000_000) return unit(locale, bytes / 1000, 'kilobyte', 1);
  return unit(locale, bytes / 1_000_000, 'megabyte', 1);
}

/** Saves a Blob through a temporary object URL (no data leaves the browser). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Let the download start before the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
