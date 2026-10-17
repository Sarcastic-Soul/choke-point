import { getDataset } from "@/lib/graph/dataset";
import { tenantFor } from "@/lib/tenant";

// GET /api/session : which graph this visitor works on. Calling it on page load also builds the sandbox copy,
// so the first trace does not wait for it.
export async function GET() {
  try {
    const tenant = await tenantFor();
    return Response.json({ sandbox: tenant !== undefined, dataset: await getDataset(tenant) });
  } catch (err) {
    console.error("session failed", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
