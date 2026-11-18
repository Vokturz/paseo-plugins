import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIST_FILTER, type IssueLabel } from "../shared/contracts";
import { activeFilterCount, issueLabelChips, labelFilterOptions, quickLabels, safeColor, toggleCustomer, toggleLabel } from "./label-tools";

const label = (id: string, name: string, groupName = "", extra: Partial<IssueLabel> = {}): IssueLabel => ({ id, name, color: "", groupId: groupName ? `g-${groupName}` : null, groupName, groupMulti: false, teamId: null, ...extra });

test("filter options merge same-named labels across teams and list grouped labels first", () => {
  const options = labelFilterOptions([
    { ...label("1", "Core API", "Area"), team: "Dev" },
    { ...label("2", "Core API", "Area"), team: "Ops" },
    { ...label("3", "tech-debt"), team: "" },
    { ...label("4", "Reliability", "Bug"), team: "Dev" },
  ]);
  assert.deepEqual(options.map((option) => [option.label, option.description]), [["Area / Core API", "Dev, Ops"], ["Bug / Reliability", "Dev"], ["tech-debt", "Workspace"]]);
});

test("label chips put grouped labels first and keep only safe colours", () => {
  const chips = issueLabelChips({ labels: [], labelInfo: [label("1", "security", "", { color: "red; x" }), label("2", "Core API", "Area", { color: "#5e6ad2" })] });
  assert.deepEqual(chips, [{ label: "Area / Core API", color: "#5e6ad2", grouped: true }, { label: "security", color: undefined, grouped: false }]);
  assert.equal(safeColor("#abc"), "#abc");
  assert.equal(safeColor("url(x)"), undefined);
});

test("toggles add and remove filters, and picking a customer clears 'any customer'", () => {
  const withLabel = toggleLabel(DEFAULT_LIST_FILTER, { group: "Area", name: "Core API" });
  assert.equal(activeFilterCount(withLabel), 1);
  assert.equal(activeFilterCount(toggleLabel(withLabel, { group: "Area", name: "Core API" })), 0);
  assert.deepEqual(toggleCustomer({ ...DEFAULT_LIST_FILTER, anyCustomer: true }, "c-1"), { ...DEFAULT_LIST_FILTER, customerIds: ["c-1"] });
});

test("quick labels keep active filters first, then the most common labels", () => {
  const issues = [
    { labelInfo: [label("1", "Core API", "Area"), label("2", "Reliability", "Bug")] },
    { labelInfo: [label("1", "Core API", "Area")] },
    { labelInfo: [label("3", "UX")] },
  ];
  const quick = quickLabels(issues, [{ group: "", name: "UX" }], 2);
  assert.deepEqual(quick.map((entry) => [entry.ref.name, entry.count]), [["UX", 1], ["Core API", 2]]);
});
