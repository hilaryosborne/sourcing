import { withMermaid } from "vitepress-plugin-mermaid";

// The docs site for @hilaryosborne/sourcing. Built to static HTML by `vitepress build` and
// deployed to GitHub Pages by .github/workflows/docs.yml. `base` is the project-pages path
// (https://hilaryosborne.github.io/sourcing/); change it if the repo or hosting moves.
export default withMermaid({
  title: "sourcing",
  description: "Event sourcing as mechanism, not judgment — a domain-agnostic TypeScript library.",
  lang: "en-US",
  base: "/sourcing/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#3c8772" }]],
  // Per-page Open Graph / Twitter social meta, so shared links preview with the page's own
  // title + description. (A designed social-card image can be added later as og:image.)
  transformPageData(pageData) {
    const title = pageData.title
      ? `${pageData.title} · sourcing`
      : "sourcing — event sourcing as mechanism, not judgment";
    const description =
      pageData.description || "Event sourcing as mechanism, not judgment — a domain-agnostic TypeScript library.";
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:site_name", content: "sourcing" }],
      ["meta", { name: "twitter:card", content: "summary" }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    );
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts" },
      { text: "Examples", link: "/examples" },
      { text: "🤖 AI Skills", link: "/skills" },
      { text: "Reference", link: "/reference/error-index" },
      { text: "GitHub", link: "https://github.com/hilaryosborne/sourcing" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Why event sourcing?", link: "/guide/what-is-sourcing" },
          { text: "Installation & setup", link: "/guide/installation" },
          { text: "Quickstart", link: "/guide/getting-started" },
          { text: "Architecture at a glance", link: "/guide/architecture" },
          { text: "Common use cases", link: "/guide/use-cases" },
          { text: "How it compares", link: "/project/comparison" },
        ],
      },
      {
        text: "Concepts",
        items: [{ text: "The mental model", link: "/concepts" }],
      },
      {
        text: "The builders",
        items: [
          { text: "Events", link: "/guide/events" },
          { text: "Versioning & upcasters", link: "/guide/versioning" },
          { text: "Aggregates", link: "/guide/aggregates" },
          { text: "Projections", link: "/guide/projections" },
          { text: "Right-to-forget", link: "/guide/right-to-forget" },
        ],
      },
      {
        text: "Persistence & storage",
        items: [
          { text: "The repository & self-healing", link: "/guide/repository" },
          { text: "Storage adapters", link: "/guide/storage-adapters" },
          { text: "🐘 Postgres", link: "/guide/adapter-postgres" },
          { text: "🍃 Mongo", link: "/guide/adapter-mongo" },
          { text: "🪣 S3", link: "/guide/adapter-s3" },
          { text: "Cross-stream read models", link: "/guide/read-models" },
          { text: "Observability", link: "/guide/observability" },
        ],
      },
      {
        text: "Customise & extend",
        items: [
          { text: "Write your own adapter", link: "/guide/write-own-adapter" },
          { text: "Write your own observer", link: "/guide/write-own-observer" },
          { text: "Spreading storage", link: "/guide/destinations" },
        ],
      },
      {
        text: "Recipes",
        items: [
          { text: "Testing", link: "/recipes/testing" },
          { text: "Modelling a state machine", link: "/recipes/state-machine" },
          { text: "Multi-tenant & sharding", link: "/recipes/multi-tenant" },
          { text: "Incremental adoption", link: "/recipes/incremental-adoption" },
          { text: "Bulk right-to-forget", link: "/recipes/bulk-forget" },
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
        items: [
          { text: "Error index", link: "/reference/error-index" },
          { text: "Data model reference", link: "/reference/data-models" },
          { text: "API: core", link: "/reference/api-core" },
          { text: "API: persistence", link: "/reference/api-persistence" },
          { text: "Glossary", link: "/reference/glossary" },
          { text: "FAQ & edge cases", link: "/faq" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Roadmap", link: "/project/roadmap" },
          { text: "Changelog", link: "/project/changelog" },
          { text: "Contributing", link: "/project/contributing" },
        ],
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
