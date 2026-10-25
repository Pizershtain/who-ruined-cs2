export function resolveApiBindHost(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.API_BIND_HOST?.trim() || '127.0.0.1';
}
