import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: null,
  buildCommand: 'npx vite build',
};
