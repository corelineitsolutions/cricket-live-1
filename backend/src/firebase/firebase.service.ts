import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { App, cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { AppConfigService } from '../config/app-config.service';

const FIREBASE_APP_NAME = 'cricket-live';

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private app: App | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.firebaseProjectId.trim();
    const clientEmail = this.config.firebaseClientEmail.trim();
    const privateKey = this.config.firebasePrivateKey.trim();

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase Admin is not configured. Push delivery is disabled.');
      return;
    }

    try {
      this.app =
        getApps().find((app) => app.name === FIREBASE_APP_NAME) ??
        initializeApp(
          {
            credential: cert({
              projectId,
              clientEmail,
              privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
          },
          FIREBASE_APP_NAME,
        );
      this.logger.log('Firebase Admin initialized');
    } catch {
      this.logger.error('Firebase Admin failed to initialize. Push delivery is disabled.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
      this.app = null;
    }
  }

  isReady(): boolean {
    return this.app !== null;
  }

  getApp(): App | null {
    return this.app;
  }

  /** Null when Firebase is not configured; callers skip delivery. */
  getMessaging(): Messaging | null {
    return this.app ? getMessaging(this.app) : null;
  }
}
