const fs = require('fs');

// Fix katana.ts exports
let katanaContent = fs.readFileSync('src/lib/katana.ts', 'utf8');
katanaContent = katanaContent.replace(
  'function getCatalogPublishMode', 
  'export function getCatalogPublishMode'
);
katanaContent = katanaContent.replace(
  'function canMutateKatanaCatalog', 
  'export function canMutateKatanaCatalog'
);
fs.writeFileSync('src/lib/katana.ts', katanaContent, 'utf8');
console.log('Fixed katana.ts exports');

// Fix actions.ts type errors
let actionsContent = fs.readFileSync('src/app/admin/factory-bom/actions.ts', 'utf8');

// Fix 1: cut_list cast
actionsContent = actionsContent.replace(
  'cutList: Array.isArray(l.cut_list) ? l.cut_list.map((c: any) => ({',
  'cutList: Array.isArray(l.cut_list) ? (l.cut_list as any).map((c: any) => ({'
);

// Fix 2: remove `ext: "pdf",`
actionsContent = actionsContent.replace('ext: "pdf",\n  });', '});');

// Fix 3: return type Promise<BomMutationResult & { blockingCodes?: string[] }> to Promise<BomMutationResult & { blockingCodes?: string[]; dryRun?: boolean }>
actionsContent = actionsContent.replace(
  'Promise<BomMutationResult & { blockingCodes?: string[] }>',
  'Promise<BomMutationResult & { blockingCodes?: string[]; dryRun?: boolean }>'
);

// Fix 4: return { ok: true, dryRun: true } wait, BomMutationResult only has `ok: boolean, error?: string`.
// Adding dryRun?: boolean to the intersected type solves this.

fs.writeFileSync('src/app/admin/factory-bom/actions.ts', actionsContent, 'utf8');
console.log('Fixed actions.ts');
