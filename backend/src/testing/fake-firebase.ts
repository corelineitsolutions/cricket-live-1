import type { BatchResponse, MulticastMessage } from 'firebase-admin/messaging';

/**
 * Stands in for FirebaseService. Every token succeeds unless listed in `failures`
 * (token -> Firebase error code). `configured = false` behaves like missing credentials.
 */
export class FakeFirebase {
  configured = true;
  readonly failures = new Map<string, string>();
  readonly sendEachForMulticast = vi.fn(async (message: MulticastMessage): Promise<BatchResponse> => {
    const responses = message.tokens.map((token) => {
      const code = this.failures.get(token);
      return code
        ? { success: false, error: Object.assign(new Error(code), { code }) }
        : { success: true, messageId: `projects/test/messages/${token.slice(0, 8)}` };
    });
    const successCount = responses.filter((response) => response.success).length;
    return { responses, successCount, failureCount: responses.length - successCount } as unknown as BatchResponse;
  });

  isReady(): boolean {
    return this.configured;
  }

  getApp(): null {
    return null;
  }

  getMessaging() {
    return this.configured ? { sendEachForMulticast: this.sendEachForMulticast } : null;
  }
}
