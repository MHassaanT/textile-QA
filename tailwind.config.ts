import type { Config } from "tailwindcss";
const config: Config = { content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { ink: "#0b1110", panel: "#111a18", line: "#24302c", accent: "#c7f36b" }, fontFamily: { sans: ["Arial", "Helvetica", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "monospace"] } } }, plugins: [] };
export default config;
