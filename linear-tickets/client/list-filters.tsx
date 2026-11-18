import { Text, View } from "react-native";
import type { ListFilter } from "../shared/contracts";
import { ChoicePicker } from "./choice-picker";
import type { Tokens } from "./design";
import { labelFilterOptions, labelGroupNames, labelRefDisplay, labelRefKey, toggleCustomer, toggleLabel, toggleMissingGroup, type WorkspaceLabel } from "./label-tools";
import { Button, Callout, FieldLabel, LabelChip } from "./ui";

export type CustomerChoice = { id: string; name: string; tier: string };
const ANY_CUSTOMER = "__any__";

/** Label, label-group and customer filters. Every change goes back to Linear as a server-side filter. */
export function ListFilters({ t, filter, onChange, labels, labelsError, onRetryLabels, customers, customersAvailable, disabled }: {
  t: Tokens; filter: ListFilter; onChange: (next: ListFilter) => void;
  labels: WorkspaceLabel[]; labelsError: string | null; onRetryLabels: () => void;
  customers: CustomerChoice[]; customersAvailable: boolean; disabled: boolean;
}) {
  const chosenLabels = new Set(filter.labels.map(labelRefKey));
  const labelOptions = labelFilterOptions(labels).filter((option) => !chosenLabels.has(option.id));
  const groups = labelGroupNames(labels);
  const customerName = (id: string) => customers.find((customer) => customer.id === id)?.name ?? "Customer";
  return <View style={{ gap: 14 }}>
    {labelsError && <Callout t={t} tone="danger" message={`Labels could not be loaded: ${labelsError}`} action={<Button title="Retry" icon="RefreshCw" size="sm" onPress={onRetryLabels} />} />}
    <View style={{ gap: 8 }}>
      <FieldLabel title="Labels" icon="Tag" hint="labels in one group are alternatives; different groups must all match" t={t} />
      {!!filter.labels.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {filter.labels.map((ref) => <LabelChip key={labelRefKey(ref)} label={labelRefDisplay(ref)} t={t} onRemove={disabled ? undefined : () => onChange(toggleLabel(filter, ref))} />)}
      </View>}
      <ChoicePicker label="Labels" icon="Tag" placeholder={labels.length ? "Add a label filter…" : "No labels loaded"} value="" t={t} disabled={disabled || !labelOptions.length}
        options={labelOptions.map(({ id, label, description }) => ({ id, label, description }))}
        onChange={(id) => { const option = labelOptions.find((item) => item.id === id); if (option) onChange(toggleLabel(filter, option.ref)); }} />
    </View>
    {!!groups.length && <View style={{ gap: 8 }}>
      <FieldLabel title="Missing a label from" icon="CircleDashed" hint="tickets nobody has categorised yet" t={t} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {groups.map((group) => <Button key={group} size="sm" title={`No ${group}`} chosen={filter.missingGroups.includes(group)} disabled={disabled}
          onPress={() => onChange(toggleMissingGroup(filter, group))} />)}
      </View>
    </View>}
    {customersAvailable && <View style={{ gap: 8 }}>
      <FieldLabel title="Customers" icon="Building2" hint="tickets with a customer request" t={t} />
      {(filter.anyCustomer || !!filter.customerIds.length) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {filter.anyCustomer && <LabelChip label="Any customer" icon="Building2" t={t} onRemove={disabled ? undefined : () => onChange({ ...filter, anyCustomer: false })} />}
        {filter.customerIds.map((id) => <LabelChip key={id} label={customerName(id)} icon="Building2" t={t} onRemove={disabled ? undefined : () => onChange(toggleCustomer(filter, id))} />)}
      </View>}
      <ChoicePicker label="Customers" icon="Building2" placeholder="Add a customer filter…" value="" t={t} disabled={disabled}
        options={[
          ...(filter.anyCustomer ? [] : [{ id: ANY_CUSTOMER, label: "Any customer", description: "Tickets with at least one customer request" }]),
          ...customers.filter((customer) => !filter.customerIds.includes(customer.id)).map((customer) => ({ id: customer.id, label: customer.name, description: customer.tier || undefined })),
        ]}
        onChange={(id) => onChange(id === ANY_CUSTOMER ? { ...filter, anyCustomer: true, customerIds: [] } : toggleCustomer(filter, id))} />
      {!customers.length && <Text style={t.muted}>No customers in this workspace yet.</Text>}
    </View>}
  </View>;
}
