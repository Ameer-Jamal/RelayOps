function getPathValue(source: unknown, pathExpression: string): unknown {
  const segments = pathExpression.split(".");
  let current: unknown = source;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return "";
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current ?? "";
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_match, expression) => {
    const value = getPathValue(context, expression);
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "string" ? value : JSON.stringify(value);
  });
}
