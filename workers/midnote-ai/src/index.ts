import { handle, type Env } from "./handler";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
    });
  },
};
