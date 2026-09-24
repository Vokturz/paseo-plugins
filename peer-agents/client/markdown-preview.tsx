import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Icon, copyText } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { Tokens } from "./design";
import { parseMarkdown, type MarkdownBlock } from "./markdown";
import { openExternalUrl } from "./open-link";

type Platform = PluginSurfaceProps["layout"]["platform"];

type MarkdownImage = { alt: string; url: string };

function safeUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}

function imagesIn(markdown: string): MarkdownImage[] {
  const images: MarkdownImage[] = [];
  const pattern = /!\[([^\]]*)\]\(<?(https:\/\/[^\s)>]+)>?(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const url = safeUrl(match[2]);
    if (url) images.push({ alt: match[1].trim(), url });
  }
  return images;
}

function InlineMarkdown({ text, t, platform }: { text: string; t: Tokens; platform?: Platform }) {
  const c = t.colors;
  // Split on links, inline code and bold, keeping the delimiters as fallback text.
  const parts = text.split(/(\[[^\]]+\]\(<?https:\/\/[^\s)>]+>?\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  const nodes: ReactNode[] = [];
  for (const [index, part] of parts.entries()) {
    const link = /^\[([^\]]+)\]\(<?(https:\/\/[^\s)>]+)>?\)$/.exec(part);
    if (link) {
      const url = safeUrl(link[2]);
      nodes.push(url
        ? <Text key={index} accessibilityRole="link" onPress={() => void openExternalUrl(url, { platform, linking: Linking })} style={{ color: c.accent, textDecorationLine: "underline" }}>{link[1]}</Text>
        : <Text key={index}>{part}</Text>);
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**")) { nodes.push(<Text key={index} style={{ fontWeight: "700" }}>{part.slice(2, -2)}</Text>); continue; }
    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(<Text key={index} style={{ fontFamily: "monospace", fontSize: 13, color: c.foreground, backgroundColor: c.surface2 }}>{part.slice(1, -1)}</Text>);
      continue;
    }
    nodes.push(part);
  }
  return <>{nodes}</>;
}

function CodeBlock({ code, language, t, platform }: { code: string; language: string; t: Tokens; platform?: Platform }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void copyText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => setCopied(false)); };
  return <View style={{ borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface0, overflow: "hidden" }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.colors.surface2 }}>
      <Text style={{ ...t.eyebrow, fontSize: 9.5 }}>{language || "code"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={copied ? "Code copied" : "Copy code"} onPress={copy} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name={copied ? "Check" : "Copy"} size={12} color={copied ? t.colors.statusSuccess : t.colors.foregroundMuted} />
        <Text style={{ color: copied ? t.colors.statusSuccess : t.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
    </View>
    <Text selectable style={{ ...t.mono, padding: 12, lineHeight: 19 }}>{code}</Text>
  </View>;
}

const HEADING_SIZES = [20, 17, 15, 14, 13, 13];

function TableBlock({ block, t, platform }: { block: Extract<MarkdownBlock, { type: "table" }>; t: Tokens; platform?: Platform }) {
  const columns = Math.max(block.header.length, block.align.length, ...block.rows.map((row) => row.length));
  const cell = (value: string | undefined, index: number) => ({
    value: value ?? "",
    align: block.align[index] ?? "left",
  });
  const cells = (row: string[]) => Array.from({ length: columns }, (_, index) => cell(row[index], index));
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: "100%" }}>
    <View style={{ flexGrow: 1, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", backgroundColor: t.colors.surface2 }}>
        {cells(block.header).map(({ value, align }, index) => <View key={index} style={{ flexGrow: 1, flexBasis: 0, minWidth: 150, paddingHorizontal: 12, paddingVertical: 9, borderLeftWidth: index ? 1 : 0, borderLeftColor: t.colors.border }}>
          <Text style={{ color: t.colors.foreground, fontSize: 12, fontWeight: "700", lineHeight: 18, textAlign: align }}><InlineMarkdown text={value} t={t} platform={platform} /></Text>
        </View>)}
      </View>
      {block.rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: t.colors.border, backgroundColor: rowIndex % 2 ? t.colors.surface0 : "transparent" }}>
        {cells(row).map(({ value, align }, index) => <View key={index} style={{ flexGrow: 1, flexBasis: 0, minWidth: 150, paddingHorizontal: 12, paddingVertical: 9, borderLeftWidth: index ? 1 : 0, borderLeftColor: t.colors.border }}>
          <Text selectable style={{ color: t.colors.foreground, fontSize: 13, lineHeight: 20, textAlign: align }}><InlineMarkdown text={value} t={t} platform={platform} /></Text>
        </View>)}
      </View>)}
    </View>
  </ScrollView>;
}

