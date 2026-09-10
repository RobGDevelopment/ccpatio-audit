# CC Patio IT Operations Runbook: Mission Control Dashboard

Welcome to the **Mission Control Dashboard** runbook. This guide is designed for the CC Patio IT and Operations staff. It provides simple, step-by-step instructions for monitoring system health, securely rotating passwords, and recovering from errors, all without needing to touch code or contact developers for routine maintenance.

---

## 1. System Overview

The CC Patio Master Data Hub is the central nervous system of your digital operations. When the design team approves a new piece of luxury outdoor furniture in the Launchpad, the Hub automatically takes that data and securely pushes it out to all of your critical business systems:

*   **Katana:** Tells the factory floor how to build it (Raw Materials & Bills of Material).
*   **WooCommerce:** Tells your website how to display and sell it.
*   **Clover:** Tells your retail point-of-sale systems how to ring it up.

The **Mission Control Dashboard** gives you a real-time view into these automated background processes. It allows you to instantly see if a partner system is offline, quickly update expired passwords, and restart any tasks that failed to complete.

---

## 2. The Traffic Light Dashboard

At the top of Mission Control, you will see a Traffic Light status board monitoring WordPress, Katana, WooCommerce, and Clover. This board runs continuous health checks. 

Here is what you should do for each status indicator:

*   🟢 **Green (System Healthy):** 
    Normal operation. Everything is online, passwords are valid, and systems are communicating perfectly. No action is required.
*   🟡 **Yellow (Degraded/Congested):** 
    A system is running slowly or responding with temporary errors. The Hub will automatically hold and retry tasks in the background. No action is required.
*   🟠 **Orange (Offline/Unreachable):** 
    A partner system (like the Katana servers or your WooCommerce website) is completely offline or undergoing maintenance. *Action:* Wait for the vendor to recover. The Hub will safely pause your data and wait to resume once the partner system is back online.
*   🔴 **Red (Connection Lost - Password Expired):** 
    The API Key or password used to connect to the partner system has expired, been revoked, or changed. *Action Required:* You must rotate the password using the Key Manager (see Section 3 below).

---

## 3. Rotating Passwords (API Keys)

Third-party systems occasionally require their API Keys (passwords) to be rotated for security purposes. If a system light turns **Red**, follow these exact steps to restore the connection:

1. Log into the external partner system (e.g., the Katana web portal or WooCommerce Admin) and generate a new API Key.
2. In the Mission Control Dashboard, locate the **Connection Manager** section.
3. Select the affected system from the **System** dropdown (Katana, WooCommerce, or Clover).
4. Paste the newly generated API Key into the **New API Key / Password** input field.
5. **CRITICAL STEP:** Click the **Test Connection** button. 
    *   The dashboard will perform a secure, live handshake with the partner system using your new key to verify it works.
    *   *Do not skip this step.* The system will not allow you to save a broken key.
6. Once the test is successful (indicated by a green success message), click the **Save Key** button.
7. The system will securely encrypt the key, store it in the Vault, and instantly bring the system back online.

---

## 4. Handling Failed Syncs

If a task fails to push to a partner system, it will appear in the **Active Issues Inbox**. This queue catches tasks that failed completely so that data is never lost.

To resolve a failed sync:
1. Look at the **Reason** column. The dashboard automatically translates complex computer errors into plain English (e.g., "Access denied (Check Password)" or "System timed out during sync").
2. Resolve the underlying cause if possible. For example, if the reason is "Access denied," rotate the key using the instructions in Section 3.
3. Once you believe the issue is resolved (or if you simply want to try again after a temporary outage), click the **Retry** button next to the failed job.
4. The system will display a loading indicator and re-queue the task exactly where it left off. If successful, it will vanish from the Inbox. 

---

## 5. Emergency Escalation

Most errors shown in Mission Control can be resolved directly by the IT staff (e.g., rotating expired keys, waiting out a Katana outage, or clicking Retry).

However, if you see repeated failures with a technical "Code/Schema Issue" (such as a `400 Bad Request`, `Malformed Payload`, or structural data rejection), **do not attempt to fix this yourself.**

These errors indicate that a partner system (like WooCommerce) has changed its API rules, or our internal data structure has fundamentally misaligned with the factory floor requirements. 

**Escalation Protocol:**
When a structural failure occurs, the Mission Control system will automatically trigger a **"Support Needed Urgent"** email containing the technical stack trace directly to the original system architect, **RobG**. 

If you see these structural errors persisting in the Inbox:
1. Do *not* continually press Retry.
2. Leave the failed tasks in the Inbox (they are safely frozen).
3. Await instructions or a patch deployment from the architectural team.
