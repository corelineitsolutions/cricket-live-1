import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  SPORTMONKS_API_URL: Joi.string()
    .uri()
    .default('https://cricket.sportmonks.com/api/v2.0'),
  SPORTMONKS_API_TOKEN: Joi.string().allow('').optional(),
  SPORTMONKS_IDLE_INTERVAL_MS: Joi.number().integer().min(1000).default(60000),
  SPORTMONKS_LIVE_INTERVAL_MS: Joi.number().integer().min(1000).default(10000),
  SPORTMONKS_ACTIVE_INTERVAL_MS: Joi.number().integer().min(1000).default(5000),
  SPORTMONKS_MAX_CALLS_PER_HOUR: Joi.number().integer().min(1).default(1600),
  SPORTMONKS_TIMEOUT_MS: Joi.number().integer().min(500).max(60000).default(8000),
  SPORTMONKS_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  SPORTMONKS_ON_DEMAND_MAX_CALLS_PER_HOUR: Joi.number().integer().min(0).default(400),
  LIVE_SCORE_WORKER_ENABLED: Joi.boolean().default(true),
  RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(10).default(600),
  RATE_LIMIT_BURST_PER_SECOND: Joi.number().integer().min(1).default(20),
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
  JWT_SECRET: Joi.string()
    .required()
    .when('NODE_ENV', { is: 'production', then: Joi.string().min(32), otherwise: Joi.string().min(16) }),
  JWT_EXPIRES_IN: Joi.string().default('8h'),
  ADMIN_EMAIL: Joi.string().email().allow('').optional(),
  ADMIN_INITIAL_PASSWORD: Joi.string().allow('').optional(),
  CORS_ORIGIN: Joi.string().default('*'),
  METRICS_TOKEN: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', { is: 'production', then: Joi.string().allow('').min(32) }),
  SWAGGER_ENABLED: Joi.boolean().default(true),
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
