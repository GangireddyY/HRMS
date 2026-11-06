/** Escapes LIKE/ILIKE wildcards so user input is matched literally, then wraps it for a "contains" search. */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
