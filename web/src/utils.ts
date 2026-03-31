export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

export function formatBoolean(value: boolean): string {
  return value ? "Yes" : "No";
}
