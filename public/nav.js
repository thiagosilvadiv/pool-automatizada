/**
 * Navegacao compartilhada.
 *
 * Antes cada pagina repetia sua propria lista de links, e elas ja tinham
 * divergido: o painel apontava para uma pagina de graficos removida e a pagina
 * de analises nao se listava. Com uma fonte unica isso nao volta a acontecer.
 */
const PAGES = [
  { href: "/", label: "Painel", match: ["/", "/index.html"] },
  { href: "/analytics.html", label: "Análises", match: ["/analytics.html"] },
  { href: "/allowlist.html", label: "Tokens Permitidos", match: ["/allowlist.html"] },
  { href: "/kamino-markets.html", label: "Kamino Markets", match: ["/kamino-markets.html"] }
];

export function renderNav(container = document.getElementById("appNav")) {
  if (!container) return;
  const current = window.location.pathname;
  container.classList.add("nav");
  container.replaceChildren(
    ...PAGES.map((page) => {
      const link = document.createElement("a");
      link.href = page.href;
      link.textContent = page.label;
      if (page.match.includes(current)) {
        link.setAttribute("aria-current", "page");
      }
      return link;
    })
  );
}

renderNav();
