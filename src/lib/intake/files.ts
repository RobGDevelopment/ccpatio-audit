/**
 * File classification and validation for intake drag-and-drop.
 */

export const PACKET_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB
export const CAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB

export const ALLOWED_GEOMETRY_EXTS = [".glb", ".blend", ".dae", ".skp"] as const;
export const ALLOWED_PACKET_EXTS = [".pdf"] as const;
export const ALLOWED_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export type RejectedFile = {
  filename: string;
  reason: "FILE_TOO_LARGE" | "SKP_ONLY" | "MULTIPLE_GEOMETRY" | "MULTIPLE_PACKETS" | "FILE_TYPE";
  message: string;
};

export type ClassifiedDropped = {
  geometry?: File;
  packet?: File;
  images: File[];
  rejected: RejectedFile[];
};

function getExtension(name: string): string {
  const match = name.toLowerCase().match(/\.[0-9a-z]+$/);
  return match ? match[0] : "";
}

/**
 * Classifies dropped files into geometry, factory-order packet, images, and rejections.
 */
export function classifyDropped(files: File[]): ClassifiedDropped {
  const rejected: RejectedFile[] = [];
  const candidateGeometry: File[] = [];
  const candidatePackets: File[] = [];
  const images: File[] = [];

  for (const file of files) {
    const ext = getExtension(file.name);

    // Size check
    if (file.size > CAD_MAX_BYTES) {
      rejected.push({
        filename: file.name,
        reason: "FILE_TOO_LARGE",
        message: "That file is too large. The limit is 25 MB.",
      });
      continue;
    }

    if (ALLOWED_GEOMETRY_EXTS.includes(ext as (typeof ALLOWED_GEOMETRY_EXTS)[number])) {
      candidateGeometry.push(file);
    } else if (ALLOWED_PACKET_EXTS.includes(ext as (typeof ALLOWED_PACKET_EXTS)[number])) {
      candidatePackets.push(file);
    } else if (ALLOWED_IMAGE_EXTS.includes(ext as (typeof ALLOWED_IMAGE_EXTS)[number])) {
      images.push(file);
    } else {
      rejected.push({
        filename: file.name,
        reason: "FILE_TYPE",
        message: "That file type isn't supported here.",
      });
    }
  }

  // Handle geometry constraints
  let geometry: File | undefined;
  if (candidateGeometry.length === 1) {
    const single = candidateGeometry[0]!;
    if (getExtension(single.name) === ".skp") {
      rejected.push({
        filename: single.name,
        reason: "SKP_ONLY",
        message: "SketchUp files can't be measured. Export a .glb and upload that.",
      });
    } else {
      geometry = single;
    }
  } else if (candidateGeometry.length > 1) {
    // If we have a .glb and a .skp, prefer the .glb!
    const glb = candidateGeometry.find((f) => getExtension(f.name) === ".glb");
    if (glb && candidateGeometry.length === 2 && candidateGeometry.some((f) => getExtension(f.name) === ".skp")) {
      geometry = glb;
    } else {
      for (const f of candidateGeometry) {
        rejected.push({
          filename: f.name,
          reason: "MULTIPLE_GEOMETRY",
          message: "Please drop only one 3D model per piece.",
        });
      }
    }
  }

  // Handle packet constraints
  let packet: File | undefined;
  if (candidatePackets.length === 1) {
    packet = candidatePackets[0];
  } else if (candidatePackets.length > 1) {
    for (const f of candidatePackets) {
      rejected.push({
        filename: f.name,
        reason: "MULTIPLE_PACKETS",
        message: "Please drop only one factory order PDF.",
      });
    }
  }

  return {
    geometry,
    packet,
    images,
    rejected,
  };
}
