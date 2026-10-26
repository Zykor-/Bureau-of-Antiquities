export function normalizeSetSearch(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/['\u2018\u2019\u02bc\uff07]/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function findProjectSet(project, catalog, catalogById) {
  // An explicit link is authoritative, even if its record is no longer available.
  if (project.assembledItemId) return catalogById.get(project.assembledItemId);
  const key = normalizeSetSearch(project.title);
  if (!key) return undefined;
  const matches = catalog.filter(item => normalizeSetSearch(item.name) === key);
  // Never guess between distinct Airtable records with equivalent names.
  return matches.length === 1 ? matches[0] : undefined;
}
