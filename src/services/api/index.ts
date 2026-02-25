import { RealApi } from "./api.real.js";

export type { IForgeReviewApi, IMemoryApi } from "./api.interface.js";

export const api = new RealApi();
