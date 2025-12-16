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

- `VITE_DEEPSEEK_API_KEY` **or** `DEEPSEEK_API_KEY`: your DeepSeek API key.
- `VITE_DEEPSEEK_API_URL` **or** `DEEPSEEK_API_URL`: base URL for the API (defaults to `https://api.deepseek.com`).

Copy `.env.example` to `.env` and set the values locally if you want to test AI calls during development. Both `VITE_*` and non-prefixed variants are supported at build time so Railway variables without the `VITE_` prefix will work.
