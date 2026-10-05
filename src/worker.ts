import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(new Logger('Worker'));
  app.enableShutdownHooks();
  new Logger('Worker').log('Live-score worker process started');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  console.error(`Worker failed to start: ${message}`);
  process.exit(1);
});
