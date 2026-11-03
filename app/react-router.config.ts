import type { Config } from "@react-router/dev/config";

export default {
  // The App's source folder (app/src; this folder is the App project).
  appDirectory: "src",
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
} satisfies Config;
