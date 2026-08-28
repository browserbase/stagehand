import { z } from "zod/v4";

// Manifest V3 forbids runtime code generation. Configure Zod before any
// protocol schema is evaluated so it never probes or uses its JIT parser.
z.config({ jitless: true });
