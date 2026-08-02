import { z } from 'zod';

const environmentSchema = z.object({
  WORKER_DATABASE_URL: z.string().url(),
  INTERNAL_JOB_SIGNING_SECRET: z.string().min(32),
  MARKET_DATA_PROVIDER: z
    .enum(['synthetic', 'admin_csv', 'licensed_api', 'licensed_sftp'])
    .default('synthetic'),
});
export const readWorkerEnvironment = (environment: NodeJS.ProcessEnv) =>
  environmentSchema.parse(environment);

if (process.env['NODE_ENV'] !== 'test') {
  const configuration = readWorkerEnvironment(process.env);
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'worker.ready',
      provider: configuration.MARKET_DATA_PROVIDER,
    }),
  );
}
