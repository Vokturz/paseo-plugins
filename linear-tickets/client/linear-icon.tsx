import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Image } from "react-native";
import { providerPng } from "./provider-icons";

/** The supplied Linear mark, tinted to match the host control foreground. */
export function LinearButtonIcon({ size, color }: PluginButtonIconProps) {
  return <Image accessibilityLabel="Linear" source={{ uri: providerPng.linear }} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />;
}
