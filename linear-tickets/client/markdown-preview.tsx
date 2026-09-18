import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl } from "./open-link";

type Theme = PluginSurfaceProps["theme"];
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

function InlineMarkdown({ text, theme, platform }: { text: string; theme: Theme; platform?: Platform }) {
  const c = theme.colors;
  const parts = text.split(/(\[[^\]]+\]\(<?https:\/\/[^\s)>]+>?\)|`[^`]+`)/g);
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
    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(<Text key={index} style={{ fontFamily: "monospace", fontSize: 13, color: c.foreground, backgroundColor: c.surface2 }}>{part.slice(1, -1)}</Text>);
      continue;
    }
    nodes.push(part);
  }
  return <>{nodes}</>;
}

function MarkdownProse({ markdown, theme, platform }: { markdown: string; theme: Theme; platform?: Platform }) {
  const blocks = markdown.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return <View style={{ gap: 12 }}>
    {blocks.map((block, index) => {
      if (block.startsWith("```")) {
        const source = block.slice(3, -3).replace(/^[-\w]+\n/, "").trim();
        return <View key={index} style={{ borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, padding: 12 }}>
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{source}</Text>
        </View>;
      }
      return block.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => <Text key={`${index}-${paragraphIndex}`} selectable style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 24 }}>
        <InlineMarkdown text={paragraph} theme={theme} platform={platform} />
      </Text>);
    })}
  </View>;
}

function MarkdownImageCard({ image, theme, platform }: { image: MarkdownImage; theme: Theme; platform?: Platform }) {
  const [failed, setFailed] = useState(false);
  const c = theme.colors;
  if (failed) return <View style={{ borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0, padding: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
    <Icon name="ImageOff" size={16} color={c.foregroundMuted} />
    <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>{image.alt || "Image preview unavailable"}</Text>
  </View>;
  return <Pressable accessibilityRole="link" accessibilityLabel={`Open image${image.alt ? `: ${image.alt}` : ""}`} onPress={() => void openExternalUrl(image.url, { platform, linking: Linking })}
    style={({ pressed }) => ({ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.8 : 1 })}>
    <Image accessibilityLabel={image.alt || "Ticket image"} source={{ uri: image.url }} resizeMode="cover" onError={() => setFailed(true)}
      style={{ width: "100%", height: 220, backgroundColor: c.surface0 }} />
    {!!image.alt && <View style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.surface0 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{image.alt}</Text></View>}
  </Pressable>;
}

export function MarkdownPreview({ markdown, theme, platform }: { markdown: string; theme: Theme; platform?: Platform }) {
  const images = useMemo(() => imagesIn(markdown), [markdown]);
  const prose = useMemo(() => markdown.replace(/!\[[^\]]*\]\(<?https:\/\/[^\s)>]+>?(?:\s+[^)]*)?\)/g, "").replace(/\n{3,}/g, "\n\n").trim(), [markdown]);
  return <View style={{ gap: 12 }}>
    {!!prose && <MarkdownProse markdown={prose} theme={theme} platform={platform} />}
    {images.map((image, index) => <MarkdownImageCard key={`${image.url}-${index}`} image={image} theme={theme} platform={platform} />)}
  </View>;
}
