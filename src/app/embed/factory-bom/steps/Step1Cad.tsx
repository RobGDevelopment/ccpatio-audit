import { CadUploadDropzone } from "@/app/admin/factory-bom/CadUploadDropzone";
import { assemblyBadge } from "@/app/admin/factory-bom/factory-bom-ui";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";

type GeometryFailure = { name?: string; reason?: string };

export function step1AllowsContinue(snapshot: AirlockSnapshot, originalName: string): boolean {
  const name = originalName.trim();
  if (!name) return false;
  const cad = snapshot.cadUpload;
  if (!cad || (cad.ext !== "dae" && cad.ext !== "glb")) return false;
  if (cad.status === "draft_ready") return true;
  return cad.status === "failed" && (cad.error_message ?? "").startsWith("GEOM_HYGIENE");
}

export function Step1Cad({
  snapshot,
  originalName,
  itemType,
  isPending,
}: {
  snapshot: AirlockSnapshot;
  originalName: string;
  itemType: string;
  isPending: boolean;
}) {
  const cad = snapshot.cadUpload;
  const geomSnap = cad?.geometry_snapshot as { failures?: GeometryFailure[]; rejected?: GeometryFailure[] } | null;
  const isGeomHygiene = Boolean(cad?.error_message?.startsWith("GEOM_HYGIENE"));
  const rejected = Array.isArray(geomSnap?.failures)
    ? geomSnap.failures
    : Array.isArray(geomSnap?.rejected)
      ? geomSnap.rejected
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-slate-800">{snapshot.rootSku}</h2>
        <p className="text-sm text-slate-600">{originalName}</p>
        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded uppercase">
          {assemblyBadge(snapshot.rootSku, itemType)}
        </span>
      </div>

      <div className="max-w-xl">
        <CadUploadDropzone
          globalSku={snapshot.rootSku}
          isPending={isPending}
          onDraftReady={() => {
            window.location.reload();
          }}
        />
      </div>

      {cad?.error_message && (
        <div className="p-4 bg-red-50 text-red-800 rounded-lg border border-red-200">
          <p className="font-semibold mb-2">Upload Error</p>
          <p className="text-sm">{cad.error_message}</p>
          
          {isGeomHygiene && (
            <div className="mt-4">
              <p className="text-sm font-semibold mb-1">Rejected Geometry Nodes:</p>
              <ul className="list-disc pl-5 text-sm">
                {rejected.map((r, i) => (
                  <li key={`${r.name ?? "node"}-${i}`}>{r.name} - {r.reason}</li>
                ))}
              </ul>
              <p className="text-xs text-red-600 mt-2">
                GEOM_HYGIENE does not block Continue. Enter the cut list manually on the next step.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
