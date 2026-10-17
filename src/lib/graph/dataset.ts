import { getGraph } from "./client";

export interface DatasetInfo {
  name: string;
  custom: boolean;
}

export const DEFAULT_DATASET: DatasetInfo = { name: "Northwind Freight", custom: false };

// Which data this tenant graph holds. Only an import writes the :Meta node, so no node means the demo company.
export async function getDataset(tenant?: string): Promise<DatasetInfo> {
  try {
    const g = await getGraph(tenant);
    const res = await g.roQuery(`MATCH (m:Meta {k: 'dataset'}) RETURN m.name AS name, m.custom AS custom LIMIT 1`);
    const row = res.data?.[0] as { name?: string; custom?: boolean } | undefined;
    if (!row) return DEFAULT_DATASET;
    return { name: String(row.name ?? "Your data"), custom: Boolean(row.custom) };
  } catch {
    // graph missing or unreachable: the page treats it as the demo
    return DEFAULT_DATASET;
  }
}