function Block({ block, t, platform }: { block: MarkdownBlock; t: Tokens; platform?: Platform }) {
  if (block.type === "code") return <CodeBlock code={block.code} language={block.language} t={t} platform={platform} />;
  if (block.type === "table") return <TableBlock block={block} t={t} platform={platform} />;
  if (block.type === "divider") return <View style={{ ...t.divider, marginVertical: 4 }} />;
  if (block.type === "heading") return <Text selectable style={{ color: t.colors.foreground, fontSize: HEADING_SIZES[block.level - 1], fontWeight: "700", lineHeight: HEADING_SIZES[block.level - 1] * 1.4, marginTop: 4 }}>
    <InlineMarkdown text={block.text} t={t} platform={platform} />
  </Text>;
  if (block.type === "quote") return <View style={{ borderLeftWidth: 3, borderLeftColor: t.colors.border, paddingLeft: 12 }}>
    <Text selectable style={{ ...t.body, color: t.colors.foregroundMuted }}><InlineMarkdown text={block.text} t={t} platform={platform} /></Text>
  </View>;
  if (block.type === "list") return <View style={{ gap: 6 }}>
    {block.items.map((item, index) => <View key={index} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
      {item.checked === undefined
        ? block.ordered
          ? <Text style={{ ...t.muted, color: t.colors.accent, fontWeight: "700", minWidth: 16 }}>{index + 1}.</Text>
          : <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.accent, marginTop: 8 }} />
        : <Icon name={item.checked ? "SquareCheck" : "Square"} size={14} color={item.checked ? t.colors.statusSuccess : t.colors.foregroundMuted} />}
      <Text selectable style={{ ...t.body, flex: 1 }}><InlineMarkdown text={item.text} t={t} platform={platform} /></Text>
    </View>)}
  </View>;
  return <Text selectable style={t.body}><InlineMarkdown text={block.text} t={t} platform={platform} /></Text>;
}

function MarkdownImageCard({ image, t, platform }: { image: MarkdownImage; t: Tokens; platform?: Platform }) {
  const [failed, setFailed] = useState(false);
  const c = t.colors;
  if (failed) return <View style={{ borderRadius: t.radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0, padding: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
    <Icon name="ImageOff" size={16} color={c.foregroundMuted} />
    <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>{image.alt || "Image preview unavailable"}</Text>
  </View>;
  return <Pressable accessibilityRole="link" accessibilityLabel={`Open image${image.alt ? `: ${image.alt}` : ""}`} onPress={() => void openExternalUrl(image.url, { platform, linking: Linking })}
    style={({ pressed }) => ({ borderRadius: t.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.85 : 1, backgroundColor: c.surface0 })}>
    <Image accessibilityLabel={image.alt || "Ticket image"} source={{ uri: image.url }} resizeMode="cover" onError={() => setFailed(true)}
      style={{ width: "100%", height: 220, backgroundColor: c.surface0 }} />
    <View style={{ paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="Image" size={12} color={c.foregroundMuted} />
      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>{image.alt || "Linked image"}</Text>
    </View>
  </Pressable>;
}

export function MarkdownPreview({ markdown, t, platform }: { markdown: string; t: Tokens; platform?: Platform }) {
  const images = useMemo(() => imagesIn(markdown), [markdown]);
  const blocks = useMemo(() => parseMarkdown(markdown.replace(/!\[[^\]]*\]\(<?https:\/\/[^\s)>]+>?(?:\s+[^)]*)?\)/g, "").replace(/\n{3,}/g, "\n\n").trim()), [markdown]);
  return <View style={{ gap: 12 }}>
    {blocks.map((block, index) => <Block key={index} block={block} t={t} platform={platform} />)}
    {images.map((image, index) => <MarkdownImageCard key={`${image.url}-${index}`} image={image} t={t} platform={platform} />)}
  </View>;
}