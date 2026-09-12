const LINZ_STREET_ARCHIVE = 'https://stadtgeschichte.linz.at/strassennamen/index.php';

export function canonicalLinzStreetUrl(sourceId: string, historical: boolean) {
  const id = sourceId.trim();
  if (!/^\d+$/.test(id)) return undefined;
  return `${LINZ_STREET_ARCHIVE}?ID=${encodeURIComponent(id)}&action=strassendetail${historical ? '&hist=historisch' : ''}`;
}
