import { verifyCutCardToken } from "@/server/factory-bom/cut-card-token";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { custom_build_jobs } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function CutCardPage({ params }: { params: { token: string } }) {
  const payload = verifyCutCardToken(params.token);
  if (!payload) return notFound();

  const db = getDb();
  const job = await db.query.custom_build_jobs.findFirst({
    where: eq(custom_build_jobs.id, payload.jobId),
  });

  if (!job) return notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      <h1 className="text-3xl font-bold mb-2">Cut Card</h1>
      <h2 className="text-xl text-gray-700 mb-1">{job.display_name}</h2>
      <p className="text-gray-500 mb-8 text-sm font-mono">SKU: {payload.globalSku}</p>
      
      {job.packet_storage_path ? (
        <iframe
          src={job.packet_storage_path}
          className="w-full h-[80vh] border border-gray-200 rounded-lg shadow-sm"
          title="Cut Card Document"
        />
      ) : (
        <div className="bg-amber-50 p-4 rounded-md text-amber-800 border border-amber-200">
          No PDF packet attached to this custom job.
        </div>
      )}
    </div>
  );
}
