export function normalizeName(name: string | undefined, internalName: string) {
  if (!name) {
    return internalName.substring(0, 40);
  }

  return name.substring(0, 40);
}
