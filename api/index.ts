import { createApiApp } from "./apiApp";

/** Hobby: 10s default; give DB connect + cold start slack on Pro; harmless on Hobby if capped. */
export const config = {
  maxDuration: 60,
};

export default createApiApp();
