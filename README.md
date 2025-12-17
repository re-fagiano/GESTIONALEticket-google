# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## DeepSeek AI configuration

The AI diagnosis panel calls the DeepSeek API directly from the client. Configure the following environment variables (for example on Railway) before building:

- `VITE_DEEPSEEK_API_KEY`: your DeepSeek API key. Only `VITE_` variables are bundled in the client; remember to rebuild after changing it.
- `VITE_DEEPSEEK_API_URL`: base URL for the API (defaults to `https://api.deepseek.com`). Make sure the endpoint is reachable via HTTPS from your deployment domain and allows CORS requests from the app origin.

Copy `.env.example` to `.env` and set the values locally if you want to test AI calls during development. Only the `VITE_*` variables are read at build time to avoid leaking server-only secrets.

If your hosting (e.g. Railway) does not expose the variable during the build step, the AI panel also lets you paste the key locally: it will be stored in the browser only for quick testing. Prefer configuring `VITE_DEEPSEEK_API_KEY` in the deploy environment and triggering a new build so the value is bundled correctly.
