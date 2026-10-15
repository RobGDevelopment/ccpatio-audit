"use client";

import React, { useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DropStep } from "./DropStep";
import { IntentStep, type IntakeIntent } from "./IntentStep";
import { ClientDetailsStep } from "./ClientDetailsStep";
import { CatalogDetailsStep } from "./CatalogDetailsStep";
import { UploadProgress, type StageName } from "./UploadProgress";
import { sha256Hex, type GlbSummary } from "@/lib/intake/glb-summary";
import type { TaxonomyEntry } from "@/server/factory-bom/intake/taxonomy";
import type { IntakeClientInput, IntakeCatalogInput } from "@/lib/intake/types";
import {
  createIntakeAction,
  requestIntakeUploadsAction,
  confirmCadUploadAction,
  confirmPacketUploadAction,
} from "@/app/embed/factory-bom/actions";

interface IntakeWizardProps {
  reportedUserEmail?: string;
  collections: TaxonomyEntry[];
  categories: TaxonomyEntry[];
  initialOpportunityId?: string;
}

export function IntakeWizard({
  reportedUserEmail,
  collections,
  categories,
  initialOpportunityId,
}: IntakeWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [screen, setScreen] = useState<1 | 2 | 3 | "progress">(1);
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [packetFile, setPacketFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<GlbSummary | null>(null);
  const [intent, setIntent] = useState<IntakeIntent | null>(
    initialOpportunityId ? "client_project" : null
  );

  // Upload and progress state
  const [createdSku, setCreatedSku] = useState<string>("");
  const [stage, setStage] = useState<StageName>("saving");
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [errorRef, setErrorRef] = useState<string>("");
  const [failedPhase, setFailedPhase] = useState<"create" | "upload" | "confirm" | null>(null);

  const lastClientInputRef = useRef<IntakeClientInput | null>(null);
  const lastCatalogInputRef = useRef<IntakeCatalogInput | null>(null);

  const navigateToSku = (sku: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("embedKey");
    params.set("sku", sku);
    if (initialOpportunityId) {
      params.set("opportunityId", initialOpportunityId);
    }
    if (reportedUserEmail) {
      params.set("ghlUserEmail", reportedUserEmail);
    }
    router.push(`/embed/factory-bom?${params.toString()}`);
  };

  const uploadFileWithXhr = (
    url: string,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network upload error"));
      xhr.send(file);
    });
  };

  const runUploads = async (
    sku: string,
    intakeKey: string,
    cad: File,
    packet: File | null
  ) => {
    setStage("uploading");
    setUploadPercent(5);
    setErrorMessage("");
    setErrorRef("");
    setFailedPhase(null);

    try {
      // 1. Compute sha256Hex of CAD file for idempotency
      const cadSha256 = await sha256Hex(cad);

      // 2. Request signed URLs for CAD and packet
      const planRes = await requestIntakeUploadsAction({
        intakeKey,
        sku,
        cad: {
          filename: cad.name,
          byteSize: cad.size,
          sha256: cadSha256,
        },
        packet: packet
          ? {
              filename: packet.name,
              byteSize: packet.size,
            }
          : undefined,
        reportedUserEmail,
      });

      if (!planRes.ok) {
        setStage("error");
        setFailedPhase("upload");
        setErrorMessage(planRes.message);
        setErrorRef(planRes.ref);
        return;
      }

      const { cad: cadPlan, packet: packetPlan } = planRes.data;

      // 3. Upload CAD if not reused
      if (!cadPlan.reused && "signedUrl" in cadPlan) {
        await uploadFileWithXhr(cadPlan.signedUrl, cad, (pct) => {
          setUploadPercent(Math.round(pct * 0.7));
        });

        // Confirm CAD upload
        const confirmCad = await confirmCadUploadAction({
          uploadId: cadPlan.uploadId,
          reportedUserEmail,
        });

        if (!confirmCad.ok) {
          setStage("error");
          setFailedPhase("confirm");
          setErrorMessage(confirmCad.message);
          setErrorRef(confirmCad.ref);
          return;
        }
      } else {
        setUploadPercent(70);
      }

      // 4. Upload Packet if present
      if (packet && packetPlan) {
        await uploadFileWithXhr(packetPlan.uploadUrl, packet, (pct) => {
          setUploadPercent(70 + Math.round(pct * 0.3));
        });

        // Confirm Packet upload
        const confirmPacket = await confirmPacketUploadAction({
          sku,
          storagePath: packetPlan.storagePath,
          originalFilename: packet.name,
          reportedUserEmail,
        });

        if (!confirmPacket.ok) {
          setStage("error");
          setFailedPhase("confirm");
          setErrorMessage(confirmPacket.message);
          setErrorRef(confirmPacket.ref);
          return;
        }
      }

      setUploadPercent(100);
      setStage("waiting");
    } catch (err: unknown) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(JSON.stringify({
        tag: "intake-wizard-upload-error",
        ref,
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
      setStage("error");
      setFailedPhase("upload");
      setErrorMessage("The file upload didn't finish. Please try again.");
      setErrorRef(ref);
    }
  };

  const handleClientSubmit = async (input: IntakeClientInput) => {
    if (!cadFile) return;

    lastClientInputRef.current = input;
    setScreen("progress");
    setStage("saving");
    setErrorMessage("");
    setErrorRef("");
    setFailedPhase(null);

    try {
      const res = await createIntakeAction({
        ...input,
        reportedUserEmail,
      });

      if (!res.ok) {
        setStage("error");
        setFailedPhase("create");
        setErrorMessage(res.message);
        setErrorRef(res.ref);
        return;
      }

      setCreatedSku(res.data.sku);
      await runUploads(res.data.sku, input.intakeKey, cadFile, packetFile);
    } catch (err: unknown) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(JSON.stringify({
        tag: "intake-wizard-create-client-error",
        ref,
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
      setStage("error");
      setFailedPhase("create");
      setErrorMessage("Could not create piece. Please try again.");
      setErrorRef(ref);
    }
  };

  const handleCatalogSubmit = async (input: IntakeCatalogInput) => {
    if (!cadFile) return;

    lastCatalogInputRef.current = input;
    setScreen("progress");
    setStage("saving");
    setErrorMessage("");
    setErrorRef("");
    setFailedPhase(null);

    try {
      const res = await createIntakeAction({
        ...input,
        reportedUserEmail,
      });

      if (!res.ok) {
        setStage("error");
        setFailedPhase("create");
        setErrorMessage(res.message);
        setErrorRef(res.ref);
        return;
      }

      setCreatedSku(res.data.sku);
      await runUploads(res.data.sku, input.intakeKey, cadFile, packetFile);
    } catch (err: unknown) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(JSON.stringify({
        tag: "intake-wizard-create-catalog-error",
        ref,
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
      setStage("error");
      setFailedPhase("create");
      setErrorMessage("Could not create catalog product. Please try again.");
      setErrorRef(ref);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-4">
      {screen === 1 && (
        <DropStep
          initialCadFile={cadFile}
          initialPacketFile={packetFile}
          initialSummary={summary}
          onNext={(data) => {
            setCadFile(data.cadFile);
            setPacketFile(data.packetFile);
            setSummary(data.summary);
            setScreen(2);
          }}
        />
      )}

      {screen === 2 && (
        <IntentStep
          initialIntent={intent}
          hasOpportunityParam={Boolean(initialOpportunityId)}
          onBack={() => setScreen(1)}
          onSelectIntent={(selectedIntent) => {
            setIntent(selectedIntent);
            setScreen(3);
          }}
        />
      )}

      {screen === 3 && intent === "client_project" && cadFile && (
        <ClientDetailsStep
          cadFile={cadFile}
          packetFile={packetFile}
          onPacketChange={(file) => setPacketFile(file)}
          onBack={() => setScreen(2)}
          onSubmit={handleClientSubmit}
        />
      )}

      {screen === 3 && intent === "catalog" && cadFile && (
        <CatalogDetailsStep
          cadFile={cadFile}
          packetFile={packetFile}
          summary={summary}
          collections={collections}
          categories={categories}
          onPacketChange={(file) => setPacketFile(file)}
          onBack={() => setScreen(2)}
          onSubmit={handleCatalogSubmit}
        />
      )}

      {screen === "progress" && (
        <UploadProgress
          sku={createdSku}
          stage={stage}
          uploadPercent={uploadPercent}
          errorMessage={errorMessage}
          errorRef={errorRef}
          onRetry={() => {
            if (failedPhase === "create") {
              if (intent === "client_project" && lastClientInputRef.current) {
                handleClientSubmit(lastClientInputRef.current);
              } else if (intent === "catalog" && lastCatalogInputRef.current) {
                handleCatalogSubmit(lastCatalogInputRef.current);
              }
            } else {
              if (cadFile && createdSku) {
                runUploads(createdSku, crypto.randomUUID(), cadFile, packetFile);
              }
            }
          }}
          onBack={() => {
            setScreen(3);
          }}
          onComplete={() => navigateToSku(createdSku)}
        />
      )}
    </div>
  );
}
