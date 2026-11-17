import base from "./base/index.ts";
import work from "./work/index.ts";

// Compose arrays without losing the source location of each plugin.
export default [...base, ...work];
