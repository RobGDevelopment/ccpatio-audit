import sys

def main():
    with open('src/app/admin/factory-bom/actions.ts', 'r', encoding='utf-8') as f:
        content = f.read()

    start_str = 'export async function publishApprovedRecipeToKatana('
    
    start_idx = content.find(start_str)
    if start_idx == -1:
        print('Function not found')
        return

    # Find the end of the function. We know it ends with 'return { ok: true };\n}'
    end_str = 'return { ok: true };\n}'
    end_idx = content.find(end_str, start_idx)
    if end_idx == -1:
        print('End not found')
        return
    
    end_idx += len(end_str)
    
    new_func = """export async function publishApprovedRecipeToKatana(
  rootSku: string,
): Promise<BomMutationResult & { blockingCodes?: string[] }> {
  const session = await requireSession();
  if ("error" in session) return { ok: false, error: session.error };

  const sku = rootSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required" };

  const snapshot = await loadAirlockSnapshot(sku);
  const products = await listFactoryProducts();

  const rootMeta = products.find(p => p.sku === sku);
  if (!rootMeta) return { ok: false, error: "Root meta not found" };

  let cadNode = null;
  if (snapshot.cadUpload && (snapshot.cadUpload.ext === "dae" || snapshot.cadUpload.ext === "glb")) {
    const snap = snapshot.cadUpload.geometry_snapshot as any;
    cadNode = {
      uploadId: snapshot.cadUpload.id,
      ext: snapshot.cadUpload.ext as "dae" | "glb",
      status: (snapshot.cadUpload.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
      sha256: snapshot.cadUpload.sha256 || "",
      hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
    };
  }

  const allSkus = new Set<string>();
  allSkus.add(sku);
  snapshot.lines.forEach(l => {
    allSkus.add(l.parent_sku);
    allSkus.add(l.child_sku);
  });
  const parents = Array.from(allSkus).filter(s => 
    s === sku || snapshot.lines.some(l => l.parent_sku === s)
  );

  const nodes = parents.map(parentSku => {
    const pMeta = products.find(p => p.sku === parentSku);
    const parentLines = snapshot.lines.filter(l => l.parent_sku === parentSku).map(l => {
       const cMeta = products.find(p => p.sku === l.child_sku);
       const cat = (cMeta as any)?.category || "";
       const isMetal = Boolean(
         cat.match(/metal|aluminum|tube|flat bar/i) ||
         (Array.isArray(l.cut_list) && l.cut_list.length > 0 && (l.cut_list[0] as any).profile !== "UNKNOWN") ||
         ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") && Array.isArray(l.cut_list) && l.cut_list.length > 0)
       );
       return {
         parentSku: l.parent_sku,
         childSku: l.child_sku,
         itemType: (cMeta as any)?.itemType || "raw_material",
         quantity: Number(l.quantity),
         scrapFactor: Number(l.scrap_factor),
         unitOfMeasure: l.unit_of_measure as any,
         status: l.status as any,
         source: l.source,
         notes: l.notes,
         cutList: Array.isArray(l.cut_list) ? l.cut_list.map((c: any) => ({
           role: c.role || "",
           profile: c.profile || "UNKNOWN",
           lengthIn: Number(c.lengthIn) || 0,
           endA: c.endA,
           endB: c.endB,
           qtyEa: c.qtyEa,
           lengthConvention: c.lengthConvention,
           sourceName: c.sourceName || "",
           confidence: c.confidence,
           drawingPartNumber: c.drawingPartNumber
         })) : [],
         isMetal
       };
    });
    const parentOps = snapshot.operations.filter(o => o.item_sku === parentSku).map(o => ({
       itemSku: o.item_sku,
       workCenter: o.work_center,
       sequence: o.sequence,
       setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
       runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
    }));
    return {
      sku: parentSku,
      itemType: (pMeta as any)?.itemType || "sub_assembly",
      lines: parentLines,
      operations: parentOps,
    };
  });

  const dossier: AirlockDossier = {
    rootSku: sku,
    identity: {
      itemType: (rootMeta as any).itemType || "finished_good",
      originalName: rootMeta.name || "",
      katanaVariantId: (rootMeta as any).katanaVariantId || null,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist: {
      identityConfirmed: true as true,
      cutListConfirmed: true as true,
      operationsConfirmed: true as true,
      quarantineConfirmed: true as true,
    },
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "Airlock validation failed", blockingCodes };
  }

  const allCuts = dossier.nodes.flatMap(n => n.lines.flatMap(l => l.cutList));
  const pdfBytes = renderShopDrawingPdf({
    rootSku: sku,
    originalName: dossier.identity.originalName,
    cadExt: cadNode?.ext || "glb",
    cadSha256: cadNode?.sha256 || "",
    cutList: allCuts,
    geometrySnapshot: (snapshot.cadUpload?.geometry_snapshot as any) || { components: [] }
  });
  
  const shopDrawingSha256 = sha256Hex(pdfBytes);
  const storagePath = buildStorageKey(sku, "shop_drawing", 1, "pdf");
  const { error: uploadErr } = await getSupabaseAdmin().storage.from(PRODUCT_DOCUMENTS_BUCKET).upload(storagePath, pdfBytes, { contentType: "application/pdf" });
  if (uploadErr) {
    return { ok: false, error: "Failed to upload shop drawing: " + uploadErr.message };
  }
  
  const db = getDb();
  await db.insert(product_assets).values({
    global_sku: sku,
    kind: "shop_drawing",
    revision: 1,
    storage_path: storagePath,
    original_filename: `shop_drawing_${sku}.pdf`,
    content_type: "application/pdf",
    byte_size: pdfBytes.length,
    sha256: shopDrawingSha256,
    ext: "pdf",
  });

  const [firstLine] = snapshot.lines.filter(l => l.parent_sku === sku);
  if (firstLine) {
    const newNote = `${firstLine.notes || ""} | Shop:${storagePath}`.trim();
    if (newNote.length > 255) {
      return { ok: false, error: "SHOP_NOTE", blockingCodes: ["SHOP_NOTE"] };
    }
    await db.update(product_bom_draft)
      .set({ notes: newNote })
      .where(eq(product_bom_draft.id, firstLine.id));
      
    const rootNode = dossier.nodes.find(n => n.sku === sku);
    if (rootNode) {
      const rootDossierLine = rootNode.lines.find(l => l.childSku === firstLine.child_sku);
      if (rootDossierLine) rootDossierLine.notes = newNote;
    }
  }

  const dossierHash = computeDossierHash(dossier, shopDrawingSha256);
  if (snapshot.releaseGate?.dossier_hash && snapshot.releaseGate.dossier_hash !== dossierHash) {
    return { ok: false, error: "CHECKLIST", blockingCodes: ["CHECKLIST"] };
  }
  
  const approveRes = await approveDraftRecipe(sku);
  if (!approveRes.ok) return approveRes;
  
  await db.update(factory_release_gate)
    .set({ dossier_hash: dossierHash })
    .where(eq(factory_release_gate.root_sku, sku));

  if (!dossier.identity.katanaVariantId) {
    return { ok: false, error: "KATANA_VARIANT_UNRESOLVED", blockingCodes: ["KATANA_VARIANT_UNRESOLVED"] };
  }
  for (const node of dossier.nodes) {
    for (const line of node.lines) {
      const childMeta = products.find(p => p.sku === line.childSku);
      if (!(childMeta as any)?.katanaVariantId) {
         return { ok: false, error: `KATANA_VARIANT_UNRESOLVED: ${line.childSku}`, blockingCodes: ["KATANA_VARIANT_UNRESOLVED"] };
      }
    }
  }

  const catalogMode = getCatalogPublishMode();
  const dryRun = !canMutateKatanaCatalog(catalogMode);

  if (dryRun) {
    const payloadHash = hashChannelPayload({
      channel: "katana",
      path: "factory_publish",
      sku,
      recipeRows: 0,
      operationRows: 0,
      nodesSynced: 0,
      dryRun: true,
    });
    return { ok: true, dryRun: true };
  }

  const result = await syncBOMToKatana(sku, { fromAirlock: true, idempotencyKey: `factory-bom:${sku}:${dossierHash}` } as any);
  if (!result.ok) return { ok: false, error: result.error };

  const payloadHash = hashChannelPayload({
    channel: "katana",
    path: "factory_publish",
    sku,
    recipeRows: result.recipeRows ?? 0,
    operationRows: result.operationRows ?? 0,
    nodesSynced: result.nodesSynced ?? 0,
    dryRun: result.dryRun ?? false,
  });

  await upsertChannelSync({
    globalSku: sku,
    channel: "katana",
    status: result.dryRun ? "pending" : "success",
    externalId: result.productVariantId != null ? String(result.productVariantId) : null,
    lastError: null,
    payloadHash,
  });

  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: "factory_bom_katana_recipes",
    newValue: result.message ?? "Katana recipe sync",
  });
  revalidateFactory();
  return { ok: true };
}"""

    content = content[:start_idx] + new_func + content[end_idx:]
    with open('src/app/admin/factory-bom/actions.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print('Function replaced.')

if __name__ == '__main__':
    main()
