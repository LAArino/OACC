// SPDX-License-Identifier: EUPL-1.2
// A one-shot result message carried to the next admin page (e.g. "Course
// created" after the wizard navigates to the new course). Kept in memory only.
export function useAdminFlash() {
  const flash = useState<string | null>('admin-flash', () => null);
  return {
    set(message: string) {
      flash.value = message;
    },
    /** The pending message, cleared once read. */
    take(): string | null {
      const message = flash.value;
      flash.value = null;
      return message;
    },
  };
}
