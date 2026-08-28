# QBO Data Schema (As-Is Sandbox Map)

> **STRICT READ-ONLY AUDIT MANDATE:** This schema reflects the live state of the QBO Sandbox. Do not modify these identifiers or configuration structures via code. Any missing accounts or misconfigured tax codes must be routed to the Pre-Integration Action Backlog for manual administrative resolution.

## 1. Core Chart of Accounts (COA) Mappings

The following specific Account IDs were extracted for the primary operations required by the middleware (e.g., syncing Invoices and mapping Katana COGS/Inventory movements).

| Account Name | QBO ID | Account Type | Account SubType | Classification |
| --- | --- | --- | --- | --- |
| **Sales of Product Income** | `79` | Income | SalesOfProductIncome | Revenue |
| **Cost of Goods Sold** | `80` | Cost of Goods Sold | SuppliesMaterialsCogs | Expense |
| **Inventory Asset** | `81` | Other Current Asset | Inventory | Asset |
| Accounts Receivable (A/R) | `84` | Accounts Receivable | AccountsReceivable | Asset |
| Accounts Payable (A/P) | `33` | Accounts Payable | AccountsPayable | Liability |
| Undeposited Funds | `4` | Other Current Asset | UndepositedFunds | Asset |

## 2. Tax Code Mappings

The following active Tax Code IDs were extracted to handle Dual-Path routing for Arizona and California franchises.

| Tax Code Name | QBO ID | Tax Groups Included |
| --- | --- | --- |
| **California** | `2` | California (ID: 3) |
| **Tucson** | `3` | AZ State tax (ID: 1), Tucson City (ID: 2) |

---
*Generated automatically via OAuth read-only extraction script during the Sprint 0 Architecture Audit.*
