export { extractSkpThumbnail } from "./skp-thumbnail";
export {
  instantiateDraftsFromDae,
  type CadInstantiateResult,
} from "./instantiate-from-dae";

export const CAD_UPLOADED_EVENT = "cad/model.uploaded" as const;

export type CadUploadedEventData = {
  uploadId: string;
  globalSku: string;
  storagePath: string;
  ext: "dae" | "skp" | "glb" | "blend";
  sha256?: string;
  operatorEmail: string;
  replaceImage?: boolean;
};
