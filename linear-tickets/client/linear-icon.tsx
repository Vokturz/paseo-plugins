import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Image } from "react-native";
import { providerPng } from "./provider-icons";

/** The supplied Linear mark, tinted to match the host control foreground. */
export function LinearButtonIcon({ size, color }: PluginButtonIconProps) {
  // The mark occupies roughly three quarters of its 24px viewBox. Render it above the
  // nominal Lucide slot so its visible weight matches the adjacent ticket label.
  const renderedSize = Math.max(16, Math.round(size * 1.25));
  return <Image accessibilityLabel="Linear" source={{ uri: providerPng.linear }} resizeMode="contain" style={{ width: renderedSize, height: renderedSize, tintColor: color }} />;
}
