import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'), // ej: 15m, 1h, 7d
  JWT_REFRESH_TTL: Joi.string().default('7d'),

  GITHUB_TOKEN: Joi.string().allow('').optional(),
  GITHUB_APP_TOKEN: Joi.string().allow('').optional(),
});
