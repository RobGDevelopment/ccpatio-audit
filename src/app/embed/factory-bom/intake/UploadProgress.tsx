"use client";

import React, { useState, useEffect, useRef } from "react";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { GoldBeam } from "@/components/ui/GoldBeam";
import { getIntakeProgressAction } from "@/app/embed/factory-bom/actions";
import type { CadUploadStatus } from "@/server/db/schema";

export type StageName =
  | "saving"
  | "uploading"
  | "waiting"
  | "processing"
  | "done"
  | "error";

interface UploadProgressProps {
  sku: string;
  stage: StageName;
  uploadPercent?: number;
  errorMessage?: string;
  errorRef?: string;
  onRetry?: () => void;
  onBack?: () => void;
  onComplete?: () => void;
}

export function UploadProgress({
  sku,
  stage: initialStage,
  uploadPercent = 0,
  errorMessage,
  errorRef,
  onRetry,
  onBack,
  onComplete,
}: UploadProgressProps) {
  const [stage, setStage] = useState<StageName>(initialStage);
  const [isSlow, setIsSlow] = useState(false);
  const [cadStatus, setCadStatus] = useState<CadUploadStatus | null>(null);
  const [pollError, setPollError] = useState<{ message: string; ref?: string } | null>(null);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const startedAtRef = useRef<number>(Date.now());
  const consecutiveFailuresRef = useRef<number>(0);

  useEffect(() => {
    setStage(initialStage);
    setPollError(null);
    setIsSlow(false);
    consecutiveFailuresRef.current = 0;
    if (initialStage === "waiting" || initialStage === "processing") {
      startedAtRef.current = Date.now();
    }
  }, [initialStage]);

  useEffect(() => {
    if (stage !== "waiting" && stage !== "processing") return;

    let delay = 2000;
    let timer: NodeJS.Timeout;
    let active = true;

    const poll = async () => {
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed > 60_000) {
        setIsSlow(true);
        delay = Math.min(delay * 1.5, 10_000);
      }

      if (elapsed >= 120_000) {
        setStage("error");
        setPollError({
          message: "Processing timed out. Please try again or contact support.",
        });
        return;
      }

      try {
        const res = await getIntakeProgressAction({ sku });
        if (!active) return;
        if (!res.ok) {
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current >= 3) {
            setStage("error");
            setPollError({
              message: res.message,
              ref: res.ref,
            });
            return;
          }
        } else {
          consecutiveFailuresRef.current = 0;
          if (res.data.cadUpload) {
            const status = res.data.cadUpload.status;
            setCadStatus(status);

            if (status === "draft_ready") {
              setStage("done");
              onCompleteRef.current?.();
              return;
            } else if (status === "failed") {
              setStage("error");
              setPollError({
                message: "3D model processing failed. Please try another file.",
              });
              return;
            } else if (status === "processing") {
              setStage("processing");
            }
          }
        }
      } catch (err: unknown) {
        if (!active) return;
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 3) {
          setStage("error");
          setPollError({
            message: "Unable to retrieve progress after multiple attempts. Please check your connection or retry.",
          });
          return;
        }
      }

      if (active) {
        timer = setTimeout(poll, delay);
      }
    };

    timer = setTimeout(poll, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sku, stage]);

  const stages: { key: StageName; label: string }[] = [
    { key: "saving", label: "Saving" },
    { key: "uploading", label: "Uploading" },
    { key: "waiting", label: "Waiting" },
    { key: "processing", label: "Reading 3D model" },
    { key: "done", label: "Ready" },
  ];

  const getStepStatus = (stepKey: StageName) => {
    const order: StageName[] = ["saving", "uploading", "waiting", "processing", "done"];
    const currentIndex = order.indexOf(stage);
    const stepIndex = order.indexOf(stepKey);

    if (stage === "error") {
      return stepIndex <= currentIndex ? "error" : "upcoming";
    }
    if (stepIndex < currentIndex || stage === "done") return "completed";
    if (stepIndex === currentIndex) return "current";
    return "upcoming";
  };

  return (
    <div className="relative overflow-hidden bg-white/90 dark:bg-stone-900/90 backdrop-blur-md rounded-2xl border border-stone-200/80 dark:border-stone-800/80 p-6 shadow-sm space-y-6">
      <GoldBeam active={stage !== "error"} />

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {stage === "done"
            ? "Your piece is ready!"
            : stage === "error"
            ? "Upload paused"
            : "Attaching your design…"}
        </h3>
        <p className="text-xs text-stone-500">
          Item code: <span className="font-mono font-medium text-stone-700 dark:text-stone-300">{sku}</span>
        </p>
      </div>

      {/* Upload Progress Bar (when uploading) */}
      {stage === "uploading" && (
        <div className="space-y-1.5">
          <div className="w-full bg-stone-100 dark:bg-stone-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.max(uploadPercent, 5)}%` }}
            />
          </div>
          <p className="text-[11px] text-stone-400 text-right">{uploadPercent}% uploaded</p>
        </div>
      )}

      {/* Stage Flow */}
      <div className="flex items-center justify-between text-xs pt-2">
        {stages.map((st, i) => {
          const status = getStepStatus(st.key);
          return (
            <React.Fragment key={st.key}>
              <div className="flex flex-col items-center space-y-1 text-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition ${
                    status === "completed"
                      ? "bg-emerald-500 text-white"
                      : status === "current"
                      ? "bg-amber-500 text-white animate-pulse"
                      : status === "error"
                      ? "bg-rose-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-400"
                  }`}
                >
                  {status === "completed" ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : status === "current" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-[11px] font-medium hidden sm:inline ${
                    status === "current"
                      ? "text-amber-600 dark:text-amber-400"
                      : status === "completed"
                      ? "text-stone-700 dark:text-stone-300"
                      : "text-stone-400"
                  }`}
                >
                  {st.label}
                </span>
              </div>
              {i < stages.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 bg-stone-100 dark:bg-stone-800" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Slow Polling Friendly Timeout Note */}
      {isSlow && stage !== "done" && stage !== "error" && (
        <div className="p-3 bg-stone-50 dark:bg-stone-800/40 rounded-xl text-xs text-stone-500 border border-stone-200/60 dark:border-stone-700/60">
          This is taking longer than usual. You can leave this page; we&apos;ll keep going in the background.
        </div>
      )}

      {/* Error Banner */}
      {stage === "error" && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-800/60 space-y-3">
          <div className="flex items-start space-x-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {pollError?.message || errorMessage || "The upload didn't finish. Please try again."}
              </p>
              {(pollError?.ref || errorRef) && (
                <p className="text-[10px] text-rose-500 font-mono mt-0.5">
                  Reference: {pollError?.ref || errorRef}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition"
              >
                Retry
              </button>
            )}
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="py-1.5 px-3 rounded-lg bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-xs font-medium transition"
              >
                Back
              </button>
            )}
          </div>
        </div>
      )}

      {/* Done Action */}
      {stage === "done" && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onComplete}
            className="w-full h-11 flex items-center justify-center space-x-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm shadow-sm transition"
          >
            <span>Continue to design review</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
