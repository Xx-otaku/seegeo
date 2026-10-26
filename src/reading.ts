import type { Task } from "../server/types";
/** Reading text derived from markup; raw platform output stays unchanged in storage/exports. */
export function readingText(
  task: Pick<Task, "answer" | "answer_html">,
): string {
  if (!task.answer_html) return task.answer || "";
  const doc = new DOMParser().parseFromString(task.answer_html, "text/html");
  function read(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof Element)) return "";
    if (
      node.matches(
        'script,style,button,svg,[aria-hidden="true"],.hyc-follow-up-form,[class*="spacing-"]',
      )
    )
      return "";
    if (node.matches(".ds-markdown-cite"))
      return `[${(node.textContent || "").match(/\d+/g)?.join(",") || "引用"}]`;
    if (node.hasAttribute("data-idx-list"))
      return `[${node.getAttribute("data-idx-list")}]`;
    if (node.matches('span[class*="container-sWvQla"]'))
      return ` [${node.textContent}]`;
    if (node.tagName === "BR") return "\n";
    const text = [...node.childNodes].map(read).join("");
    if (["TD", "TH"].includes(node.tagName)) return text + "\t";
    return [
      "P",
      "DIV",
      "LI",
      "UL",
      "OL",
      "H1",
      "H2",
      "H3",
      "H4",
      "BLOCKQUOTE",
      "PRE",
      "TR",
      "TABLE",
    ].includes(node.tagName)
      ? "\n" + text + "\n"
      : text;
  }
  return (
    read(doc.body)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() ||
    task.answer ||
    ""
  );
}
