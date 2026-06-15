import { defineConfig } from "vitepress";

// The docs site for @hilaryosborne/sourcing. Built to static HTML by `vitepress build` and
// deployed to GitHub Pages by .github/workflows/docs.yml. `base` is the project-pages path
// (https://hilaryosborne.github.io/sourcing/); change it if the repo or hosting moves.
export default defineConfig({
  title: "sourcing",
  description: "Event sourcing as mechanism, not judgment — a domain-agnostic TypeScript library.",
  lang: "en-US",
  base: "/sourcing/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#3c8772" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts" },
      { text: "Examples", link: "/examples" },
      { text: "🤖 AI Skills", link: "/skills" },
      { text: "FAQ", link: "/faq" },
      { text: "GitHub", link: "https://github.com/hilaryosborne/sourcing" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Why event sourcing?", link: "/guide/what-is-sourcing" },
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "The three scenarios", link: "/guide/scenarios" },
        ],
      },
      {
        text: "Concepts",
        items: [{ text: "The mental model", link: "/concepts" }],
      },
      {
        text: "Guides",
        items: [
          { text: "Events", link: "/guide/events" },
          { text: "Aggregates", link: "/guide/aggregates" },
          { text: "Projections", link: "/guide/projections" },
          { text: "Storage adapters", link: "/guide/storage-adapters" },
          { text: "Right-to-forget", link: "/guide/right-to-forget" },
          { text: "Observability", link: "/guide/observability" },
        ],
      },
      {
        text: "Examples",
        items: [
          { text: "🧪 Overview", link: "/examples" },
          { text: "🛒 Shopping cart", link: "/examples/shopping-cart" },
          { text: "📦 Order fulfillment", link: "/examples/order-fulfillment" },
          { text: "📄 Document lifecycle", link: "/examples/document-lifecycle" },
          { text: "🗑️ Right-to-forget", link: "/examples/gdpr-erasure" },
          { text: "🐘 Self-healing (Postgres)", link: "/examples/self-healing-postgres" },
        ],
      },
      {
        text: "For AI assistants",
        items: [{ text: "🤖 Skills & llms.txt", link: "/skills" }],
      },
      {
        text: "Reference",
        items: [{ text: "FAQ & edge cases", link: "/faq" }],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/hilaryosborne/sourcing" }],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/hilaryosborne/sourcing/edit/main/website/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "© Hilary Osborne",
    },
  },
});
