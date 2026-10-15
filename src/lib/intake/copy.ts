/**
 * Client-safe copy catalog for the human-centric intake flow.
 * Free of developer jargon (Airlock, Mint, Slug, Quarantine, etc.).
 */

export type IntakeErrorCode =
  | "NOT_SIGNED_IN"
  | "VALIDATION"
  | "PROJECT_REQUIRED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_CLOSED"
  | "PROJECT_LOCKED"
  | "FINISHES_REQUIRED"
  | "FILE_REQUIRED"
  | "FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "PDF_INVALID"
  | "COLLECTION_INVALID"
  | "PRODUCT_TYPE_INVALID"
  | "DUPLICATE_PIECE"
  | "DUPLICATE_PRODUCT"
  | "CONFLICT_RETRY"
  | "UPSTREAM_BUSY"
  | "STORAGE_FAILED"
  | "INTERNAL";

export const ERROR_MESSAGES: Record<IntakeErrorCode, string> = {
  NOT_SIGNED_IN: "Please reopen this page from GoHighLevel.",
  VALIDATION: "Please check the highlighted fields.",
  PROJECT_REQUIRED: "Choose the client project first.",
  PROJECT_NOT_FOUND: "We couldn't find that client project in GoHighLevel.",
  PROJECT_CLOSED: "That client project is closed, so pieces can't be added to it.",
  PROJECT_LOCKED: "This project was already sent to production. Ask an Ops Manager about a change order.",
  FINISHES_REQUIRED: "Choose the frame, powder coat and fabric, or pick TBD and add a note.",
  FILE_REQUIRED: "Add a 3D model (.glb or .blend), and the factory order PDF for client pieces.",
  FILE_TYPE: "That file type isn't supported here.",
  FILE_TOO_LARGE: "That file is too large. The limit is 25 MB.",
  PDF_INVALID: "That file isn't a readable PDF. Export it again and retry.",
  COLLECTION_INVALID: "Pick one of the listed options.",
  PRODUCT_TYPE_INVALID: "Pick one of the listed options.",
  DUPLICATE_PIECE: "You already added a piece with this name to this project.",
  DUPLICATE_PRODUCT: "This product already exists in the catalog.",
  CONFLICT_RETRY: "Someone else just changed this. Please try again.",
  UPSTREAM_BUSY: "GoHighLevel is busy. Try again in a moment.",
  STORAGE_FAILED: "The upload didn't finish. Please try again.",
  INTERNAL: "Something went wrong on our side.",
};

export const BLOCKING_CODE_MESSAGES: Record<string, string> = {
  MISSING_ROOT_META: "The product details are incomplete.",
  MISSING_CAD: "A 3D model hasn't been uploaded yet.",
  CAD_NOT_READY: "The 3D model is still being processed.",
  GEOM_HYGIENE: "Some parts of the model can't be measured. You can continue and type the cut list by hand.",
  FINISHES_PENDING: "Finishes are pending. Confirm frame, powder coat, and fabric before completing.",
  NO_RECIPE: "The production recipe hasn't been created yet.",
  MISSING_OPERATIONS: "Build steps haven't been assigned.",
  UNRESOLVED_CHILDREN: "Some parts in the materials list need to be checked.",
  PACKET_REQUIRED: "A factory order PDF is required for this project.",
};

export function translateBlockingCode(code: string): string {
  if (BLOCKING_CODE_MESSAGES[code]) {
    return BLOCKING_CODE_MESSAGES[code];
  }
  return "This piece requires attention before sending to the factory.";
}

export const INTAKE_COPY = {
  wizardTitle: "Add a 3D model",
  wizardSubtitle: "Attach CAD geometry, set finishes, and link factory orders.",
  screen1: {
    title: "Drop your design",
    subtitle: "Drop a 3D model (.glb, .blend, .skp, .dae), factory order PDF, or photos.",
    dropzonePlaceholder: "Drag & drop your files here, or browse",
    modelCardTitle: "3D Model",
    modelCardReadable: "3D model readable",
    pdfSlotTitle: "Factory order (PDF)",
    pdfSlotRequiredNote: "Required for client projects",
    pdfSlotExisting: "Using the factory order already on file",
    toggle3d: "Show 3D preview",
    toggle3dHelp: "3D preview is available for .glb files. Other formats are read after upload.",
  },
  screen2: {
    title: "Who is this piece for?",
    subtitle: "Choose whether this is a custom one-off or a standard line item.",
    clientCardTitle: "A client's project",
    clientCardDesc: "Built for one customer",
    catalogCardTitle: "A standard catalog product",
    catalogCardDesc: "We'll make this again",
  },
  screen3a: {
    title: "Client project details",
    subtitle: "Select the GoHighLevel project, name the piece, and choose finishes.",
    findProjectLabel: "Find client project",
    pieceNameLabel: "Piece name",
    quantityLabel: "How many",
    itemCodeLabel: "Item code (auto)",
    finishesHeader: "Finishes (all three required)",
    frameLabel: "Frame",
    powderLabel: "Powder coat",
    fabricLabel: "Fabric",
    tbdOption: "TBD / Pending",
    tbdNotePlaceholder: "Who will confirm, and by when? (required)",
    tbdWarningBanner: "Finishes pending — this piece can't be marked complete until they're chosen.",
    submitButton: "Create and read 3D model",
  },
  screen3b: {
    title: "Standard catalog product",
    subtitle: "Select collection, product type, and enter dimensions.",
    collectionLabel: "Collection",
    categoryLabel: "Product type",
    productNameLabel: "Product name",
    lengthLabel: "Overall length (in)",
    depthLabel: "Depth (in)",
    itemCodeLabel: "Item code (auto)",
    submitButton: "Create product and read 3D model",
  },
  progress: {
    saving: "Saving",
    uploading: "Uploading files",
    waiting: "Waiting to read",
    reading: "Reading your 3D model…",
    done: "Done",
  },
  checklist: {
    identity: "This is the right piece and the right 3D model",
    cutlist: "The material list looks right",
    operations: "The build steps and times look right",
    acknowledgeFinalize: "I understand this marks the design complete. Production starts after the deposit.",
    acknowledgeRelease: "I understand this sends the piece to the factory floor.",
  },
};

/**
 * Regexes used by the embed copy guard to detect forbidden developer jargon
 * in user-visible surfaces (Appendix B).
 */
export const BANNED_TERMS_PATTERNS = [
  /\bairlock\b/i,
  /\bmint(?:ed|ing)?\b/i,
  /\bslug\b/i,
  /\bquarantine\b/i,
  /\bkatana\b/i,
  /\bdossier\b/i,
  /\bhygiene\b/i,
  /\bGEOM_/i,
  /\bglobal\s+sku\b/i,
  /\bhub\s+sku\b/i,
  /\bSKU\b/,
  /\bBOM\b/,
  /\battestation\b/i,
  /\bblocking\s+code\b/i,
  /\bopportunit(?:y|ies)\b/i,
  /\bsaga\b/i,
  /\bwebhook\b/i,
  /\b[A-Z]{3,}_[A-Z0-9_]{3,}\b/,
];
