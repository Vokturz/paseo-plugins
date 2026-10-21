import type { Tokens } from "./design";
import { Interactive } from "./ui";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { listOwnersRpc } from "../shared/contracts";
import { filtersSchema, ownerChoices, type OwnerOption } from "../shared/filters";
import { ChoiceGrid, FilterChoice } from "./filter-choice";

export function OwnerPicker({ t, selected, onChange, disabled }: {
  t: Tokens; selected: string[]; onChange: (owners: string[]) => void; disabled: boolean;
}) {
  const c = t.colors;
  const listOwners = useRpc(listOwnersRpc);
  const [available, setAvailable] = useState<OwnerOption[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const retryPage = useRef(1);
  const account = useRef<string | null>(null);

  const load = useCallback(async (page: number) => {
    if (busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    retryPage.current = page;
    setLoading(true); setError(null);
    try {
      const result = await listOwners({ page });
      if (generation.current !== request) return;
      if (page > 1 && account.current !== result.login) {
        setAvailable([]); setNextPage(null); retryPage.current = 1;
        throw new Error("The GitHub account changed. Reload the owner list.");
      }
      account.current = result.login;
      setAvailable((previous) => [...new Map((page === 1 ? result.owners : [...previous, ...result.owners]).map((owner) => [owner.login, owner])).values()]);
      setNextPage(result.nextPage);
    } catch (error) {
      if (generation.current === request) setError(error instanceof Error ? error.message : "Could not load organizations and users.");
    } finally {
      if (generation.current === request) { busy.current = false; setLoading(false); }
    }
  }, [listOwners]);

  useEffect(() => {
    void load(1);
    return () => { generation.current++; busy.current = false; };
  }, [load]);

  return <View style={{ gap: 10 }}>
    <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }} contentContainerStyle={{ padding: 4 }}>
      <ChoiceGrid>
        <FilterChoice t={t} label="All owners" icon="Globe" checked={selected.length === 0} onPress={() => onChange([])} disabled={disabled} />
        {ownerChoices(available, selected).map((owner) => {
          const checked = selected.includes(owner.login);
          const limitReached = !checked && !filtersSchema.safeParse({ owners: [...selected, owner.login] }).success;
          return <FilterChoice key={owner.login} t={t} label={owner.login}
            icon={owner.kind === "organization" ? "Building2" : owner.kind === "user" ? "UserRound" : "AtSign"}
            checked={checked} disabled={disabled || limitReached}
            onPress={() => onChange(checked ? selected.filter((login) => login !== owner.login) : [...selected, owner.login])} />;
        })}
      </ChoiceGrid>
    </ScrollView>
    <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}>Choose repository owners to include. All owners removes this restriction.</Text>
    {loading && <ActivityIndicator accessibilityLabel="Loading organizations and users" size="small" color={c.accent} />}
    {error && <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text>}
    {(error || nextPage !== null) && <Interactive t={t} accessibilityRole="button" disabled={loading || disabled}
      accessibilityState={{ disabled: loading || disabled }} onPress={() => void load(error ? retryPage.current : nextPage!)}
      style={{ alignSelf: "flex-start", minHeight: Math.max(38, t.touchTarget), justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: c.border, borderRadius: 9, opacity: loading || disabled ? 0.45 : 1 }}>
      <Text style={{ color: c.foreground, fontSize: 13 }}>{error ? "Retry loading owners" : "Load more owners"}</Text>
    </Interactive>}
  </View>;
}
