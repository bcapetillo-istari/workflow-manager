import type { IstariGateway } from '../gateway/types';
import type { CatalogEntry } from '../manifest/types';
import { validateManifest } from './manifestValidation';

/**
 * Lists the workflow-manager system, reads every `.json` file the user can see and validates it.
 * A manifest that cannot be read or fails validation becomes an InvalidManifest entry; only a failure
 * to list the system itself throws.
 */
export async function loadCatalog(gateway: IstariGateway, systemId: string): Promise<CatalogEntry[]> {
  const files = await gateway.listTrackedResources(systemId);
  const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
  const entries = await Promise.all(
    jsonFiles.map(async (file): Promise<CatalogEntry> => {
      const base = { resourceId: file.resourceId, revisionId: file.revisionId, fileName: file.name };
      try {
        const read = await gateway.readJson(file.resourceId);
        const result = validateManifest(read.data);
        return result.ok
          ? { ...base, revisionId: read.revisionId, ok: true, manifest: result.manifest }
          : { ...base, revisionId: read.revisionId, ok: false, errors: result.errors };
      } catch (err) {
        return {
          ...base,
          ok: false,
          errors: [`Could not read file: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    }),
  );
  return entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
