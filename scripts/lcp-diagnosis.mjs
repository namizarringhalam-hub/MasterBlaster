import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LCP_DIAGNOSIS_PATH = "lcp-diagnosis-20261015";
export const LCP_DIAGNOSTIC_VARIANTS = ["priority", "shell", "no-blur", "still", "body-preload", "no-analytics", "image-low", "image-css", "analytics-async", "boot-low", "no-art", "unused-art"];

export function lcpDiagnosticVariant(html, variant) {
  if (!LCP_DIAGNOSTIC_VARIANTS.includes(variant)) throw new Error(`Unknown LCP diagnostic variant: ${variant}`);
  if (!/<head\b/i.test(html) || !/<\/head>/i.test(html)) throw new Error("Expected a built HTML head");
  if (!/<meta\s+name="robots"\s+content="[^"]*"\s*\/?\s*>/i.test(html)) throw new Error("Expected one robots meta tag");
  if (!/<link\s+rel="canonical"\s+href="https:\/\/masterblaster\.se\/"\s*\/?\s*>/i.test(html)) throw new Error("Expected canonical game homepage");
  let result = html.replace(/(<meta\s+name="robots"\s+content=")[^"]*("\s*\/?\s*>)/i, "$1noindex, follow$2")
    .replace(/<html\b/i, `<html data-lcp-variant="${variant}"`);
  if (variant === "shell") {
    const boot = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/assets\/index-[^"\s]+\.js")[^>]*>\s*<\/script>/gi;
    const matches = [...result.matchAll(boot)];
    if (matches.length !== 1) throw new Error(`Expected one production boot module, found ${matches.length}`);
    result = result.replace(boot, "");
  }
  if (variant === "no-blur") result = result.replace(/<\/head>/i, '<style data-lcp-diagnostic="no-blur">.menu-shell[data-menu-scene="landing"]::before { backdrop-filter: none !important; }</style>\n</head>');
  if (variant === "still") result = result.replace(/<\/head>/i, '<style data-lcp-diagnostic="still">[data-menu-scene="landing"] .menu-atmosphere > span, [data-menu-scene="landing"] .menu-atmosphere > span::before, [data-menu-scene="landing"] .menu-atmosphere > span::after, [data-menu-scene="landing"] .menu-atmosphere::before, [data-menu-scene="landing"] .menu-atmosphere::after { animation-play-state: paused !important; }</style>\n</head>');
  if (variant === "body-preload") {
    const font = result.match(/url\((\/[^)\s"']*FuYMZg-latin\.woff2)\)/)?.[1];
    if (!font) throw new Error("Expected the built Inter 700 Latin font URL");
    const image = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")[^>]*>/i;
    if (!image.test(result)) throw new Error("Expected the background image preload insertion point");
    result = result.replace(image, match => `<link rel="preload" as="font" type="font/woff2" href="${font}" crossorigin fetchpriority="high" />\n    ${match}`);
  }
  if (variant === "no-analytics") {
    const analytics = /<script\b(?=[^>]*\bsrc="https:\/\/cloud\.umami\.is\/script\.js")[^>]*>\s*<\/script>/gi;
    const matches = [...result.matchAll(analytics)];
    if (matches.length !== 1) throw new Error(`Expected one explicit Umami script, found ${matches.length}`);
    result = result.replace(analytics, "");
  }
  if (variant === "image-low" || variant === "image-css") {
    const image = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")[^>]*>/gi;
    const matches = [...result.matchAll(image)];
    if (matches.length !== 1) throw new Error(`Expected one background image preload, found ${matches.length}`);
    if (/\bfetchpriority\s*=/i.test(matches[0][0])) throw new Error("Expected the baseline image preload without an existing priority");
    result = result.replace(image, match => variant === "image-css" ? "" : match.replace(/\s*\/?>$/, ending => ` fetchpriority="low"${ending}`));
  }
  if (variant === "analytics-async") {
    const analytics = /<script\b(?=[^>]*\bsrc="https:\/\/cloud\.umami\.is\/script\.js")[^>]*>\s*<\/script>/gi;
    const matches = [...result.matchAll(analytics)];
    if (matches.length !== 1 || !/\sdefer(?=\s|>)/i.test(matches[0][0]) || /\sasync(?=\s|>)/i.test(matches[0][0])) throw new Error("Expected one deferred, non-async Umami script");
    result = result.replace(analytics, match => match.replace(/\sdefer(?=\s|>)/i, " async"));
  }
  if (variant === "boot-low") {
    const boot = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/assets\/index-[^"\s]+\.js")[^>]*>\s*<\/script>/gi;
    const matches = [...result.matchAll(boot)];
    if (matches.length !== 1 || /\bfetchpriority\s*=/i.test(matches[0][0])) throw new Error("Expected one production boot module without an existing priority");
    result = result.replace(boot, match => match.replace(/>/, ' fetchpriority="low">'));
  }
  if (variant === "no-art" || variant === "unused-art") {
    const image = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")[^>]*>/gi;
    if ([...result.matchAll(image)].length !== 1) throw new Error("Expected one background image preload for art exclusion control");
    if (variant === "no-art") result = result.replace(image, "");
    // Diagnostic exclusion only: the original CSS URL remains, but is overridden.
    result = result.replace(/<\/head>/i, '<style data-lcp-diagnostic="art-exclusion">.menu-shell[data-menu-scene="landing"] .arena-towers { background-image: none !important; }</style>\n</head>');
  }
  return result;
}

export async function writeLcpDiagnosis(dir = "dist/client") {
  const html = await readFile(join(dir, "index.html"), "utf8");
  const probe = (await readFile(new URL("./lcp-diagnosis-probe.js", import.meta.url), "utf8")).replace(/<\/script/gi, "<\\/script");
  const base = join(dir, LCP_DIAGNOSIS_PATH);
  // Same release, resources, metadata and probe insertion point in every arm.
  for (const variant of LCP_DIAGNOSTIC_VARIANTS) {
    const scored = lcpDiagnosticVariant(html, variant);
    const charset = /<meta\s+charset="[^"]+"\s*\/?\s*>/i;
    if (!charset.test(scored)) throw new Error("Expected an early charset declaration before probe insertion");
    const instrumented = scored.replace(charset, match => `${match}\n<script data-lcp-diagnostic-probe>\n${probe}\n</script>`);
    for (const [path, content] of [[join(base, variant), scored], [join(base, "diagnostic", variant), instrumented]]) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "index.html"), content);
    }
  }
  return { path: `/${LCP_DIAGNOSIS_PATH}/`, variants: [...LCP_DIAGNOSTIC_VARIANTS], instrumentedPath: `/${LCP_DIAGNOSIS_PATH}/diagnostic/` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await writeLcpDiagnosis(process.argv[2]));
