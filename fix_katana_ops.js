const fs = require('fs');

let content = fs.readFileSync('src/lib/katana.ts', 'utf8');

// Also inject idempotency key to /product_operation_rows call
const opFetchOld = `await katanaFetch("/product_operation_rows", {
          method: "POST",
          body: {
            keep_current_rows: false,
            rows: operationPayload,
          },
        });`;
const opFetchNew = `await katanaFetch("/product_operation_rows", {
          method: "POST",
          idempotencyKey: options.idempotencyKey,
          body: {
            keep_current_rows: false,
            rows: operationPayload,
          },
        });`;

if (content.includes(opFetchOld)) {
  content = content.replace(opFetchOld, opFetchNew);
  fs.writeFileSync('src/lib/katana.ts', content, 'utf8');
  console.log('Fixed /product_operation_rows');
} else {
  console.log('/product_operation_rows not found or already fixed');
}
