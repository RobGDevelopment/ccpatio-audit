import { expect, test, vi, beforeEach } from "vitest";
import { getDecryptedVendorKey, invalidateVendorKey } from "../src/utils/vault";
import { saveVendorKeyAction } from "../src/app/mission-control/actions";

const mockDbQuery = vi.fn();
const mockInsert = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

vi.mock("../src/server/db/client", () => {
  return {
    getDb: () => ({
      query: {
        vendor_credentials: {
          findFirst: mockDbQuery
        }
      },
      insert: () => {
        mockInsert();
        return {
          values: () => ({
            onConflictDoUpdate: mockOnConflictDoUpdate
          })
        };
      }
    })
  };
});

vi.mock("../src/server/mission-control/require-role", () => ({
  requireMissionControlRole: vi.fn().mockResolvedValue("SuperAdmin"),
}));

vi.mock("../src/utils/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: "user-123", email: "test@ccpatio.com" }
        }
      })
    }
  })
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the LRU cache manually by invalidating all keys
  invalidateVendorKey("katana");
  invalidateVendorKey("woocommerce");
  invalidateVendorKey("clover");
});

test("Cache hit skips a second query", async () => {
  mockDbQuery.mockResolvedValueOnce({ encrypted_token: "secret-katana-123" });
  
  // First read hits DB
  const key1 = await getDecryptedVendorKey("katana");
  expect(key1).toBe("secret-katana-123");
  expect(mockDbQuery).toHaveBeenCalledTimes(1);
  
  // Second read hits cache, doesn't increment query count
  const key2 = await getDecryptedVendorKey("katana");
  expect(key2).toBe("secret-katana-123");
  expect(mockDbQuery).toHaveBeenCalledTimes(1);
});

test("invalidateVendorKey forces the next read", async () => {
  mockDbQuery.mockResolvedValueOnce({ encrypted_token: "secret-woo-1" });
  
  await getDecryptedVendorKey("woocommerce");
  expect(mockDbQuery).toHaveBeenCalledTimes(1);
  
  invalidateVendorKey("woocommerce");
  
  mockDbQuery.mockResolvedValueOnce({ encrypted_token: "secret-woo-2" });
  await getDecryptedVendorKey("woocommerce");
  expect(mockDbQuery).toHaveBeenCalledTimes(2);
});

test("A saved value is absent from the action's return object", async () => {
  const result = await saveVendorKeyAction("clover", "new-clover-key");
  expect(result.ok).toBe(true);
  expect((result as any).newKey).toBeUndefined();
  expect((result as any).data).toBeUndefined();
});
