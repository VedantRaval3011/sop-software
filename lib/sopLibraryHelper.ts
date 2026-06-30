export function formatSOPDisplayName(sopName: string, identifier: string): string {
  const id = (identifier || "").trim().toUpperCase();
  const name = (sopName || "").trim();

  const cleanName = name.split("/").pop()?.trim() || name;

  if (!id && !cleanName) return "Unknown SOP";
  if (!id) return cleanName;
  if (!cleanName) return id;

  if (cleanName.toUpperCase().startsWith(id)) {
    return cleanName.toUpperCase();
  }

  // Strip leading identifier-like prefix from name (e.g. "QAGE01-07 - Procedure" → "Procedure")
  const nameWithoutId = cleanName.replace(/^[A-Z0-9][\w\-]*\s*[-_]\s*/i, "").trim();

  return `${id} - ${nameWithoutId || cleanName}`;
}
