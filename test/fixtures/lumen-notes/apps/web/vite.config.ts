import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    server: {
      port: Number(env.PORT ?? 5173),
      strictPort: true,
    },
  };
});
