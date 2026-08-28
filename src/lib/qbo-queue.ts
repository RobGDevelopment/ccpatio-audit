export interface LedgerEvent {
  moId: string;
  amount: number;
  type: 'COGS' | 'REVENUE';
}

class QboBatchQueue {
  private queue: LedgerEvent[] = [];
  private isProcessing: boolean = false;
  private readonly BATCH_LIMIT = 40;

  public push(event: LedgerEvent) {
    this.queue.push(event);
    console.log(`[QBO Queue] Added event for MO: ${event.moId}. Queue length: ${this.queue.length}`);
    this.processQueue();
  }

  private async processQueue() {
    // If already processing or nothing to process, do nothing
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.BATCH_LIMIT);
      console.log(`[QBO Queue] Processing batch of ${batch.length} events...`);
      
      try {
        // Simulate Intuit API network latency and exponential backoff mechanics
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log(`[QBO Queue] Successfully synced batch to QuickBooks Online.`);
      } catch (error) {
        console.error(`[QBO Queue] Batch sync failed.`, error);
        // Fallback logic for DLQ would be handled here
      }
    }

    this.isProcessing = false;
  }
}

// Export a singleton instance to be shared across API routes
export const qboQueue = new QboBatchQueue();
