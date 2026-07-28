type ClassValue = string | false | null | undefined;

/** Joins class names and drops the falsy ones. */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
