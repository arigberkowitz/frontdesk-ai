import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./field";

type FieldProps = Parameters<typeof Field>[0];
/** Field's props minus children: createElement passes those as extra arguments. */
const props = (p: Omit<FieldProps, "children">) => p as FieldProps;

/** The label must name its control, even when a helper sits next to it. */
const labelFor = (html: string) => /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
const hasId = (html: string, tag: string, id: string | undefined) =>
  Boolean(id) && new RegExp(`<${tag}[^>]*id="${id}"`).test(html);

describe("Field", () => {
  it("wires a single control", () => {
    const html = renderToStaticMarkup(
      h(Field, props({ label: "Name", hint: "Hint" }), h("input", { name: "n" })),
    );
    expect(hasId(html, "input", labelFor(html))).toBe(true);
  });

  it("wires the first control when a helper follows it", () => {
    const html = renderToStaticMarkup(
      h(
        Field,
        props({ label: "Text alerts" }),
        h("select", { name: "sms" }),
        h("span", null, "What's this?"),
      ),
    );
    expect(hasId(html, "select", labelFor(html))).toBe(true);
    expect(html).toContain("<span>What&#x27;s this?</span>");
  });

  it("skips a hidden input in front of the control", () => {
    const html = renderToStaticMarkup(
      h(
        Field,
        props({ label: "Plan" }),
        h("input", { type: "hidden", name: "clientId", value: "c1" }),
        h("select", { name: "plan" }),
      ),
    );
    expect(hasId(html, "select", labelFor(html))).toBe(true);
    expect(hasId(html, "input", labelFor(html))).toBe(false);
  });
});
