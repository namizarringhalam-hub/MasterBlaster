import { createServer } from "vite";

// Windows encoders can lock their outputs while Vite discovers new capture files.
const server = await createServer({ server: { host: "127.0.0.1", port: 8799, strictPort: true,
  watch: { ignored: ["**/.codex-spec-render/**", "**/%SystemDrive%/**"] } } });
await server.listen();
server.printUrls();
