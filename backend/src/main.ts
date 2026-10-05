import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApp, setupSwagger } from './app.setup';
import { AppConfigService } from './config/app-config.service';
import { RedisIoAdapter } from './websocket/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');
  app.useLogger(logger);

  const config = app.get(AppConfigService);
  if (config.isProduction && config.corsOrigin === '*') {
    logger.warn('CORS_ORIGIN is "*". Set it to the admin panel origin (e.g. https://admin.example.com).');
  }
  configureHttpApp(app, config);
  app.enableShutdownHooks();
  if (config.swaggerEnabled) {
    setupSwagger(app);
  }

  const redisAdapter = new RedisIoAdapter(app);
  const redisReady = await redisAdapter.connect(config);
  if (redisReady) {
    app.useWebSocketAdapter(redisAdapter);
    logger.log('Socket.IO Redis adapter enabled');
  } else {
    logger.error('Socket.IO Redis adapter unavailable. WebSocket is running in single-node mode.');
  }

  await app.listen(config.port);
  logger.log(`HTTP server listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  console.error(`Failed to start: ${message}`);
  process.exit(1);
});
